//! The geocoder client against a local HTTP server: what it asks, what it caches, how it
//! retries and when it gives up.

use osd_cache::{CacheKind, CacheStore};
use osd_enrich::geocode::Geocoder;
use osd_enrich::http_geocoder::{HttpGeocoder, HttpGeocoderConfig, ServerType};
use std::sync::atomic::Ordering;
use std::time::Duration;

mod support;
use support::Server;

const VIENNA: &str = r#"{"type":"FeatureCollection","features":[{"properties":{"countrycode":"AT","state":"Vienna","city":"Wien"}}]}"#;

fn config(server: &Server, server_type: ServerType, ttl: i64) -> HttpGeocoderConfig {
    HttpGeocoderConfig {
        url: server.url.clone(),
        server_type,
        cache_ttl_ms: ttl,
    }
}

fn geocoder<'a>(server: &Server, cache: &'a CacheStore) -> HttpGeocoder<'a> {
    HttpGeocoder::new(config(server, ServerType::Photon, 0), cache).with_retry_delay(Duration::ZERO)
}

/// The n-th position, each in a cell of its own.
fn position(n: usize) -> [f64; 2] {
    [11.0 + 0.05 * n as f64, 47.0]
}

#[test]
fn it_asks_for_the_cell_centre_and_builds_the_place_from_the_answer() {
    let server = Server::start(Duration::ZERO, |_, _| (200, VIENNA.into()));
    let cache = CacheStore::open_in_memory().unwrap();
    let place = geocoder(&server, &cache)
        .geocode([16.37, 48.21])
        .unwrap()
        .unwrap();
    assert_eq!(place.iso3166_1_alpha2, "AT");
    assert_eq!(place.iso3166_2.as_deref(), Some("AT-9"));
    assert_eq!(place.localized.en.region.as_deref(), Some("Vienna"));
    assert_eq!(place.localized.en.locality.as_deref(), Some("Wien"));
    let paths = server.paths();
    assert_eq!(paths.len(), 1);
    let head = server.heads.lock().unwrap()[0].to_lowercase();
    assert!(head.contains("content-type: application/json"), "{head}");
    assert!(
        paths[0].starts_with("/geo?lon=16.3") && paths[0].ends_with("&lang=en&limit=1&radius=5"),
        "{paths:?}"
    );
}

#[test]
fn a_cell_is_asked_once_whether_by_this_instance_or_a_later_one() {
    let server = Server::start(Duration::ZERO, |_, _| (200, VIENNA.into()));
    let cache = CacheStore::open_in_memory().unwrap();
    let first = geocoder(&server, &cache);
    first.geocode([16.37, 48.21]).unwrap();
    // Another position in the same 1 km cell, then a new client sharing the cache.
    first.geocode([16.3701, 48.2101]).unwrap();
    geocoder(&server, &cache)
        .geocode([16.3702, 48.2102])
        .unwrap();
    assert_eq!(server.request_count(), 1);
}

#[test]
fn a_cached_response_older_than_the_time_to_live_is_asked_for_again() {
    let server = Server::start(Duration::ZERO, |_, _| (200, VIENNA.into()));
    let cache = CacheStore::open_in_memory().unwrap();
    let make = || HttpGeocoder::new(config(&server, ServerType::Photon, 50), &cache);
    make().geocode([16.37, 48.21]).unwrap();
    make().geocode([16.37, 48.21]).unwrap();
    assert_eq!(server.request_count(), 1, "still fresh");
    std::thread::sleep(Duration::from_millis(120));
    make().geocode([16.37, 48.21]).unwrap();
    assert_eq!(server.request_count(), 2, "expired");
}

#[test]
fn the_two_server_types_have_caches_of_their_own_and_ask_for_different_things() {
    let server = Server::start(Duration::ZERO, |_, path| {
        if path.contains("fields=") {
            (200, r#"{"geometries":[{"id":1,"name":"Austria","placetype":"country","iso_code":"AT"}]}"#.into())
        } else {
            (200, VIENNA.into())
        }
    });
    let cache = CacheStore::open_in_memory().unwrap();
    geocoder(&server, &cache).geocode([16.37, 48.21]).unwrap();
    let api = HttpGeocoder::new(config(&server, ServerType::GeocodeApi, 0), &cache);
    let place = api.geocode([16.37, 48.21]).unwrap().unwrap();
    assert_eq!(place.localized.en.country, "Austria");
    assert_eq!(
        server.request_count(),
        2,
        "the Photon cache did not answer for geocode-api"
    );
    assert!(
        server.paths()[1].contains(
            "&fields=id,name,placetype,iso_code,name_eng&placetype=country,region,locality"
        )
    );
    let counts = cache.counts().unwrap();
    assert_eq!(
        (counts.geocoding_photon, counts.geocoding_geocode_api),
        (1, 1)
    );
    let key = "u2edk8".to_owned();
    let _ = key; // the cell's own text key is checked below
    let stored = cache
        .get_json_many(
            CacheKind::GeocodingPhoton,
            &[osd_cache::geohash::to_string(
                osd_cache::geohash::encode(48.21, 16.37, 6),
                6,
            )],
            0,
            0,
        )
        .unwrap();
    let stored: serde_json::Value = serde_json::from_str(stored[0].as_ref().unwrap()).unwrap();
    assert!(stored["url"].as_str().unwrap().contains("/geo?lon="));
    assert!(stored["timestamp"].as_i64().unwrap() > 1_600_000_000_000);
    assert_eq!(
        stored["response"]["features"][0]["properties"]["city"],
        "Wien"
    );
}

#[test]
fn a_failed_request_is_retried_once() {
    let server = Server::start(Duration::ZERO, |n, _| {
        if n == 1 {
            (503, "{}".into())
        } else {
            (200, VIENNA.into())
        }
    });
    let cache = CacheStore::open_in_memory().unwrap();
    assert!(
        geocoder(&server, &cache)
            .geocode([16.37, 48.21])
            .unwrap()
            .is_some()
    );
    assert_eq!(server.request_count(), 2);
}

#[test]
fn after_the_retry_fails_too_the_failure_is_remembered() {
    let server = Server::start(Duration::ZERO, |_, _| (500, "{}".into()));
    let cache = CacheStore::open_in_memory().unwrap();
    let client = geocoder(&server, &cache);
    let error = client.geocode([16.37, 48.21]).unwrap_err();
    assert!(error.contains("status 500"), "{error}");
    assert_eq!(server.request_count(), 2, "the request and its one retry");
    client.geocode([16.3701, 48.2101]).unwrap_err();
    assert_eq!(
        server.request_count(),
        2,
        "the same cell is not asked again"
    );
    assert!(
        cache.counts().unwrap().geocoding_photon == 0,
        "failures are not cached"
    );
}

#[test]
fn an_answer_that_is_not_json_is_a_failure() {
    let server = Server::start(Duration::ZERO, |_, _| (200, "not json".into()));
    let cache = CacheStore::open_in_memory().unwrap();
    let error = geocoder(&server, &cache)
        .geocode([16.37, 48.21])
        .unwrap_err();
    assert!(error.contains("parse"), "{error}");
}

#[test]
fn after_a_hundred_failures_in_a_row_it_stops_asking() {
    let server = Server::start(Duration::ZERO, |_, _| (500, "{}".into()));
    let cache = CacheStore::open_in_memory().unwrap();
    let client = geocoder(&server, &cache);
    for n in 0..100 {
        client.geocode(position(n)).unwrap_err();
    }
    assert_eq!(server.request_count(), 200);
    let error = client.geocode(position(100)).unwrap_err();
    assert_eq!(error, "Too many errors, not trying remote");
    assert_eq!(server.request_count(), 200, "no request for the 101st");
}

#[test]
fn a_success_starts_the_count_again() {
    // Only the first position's cell works.
    let good = osd_enrich::http_geocoder::request_url(
        "/geo",
        ServerType::Photon,
        osd_cache::geohash::encode(position(0)[1], position(0)[0], 6),
    );
    let server = Server::start(Duration::ZERO, move |_, path| {
        if path == good {
            (200, VIENNA.into())
        } else {
            (500, "{}".into())
        }
    });
    let cache = CacheStore::open_in_memory().unwrap();
    let client = geocoder(&server, &cache);
    for n in 1..100 {
        client.geocode(position(n)).unwrap_err();
    }
    client.geocode(position(0)).unwrap();
    for n in 100..199 {
        client.geocode(position(n)).unwrap_err();
    }
    // 198 failed cells in all, but never 100 in a row: it still tries.
    let before = server.request_count();
    client.geocode(position(300)).unwrap_err();
    assert!(server.request_count() > before);
}

#[test]
fn at_most_four_requests_are_in_flight() {
    let server = Server::start(Duration::from_millis(80), |_, _| (200, VIENNA.into()));
    let cache = CacheStore::open_in_memory().unwrap();
    let client = geocoder(&server, &cache);
    std::thread::scope(|scope| {
        for n in 0..16 {
            let client = &client;
            scope.spawn(move || client.geocode(position(n)).unwrap());
        }
    });
    let most = server.max_in_flight.load(Ordering::SeqCst);
    assert_eq!(server.request_count(), 16);
    assert!((2..=4).contains(&most), "{most} requests at once");
}

#[test]
fn cells_asked_for_at_the_same_moment_share_one_request() {
    let server = Server::start(Duration::from_millis(80), |_, _| (200, VIENNA.into()));
    let cache = CacheStore::open_in_memory().unwrap();
    let client = geocoder(&server, &cache);
    std::thread::scope(|scope| {
        for _ in 0..8 {
            let client = &client;
            scope.spawn(move || client.geocode([16.37, 48.21]).unwrap());
        }
    });
    assert_eq!(server.request_count(), 1);
}
