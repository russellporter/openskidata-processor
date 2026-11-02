//! The assembled run and lift properties against every recorded formatter output.
//!
//! The per-field tests elsewhere check each derivation; this checks that they are wired
//! to the right fields, since a swap between two same-typed fields (`lit`/`patrolled`)
//! passes every one of them.

use openskidata_format::RunDifficultyConvention;
use osd_tags::{Tags, lift::lift_properties, run::run_properties};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Vectors {
    runs: Vec<Case>,
    lifts: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    tags: Tags,
    output: Value,
}

fn vectors() -> Vectors {
    serde_json::from_str(include_str!("vectors.json")).expect("vectors.json deserializes")
}

/// Keys the formatter fills in later, so they are absent from the tag-derived properties.
fn without(mut object: Value, keys: &[&str]) -> Value {
    let map = object.as_object_mut().expect("an object");
    for key in keys {
        map.remove(*key);
    }
    object
}

/// JSON cannot carry NaN or Infinity, which `JSON.stringify` writes as `null` and so
/// serde_json does too; numbers otherwise compare as `f64`.
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(key, p)| y.get(key).is_some_and(|q| same(p, q)))
        }
        _ => a == b,
    }
}

#[test]
fn every_run_matches_the_live_formatter() {
    let mut accepted = 0;
    for case in vectors().runs {
        let outputs = case.output.as_array().expect("an array of runs");
        // The corpus geometry is a single valid LineString at a European location, and the
        // convention is supplied by the caller, so it is read back from the expectation.
        let expected = outputs.first();
        let convention = expected
            .and_then(|o| o["difficultyConvention"].as_str())
            .map(|c| serde_json::from_value::<RunDifficultyConvention>(c.into()).unwrap())
            .unwrap_or(RunDifficultyConvention::Europe);

        let actual = run_properties(&case.tags, "way", 1, convention);
        match expected {
            None => assert!(actual.is_none(), "tags {:?} should be rejected", case.tags),
            Some(expected) => {
                let actual = serde_json::to_value(actual.expect("accepted")).unwrap();
                assert!(
                    same(&actual, expected),
                    "tags {:?}\n  actual:   {actual}\n  expected: {expected}",
                    case.tags
                );
                accepted += 1;
            }
        }
    }
    assert!(accepted > 250, "only {accepted} runs compared");
}

#[test]
fn every_lift_matches_the_live_formatter() {
    let mut accepted = 0;
    for case in vectors().lifts {
        let actual = lift_properties(&case.tags, "way", 1);
        if case.output.is_null() {
            assert!(actual.is_none(), "tags {:?} should be rejected", case.tags);
            continue;
        }
        let expected = without(case.output.clone(), &["stations"]);
        assert_eq!(
            case.output["stations"],
            serde_json::json!([]),
            "stations are attached later by clustering"
        );
        let actual = serde_json::to_value(actual.expect("accepted")).unwrap();
        assert!(
            same(&actual, &expected),
            "tags {:?}\n  actual:   {actual}\n  expected: {expected}",
            case.tags
        );
        accepted += 1;
    }
    assert!(accepted > 150, "only {accepted} lifts compared");
}
