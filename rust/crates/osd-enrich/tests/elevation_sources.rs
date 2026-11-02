//! The elevation loader's edges and the servers' wire formats, against stubs and a local
//! server: what the generated vectors (a Racemap server answering sensibly) cannot reach.

use osd_cache::CacheStore;
use osd_enrich::elevation::{
    ElevationLoader, ElevationSource, Lookup, RacemapSource, TileserverGlSource,
};
use std::sync::Mutex;
use std::time::Duration;

mod support;
use support::Server;

/// Answers from a closure and remembers the size of each request.
struct Stub<F: Fn(&[[f64; 2]]) -> Result<Vec<Lookup>, String> + Sync> {
    answer: F,
    sizes: Mutex<Vec<usize>>,
}

impl<F: Fn(&[[f64; 2]]) -> Result<Vec<Lookup>, String> + Sync> ElevationSource for Stub<F> {
    fn fetch(&self, coordinates: &[[f64; 2]]) -> Result<Vec<Lookup>, String> {
        self.sizes.lock().unwrap().push(coordinates.len());
        (self.answer)(coordinates)
    }
}

fn stub<F: Fn(&[[f64; 2]]) -> Result<Vec<Lookup>, String> + Sync>(answer: F) -> Stub<F> {
    Stub {
        answer,
        sizes: Mutex::new(Vec::new()),
    }
}

/// `n` coordinates, each in a cell of its own.
fn line(n: usize) -> Vec<[f64; 2]> {
    (0..n).map(|i| [11.0 + 0.001 * i as f64, 47.0]).collect()
}

fn flat(source: &dyn ElevationSource, n: usize, batch: usize) -> Result<Vec<f64>, String> {
    let cache = CacheStore::open_in_memory().unwrap();
    ElevationLoader::new(source, &cache, batch).load_elevations(&line(n))
}

#[test]
fn elevations_are_rounded_to_a_tenth_with_math_round_semantics() {
    // Math.round(-2.5) is -2, and Math.round(12344.5) is 12345.
    let source = stub(|c| {
        Ok(vec![
            Ok(Some(-0.25)),
            Ok(Some(1234.45)),
            Ok(Some(-1234.45)),
            Ok(Some(0.04)),
        ][..c.len()]
            .to_vec())
    });
    assert_eq!(
        flat(&source, 4, 100).unwrap(),
        vec![-0.2, 1234.5, -1234.4, 0.0]
    );
}

#[test]
fn a_different_number_of_answers_than_questions_fails_the_batch() {
    let source = stub(|c| Ok(vec![Ok(Some(1.0)); c.len() - 1]));
    assert_eq!(
        flat(&source, 3, 100).unwrap_err(),
        "Number of uncached coordinates (3) is different than number of fetched elevations (2)"
    );
}

#[test]
fn a_failed_lookup_reads_as_no_data_and_is_not_cached() {
    let fail_second = |c: &[[f64; 2]]| -> Result<Vec<Lookup>, String> {
        Ok((0..c.len())
            .map(|i| {
                if i == 1 {
                    Err("boom".to_owned())
                } else {
                    Ok(Some(100.0))
                }
            })
            .collect())
    };
    let source = stub(fail_second);
    let cache = CacheStore::open_in_memory().unwrap();
    let loader = ElevationLoader::new(&source, &cache, 100);
    assert_eq!(
        loader.load_elevations(&line(3)).unwrap_err(),
        "No elevation data available"
    );
    // The two that worked were cached; a new loader asks only about the failed one.
    let again = ElevationLoader::new(&source, &cache, 100);
    let _ = again.load_elevations(&line(3));
    assert_eq!(*source.sizes.lock().unwrap(), vec![3, 1]);
}

#[test]
fn a_cell_asked_again_by_the_same_loader_keeps_the_value_first_fetched() {
    // Just under a rounding tie: the fetched double rounds down, but the 32-bit float the cache
    // stores is the tie itself and rounds up. The loader remembers what it fetched; a new one
    // reads the cache.
    let source = stub(|c| Ok(vec![Ok(Some(100.0499999)); c.len()]));
    let cache = CacheStore::open_in_memory().unwrap();
    let first = ElevationLoader::new(&source, &cache, 100);
    assert_eq!(first.load_elevations(&line(1)).unwrap(), vec![100.0]);
    assert_eq!(
        first.load_elevations(&line(1)).unwrap(),
        vec![100.0],
        "remembered, not re-read"
    );
    let second = ElevationLoader::new(&source, &cache, 100);
    assert_eq!(
        second.load_elevations(&line(1)).unwrap(),
        vec![100.1],
        "read back from the cache"
    );
    assert_eq!(*source.sizes.lock().unwrap(), vec![1]);
}

#[test]
fn a_cell_with_no_data_is_cached_as_such() {
    let source = stub(|c| Ok(vec![Ok(None); c.len()]));
    let cache = CacheStore::open_in_memory().unwrap();
    let first = ElevationLoader::new(&source, &cache, 100);
    assert_eq!(
        first.load_elevations(&line(2)).unwrap_err(),
        "No elevation data available"
    );
    let second = ElevationLoader::new(&source, &cache, 100);
    assert!(second.load_elevations(&line(2)).is_err());
    assert_eq!(*source.sizes.lock().unwrap(), vec![2], "not asked again");
}

#[test]
fn cells_are_asked_in_batches_of_at_most_the_batch_size_without_repeats() {
    let source = stub(|c| Ok(vec![Ok(Some(5.0)); c.len()]));
    let cache = CacheStore::open_in_memory().unwrap();
    let loader = ElevationLoader::new(&source, &cache, 10);
    let mut coordinates = line(25);
    coordinates.extend(line(25)); // the same cells again
    assert!(loader.load_elevations(&coordinates).is_ok());
    assert_eq!(*source.sizes.lock().unwrap(), vec![10, 10, 5]);
    // Remembered: asking again asks nothing.
    loader.load_elevations(&coordinates).unwrap();
    assert_eq!(source.sizes.lock().unwrap().len(), 3);
}

#[test]
fn a_failed_batch_does_not_stop_the_others_and_is_asked_again_later() {
    let calls = Mutex::new(0);
    let source = stub(|c| {
        let mut calls = calls.lock().unwrap();
        *calls += 1;
        if *calls == 2 {
            Err("down".to_owned())
        } else {
            Ok(vec![Ok(Some(7.0)); c.len()])
        }
    });
    let cache = CacheStore::open_in_memory().unwrap();
    let loader = ElevationLoader::new(&source, &cache, 10);
    assert_eq!(loader.load_elevations(&line(30)).unwrap_err(), "down");
    assert_eq!(
        *source.sizes.lock().unwrap(),
        vec![10, 10, 10],
        "the third batch still ran"
    );
    // The first and third batches are remembered; only the failed one is asked again.
    assert!(loader.load_elevations(&line(30)).is_ok());
    assert_eq!(*source.sizes.lock().unwrap(), vec![10, 10, 10, 10]);
}

#[test]
fn racemap_posts_the_cell_centres_as_latitude_longitude_pairs() {
    let server = Server::start_with_body(Duration::ZERO, |_, _, body| {
        let n = serde_json::from_str::<Vec<[f64; 2]>>(body).unwrap().len();
        (200, format!("[{}]", vec!["12.5"; n].join(",")))
    });
    let source = RacemapSource::new(server.url.clone());
    let cache = CacheStore::open_in_memory().unwrap();
    let loader = ElevationLoader::new(&source, &cache, 100);
    assert_eq!(
        loader
            .load_elevations(&[[11.3, 47.2], [11.3, 47.2]])
            .unwrap(),
        vec![12.5, 12.5]
    );
    assert_eq!(server.request_count(), 1);
    let head = server.heads.lock().unwrap()[0].to_lowercase();
    assert!(
        head.starts_with("post /elevation") || head.starts_with("post /geo"),
        "{head}"
    );
    assert!(head.contains("content-type: application/json"));
}

#[test]
fn racemap_reports_a_bad_status() {
    let server = Server::start_with_body(Duration::ZERO, |_, _, _| (503, "{}".into()));
    let source = RacemapSource::new(server.url.clone());
    assert_eq!(flat(&source, 2, 10).unwrap_err(), "Failed status code: 503");
}

#[test]
fn tileserver_gl_tries_each_zoom_for_the_points_still_without_data() {
    // The point at index 1 (of those asked) has data only from zoom 10.
    let asked = std::sync::Arc::new(Mutex::new(Vec::new()));
    let recorded = asked.clone();
    let server = Server::start_with_body(Duration::ZERO, move |_, _, body| {
        let request: serde_json::Value = serde_json::from_str(body).unwrap();
        let points = request["points"].as_array().unwrap();
        recorded.lock().unwrap().push(points.len());
        let zoom = points[0]["z"].as_u64().unwrap();
        let answers: Vec<String> = points
            .iter()
            .enumerate()
            .map(|(i, _)| match (zoom, i) {
                (12, 1) => "null".to_owned(),
                (12, _) => "100.0".to_owned(),
                _ => "55.0".to_owned(),
            })
            .collect();
        (200, format!("[{}]", answers.join(",")))
    });
    let source = TileserverGlSource::new(server.url.clone(), vec![12, 10]);
    let results = source
        .fetch(&[[47.0, 11.0], [47.1, 11.1], [47.2, 11.2]])
        .unwrap();
    assert_eq!(
        results,
        vec![Ok(Some(100.0)), Ok(Some(55.0)), Ok(Some(100.0))]
    );
    assert_eq!(server.request_count(), 2);
    // The second request asked only about the point that had none.
    assert_eq!(*asked.lock().unwrap(), vec![3, 1]);
    let head = server.heads.lock().unwrap()[0].to_lowercase();
    assert!(
        head.contains("user-agent: openskidata-processor/1.0.0"),
        "{head}"
    );
}

#[test]
fn tileserver_gl_sends_longitude_latitude_and_zoom() {
    let seen = std::sync::Arc::new(Mutex::new(String::new()));
    let recorded = seen.clone();
    let server = Server::start_with_body(Duration::ZERO, move |_, _, body| {
        *recorded.lock().unwrap() = body.to_owned();
        (200, "[1.5, 2.5]".into())
    });
    let source = TileserverGlSource::new(server.url.clone(), vec![12]);
    source.fetch(&[[47.25, 11.5], [1e-7, -0.5]]).unwrap();
    // As `JSON.stringify` writes it: keys in the order `lon, lat, z`, numbers as JavaScript prints
    // them (this string is Node's output for the same points).
    assert_eq!(
        *seen.lock().unwrap(),
        r#"{"points":[{"lon":11.5,"lat":47.25,"z":12},{"lon":-0.5,"lat":1e-7,"z":12}]}"#
    );
}

#[test]
fn tileserver_gl_marks_everything_it_could_not_get_as_failed() {
    let server = Server::start_with_body(Duration::ZERO, |_, _, _| (500, "{}".into()));
    let source = TileserverGlSource::new(server.url.clone(), vec![12, 10]);
    let results = source.fetch(&[[47.0, 11.0], [47.1, 11.1]]).unwrap();
    assert_eq!(results, vec![Err("HTTP 500 at zoom 12".to_owned()); 2]);
    assert_eq!(
        server.request_count(),
        1,
        "it gives up rather than try the next zoom"
    );

    let wrong_length = Server::start_with_body(Duration::ZERO, |_, _, _| (200, "[1.0]".into()));
    let source = TileserverGlSource::new(wrong_length.url.clone(), vec![12]);
    let results = source.fetch(&[[47.0, 11.0], [47.1, 11.1]]).unwrap();
    assert_eq!(
        results,
        vec![Err("Invalid batch response: expected array of 2 elevations".to_owned()); 2]
    );
}

#[test]
fn points_with_no_data_at_any_zoom_are_no_data_not_errors() {
    let server = Server::start_with_body(Duration::ZERO, |_, _, body| {
        let n = serde_json::from_str::<serde_json::Value>(body).unwrap()["points"]
            .as_array()
            .unwrap()
            .len();
        (200, format!("[{}]", vec!["null"; n].join(",")))
    });
    let source = TileserverGlSource::new(server.url.clone(), vec![12, 10]);
    assert_eq!(source.fetch(&[[47.0, 11.0]]).unwrap(), vec![Ok(None)]);
    assert_eq!(server.request_count(), 2);
}
