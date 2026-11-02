//! The terrain-tile elevation source against the real TypeScript
//! (`rust/codegen/generate-tile-vectors.mjs`): the tile maths, the encodings, what sharp decodes
//! tiles to, and whole runs against a local tile server, with the cache directory they leave.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use osd_enrich::terrain::{
    TerrainTileConfig, TerrainTileSource, TileEncoding, bilinear_interpolate, decode_mapbox,
    decode_terrarium, decode_tile, interpolation_setup, lon_lat_to_tile_pixel,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

mod support;
use support::Server;

#[derive(Deserialize)]
struct Vectors {
    tile: u32,
    pixels: Vec<PixelCase>,
    setups: Vec<SetupCase>,
    decode: Vec<DecodeCase>,
    bilinear: Vec<BilinearCase>,
    images: Vec<ImageCase>,
    scenarios: Vec<Scenario>,
}

#[derive(Deserialize)]
struct PixelCase {
    lon: f64,
    lat: f64,
    zoom: u32,
    #[serde(rename = "tileSize")]
    tile_size: u32,
    result: PixelResult,
}

#[derive(Deserialize)]
struct PixelResult {
    #[serde(rename = "tileX")]
    tile_x: i64,
    #[serde(rename = "tileY")]
    tile_y: i64,
    #[serde(rename = "pixelX")]
    pixel_x: f64,
    #[serde(rename = "pixelY")]
    pixel_y: f64,
}

#[derive(Deserialize)]
struct SetupCase {
    #[serde(rename = "tileX")]
    tile_x: i64,
    #[serde(rename = "tileY")]
    tile_y: i64,
    #[serde(rename = "pixelX")]
    pixel_x: f64,
    #[serde(rename = "pixelY")]
    pixel_y: f64,
    zoom: u32,
    #[serde(rename = "tileSize")]
    tile_size: u32,
    result: Option<SetupResult>,
}

#[derive(Deserialize)]
struct SetupResult {
    corners: Vec<PixelResult>,
    fx: f64,
    fy: f64,
}

#[derive(Deserialize)]
struct DecodeCase {
    rgb: [f64; 3],
    mapbox: f64,
    terrarium: f64,
}

#[derive(Deserialize)]
struct BilinearCase {
    e: [f64; 4],
    fx: f64,
    fy: f64,
    result: f64,
}

#[derive(Deserialize)]
struct ImageCase {
    format: String,
    encoded: String,
    width: usize,
    channels: usize,
    raw: String,
}

#[derive(Deserialize)]
struct Scenario {
    encoding: TileEncoding,
    zooms: Vec<u32>,
    #[serde(rename = "maxTiles")]
    max_tiles: usize,
    calls: Vec<Call>,
    state: State,
    responses: HashMap<String, Response>,
}

#[derive(Deserialize)]
struct Call {
    points: Vec<[f64; 2]>,
    results: Vec<Outcome>,
    requests: Vec<String>,
    state: Option<State>,
}

#[derive(Deserialize)]
struct Outcome {
    value: Option<f64>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct Response {
    status: u16,
    body: String,
}

#[derive(Deserialize, Debug, PartialEq)]
struct State {
    files: Vec<String>,
    index: Vec<String>,
    missing: Vec<String>,
}

fn vectors() -> Vectors {
    serde_json::from_str(include_str!("tile_vectors.json")).unwrap()
}

fn close(a: f64, b: f64) -> bool {
    a == b || (a - b).abs() <= 1e-9 * b.abs().max(1.0)
}

#[test]
fn tile_and_pixel_coordinates_match() {
    let mut worst: f64 = 0.0;
    for case in vectors().pixels {
        let got = lon_lat_to_tile_pixel(case.lon, case.lat, case.zoom, case.tile_size);
        let want = &case.result;
        let context = format!(
            "{} {} z{} size {}",
            case.lon, case.lat, case.zoom, case.tile_size
        );
        assert_eq!(
            (got.tile_x, got.tile_y),
            (want.tile_x, want.tile_y),
            "{context}"
        );
        worst = worst
            .max((got.pixel_x - want.pixel_x).abs())
            .max((got.pixel_y - want.pixel_y).abs());
        assert!(
            close(got.pixel_x, want.pixel_x),
            "{context}: {} {}",
            got.pixel_x,
            want.pixel_x
        );
        assert!(
            close(got.pixel_y, want.pixel_y),
            "{context}: {} {}",
            got.pixel_y,
            want.pixel_y
        );
    }
    eprintln!("largest pixel difference: {worst:e}");
}

#[test]
fn interpolation_corners_cross_tile_borders_and_stop_at_the_poles() {
    let (mut found, mut none) = (0, 0);
    for case in vectors().setups {
        let got = interpolation_setup(
            case.tile_x,
            case.tile_y,
            case.pixel_x,
            case.pixel_y,
            case.zoom,
            case.tile_size,
        );
        match (got, case.result) {
            (None, None) => none += 1,
            (Some(got), Some(want)) => {
                found += 1;
                assert_eq!((got.fx, got.fy), (want.fx, want.fy));
                for (g, w) in got.corners.iter().zip(&want.corners) {
                    assert_eq!(
                        (g.tile_x, g.tile_y, g.pixel_x as f64, g.pixel_y as f64),
                        (w.tile_x, w.tile_y, w.pixel_x, w.pixel_y)
                    );
                }
            }
            (got, want) => panic!("got {got:?}, want {:?}", want.is_some()),
        }
    }
    assert!(found > 200 && none > 20, "{found} {none}");
}

#[test]
fn encodings_and_interpolation_are_exact() {
    let vectors = vectors();
    for case in &vectors.decode {
        let [r, g, b] = case.rgb;
        assert_eq!(decode_mapbox(r, g, b), case.mapbox);
        assert_eq!(decode_terrarium(r, g, b), case.terrarium);
    }
    for case in &vectors.bilinear {
        let [a, b, c, d] = case.e;
        assert_eq!(
            bilinear_interpolate(a, b, c, d, case.fx, case.fy),
            case.result
        );
    }
}

#[test]
fn tiles_decode_to_what_sharp_decodes_them_to() {
    for case in vectors().images {
        let encoded = STANDARD.decode(&case.encoded).unwrap();
        let raw = STANDARD.decode(&case.raw).unwrap();
        let tile = decode_tile(&encoded).unwrap_or_else(|e| panic!("{}: {e}", case.format));
        assert_eq!(tile.width, case.width, "{}", case.format);
        // Sharp keeps an alpha channel; the tile here is the colour channels only.
        let expected: Vec<u8> = raw
            .chunks_exact(case.channels)
            .flat_map(|p| [p[0], p[1], p[2]])
            .collect();
        assert_eq!(tile.rgb, expected, "{}", case.format);
    }
}

#[test]
fn undecodable_data_is_an_error() {
    assert!(decode_tile(b"not an image at all").is_err());
    assert!(decode_tile(b"RIFF\0\0\0\0WEBPjunkjunkjunk").is_err());
    assert!(decode_tile(b"\x89PNG\r\n\x1a\ntruncated").is_err());
    assert!(decode_tile(b"").is_err());
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("osd-terrain-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn files_under(dir: &Path, base: &Path, out: &mut Vec<String>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            files_under(&path, base, out);
        } else if path.extension().is_some_and(|e| e == "webp") {
            out.push(
                path.strip_prefix(base)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
            );
        }
    }
}

fn state(dir: &Path) -> State {
    let mut files = Vec::new();
    files_under(dir, dir, &mut files);
    files.sort();
    let index: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("cache-index.json")).unwrap())
            .unwrap();
    State {
        files,
        index: serde_json::from_value(index["keys"].clone()).unwrap(),
        missing: serde_json::from_str(
            &std::fs::read_to_string(dir.join("missing-tiles.json")).unwrap(),
        )
        .unwrap(),
    }
}

fn sorted(mut state: State) -> State {
    state.files.sort();
    state
}

#[test]
fn every_recorded_run_against_a_tile_server_is_reproduced() {
    let vectors = vectors();
    let (mut heights, mut nulls, mut errors, mut cached_runs) = (0, 0, 0, 0);
    for (n, scenario) in vectors.scenarios.iter().enumerate() {
        let responses: HashMap<String, (u16, Vec<u8>)> = scenario
            .responses
            .iter()
            .map(|(path, r)| (path.clone(), (r.status, STANDARD.decode(&r.body).unwrap())))
            .collect();
        let server = Server::start_bytes(Duration::ZERO, move |_, path, _| {
            responses.get(path).cloned().unwrap_or((599, Vec::new()))
        });
        let dir = scratch(&format!("scenario-{n}"));
        let config = TerrainTileConfig {
            url_template: format!(
                "{}/{{z}}/{{x}}/{{y}}.webp",
                server.url.trim_end_matches("/geo")
            ),
            encoding: scenario.encoding,
            tile_size: vectors.tile,
            cache_dir: dir.clone(),
            cache_max_tiles: scenario.max_tiles,
            tile_concurrency: 1,
            zooms: scenario.zooms.clone(),
        };
        let mut source = TerrainTileSource::new(config.clone()).unwrap();
        let mut asked = 0;
        for (c, call) in scenario.calls.iter().enumerate() {
            let results = source.fetch_elevations(&call.points, &scenario.zooms);
            let context = format!("scenario {n} call {c}");
            assert_eq!(results.len(), call.results.len(), "{context}");
            for (i, (got, want)) in results.iter().zip(&call.results).enumerate() {
                let context = format!("{context} point {i} {:?}", call.points[i]);
                match (got, want.value, &want.error) {
                    (Ok(Some(got)), Some(want), _) => {
                        heights += 1;
                        assert!(close(*got, want), "{context}: {got} vs {want}");
                    }
                    (Ok(None), None, None) => nulls += 1,
                    (Err(got), _, Some(want)) => {
                        errors += 1;
                        if want.starts_with("Failed to decode tile ") {
                            // The reason is sharp's wording.
                            let prefix = want.split(": ").next().unwrap();
                            assert!(got.starts_with(prefix), "{context}: {got}");
                        } else {
                            assert_eq!(got, want, "{context}");
                        }
                    }
                    other => panic!(
                        "{context}: got {other:?}, want {:?} {:?}",
                        want.value, want.error
                    ),
                }
            }
            let paths = server.paths();
            assert_eq!(
                paths[asked..],
                call.requests[..],
                "{context}: URLs requested"
            );
            if asked > 0 && call.requests.is_empty() {
                cached_runs += 1;
            }
            asked = paths.len();
            if let Some(want) = &call.state {
                source.close().unwrap();
                assert_eq!(
                    sorted(state(&dir)),
                    sorted(State {
                        ..clone_state(want)
                    }),
                    "{context}: cache"
                );
                source = TerrainTileSource::new(config.clone()).unwrap();
            }
        }
        source.close().unwrap();
        assert_eq!(
            sorted(state(&dir)),
            sorted(clone_state(&scenario.state)),
            "scenario {n}: cache at the end"
        );
    }
    assert!(
        heights > 300 && nulls > 40 && errors > 40,
        "{heights} {nulls} {errors}"
    );
    assert!(cached_runs >= 1);
}

fn clone_state(state: &State) -> State {
    State {
        files: state.files.clone(),
        index: state.index.clone(),
        missing: state.missing.clone(),
    }
}
