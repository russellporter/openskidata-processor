//! The clustering stage, fed by the Rust format stage, against the final output of the real
//! TypeScript `prepare` (`rust/codegen/generate-cluster-scenes.mjs`): 120 multi-resort
//! worlds with their recorded `ski_areas`, `runs`, `lifts` and `spots`.

use openskidata_format::FeatureType;
use osd_cluster::engine::ClusterOutput;
use osd_out::{csv, mapboxgl};

mod common;
use common::{Roles, feature_json, same, without_embedded_station_ski_areas};
use serde::Deserialize;
use serde_json::Value;

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
        let output = common::run(&scene.roles);
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
