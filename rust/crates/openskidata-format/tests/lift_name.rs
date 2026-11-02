//! `lift_name_and_type` against the real `getLiftNameAndType`: every lift type crossed with
//! occupancies, heating/bubble flags and names that do and do not imply a type.

use openskidata_format::lift::{LiftProperties, lift_name_and_type};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
struct Vectors {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    properties: Value,
    expected: Option<String>,
}

/// A full `LiftProperties` around the fields that matter.
fn lift(partial: &Value) -> LiftProperties {
    let mut full = json!({
        "type": "lift", "id": "x", "liftType": "chair_lift", "status": "operating",
        "access": null, "name": null, "ref": null, "refFRCAIRN": null, "description": null,
        "oneway": null, "occupancy": null, "capacity": null, "duration": null,
        "detachable": null, "bubble": null, "heating": null, "tunnel": null, "stations": [],
        "skiAreas": [], "sources": [], "websites": [], "wikidataID": null, "places": [],
        "viewportHint": {"center": [0, 0], "bearing": null, "rotatedWidthMeters": 0,
                         "rotatedHeightMeters": 0, "minCameraY": 0},
    });
    for (key, value) in partial.as_object().unwrap() {
        full[key] = value.clone();
    }
    serde_json::from_value(full).unwrap()
}

#[test]
fn names_and_types_match_the_live_implementation() {
    let vectors: Vectors = serde_json::from_str(include_str!("lift_name_vectors.json")).unwrap();
    assert!(vectors.cases.len() >= 3000);
    for (n, case) in vectors.cases.iter().enumerate() {
        let actual = lift_name_and_type(&lift(&case.properties));
        assert_eq!(actual, case.expected, "case {n}: {}", case.properties);
    }
}
