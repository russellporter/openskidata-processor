//! The download step against the real TypeScript's query builders, bounding box filter and
//! provenance file (`rust/codegen/generate-download-vectors.mjs`), and against a stub
//! Overpass/Skimap server for what the vectors cannot show: retries, concurrency, files.

use osd_pipeline::download::{
    DownloadConfig, bbox_setting, download, download_metadata_json, earliest_timestamp,
    encode_uri_component, lifts_query, point_strictly_inside, read_osm_data_timestamp, runs_query,
    ski_area_sites_query, ski_areas_query, spots_query,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

mod support;
use support::Server;

#[derive(Deserialize)]
struct Vectors {
    queries: Vec<QueryCase>,
    uri: Vec<UriCase>,
    containment: Vec<Containment>,
    timestamps: Vec<TimestampCase>,
    earliest: Vec<EarliestCase>,
    metadata: Vec<MetadataCase>,
}

#[derive(Deserialize)]
struct QueryCase {
    bbox: Option<Vec<f64>>,
    queries: Option<BTreeMap<String, String>>,
    urls: Option<BTreeMap<String, String>>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct UriCase {
    text: String,
    encoded: String,
}

#[derive(Deserialize)]
struct Containment {
    bbox: Vec<f64>,
    points: Vec<[f64; 2]>,
    inside: Vec<bool>,
}

#[derive(Deserialize)]
struct TimestampCase {
    head: String,
    timestamp: Option<String>,
}

#[derive(Deserialize)]
struct EarliestCase {
    input: Vec<Option<String>>,
    expected: Option<String>,
}

#[derive(Deserialize)]
struct MetadataCase {
    #[serde(rename = "startedAt")]
    started_at: String,
    #[serde(rename = "dataTimestamp")]
    data_timestamp: Option<String>,
    #[serde(rename = "downloadedAt")]
    downloaded_at: String,
    text: String,
}

fn vectors() -> Vectors {
    serde_json::from_str(include_str!("download_vectors.json")).unwrap()
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("osd-download-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn every_recorded_query_is_reproduced_character_for_character() {
    let vectors = vectors();
    let mut compared = 0;
    for case in &vectors.queries {
        let bbox = case.bbox.as_deref();
        let built = [
            ("runs", runs_query(bbox)),
            ("lifts", lifts_query(bbox)),
            ("skiAreas", ski_areas_query(bbox)),
            ("skiAreaSites", ski_area_sites_query(bbox)),
            ("spots", spots_query(bbox)),
        ];
        match (&case.queries, &case.error) {
            (Some(queries), _) => {
                for (name, query) in built {
                    assert_eq!(
                        &query.unwrap(),
                        &queries[name],
                        "{name} for {:?}",
                        case.bbox
                    );
                    compared += 1;
                }
                for (name, url) in case.urls.as_ref().unwrap() {
                    assert_eq!(
                        format!(
                            "https://lz4.overpass-api.de/api/interpreter?data={}",
                            encode_uri_component(&queries[name])
                        ),
                        *url,
                        "{name} url"
                    );
                }
            }
            (None, Some(error)) => {
                for (name, query) in built {
                    assert_eq!(&query.unwrap_err().to_string(), error, "{name}");
                }
                assert_eq!(&bbox_setting(bbox).unwrap_err().to_string(), error);
            }
            _ => panic!("a case has neither queries nor an error"),
        }
    }
    assert!(compared >= 150, "{compared}");
}

#[test]
fn uri_components_are_encoded_as_javascript_does() {
    for case in vectors().uri {
        assert_eq!(encode_uri_component(&case.text), case.encoded);
    }
}

#[test]
fn the_skimap_bounding_box_filter_keeps_what_turf_keeps() {
    let mut inside = 0;
    let mut outside = 0;
    for case in vectors().containment {
        for (point, want) in case.points.iter().zip(&case.inside) {
            assert_eq!(
                point_strictly_inside(&case.bbox, *point),
                *want,
                "{point:?} in {:?}",
                case.bbox
            );
            if *want { inside += 1 } else { outside += 1 }
        }
    }
    assert!(inside > 50 && outside > 400, "{inside} {outside}");
}

#[test]
fn the_osm_timestamp_is_read_from_the_first_four_kilobytes() {
    let dir = scratch("timestamps");
    for (i, case) in vectors().timestamps.iter().enumerate() {
        let path = dir.join(format!("head-{i}.json"));
        std::fs::write(&path, &case.head).unwrap();
        assert_eq!(read_osm_data_timestamp(&path), case.timestamp, "case {i}");
    }
    assert_eq!(read_osm_data_timestamp(&dir.join("missing.json")), None);
}

#[test]
fn the_earliest_timestamp_is_written_as_to_iso_string_does() {
    for case in vectors().earliest {
        assert_eq!(
            earliest_timestamp(&case.input),
            case.expected,
            "{:?}",
            case.input
        );
    }
}

#[test]
fn the_provenance_file_is_written_as_json_stringify_does() {
    for case in vectors().metadata {
        assert_eq!(
            download_metadata_json(
                &case.started_at,
                case.data_timestamp.as_deref(),
                &case.downloaded_at
            ),
            case.text
        );
    }
}

// ---------------------------------------------------------------------------------------
// Against stub servers
// ---------------------------------------------------------------------------------------

fn config(dir: PathBuf, overpass: &Server, skimap: &Server) -> DownloadConfig {
    let mut config = DownloadConfig::new(dir, None, None);
    config.overpass_lz4 = overpass.url.clone();
    config.overpass_z = overpass.url.clone();
    config.skimap_url = skimap.url.clone();
    config.retry_wait = Duration::from_millis(10);
    config
}

fn overpass_answer(path: &str) -> String {
    let which = if path.contains("piste%3Atype") {
        "runs"
    } else if path.contains("aerialway%3Dstation") {
        "spots"
    } else if path.contains("winter_sports") {
        "skiAreas"
    } else if path.contains("%3E%3E") {
        "lifts"
    } else {
        "sites"
    };
    format!(
        r#"{{"version":0.6,"osm3s":{{"timestamp_osm_base":"2026-11-02T10:0{}:00Z"}},"which":"{which}","elements":[]}}"#,
        which.len() % 9
    )
}

fn skimap_body() -> String {
    let point = |id: u32, x: f64, y: f64| json!({"type":"Feature","properties":{"id":id},"geometry":{"type":"Point","coordinates":[x,y]}});
    json!({"type":"FeatureCollection","features":[
        point(1, 11.5, 47.5), point(2, 12.0, 47.5), point(3, 30.0, 47.5), point(4, 11.5, 50.0),
    ]})
    .to_string()
}

#[test]
fn it_queries_overpass_filters_skimap_and_records_the_provenance() {
    let overpass = Server::start(Duration::from_millis(30), |_, path| {
        (200, overpass_answer(path))
    });
    let skimap = Server::start(Duration::ZERO, |_, _| (200, skimap_body()));
    let dir = scratch("full");
    let mut config = config(dir.clone(), &overpass, &skimap);
    config.bbox = Some(vec![11.0, 47.0, 12.0, 48.0]);
    download(&config).unwrap();

    assert_eq!(overpass.request_count(), 5);
    let paths = overpass.paths();
    assert!(
        paths.iter().all(
            |p| p.starts_with("/geo?data=%0A%20%20%20%20%5Bout%3Ajson%5D")
                || p.starts_with("/geo?data=%0A%20%20%5Bout%3Ajson%5D")
        ),
        "{paths:?}"
    );
    assert!(
        paths
            .iter()
            .all(|p| p.contains("%5Bbbox%3A47%2C11%2C48%2C12%5D")),
        "{paths:?}"
    );
    for (file, which) in [
        ("input_runs.osmjson", "runs"),
        ("input_lifts.osmjson", "lifts"),
        ("input_ski_areas.osmjson", "skiAreas"),
        ("input_ski_area_sites.osmjson", "sites"),
        ("input_spots.osmjson", "spots"),
    ] {
        let text = std::fs::read_to_string(dir.join(file)).unwrap();
        assert!(text.contains(&format!(r#""which":"{which}""#)), "{file}");
    }

    // Only the point strictly inside the box is kept.
    let skimap_file: Value = serde_json::from_str(
        &std::fs::read_to_string(dir.join("input_skimap_ski_areas.geojson")).unwrap(),
    )
    .unwrap();
    let ids: Vec<u64> = skimap_file["features"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["properties"]["id"].as_u64().unwrap())
        .collect();
    assert_eq!(ids, vec![1]);

    // The earliest of the five timestamps, and when Skimap.org was fetched.
    let metadata: Value = serde_json::from_str(
        &std::fs::read_to_string(dir.join("input_download_metadata.json")).unwrap(),
    )
    .unwrap();
    let data_timestamp = metadata["openStreetMap"]["dataTimestamp"].as_str().unwrap();
    assert!(data_timestamp.starts_with("2026-11-02T10:0") && data_timestamp.ends_with(":00.000Z"));
    assert!(metadata["startedAt"].as_str().unwrap().ends_with('Z'));
    assert!(metadata["skiMapOrg"]["downloadedAt"].as_str().is_some());
}

#[test]
fn the_runs_query_runs_beside_the_others_but_one_endpoint_is_never_asked_twice_at_once() {
    let z = Server::start(Duration::from_millis(80), |_, path| {
        (200, overpass_answer(path))
    });
    let lz4 = Server::start(Duration::from_millis(80), |_, path| {
        (200, overpass_answer(path))
    });
    let skimap = Server::start(Duration::ZERO, |_, _| (200, skimap_body()));
    let dir = scratch("concurrency");
    let mut config = config(dir, &lz4, &skimap);
    config.overpass_z = z.url.clone();
    download(&config).unwrap();
    assert_eq!(z.request_count(), 1);
    assert_eq!(lz4.request_count(), 4);
    assert_eq!(lz4.max_in_flight.load(Ordering::SeqCst), 1);
}

#[test]
fn a_failed_download_is_retried_and_the_same_url_is_asked_again() {
    let failures = Arc::new(AtomicUsize::new(0));
    let counter = failures.clone();
    let overpass = Server::start(Duration::ZERO, move |_, path| {
        // The first two answers to the lifts query fail.
        if path.contains("%3E%3E") && counter.fetch_add(1, Ordering::SeqCst) < 2 {
            return (429, "{}".into());
        }
        (200, overpass_answer(path))
    });
    let skimap = Server::start(Duration::ZERO, |_, _| (200, skimap_body()));
    let dir = scratch("retry");
    download(&config(dir.clone(), &overpass, &skimap)).unwrap();
    assert_eq!(overpass.request_count(), 7);
    assert!(dir.join("input_lifts.osmjson").exists());
    // No box: Skimap.org's file is kept whole.
    let kept: Value = serde_json::from_str(
        &std::fs::read_to_string(dir.join("input_skimap_ski_areas.geojson")).unwrap(),
    )
    .unwrap();
    assert_eq!(kept["features"].as_array().unwrap().len(), 4);
}

#[test]
fn it_gives_up_after_the_retries_and_leaves_no_partial_file() {
    let overpass = Server::start(Duration::ZERO, |_, _| (503, "{}".into()));
    let skimap = Server::start(Duration::ZERO, |_, _| (200, skimap_body()));
    let dir = scratch("giveup");
    let mut config = config(dir.clone(), &overpass, &skimap);
    config.retries = 2;
    let error = download(&config).unwrap_err().to_string();
    assert!(error.contains("status: 503"), "{error}");
    assert!(!dir.join("input_runs.osmjson").exists());
    assert!(!dir.join("input_runs.part").exists());
}

#[test]
fn osm_input_dir_replaces_the_overpass_queries() {
    let source = scratch("osm-source");
    for file in [
        "input_runs.osmjson",
        "input_lifts.osmjson",
        "input_ski_areas.osmjson",
        "input_ski_area_sites.osmjson",
        "input_spots.osmjson",
    ] {
        std::fs::write(
            source.join(file),
            r#"{"osm3s":{"timestamp_osm_base":"2026-11-02T10:11:12Z"},"elements":[]}"#,
        )
        .unwrap();
    }
    let overpass = Server::start(Duration::ZERO, |_, _| (500, "{}".into()));
    let skimap = Server::start(Duration::ZERO, |_, _| (200, skimap_body()));
    let dir = scratch("osm-input-dir");
    let mut config = config(dir.clone(), &overpass, &skimap);
    config.osm_input_dir = Some(source);
    download(&config).unwrap();
    assert_eq!(overpass.request_count(), 0);
    let metadata = std::fs::read_to_string(dir.join("input_download_metadata.json")).unwrap();
    assert!(
        metadata.contains(r#""dataTimestamp": "2026-11-02T10:11:12.000Z""#),
        "{metadata}"
    );
}

#[test]
fn requests_say_who_is_asking() {
    let skimap = Server::start(Duration::ZERO, |_, _| (200, skimap_body()));
    let overpass = Server::start(Duration::ZERO, |_, path| (200, overpass_answer(path)));
    download(&config(scratch("headers"), &overpass, &skimap)).unwrap();
    let head = skimap.heads.lock().unwrap()[0].to_lowercase();
    assert!(
        head.contains("user-agent: openskidata-processor (+https://openskimap.org)"),
        "{head}"
    );
    assert!(head.contains("referer: https://openskimap.org"), "{head}");
}
