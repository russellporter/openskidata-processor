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
            cache_path: scratch("unused-cache").join("cache.db"),
            geocoding: None,
            elevation: None,
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
        cache_path: scratch("unused-cache").join("cache.db"),
        geocoding: None,
        elevation: None,
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
        cache_path: scratch("unused-cache").join("cache.db"),
        geocoding: None,
        elevation: None,
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
        cache_path: scratch("unused-cache").join("cache.db"),
        geocoding: None,
        elevation: None,
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

/// A server that answers every request from a function of its body, until shut down.
struct FixedServer {
    url: String,
    requests: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    address: std::net::SocketAddr,
}

impl FixedServer {
    fn start(answer: impl Fn(&str) -> String + Send + Sync + 'static) -> FixedServer {
        use std::io::{Read, Write};
        use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let requests = std::sync::Arc::new(AtomicUsize::new(0));
        let stop = std::sync::Arc::new(AtomicBool::new(false));
        let answer = std::sync::Arc::new(answer);
        let (counter, flag) = (requests.clone(), stop.clone());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                if flag.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(mut stream) = stream else { continue };
                counter.fetch_add(1, Ordering::SeqCst);
                let answer = answer.clone();
                std::thread::spawn(move || {
                    let mut buffer = [0u8; 4096];
                    let mut received = Vec::new();
                    let head_end = loop {
                        if let Some(at) = received.windows(4).position(|w| w == b"\r\n\r\n") {
                            break at + 4;
                        }
                        match stream.read(&mut buffer) {
                            Ok(0) | Err(_) => return,
                            Ok(n) => received.extend_from_slice(&buffer[..n]),
                        }
                    };
                    let head = String::from_utf8_lossy(&received[..head_end]).to_lowercase();
                    let length = head
                        .lines()
                        .find_map(|l| {
                            l.strip_prefix("content-length:")
                                .map(|v| v.trim().parse().unwrap_or(0))
                        })
                        .unwrap_or(0usize);
                    while received.len() < head_end + length {
                        match stream.read(&mut buffer) {
                            Ok(0) | Err(_) => break,
                            Ok(n) => received.extend_from_slice(&buffer[..n]),
                        }
                    }
                    let body = answer(&String::from_utf8_lossy(&received[head_end..]));
                    let _ = write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                });
            }
        });
        FixedServer {
            url: format!("http://{address}/geo"),
            requests,
            stop,
            address,
        }
    }

    /// Every request answered with the same Photon response.
    fn photon() -> FixedServer {
        Self::start(|_| {
            r#"{"features":[{"properties":{"countrycode":"AT","state":"Vienna","city":"Wien"}}]}"#
                .to_owned()
        })
    }

    fn requests(&self) -> usize {
        self.requests.load(std::sync::atomic::Ordering::SeqCst)
    }

    fn shut_down(self) {
        self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = std::net::TcpStream::connect(self.address);
    }
}

#[test]
fn prepare_geocodes_and_a_second_run_needs_no_server() {
    use osd_pipeline::prepare::GeocodingSettings;
    let scenes: Scenes =
        serde_json::from_str(include_str!("../../osd-cluster/tests/cluster_scenes.json")).unwrap();
    let scene = scenes
        .scenes
        .iter()
        .find(|s| s.expected.runs.len() >= 2)
        .expect("a scene with runs");
    let input_dir = scratch("geo-in");
    write_inputs(&input_dir, &scene.roles);
    let cache_path = scratch("geo-cache").join("cache.db");

    let server = FixedServer::photon();
    let settings = |url: &str| GeocodingSettings {
        url: url.to_owned(),
        server_type: osd_enrich::http_geocoder::ServerType::Photon,
        cache_ttl_ms: 1_000_000_000_000,
    };
    let run = |out: &str, url: &str| {
        let output_dir = scratch(out);
        prepare(&PrepareConfig {
            input_dir: input_dir.clone(),
            output_dir: output_dir.clone(),
            bbox: None,
            cache_path: cache_path.clone(),
            geocoding: Some(settings(url)),
            elevation: None,
        })
        .unwrap();
        output_dir
    };

    let first = run("geo-out-1", &server.url);
    let asked = server.requests();
    assert!(asked > 0, "the server was asked");
    let runs = features(&first.join("runs.geojson"));
    assert!(!runs.is_empty());
    for run in &runs {
        assert_eq!(
            run["properties"]["places"],
            json!([{
                "iso3166_1Alpha2": "AT",
                "iso3166_2": "AT-9",
                "localized": {"en": {"country": "Austria", "region": "Vienna", "locality": "Wien"}}
            }]),
            "{}",
            run["properties"]["id"]
        );
    }
    // The CSV shows them too.
    let csv = fs::read_to_string(first.join("csv").join("runs.csv")).unwrap();
    assert!(csv.contains("Austria,Vienna,Wien"), "{csv}");

    // A second run, the server gone: every cell comes from the cache, and the output is the same.
    server.shut_down();
    let second = run("geo-out-2", "http://127.0.0.1:1/geo");
    for file in [
        "runs.geojson",
        "lifts.geojson",
        "spots.geojson",
        "ski_areas.geojson",
    ] {
        assert_eq!(
            fs::read_to_string(first.join(file)).unwrap(),
            fs::read_to_string(second.join(file)).unwrap(),
            "{file}"
        );
    }
}

#[test]
fn prepare_elevates_and_a_second_run_needs_no_server() {
    use osd_pipeline::prepare::{ElevationServer, ElevationSettings};
    let scenes: Scenes =
        serde_json::from_str(include_str!("../../osd-cluster/tests/cluster_scenes.json")).unwrap();
    let scene = scenes
        .scenes
        .iter()
        .find(|s| s.expected.runs.len() >= 2 && !s.expected.lifts.is_empty())
        .expect("a scene with runs and a lift");
    let input_dir = scratch("elev-in");
    write_inputs(&input_dir, &scene.roles);
    let cache_path = scratch("elev-cache").join("cache.db");

    // Every coordinate is at 1500.0 m, whatever is asked.
    let server = FixedServer::start(|body| {
        let asked: Vec<[f64; 2]> = serde_json::from_str(body).unwrap();
        format!("[{}]", vec!["1500.0"; asked.len()].join(","))
    });
    let run = |out: &str, url: &str| {
        let output_dir = scratch(out);
        prepare(&PrepareConfig {
            input_dir: input_dir.clone(),
            output_dir: output_dir.clone(),
            bbox: None,
            cache_path: cache_path.clone(),
            geocoding: None,
            elevation: Some(ElevationSettings {
                server: ElevationServer::Racemap {
                    url: url.to_owned(),
                },
                batch_size: 10_000,
            }),
        })
        .unwrap();
        output_dir
    };

    let first = run("elev-out-1", &server.url);
    assert!(server.requests() > 0, "the server was asked");
    for run in features(&first.join("runs.geojson")) {
        let coordinates = run["geometry"]["coordinates"].as_array().unwrap();
        let first_coordinate = if run["geometry"]["type"] == "LineString" {
            &coordinates[0]
        } else {
            &coordinates[0][0]
        };
        assert_eq!(first_coordinate[2], 1500.0, "{}", run["properties"]["id"]);
        if run["geometry"]["type"] == "LineString" {
            let heights = run["properties"]["elevationProfile"]["heights"]
                .as_array()
                .unwrap();
            assert!(heights.iter().all(|h| *h == 1500.0));
        }
    }
    let lift = features(&first.join("lifts.geojson")).remove(0);
    assert_eq!(lift["geometry"]["coordinates"][0][2], 1500.0);

    // The metadata counts lengths now, and the lift CSV has its elevation columns.
    let metadata: Value =
        serde_json::from_str(&fs::read_to_string(first.join("metadata.json")).unwrap()).unwrap();
    assert!(metadata["totals"]["runLengthKm"].as_f64().unwrap() > 0.0);
    assert!(metadata["totals"]["liftLengthKm"].as_f64().unwrap() > 0.0);
    let csv = fs::read_to_string(first.join("csv").join("lifts.csv")).unwrap();
    assert!(csv.lines().nth(1).unwrap().contains(",1500,1500,"), "{csv}");

    // A second run with the server gone: every cell comes from the cache.
    server.shut_down();
    let second = run("elev-out-2", "http://127.0.0.1:1/elevation");
    for file in [
        "runs.geojson",
        "lifts.geojson",
        "spots.geojson",
        "ski_areas.geojson",
    ] {
        assert_eq!(
            fs::read_to_string(first.join(file)).unwrap(),
            fs::read_to_string(second.join(file)).unwrap(),
            "{file}"
        );
    }
}

mod support;

/// A flat 16 by 16 Mapbox Terrain-RGB tile of 1234.5 m, as a PNG.
fn flat_tile() -> Vec<u8> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, 16, 16);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().unwrap();
    // (1234.5 + 10000) * 10 = 112345 = 0x01B6D9.
    let pixels: Vec<u8> = (0..16 * 16).flat_map(|_| [0x01, 0xB6, 0xD9]).collect();
    writer.write_image_data(&pixels).unwrap();
    drop(writer);
    out
}

#[test]
fn heights_can_come_from_terrain_tiles() {
    let scenes: Scenes =
        serde_json::from_str(include_str!("../../osd-cluster/tests/cluster_scenes.json")).unwrap();
    let scene = scenes
        .scenes
        .iter()
        .find(|s| s.expected.runs.len() >= 2 && !s.expected.lifts.is_empty())
        .expect("a scene with runs and lifts");
    let input_dir = scratch("tiles-in");
    let output_dir = scratch("tiles-out");
    let cache_dir = scratch("tiles-cache");
    write_inputs(&input_dir, &scene.roles);

    let tile = flat_tile();
    let server = support::Server::start_bytes(std::time::Duration::ZERO, move |_, _, _| {
        (200, tile.clone())
    });
    prepare(&PrepareConfig {
        input_dir,
        output_dir: output_dir.clone(),
        bbox: None,
        cache_path: cache_dir.join("cache.db"),
        geocoding: None,
        elevation: Some(osd_pipeline::prepare::ElevationSettings {
            server: osd_pipeline::prepare::ElevationServer::Tile(
                osd_enrich::terrain::TerrainTileConfig {
                    url_template: format!(
                        "{}/{{z}}/{{x}}/{{y}}.png",
                        server.url.trim_end_matches("/geo")
                    ),
                    encoding: osd_enrich::terrain::TileEncoding::Mapbox,
                    tile_size: 16,
                    cache_dir: cache_dir.join("tiles"),
                    cache_max_tiles: 1000,
                    tile_concurrency: 2,
                    zooms: vec![12],
                },
            ),
            batch_size: 1000,
        }),
    })
    .unwrap();

    // Every run and lift coordinate has the flat tile's height.
    let mut heights = 0;
    for file in ["runs.geojson", "lifts.geojson"] {
        for feature in features(&output_dir.join(file)) {
            let geometry = &feature["geometry"];
            let mut stack = vec![&geometry["coordinates"]];
            while let Some(value) = stack.pop() {
                match value.as_array() {
                    Some(a) if a.len() >= 3 && a.iter().all(Value::is_number) => {
                        assert_eq!(a[2].as_f64(), Some(1234.5), "{file}: {value}");
                        heights += 1;
                    }
                    Some(a) => stack.extend(a),
                    None => {}
                }
            }
        }
    }
    assert!(heights > 0);
    assert!(server.request_count() > 0);
    // The tile cache was saved when the run finished.
    assert!(cache_dir.join("tiles/cache-index.json").exists());
}
