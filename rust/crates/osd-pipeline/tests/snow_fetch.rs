//! Bringing the snow cover archive up to date: the Python fetcher is run against the processor's
//! own cache file, and what it writes (with `snow-cover/src/sqlite_cache.py`) is what `prepare`
//! reads. The fetcher here is a stand-in for the network part -- it writes a year of weekly data
//! for each pixel it is asked about -- so the file format, the pixel hand-over and the policies
//! are exercised without NASA.

use osd_pipeline::prepare::{
    PrepareConfig, SnowCoverFetchPolicy, SnowCoverSettings, prepare, snow_cover_pixels_json,
};
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
    runs: Vec<Value>,
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("osd-snowfetch-{}-{name}", std::process::id()));
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

fn python_available() -> bool {
    std::process::Command::new("python3")
        .arg("--version")
        .output()
        .is_ok_and(|o| o.status.success())
}

fn sqlite_cache_dir() -> String {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../snow-cover/src")
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .into_owned()
}

/// A stand-in fetcher: records how it was called, and for the pixels it is given (or, with
/// `--fill-cache`, the pixels the archive already has) stores 2020's weeks at 50% snow.
fn write_fetcher(dir: &Path, exit_code: i32) -> PathBuf {
    let path = dir.join("fetch.py");
    fs::write(
        &path,
        format!(
            r#"
import json, sys
sys.path.insert(0, {src:?})
from sqlite_cache import SQLiteCacheSync

args = sys.argv[1:]
open({log:?}, "w").write(json.dumps(args))
archive = args[args.index("--archive-file") + 1]
cache = SQLiteCacheSync(archive, 0)
cache.initialize()
if "--pixels-json" in args:
    pixels = json.load(open(args[args.index("--pixels-json") + 1]))
    for tile, plist in pixels.items():
        for row, col in plist:
            cache.set(f"snow_cover:{{tile}}:{{row}}:{{col}}", [{{"year": 2020, "data": [[50, 0]] * 53}}])
cache.close()
sys.exit({exit_code})
"#,
            src = sqlite_cache_dir(),
            log = dir.join("args.json").to_string_lossy(),
        ),
    )
    .unwrap();
    path
}

fn scene_with_runs() -> Scene {
    let scenes: Scenes =
        serde_json::from_str(include_str!("../../osd-cluster/tests/cluster_scenes.json")).unwrap();
    scenes
        .scenes
        .into_iter()
        .find(|s| s.expected.runs.len() >= 2)
        .expect("a scene with runs")
}

fn config(
    input: &Path,
    output: &Path,
    cache: &Path,
    fetcher: &Path,
    policy: SnowCoverFetchPolicy,
) -> PrepareConfig {
    let mut settings = SnowCoverSettings::new(policy);
    settings.script = fetcher.to_owned();
    settings.python = Some(PathBuf::from("python3"));
    PrepareConfig {
        input_dir: input.to_owned(),
        output_dir: output.to_owned(),
        bbox: None,
        cache_path: cache.to_owned(),
        geocoding: None,
        elevation: None,
        snow_cover: Some(settings),
        generate_tiles: false,
    }
}

fn run_histories(output: &Path) -> Vec<Value> {
    let text = fs::read_to_string(output.join("runs.geojson")).unwrap();
    let document: Value = serde_json::from_str(&text).unwrap();
    document["features"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["properties"]["snowCoverHistory"].clone())
        .collect()
}

#[test]
fn what_the_fetcher_writes_is_what_prepare_reads() {
    if !python_available() {
        eprintln!("python3 is not installed: skipping");
        return;
    }
    let scene = scene_with_runs();
    let (input, output, work) = (
        scratch("full-in"),
        scratch("full-out"),
        scratch("full-work"),
    );
    write_inputs(&input, &scene.roles);
    let fetcher = write_fetcher(&work, 0);
    prepare(&config(
        &input,
        &output,
        &work.join("cache.db"),
        &fetcher,
        SnowCoverFetchPolicy::Full,
    ))
    .unwrap();

    // The fetcher was told the archive and the pixels.
    let args: Vec<String> =
        serde_json::from_str(&fs::read_to_string(work.join("args.json")).unwrap()).unwrap();
    assert!(
        args.windows(2)
            .any(|w| w[0] == "--archive-file" && w[1].ends_with("cache.db"))
    );
    assert!(args.windows(2).any(|w| w[0] == "--pixels-json"));
    assert!(!args.contains(&"--fill-cache".to_owned()));

    // Every run has the 53 weeks of 2020 as days at 50% snow, all pixels valid.
    let histories = run_histories(&output);
    assert!(histories.len() >= 2);
    for history in histories {
        let years = history.as_array().expect("a history");
        assert_eq!(years.len(), 1);
        assert_eq!(years[0]["year"], 2020);
        let days = years[0]["days"].as_array().unwrap();
        assert_eq!(days.len(), 53);
        assert_eq!(days[0], json!([1, 50, 100]));
        assert_eq!(days[1], json!([8, 50, 100]));
    }
}

#[test]
fn the_pixels_handed_over_are_those_the_runs_will_be_read_with() {
    let scene = scene_with_runs();
    let input = scratch("pixels-in");
    write_inputs(&input, &scene.roles);
    let loaded = osd_pipeline::prepare::load_formatted(&input).unwrap();
    let text = snow_cover_pixels_json(&loaded.runs);
    let pixels: Value = serde_json::from_str(&text).unwrap();
    let object = pixels.as_object().unwrap();
    assert!(!object.is_empty());
    let mut total = 0;
    let mut seen = std::collections::HashSet::new();
    for (tile, list) in object {
        assert!(tile.starts_with('h') && tile.contains('v'), "{tile}");
        for pair in list.as_array().unwrap() {
            assert!(
                seen.insert((tile.clone(), pair.to_string())),
                "a pixel twice"
            );
            total += 1;
        }
    }
    assert!(total > 0);
}

#[test]
fn the_incremental_policy_fills_the_archive_and_the_none_policy_leaves_it() {
    if !python_available() {
        eprintln!("python3 is not installed: skipping");
        return;
    }
    let scene = scene_with_runs();
    let (input, output, work) = (scratch("inc-in"), scratch("inc-out"), scratch("inc-work"));
    write_inputs(&input, &scene.roles);
    let fetcher = write_fetcher(&work, 0);
    prepare(&config(
        &input,
        &output,
        &work.join("cache.db"),
        &fetcher,
        SnowCoverFetchPolicy::Incremental,
    ))
    .unwrap();
    let args: Vec<String> =
        serde_json::from_str(&fs::read_to_string(work.join("args.json")).unwrap()).unwrap();
    assert!(args.contains(&"--fill-cache".to_owned()));
    assert!(!args.contains(&"--pixels-json".to_owned()));

    let (output2, work2) = (scratch("none-out"), scratch("none-work"));
    let fetcher2 = write_fetcher(&work2, 0);
    prepare(&config(
        &input,
        &output2,
        &work2.join("cache.db"),
        &fetcher2,
        SnowCoverFetchPolicy::None,
    ))
    .unwrap();
    assert!(!work2.join("args.json").exists(), "the fetcher was not run");
    assert!(run_histories(&output2).iter().all(Value::is_null));
}

#[test]
fn a_failing_fetcher_fails_the_run() {
    if !python_available() {
        eprintln!("python3 is not installed: skipping");
        return;
    }
    let scene = scene_with_runs();
    let (input, output, work) = (
        scratch("fail-in"),
        scratch("fail-out"),
        scratch("fail-work"),
    );
    write_inputs(&input, &scene.roles);
    let fetcher = write_fetcher(&work, 1);
    let error = prepare(&config(
        &input,
        &output,
        &work.join("cache.db"),
        &fetcher,
        SnowCoverFetchPolicy::Full,
    ))
    .unwrap_err();
    assert!(
        error.to_string().contains("Snow cover processing failed"),
        "{error}"
    );
}
