//! `sort_places` and `unique_places` against the real `PlaceUtils`
//! (`rust/codegen/generate-places-vectors.mjs`).

use openskidata_format::place::Place;
use osd_enrich::places::{sort_places, unique_places};
use serde::Deserialize;

#[derive(Deserialize)]
struct Vectors {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    places: Vec<Place>,
    sorted: Vec<Place>,
    unique: Vec<Place>,
}

#[test]
fn every_recorded_ordering_and_deduplication_is_reproduced() {
    let vectors: Vectors = serde_json::from_str(include_str!("places_vectors.json")).unwrap();
    assert!(vectors.cases.len() >= 1340);
    for (n, case) in vectors.cases.iter().enumerate() {
        assert_eq!(
            sort_places(&case.places),
            case.sorted,
            "case {n}: sortPlaces"
        );
        assert_eq!(
            unique_places(&case.places),
            case.unique,
            "case {n}: uniquePlaces"
        );
    }
}
