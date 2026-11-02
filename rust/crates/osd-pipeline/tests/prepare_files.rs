//! `prepare` end to end through the file system: scene inputs are written as the
//! `input_*.osmjson` files production reads, `prepare` is run on the directory, and the
//! GeoJSON, mapboxgl GeoJSON and CSV files it writes are compared with what the real
//! TypeScript `prepare` wrote for the same inputs.

use osd_pipeline::prepare::{PrepareConfig, prepare};
use serde::Deserialize;
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
struct Scenes {
    scenes: Vec<Scene>,
}

#[derive(Deserialize)]
struct Scene {
    roles: Roles,
    expected: Expected,
}

#[derive(Deserialize)]
struct Roles {
    runs: Value,
    lifts: Value,
    #[serde(rename = "skiAreas")]
    ski_areas: Value,
    sites: Value,
    spots: Value,
    skimap: Vec<Value>,
}

#[derive(Deserialize)]
struct Expected {
    #[serde(rename = "skiAreas")]
    ski_areas: Vec<Value>,
    runs: Vec<Value>,
    lifts: Vec<Value>,
    spots: Vec<Value>,
    mapboxgl: MapboxGl,
    csv: Csv,
}

#[derive(Deserialize)]
struct MapboxGl {
    #[serde(rename = "skiAreas")]
    ski_areas: Vec<Value>,
    runs: Vec<Value>,
    lifts: Vec<Value>,
    spots: Vec<Value>,
}

#[derive(Deserialize)]
struct Csv {
    #[serde(rename = "skiAreas")]
    ski_areas: String,
    runs: String,
    lifts: String,
    spots: String,
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("osd-prepare-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_inputs(dir: &Path, roles: &Roles) {
    let osm = |name: &str, elements: &Value| {
        fs::write(dir.join(name), json!({ "elements": elements }).to_string()).unwrap();
    };
    osm("input_runs.osmjson", &roles.runs);
    osm("input_lifts.osmjson", &roles.lifts);
    osm("input_ski_areas.osmjson", &roles.ski_areas);
    osm("input_ski_area_sites.osmjson", &roles.sites);
    osm("input_spots.osmjson", &roles.spots);
    fs::write(
        dir.join("input_skimap_ski_areas.geojson"),
        json!({ "type": "FeatureCollection", "features": roles.skimap }).to_string(),
    )
    .unwrap();
}

fn features(path: &Path) -> Vec<Value> {
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let document: Value = serde_json::from_str(&text).unwrap();
    document["features"].as_array().unwrap().clone()
}

fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            x == y || (x - y).abs() <= 1e-9 * y.abs().max(1.0)
        }
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, p)| y.get(k).is_some_and(|q| same(p, q)))
        }
        _ => a == b,
    }
}

/// Embedded station ski areas are a documented divergence (see `cluster_scenes.rs`).
fn without_embedded_station_ski_areas(mut feature: Value) -> Value {
    let stations = feature
        .get_mut("properties")
        .and_then(|p| p.get_mut("stations"))
        .and_then(Value::as_array_mut);
    if let Some(stations) = stations {
        for station in stations {
            if let Some(o) = station.get_mut("properties").and_then(Value::as_object_mut) {
                o.remove("skiAreas");
            }
        }
    }
    feature
}

#[test]
fn files_written_by_prepare_match_the_typescript_output() {
    let scenes: Scenes =
        serde_json::from_str(include_str!("../../osd-cluster/tests/cluster_scenes.json")).unwrap();
    // Every tenth scene: file handling is the point here, and the content is covered in full
    // by `cluster_scenes`.
    let chosen: Vec<&Scene> = scenes.scenes.iter().step_by(10).collect();
    assert!(chosen.len() >= 10);

    for (n, scene) in chosen.iter().enumerate() {
        let input_dir = scratch(&format!("in{n}"));
        let output_dir = scratch(&format!("out{n}"));
        write_inputs(&input_dir, &scene.roles);
        prepare(&PrepareConfig {
            input_dir: input_dir.clone(),
            output_dir: output_dir.clone(),
            bbox: None,
        })
        .unwrap();

        let check = |file: &str, want: &[Value]| {
            let got = features(&output_dir.join(file));
            assert_eq!(got.len(), want.len(), "scene {n} {file}: feature count");
            for (i, (g, w)) in got.iter().zip(want).enumerate() {
                let (g, w) = (
                    without_embedded_station_ski_areas(g.clone()),
                    without_embedded_station_ski_areas(w.clone()),
                );
                assert!(
                    same(&g, &w),
                    "scene {n} {file}[{i}]\n  got:  {g}\n  want: {w}"
                );
            }
        };
        check("ski_areas.geojson", &scene.expected.ski_areas);
        check("runs.geojson", &scene.expected.runs);
        check("lifts.geojson", &scene.expected.lifts);
        check("spots.geojson", &scene.expected.spots);
        check(
            "mapboxgl_ski_areas.geojson",
            &scene.expected.mapboxgl.ski_areas,
        );
        check("mapboxgl_runs.geojson", &scene.expected.mapboxgl.runs);
        check("mapboxgl_lifts.geojson", &scene.expected.mapboxgl.lifts);
        check("mapboxgl_spots.geojson", &scene.expected.mapboxgl.spots);

        for (file, want) in [
            ("ski_areas.csv", &scene.expected.csv.ski_areas),
            ("runs.csv", &scene.expected.csv.runs),
            ("lifts.csv", &scene.expected.csv.lifts),
            ("spots.csv", &scene.expected.csv.spots),
        ] {
            let got = fs::read_to_string(output_dir.join("csv").join(file)).unwrap();
            assert_eq!(&got, want, "scene {n} csv/{file}");
        }

        let _ = fs::remove_dir_all(&input_dir);
        let _ = fs::remove_dir_all(&output_dir);
    }
}

#[test]
fn the_geojson_layout_is_the_one_merge_outputs_expects() {
    // One feature per line between a fixed prelude and epilogue, `,` on a line of its own.
    let scenes: Scenes =
        serde_json::from_str(include_str!("../../osd-cluster/tests/cluster_scenes.json")).unwrap();
    let scene = scenes
        .scenes
        .iter()
        .find(|s| s.expected.runs.len() >= 2)
        .expect("a scene with two runs");
    let input_dir = scratch("layout-in");
    let output_dir = scratch("layout-out");
    write_inputs(&input_dir, &scene.roles);
    prepare(&PrepareConfig {
        input_dir: input_dir.clone(),
        output_dir: output_dir.clone(),
        bbox: None,
    })
    .unwrap();
    let text = fs::read_to_string(output_dir.join("runs.geojson")).unwrap();
    assert!(text.starts_with("{\"type\": \"FeatureCollection\", \"features\":[\n{"));
    assert!(text.contains("\n,\n{"));
    assert!(text.ends_with("\n]}\n"));
    let _ = fs::remove_dir_all(&input_dir);
    let _ = fs::remove_dir_all(&output_dir);
}

/// `metadata.json` describes the files that were just written: their counts, their sizes and
/// the provenance the download step recorded.
#[test]
fn metadata_json_describes_what_was_written() {
    let scenes: Scenes =
        serde_json::from_str(include_str!("../../osd-cluster/tests/cluster_scenes.json")).unwrap();
    let scene = scenes
        .scenes
        .iter()
        .find(|s| s.expected.ski_areas.len() >= 3 && !s.expected.spots.is_empty())
        .expect("a scene with several ski areas and a spot");
    let input_dir = scratch("meta-in");
    let output_dir = scratch("meta-out");
    write_inputs(&input_dir, &scene.roles);
    fs::write(
        input_dir.join("input_download_metadata.json"),
        r#"{"startedAt":"2026-08-22T20:04:58.000Z","openStreetMap":{"dataTimestamp":"2026-08-22T19:36:10Z"},"skiMapOrg":{"downloadedAt":"2026-08-22T20:05:31.000Z"}}"#,
    )
    .unwrap();
    prepare(&PrepareConfig {
        input_dir: input_dir.clone(),
        output_dir: output_dir.clone(),
        bbox: Some(vec![11.0, 47.0, 12.5, 48.0]),
    })
    .unwrap();

    let metadata: Value =
        serde_json::from_str(&fs::read_to_string(output_dir.join("metadata.json")).unwrap())
            .unwrap();
    let expected = &scene.expected;
    let has = |area: &Value, key: &str, value: &str| {
        area["properties"][key]
            .as_array()
            .is_some_and(|a| a.iter().any(|v| v == value))
    };
    let counts = &metadata["counts"];
    assert_eq!(counts["skiAreas"]["total"], expected.ski_areas.len());
    assert_eq!(counts["runs"], expected.runs.len());
    assert_eq!(counts["lifts"], expected.lifts.len());
    assert_eq!(counts["spots"], expected.spots.len());
    assert_eq!(
        counts["skiAreas"]["operating"],
        expected
            .ski_areas
            .iter()
            .filter(|a| a["properties"]["status"] == "operating")
            .count()
    );
    assert_eq!(
        counts["skiAreas"]["downhill"],
        expected
            .ski_areas
            .iter()
            .filter(|a| has(a, "activities", "downhill"))
            .count()
    );

    assert_eq!(metadata["version"], 1);
    assert_eq!(
        metadata["formatVersion"],
        openskidata_format::FORMAT_VERSION
    );
    assert_eq!(metadata["bbox"], json!([11, 47, 12.5, 48]));
    assert_eq!(metadata["run"]["startedAt"], "2026-08-22T20:04:58.000Z");
    assert_eq!(
        metadata["source"]["openStreetMap"]["dataTimestamp"],
        "2026-08-22T19:36:10Z"
    );
    assert_eq!(
        metadata["source"]["skiMapOrg"]["downloadedAt"],
        "2026-08-22T20:05:31.000Z"
    );

    let size = |path: PathBuf| fs::metadata(path).unwrap().len();
    assert_eq!(
        metadata["files"]["geojson"]["runs"],
        size(output_dir.join("runs.geojson"))
    );
    assert_eq!(
        metadata["files"]["csv"]["spots"],
        size(output_dir.join("csv").join("spots.csv"))
    );
    assert_eq!(
        metadata["files"]["geoPackage"],
        size(output_dir.join("openskidata.gpkg"))
    );
    let _ = fs::remove_dir_all(&input_dir);
    let _ = fs::remove_dir_all(&output_dir);

    // Without the download step's file there is no provenance, but still a file.
    let input_dir = scratch("meta-none-in");
    let output_dir = scratch("meta-none-out");
    write_inputs(&input_dir, &scene.roles);
    prepare(&PrepareConfig {
        input_dir: input_dir.clone(),
        output_dir: output_dir.clone(),
        bbox: None,
    })
    .unwrap();
    let metadata: Value =
        serde_json::from_str(&fs::read_to_string(output_dir.join("metadata.json")).unwrap())
            .unwrap();
    assert_eq!(metadata["bbox"], Value::Null);
    assert_eq!(metadata["run"]["startedAt"], Value::Null);
    assert_eq!(metadata["run"]["durationSeconds"], Value::Null);
    assert_eq!(metadata["source"]["skiMapOrg"]["downloadedAt"], Value::Null);
    let _ = fs::remove_dir_all(&input_dir);
    let _ = fs::remove_dir_all(&output_dir);
}
