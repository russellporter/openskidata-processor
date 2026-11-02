//! The turf ports against the real library (`rust/codegen/generate-turf-vectors.mjs`).

use osd_cluster::turf::{length_km, ski_area_geometry};
use osd_osm::element::Geometry;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Vectors {
    #[serde(rename = "skiAreaGeometry")]
    ski_area_geometry: Vec<SkiAreaCase>,
    length: Vec<LengthCase>,
}

#[derive(Deserialize)]
struct SkiAreaCase {
    members: Vec<Value>,
    expected: [f64; 2],
}

#[derive(Deserialize)]
struct LengthCase {
    geometry: Value,
    expected: f64,
}

fn geometry(value: &Value) -> Geometry {
    let c = value["coordinates"].clone();
    match value["type"].as_str().unwrap() {
        "Point" => Geometry::Point(serde_json::from_value(c).unwrap()),
        "LineString" => Geometry::LineString(serde_json::from_value(c).unwrap()),
        "MultiLineString" => Geometry::MultiLineString(serde_json::from_value(c).unwrap()),
        "Polygon" => Geometry::Polygon(serde_json::from_value(c).unwrap()),
        "MultiPolygon" => Geometry::MultiPolygon(serde_json::from_value(c).unwrap()),
        other => panic!("unexpected {other}"),
    }
}

fn vectors() -> Vectors {
    serde_json::from_str(include_str!("turf_vectors.json")).unwrap()
}

/// These are the same arithmetic with the same operations in the same order, so they are
/// expected to agree to the last digit or two; the tolerance only absorbs differences in
/// `sin`, `cos` and `atan2` between V8 and the platform libm.
fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-12 * b.abs().max(1.0)
}

#[test]
fn ski_area_geometry_matches_turf() {
    for (n, case) in vectors().ski_area_geometry.iter().enumerate() {
        let members: Vec<Geometry> = case.members.iter().map(geometry).collect();
        let refs: Vec<&Geometry> = members.iter().collect();
        let actual = ski_area_geometry(&refs);
        assert!(
            close(actual[0], case.expected[0]) && close(actual[1], case.expected[1]),
            "case {n}: {actual:?} vs {:?}",
            case.expected
        );
    }
}

#[test]
fn lengths_match_turf() {
    for (n, case) in vectors().length.iter().enumerate() {
        let actual = length_km(&geometry(&case.geometry));
        assert!(
            close(actual, case.expected),
            "case {n}: {actual} vs {}",
            case.expected
        );
    }
}
