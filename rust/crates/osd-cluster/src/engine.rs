//! The clustering stage: assigning runs, lifts and spots to ski areas, merging Skimap.org
//! ski areas into OpenStreetMap ones, generating ski areas for what is left over, and
//! describing each ski area from its members.
//!
//! Replaces `SkiAreaClusteringService` and the PostGIS database behind it. Where upstream
//! runs a SQL query, a method here applies the same conditions to the in-memory objects, and
//! says which query it stands for.
//!
//! # Order is behaviour
//!
//! Membership depends on the order objects are visited in: a traversal narrows the set of
//! activities along each path and a ski area *consumes* the objects it reaches, so who gets
//! an object depends on who asks first. Upstream pins this with `ORDER BY key` on every
//! query, and so does this: all iteration is over keys in byte order, and the traversal
//! visits children in key order with one visited set per seed.

use crate::spatial::{self, BBox};
use crate::stats;
use crate::turf;
use anyhow::{Result, bail};
use openskidata_format::lift::LiftProperties;
use openskidata_format::place::Place;
use openskidata_format::run::RunProperties;
use openskidata_format::ski_area::{
    SkiAreaGeometry, SkiAreaProperties, SkiAreaSummaryFeature, SkiAreaSummaryProperties,
};
use openskidata_format::source::Source;
use openskidata_format::spot::{
    FeatureTag, LiftStationSpotFeature, PointTag, SpotGeometry, SpotKind, SpotProperties,
};
use openskidata_format::viewport_hint::{ViewportHint, compute_viewport_hint};
use openskidata_format::{
    FeatureType, LiftType, RunDifficulty, RunGrooming, RunUse, SkiAreaActivity, SourceType, Status,
};
use osd_osm::element::{Geometry, Position};
use rstar::{AABB, RTree, RTreeObject};
use sha1::{Digest, Sha1};
use std::collections::{BTreeMap, HashSet};

const MAX_DISTANCE_KM: f64 = 0.5;
const MAX_SKI_AREA_MERGE_DISTANCE_KM: f64 = 0.25;

const ALL_ACTIVITIES: [SkiAreaActivity; 2] = [SkiAreaActivity::Downhill, SkiAreaActivity::Nordic];

fn is_ski_area_activity(activity: SkiAreaActivity) -> bool {
    ALL_ACTIVITIES.contains(&activity)
}

// --------------------------------------------------------------------------------------
// Input and output
// --------------------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct SkiAreaIn {
    pub geometry: Geometry,
    pub properties: SkiAreaProperties,
}

#[derive(Debug, Clone)]
pub struct RunIn {
    pub geometry: Geometry,
    pub properties: RunProperties,
    pub site_ski_areas: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct LiftIn {
    pub geometry: Geometry,
    pub properties: LiftProperties,
    pub site_ski_areas: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct SpotIn {
    pub geometry: Geometry,
    pub properties: SpotProperties,
    pub site_ski_areas: Vec<String>,
}

#[derive(Debug, Default)]
pub struct ClusterInput {
    pub ski_areas: Vec<SkiAreaIn>,
    pub lifts: Vec<LiftIn>,
    pub runs: Vec<RunIn>,
    pub spots: Vec<SpotIn>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Feature<P> {
    pub geometry: Geometry,
    pub properties: P,
}

#[derive(Debug, Default)]
pub struct ClusterOutput {
    pub ski_areas: Vec<Feature<SkiAreaProperties>>,
    pub runs: Vec<Feature<RunProperties>>,
    pub lifts: Vec<Feature<LiftProperties>>,
    pub spots: Vec<Feature<SpotProperties>>,
}

// --------------------------------------------------------------------------------------
// Object model
// --------------------------------------------------------------------------------------

enum Payload {
    Run {
        properties: RunProperties,
        difficulty: Option<RunDifficulty>,
        snowmaking: Option<bool>,
        snowfarming: Option<bool>,
    },
    Lift {
        properties: LiftProperties,
        lift_type: LiftType,
        station_ids: Vec<String>,
    },
    Spot {
        properties: SpotProperties,
    },
    SkiArea {
        properties: SkiAreaProperties,
        source: SourceType,
        is_polygon: bool,
    },
}

struct Obj {
    key: String,
    alive: bool,
    geometry: Geometry,
    /// Ids of the ski areas this object belongs to.
    ski_areas: Vec<String>,
    /// Kept as a list, not a set: a run with two uses that map to the same activity counts
    /// twice in the statistics, as upstream's does.
    activities: Vec<SkiAreaActivity>,
    is_in_ski_area_polygon: bool,
    /// Recorded for completeness; upstream stores it but nothing in the pipeline reads it.
    #[allow(dead_code)]
    is_in_ski_area_site: bool,
    site_ski_areas: Vec<String>,
    is_basis_for_new_ski_area: bool,
    payload: Payload,
}

impl Obj {
    fn kind(&self) -> FeatureType {
        match self.payload {
            Payload::Run { .. } => FeatureType::Run,
            Payload::Lift { .. } => FeatureType::Lift,
            Payload::Spot { .. } => FeatureType::Spot,
            Payload::SkiArea { .. } => FeatureType::SkiArea,
        }
    }

    fn is_ski_area(&self) -> bool {
        matches!(self.payload, Payload::SkiArea { .. })
    }

    fn source(&self) -> Option<SourceType> {
        match &self.payload {
            Payload::SkiArea { source, .. } => Some(*source),
            _ => None,
        }
    }

    fn is_non_operating_lift(&self) -> bool {
        match &self.payload {
            Payload::Lift { properties, .. } => properties.status != Status::Operating,
            _ => false,
        }
    }

    fn ski_area_properties(&self) -> &SkiAreaProperties {
        match &self.payload {
            Payload::SkiArea { properties, .. } => properties,
            _ => panic!("not a ski area"),
        }
    }
}

struct IndexEntry {
    index: usize,
    envelope: AABB<[f64; 2]>,
}

impl RTreeObject for IndexEntry {
    type Envelope = AABB<[f64; 2]>;
    fn envelope(&self) -> Self::Envelope {
        self.envelope
    }
}

fn aabb(b: BBox) -> AABB<[f64; 2]> {
    AABB::from_corners([b[0], b[1]], [b[2], b[3]])
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SearchType {
    Intersects,
    Contains,
}

/// A search, as `SearchContext` in upstream. The visited set is separate because upstream
/// shares one array between a traversal's contexts.
#[derive(Clone)]
struct Context {
    id: String,
    activities: Vec<SkiAreaActivity>,
    search_type: SearchType,
    search_polygon: Option<Geometry>,
    is_fixed_search_area: bool,
    exclude_assigned: bool,
    buffer_km: Option<f64>,
}

pub struct Engine {
    objects: Vec<Obj>,
    by_key: BTreeMap<String, usize>,
    tree: RTree<IndexEntry>,
}

// --------------------------------------------------------------------------------------
// Loading (prepareSkiArea, prepareLift, prepareRun, prepareSpot)
// --------------------------------------------------------------------------------------

fn run_activities(properties: &RunProperties, is_in_site: bool) -> Vec<SkiAreaActivity> {
    if !is_in_site
        && properties.grooming == Some(RunGrooming::Backcountry)
        && properties.patrolled != Some(true)
    {
        return Vec::new();
    }
    properties
        .uses
        .iter()
        .flat_map(|use_| match use_ {
            RunUse::Downhill | RunUse::SnowPark => vec![SkiAreaActivity::Downhill],
            RunUse::Nordic => vec![SkiAreaActivity::Nordic],
            _ => Vec::new(),
        })
        .collect()
}

fn spot_activities(kind: &SpotKind) -> Vec<SkiAreaActivity> {
    match kind {
        SpotKind::LiftStation { .. } | SpotKind::Halfpipe {} => vec![SkiAreaActivity::Downhill],
        SpotKind::Crossing { .. }
        | SpotKind::AvalancheTransceiverTraining {}
        | SpotKind::AvalancheTransceiverCheckpoint {} => {
            vec![SkiAreaActivity::Downhill, SkiAreaActivity::Nordic]
        }
    }
}

impl Engine {
    pub fn load(input: ClusterInput) -> Engine {
        let mut engine = Engine {
            objects: Vec::new(),
            by_key: BTreeMap::new(),
            tree: RTree::new(),
        };

        for area in input.ski_areas {
            // Only ski areas with exactly one source can be clustered; others are skipped
            // with a log line upstream.
            if area.properties.sources.len() != 1 {
                continue;
            }
            let source = area.properties.sources[0].source_type;
            let is_polygon = matches!(
                area.geometry,
                Geometry::Polygon(_) | Geometry::MultiPolygon(_)
            );
            engine.insert(Obj {
                key: area.properties.summary.id.clone(),
                alive: true,
                geometry: area.geometry,
                ski_areas: Vec::new(),
                activities: area.properties.summary.activities.clone(),
                is_in_ski_area_polygon: false,
                is_in_ski_area_site: false,
                site_ski_areas: Vec::new(),
                is_basis_for_new_ski_area: false,
                payload: Payload::SkiArea {
                    properties: area.properties,
                    source,
                    is_polygon,
                },
            });
        }

        for lift in input.lifts {
            let mut properties = lift.properties;
            properties.ski_areas = Vec::new();
            properties.stations = Vec::new();
            properties.places = Vec::new();
            engine.insert(Obj {
                key: properties.id.clone(),
                alive: true,
                geometry: lift.geometry,
                ski_areas: lift.site_ski_areas.clone(),
                // Lift activities are the association key during clustering, not the ski
                // area's classification; a lift never grants "downhill" to its ski area.
                activities: vec![SkiAreaActivity::Downhill],
                is_in_ski_area_polygon: false,
                is_in_ski_area_site: !lift.site_ski_areas.is_empty(),
                site_ski_areas: lift.site_ski_areas,
                is_basis_for_new_ski_area: false,
                payload: Payload::Lift {
                    lift_type: properties.lift_type,
                    properties,
                    station_ids: Vec::new(),
                },
            });
        }

        for run in input.runs {
            let is_in_site = !run.site_ski_areas.is_empty();
            let activities = run_activities(&run.properties, is_in_site);
            let properties = run.properties;
            let is_basis = (properties.uses.contains(&RunUse::Downhill)
                || properties.uses.contains(&RunUse::Nordic))
                && activities.iter().any(|a| is_ski_area_activity(*a))
                && run.site_ski_areas.is_empty();
            let mut stored = properties.clone();
            stored.ski_areas = Vec::new();
            stored.places = Vec::new();
            stored.snow_cover_history = None;
            engine.insert(Obj {
                key: properties.id.clone(),
                alive: true,
                geometry: run.geometry,
                ski_areas: run.site_ski_areas.clone(),
                activities,
                is_in_ski_area_polygon: false,
                is_in_ski_area_site: is_in_site,
                site_ski_areas: run.site_ski_areas,
                is_basis_for_new_ski_area: is_basis,
                payload: Payload::Run {
                    difficulty: properties.difficulty,
                    snowmaking: properties.snowmaking,
                    snowfarming: properties.snowfarming,
                    properties: stored,
                },
            });
        }

        for spot in input.spots {
            let activities = spot_activities(&spot.properties.kind);
            engine.insert(Obj {
                key: spot.properties.base.id.clone(),
                alive: true,
                geometry: spot.geometry,
                ski_areas: spot.site_ski_areas.clone(),
                activities,
                is_in_ski_area_polygon: false,
                is_in_ski_area_site: !spot.site_ski_areas.is_empty(),
                site_ski_areas: spot.site_ski_areas,
                is_basis_for_new_ski_area: false,
                payload: Payload::Spot {
                    properties: spot.properties,
                },
            });
        }

        engine.rebuild_index();
        engine
    }

    /// Upstream upserts by key, so a later object with the same key replaces the earlier.
    fn insert(&mut self, object: Obj) {
        if let Some(&existing) = self.by_key.get(&object.key) {
            self.objects[existing] = object;
        } else {
            self.by_key.insert(object.key.clone(), self.objects.len());
            self.objects.push(object);
        }
    }

    fn rebuild_index(&mut self) {
        let entries = self
            .objects
            .iter()
            .enumerate()
            .filter(|(_, o)| o.alive && !o.is_ski_area())
            .map(|(index, o)| IndexEntry {
                index,
                envelope: aabb(spatial::bbox(&o.geometry)),
            })
            .collect();
        self.tree = RTree::bulk_load(entries);
    }

    // ----------------------------------------------------------------------------------
    // Queries
    // ----------------------------------------------------------------------------------

    /// Indexes of live ski areas matching the filters, in key order (`getSkiAreas`).
    fn ski_areas(&self, only_polygons: bool, source: Option<SourceType>) -> Vec<usize> {
        self.by_key
            .values()
            .copied()
            .filter(|&i| {
                let o = &self.objects[i];
                o.alive
                    && match &o.payload {
                        Payload::SkiArea {
                            source: s,
                            is_polygon,
                            ..
                        } => (!only_polygons || *is_polygon) && source.is_none_or(|w| w == *s),
                        _ => false,
                    }
            })
            .collect()
    }

    /// Member objects of a ski area, in key order (`getObjectsForSkiArea`).
    fn members_of(&self, ski_area_id: &str) -> Vec<usize> {
        self.by_key
            .values()
            .copied()
            .filter(|&i| {
                let o = &self.objects[i];
                o.alive && !o.is_ski_area() && o.ski_areas.iter().any(|s| s == ski_area_id)
            })
            .collect()
    }

    /// `findNearbyObjects`: objects matching a search, in key order, with the visited set
    /// updated. `sources` is the query geometry; several sources stand for their union.
    fn find_nearby(
        &self,
        sources: &[&Geometry],
        ctx: &Context,
        visited: &mut HashSet<usize>,
    ) -> Vec<usize> {
        let buffer_m = ctx.buffer_km.map(|km| km * 1000.0).unwrap_or(0.0);
        let mut candidates: HashSet<usize> = HashSet::new();
        for source in sources {
            let envelope = aabb(spatial::expand(spatial::bbox(source), buffer_m));
            for entry in self.tree.locate_in_envelope_intersecting(envelope) {
                candidates.insert(entry.index);
            }
        }

        let mut found: Vec<usize> = candidates
            .into_iter()
            .filter(|&i| {
                let o = &self.objects[i];
                if !o.alive || o.is_ski_area() || visited.contains(&i) {
                    return false;
                }
                let spatial_match = match (ctx.search_type, ctx.buffer_km) {
                    (SearchType::Intersects, Some(km)) => sources
                        .iter()
                        .any(|s| spatial::within_m(&o.geometry, s, km * 1000.0)),
                    (SearchType::Contains, None) => {
                        sources.iter().any(|s| spatial::covered_by(&o.geometry, s))
                    }
                    (SearchType::Intersects, None) => {
                        sources.iter().any(|s| spatial::intersects(&o.geometry, s))
                    }
                    (SearchType::Contains, Some(_)) => {
                        unreachable!("a buffered containment search is never issued")
                    }
                };
                if !spatial_match {
                    return false;
                }
                if !ctx.activities.is_empty()
                    && !ctx.activities.iter().any(|a| o.activities.contains(a))
                {
                    return false;
                }
                if o.ski_areas.contains(&ctx.id) {
                    return false;
                }
                if ctx.exclude_assigned && !o.ski_areas.is_empty() {
                    return false;
                }
                true
            })
            .collect();
        found.sort_by(|&a, &b| self.objects[a].key.cmp(&self.objects[b].key));
        visited.extend(found.iter().copied());
        found
    }

    /// `findNearbySkiAreas`: ski areas of a source that cover, are covered by, or lie within
    /// `km` of a geometry. Ski areas still holding the placeholder position are excluded.
    fn find_nearby_ski_areas(
        &self,
        geometry: &Geometry,
        source: SourceType,
        km: f64,
    ) -> Vec<usize> {
        self.ski_areas(false, Some(source))
            .into_iter()
            .filter(|&i| {
                let o = &self.objects[i];
                if is_placeholder(&o.geometry) {
                    return false;
                }
                spatial::covers(&o.geometry, geometry)
                    || spatial::covers(geometry, &o.geometry)
                    || spatial::within_m(&o.geometry, geometry, km * 1000.0)
            })
            .collect()
    }

    /// The geometries a ski area searches from (`getObjectDerivedSkiAreaGeometry`): its
    /// members, or its own geometry when it has none. A union's distance to anything is the
    /// minimum over its parts, so the parts stand in for the union.
    fn derived_sources(&self, ski_area: usize) -> Vec<Geometry> {
        let members = self.members_of(&self.objects[ski_area].key);
        if members.is_empty() {
            vec![self.objects[ski_area].geometry.clone()]
        } else {
            members
                .iter()
                .map(|&m| self.objects[m].geometry.clone())
                .collect()
        }
    }

    // ----------------------------------------------------------------------------------
    // The traversal (visitObject, visitPolygonGeometry, processFoundObjects)
    // ----------------------------------------------------------------------------------

    fn visit_object(
        &self,
        ctx: &Context,
        object: usize,
        visited: &mut HashSet<usize>,
    ) -> Vec<usize> {
        let o = &self.objects[object];
        let mut found = vec![object];

        let filtered: Vec<SkiAreaActivity> = ctx
            .activities
            .iter()
            .copied()
            .filter(|a| o.activities.contains(a))
            .collect();
        let object_ctx = Context {
            search_polygon: if ctx.is_fixed_search_area {
                ctx.search_polygon.clone()
            } else {
                None
            },
            activities: if filtered.is_empty() {
                ctx.activities.clone()
            } else {
                filtered
            },
            ..ctx.clone()
        };

        if let Some(area) = &ctx.search_polygon {
            let objects = self.find_nearby(&[area], &object_ctx, visited);
            found.extend(self.process_found(&object_ctx, objects, visited));
        } else {
            let buffered = Context {
                buffer_km: Some(MAX_DISTANCE_KM),
                ..object_ctx.clone()
            };
            let sources: Vec<Geometry> = if o.is_ski_area() {
                self.derived_sources(object)
            } else {
                vec![o.geometry.clone()]
            };
            let refs: Vec<&Geometry> = sources.iter().collect();
            let nearby = self.find_nearby(&refs, &buffered, visited);
            found.extend(self.process_found(&object_ctx, nearby, visited));
        }
        found
    }

    fn process_found(
        &self,
        ctx: &Context,
        objects: Vec<usize>,
        visited: &mut HashSet<usize>,
    ) -> Vec<usize> {
        if ctx.is_fixed_search_area {
            return objects;
        }
        let mut found = Vec::new();
        for object in objects {
            // Non-operating lifts join the ski area, but the search does not continue from
            // them. Otherwise e.g. a proposed interconnect lift would pull a neighbouring
            // ski area's objects into this one.
            if self.objects[object].is_non_operating_lift() {
                found.push(object);
                continue;
            }
            found.extend(self.visit_object(ctx, object, visited));
        }
        found
    }

    // ----------------------------------------------------------------------------------
    // Helpers on members
    // ----------------------------------------------------------------------------------

    /// `getActivitiesBasedOnRuns`, in the canonical activity order.
    fn activities_based_on_runs(&self, members: &[usize]) -> Vec<SkiAreaActivity> {
        let mut found = HashSet::new();
        for &m in members {
            let o = &self.objects[m];
            if o.kind() == FeatureType::Run {
                for &a in &o.activities {
                    if is_ski_area_activity(a) {
                        found.insert(a);
                    }
                }
            }
        }
        ALL_ACTIVITIES
            .iter()
            .copied()
            .filter(|a| found.contains(a))
            .collect()
    }

    fn mark_part_of_ski_area(&mut self, ski_area_id: &str, members: &[usize], in_polygon: bool) {
        for &m in members {
            let o = &mut self.objects[m];
            if !o.ski_areas.iter().any(|s| s == ski_area_id) {
                o.ski_areas.push(ski_area_id.to_owned());
            }
            o.is_in_ski_area_polygon = o.is_in_ski_area_polygon || in_polygon;
            o.is_basis_for_new_ski_area = false;
        }
    }

    fn set_ski_area_activities(&mut self, ski_area: usize, activities: Vec<SkiAreaActivity>) {
        let o = &mut self.objects[ski_area];
        o.activities = activities.clone();
        if let Payload::SkiArea { properties, .. } = &mut o.payload {
            properties.summary.activities = activities;
        }
    }

    fn remove(&mut self, index: usize) {
        self.objects[index].alive = false;
    }

    fn length_km(&self, object: usize) -> f64 {
        let o = &self.objects[object];
        let raw = turf::length_km(&o.geometry);
        if matches!(o.geometry, Geometry::Polygon(_)) {
            raw / 3.0
        } else {
            raw
        }
    }

    // ----------------------------------------------------------------------------------
    // Steps of performClustering
    // ----------------------------------------------------------------------------------

    /// `assignSkiAreaActivitiesAndGeometryBasedOnMemberObjects`: ski areas with no declared
    /// activities (OSM site relations, mostly) take them, and a position, from their members.
    fn assign_activities_and_geometry_from_members(&mut self) {
        for ski_area in self.ski_areas(false, None) {
            if !self.objects[ski_area].activities.is_empty() {
                continue;
            }
            let id = self.objects[ski_area].key.clone();
            let members = self.members_of(&id);
            if members.is_empty() {
                continue;
            }
            let activities = self.activities_based_on_runs(&members);
            let geometries: Vec<&Geometry> =
                members.iter().map(|&m| &self.objects[m].geometry).collect();
            let point = turf::ski_area_geometry(&geometries);
            let o = &mut self.objects[ski_area];
            o.activities = activities.clone();
            o.geometry = Geometry::Point(point);
            if let Payload::SkiArea {
                properties,
                is_polygon,
                ..
            } = &mut o.payload
            {
                *is_polygon = false;
                properties.summary.activities = activities;
            }
        }
    }

    /// `assignObjectsToSkiAreas`, run sequentially (the concurrent branch upstream is for
    /// passes whose result does not depend on order).
    fn assign_objects_to_ski_areas(&mut self, options: &AssignOptions) {
        for ski_area in self.ski_areas(options.only_in_polygon, Some(options.source)) {
            let Some(members) = self.process_ski_area_for_object_assignment(ski_area, options)
            else {
                continue;
            };
            let id = self.objects[ski_area].key.clone();
            self.mark_part_of_ski_area(&id, &members, options.only_in_polygon);

            if self.objects[ski_area].activities.is_empty() {
                let activities = self.activities_based_on_runs(&members);
                self.set_ski_area_activities(ski_area, activities);
            }
        }
    }

    fn process_ski_area_for_object_assignment(
        &mut self,
        ski_area: usize,
        options: &AssignOptions,
    ) -> Option<Vec<usize>> {
        let id = self.objects[ski_area].key.clone();
        let declared = self.objects[ski_area].activities.clone();
        let activities = if declared.is_empty() {
            ALL_ACTIVITIES.to_vec()
        } else {
            declared
        };

        let ctx = if options.only_in_polygon {
            let geometry = self.objects[ski_area].geometry.clone();
            assert!(
                matches!(geometry, Geometry::Polygon(_) | Geometry::MultiPolygon(_)),
                "Ski area geometry must be a polygon."
            );
            Context {
                id: id.clone(),
                activities,
                search_type: SearchType::Contains,
                search_polygon: Some(geometry),
                is_fixed_search_area: true,
                exclude_assigned: options.only_if_not_already_assigned,
                buffer_km: None,
            }
        } else {
            Context {
                id: id.clone(),
                activities,
                search_type: SearchType::Intersects,
                search_polygon: None,
                is_fixed_search_area: false,
                exclude_assigned: options.only_if_not_already_assigned,
                buffer_km: None,
            }
        };

        let mut visited = HashSet::from([ski_area]);
        let members = self.visit_object(&ctx, ski_area, &mut visited);

        let no_objects = options.remove_if_no_objects_found
            && !members.iter().any(|&m| !self.objects[m].is_ski_area());
        if no_objects {
            let geometry = self.objects[ski_area].geometry.clone();
            let nearby = self.find_nearby_ski_areas(
                &geometry,
                SourceType::SkimapOrg,
                MAX_SKI_AREA_MERGE_DISTANCE_KM,
            );
            if nearby.is_empty() {
                self.remove(ski_area);
                return None;
            }
        }

        let lifts_and_runs: Vec<usize> = members
            .iter()
            .copied()
            .filter(|&m| matches!(self.objects[m].kind(), FeatureType::Lift | FeatureType::Run))
            .collect();
        let total_length: f64 = lifts_and_runs.iter().map(|&m| self.length_km(m)).sum();

        // Coverage is measured against each site=piste relation individually, not all of
        // them combined: a polygon that duplicates one site relation should give way to it,
        // but an umbrella polygon spanning several sub-areas, each with its own relation,
        // is a duplicate of none of them and must be kept.
        let mut length_by_site: Vec<(String, f64)> = Vec::new();
        for &m in &lifts_and_runs {
            let length = self.length_km(m);
            for site in &self.objects[m].site_ski_areas {
                match length_by_site.iter_mut().find(|(s, _)| s == site) {
                    Some(entry) => entry.1 += length,
                    None => length_by_site.push((site.clone(), length)),
                }
            }
        }
        let largest = length_by_site.iter().map(|(_, l)| *l).fold(0.0, f64::max);
        if options.remove_if_substantial_number_of_objects_in_ski_area_site
            && total_length > 0.0
            && largest / total_length > 0.5
        {
            self.remove(ski_area);
            return None;
        }

        Some(members)
    }

    /// `mergeSkimapOrgWithOpenStreetMapSkiAreas`.
    fn merge_skimap_into_openstreetmap(&mut self) {
        let mut processed: HashSet<String> = HashSet::new();
        for ski_area in self.ski_areas(false, Some(SourceType::SkimapOrg)) {
            let id = self.objects[ski_area].key.clone();
            if processed.contains(&id) {
                continue;
            }
            let to_merge = self.ski_areas_to_merge_into(ski_area);
            if to_merge.is_empty() {
                continue;
            }

            // If a target already holds sources from other Skimap.org ski areas, those are
            // related and count as processed too.
            processed.insert(id.clone());
            for &target in &to_merge {
                for source in &self.objects[target].ski_area_properties().sources {
                    if source.source_type == SourceType::SkimapOrg {
                        processed.insert(source.id.clone());
                    }
                }
            }

            let skimap = self.snapshot_ski_area(ski_area);
            for &target in &to_merge {
                self.merge_into(target, &skimap);
            }
            self.remove(ski_area);
        }
    }

    fn ski_areas_to_merge_into(&self, ski_area: usize) -> Vec<usize> {
        let o = &self.objects[ski_area];
        let activities = if o.activities.is_empty() {
            ALL_ACTIVITIES.to_vec()
        } else {
            o.activities.clone()
        };
        let ctx = Context {
            id: o.key.clone(),
            activities,
            search_type: SearchType::Intersects,
            search_polygon: None,
            is_fixed_search_area: true,
            exclude_assigned: false,
            buffer_km: Some(MAX_SKI_AREA_MERGE_DISTANCE_KM),
        };
        let nearby = self.find_nearby(&[&o.geometry], &ctx, &mut HashSet::new());
        let mut other_ids: Vec<String> = Vec::new();
        for n in nearby {
            for id in &self.objects[n].ski_areas {
                if !other_ids.contains(id) {
                    other_ids.push(id.clone());
                }
            }
        }

        let mut candidates: BTreeMap<String, usize> = BTreeMap::new();
        for id in &other_ids {
            if let Some(&i) = self.by_key.get(id)
                && self.objects[i].alive
                && self.objects[i].is_ski_area()
                && self.objects[i].source() != o.source()
            {
                candidates.insert(id.clone(), i);
            }
        }
        if matches!(o.geometry, Geometry::Point(_)) {
            for i in self.find_nearby_ski_areas(
                &o.geometry,
                SourceType::Openstreetmap,
                MAX_SKI_AREA_MERGE_DISTANCE_KM,
            ) {
                if self.objects[i].source() != o.source() {
                    candidates.insert(self.objects[i].key.clone(), i);
                }
            }
        }
        candidates.into_values().collect()
    }

    fn snapshot_ski_area(&self, index: usize) -> SkiAreaSnapshot {
        let o = &self.objects[index];
        let Payload::SkiArea {
            properties,
            is_polygon,
            ..
        } = &o.payload
        else {
            panic!("not a ski area");
        };
        SkiAreaSnapshot {
            geometry: o.geometry.clone(),
            is_polygon: *is_polygon,
            activities: o.activities.clone(),
            properties: properties.clone(),
        }
    }

    /// `mergeSkiAreaObjects(target, [other])` applied to the target.
    fn merge_into(&mut self, target: usize, other: &SkiAreaSnapshot) {
        let own = self.snapshot_ski_area(target);
        let primary_placeholder = is_placeholder(&own.geometry);
        let other_placeholder = is_placeholder(&other.geometry);
        let use_other_geometry = primary_placeholder && !other_placeholder;

        let activities = unique(own.activities.iter().chain(&other.activities).copied());
        let mut properties = own.properties.clone();
        properties.summary.name = own
            .properties
            .summary
            .name
            .clone()
            .filter(|n| !n.is_empty())
            .or_else(|| other.properties.summary.name.clone());
        properties.summary.activities = unique(
            own.properties
                .summary
                .activities
                .iter()
                .chain(&other.properties.summary.activities)
                .copied(),
        );
        properties.sources = unique_sources(
            own.properties
                .sources
                .iter()
                .chain(&other.properties.sources),
        );
        properties.summary.status = own
            .properties
            .summary
            .status
            .or(other.properties.summary.status);
        properties.websites = merged_websites(&own.properties, &other.properties);
        properties.wikidata_id = own
            .properties
            .wikidata_id
            .clone()
            .filter(|w| !w.is_empty())
            .or_else(|| other.properties.wikidata_id.clone());
        properties.places = unique_places(
            own.properties
                .places
                .iter()
                .chain(&other.properties.places)
                .cloned(),
        );

        let o = &mut self.objects[target];
        if use_other_geometry {
            o.geometry = other.geometry.clone();
        }
        o.activities = activities;
        if let Payload::SkiArea {
            properties: p,
            is_polygon,
            ..
        } = &mut o.payload
        {
            *p = properties;
            if use_other_geometry {
                *is_polygon = other.is_polygon;
            }
        }
    }

    /// `generateSkiAreasForUnassignedObjects`.
    fn generate_ski_areas_for_unassigned(&mut self) {
        let mut last_processed: Option<String> = None;
        loop {
            let next = self.by_key.values().copied().find(|&i| {
                let o = &self.objects[i];
                o.alive && o.kind() == FeatureType::Run && o.is_basis_for_new_ski_area
            });
            let Some(run) = next else { break };
            let key = self.objects[run].key.clone();
            if last_processed.as_deref() == Some(key.as_str()) {
                self.objects[run].is_basis_for_new_ski_area = false;
                continue;
            }
            last_processed = Some(key);
            self.generate_ski_area_for_run(run);
        }
    }

    fn generate_ski_area_for_run(&mut self, run: usize) {
        let provisional = format!("provisional:{}", self.objects[run].key);
        let mut activities: Vec<SkiAreaActivity> = self.objects[run]
            .activities
            .iter()
            .copied()
            .filter(|a| is_ski_area_activity(*a))
            .collect();

        let ctx = Context {
            id: provisional,
            activities: activities.clone(),
            search_type: SearchType::Intersects,
            search_polygon: None,
            is_fixed_search_area: false,
            exclude_assigned: false,
            buffer_km: None,
        };
        let mut visited = HashSet::from([run]);
        let mut members = self.visit_object(&ctx, run, &mut visited);

        if activities.contains(&SkiAreaActivity::Downhill)
            && !members.iter().any(|&m| {
                self.objects[m].kind() == FeatureType::Lift
                    && !self.objects[m].is_non_operating_lift()
            })
        {
            activities.retain(|a| *a != SkiAreaActivity::Downhill);
            members.retain(|&m| {
                self.objects[m]
                    .activities
                    .iter()
                    .any(|a| *a != SkiAreaActivity::Downhill && is_ski_area_activity(*a))
            });
        }

        if activities.is_empty() || members.is_empty() {
            self.objects[run].is_basis_for_new_ski_area = false;
            return;
        }
        self.create_generated_ski_area(activities, members);
    }

    fn create_generated_ski_area(&mut self, activities: Vec<SkiAreaActivity>, members: Vec<usize>) {
        let mut sorted = members;
        sorted.sort_by(|&a, &b| self.objects[a].key.cmp(&self.objects[b].key));
        let keys: Vec<&str> = sorted
            .iter()
            .map(|&m| self.objects[m].key.as_str())
            .collect();
        let id = generated_ski_area_id(&keys);
        let geometries: Vec<&Geometry> =
            sorted.iter().map(|&m| &self.objects[m].geometry).collect();
        let point = turf::ski_area_geometry(&geometries);
        let geometry = Geometry::Point(point);

        let convention =
            openskidata_format::convention::run_difficulty_convention_at(point[0], point[1]);
        let hint =
            compute_viewport_hint(&[&[[point[0], point[1], 0.0]]]).expect("a point has a hint");
        let properties = SkiAreaProperties {
            summary: SkiAreaSummaryProperties {
                feature_type: FeatureType::SkiArea,
                id: id.clone(),
                name: None,
                activities: activities.clone(),
                status: Some(Status::Operating),
            },
            sources: Vec::new(),
            statistics: None,
            run_convention: convention,
            websites: Vec::new(),
            wikidata_id: None,
            places: Vec::new(),
            viewport_hint: hint,
        };
        self.insert(Obj {
            key: id.clone(),
            alive: true,
            geometry,
            ski_areas: vec![id.clone()],
            activities,
            is_in_ski_area_polygon: false,
            is_in_ski_area_site: false,
            site_ski_areas: Vec::new(),
            is_basis_for_new_ski_area: false,
            payload: Payload::SkiArea {
                properties,
                source: SourceType::Openstreetmap,
                is_polygon: false,
            },
        });
        self.mark_part_of_ski_area(&id, &sorted, false);
    }

    /// `LiftStationAssociator.associateStationsWithLifts`: each lift station is snapped to
    /// the closest lift within 30 m and recorded on it; stations with no lift in range are
    /// removed.
    fn associate_lift_stations(&mut self) {
        const THRESHOLD_KM: f64 = 0.03;

        let stations: Vec<usize> = self
            .by_key
            .values()
            .copied()
            .filter(|&i| {
                let o = &self.objects[i];
                o.alive
                    && matches!(
                        &o.payload,
                        Payload::Spot { properties } if matches!(properties.kind, SpotKind::LiftStation { .. })
                    )
            })
            .collect();

        let mut stations_by_lift: Vec<(usize, Vec<String>)> = Vec::new();
        let mut orphaned: Vec<usize> = Vec::new();

        for station in stations {
            let Some((lift, point)) = self.find_best_lift(station, THRESHOLD_KM) else {
                orphaned.push(station);
                continue;
            };
            let lift_key = self.objects[lift].key.clone();
            let station_key = self.objects[station].key.clone();

            // A missing station position would be inferred from its elevation against the
            // lift's, which does not exist before the elevation stage; an existing position
            // is kept as is.
            let o = &mut self.objects[station];
            o.geometry = Geometry::Point(point);
            if let Payload::Spot { properties } = &mut o.payload
                && let SpotKind::LiftStation { lift_id, .. } = &mut properties.kind
            {
                *lift_id = lift_key;
            }

            match stations_by_lift.iter_mut().find(|(l, _)| *l == lift) {
                Some((_, keys)) => keys.push(station_key),
                None => stations_by_lift.push((lift, vec![station_key])),
            }
        }

        for (lift, keys) in stations_by_lift {
            if let Payload::Lift { station_ids, .. } = &mut self.objects[lift].payload {
                *station_ids = keys;
            }
        }
        for station in orphaned {
            self.remove(station);
        }
    }

    /// `findBestLift`: the nearest lift within `threshold_km` of a station, and the point on
    /// it closest to the station. A tie goes to the lift that shares a ski area with the
    /// station.
    fn find_best_lift(&self, station: usize, threshold_km: f64) -> Option<(usize, Position)> {
        let s = &self.objects[station];
        let ctx = Context {
            id: s.key.clone(),
            activities: Vec::new(),
            search_type: SearchType::Intersects,
            search_polygon: None,
            is_fixed_search_area: true,
            exclude_assigned: false,
            buffer_km: Some(threshold_km),
        };
        let Geometry::Point(station_point) = s.geometry else {
            return None;
        };
        let candidates = self.find_nearby(&[&s.geometry], &ctx, &mut HashSet::new());

        let mut best: Option<(usize, Position, f64)> = None;
        for lift in candidates
            .into_iter()
            .filter(|&c| self.objects[c].kind() == FeatureType::Lift)
        {
            let (point, distance) =
                closest_point_on_lift(&self.objects[lift].geometry, station_point);
            if distance > threshold_km {
                continue;
            }
            match best {
                None => best = Some((lift, point, distance)),
                Some((best_lift, _, best_distance)) => {
                    if distance < best_distance {
                        best = Some((lift, point, distance));
                    } else if distance == best_distance {
                        let shares = |l: usize| {
                            self.objects[l]
                                .ski_areas
                                .iter()
                                .any(|a| s.ski_areas.contains(a))
                        };
                        if shares(lift) && !shares(best_lift) {
                            best = Some((lift, point, distance));
                        }
                    }
                }
            }
        }
        best.map(|(lift, point, _)| (lift, point))
    }

    /// `augmentSkiAreasBasedOnAssignedLiftsAndRuns`.
    fn augment_ski_areas(&mut self) {
        for ski_area in self.ski_areas(false, None) {
            let id = self.objects[ski_area].key.clone();
            let members = self.members_of(&id);
            let no_skimap_source = !self.objects[ski_area]
                .ski_area_properties()
                .sources
                .iter()
                .any(|s| s.source_type == SourceType::SkimapOrg);
            if members.is_empty() && no_skimap_source {
                self.remove(ski_area);
                continue;
            }

            let properties = self.objects[ski_area].ski_area_properties().clone();
            let non_operating_area = properties
                .summary
                .status
                .is_some_and(|s| s != Status::Operating);
            let describing: Vec<usize> = if non_operating_area {
                members.clone()
            } else {
                members
                    .iter()
                    .copied()
                    .filter(|&m| !self.objects[m].is_non_operating_lift())
                    .collect()
            };

            let statistics = stats::ski_area_statistics(
                &describing
                    .iter()
                    .map(|&m| stats::Member {
                        geometry: &self.objects[m].geometry,
                        kind: match &self.objects[m].payload {
                            Payload::Run {
                                difficulty,
                                snowmaking,
                                snowfarming,
                                ..
                            } => stats::MemberKind::Run {
                                difficulty: *difficulty,
                                activities: &self.objects[m].activities,
                                snowmaking: *snowmaking,
                                snowfarming: *snowfarming,
                            },
                            Payload::Lift { lift_type, .. } => stats::MemberKind::Lift {
                                lift_type: *lift_type,
                            },
                            _ => stats::MemberKind::Other,
                        },
                    })
                    .collect::<Vec<_>>(),
            );

            // Only runs grant an activity; Skimap.org's are a fallback for areas whose runs
            // yield none.
            let run_activities = self.activities_based_on_runs(&members);
            let activities = if run_activities.is_empty() {
                properties.summary.activities.clone()
            } else {
                run_activities
            };

            let geometry = self.objects[ski_area].geometry.clone();
            let hint_geometries: Vec<&Geometry> = if describing.is_empty() {
                vec![&geometry]
            } else {
                describing
                    .iter()
                    .map(|&m| &self.objects[m].geometry)
                    .collect()
            };
            let viewport_hint = hint_for(&hint_geometries);

            let mut updated = properties;
            updated.summary.activities = activities.clone();
            updated.statistics = Some(statistics);
            updated.run_convention = convention_for(&geometry);
            updated.viewport_hint = viewport_hint;

            let member_places: Vec<Place> =
                members.iter().flat_map(|&m| self.places_of(m)).collect();
            if !member_places.is_empty() {
                updated.places = sort_places(unique_places(member_places.into_iter()));
            }

            let o = &mut self.objects[ski_area];
            o.activities = activities;
            if let Payload::SkiArea { properties, .. } = &mut o.payload {
                *properties = updated;
            }
        }
    }

    fn places_of(&self, object: usize) -> Vec<Place> {
        match &self.objects[object].payload {
            Payload::Run { properties, .. } => properties.places.clone(),
            Payload::Lift { properties, .. } => properties.places.clone(),
            Payload::Spot { properties } => properties.base.places.clone(),
            Payload::SkiArea { properties, .. } => properties.places.clone(),
        }
    }

    /// `removeSkiAreasWithoutGeometry`.
    fn remove_ski_areas_without_geometry(&mut self) {
        for ski_area in self.ski_areas(false, Some(SourceType::Openstreetmap)) {
            if is_placeholder(&self.objects[ski_area].geometry) {
                self.remove(ski_area);
            }
        }
    }

    // ----------------------------------------------------------------------------------
    // The whole stage and the export
    // ----------------------------------------------------------------------------------

    /// `performClustering`, without the steps that need external services.
    pub fn cluster(&mut self) {
        self.assign_activities_and_geometry_from_members();
        self.assign_objects_to_ski_areas(&AssignOptions {
            source: SourceType::Openstreetmap,
            remove_if_no_objects_found: true,
            remove_if_substantial_number_of_objects_in_ski_area_site: true,
            only_in_polygon: true,
            only_if_not_already_assigned: false,
        });
        self.assign_objects_to_ski_areas(&AssignOptions {
            source: SourceType::Openstreetmap,
            remove_if_no_objects_found: false,
            remove_if_substantial_number_of_objects_in_ski_area_site: false,
            only_in_polygon: false,
            only_if_not_already_assigned: true,
        });
        self.merge_skimap_into_openstreetmap();
        self.assign_objects_to_ski_areas(&AssignOptions {
            source: SourceType::SkimapOrg,
            remove_if_no_objects_found: false,
            remove_if_substantial_number_of_objects_in_ski_area_site: false,
            only_in_polygon: false,
            only_if_not_already_assigned: true,
        });
        self.generate_ski_areas_for_unassigned();
        self.associate_lift_stations();
        self.augment_ski_areas();
        self.remove_ski_areas_without_geometry();
    }

    /// `resolveSkiAreaSummaries`: the live ski areas among `ids`, in key order.
    fn summaries(&self, ids: &[String]) -> Vec<SkiAreaSummaryFeature> {
        let mut found: Vec<usize> = ids
            .iter()
            .filter_map(|id| self.by_key.get(id).copied())
            .filter(|&i| self.objects[i].alive && self.objects[i].is_ski_area())
            .collect();
        found.sort_by(|&a, &b| self.objects[a].key.cmp(&self.objects[b].key));
        found.dedup();
        found
            .into_iter()
            .map(|i| {
                let o = &self.objects[i];
                let p = o.ski_area_properties();
                SkiAreaSummaryFeature {
                    feature_tag: FeatureTag::Feature,
                    geometry: ski_area_geometry_out(&o.geometry),
                    properties: SkiAreaSummaryProperties {
                        feature_type: FeatureType::SkiArea,
                        id: p.summary.id.clone(),
                        name: p.summary.name.clone(),
                        activities: p.summary.activities.clone(),
                        status: p.summary.status,
                    },
                }
            })
            .collect()
    }

    pub fn export(&self) -> Result<ClusterOutput> {
        let mut out = ClusterOutput::default();
        for &i in self.by_key.values() {
            let o = &self.objects[i];
            if !o.alive {
                continue;
            }
            match &o.payload {
                Payload::SkiArea { properties, .. } => out.ski_areas.push(Feature {
                    geometry: o.geometry.clone(),
                    properties: properties.clone(),
                }),
                Payload::Run { properties, .. } => {
                    let mut properties = properties.clone();
                    properties.ski_areas = self.summaries(&o.ski_areas);
                    out.runs.push(Feature {
                        geometry: o.geometry.clone(),
                        properties,
                    });
                }
                Payload::Lift {
                    properties,
                    station_ids,
                    ..
                } => {
                    let mut properties = properties.clone();
                    properties.ski_areas = self.summaries(&o.ski_areas);
                    properties.stations = station_ids
                        .iter()
                        .filter_map(|id| self.by_key.get(id))
                        .filter(|&&i| self.objects[i].alive)
                        .filter_map(|&i| {
                            let station = &self.objects[i];
                            let Payload::Spot { properties } = &station.payload else {
                                return None;
                            };
                            let Geometry::Point(p) = station.geometry else {
                                return None;
                            };
                            Some(LiftStationSpotFeature {
                                feature_tag: FeatureTag::Feature,
                                geometry: SpotGeometry {
                                    geometry_type: PointTag::Point,
                                    coordinates: vec![p[0], p[1]],
                                },
                                properties: properties.clone(),
                            })
                        })
                        .collect();
                    out.lifts.push(Feature {
                        geometry: o.geometry.clone(),
                        properties,
                    });
                }
                Payload::Spot { properties } => {
                    let mut properties = properties.clone();
                    properties.base.ski_areas = self.summaries(&o.ski_areas);
                    out.spots.push(Feature {
                        geometry: o.geometry.clone(),
                        properties,
                    });
                }
            }
        }
        if out
            .ski_areas
            .iter()
            .any(|a| a.properties.summary.id.is_empty())
        {
            bail!("a ski area has no id");
        }
        Ok(out)
    }
}

struct AssignOptions {
    source: SourceType,
    remove_if_no_objects_found: bool,
    remove_if_substantial_number_of_objects_in_ski_area_site: bool,
    only_in_polygon: bool,
    only_if_not_already_assigned: bool,
}

struct SkiAreaSnapshot {
    geometry: Geometry,
    is_polygon: bool,
    activities: Vec<SkiAreaActivity>,
    properties: SkiAreaProperties,
}

// --------------------------------------------------------------------------------------
// Small helpers
// --------------------------------------------------------------------------------------

/// `findClosestPointOnLift`.
fn closest_point_on_lift(lift: &Geometry, station: Position) -> (Position, f64) {
    match lift {
        Geometry::LineString(line) => turf::nearest_point_on_line(line, station),
        Geometry::MultiLineString(lines) => {
            let mut best = ([f64::NAN, f64::NAN], f64::INFINITY);
            for line in lines {
                let (point, distance) = turf::nearest_point_on_line(line, station);
                if distance < best.1 {
                    best = (point, distance);
                }
            }
            best
        }
        other => panic!("a lift cannot have geometry {other:?}"),
    }
}

fn is_placeholder(geometry: &Geometry) -> bool {
    matches!(geometry, Geometry::Point(p) if p[0] == 360.0 && p[1] == 360.0)
}

fn unique<T: Copy + Eq + std::hash::Hash>(items: impl Iterator<Item = T>) -> Vec<T> {
    let mut seen = HashSet::new();
    items.filter(|i| seen.insert(*i)).collect()
}

fn unique_sources<'a>(sources: impl Iterator<Item = &'a Source>) -> Vec<Source> {
    let mut seen = HashSet::new();
    sources
        .filter(|s| seen.insert((s.source_type, s.id.clone())))
        .cloned()
        .collect()
}

fn unique_places(places: impl Iterator<Item = Place>) -> Vec<Place> {
    let mut seen = HashSet::new();
    places
        .filter(|p| {
            seen.insert((
                p.iso3166_1_alpha2.clone(),
                p.iso3166_2.clone(),
                p.localized.en.locality.clone(),
            ))
        })
        .collect()
}

/// `sortPlaces`: by locality, then region, then country, with missing values last.
fn sort_places(mut places: Vec<Place>) -> Vec<Place> {
    fn compare(a: &Option<String>, b: &Option<String>) -> std::cmp::Ordering {
        match (a, b) {
            (None, None) => std::cmp::Ordering::Equal,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (Some(_), None) => std::cmp::Ordering::Less,
            (Some(x), Some(y)) => x.cmp(y),
        }
    }
    places.sort_by(|a, b| {
        compare(&a.localized.en.locality, &b.localized.en.locality)
            .then_with(|| compare(&a.localized.en.region, &b.localized.en.region))
            .then_with(|| a.localized.en.country.cmp(&b.localized.en.country))
    });
    places
}

/// `mergedWebsites`: prefer the websites of OpenStreetMap-only ski areas, since the two
/// sources' URLs usually differ slightly and cannot be de-duplicated.
fn merged_websites(a: &SkiAreaProperties, b: &SkiAreaProperties) -> Vec<String> {
    let osm_only: Vec<&SkiAreaProperties> = [a, b]
        .into_iter()
        .filter(|s| {
            s.sources
                .iter()
                .all(|src| src.source_type == SourceType::Openstreetmap)
                && !s.websites.is_empty()
        })
        .collect();
    let chosen: Vec<&SkiAreaProperties> = if osm_only.is_empty() {
        vec![a, b]
    } else {
        osm_only
    };
    let mut seen = HashSet::new();
    chosen
        .into_iter()
        .flat_map(|s| s.websites.iter())
        .filter(|w| seen.insert((*w).clone()))
        .cloned()
        .collect()
}

fn ski_area_geometry_out(geometry: &Geometry) -> SkiAreaGeometry {
    let pair = |p: &Position| vec![p[0], p[1]];
    match geometry {
        Geometry::Point(p) => SkiAreaGeometry::Point {
            coordinates: pair(p),
        },
        Geometry::Polygon(rings) => SkiAreaGeometry::Polygon {
            coordinates: rings.iter().map(|r| r.iter().map(pair).collect()).collect(),
        },
        Geometry::MultiPolygon(polygons) => SkiAreaGeometry::MultiPolygon {
            coordinates: polygons
                .iter()
                .map(|rings| rings.iter().map(|r| r.iter().map(pair).collect()).collect())
                .collect(),
        },
        other => panic!("a ski area cannot have geometry {other:?}"),
    }
}

fn convention_for(geometry: &Geometry) -> openskidata_format::RunDifficultyConvention {
    openskidata_format::convention::run_difficulty_convention_for_positions(
        turf::positions(geometry).into_iter().map(|p| (p[0], p[1])),
    )
    .expect("a geometry has positions")
}

fn hint_for(geometries: &[&Geometry]) -> ViewportHint {
    let sequences: Vec<Vec<[f64; 3]>> = geometries.iter().flat_map(|g| sequences_of(g)).collect();
    let refs: Vec<&[[f64; 3]]> = sequences.iter().map(Vec::as_slice).collect();
    compute_viewport_hint(&refs).expect("members have positions")
}

fn sequences_of(geometry: &Geometry) -> Vec<Vec<[f64; 3]>> {
    let line = |l: &[Position]| -> Vec<[f64; 3]> { l.iter().map(|p| [p[0], p[1], 0.0]).collect() };
    match geometry {
        Geometry::Point(p) => vec![vec![[p[0], p[1], 0.0]]],
        Geometry::LineString(l) => vec![line(l)],
        Geometry::MultiLineString(lines) => lines.iter().map(|l| line(l)).collect(),
        Geometry::Polygon(rings) => rings.iter().map(|r| line(r)).collect(),
        Geometry::MultiPolygon(polygons) => polygons
            .iter()
            .flat_map(|rings| rings.iter().map(|r| line(r)))
            .collect(),
    }
}

/// `generatedSkiAreaID`: an RFC 4122 version 5 UUID of the sorted member keys.
pub fn generated_ski_area_id(member_keys: &[&str]) -> String {
    assert!(
        !member_keys.is_empty(),
        "Cannot derive a ski area ID from an empty member set"
    );
    const NAMESPACE: &str = "4f1a3c7e9b2d4e8a8f5c1d6b0a2e7c94";
    let mut sorted: Vec<&str> = member_keys.to_vec();
    sorted.sort_unstable();

    let mut hash = Sha1::new();
    let namespace: Vec<u8> = (0..NAMESPACE.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&NAMESPACE[i..i + 2], 16).expect("hex"))
        .collect();
    hash.update(&namespace);
    hash.update(sorted.join("\n").as_bytes());
    let mut bytes = hash.finalize();
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes[..16].iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// Runs the whole stage on typed input.
pub fn cluster(input: ClusterInput) -> Result<ClusterOutput> {
    let mut engine = Engine::load(input);
    engine.cluster();
    engine.export()
}
