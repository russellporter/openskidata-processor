//! Geohashes against the real `ngeohash` (`rust/codegen/generate-geohash-vectors.mjs`):
//! 5,000 coordinates, uniform and clustered on bisection midpoints and the world's edges.

use osd_cache::geohash::{decode, encode, from_str, to_string};
use serde::Deserialize;

#[derive(Deserialize)]
struct Vectors {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    lat: f64,
    lng: f64,
    chars: usize,
    hash: String,
    decoded: [f64; 2],
}

#[test]
fn every_recorded_geohash_is_reproduced() {
    let vectors: Vectors = serde_json::from_str(include_str!("geohash_vectors.json")).unwrap();
    assert!(vectors.cases.len() >= 5000);
    for (n, case) in vectors.cases.iter().enumerate() {
        let bits = encode(case.lat, case.lng, case.chars);
        assert_eq!(
            to_string(bits, case.chars),
            case.hash,
            "case {n}: encode({}, {}, {})",
            case.lat,
            case.lng,
            case.chars
        );
        assert_eq!(from_str(&case.hash, case.chars), Some(bits), "case {n}");
        let (lat, lng) = decode(bits, case.chars);
        assert_eq!(
            (lat.to_bits(), lng.to_bits()),
            (case.decoded[0].to_bits(), case.decoded[1].to_bits()),
            "case {n}: decode({})",
            case.hash
        );
    }
}
