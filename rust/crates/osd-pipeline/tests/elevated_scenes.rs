//! The pipeline with an elevation server, against the real TypeScript one
//! (`rust/codegen/generate-elevated-scenes.mjs`): 30 worlds whose runs, lifts and spots are
//! elevated by a mock Racemap server answering with a function of the one-metre geohash cell.
//!
//! Compared per role -- GeoJSON, mapboxgl GeoJSON and CSV -- and reported by where outputs
//! first differ, so a gap shows up as a class rather than a wall of diffs.

use openskidata_format::FeatureType;
use osd_cache::CacheStore;
use osd_enrich::elevation::{ElevationLoader, ElevationSource, Lookup};
use osd_out::{csv, mapboxgl};
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;

mod common;
use common::{Roles, feature_json, first_difference, same, without_embedded_station_ski_areas};

#[derive(Deserialize)]
struct Scenes {
    scenes: Vec<Scene>,
}

#[derive(Deserialize)]
struct Scene {
    roles: Roles,
    /// Whether the server had cells with no data or that fail (the scenes with lift stations ran
    /// without: upstream stops when a snapped station lands on one).
    failures: bool,
    expected: Expected,
}

#[derive(Deserialize)]
struct Expected {
    #[serde(rename = "skiAreas")]
    ski_areas: Vec<Value>,
    runs: Vec<Value>,
    lifts: Vec<Value>,
    spots: Vec<Value>,
    mapboxgl: Roleset,
    csv: Csv,
}

#[derive(Deserialize)]
struct Roleset {
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

/// `height` of the generator: the elevation of a one-metre cell. Cells of no data and cells that
/// fail the request are as in the generator.
struct MockElevation {
    failures: bool,
}

const NO_DATA_EVERY: u64 = 211;
const FAILS_EVERY: u64 = 797;

impl ElevationSource for MockElevation {
    fn fetch(&self, coordinates: &[[f64; 2]]) -> Result<Vec<Lookup>, String> {
        coordinates
            .iter()
            .map(|[lat, lng]| {
                let h = osd_cache::geohash::encode(*lat, *lng, 10);
                if self.failures && h.is_multiple_of(FAILS_EVERY) {
                    return Err("Failed status code: 500".to_owned());
                }
                if self.failures && h.is_multiple_of(NO_DATA_EVERY) {
                    return Ok(Ok(None));
                }
                Ok(Ok(Some(
                    1500.0
                        + 12000.0 * (lat - lat.round())
                        + 8000.0 * (lng - lng.round())
                        + ((h / 128) % 10) as f64 / 10.0
                        + ((h / 2048) % 7) as f64 * 0.013,
                )))
            })
            .collect()
    }
}

#[test]
fn every_recorded_elevated_scene_is_reproduced() {
    let scenes: Scenes = serde_json::from_str(include_str!("elevated_scenes.json")).unwrap();
    assert!(scenes.scenes.len() >= 45);

    // Where outputs first differ, by role and property path, with a count and one example.
    let mut classes: BTreeMap<String, (usize, String)> = BTreeMap::new();
    for (n, scene) in scenes.scenes.iter().enumerate() {
        let cache = CacheStore::open_in_memory().unwrap();
        let source = MockElevation {
            failures: scene.failures,
        };
        let loader = ElevationLoader::new(&source, &cache, 10_000);
        let output = common::run_enriched(&scene.roles, None, Some(&loader));
        let want = &scene.expected;

        let mut check = |role: &str, got: Vec<Value>, want: &Vec<Value>| {
            if got.len() != want.len() {
                let e = classes.entry(format!("{role}: feature count")).or_default();
                e.0 += 1;
                e.1 = format!("scene {n}: {} vs {}", got.len(), want.len());
                return;
            }
            for (i, (g, w)) in got.iter().zip(want).enumerate() {
                let w = without_embedded_station_ski_areas(w.clone());
                if let Some(d) = first_difference(g, &w, "") {
                    // Group by the property path without array indices.
                    let class = d
                        .split(':')
                        .next()
                        .unwrap_or("")
                        .replace(|c: char| c.is_ascii_digit(), "#");
                    let e = classes.entry(format!("{role}{class}")).or_default();
                    e.0 += 1;
                    if e.1.is_empty() {
                        e.1 = format!("scene {n} [{i}] {d}");
                    }
                }
            }
        };
        check(
            "geojson skiAreas",
            output.ski_areas.iter().map(feature_json).collect(),
            &want.ski_areas,
        );
        check(
            "geojson runs",
            output.runs.iter().map(feature_json).collect(),
            &want.runs,
        );
        check(
            "geojson lifts",
            output.lifts.iter().map(feature_json).collect(),
            &want.lifts,
        );
        check(
            "geojson spots",
            output.spots.iter().map(feature_json).collect(),
            &want.spots,
        );
        check(
            "mapboxgl skiAreas",
            output.ski_areas.iter().map(mapboxgl::ski_area).collect(),
            &want.mapboxgl.ski_areas,
        );
        check(
            "mapboxgl runs",
            output.runs.iter().filter_map(mapboxgl::run).collect(),
            &want.mapboxgl.runs,
        );
        check(
            "mapboxgl lifts",
            output.lifts.iter().map(mapboxgl::lift).collect(),
            &want.mapboxgl.lifts,
        );
        check(
            "mapboxgl spots",
            output.spots.iter().map(mapboxgl::spot).collect(),
            &want.mapboxgl.spots,
        );

        for (role, got, expected) in [
            (
                "skiAreas",
                csv::file(
                    FeatureType::SkiArea,
                    output.ski_areas.iter().map(csv::ski_area),
                ),
                &want.csv.ski_areas,
            ),
            (
                "runs",
                csv::file(FeatureType::Run, output.runs.iter().map(csv::run)),
                &want.csv.runs,
            ),
            (
                "lifts",
                csv::file(FeatureType::Lift, output.lifts.iter().map(csv::lift)),
                &want.csv.lifts,
            ),
            (
                "spots",
                csv::file(FeatureType::Spot, output.spots.iter().map(csv::spot)),
                &want.csv.spots,
            ),
        ] {
            if &got != expected {
                let line = got
                    .lines()
                    .zip(expected.lines())
                    .position(|(a, b)| a != b)
                    .unwrap_or(0);
                let e = classes.entry(format!("csv {role}")).or_default();
                e.0 += 1;
                if e.1.is_empty() {
                    e.1 = format!(
                        "scene {n} line {line}\n    got:  {:?}\n    want: {:?}",
                        got.lines().nth(line),
                        expected.lines().nth(line)
                    );
                }
            }
        }
        let _ = same;
    }
    if !classes.is_empty() {
        let report: Vec<String> = classes
            .iter()
            .map(|(class, (count, example))| format!("{count:4} x {class}: {example}"))
            .collect();
        panic!(
            "{} kinds of difference:\n{}",
            classes.len(),
            report.join("\n")
        );
    }
}

/// A station snapped onto its lift is elevated again at its new place, if there is a lookup, and
/// has no elevation (not its old one) if there is not.
#[test]
fn snapped_stations_are_elevated_again_or_have_no_elevation() {
    use openskidata_format::spot::SpotKind;
    let scenes: Scenes = serde_json::from_str(include_str!("elevated_scenes.json")).unwrap();
    let (mut with, mut without) = (0, 0);
    for scene in scenes.scenes.iter().filter(|s| !s.failures) {
        let cache = CacheStore::open_in_memory().unwrap();
        let source = MockElevation { failures: false };
        let loader = ElevationLoader::new(&source, &cache, 10_000);
        for lookup in [true, false] {
            let mut formatted = common::format(&scene.roles);
            osd_pipeline::elevation::apply_elevation(&mut formatted, &loader);
            let output = osd_cluster::engine::cluster_enriched(
                formatted.into_cluster_input(),
                &osd_cluster::engine::Enrichment {
                    geocoder: None,
                    elevation: lookup.then_some(&loader),
                },
            )
            .unwrap();
            for spot in &output.spots {
                if matches!(spot.properties.kind, SpotKind::LiftStation { .. }) {
                    assert_eq!(
                        spot.elevations.is_some(),
                        lookup,
                        "{}",
                        spot.properties.base.id
                    );
                    if lookup {
                        with += 1;
                    } else {
                        without += 1;
                    }
                }
            }
            if !lookup {
                // And what a lift embeds of its stations has no height either.
                for lift in &output.lifts {
                    for station in &lift.properties.stations {
                        assert_eq!(station.geometry.coordinates.len(), 2);
                    }
                }
            }
        }
    }
    assert!(with >= 10 && without >= 10, "{with} {without}");
}
