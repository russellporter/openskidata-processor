//! Shared by the scene tests: the recorded input roles and the Rust pipeline run on them.

#![allow(dead_code)]

use openskidata_format::{SkiAreaActivity, Status};
use osd_cluster::engine::ClusterOutput;
use osd_osm::element::{Element, Feature, Relation};
use osd_osm::overpass::{convert_overpass_json, read_elements};
use osd_pipeline::format::{FormatInput, SkimapSkiArea, format_all};
use serde::Deserialize;
use serde_json::{Value, json};
use std::str::FromStr;

#[derive(Deserialize)]
pub struct Roles {
    pub runs: Value,
    pub lifts: Value,
    #[serde(rename = "skiAreas")]
    pub ski_areas: Value,
    pub sites: Value,
    pub spots: Value,
    pub skimap: Vec<Value>,
}

pub fn features(elements: &Value) -> Vec<Feature> {
    let document = json!({ "elements": elements }).to_string();
    convert_overpass_json(document.as_bytes()).unwrap()
}

pub fn relations(elements: &Value) -> Vec<Relation> {
    let document = json!({ "elements": elements }).to_string();
    let mut relations = Vec::new();
    read_elements(document.as_bytes(), |element| {
        if let Element::Relation(relation) = element {
            relations.push(relation);
        }
    })
    .unwrap();
    relations
}

pub fn skimap(value: &Value) -> SkimapSkiArea {
    let properties = &value["properties"];
    let coordinates = &value["geometry"]["coordinates"];
    SkimapSkiArea {
        id: properties["id"].as_str().unwrap().to_owned(),
        name: properties["name"].as_str().map(str::to_owned),
        status: properties["status"]
            .as_str()
            .map(|s| Status::from_str(s).unwrap()),
        activities: properties["activities"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| SkiAreaActivity::from_str(a.as_str().unwrap()).unwrap())
            .collect(),
        official_website: properties["official_website"].as_str().map(str::to_owned),
        coordinates: [
            coordinates[0].as_f64().unwrap(),
            coordinates[1].as_f64().unwrap(),
        ],
    }
}

/// Runs the Rust format and clustering stages on a recorded world.
pub fn run(roles: &Roles) -> ClusterOutput {
    run_with(roles, None)
}

/// As [`run`], geocoding with `geocoder` if given.
pub fn run_with(
    roles: &Roles,
    geocoder: Option<&dyn osd_enrich::geocode::Geocoder>,
) -> ClusterOutput {
    run_enriched(roles, geocoder, None)
}

/// The format stage on a recorded world.
pub fn format(roles: &Roles) -> osd_pipeline::format::Formatted {
    let input = FormatInput {
        runs: features(&roles.runs),
        lifts: features(&roles.lifts),
        ski_areas: features(&roles.ski_areas),
        sites: relations(&roles.sites),
        spots: features(&roles.spots),
        skimap: roles.skimap.iter().map(skimap).collect(),
    };
    format_all(&input).unwrap()
}

/// As [`run`], geocoding with `geocoder` and elevating with `elevation` if given.
pub fn run_enriched(
    roles: &Roles,
    geocoder: Option<&dyn osd_enrich::geocode::Geocoder>,
    elevation: Option<&osd_enrich::elevation::ElevationLoader<'_>>,
) -> ClusterOutput {
    let mut formatted = format(roles);
    if let Some(loader) = elevation {
        osd_pipeline::elevation::apply_elevation(&mut formatted, loader);
    }
    osd_cluster::engine::cluster_enriched(
        formatted.into_cluster_input(),
        &osd_cluster::engine::Enrichment {
            geocoder,
            elevation,
            snow_cover: None,
        },
    )
    .unwrap()
}

/// The path of the first place two JSON values differ, for a failure message.
pub fn first_difference(a: &Value, b: &Value, path: &str) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for (k, v) in x {
                match y.get(k) {
                    None => return Some(format!("{path}.{k}: only in actual")),
                    Some(w) => {
                        if let Some(d) = first_difference(v, w, &format!("{path}.{k}")) {
                            return Some(d);
                        }
                    }
                }
            }
            y.keys()
                .find(|k| !x.contains_key(*k))
                .map(|k| format!("{path}.{k}: only in expected"))
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => x
            .iter()
            .zip(y)
            .enumerate()
            .find_map(|(i, (v, w))| first_difference(v, w, &format!("{path}[{i}]"))),
        _ if same(a, b) => None,
        _ => Some(format!("{path}: {a} vs {b}")),
    }
}

pub fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            x == y || (x - y).abs() <= 1e-9 * y.abs().max(1.0)
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

/// A documented divergence: the `skiAreas` embedded in a lift's `stations`.
///
/// Upstream exports a station embedded in a lift with the properties it was loaded with, so
/// that field holds the *unresolved* site ski areas as they were at load time -- full
/// features, still carrying the `[360, 360, id]` placeholder coordinates -- whereas the same
/// station in `spots.geojson` shows resolved summaries. This pipeline resolves both the same
/// way, so the field is excluded here; the station's own `skiAreas` is still compared in
/// `spots`.
pub fn without_embedded_station_ski_areas(mut feature: Value) -> Value {
    // `get_mut`, not indexing: `IndexMut` on a missing key inserts a null.
    let stations = feature
        .get_mut("properties")
        .and_then(|p| p.get_mut("stations"))
        .and_then(Value::as_array_mut);
    if let Some(stations) = stations {
        for station in stations {
            if let Some(object) = station.get_mut("properties").and_then(Value::as_object_mut) {
                object.remove("skiAreas");
            }
        }
    }
    feature
}

pub fn feature_json<P: serde::Serialize>(f: &osd_cluster::engine::Feature<P>) -> Value {
    without_embedded_station_ski_areas(json!({
        "type": "Feature",
        "geometry": osd_out::geojson::geometry_json(&f.geometry, f.elevations.as_deref()),
        "properties": serde_json::to_value(&f.properties).unwrap(),
    }))
}
