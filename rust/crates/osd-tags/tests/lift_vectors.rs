//! Cross-checks the lift tag derivations against the 136 recorded lift cases.

use openskidata_format::{LiftType, Status};
use osd_tags::{
    Tags,
    lift::{duration_seconds, is_lift, status_and_lift_type},
};
use serde::Deserialize;
use std::str::FromStr;

#[derive(Debug, Deserialize)]
struct Vectors {
    lifts: Vec<Case>,
}

#[derive(Debug, Deserialize)]
struct Case {
    tags: Tags,
    output: serde_json::Value,
}

fn cases() -> Vec<Case> {
    let v: Vectors =
        serde_json::from_str(include_str!("vectors.json")).expect("vectors.json deserializes");
    v.lifts
}

/// Whether a way is a lift must agree exactly. This is the gate that decides whether a
/// feature reaches the dataset at all.
#[test]
fn lift_acceptance_matches_the_live_implementation() {
    let mut accepted = 0;
    let mut rejected = 0;

    for case in &cases() {
        let expected = !case.output.is_null();
        assert_eq!(
            is_lift(&case.tags),
            expected,
            "tags {:?}: upstream {} it",
            case.tags,
            if expected { "accepted" } else { "rejected" }
        );
        if expected {
            accepted += 1;
        } else {
            rejected += 1;
        }
    }

    assert!(
        accepted > 90 && rejected > 20,
        "accepted {accepted}, rejected {rejected}"
    );
}

#[test]
fn lift_type_and_status_match_the_live_implementation() {
    let mut types_seen = std::collections::BTreeSet::new();
    let mut statuses_seen = std::collections::BTreeSet::new();

    for case in &cases() {
        if case.output.is_null() {
            continue;
        }
        let expected_type = LiftType::from_str(
            case.output
                .get("liftType")
                .and_then(|v| v.as_str())
                .expect("an accepted lift has a type"),
        )
        .expect("known lift type");
        let expected_status = Status::from_str(
            case.output
                .get("status")
                .and_then(|v| v.as_str())
                .expect("an accepted lift has a status"),
        )
        .expect("known status");

        let (status, lift_type) = status_and_lift_type(&case.tags);
        assert_eq!(lift_type, Some(expected_type), "tags {:?}", case.tags);
        assert_eq!(status, Some(expected_status), "tags {:?}", case.tags);

        types_seen.insert(expected_type);
        statuses_seen.insert(expected_status);
    }

    assert_eq!(types_seen.len(), 12, "every lift type should appear");
    assert_eq!(statuses_seen.len(), 6, "every status should appear");
}

#[test]
fn durations_match_the_live_implementation() {
    let mut checked = 0;
    for case in &cases() {
        if case.output.is_null() {
            continue;
        }
        let expected = case.output.get("duration").and_then(|v| v.as_f64());
        let actual = duration_seconds(case.tags.get("aerialway:duration").map(String::as_str));
        assert_eq!(actual, expected, "tags {:?}", case.tags);
        if expected.is_some() {
            checked += 1;
        }
    }
    assert!(checked > 0, "the corpus should contain parseable durations");
}
