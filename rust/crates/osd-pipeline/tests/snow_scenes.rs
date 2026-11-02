//! Snow cover through the whole of `prepare`, against the real TypeScript
//! (`rust/codegen/generate-snow-scenes.mjs`): resorts with a seeded snow cover archive, and
//! the `snowCoverHistory` of each run and `statistics.snowCover` of each ski area that came out.

use osd_cache::{CacheKind, CacheStore};
use osd_pipeline::prepare::{PrepareConfig, SnowCoverFetchPolicy, SnowCoverSettings, prepare};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

mod common;
use common::{first_difference, same, without_embedded_station_ski_areas};

#[derive(Deserialize)]
struct Scenes {
    scenes: Vec<Scene>,
}

#[derive(Deserialize)]
struct Scene {
    roles: Roles,
    archive: BTreeMap<String, Value>,
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
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("osd-snow-{}-{name}", std::process::id()));
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
    let document: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    document["features"].as_array().unwrap().clone()
}

#[test]
fn run_histories_and_ski_area_statistics_match_the_typescript_output() {
    let scenes: Scenes = serde_json::from_str(include_str!("snow_scenes.json")).unwrap();
    let (mut run_histories, mut area_statistics, mut by_activity) = (0, 0, 0);
    for (n, scene) in scenes.scenes.iter().enumerate() {
        let input_dir = scratch(&format!("in{n}"));
        let output_dir = scratch(&format!("out{n}"));
        let cache_path = scratch(&format!("cache{n}")).join("cache.db");
        write_inputs(&input_dir, &scene.roles);
        let cache = CacheStore::open(&cache_path).unwrap();
        let entries: Vec<(String, String)> = scene
            .archive
            .iter()
            .map(|(k, v)| (k.clone(), v.to_string()))
            .collect();
        cache
            .set_json_many(CacheKind::SnowCover, &entries, 1)
            .unwrap();
        drop(cache);

        prepare(&PrepareConfig {
            input_dir,
            output_dir: output_dir.clone(),
            bbox: None,
            cache_path,
            geocoding: None,
            elevation: None,
            snow_cover: Some(SnowCoverSettings {
                fetch_policy: SnowCoverFetchPolicy::None,
            }),
            generate_tiles: false,
        })
        .unwrap();

        for (file, want) in [
            ("ski_areas.geojson", &scene.expected.ski_areas),
            ("runs.geojson", &scene.expected.runs),
        ] {
            let got = features(&output_dir.join(file));
            assert_eq!(got.len(), want.len(), "scene {n} {file}: feature count");
            for (i, (g, w)) in got.iter().zip(want).enumerate() {
                let (g, w) = (
                    without_embedded_station_ski_areas(g.clone()),
                    without_embedded_station_ski_areas(w.clone()),
                );
                assert!(
                    same(&g, &w),
                    "scene {n} {file}[{i}]: {}",
                    first_difference(&g, &w, "").unwrap_or_default()
                );
                if file == "runs.geojson" && w["properties"].get("snowCoverHistory").is_some() {
                    run_histories += 1;
                }
                if let Some(snow) = w["properties"]["statistics"].get("snowCover") {
                    area_statistics += 1;
                    by_activity += snow["byActivity"].as_object().map_or(0, |o| o.len());
                }
            }
        }
    }
    assert!(
        run_histories > 80 && area_statistics > 30 && by_activity > 30,
        "{run_histories} {area_statistics} {by_activity}"
    );
}
