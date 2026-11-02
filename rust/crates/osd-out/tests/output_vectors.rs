//! The CSV and mapboxgl formatters against the real ones, on synthetic features built to
//! reach what the end-to-end scenes cannot (places, long names, concave ski area polygons).

use osd_cluster::engine::Feature;
use osd_osm::element::Geometry;
use osd_out::{csv, mapboxgl};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

#[derive(Deserialize)]
struct Vectors {
    #[serde(rename = "skiAreas")]
    ski_areas: Vec<Case>,
    runs: Vec<Case>,
    lifts: Vec<Case>,
    spots: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    feature: Value,
    csv: String,
    mapboxgl: Option<Value>,
}

/// A position's first two numbers; a third is its elevation.
fn pair(v: &Value) -> [f64; 2] {
    [v[0].as_f64().unwrap(), v[1].as_f64().unwrap()]
}

fn line(v: &Value) -> Vec<[f64; 2]> {
    v.as_array().unwrap().iter().map(pair).collect()
}

fn lines(v: &Value) -> Vec<Vec<[f64; 2]>> {
    v.as_array().unwrap().iter().map(line).collect()
}

fn geometry(value: &Value) -> Geometry {
    let c = &value["coordinates"];
    match value["type"].as_str().unwrap() {
        "Point" => Geometry::Point(pair(c)),
        "LineString" => Geometry::LineString(line(c)),
        "MultiLineString" => Geometry::MultiLineString(lines(c)),
        "Polygon" => Geometry::Polygon(lines(c)),
        "MultiPolygon" => Geometry::MultiPolygon(c.as_array().unwrap().iter().map(lines).collect()),
        other => panic!("unexpected {other}"),
    }
}

/// The third number of each position in order, if the geometry's first position has one.
fn elevations(value: &Value) -> Option<Vec<f64>> {
    fn collect(v: &Value, out: &mut Vec<f64>) {
        match v {
            Value::Array(a) if a.first().is_some_and(Value::is_number) => {
                out.push(a.get(2).and_then(Value::as_f64).unwrap_or(f64::NAN))
            }
            Value::Array(a) => a.iter().for_each(|x| collect(x, out)),
            _ => {}
        }
    }
    let mut first = &value["coordinates"];
    while first
        .as_array()
        .is_some_and(|a| a.first().is_some_and(Value::is_array))
    {
        first = &first[0];
    }
    if !first.as_array().is_some_and(|a| a.len() >= 3) {
        return None;
    }
    let mut out = Vec::new();
    collect(&value["coordinates"], &mut out);
    Some(out)
}

fn typed<P: DeserializeOwned>(case: &Case) -> Feature<P> {
    Feature {
        geometry: geometry(&case.feature["geometry"]),
        elevations: elevations(&case.feature["geometry"]),
        properties: serde_json::from_value(case.feature["properties"].clone())
            .unwrap_or_else(|e| panic!("{e}: {}", case.feature["properties"])),
    }
}

/// Numbers within 1e-9 relative; the central point of a concave polygon goes through turf's
/// vector arithmetic, which differs from V8's in the last digits (see the turf tests).
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            (x - y).abs() <= 1e-9 * y.abs().max(1.0)
        }
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, p)| y.get(k).is_some_and(|q| same(p, q)))
        }
        _ => a == b,
    }
}

fn vectors() -> Vectors {
    serde_json::from_str(include_str!("output_vectors.json")).unwrap()
}

fn check<P: DeserializeOwned>(
    kind: &str,
    cases: &[Case],
    csv_row: impl Fn(&Feature<P>) -> String,
    mapbox: impl Fn(&Feature<P>) -> Option<Value>,
) {
    for (n, case) in cases.iter().enumerate() {
        let feature: Feature<P> = typed(case);
        assert_eq!(
            csv_row(&feature),
            case.csv,
            "{kind} {n} csv\n{}",
            case.feature
        );
        let actual = mapbox(&feature);
        match (&actual, &case.mapboxgl) {
            (None, None) => {}
            (Some(a), Some(e)) => {
                assert!(
                    same(a, e),
                    "{kind} {n} mapboxgl\n  actual:   {a}\n  expected: {e}"
                )
            }
            (a, e) => panic!("{kind} {n} mapboxgl presence: {a:?} vs {e:?}"),
        }
    }
}

#[test]
fn ski_areas() {
    check("skiArea", &vectors().ski_areas, csv::ski_area, |f| {
        Some(mapboxgl::ski_area(f))
    });
}

#[test]
fn runs() {
    check("run", &vectors().runs, csv::run, mapboxgl::run);
}

#[test]
fn lifts() {
    check("lift", &vectors().lifts, csv::lift, |f| {
        Some(mapboxgl::lift(f))
    });
}

#[test]
fn spots() {
    check("spot", &vectors().spots, csv::spot, |f| {
        Some(mapboxgl::spot(f))
    });
}
