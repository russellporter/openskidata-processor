//! `compute_viewport_hint` against the real implementation
//! (`rust/codegen/generate-viewport-vectors.mjs`), at a relative tolerance of 1e-9.
//!
//! Tolerance rather than equality because `sin`, `cos` and `atan2` differ in the last bit
//! between V8 and the platform libm. Whether a bearing exists at all must match exactly.

use openskidata_format::viewport_hint::{Position3, ViewportHint, compute_viewport_hint};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Vectors {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    geometries: Vec<Value>,
    expected: ViewportHint,
}

fn position(value: &Value) -> Position3 {
    let numbers: Vec<f64> = serde_json::from_value(value.clone()).unwrap();
    [
        numbers[0],
        numbers[1],
        numbers.get(2).copied().unwrap_or(0.0),
    ]
}

/// Connected sequences of a geometry, in upstream's collection order.
fn sequences(geometry: &Value, out: &mut Vec<Vec<Position3>>) {
    let coordinates = &geometry["coordinates"];
    let line = |value: &Value| value.as_array().unwrap().iter().map(position).collect();
    match geometry["type"].as_str().unwrap() {
        "Point" => out.push(vec![position(coordinates)]),
        "MultiPoint" => {
            for p in coordinates.as_array().unwrap() {
                out.push(vec![position(p)]);
            }
        }
        "LineString" => out.push(line(coordinates)),
        "MultiLineString" | "Polygon" => {
            for part in coordinates.as_array().unwrap() {
                out.push(line(part));
            }
        }
        "MultiPolygon" => {
            for polygon in coordinates.as_array().unwrap() {
                for ring in polygon.as_array().unwrap() {
                    out.push(line(ring));
                }
            }
        }
        "GeometryCollection" => {
            for g in geometry["geometries"].as_array().unwrap() {
                sequences(g, out);
            }
        }
        other => panic!("unexpected geometry {other}"),
    }
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9 * b.abs().max(1.0)
}

#[test]
fn hints_match_the_live_implementation() {
    let vectors: Vectors = serde_json::from_str(include_str!("viewport_vectors.json")).unwrap();
    assert!(vectors.cases.len() >= 700);

    let mut with_bearing = 0;
    for (n, case) in vectors.cases.iter().enumerate() {
        let mut parts = Vec::new();
        for geometry in &case.geometries {
            sequences(geometry, &mut parts);
        }
        let refs: Vec<&[Position3]> = parts.iter().map(Vec::as_slice).collect();
        let actual = compute_viewport_hint(&refs).expect("a hint");
        let e = &case.expected;

        assert_eq!(
            actual.bearing.is_some(),
            e.bearing.is_some(),
            "case {n}: bearing presence\n  actual {actual:?}\n  expected {e:?}"
        );
        if let (Some(a), Some(b)) = (actual.bearing, e.bearing) {
            with_bearing += 1;
            // Bearings wrap at 360, so compare on the circle.
            let difference = ((a - b + 540.0) % 360.0) - 180.0;
            assert!(difference.abs() < 1e-7, "case {n}: bearing {a} vs {b}");
        }
        assert!(close(actual.center.0, e.center.0), "case {n}: centre lng");
        assert!(close(actual.center.1, e.center.1), "case {n}: centre lat");
        assert!(
            close(actual.rotated_width_meters, e.rotated_width_meters),
            "case {n}: width {} vs {}",
            actual.rotated_width_meters,
            e.rotated_width_meters
        );
        assert!(
            close(actual.rotated_height_meters, e.rotated_height_meters),
            "case {n}: height {} vs {}",
            actual.rotated_height_meters,
            e.rotated_height_meters
        );
        assert!(
            close(actual.min_camera_y, e.min_camera_y),
            "case {n}: minCameraY {} vs {}",
            actual.min_camera_y,
            e.min_camera_y
        );
    }
    assert!(
        with_bearing > 300,
        "only {with_bearing} cases had a bearing"
    );
}
