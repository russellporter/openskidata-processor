//! `polygon_intersects` against the real `booleanIntersects`
//! (`rust/codegen/generate-intersects-vectors.mjs`), on random inputs and small integer grids
//! where vertices sit on edges and corners.

use osd_turf::Position;
use osd_turf::intersects::{Part, polygon_intersects};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Vectors {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    pixel: Vec<Position>,
    geometry: Value,
    result: bool,
}

fn rings(value: &Value) -> Vec<Vec<Position>> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|ring| {
            ring.as_array()
                .unwrap()
                .iter()
                .map(|p| [p[0].as_f64().unwrap(), p[1].as_f64().unwrap()])
                .collect()
        })
        .collect()
}

#[test]
fn every_recorded_intersection_test_is_reproduced() {
    let vectors: Vectors = serde_json::from_str(include_str!("intersects_vectors.json")).unwrap();
    let (mut yes, mut no) = (0, 0);
    for (i, case) in vectors.cases.iter().enumerate() {
        let coordinates = &case.geometry["coordinates"];
        let got = match case.geometry["type"].as_str().unwrap() {
            "LineString" => {
                let line = &rings(&Value::Array(vec![coordinates.clone()]))[0];
                polygon_intersects(&case.pixel, Part::LineString(line))
            }
            "Polygon" => {
                let owned = rings(coordinates);
                let refs: Vec<&[Position]> = owned.iter().map(Vec::as_slice).collect();
                polygon_intersects(&case.pixel, Part::Polygon(&refs))
            }
            other => panic!("{other}"),
        };
        assert_eq!(got, case.result, "case {i}: {}", case.geometry);
        if got { yes += 1 } else { no += 1 }
    }
    assert!(yes > 3000 && no > 1500, "{yes} {no}");
}
