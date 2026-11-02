//! `merged_properties` and the run comparison against recorded output of the real
//! implementation (`rust/codegen/generate-merge-vectors.mjs`).

use openskidata_format::run::RunProperties;
use osd_normalize::properties::{is_part_of_same_run, merged_properties};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Vectors {
    merges: Vec<Merge>,
    comparisons: Vec<Comparison>,
}

#[derive(Deserialize)]
struct Merge {
    inputs: Vec<Value>,
    expected: Value,
}

#[derive(Deserialize)]
struct Comparison {
    left: Value,
    right: Value,
    expected: bool,
}

fn vectors() -> Vectors {
    serde_json::from_str(include_str!("merge_vectors.json")).unwrap()
}

fn properties(value: &Value) -> RunProperties {
    serde_json::from_value(value.clone())
        .unwrap_or_else(|error| panic!("deserializing {value}: {error}"))
}

/// Numbers compare as `f64`; JSON drops `undefined` object members, which the typed side
/// models as `null` or omits, so only keys present in the expectation are required.
fn same(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(x, y)| same(x, y))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len() && a.iter().all(|(k, x)| b.get(k).is_some_and(|y| same(x, y)))
        }
        _ => actual == expected,
    }
}

#[test]
fn merged_properties_match_the_live_implementation() {
    let vectors = vectors();
    assert!(vectors.merges.len() >= 800);
    for (n, case) in vectors.merges.iter().enumerate() {
        let inputs: Vec<RunProperties> = case.inputs.iter().map(properties).collect();
        let refs: Vec<&RunProperties> = inputs.iter().collect();
        let actual = serde_json::to_value(merged_properties(&refs)).unwrap();
        assert!(
            same(&actual, &case.expected),
            "case {n}\n  inputs:   {:?}\n  actual:   {actual}\n  expected: {}",
            case.inputs,
            case.expected
        );
    }
}

#[test]
fn run_comparison_matches_the_live_implementation() {
    let vectors = vectors();
    let (mut equal, mut different) = (0, 0);
    for (n, case) in vectors.comparisons.iter().enumerate() {
        let actual = is_part_of_same_run(&properties(&case.left), &properties(&case.right));
        assert_eq!(
            actual, case.expected,
            "case {n}\n  left:  {}\n  right: {}",
            case.left, case.right
        );
        if actual {
            equal += 1;
        } else {
            different += 1;
        }
    }
    assert!(
        equal > 100 && different > 50,
        "{equal} equal, {different} different"
    );
}
