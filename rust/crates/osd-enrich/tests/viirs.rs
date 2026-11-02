//! The VIIRS pixel extractor against the real one
//! (`rust/codegen/generate-viirs-vectors.mjs`).

use osd_enrich::viirs::geometry_pixels;
use osd_osm::element::Geometry;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Vectors {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    geometry: Value,
    pixels: Vec<[u32; 4]>,
}

fn positions(v: &Value) -> Vec<[f64; 2]> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|p| [p[0].as_f64().unwrap(), p[1].as_f64().unwrap()])
        .collect()
}

fn rings(v: &Value) -> Vec<Vec<[f64; 2]>> {
    v.as_array().unwrap().iter().map(positions).collect()
}

fn geometry(v: &Value) -> Geometry {
    let c = &v["coordinates"];
    match v["type"].as_str().unwrap() {
        "LineString" => Geometry::LineString(positions(c)),
        "MultiLineString" => Geometry::MultiLineString(rings(c)),
        "Polygon" => Geometry::Polygon(rings(c)),
        "MultiPolygon" => Geometry::MultiPolygon(c.as_array().unwrap().iter().map(rings).collect()),
        other => panic!("{other}"),
    }
}

#[test]
fn every_recorded_extraction_is_reproduced() {
    let vectors: Vectors = serde_json::from_str(include_str!("viirs_vectors.json")).unwrap();
    let mut total = 0;
    for (i, case) in vectors.cases.iter().enumerate() {
        let got = geometry_pixels(&geometry(&case.geometry));
        assert_eq!(got, case.pixels, "case {i}: {}", case.geometry);
        total += got.len();
    }
    assert!(total > 10_000, "{total}");
}
