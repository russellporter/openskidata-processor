//! Cross-checks the run tag derivations against the 352 recorded run cases.
//!
//! The unit tests in `run.rs` pin what I believe upstream does; this checks it against
//! what upstream actually produced, over the whole corpus including the deliberately
//! nonsensical tag values.

use openskidata_format::{RunDifficulty, RunGrooming, RunUse};
use osd_tags::{
    Tags,
    osm::{first_value, osm_name, osm_ref},
    run::{difficulty, grooming, oneway, status_and_uses},
};
use serde::Deserialize;
use std::str::FromStr;

#[derive(Debug, Deserialize)]
struct Vectors {
    runs: Vec<Case>,
}

#[derive(Debug, Deserialize)]
struct Case {
    tags: Tags,
    output: serde_json::Value,
}

fn cases() -> Vec<Case> {
    let v: Vectors =
        serde_json::from_str(include_str!("vectors.json")).expect("vectors.json deserializes");
    v.runs
}

/// The single formatted run for a case, when the case produced exactly one.
///
/// Multi-geometry inputs can yield several, but the corpus uses a single LineString, so
/// anything other than one output means the run was filtered out.
fn single_output(case: &Case) -> Option<&serde_json::Value> {
    let outputs = case.output.as_array()?;
    if outputs.len() == 1 {
        Some(&outputs[0])
    } else {
        None
    }
}

#[test]
fn uses_match_the_live_implementation() {
    let mut checked = 0;
    for case in &cases() {
        let Some(output) = single_output(case) else {
            continue;
        };
        let expected: Vec<RunUse> = output
            .get("uses")
            .and_then(|u| u.as_array())
            .expect("uses is an array")
            .iter()
            .map(|u| RunUse::from_str(u.as_str().expect("a string")).expect("known use"))
            .collect();

        let (_, actual) = status_and_uses(&case.tags);
        assert_eq!(actual, expected, "tags {:?}", case.tags);
        checked += 1;
    }
    assert!(checked > 200, "only checked {checked} cases");
}

#[test]
fn oneway_matches_the_live_implementation() {
    for case in &cases() {
        let Some(output) = single_output(case) else {
            continue;
        };
        let expected = output.get("oneway").and_then(|v| v.as_bool());
        let (_, uses) = status_and_uses(&case.tags);
        assert_eq!(oneway(&case.tags, &uses), expected, "tags {:?}", case.tags);
    }
}

#[test]
fn grooming_matches_the_live_implementation() {
    let mut seen = std::collections::BTreeSet::new();
    for case in &cases() {
        let Some(output) = single_output(case) else {
            continue;
        };
        let expected = output
            .get("grooming")
            .and_then(|v| v.as_str())
            .map(|v| RunGrooming::from_str(v).expect("known grooming"));
        assert_eq!(grooming(&case.tags), expected, "tags {:?}", case.tags);
        if let Some(value) = expected {
            seen.insert(value);
        }
    }
    assert!(
        seen.len() >= 6,
        "the corpus should exercise most grooming values, saw {seen:?}"
    );
}

#[test]
fn difficulty_matches_the_live_implementation() {
    let mut seen = std::collections::BTreeSet::new();
    for case in &cases() {
        let Some(output) = single_output(case) else {
            continue;
        };
        let expected = output
            .get("difficulty")
            .and_then(|v| v.as_str())
            .map(|v| RunDifficulty::from_str(v).expect("known difficulty"));
        assert_eq!(difficulty(&case.tags), expected, "tags {:?}", case.tags);
        if let Some(value) = expected {
            seen.insert(value);
        }
    }
    assert_eq!(
        seen.len(),
        7,
        "every difficulty should appear, saw {seen:?}"
    );
}

/// Whether a case was filtered out must agree too: a run is dropped when it has no
/// recognized use, or when its lifecycle state rejects or prefixes it.
#[test]
fn filtering_agrees_with_the_live_implementation() {
    let mut filtered = 0;
    let mut kept = 0;
    for case in &cases() {
        let Some(outputs) = case.output.as_array() else {
            continue;
        };
        let (status, uses) = status_and_uses(&case.tags);
        // Upstream keeps a run only when it is operating and has at least one use.
        let would_keep = status == Some(openskidata_format::Status::Operating) && !uses.is_empty();

        assert_eq!(
            would_keep,
            !outputs.is_empty(),
            "tags {:?} resolved to status {:?} uses {:?}",
            case.tags,
            status,
            uses
        );
        if outputs.is_empty() {
            filtered += 1;
        } else {
            kept += 1;
        }
    }
    assert!(
        filtered > 50 && kept > 200,
        "filtered {filtered}, kept {kept}"
    );
}

/// Names are the most intricate derivation here — localized variants, the piste-versus-
/// plain fallback, de-duplication and reference-prefix stripping all interact — so they
/// are checked over the whole corpus rather than only the cases I thought to write.
#[test]
fn names_match_the_live_implementation() {
    let mut named = 0;
    for case in &cases() {
        let Some(output) = single_output(case) else {
            continue;
        };
        let expected = output.get("name").and_then(|v| v.as_str());
        let reference = osm_ref(&case.tags);
        let actual = osm_name(&case.tags, "piste:name", Some("name"), reference.as_deref());

        assert_eq!(
            actual.as_deref(),
            expected,
            "tags {:?} (ref {:?})",
            case.tags,
            reference
        );
        if expected.is_some() {
            named += 1;
        }
    }
    assert!(named > 15, "only {named} named cases in the corpus");
}

#[test]
fn refs_match_the_live_implementation() {
    for case in &cases() {
        let Some(output) = single_output(case) else {
            continue;
        };
        let expected = output.get("ref").and_then(|v| v.as_str());
        assert_eq!(
            osm_ref(&case.tags).as_deref(),
            expected,
            "tags {:?}",
            case.tags
        );
    }
}

#[test]
fn wikidata_ids_match_the_live_implementation() {
    for case in &cases() {
        let Some(output) = single_output(case) else {
            continue;
        };
        let expected = output.get("wikidataID").and_then(|v| v.as_str());
        assert_eq!(
            first_value(&case.tags, "wikidata").as_deref(),
            expected,
            "tags {:?}",
            case.tags
        );
    }
}
