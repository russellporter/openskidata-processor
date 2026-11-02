//! The clustering stage, fed by the Rust format stage, against the final output of the real
//! TypeScript `prepare` (`rust/codegen/generate-cluster-scenes.mjs`): 120 multi-resort
//! worlds with their recorded `ski_areas`, `runs`, `lifts` and `spots`.

use openskidata_format::FeatureType;
use openskidata_format::{SkiAreaActivity, Status};
use osd_cluster::engine::{ClusterOutput, cluster};
use osd_osm::element::{Element, Feature, Relation};
use osd_osm::overpass::{convert_overpass_json, read_elements};
use osd_out::{csv, mapboxgl};
use osd_pipeline::format::{FormatInput, SkimapSkiArea, format_all};
use serde::Deserialize;
use serde_json::{Value, json};
use std::str::FromStr;

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
    #[serde(default)]
    mapboxgl: Option<MapboxGl>,
    #[serde(default)]
    csv: Option<Csv>,
}

/// The CSV exports, as text.
#[derive(Deserialize)]
struct Csv {
    #[serde(rename = "skiAreas")]
    ski_areas: String,
    runs: String,
    lifts: String,
    spots: String,
}

/// The slimmed GeoJSON that feeds tippecanoe.
#[derive(Deserialize)]
struct MapboxGl {
    #[serde(rename = "skiAreas")]
    ski_areas: Vec<Value>,
    runs: Vec<Value>,
    lifts: Vec<Value>,
    spots: Vec<Value>,
}

fn features(elements: &Value) -> Vec<Feature> {
    let document = json!({ "elements": elements }).to_string();
    convert_overpass_json(document.as_bytes()).unwrap()
}

fn relations(elements: &Value) -> Vec<Relation> {
    let document = json!({ "elements": elements }).to_string();
    let mut relations = Vec::new();
    read_elements(document.as_bytes(), |element| {
        if let Element::Relation(relation) = element {
            relations.push(relation);
        }
    })
    .unwrap();
    relations
}

fn skimap(value: &Value) -> SkimapSkiArea {
    let properties = &value["properties"];
    let coordinates = &value["geometry"]["coordinates"];
    SkimapSkiArea {
        id: properties["id"].as_str().unwrap().to_owned(),
        name: properties["name"].as_str().map(str::to_owned),
        status: properties["status"]
            .as_str()
            .map(|s| Status::from_str(s).unwrap()),
        activities: properties["activities"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| SkiAreaActivity::from_str(a.as_str().unwrap()).unwrap())
            .collect(),
        official_website: properties["official_website"].as_str().map(str::to_owned),
        coordinates: [
            coordinates[0].as_f64().unwrap(),
            coordinates[1].as_f64().unwrap(),
        ],
    }
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

/// A documented divergence: the `skiAreas` embedded in a lift's `stations`.
///
/// Upstream exports a station embedded in a lift with the properties it was loaded with, so
/// that field holds the *unresolved* site ski areas as they were at load time -- full
/// features, still carrying the `[360, 360, id]` placeholder coordinates -- whereas the same
/// station in `spots.geojson` shows resolved summaries. This pipeline resolves both the same
/// way, so the field is excluded here; the station's own `skiAreas` is still compared in
/// `spots`.
fn without_embedded_station_ski_areas(mut feature: Value) -> Value {
    // `get_mut`, not indexing: `IndexMut` on a missing key inserts a null.
    let stations = feature
        .get_mut("properties")
        .and_then(|p| p.get_mut("stations"))
        .and_then(Value::as_array_mut);
    if let Some(stations) = stations {
        for station in stations {
            if let Some(object) = station.get_mut("properties").and_then(Value::as_object_mut) {
                object.remove("skiAreas");
            }
        }
    }
    feature
}

fn feature_json<P: serde::Serialize>(f: &osd_cluster::engine::Feature<P>) -> Value {
    without_embedded_station_ski_areas(json!({
        "type": "Feature",
        "geometry": serde_json::to_value(&f.geometry).unwrap(),
        "properties": serde_json::to_value(&f.properties).unwrap(),
    }))
}

fn actual(output: &ClusterOutput) -> Expected {
    Expected {
        ski_areas: output.ski_areas.iter().map(feature_json).collect(),
        runs: output.runs.iter().map(feature_json).collect(),
        lifts: output.lifts.iter().map(feature_json).collect(),
        spots: output.spots.iter().map(feature_json).collect(),
        mapboxgl: Some(MapboxGl {
            ski_areas: output.ski_areas.iter().map(mapboxgl::ski_area).collect(),
            runs: output.runs.iter().filter_map(mapboxgl::run).collect(),
            lifts: output.lifts.iter().map(mapboxgl::lift).collect(),
            spots: output.spots.iter().map(mapboxgl::spot).collect(),
        }),
        csv: Some(Csv {
            ski_areas: csv::file(
                FeatureType::SkiArea,
                output.ski_areas.iter().map(csv::ski_area),
            ),
            runs: csv::file(FeatureType::Run, output.runs.iter().map(csv::run)),
            lifts: csv::file(FeatureType::Lift, output.lifts.iter().map(csv::lift)),
            spots: csv::file(FeatureType::Spot, output.spots.iter().map(csv::spot)),
        }),
    }
}

/// How many scenes to compare, and which role to report on, can be narrowed while debugging.
fn selected_roles() -> Vec<&'static str> {
    match std::env::var("CLUSTER_ROLES").as_deref() {
        Ok(list) => ["skiAreas", "runs", "lifts", "spots"]
            .into_iter()
            .filter(|r| list.split(',').any(|x| x == *r))
            .collect(),
        Err(_) => vec!["skiAreas", "runs", "lifts", "spots"],
    }
}

#[test]
fn every_recorded_scene_is_reproduced() {
    let scenes: Scenes =
        serde_json::from_str(include_str!("../../osd-cluster/tests/cluster_scenes.json")).unwrap();
    assert!(scenes.scenes.len() >= 100);
    let roles = selected_roles();

    let mut failures: Vec<String> = Vec::new();
    let mut scenes_failed = 0;
    for (n, scene) in scenes.scenes.iter().enumerate() {
        let input = FormatInput {
            runs: features(&scene.roles.runs),
            lifts: features(&scene.roles.lifts),
            ski_areas: features(&scene.roles.ski_areas),
            sites: relations(&scene.roles.sites),
            spots: features(&scene.roles.spots),
            skimap: scene.roles.skimap.iter().map(skimap).collect(),
        };
        let formatted = format_all(&input).unwrap();
        let output = cluster(formatted.into_cluster_input()).unwrap();
        let actual = actual(&output);

        let mut scene_failed = false;
        let mut pairs: Vec<(&str, &Vec<Value>, &Vec<Value>)> = vec![
            ("skiAreas", &actual.ski_areas, &scene.expected.ski_areas),
            ("runs", &actual.runs, &scene.expected.runs),
            ("lifts", &actual.lifts, &scene.expected.lifts),
            ("spots", &actual.spots, &scene.expected.spots),
        ];
        if let (Some(got), Some(want)) = (&actual.mapboxgl, &scene.expected.mapboxgl) {
            pairs.extend([
                ("mapboxgl.skiAreas", &got.ski_areas, &want.ski_areas),
                ("mapboxgl.runs", &got.runs, &want.runs),
                ("mapboxgl.lifts", &got.lifts, &want.lifts),
                ("mapboxgl.spots", &got.spots, &want.spots),
            ]);
        }
        if let (Some(got), Some(want)) = (&actual.csv, &scene.expected.csv) {
            for (role, got, want) in [
                ("csv.skiAreas", &got.ski_areas, &want.ski_areas),
                ("csv.runs", &got.runs, &want.runs),
                ("csv.lifts", &got.lifts, &want.lifts),
                ("csv.spots", &got.spots, &want.spots),
            ] {
                if !roles.contains(&role.trim_start_matches("csv.")) || got == want {
                    continue;
                }
                scene_failed = true;
                let (g, w): (Vec<&str>, Vec<&str>) =
                    (got.lines().collect(), want.lines().collect());
                let line = (0..g.len().max(w.len()))
                    .find(|&i| g.get(i) != w.get(i))
                    .unwrap_or(0);
                failures.push(format!(
                    "scene {n} {role}: line {line}\n  actual:   {:?}\n  expected: {:?}",
                    g.get(line),
                    w.get(line)
                ));
            }
        }
        for (role, got, want) in pairs {
            if !roles.contains(&role.trim_start_matches("mapboxgl.")) {
                continue;
            }
            if got.len() != want.len() {
                scene_failed = true;
                failures.push(format!(
                    "scene {n} {role}: {} features, expected {}",
                    got.len(),
                    want.len()
                ));
                continue;
            }
            for (i, (g, w)) in got.iter().zip(want).enumerate() {
                let w = &without_embedded_station_ski_areas(w.clone());
                if !same(g, w) {
                    scene_failed = true;
                    failures.push(format!(
                        "scene {n} {role}[{i}]\n  actual:   {g}\n  expected: {w}"
                    ));
                    break;
                }
            }
        }
        if scene_failed {
            scenes_failed += 1;
        }
    }
    assert!(
        failures.is_empty(),
        "{scenes_failed} of {} scenes differ; first failures:\n{}",
        scenes.scenes.len(),
        failures
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}
