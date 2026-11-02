//! The OSM element model the converter works on.
//!
//! These mirror what Overpass JSON carries, because that is the reference being matched,
//! and notably keep the distinction between "absent" and "empty": a way with no `nodes` key
//! is an `ids_only` result with no geometry and is ignored, whereas a way with an empty
//! node list is a (degenerate) way. The converter's behaviour differs between the two.

use std::collections::BTreeMap;

pub type Tags = BTreeMap<String, String>;

/// An OSM node.
#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    pub id: i64,
    pub lat: f64,
    pub lon: f64,
    pub tags: Option<Tags>,
}

/// An OSM way. `nodes` is `None` for an `ids_only` result, which carries no geometry.
#[derive(Debug, Clone, PartialEq)]
pub struct Way {
    pub id: i64,
    pub nodes: Option<Vec<i64>>,
    pub tags: Option<Tags>,
}

/// What a relation member refers to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MemberType {
    Node,
    Way,
    Relation,
    /// Any other `type` string. It contributes no geometry but still counts as a member
    /// when the converter checks whether a relation has an outer ring.
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    pub member_type: MemberType,
    pub reference: i64,
    /// `None` when the role key is absent. An empty-string role is `Some("")`; the two are
    /// treated alike for multipolygon members but not for the "has an outer" check.
    pub role: Option<String>,
}

/// An OSM relation. `members` is `None` for an `ids_only` result.
#[derive(Debug, Clone, PartialEq)]
pub struct Relation {
    pub id: i64,
    pub members: Option<Vec<Member>>,
    pub tags: Option<Tags>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Element {
    Node(Node),
    Way(Way),
    Relation(Relation),
}

/// The kind of OSM object a feature came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OsmType {
    Node,
    Way,
    Relation,
}

impl OsmType {
    pub fn as_str(self) -> &'static str {
        match self {
            OsmType::Node => "node",
            OsmType::Way => "way",
            OsmType::Relation => "relation",
        }
    }
}

/// A position as `[longitude, latitude]`, matching GeoJSON.
pub type Position = [f64; 2];

/// GeoJSON-shaped geometry in degrees.
///
/// Kept as plain `f64` rather than snapped to the fixed-point grid: this stage reproduces
/// the TypeScript converter, which works in floats, so that it can be compared against it
/// exactly. Snapping happens when features enter the store.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "type", content = "coordinates")]
pub enum Geometry {
    Point(Position),
    LineString(Vec<Position>),
    Polygon(Vec<Vec<Position>>),
    MultiLineString(Vec<Vec<Position>>),
    MultiPolygon(Vec<Vec<Vec<Position>>>),
}

/// A converted OSM object.
#[derive(Debug, Clone, PartialEq)]
pub struct Feature {
    pub osm_type: OsmType,
    pub id: i64,
    pub tags: Tags,
    pub geometry: Geometry,
}

impl Feature {
    /// `way/123`, the form used for sources and for looking up site membership.
    pub fn osm_id(&self) -> String {
        format!("{}/{}", self.osm_type.as_str(), self.id)
    }
}

impl Feature {
    /// The feature as the TypeScript converter emits it:
    /// `{type, id: "way/1", properties: {type, id, tags}, geometry}`.
    pub fn to_geojson(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "Feature",
            "id": self.osm_id(),
            "properties": {
                "type": self.osm_type.as_str(),
                "id": self.id,
                "tags": self.tags,
            },
            "geometry": self.geometry,
        })
    }
}
