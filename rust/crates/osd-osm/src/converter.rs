//! Converting OSM elements to geometry.
//!
//! Replaces `OverpassToGeoJSONConverter` in `src/io/OSMToGeoJSONConverter.ts`, which itself
//! replaced the `osmtogeojson` package with a purpose-built version. Rules:
//!
//! - **Nodes** become points when they are tagged, are a relation member, or are not part of
//!   any way.
//! - **Ways** become linestrings, or polygons when closed and tagged as an area.
//! - **`type=multipolygon` and `type=boundary` relations** become polygons or multipolygons
//!   assembled from their member ways.
//! - **`type=route` and `type=waterway` relations** become linestrings or multilinestrings
//!   assembled from their member ways.
//! - **Other relations** carry no geometry and are dropped.
//!
//! Features are emitted relations first, then polygon ways, then line ways, then points in
//! ascending node id. Downstream normalization is order-sensitive, so the order is part of
//! the contract.
//!
//! The conversion deliberately emits every element that carries geometry, including ways
//! that are members of a relation and untagged member ways. De-duplicating an object tagged
//! both on a relation and on its members is left to the later merging of overlapping runs
//! and ski areas, which can combine the two into better data than either alone.

use crate::element::{
    Element, Feature, Geometry, Member, MemberType, Node, OsmType, Position, Relation, Tags, Way,
};
use crate::geometry::{join_ways, point_in_polygon, rewind_polygon};
use crate::node_store::NodeStore;
use crate::polygon_features::is_polygon_feature;
use std::collections::HashMap;

/// A member way with the nodes missing from the extract removed.
struct WayMember {
    role: Option<String>,
    nodes: Vec<i64>,
}

#[derive(Debug, Default)]
pub struct Converter {
    nodes: NodeStore,
    node_tags: HashMap<i64, Tags>,
    ways: Vec<Way>,
    ways_by_id: HashMap<i64, usize>,
    relations: Vec<Relation>,
}

impl Converter {
    pub fn new() -> Converter {
        Converter {
            nodes: NodeStore::new(),
            ..Converter::default()
        }
    }

    pub fn add(&mut self, element: Element) {
        match element {
            Element::Node(Node { id, lat, lon, tags }) => {
                self.nodes.add(id, lon, lat);
                if let Some(tags) = tags {
                    self.node_tags.insert(id, tags);
                }
            }
            Element::Way(way) => {
                // A later way with the same id replaces the earlier one for lookups, but
                // both are still emitted, as upstream's list and map behave.
                self.ways_by_id.insert(way.id, self.ways.len());
                self.ways.push(way);
            }
            Element::Relation(relation) => self.relations.push(relation),
        }
    }

    /// Every feature, in emission order.
    pub fn features(&mut self) -> Vec<Feature> {
        self.nodes.finish();
        let mut features = Vec::new();

        for relation in &self.relations {
            if let Some(feature) = self.relation_feature(relation) {
                features.push(feature);
            }
        }

        for way in &self.ways {
            if self.is_polygon_way(way) {
                if let Some(feature) = self.way_feature(way, true) {
                    features.push(feature);
                }
            }
        }

        for way in &self.ways {
            if !self.is_polygon_way(way) {
                if let Some(feature) = self.way_feature(way, false) {
                    features.push(feature);
                }
            }
        }

        features.extend(self.point_features());
        features
    }

    fn point_features(&self) -> Vec<Feature> {
        // 0: not in any way. 1: emit. 2: part of a way.
        let mut state = vec![0u8; self.nodes.len()];

        for way in &self.ways {
            for &id in way.nodes.iter().flatten() {
                if let Some(index) = self.nodes.index_of(id) {
                    state[index] = 2;
                }
            }
        }
        for (index, slot) in state.iter_mut().enumerate() {
            if *slot == 0 || self.node_tags.contains_key(&self.nodes.id_at(index)) {
                *slot = 1;
            }
        }
        for relation in &self.relations {
            for member in relation.members.iter().flatten() {
                if member.member_type == MemberType::Node {
                    if let Some(index) = self.nodes.index_of(member.reference) {
                        state[index] = 1;
                    }
                }
            }
        }

        state
            .iter()
            .enumerate()
            .filter(|&(_, &slot)| slot == 1)
            .map(|(index, _)| {
                let id = self.nodes.id_at(index);
                Feature {
                    osm_type: OsmType::Node,
                    id,
                    tags: self.node_tags.get(&id).cloned().unwrap_or_default(),
                    geometry: Geometry::Point(self.nodes.position_at(index)),
                }
            })
            .collect()
    }

    fn is_polygon_way(&self, way: &Way) -> bool {
        let (Some(nodes), Some(tags)) = (&way.nodes, &way.tags) else {
            return false;
        };
        let (Some(&first), Some(&last)) = (nodes.first(), nodes.last()) else {
            return false;
        };
        first == last && self.nodes.has(first) && self.nodes.has(last) && is_polygon_feature(tags)
    }

    fn way_feature(&self, way: &Way, as_polygon: bool) -> Option<Feature> {
        // A way without a node list is an `ids_only` result with no geometry.
        let node_ids = way.nodes.as_ref()?;

        let coordinates: Vec<Position> = node_ids
            .iter()
            .filter_map(|&id| self.nodes.index_of(id))
            .map(|index| self.nodes.position_at(index))
            .collect();

        if coordinates.len() <= 1 {
            // Not enough of the way is in the extract to draw anything.
            return None;
        }

        let geometry = if as_polygon {
            let mut rings = vec![coordinates];
            rewind_polygon(&mut rings);
            Geometry::Polygon(rings)
        } else {
            Geometry::LineString(coordinates)
        };

        Some(Feature {
            osm_type: OsmType::Way,
            id: way.id,
            tags: way.tags.clone().unwrap_or_default(),
            geometry,
        })
    }

    fn relation_feature(&self, relation: &Relation) -> Option<Feature> {
        // Without tags or a member list there is nothing to build from.
        let tags = relation.tags.as_ref()?;
        let members = relation.members.as_ref()?;

        let geometry = match tags.get("type").map(String::as_str) {
            Some("route") | Some("waterway") => self.route_geometry(members),
            Some("multipolygon") | Some("boundary") => self.multipolygon_geometry(members),
            _ => None,
        }?;

        let geometry = match geometry {
            Geometry::Polygon(mut rings) => {
                rewind_polygon(&mut rings);
                Geometry::Polygon(rings)
            }
            Geometry::MultiPolygon(mut polygons) => {
                for rings in &mut polygons {
                    rewind_polygon(rings);
                }
                Geometry::MultiPolygon(polygons)
            }
            other => other,
        };

        Some(Feature {
            osm_type: OsmType::Relation,
            id: relation.id,
            tags: tags.clone(),
            geometry,
        })
    }

    /// The member ways of a relation that can contribute geometry.
    fn way_members(&self, members: &[Member]) -> Vec<WayMember> {
        members
            .iter()
            .filter(|member| member.member_type == MemberType::Way)
            .filter_map(|member| {
                let way = &self.ways[*self.ways_by_id.get(&member.reference)?];
                // A missing or incomplete way: the geometry is built from the rest.
                let nodes = way.nodes.as_ref()?;
                Some(WayMember {
                    role: member.role.clone(),
                    nodes: nodes
                        .iter()
                        .copied()
                        .filter(|&id| self.nodes.has(id))
                        .collect(),
                })
            })
            .collect()
    }

    fn positions(&self, ids: &[i64]) -> Vec<Position> {
        ids.iter().map(|&id| self.nodes.position(id)).collect()
    }

    fn route_geometry(&self, members: &[Member]) -> Option<Geometry> {
        let ways: Vec<Vec<i64>> = self
            .way_members(members)
            .into_iter()
            .map(|member| member.nodes)
            .collect();

        let mut lines: Vec<Vec<Position>> = join_ways(&ways)
            .iter()
            .map(|line| self.positions(line))
            .collect();

        match lines.len() {
            0 => None,
            1 => Some(Geometry::LineString(lines.remove(0))),
            _ => Some(Geometry::MultiLineString(lines)),
        }
    }

    fn multipolygon_geometry(&self, members: &[Member]) -> Option<Geometry> {
        // Checked against the raw members, so a role-less member does not count here even
        // though it is treated as an outer below.
        if !members
            .iter()
            .any(|member| member.role.as_deref() == Some("outer"))
        {
            return None;
        }

        // An absent or empty role is an outer ring.
        let way_members: Vec<(String, Vec<i64>)> = self
            .way_members(members)
            .into_iter()
            .map(|member| {
                let role = member
                    .role
                    .filter(|role| !role.is_empty())
                    .unwrap_or_else(|| "outer".to_owned());
                (role, member.nodes)
            })
            .collect();

        let with_role = |wanted: &str| -> Vec<Vec<i64>> {
            way_members
                .iter()
                .filter(|(role, _)| role == wanted)
                .map(|(_, nodes)| nodes.clone())
                .collect()
        };
        let outers = join_ways(&with_role("outer"));
        let inners = join_ways(&with_role("inner"));

        // Each inner ring goes to the first outer ring containing any of its points. An
        // inner ring in empty space is dropped.
        let outer_points: Vec<Vec<Position>> =
            outers.iter().map(|ring| self.positions(ring)).collect();
        let mut clusters: Vec<Vec<&Vec<i64>>> = outers.iter().map(|outer| vec![outer]).collect();
        for inner in &inners {
            let owner = outer_points.iter().position(|outer| {
                inner
                    .iter()
                    .any(|&id| point_in_polygon(self.nodes.position(id), outer))
            });
            if let Some(index) = owner {
                clusters[index].push(inner);
            }
        }

        let mut polygons: Vec<Vec<Vec<Position>>> = Vec::new();
        for cluster in clusters {
            // A ring needs at least four positions to enclose anything. If the outer ring is
            // too short and is skipped, a surviving inner ring becomes the first ring and so
            // is wound as an outer one -- reproduced, not corrected.
            let rings: Vec<Vec<Position>> = cluster
                .into_iter()
                .filter(|ring| ring.len() >= 4)
                .map(|ring| self.positions(ring))
                .collect();
            if !rings.is_empty() {
                polygons.push(rings);
            }
        }

        match polygons.len() {
            0 => None,
            1 => Some(Geometry::Polygon(polygons.remove(0))),
            _ => Some(Geometry::MultiPolygon(polygons)),
        }
    }
}
