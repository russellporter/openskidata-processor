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
