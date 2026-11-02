//! Cross-checks the ski area derivations against the 85 recorded cases, one corpus per
//! input arm.

use openskidata_format::{SkiAreaActivity, Status};
use osd_store::GeometryKind;
use osd_tags::{
    Tags,
    ski_area::{
        SkiAreaTagProperties, SkimapInput, landuse, placeholder_site_geometry, site, skimap,
    },
};
use serde::Deserialize;
use serde_json::Value;
use std::str::FromStr;

#[derive(Debug, Deserialize)]
struct Vectors {
    #[serde(rename = "skiAreas")]
    ski_areas: SkiAreas,
}

#[derive(Debug, Deserialize)]
struct SkiAreas {
    landuse: Vec<LanduseCase>,
    site: Vec<SiteCase>,
    skimap: Vec<SkimapCase>,
}

#[derive(Debug, Deserialize)]
struct LanduseCase {
    tags: Tags,
    #[serde(rename = "geometryType")]
    geometry_type: String,
    output: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct SiteCase {
    #[serde(rename = "relationId")]
    relation_id: i64,
    tags: Tags,
    output: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct SkimapCase {
    properties: Value,
    output: Option<Value>,
}

fn vectors() -> SkiAreas {
    let v: Vectors =
        serde_json::from_str(include_str!("vectors.json")).expect("vectors.json deserializes");
    v.ski_areas
}

fn geometry_kind(name: &str) -> GeometryKind {
    match name {
        "Point" => GeometryKind::Point,
        "LineString" => GeometryKind::LineString,
        "Polygon" => GeometryKind::Polygon,
        "MultiLineString" => GeometryKind::MultiLineString,
        "MultiPolygon" => GeometryKind::MultiPolygon,
        other => panic!("unexpected geometry type {other}"),
    }
}

/// Asserts the tag-derived fields of an upstream output against ours.
fn assert_matches(actual: &SkiAreaTagProperties, expected: &Value, context: &str) {
    let props = expected.get("properties").expect("output has properties");

    assert_eq!(
        actual.name.as_deref(),
        props.get("name").and_then(Value::as_str),
        "name: {context}"
    );
    assert_eq!(
        actual.status.map(|s| s.as_wire_str()),
        props.get("status").and_then(Value::as_str),
        "status: {context}"
    );
    assert_eq!(
        actual.wikidata_id.as_deref(),
        props.get("wikidataID").and_then(Value::as_str),
        "wikidata: {context}"
    );

    let websites: Vec<&str> = props["websites"]
        .as_array()
        .expect("websites array")
        .iter()
        .map(|w| w.as_str().expect("string"))
        .collect();
    assert_eq!(
        actual
            .websites
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        websites,
        "websites: {context}"
    );

    let sources = props["sources"].as_array().expect("sources array");
    assert_eq!(
        actual.sources.len(),
        sources.len(),
        "source count: {context}"
    );
    assert_eq!(
        actual.sources[0].id,
        sources[0]["id"].as_str().expect("source id"),
        "source id: {context}"
    );
    assert_eq!(
        actual.sources[0].source_type.as_wire_str(),
        sources[0]["type"].as_str().expect("source type"),
        "source type: {context}"
    );

    let activities: Vec<&str> = props["activities"]
        .as_array()
        .expect("activities array")
        .iter()
        .map(|a| a.as_str().expect("string"))
        .collect();
    assert_eq!(
        actual
            .activities
            .iter()
            .map(|a| a.as_wire_str())
            .collect::<Vec<_>>(),
        activities,
        "activities: {context}"
    );
}

/// Acceptance and rejection must agree exactly: this is the gate that decides whether a
/// ski area exists at all.
#[test]
fn landuse_matches_the_live_implementation() {
    let (mut accepted, mut rejected) = (0, 0);
    for case in &vectors().landuse {
        let actual = landuse("way", 7, &case.tags, geometry_kind(&case.geometry_type));
        let context = format!("{:?} ({})", case.tags, case.geometry_type);

        match (&actual, &case.output) {
            (Some(actual), Some(expected)) => {
                assert_matches(actual, expected, &context);
                accepted += 1;
            }
            (None, None) => rejected += 1,
            (Some(_), None) => panic!("we accepted, upstream rejected: {context}"),
            (None, Some(_)) => panic!("we rejected, upstream accepted: {context}"),
        }
    }
    assert!(
        accepted >= 18 && rejected >= 5,
        "accepted {accepted}, rejected {rejected}"
    );
}

#[test]
fn site_matches_the_live_implementation() {
    let (mut accepted, mut rejected) = (0, 0);
    for case in &vectors().site {
        let actual = site("relation", case.relation_id, &case.tags);
        let context = format!("{:?} (relation {})", case.tags, case.relation_id);

        match (&actual, &case.output) {
            (Some(actual), Some(expected)) => {
                assert_matches(actual, expected, &context);

                // The geometry is a function of the relation id alone.
                let coordinates: Vec<f64> = expected["geometry"]["coordinates"]
                    .as_array()
                    .expect("coordinates")
                    .iter()
                    .map(|c| c.as_f64().expect("number"))
                    .collect();
                assert_eq!(
                    coordinates,
                    placeholder_site_geometry(case.relation_id).to_vec(),
                    "placeholder geometry: {context}"
                );
                accepted += 1;
            }
            (None, None) => rejected += 1,
            (Some(_), None) => panic!("we accepted, upstream rejected: {context}"),
            (None, Some(_)) => panic!("we rejected, upstream accepted: {context}"),
        }
    }
    assert!(
        accepted >= 14 && rejected >= 2,
        "accepted {accepted}, rejected {rejected}"
    );
}

#[test]
fn skimap_matches_the_live_implementation() {
    let mut statuses = std::collections::BTreeSet::new();
    for case in &vectors().skimap {
        let p = &case.properties;
        let activities: Vec<SkiAreaActivity> = p["activities"]
            .as_array()
            .expect("activities")
            .iter()
            .map(|a| SkiAreaActivity::from_str(a.as_str().expect("string")).expect("known"))
            .collect();
        let status = p["status"]
            .as_str()
            .map(|s| Status::from_str(s).expect("known status"));

        let actual = skimap(SkimapInput {
            id: p["id"].as_str().expect("id"),
            name: p.get("name").and_then(Value::as_str),
            status,
            activities: &activities,
            official_website: p.get("official_website").and_then(Value::as_str),
        });

        let expected = case.output.as_ref().expect("Skimap.org is never rejected");
        assert_matches(&actual, expected, &format!("{p}"));
        statuses.insert(format!("{status:?}"));
    }
    assert_eq!(
        statuses.len(),
        7,
        "every status plus null should appear: {statuses:?}"
    );
}
