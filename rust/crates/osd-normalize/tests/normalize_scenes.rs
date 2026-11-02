//! Whole-pipeline normalization against runs pushed through the real
//! `RunNormalizerAccumulator` (`rust/codegen/generate-normalize-scenes.mjs`).
//!
//! The comparison covers geometry (coordinates in fixed-point units, and the order of the
//! output), and every property except `id` and `viewportHint`, which are recomputed from
//! the final geometry by later stages.

use openskidata_format::run::RunProperties;
use openskidata_format::viewport_hint::ViewportHint;
use osd_normalize::normalize::{RunInput, normalize_runs};
use osd_normalize::topology::InputGeometry;
use osd_store::FixedCoord;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
struct Scenes {
    scenes: Vec<Scene>,
}

#[derive(Deserialize)]
struct Scene {
    runs: Vec<RawRun>,
    expected: Value,
}

#[derive(Deserialize)]
struct RawRun {
    geometry: RawGeometry,
    properties: RunProperties,
}

#[derive(Deserialize)]
struct RawGeometry {
    #[serde(rename = "type")]
    kind: String,
    coordinates: Value,
}

fn coord([lng, lat]: [i32; 2]) -> FixedCoord {
    FixedCoord { lng, lat }
}

fn geometry(raw: &RawGeometry) -> InputGeometry {
    match raw.kind.as_str() {
        "LineString" => {
            let points: Vec<[i32; 2]> = serde_json::from_value(raw.coordinates.clone()).unwrap();
            InputGeometry::Line(points.into_iter().map(coord).collect())
        }
        "Polygon" => {
            let rings: Vec<Vec<[i32; 2]>> =
                serde_json::from_value(raw.coordinates.clone()).unwrap();
            InputGeometry::Polygon(
                rings
                    .into_iter()
                    .map(|ring| ring.into_iter().map(coord).collect())
                    .collect(),
            )
        }
        other => panic!("unexpected geometry {other}"),
    }
}

fn geometry_json(geometry: &InputGeometry) -> Value {
    let pair = |c: &FixedCoord| json!([c.lng, c.lat]);
    match geometry {
        InputGeometry::Line(points) => json!({
            "type": "LineString",
            "coordinates": points.iter().map(pair).collect::<Vec<_>>(),
        }),
        InputGeometry::Polygon(rings) => json!({
            "type": "Polygon",
            "coordinates": rings
                .iter()
                .map(|ring| ring.iter().map(pair).collect::<Vec<_>>())
                .collect::<Vec<_>>(),
        }),
    }
}

fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, p)| y.get(k).is_some_and(|q| same(p, q)))
        }
        _ => a == b,
    }
}

#[test]
fn every_recorded_scene_is_reproduced_exactly() {
    let scenes: Scenes = serde_json::from_str(include_str!("normalize_scenes.json")).unwrap();
    assert!(scenes.scenes.len() >= 700, "scene file looks truncated");

    let stub = ViewportHint {
        center: (0.0, 0.0),
        bearing: None,
        rotated_width_meters: 0.0,
        rotated_height_meters: 0.0,
        min_camera_y: 0.0,
    };

    let mut failures = Vec::new();
    for (n, scene) in scenes.scenes.iter().enumerate() {
        let runs: Vec<RunInput> = scene
            .runs
            .iter()
            .map(|run| RunInput {
                geometry: geometry(&run.geometry),
                properties: run.properties.clone(),
            })
            .collect();

        let actual: Vec<Value> = match normalize_runs(&runs, &|_| stub) {
            Ok(outputs) => outputs
                .iter()
                .map(|output| {
                    let mut properties = serde_json::to_value(&output.properties).unwrap();
                    let object = properties.as_object_mut().unwrap();
                    object.remove("id");
                    object.remove("viewportHint");
                    json!({ "geometry": geometry_json(&output.geometry), "properties": properties })
                })
                .collect(),
            Err(error) => {
                failures.push(format!("scene {n}: {error:#}"));
                continue;
            }
        };

        let expected = scene.expected.as_array().expect("no scene errors expected");
        let matches =
            actual.len() == expected.len() && actual.iter().zip(expected).all(|(a, e)| same(a, e));
        if !matches {
            let summary = |values: &[Value]| -> Vec<String> {
                values
                    .iter()
                    .map(|v| {
                        format!(
                            "{} {} oneway={} name={}",
                            v["geometry"]["type"],
                            v["geometry"]["coordinates"],
                            v["properties"]["oneway"],
                            v["properties"]["name"]
                        )
                    })
                    .collect()
            };
            failures.push(format!(
                "scene {n}: {} outputs, expected {}\n  runs: {:?}\n  actual:\n    {}\n  expected:\n    {}",
                actual.len(),
                expected.len(),
                runs.iter().map(|r| (&r.geometry, r.properties.oneway)).collect::<Vec<_>>(),
                summary(&actual).join("\n    "),
                summary(expected).join("\n    "),
            ));
        }
        if failures.len() >= 3 {
            break;
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}
