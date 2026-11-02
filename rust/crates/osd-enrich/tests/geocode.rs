//! Geocoding's pure parts against the real `Geocoder` and `GeoTransforms`
//! (`rust/codegen/generate-geocode-vectors.mjs`): what a Photon or Who's On First response
//! becomes, and which points are sampled along a geometry.
//!
//! Two mutants of the sampling cannot be told apart by any input, because the duplicates they
//! add are removed again: sampling while `distance <= length` rather than `<` (the extra point
//! is the end, already there) and measuring the line in metres rather than kilometres (every
//! sample past the end is the end). The second would, however, loop a thousand times longer.

use openskidata_format::place::Place;
use osd_enrich::geocode::{enhance_photon, enhance_whos_on_first, extract_points_along_geometry};
use osd_osm::element::{Geometry, Position};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Vectors {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    kind: String,
    #[serde(default)]
    raw: Value,
    #[serde(default)]
    geometry: Value,
    #[serde(default)]
    interval: f64,
    expected: Value,
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

#[derive(Default)]
struct Stats {
    numbers: usize,
    exact: usize,
}

#[test]
fn every_recorded_geocode_computation_is_reproduced() {
    let vectors: Vectors = serde_json::from_str(include_str!("geocode_vectors.json")).unwrap();
    assert!(vectors.cases.len() >= 3000);
    let mut stats = Stats::default();
    let mut failures = Vec::new();

    for (n, case) in vectors.cases.iter().enumerate() {
        let ok = match case.kind.as_str() {
            "photon" | "wof" => {
                let got = if case.kind == "photon" {
                    enhance_photon(&case.raw)
                } else {
                    enhance_whos_on_first(&case.raw)
                };
                let want: Option<Place> = serde_json::from_value(case.expected.clone()).unwrap();
                got == want
            }
            "points" => {
                let got = extract_points_along_geometry(&geometry(&case.geometry), case.interval);
                match (got, case.expected.get("ok"), case.expected.get("error")) {
                    (Ok(points), Some(want), _) => {
                        let want = positions(want);
                        points.len() == want.len()
                            && points.iter().zip(&want).all(|(g, w)| {
                                (0..2).all(|i| {
                                    stats.numbers += 1;
                                    stats.exact += usize::from(g[i] == w[i]);
                                    (g[i] - w[i]).abs() <= 1e-13 * w[i].abs().max(1.0)
                                })
                            })
                    }
                    (Err(got), _, Some(want)) => got == want.as_str().unwrap(),
                    _ => false,
                }
            }
            other => panic!("unknown kind {other}"),
        };
        if !ok {
            failures.push(format!("case {n} ({}): {}", case.kind, case.raw));
        }
    }
    eprintln!(
        "{} coordinates compared, {} exact ({:.3}%)",
        stats.numbers,
        stats.exact,
        100.0 * stats.exact as f64 / stats.numbers.max(1) as f64
    );
    assert!(
        failures.is_empty(),
        "{} of {} cases differ; first:\n{}",
        failures.len(),
        vectors.cases.len(),
        failures
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

mod geocode_geometry {
    use openskidata_format::place::{Localized, LocalizedNames, Place};
    use osd_enrich::geocode::{Geocoder, geocode_geometry};
    use osd_osm::element::{Geometry, Position};
    use std::sync::Mutex;

    /// Records what it is asked, and answers with a place named for the latitude.
    struct Recording {
        asked: Mutex<Vec<Position>>,
        fail_at: Option<usize>,
    }

    impl Geocoder for Recording {
        fn geocode(&self, position: Position) -> Result<Option<Place>, String> {
            let mut asked = self.asked.lock().unwrap();
            asked.push(position);
            if self.fail_at == Some(asked.len()) {
                return Err("boom".into());
            }
            Ok(Some(Place {
                iso3166_1_alpha2: "AT".into(),
                iso3166_2: None,
                localized: Localized {
                    en: LocalizedNames {
                        country: "Austria".into(),
                        region: None,
                        locality: Some(format!("{:.2}", position[1])),
                    },
                },
            }))
        }
    }

    /// About 4.45 km due north.
    fn line() -> Geometry {
        Geometry::LineString(vec![[11.0, 47.0], [11.0, 47.04]])
    }

    #[test]
    fn the_line_is_sampled_every_kilometre() {
        let geocoder = Recording {
            asked: Mutex::new(vec![]),
            fail_at: None,
        };
        let places = geocode_geometry(&geocoder, &line()).unwrap();
        let asked = geocoder.asked.lock().unwrap();
        assert_eq!(asked.len(), 6, "start, four kilometre marks, end");
        for pair in asked.windows(2).take(4) {
            let km = osd_turf::distance_km(pair[0], pair[1]);
            assert!((km - 1.0).abs() < 1e-6, "{km}");
        }
        // Distinct localities, and sorted.
        let names: Vec<_> = places
            .iter()
            .map(|p| p.localized.en.locality.clone().unwrap())
            .collect();
        assert!(names.windows(2).all(|w| w[0] <= w[1]), "{names:?}");
    }

    #[test]
    fn one_failed_lookup_fails_the_geometry_without_a_partial_result() {
        for fail_at in 1..=6 {
            let geocoder = Recording {
                asked: Mutex::new(vec![]),
                fail_at: Some(fail_at),
            };
            assert_eq!(geocode_geometry(&geocoder, &line()), Err("boom".to_owned()));
        }
    }
}
