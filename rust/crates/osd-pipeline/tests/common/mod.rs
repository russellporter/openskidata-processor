//! Shared by the scene tests: the recorded input roles and the Rust pipeline run on them.

#![allow(dead_code)]

use openskidata_format::{SkiAreaActivity, Status};
use osd_cluster::engine::{ClusterOutput, cluster};
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
    let input = FormatInput {
        runs: features(&roles.runs),
        lifts: features(&roles.lifts),
        ski_areas: features(&roles.ski_areas),
        sites: relations(&roles.sites),
        spots: features(&roles.spots),
        skimap: roles.skimap.iter().map(skimap).collect(),
    };
    let formatted = format_all(&input).unwrap();
    cluster(formatted.into_cluster_input()).unwrap()
}
