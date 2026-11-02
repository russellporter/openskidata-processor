//! The formatting stage: OSM features to typed ski areas, runs, lifts and spots.
//!
//! Replaces the front half of `PrepareGeoJSON.prepare`: `formatSkiArea`, `formatRun`,
//! `formatLift`, `formatSpots`, `SkiAreaSiteProvider`/`addSkiAreaSites`, and the run
//! normalization that follows `formatRun`.
//!
//! Production runs five separate extracts through the OSM converter -- runs, lifts, ski
//! areas, ski-area sites and spots -- so this takes one feature list per role rather than
//! one mixed list. What each role accepts is decided by its formatter, not by the extract:
//! a run extract can contain points, which are dropped here.
//!
//! # Scope
//!
//! Output is intermediate: the elevation, geocoding, snow cover and clustering stages have
//! not run, so `skiAreas`, `places` and `elevationProfile` are empty, and viewport hints are
//! the 2D placeholders that later stages overwrite. Runs, lifts and spots carry the ids of
//! the site ski areas they belong to; clustering resets the embedded `skiAreas` anyway.

use anyhow::Result;
use openskidata_format::ski_area::{
    SkiAreaGeometry, SkiAreaProperties, SkiAreaSummaryFeature, SkiAreaSummaryProperties,
};
use openskidata_format::spot::{FeatureTag, SpotBaseProperties, SpotProperties};
use openskidata_format::viewport_hint::{Position3, ViewportHint, compute_viewport_hint};
use openskidata_format::{
    FeatureType, RunDifficultyConvention, SkiAreaActivity, SourceType, Status,
    convention::run_difficulty_convention_for_positions, lift::LiftProperties, run::RunProperties,
    source::Source,
};
use osd_normalize::normalize::{RunInput, RunOutput, line_viewport_hint, normalize_runs};
use osd_normalize::topology::InputGeometry;
use osd_osm::element::{Feature, Geometry, MemberType, Position, Relation};
use osd_osm::validity::is_valid;
use osd_store::FixedCoord;
use osd_store::feature_id::feature_id;
use osd_tags::lift::{LiftTagProperties, lift_properties};
use osd_tags::run::{RunTagProperties, run_properties};
use osd_tags::site::{SiteMember, SiteProvider};
use osd_tags::ski_area::{
    SkimapInput, landuse as landuse_properties, placeholder_site_geometry, skimap,
};
use osd_tags::spot::spots;

/// `FeatureBuilder.DEFERRED_FEATURE_ID`.
pub const DEFERRED_FEATURE_ID: &str = "__deferred_feature_id__";

/// A ski area from Skimap.org, as it arrives in the input GeoJSON.
#[derive(Debug, Clone)]
pub struct SkimapSkiArea {
    pub id: String,
    pub name: Option<String>,
    pub status: Option<Status>,
    pub activities: Vec<SkiAreaActivity>,
    pub official_website: Option<String>,
    pub coordinates: [f64; 2],
}

/// One feature list per extract.
#[derive(Debug, Default)]
pub struct FormatInput {
    pub runs: Vec<Feature>,
    pub lifts: Vec<Feature>,
    pub ski_areas: Vec<Feature>,
    pub sites: Vec<Relation>,
    pub spots: Vec<Feature>,
    pub skimap: Vec<SkimapSkiArea>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SkiAreaOut {
    pub geometry: SkiAreaGeometry,
    pub properties: SkiAreaProperties,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RunOut {
    pub geometry: InputGeometry,
    pub properties: RunProperties,
    /// Ids of the site ski areas this run belongs to.
    pub site_ski_areas: Vec<String>,
    /// For a polygon, per ring and position, the identity of the coordinate array upstream
    /// holds there; see [`RunOutput::point_objects`].
    pub point_objects: Vec<Vec<u32>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LiftOut {
    pub geometry: Geometry,
    pub properties: LiftProperties,
    pub site_ski_areas: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpotOut {
    pub coordinates: Position,
    pub properties: SpotProperties,
    pub site_ski_areas: Vec<String>,
}

#[derive(Debug, Default)]
pub struct Formatted {
    pub ski_areas: Vec<SkiAreaOut>,
    pub runs: Vec<RunOut>,
    pub lifts: Vec<LiftOut>,
    pub spots: Vec<SpotOut>,
}

// --------------------------------------------------------------------------------------
// Geometry helpers
// --------------------------------------------------------------------------------------

fn three(position: Position) -> Position3 {
    [position[0], position[1], 0.0]
}

/// The connected sequences of a geometry, with elevation 0, for the viewport hint.
fn sequences(geometry: &Geometry) -> Vec<Vec<Position3>> {
    let line = |positions: &[Position]| positions.iter().copied().map(three).collect();
    match geometry {
        Geometry::Point(p) => vec![vec![three(*p)]],
        Geometry::LineString(l) => vec![line(l)],
        Geometry::MultiLineString(lines) => lines.iter().map(|l| line(l)).collect(),
        Geometry::Polygon(rings) => rings.iter().map(|r| line(r)).collect(),
        Geometry::MultiPolygon(polygons) => polygons
            .iter()
            .flat_map(|rings| rings.iter().map(|r| line(r)))
            .collect(),
    }
}

fn viewport_hint(geometry: &Geometry) -> ViewportHint {
    let parts = sequences(geometry);
    let refs: Vec<&[Position3]> = parts.iter().map(Vec::as_slice).collect();
    compute_viewport_hint(&refs).expect("a valid geometry has positions")
}

fn positions(geometry: &Geometry) -> Vec<Position> {
    match geometry {
        Geometry::Point(p) => vec![*p],
        Geometry::LineString(l) => l.clone(),
        Geometry::MultiLineString(lines) => lines.iter().flatten().copied().collect(),
        Geometry::Polygon(rings) => rings.iter().flatten().copied().collect(),
        Geometry::MultiPolygon(polygons) => polygons.iter().flatten().flatten().copied().collect(),
    }
}

/// `getRunDifficultyConvention(feature)`: the convention at a point, or at the centre of an
/// area's bounding box.
fn convention(geometry: &Geometry) -> RunDifficultyConvention {
    run_difficulty_convention_for_positions(positions(geometry).into_iter().map(|p| (p[0], p[1])))
        .expect("a geometry has positions")
}

/// turf's `centroid`: the mean of all vertices, not counting a polygon ring's closing one.
fn centroid(geometry: &Geometry) -> Position {
    let mut points: Vec<Position> = Vec::new();
    match geometry {
        Geometry::Point(p) => points.push(*p),
        Geometry::LineString(l) => points.extend(l),
        Geometry::MultiLineString(lines) => points.extend(lines.iter().flatten()),
        Geometry::Polygon(rings) => {
            for ring in rings {
                points.extend(&ring[..ring.len() - 1]);
            }
        }
        Geometry::MultiPolygon(polygons) => {
            for ring in polygons.iter().flatten() {
                points.extend(&ring[..ring.len() - 1]);
            }
        }
    }
    let (mut x, mut y) = (0.0, 0.0);
    for p in &points {
        x += p[0];
        y += p[1];
    }
    let n = points.len() as f64;
    [x / n, y / n]
}

fn geometry_type_name(geometry: &Geometry) -> &'static str {
    match geometry {
        Geometry::Point(_) => "Point",
        Geometry::LineString(_) => "LineString",
        Geometry::MultiLineString(_) => "MultiLineString",
        Geometry::Polygon(_) => "Polygon",
        Geometry::MultiPolygon(_) => "MultiPolygon",
    }
}

/// `featureID(geometry, type)` for an `f64` geometry with no shared coordinate arrays.
fn id_of(feature_type: &str, geometry: &Geometry) -> String {
    let position = |p: &Position| vec![p[0], p[1]];
    feature_id(
        feature_type,
        geometry_type_name(geometry),
        |w| match geometry {
            Geometry::Point(p) => w.position(&position(p)),
            Geometry::LineString(line) => {
                w.array(line.len());
                for p in line {
                    w.position(&position(p));
                }
            }
            Geometry::MultiLineString(lines) => {
                w.array(lines.len());
                for line in lines {
                    w.array(line.len());
                    for p in line {
                        w.position(&position(p));
                    }
                }
            }
            Geometry::Polygon(rings) => {
                w.array(rings.len());
                for ring in rings {
                    w.array(ring.len());
                    for p in ring {
                        w.position(&position(p));
                    }
                }
            }
            Geometry::MultiPolygon(polygons) => {
                w.array(polygons.len());
                for rings in polygons {
                    w.array(rings.len());
                    for ring in rings {
                        w.array(ring.len());
                        for p in ring {
                            w.position(&position(p));
                        }
                    }
                }
            }
        },
    )
}

fn ski_area_geometry(geometry: &Geometry) -> Option<SkiAreaGeometry> {
    let pair = |p: &Position| vec![p[0], p[1]];
    match geometry {
        Geometry::Point(p) => Some(SkiAreaGeometry::Point {
            coordinates: pair(p),
        }),
        Geometry::Polygon(rings) => Some(SkiAreaGeometry::Polygon {
            coordinates: rings.iter().map(|r| r.iter().map(pair).collect()).collect(),
        }),
        Geometry::MultiPolygon(polygons) => Some(SkiAreaGeometry::MultiPolygon {
            coordinates: polygons
                .iter()
                .map(|rings| rings.iter().map(|r| r.iter().map(pair).collect()).collect())
                .collect(),
        }),
        _ => None,
    }
}

// --------------------------------------------------------------------------------------
// Ski areas
// --------------------------------------------------------------------------------------

fn ski_area_out(
    id: String,
    tag_properties: osd_tags::ski_area::SkiAreaTagProperties,
    convention: RunDifficultyConvention,
    hint: ViewportHint,
    geometry: SkiAreaGeometry,
) -> SkiAreaOut {
    SkiAreaOut {
        geometry,
        properties: SkiAreaProperties {
            summary: SkiAreaSummaryProperties {
                feature_type: FeatureType::SkiArea,
                id,
                name: tag_properties.name,
                activities: tag_properties.activities,
                status: tag_properties.status,
            },
            sources: tag_properties.sources,
            statistics: None,
            run_convention: convention,
            websites: tag_properties.websites,
            wikidata_id: tag_properties.wikidata_id,
            places: Vec::new(),
            viewport_hint: hint,
        },
    }
}

/// The site ski areas, in the order the relations were given, plus the lookup by member.
struct Sites {
    provider: SiteProvider,
    ski_areas: Vec<SkiAreaOut>,
    /// The embedded summary of each accepted site, by relation id. Runs carry these through
    /// normalization because upstream compares them when deciding whether two arcs belong to
    /// the same group of runs.
    summaries_by_relation: std::collections::HashMap<i64, SkiAreaSummaryFeature>,
}

impl Sites {
    fn load(relations: &[Relation]) -> Sites {
        let mut provider = SiteProvider::default();
        let mut ski_areas = Vec::new();
        let mut summaries_by_relation = std::collections::HashMap::new();
        for relation in relations {
            let (Some(tags), members) =
                (&relation.tags, relation.members.as_deref().unwrap_or(&[]))
            else {
                continue;
            };
            let members: Vec<SiteMember> = members
                .iter()
                .map(|m| SiteMember {
                    osm_type: match m.member_type {
                        MemberType::Node => "node",
                        MemberType::Way => "way",
                        MemberType::Relation => "relation",
                        MemberType::Other => "other",
                    }
                    .to_owned(),
                    reference: m.reference,
                })
                .collect();
            if provider.add("relation", relation.id, tags, &members) {
                let site = provider.all().last().expect("just added");
                let placeholder = placeholder_site_geometry(relation.id);
                let id = feature_id("skiArea", "Point", |w| w.position(&placeholder));
                let site_properties = site.properties.clone();
                let hint = compute_viewport_hint(&[&[placeholder]]).expect("one position");
                let out = ski_area_out(
                    id,
                    site_properties,
                    osd_tags::ski_area::SITE_PLACEHOLDER_CONVENTION,
                    hint,
                    SkiAreaGeometry::Point {
                        coordinates: placeholder.to_vec(),
                    },
                );
                summaries_by_relation.insert(
                    relation.id,
                    SkiAreaSummaryFeature {
                        feature_tag: FeatureTag::Feature,
                        geometry: out.geometry.clone(),
                        properties: out.properties.summary.clone(),
                    },
                );
                ski_areas.push(out);
            }
        }
        Sites {
            provider,
            ski_areas,
            summaries_by_relation,
        }
    }

    /// `addSkiAreaSites`: the sites of every OpenStreetMap source, in source order.
    fn for_sources(&self, sources: &[Source]) -> Vec<SkiAreaSummaryFeature> {
        self.provider
            .sites_for_sources(sources)
            .into_iter()
            .map(|site| self.summaries_by_relation[&site.relation_id].clone())
            .collect()
    }
}

// --------------------------------------------------------------------------------------
// Runs
// --------------------------------------------------------------------------------------

fn run_properties_full(
    tags: RunTagProperties,
    hint: ViewportHint,
    ski_areas: Vec<SkiAreaSummaryFeature>,
) -> RunProperties {
    RunProperties {
        feature_type: FeatureType::Run,
        uses: tags.uses,
        id: DEFERRED_FEATURE_ID.to_owned(),
        name: tags.name,
        reference: tags.reference,
        status: tags.status,
        description: tags.description,
        difficulty: tags.difficulty,
        difficulty_convention: tags.difficulty_convention,
        oneway: tags.oneway,
        lit: tags.lit,
        gladed: tags.gladed,
        patrolled: tags.patrolled,
        snowmaking: tags.snowmaking,
        snowfarming: tags.snowfarming,
        tunnel: tags.tunnel,
        grooming: tags.grooming,
        ski_areas,
        elevation_profile: None,
        sources: tags.sources,
        websites: tags.websites,
        wikidata_id: tags.wikidata_id,
        places: Vec::new(),
        snow_cover_history: None,
        viewport_hint: hint,
    }
}

fn to_fixed(position: &Position) -> Option<FixedCoord> {
    FixedCoord::from_degrees(position[0], position[1]).ok()
}

fn fixed_line(line: &[Position]) -> Option<Vec<FixedCoord>> {
    line.iter().map(to_fixed).collect()
}

/// `formatRun`: zero or more runs from one feature. Multi-geometries are split into one run
/// per part, each carrying the properties (and hint) of the whole.
fn format_run(feature: &Feature, sites: &Sites) -> Option<Vec<(InputGeometry, RunProperties)>> {
    if matches!(feature.geometry, Geometry::Point(_)) || !is_valid(&feature.geometry) {
        return Some(Vec::new());
    }
    let convention = convention(&feature.geometry);
    let tags = run_properties(
        &feature.tags,
        feature.osm_type.as_str(),
        feature.id,
        convention,
    )?;
    let hint = viewport_hint(&feature.geometry);
    let summaries = sites.for_sources(&tags.sources);
    let properties = run_properties_full(tags, hint, summaries);

    let geometries: Vec<InputGeometry> = match &feature.geometry {
        Geometry::LineString(line) => vec![InputGeometry::Line(fixed_line(line)?)],
        Geometry::MultiLineString(lines) => lines
            .iter()
            .map(|l| fixed_line(l).map(InputGeometry::Line))
            .collect::<Option<_>>()?,
        Geometry::Polygon(rings) => vec![InputGeometry::Polygon(
            rings.iter().map(|r| fixed_line(r)).collect::<Option<_>>()?,
        )],
        Geometry::MultiPolygon(polygons) => polygons
            .iter()
            .map(|rings| {
                rings
                    .iter()
                    .map(|r| fixed_line(r))
                    .collect::<Option<Vec<_>>>()
                    .map(InputGeometry::Polygon)
            })
            .collect::<Option<_>>()?,
        Geometry::Point(_) => unreachable!("filtered above"),
    };
    Some(
        geometries
            .into_iter()
            .map(|g| (g, properties.clone()))
            .collect(),
    )
}

// --------------------------------------------------------------------------------------
// The stage
// --------------------------------------------------------------------------------------

/// Formats every role.
pub fn format_all(input: &FormatInput) -> Result<Formatted> {
    let sites = Sites::load(&input.sites);
    let mut out = Formatted::default();

    // Ski areas: landuse polygons, then sites, then Skimap.org.
    for feature in &input.ski_areas {
        let Some(geometry) = ski_area_geometry(&feature.geometry) else {
            continue;
        };
        if matches!(feature.geometry, Geometry::Point(_)) || !is_valid(&feature.geometry) {
            continue;
        }
        let Some(tag_properties) = landuse_properties(
            feature.osm_type.as_str(),
            feature.id,
            &feature.tags,
            geometry_kind(&feature.geometry),
        ) else {
            continue;
        };
        out.ski_areas.push(ski_area_out(
            id_of("skiArea", &feature.geometry),
            tag_properties,
            convention(&feature.geometry),
            viewport_hint(&feature.geometry),
            geometry,
        ));
    }
    out.ski_areas.extend(sites.ski_areas.iter().cloned());
    for area in &input.skimap {
        let point = Geometry::Point(area.coordinates);
        let tag_properties = skimap(SkimapInput {
            id: &area.id,
            name: area.name.as_deref(),
            status: area.status,
            activities: &area.activities,
            official_website: area.official_website.as_deref(),
        });
        out.ski_areas.push(ski_area_out(
            id_of("skiArea", &point),
            tag_properties,
            convention(&point),
            viewport_hint(&point),
            SkiAreaGeometry::Point {
                coordinates: area.coordinates.to_vec(),
            },
        ));
    }

    // Runs, normalized as one topology.
    let mut inputs: Vec<RunInput> = Vec::new();
    for feature in &input.runs {
        let Some(parts) = format_run(feature, &sites) else {
            continue;
        };
        for (geometry, properties) in parts {
            inputs.push(RunInput {
                geometry,
                properties,
            });
        }
    }
    let normalized = normalize_runs(&inputs, &line_viewport_hint)?;
    for output in normalized {
        out.runs.push(run_out(output));
    }

    // Lifts.
    for feature in &input.lifts {
        if !matches!(
            feature.geometry,
            Geometry::LineString(_) | Geometry::MultiLineString(_)
        ) || !is_valid(&feature.geometry)
        {
            continue;
        }
        let Some(tags) = lift_properties(&feature.tags, feature.osm_type.as_str(), feature.id)
        else {
            continue;
        };
        let site_ids = ids(sites.for_sources(&tags.sources));
        out.lifts.push(LiftOut {
            properties: lift_properties_full(
                tags,
                id_of("lift", &feature.geometry),
                viewport_hint(&feature.geometry),
            ),
            geometry: feature.geometry.clone(),
            site_ski_areas: site_ids,
        });
    }

    // Spots.
    for feature in &input.spots {
        let point = centroid(&feature.geometry);
        let geometry = Geometry::Point(point);
        let hint = viewport_hint(&geometry);
        let sources = vec![Source {
            source_type: SourceType::Openstreetmap,
            id: feature.osm_id(),
        }];
        let site_ids = ids(sites.for_sources(&sources));
        for kind in spots(&feature.tags) {
            out.spots.push(SpotOut {
                coordinates: point,
                properties: SpotProperties {
                    base: SpotBaseProperties {
                        feature_type: FeatureType::Spot,
                        id: id_of("spot", &geometry),
                        ski_areas: Vec::new(),
                        sources: sources.clone(),
                        places: Vec::new(),
                        viewport_hint: hint,
                    },
                    kind,
                },
                site_ski_areas: site_ids.clone(),
            });
        }
    }
    Ok(out)
}

fn ids(summaries: Vec<SkiAreaSummaryFeature>) -> Vec<String> {
    summaries.into_iter().map(|s| s.properties.id).collect()
}

fn geometry_kind(geometry: &Geometry) -> osd_store::GeometryKind {
    match geometry {
        Geometry::Point(_) => osd_store::GeometryKind::Point,
        Geometry::LineString(_) => osd_store::GeometryKind::LineString,
        Geometry::MultiLineString(_) => osd_store::GeometryKind::MultiLineString,
        Geometry::Polygon(_) => osd_store::GeometryKind::Polygon,
        Geometry::MultiPolygon(_) => osd_store::GeometryKind::MultiPolygon,
    }
}

fn run_out(output: RunOutput) -> RunOut {
    let id = output.feature_id();
    let mut properties = output.properties;
    // The merged embedded summaries are the run's site ski areas; clustering replaces the
    // field, so it is emptied here and the ids kept.
    let site_ski_areas = properties
        .ski_areas
        .drain(..)
        .map(|summary| summary.properties.id)
        .collect();
    properties.id = id;
    RunOut {
        geometry: output.geometry,
        properties,
        site_ski_areas,
        point_objects: output.point_objects,
    }
}

fn lift_properties_full(tags: LiftTagProperties, id: String, hint: ViewportHint) -> LiftProperties {
    LiftProperties {
        feature_type: FeatureType::Lift,
        id,
        lift_type: tags.lift_type,
        status: tags.status,
        access: tags.access,
        name: tags.name,
        reference: tags.reference,
        ref_fr_cairn: tags.ref_fr_cairn,
        description: tags.description,
        oneway: tags.oneway,
        occupancy: tags.occupancy,
        capacity: tags.capacity,
        duration: tags.duration,
        detachable: tags.detachable,
        bubble: tags.bubble,
        heating: tags.heating,
        tunnel: tags.tunnel,
        stations: Vec::new(),
        ski_areas: Vec::new(),
        sources: tags.sources,
        websites: tags.websites,
        wikidata_id: tags.wikidata_id,
        places: Vec::new(),
        viewport_hint: hint,
    }
}

// --------------------------------------------------------------------------------------
// Hand-off to clustering
// --------------------------------------------------------------------------------------

fn geometry_of_ski_area(geometry: &SkiAreaGeometry) -> Geometry {
    let pair = |c: &Vec<f64>| [c[0], c[1]];
    match geometry {
        SkiAreaGeometry::Point { coordinates } => Geometry::Point(pair(coordinates)),
        SkiAreaGeometry::Polygon { coordinates } => Geometry::Polygon(
            coordinates
                .iter()
                .map(|ring| ring.iter().map(pair).collect())
                .collect(),
        ),
        SkiAreaGeometry::MultiPolygon { coordinates } => Geometry::MultiPolygon(
            coordinates
                .iter()
                .map(|rings| {
                    rings
                        .iter()
                        .map(|ring| ring.iter().map(pair).collect())
                        .collect()
                })
                .collect(),
        ),
    }
}

fn geometry_of_run(geometry: &InputGeometry) -> Geometry {
    let pair = |c: &FixedCoord| [c.lng_degrees(), c.lat_degrees()];
    match geometry {
        InputGeometry::Line(points) => Geometry::LineString(points.iter().map(pair).collect()),
        InputGeometry::Polygon(rings) => Geometry::Polygon(
            rings
                .iter()
                .map(|ring| ring.iter().map(pair).collect())
                .collect(),
        ),
    }
}

impl Formatted {
    /// The formatted features as input to the clustering stage.
    pub fn into_cluster_input(self) -> osd_cluster::engine::ClusterInput {
        use osd_cluster::engine::{ClusterInput, LiftIn, RunIn, SkiAreaIn, SpotIn};
        ClusterInput {
            ski_areas: self
                .ski_areas
                .into_iter()
                .map(|a| SkiAreaIn {
                    geometry: geometry_of_ski_area(&a.geometry),
                    properties: a.properties,
                })
                .collect(),
            lifts: self
                .lifts
                .into_iter()
                .map(|l| LiftIn {
                    geometry: l.geometry,
                    properties: l.properties,
                    site_ski_areas: l.site_ski_areas,
                })
                .collect(),
            runs: self
                .runs
                .into_iter()
                .map(|r| RunIn {
                    geometry: geometry_of_run(&r.geometry),
                    properties: r.properties,
                    site_ski_areas: r.site_ski_areas,
                })
                .collect(),
            spots: self
                .spots
                .into_iter()
                .map(|s| SpotIn {
                    geometry: Geometry::Point(s.coordinates),
                    properties: s.properties,
                    site_ski_areas: s.site_ski_areas,
                })
                .collect(),
        }
    }
}
