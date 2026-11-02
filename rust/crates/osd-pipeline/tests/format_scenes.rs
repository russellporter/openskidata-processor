//! The formatting stage against the real TypeScript front half of `PrepareGeoJSON.prepare`
//! (`rust/codegen/generate-format-scenes.mjs`): 500 randomised OSM worlds, one extract per
//! role, with the intermediate output recorded.
//!
//! Everything is compared, including ids (exact content hashes) and viewport hints (relative
//! tolerance 1e-9). Embedded site ski areas are compared by id.

use openskidata_format::{SkiAreaActivity, Status};
use osd_normalize::topology::InputGeometry;
use osd_osm::element::{Element, Geometry};
use osd_osm::overpass::{convert_overpass_json, read_elements};
use osd_pipeline::format::{FormatInput, Formatted, SkimapSkiArea, format_all};
use serde::Deserialize;
use serde_json::{Value, json};
use std::str::FromStr;

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
struct Roles {
    runs: Value,
    lifts: Value,
    #[serde(rename = "skiAreas")]
    ski_areas: Value,
    sites: Value,
    spots: Value,
    skimap: Vec<Value>,
}

#[derive(Deserialize)]
struct Expected {
    #[serde(rename = "skiAreas")]
    ski_areas: Vec<Value>,
    runs: Vec<Value>,
    lifts: Vec<Value>,
    spots: Vec<Value>,
}

fn features(elements: &Value) -> Vec<osd_osm::element::Feature> {
    let document = json!({ "elements": elements }).to_string();
    convert_overpass_json(document.as_bytes()).unwrap()
}

fn relations(elements: &Value) -> Vec<osd_osm::element::Relation> {
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

fn skimap(value: &Value) -> SkimapSkiArea {
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

fn same(a: &Value, b: &Value) -> bool {
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

fn geometry_json(geometry: &Geometry) -> Value {
    serde_json::to_value(geometry).unwrap()
}

fn fixed_geometry_json(geometry: &InputGeometry) -> Value {
    let pair = |c: &osd_store::FixedCoord| json!([c.lng_degrees(), c.lat_degrees()]);
    match geometry {
        InputGeometry::Line(points) => json!({
            "type": "LineString", "coordinates": points.iter().map(pair).collect::<Vec<_>>()
        }),
        InputGeometry::Polygon(rings) => json!({
            "type": "Polygon",
            "coordinates": rings.iter().map(|r| r.iter().map(pair).collect::<Vec<_>>()).collect::<Vec<_>>()
        }),
    }
}

fn with_sites(properties: &mut Value, sites: &[String]) {
    let object = properties.as_object_mut().unwrap();
    object.remove("skiAreas");
    object.insert("siteSkiAreaIds".into(), json!(sites));
}

fn actual(formatted: &Formatted) -> Expected {
    Expected {
        ski_areas: formatted
            .ski_areas
            .iter()
            .map(|a| {
                json!({
                    "geometry": serde_json::to_value(&a.geometry).unwrap(),
                    "properties": serde_json::to_value(&a.properties).unwrap(),
                })
            })
            .collect(),
        runs: formatted
            .runs
            .iter()
            .map(|r| {
                let mut properties = serde_json::to_value(&r.properties).unwrap();
                with_sites(&mut properties, &r.site_ski_areas);
                json!({ "geometry": fixed_geometry_json(&r.geometry), "properties": properties })
            })
            .collect(),
        lifts: formatted
            .lifts
            .iter()
            .map(|l| {
                let mut properties = serde_json::to_value(&l.properties).unwrap();
                with_sites(&mut properties, &l.site_ski_areas);
                json!({ "geometry": geometry_json(&l.geometry), "properties": properties })
            })
            .collect(),
        spots: formatted
            .spots
            .iter()
            .map(|s| {
                let mut properties = serde_json::to_value(&s.properties).unwrap();
                with_sites(&mut properties, &s.site_ski_areas);
                json!({
                    "geometry": { "type": "Point", "coordinates": s.coordinates },
                    "properties": properties,
                })
            })
            .collect(),
    }
}

#[test]
fn every_recorded_scene_is_reproduced() {
    let scenes: Scenes = serde_json::from_str(include_str!("format_scenes.json")).unwrap();
    assert!(scenes.scenes.len() >= 500);

    let mut failures: Vec<String> = Vec::new();
    for (n, scene) in scenes.scenes.iter().enumerate() {
        let input = FormatInput {
            runs: features(&scene.roles.runs),
            lifts: features(&scene.roles.lifts),
            ski_areas: features(&scene.roles.ski_areas),
            sites: relations(&scene.roles.sites),
            spots: features(&scene.roles.spots),
            skimap: scene.roles.skimap.iter().map(skimap).collect(),
        };
        let formatted = match format_all(&input) {
            Ok(formatted) => formatted,
            Err(error) => {
                failures.push(format!("scene {n}: {error:#}"));
                continue;
            }
        };
        let actual = actual(&formatted);

        for (role, got, want) in [
            ("skiAreas", &actual.ski_areas, &scene.expected.ski_areas),
            ("runs", &actual.runs, &scene.expected.runs),
            ("lifts", &actual.lifts, &scene.expected.lifts),
            ("spots", &actual.spots, &scene.expected.spots),
        ] {
            if got.len() != want.len() {
                failures.push(format!(
                    "scene {n} {role}: {} features, expected {}",
                    got.len(),
                    want.len()
                ));
                continue;
            }
            for (i, (g, w)) in got.iter().zip(want).enumerate() {
                if !same(g, w) {
                    failures.push(format!(
                        "scene {n} {role}[{i}]\n  actual:   {g}\n  expected: {w}"
                    ));
                    break;
                }
            }
        }
        if failures.len() >= 6 {
            break;
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}
