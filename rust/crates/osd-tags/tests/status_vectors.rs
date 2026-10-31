//! Cross-checks the lifecycle resolution against the vectors recorded from the live
//! TypeScript formatters.
//!
//! The unit tests in `status.rs` pin the behaviour I believe upstream has. This checks
//! that belief against what upstream actually produced, over every lift case in the
//! corpus — which is the part of it that exercises all six lifecycle states, since runs
//! with a lifecycle prefix are filtered out entirely and only ever come out as operating.

use openskidata_format::Status;
use osd_tags::{Tags, status_and_value};
use serde::Deserialize;
use std::str::FromStr;

#[derive(Debug, Deserialize)]
struct Vectors {
    #[serde(rename = "formatVersion")]
    format_version: String,
    runs: Vec<Case>,
    lifts: Vec<Case>,
}

#[derive(Debug, Deserialize)]
struct Case {
    tags: Tags,
    output: serde_json::Value,
}

fn vectors() -> Vectors {
    serde_json::from_str(include_str!("vectors.json")).expect("vectors.json should deserialize")
}

/// The key a lift's status is read from. Upstream `LiftFormatter` looks at `aerialway`
/// first and falls back to `railway`, including their lifecycle-prefixed forms.
fn lift_status_key(tags: &Tags) -> Option<&'static str> {
    let has = |base: &str| {
        tags.keys()
            .any(|k| k == base || k.ends_with(&format!(":{base}")))
    };
    if has("aerialway") {
        Some("aerialway")
    } else if has("railway") {
        Some("railway")
    } else {
        None
    }
}

#[test]
fn vectors_were_generated_against_the_pinned_format_version() {
    assert_eq!(vectors().format_version, "16.0.0");
}

#[test]
fn lift_statuses_match_the_live_implementation() {
    let v = vectors();
    let mut checked = 0;
    let mut seen_states = std::collections::BTreeSet::new();

    for case in &v.lifts {
        // A null output means the lift was rejected on its *value* (a station, a pylon, an
        // unknown aerialway), which is a separate concern from its status.
        let Some(expected) = case.output.get("status").and_then(|s| s.as_str()) else {
            continue;
        };
        let Some(key) = lift_status_key(&case.tags) else {
            continue;
        };

        let resolved = status_and_value(key, &case.tags);
        let expected_status = Status::from_str(expected).expect("known status");

        assert_eq!(
            resolved.status,
            Some(expected_status),
            "tags {:?} resolved to {:?}, upstream produced {expected}",
            case.tags,
            resolved.status
        );
        seen_states.insert(expected_status);
        checked += 1;
    }

    assert!(
        checked >= 100,
        "expected the corpus to exercise this heavily, only checked {checked}"
    );
    assert_eq!(
        seen_states.len(),
        6,
        "every lifecycle state should appear, saw {seen_states:?}"
    );
}

/// Runs are dropped entirely when they carry a lifecycle prefix, so every run that
/// survives is operating. This pins that, because it is the reason the run corpus cannot
/// exercise the other states.
#[test]
fn surviving_runs_are_always_operating() {
    let v = vectors();
    let mut surviving = 0;
    let mut filtered = 0;

    for case in &v.runs {
        let Some(outputs) = case.output.as_array() else {
            continue;
        };
        if outputs.is_empty() {
            filtered += 1;
            continue;
        }
        for output in outputs {
            let status = output
                .get("status")
                .and_then(|s| s.as_str())
                .expect("a run has a status");
            assert_eq!(
                status, "operating",
                "tags {:?} produced a run with status {status}",
                case.tags
            );
            surviving += 1;
        }
    }

    assert!(
        surviving > 0 && filtered > 0,
        "the corpus should contain both"
    );
}

/// Every tag set in the corpus resolves without panicking, including the nonsense values
/// deliberately included in it.
#[test]
fn the_whole_corpus_resolves_without_panicking() {
    let v = vectors();
    for case in v.runs.iter().chain(v.lifts.iter()) {
        for key in ["piste:type", "aerialway", "railway"] {
            let _ = status_and_value(key, &case.tags);
        }
    }
}
