//! `is_valid` against `@turf/boolean-valid` (`rust/codegen/generate-validity-vectors.mjs`),
//! over geometries on a tiny grid where degenerate cases are everywhere.

use osd_osm::element::Geometry;
use osd_osm::validity::is_valid;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Vectors {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    geometry: Value,
    expected: Value,
}

fn geometry(value: &Value) -> Geometry {
    let coordinates = value["coordinates"].clone();
    match value["type"].as_str().unwrap() {
        "Point" => Geometry::Point(serde_json::from_value(coordinates).unwrap()),
        "LineString" => Geometry::LineString(serde_json::from_value(coordinates).unwrap()),
        "MultiLineString" => {
            Geometry::MultiLineString(serde_json::from_value(coordinates).unwrap())
        }
        "Polygon" => Geometry::Polygon(serde_json::from_value(coordinates).unwrap()),
        "MultiPolygon" => Geometry::MultiPolygon(serde_json::from_value(coordinates).unwrap()),
        other => panic!("unexpected {other}"),
    }
}

#[test]
fn validity_matches_turf() {
    let vectors: Vectors = serde_json::from_str(include_str!("validity_vectors.json")).unwrap();
    assert!(vectors.cases.len() >= 3000);

    let mut mismatches = Vec::new();
    for (n, case) in vectors.cases.iter().enumerate() {
        let expected = case.expected.as_bool().unwrap_or(false);
        let actual = is_valid(&geometry(&case.geometry));
        if actual != expected {
            mismatches.push(format!(
                "case {n}: {} -> actual {actual}, turf {expected}",
                case.geometry
            ));
        }
    }
    assert!(
        mismatches.is_empty(),
        "{} of {} differ\n{}",
        mismatches.len(),
        vectors.cases.len(),
        mismatches
            .iter()
            .take(8)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}
