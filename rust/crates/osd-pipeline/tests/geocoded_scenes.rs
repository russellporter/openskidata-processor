//! The pipeline with a geocoder, against the real TypeScript one
//! (`rust/codegen/generate-geocoded-scenes.mjs`): 30 worlds geocoded by a mock Photon whose
//! answer is a function of the 600 m geohash cell asked about. Checks the geocoding of each run,
//! lift and spot, the ski areas' places collected from their members (deduplicated and sorted
//! by `localeCompare`), and the centroid fallback.
//!
//! Mutants that survive, and why they cannot be told apart here: geocoding a ski area's first
//! vertex rather than its centroid (the fallback is only reached for ski areas that are points,
//! where the two coincide); clearing a run's places when its lookup fails (they are empty
//! already); and sorting before removing duplicates (duplicates are identical in Photon data,
//! since the codes and locality determine the rest).

use openskidata_format::place::Place;
use osd_cache::geohash;
use osd_enrich::geocode::{Geocoder, enhance_photon};
use osd_osm::element::Position;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;

mod common;
use common::{Roles, feature_json, same, without_embedded_station_ski_areas};

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
struct Expected {
    #[serde(rename = "skiAreas")]
    ski_areas: Vec<Value>,
    runs: Vec<Value>,
    lifts: Vec<Value>,
    spots: Vec<Value>,
}

const COUNTRIES: [&str; 10] = ["AT", "CH", "FR", "DE", "IT", "JP", "US", "XK", "ZZ", "NO"];
const CITIES: [&str; 12] = [
    "Innsbruck",
    "Zürich",
    "Zu\u{308}rich",
    "Ålesund",
    "Chamonix",
    "Niseko",
    "St. Anton",
    "Sankt Anton",
    "Aspen",
    "Bariloche",
    "Vail",
    "Åre",
];

/// `mockPhoton` of the generator: a Photon response that is a function of the cell's 30 bits.
struct MockPhoton {
    /// Region names by country code, in the dataset's order.
    regions: HashMap<String, Vec<String>>,
}

impl MockPhoton {
    fn new() -> Self {
        #[derive(Deserialize)]
        struct Data {
            countries: HashMap<String, Country>,
        }
        #[derive(Deserialize)]
        struct Country {
            regions: Vec<(String, String)>,
        }
        let data: Data =
            serde_json::from_str(include_str!("../../osd-enrich/src/iso3166.json")).unwrap();
        MockPhoton {
            regions: data
                .countries
                .into_iter()
                .map(|(code, c)| (code, c.regions.into_iter().map(|(name, _)| name).collect()))
                .collect(),
        }
    }

    fn response(&self, h: usize) -> Value {
        let mut features = Vec::new();
        if !h.is_multiple_of(17) {
            let code = COUNTRIES[h % COUNTRIES.len()];
            let regions = self.regions.get(code).map_or(&[][..], Vec::as_slice);
            let mut properties = json!({ "countrycode": code });
            if !regions.is_empty() && !h.is_multiple_of(5) {
                properties["state"] = json!(regions[(h >> 3) % regions.len()]);
            } else if !regions.is_empty() && h.is_multiple_of(7) {
                properties["county"] = json!(regions[(h >> 4) % regions.len()]);
            }
            if !h.is_multiple_of(3) {
                properties["city"] = json!(CITIES[(h >> 2) % CITIES.len()]);
            }
            features.push(json!({ "type": "Feature", "properties": properties }));
        }
        json!({ "response": { "type": "FeatureCollection", "features": features } })
    }
}

impl Geocoder for MockPhoton {
    fn geocode(&self, position: Position) -> Result<Option<Place>, String> {
        let cell = geohash::encode(position[1], position[0], 6);
        Ok(enhance_photon(&self.response(cell as usize)))
    }
}

#[test]
fn every_recorded_geocoded_scene_is_reproduced() {
    let scenes: Scenes = serde_json::from_str(include_str!("geocoded_scenes.json")).unwrap();
    assert!(scenes.scenes.len() >= 30);
    let geocoder = MockPhoton::new();

    let mut failures: Vec<String> = Vec::new();
    let mut with_places = 0;
    for (n, scene) in scenes.scenes.iter().enumerate() {
        let output = common::run_with(&scene.roles, Some(&geocoder));
        let roles: [(&str, Vec<Value>, &Vec<Value>); 4] = [
            (
                "skiAreas",
                output.ski_areas.iter().map(feature_json).collect(),
                &scene.expected.ski_areas,
            ),
            (
                "runs",
                output.runs.iter().map(feature_json).collect(),
                &scene.expected.runs,
            ),
            (
                "lifts",
                output.lifts.iter().map(feature_json).collect(),
                &scene.expected.lifts,
            ),
            (
                "spots",
                output.spots.iter().map(feature_json).collect(),
                &scene.expected.spots,
            ),
        ];
        for (role, got, want) in roles {
            with_places += got
                .iter()
                .filter(|f| !f["properties"]["places"].as_array().unwrap().is_empty())
                .count();
            if got.len() != want.len() {
                failures.push(format!(
                    "scene {n} {role}: {} features, expected {}",
                    got.len(),
                    want.len()
                ));
                continue;
            }
            for (i, (g, w)) in got.iter().zip(want).enumerate() {
                let w = &without_embedded_station_ski_areas(w.clone());
                if !same(g, w) {
                    failures.push(format!(
                        "scene {n} {role}[{i}]\n  actual:   {g}\n  expected: {w}"
                    ));
                    break;
                }
            }
        }
    }
    assert!(
        with_places >= 400,
        "the scenes should exercise geocoding: {with_places}"
    );
    assert!(
        failures.is_empty(),
        "{} problems; first:\n{}",
        failures.len(),
        failures
            .iter()
            .take(4)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

/// A geocoder that fails on some cells, as a network can.
struct Flaky<'a> {
    inner: &'a MockPhoton,
}

fn fails(position: Position) -> bool {
    geohash::encode(position[1], position[0], 6).is_multiple_of(4)
}

impl Geocoder for Flaky<'_> {
    fn geocode(&self, position: Position) -> Result<Option<Place>, String> {
        if fails(position) {
            return Err("503".into());
        }
        self.inner.geocode(position)
    }
}

/// Upstream logs a failed geocode and moves on, leaving the object as it was: a run, lift or
/// spot any of whose sampled points failed has no places (it had none), and the others have
/// exactly what they would have had.
#[test]
fn a_failed_lookup_leaves_the_object_without_places() {
    let scenes: Scenes = serde_json::from_str(include_str!("geocoded_scenes.json")).unwrap();
    let mock = MockPhoton::new();
    let flaky = Flaky { inner: &mock };
    let (mut failed, mut survived) = (0, 0);
    for scene in &scenes.scenes {
        let good = common::run_with(&scene.roles, Some(&mock));
        let bad = common::run_with(&scene.roles, Some(&flaky));
        assert_eq!(good.runs.len(), bad.runs.len());
        for (g, b) in good.runs.iter().zip(&bad.runs) {
            let points =
                osd_enrich::geocode::extract_points_along_geometry(&g.geometry, 1.0).unwrap();
            if points.iter().any(|p| fails(*p)) {
                failed += 1;
                assert!(b.properties.places.is_empty(), "{}", g.properties.id);
            } else {
                survived += 1;
                assert_eq!(
                    b.properties.places, g.properties.places,
                    "{}",
                    g.properties.id
                );
            }
        }
        for (g, b) in good.lifts.iter().zip(&bad.lifts) {
            let points =
                osd_enrich::geocode::extract_points_along_geometry(&g.geometry, 1.0).unwrap();
            if points.iter().any(|p| fails(*p)) {
                assert!(b.properties.places.is_empty());
            } else {
                assert_eq!(b.properties.places, g.properties.places);
            }
        }
    }
    assert!(
        failed > 20 && survived > 20,
        "{failed} failed, {survived} survived"
    );
}
