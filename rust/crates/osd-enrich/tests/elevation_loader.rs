//! The elevation loader against the real `ElevationProcessor`
//! (`rust/codegen/generate-elevation-loader-vectors.mjs`): geometries given elevations by a
//! Racemap-style server whose answer is a function of the one-metre geohash cell, at three batch
//! sizes, each run twice -- the second time with a new loader reading what the first cached, as
//! 32-bit floats.

use osd_cache::CacheStore;
use osd_cache::geohash;
use osd_enrich::elevation::{ElevationLoader, RacemapSource, geometry_elevations};
use osd_osm::element::{Geometry, Position};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

mod support;
use support::Server;

#[derive(Deserialize)]
struct Vectors {
    geometries: Vec<Value>,
    runs: Vec<Run>,
}

#[derive(Deserialize)]
struct Run {
    #[serde(rename = "batchSize")]
    batch_size: usize,
    passes: Vec<Pass>,
}

#[derive(Deserialize)]
struct Pass {
    results: Vec<Outcome>,
    /// How many coordinates the server was asked about in all.
    requested: usize,
}

#[derive(Deserialize)]
struct Outcome {
    z: Option<Vec<f64>>,
    error: Option<String>,
}

fn positions(v: &Value) -> Vec<Position> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|p| [p[0].as_f64().unwrap(), p[1].as_f64().unwrap()])
        .collect()
}

fn rings(v: &Value) -> Vec<Vec<Position>> {
    v.as_array().unwrap().iter().map(positions).collect()
}

fn geometry(v: &Value) -> Geometry {
    let c = &v["coordinates"];
    match v["type"].as_str().unwrap() {
        "Point" => Geometry::Point([c[0].as_f64().unwrap(), c[1].as_f64().unwrap()]),
        "LineString" => Geometry::LineString(positions(c)),
        "MultiLineString" => Geometry::MultiLineString(rings(c)),
        "Polygon" => Geometry::Polygon(rings(c)),
        "MultiPolygon" => Geometry::MultiPolygon(c.as_array().unwrap().iter().map(rings).collect()),
        other => panic!("unexpected {other}"),
    }
}

/// `height` of the generator: `None` for no data, `Err` for a server failure.
fn height(h: u64) -> Result<Option<f64>, ()> {
    if h.is_multiple_of(797) {
        return Err(());
    }
    if h.is_multiple_of(211) {
        return Ok(None);
    }
    let mut value = ((h % 3000) as f64 - 400.0)
        + ((h / 128) % 10) as f64 / 10.0
        + ((h / 2048) % 7) as f64 * 0.013;
    if (h / 16384).is_multiple_of(4) {
        value += 0.0499999;
    }
    Ok(Some(value))
}

/// The server, and a count of the coordinates it has been asked about.
fn start_server() -> (Server, Arc<AtomicUsize>) {
    let asked = Arc::new(AtomicUsize::new(0));
    let counter = asked.clone();
    let server = Server::start_with_body(Duration::ZERO, move |_, _, body| {
        let coordinates: Vec<[f64; 2]> = serde_json::from_str(body).unwrap();
        counter.fetch_add(coordinates.len(), Ordering::SeqCst);
        let mut heights: Vec<Option<f64>> = Vec::new();
        for [lat, lng] in coordinates {
            match height(geohash::encode(lat, lng, 10)) {
                Ok(h) => heights.push(h),
                Err(()) => return (500, "{}".into()),
            }
        }
        (200, serde_json::to_string(&heights).unwrap())
    });
    (server, asked)
}

#[test]
fn every_recorded_elevation_lookup_is_reproduced() {
    let vectors: Vectors =
        serde_json::from_str(include_str!("elevation_loader_vectors.json")).unwrap();
    assert_eq!(vectors.runs.len(), 3);
    let geometries: Vec<Geometry> = vectors.geometries.iter().map(geometry).collect();

    let mut compared = 0;
    for run in &vectors.runs {
        let (server, asked) = start_server();
        let source = RacemapSource::new(server.url.clone());
        let cache = CacheStore::open_in_memory().unwrap();
        for (n, pass) in run.passes.iter().enumerate() {
            // A new loader each pass, the same cache.
            let loader = ElevationLoader::new(&source, &cache, run.batch_size);
            let before = asked.load(Ordering::SeqCst);
            for (i, (geometry, want)) in geometries.iter().zip(&pass.results).enumerate() {
                let got = geometry_elevations(&loader, geometry);
                let context = format!("batch {} pass {} geometry {i}", run.batch_size, n + 1);
                match (&got, &want.z, &want.error) {
                    (Ok(z), Some(want), _) => {
                        assert_eq!(z, want, "{context}");
                        compared += z.len();
                    }
                    (Err(error), _, Some(want)) => assert_eq!(error, want, "{context}"),
                    _ => panic!(
                        "{context}: got {got:?}, expected {:?} {:?}",
                        want.z, want.error
                    ),
                }
            }
            // What the server was asked is part of the behaviour: a cached "no data" is not
            // asked again, a failed batch is.
            assert_eq!(
                asked.load(Ordering::SeqCst) - before,
                pass.requested,
                "batch {} pass {}: coordinates asked of the server",
                run.batch_size,
                n + 1
            );
        }
    }
    assert!(compared > 15_000, "{compared}");
}
