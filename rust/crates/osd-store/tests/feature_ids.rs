//! Feature ids and number formatting against the real `object-hash` and `String(x)`
//! (`rust/codegen/generate-id-vectors.mjs`). Ids must match exactly: they are the
//! identifiers consumers hold.

use osd_store::feature_id::{CoordinateWriter, feature_id, js_number_to_string};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Vectors {
    ids: Vec<IdCase>,
    numbers: Vec<NumberCase>,
}

#[derive(Deserialize)]
struct IdCase {
    #[serde(rename = "featureType")]
    feature_type: String,
    geometry: Value,
    /// For polygons, per ring (nested per polygon for multipolygons): whether the closing
    /// position is the same object as the first.
    #[serde(rename = "closingShared")]
    closing_shared: Value,
    expected: String,
}

#[derive(Deserialize)]
struct NumberCase {
    x: f64,
    expected: String,
}

/// Streams a nested JSON coordinate value: arrays of arrays down to numbers.
fn stream(writer: &mut CoordinateWriter, value: &Value) {
    match value {
        Value::Array(items) => {
            writer.array(items.len());
            for item in items {
                stream(writer, item);
            }
        }
        Value::Number(n) => writer.number(n.as_f64().unwrap()),
        other => panic!("unexpected {other}"),
    }
}

fn positions(value: &Value) -> Vec<Vec<f64>> {
    serde_json::from_value(value.clone()).unwrap()
}

/// Identity keys for a ring's positions: all distinct, except that a shared closing position
/// has the first position's key. `next` supplies fresh keys across the whole geometry.
fn rings(value: &Value, shared: &Value, next: &mut u64, writer: &mut CoordinateWriter) {
    let rings = value.as_array().unwrap();
    writer.array(rings.len());
    for (i, ring) in rings.iter().enumerate() {
        let positions = positions(ring);
        let mut keys: Vec<u64> = positions
            .iter()
            .map(|_| {
                *next += 1;
                *next
            })
            .collect();
        if shared[i].as_bool().unwrap() {
            *keys.last_mut().unwrap() = keys[0];
        }
        writer.ring(&positions, &keys);
    }
}

fn vectors() -> Vectors {
    serde_json::from_str(include_str!("id_vectors.json")).unwrap()
}

#[test]
fn ids_match_object_hash() {
    let vectors = vectors();
    assert!(vectors.ids.len() >= 600);
    for (n, case) in vectors.ids.iter().enumerate() {
        let geometry_type = case.geometry["type"].as_str().unwrap();
        let coordinates = &case.geometry["coordinates"];
        let mut next = 0u64;
        let actual = feature_id(&case.feature_type, geometry_type, |w| match geometry_type {
            "Polygon" => rings(coordinates, &case.closing_shared, &mut next, w),
            "MultiPolygon" => {
                let polygons = coordinates.as_array().unwrap();
                w.array(polygons.len());
                for (i, polygon) in polygons.iter().enumerate() {
                    rings(polygon, &case.closing_shared[i], &mut next, w);
                }
            }
            _ => stream(w, coordinates),
        });
        assert_eq!(actual, case.expected, "case {n}: {}", case.geometry);
    }
}

#[test]
fn numbers_format_like_javascript() {
    let vectors = vectors();
    assert!(vectors.numbers.len() >= 1500);
    for case in &vectors.numbers {
        assert_eq!(js_number_to_string(case.x), case.expected, "{:e}", case.x);
    }
}
