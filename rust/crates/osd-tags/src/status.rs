//! OpenStreetMap lifecycle tagging to [`Status`].
//!
//! Replaces: `src/transforms/Status.ts`.
//!
//! OSM has several conventions for saying that a feature is not currently in use, and
//! this supports the ones that appear in practice:
//!
//! - `disused:aerialway=chair_lift` — the lifecycle prefix carries the status and the tag
//!   value moves with it.
//! - `aerialway=construction` plus `construction=chair_lift` — the status is the *value*
//!   of the main tag, and the real value is under a key named after the status.
//! - `aerialway=chair_lift` plus `disused=yes` — a bare lifecycle flag alongside the
//!   normal tag.
//!
//! Three states mean the feature is gone rather than idle (`demolished`, `removed`,
//! `razed`); those are rejected outright rather than given a status.

use openskidata_format::Status;
use std::collections::BTreeMap;

/// Raw OSM tags for one element.
pub type Tags = BTreeMap<String, String>;

/// The lifecycle states that have a prefix form, in the order they are checked.
///
/// Order matters for the bare-flag case: a feature tagged both `disused=yes` and
/// `proposed=yes` takes the first match, and upstream iterates this set in declaration
/// order. `Operating` is deliberately absent — it is the absence of a lifecycle marker,
/// not a state to search for.
pub const LIFECYCLE_STATES: &[Status] = &[
    Status::Disused,
    Status::Abandoned,
    Status::Proposed,
    Status::Planned,
    Status::Construction,
];

/// States meaning the feature no longer exists, so it is dropped rather than recorded.
pub const UNSUPPORTED_STATES: &[&str] = &["demolished", "removed", "razed"];

/// The tag prefix for a lifecycle state, e.g. `disused:`.
pub fn lifecycle_prefix(status: Status) -> &'static str {
    match status {
        Status::Operating => "",
        Status::Disused => "disused:",
        Status::Abandoned => "abandoned:",
        Status::Proposed => "proposed:",
        Status::Planned => "planned:",
        Status::Construction => "construction:",
    }
}

/// The resolved status of a tag, and the value it actually carries.
///
/// `status: None` means the feature is in an unsupported state and must be dropped
/// entirely — distinct from `value: None`, which only means the tag was absent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusAndValue {
    pub status: Option<Status>,
    pub value: Option<String>,
}

/// Whether the tags say the feature no longer exists.
fn is_unsupported(key: &str, tags: &Tags) -> bool {
    if let Some(value) = tags.get(key) {
        if UNSUPPORTED_STATES.contains(&value.as_str()) {
            return true;
        }
    }
    UNSUPPORTED_STATES
        .iter()
        .any(|state| tags.get(*state).map(String::as_str) == Some("yes"))
}

fn status_from_name(name: &str) -> Option<Status> {
    LIFECYCLE_STATES
        .iter()
        .copied()
        .find(|state| state.as_wire_str() == name)
}

/// Resolves the status of `key` and the value it carries.
///
/// Replaces `getStatusAndValue`. An empty tag value is treated as absent, matching
/// upstream's `properties[key] || null`, because `""` there is falsy.
pub fn status_and_value(key: &str, tags: &Tags) -> StatusAndValue {
    if is_unsupported(key, tags) {
        return StatusAndValue {
            status: None,
            value: None,
        };
    }

    let non_empty =
        |value: Option<&String>| -> Option<String> { value.filter(|v| !v.is_empty()).cloned() };

    if let Some(value_or_status) = tags.get(key) {
        // `aerialway=construction` with the real value under `construction=...`.
        if let Some(status) = status_from_name(value_or_status) {
            return StatusAndValue {
                status: Some(status),
                value: non_empty(tags.get(value_or_status)),
            };
        }
    } else {
        // `disused:aerialway=chair_lift`.
        for &state in LIFECYCLE_STATES {
            let prefixed = format!("{}{}", lifecycle_prefix(state), key);
            if let Some(value) = tags.get(&prefixed) {
                return StatusAndValue {
                    status: Some(state),
                    value: non_empty(Some(value)),
                };
            }
        }
    }

    // A bare lifecycle flag alongside the normal tag. First match wins.
    let mut status = Status::Operating;
    for &state in LIFECYCLE_STATES {
        if tags.get(state.as_wire_str()).map(String::as_str) == Some("yes") {
            status = state;
            break;
        }
    }

    StatusAndValue {
        status: Some(status),
        value: non_empty(tags.get(key)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(pairs: &[(&str, &str)]) -> Tags {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    #[test]
    fn a_plain_tag_is_operating() {
        let result = status_and_value("aerialway", &tags(&[("aerialway", "chair_lift")]));
        assert_eq!(result.status, Some(Status::Operating));
        assert_eq!(result.value.as_deref(), Some("chair_lift"));
    }

    #[test]
    fn a_lifecycle_prefix_carries_the_status_and_the_value() {
        for &(prefix, expected) in &[
            ("disused:", Status::Disused),
            ("abandoned:", Status::Abandoned),
            ("proposed:", Status::Proposed),
            ("planned:", Status::Planned),
            ("construction:", Status::Construction),
        ] {
            let key = format!("{prefix}aerialway");
            let result = status_and_value("aerialway", &tags(&[(&key, "chair_lift")]));
            assert_eq!(result.status, Some(expected), "prefix {prefix}");
            assert_eq!(
                result.value.as_deref(),
                Some("chair_lift"),
                "prefix {prefix}"
            );
        }
    }

    /// `aerialway=construction` with the real value under `construction=...`.
    #[test]
    fn the_status_can_be_the_value_of_the_main_tag() {
        let result = status_and_value(
            "aerialway",
            &tags(&[
                ("aerialway", "construction"),
                ("construction", "chair_lift"),
            ]),
        );
        assert_eq!(result.status, Some(Status::Construction));
        assert_eq!(result.value.as_deref(), Some("chair_lift"));
    }

    /// The same form with no value under the status key leaves the value unknown.
    #[test]
    fn the_status_as_value_without_a_companion_tag_has_no_value() {
        let result = status_and_value("aerialway", &tags(&[("aerialway", "construction")]));
        assert_eq!(result.status, Some(Status::Construction));
        assert_eq!(result.value, None);
    }

    #[test]
    fn a_bare_lifecycle_flag_applies_to_the_normal_tag() {
        let result = status_and_value(
            "aerialway",
            &tags(&[("aerialway", "chair_lift"), ("disused", "yes")]),
        );
        assert_eq!(result.status, Some(Status::Disused));
        assert_eq!(result.value.as_deref(), Some("chair_lift"));
    }

    /// Only `yes` counts; any other value is not a lifecycle assertion.
    #[test]
    fn a_bare_flag_that_is_not_yes_is_ignored() {
        let result = status_and_value(
            "aerialway",
            &tags(&[("aerialway", "chair_lift"), ("disused", "no")]),
        );
        assert_eq!(result.status, Some(Status::Operating));
    }

    /// With two bare flags the first in the checked order wins, as upstream does.
    #[test]
    fn competing_bare_flags_resolve_in_declaration_order() {
        let result = status_and_value(
            "aerialway",
            &tags(&[
                ("aerialway", "chair_lift"),
                ("proposed", "yes"),
                ("disused", "yes"),
            ]),
        );
        assert_eq!(
            result.status,
            Some(Status::Disused),
            "disused is checked before proposed"
        );
    }

    #[test]
    fn unsupported_states_reject_the_feature() {
        for state in UNSUPPORTED_STATES {
            let result = status_and_value("aerialway", &tags(&[("aerialway", state)]));
            assert_eq!(result.status, None, "value {state}");
            assert_eq!(result.value, None);

            let result = status_and_value(
                "aerialway",
                &tags(&[("aerialway", "chair_lift"), (state, "yes")]),
            );
            assert_eq!(result.status, None, "bare flag {state}");
        }
    }

    /// A rejection is distinct from a missing tag: both have no value, but only one has
    /// no status.
    #[test]
    fn a_missing_tag_is_operating_with_no_value() {
        let result = status_and_value("aerialway", &tags(&[("name", "Something")]));
        assert_eq!(result.status, Some(Status::Operating));
        assert_eq!(result.value, None);
    }

    /// Upstream uses `properties[key] || null`, so an empty string is falsy and reads as
    /// absent.
    #[test]
    fn an_empty_value_reads_as_absent() {
        let result = status_and_value("aerialway", &tags(&[("aerialway", "")]));
        assert_eq!(result.status, Some(Status::Operating));
        assert_eq!(result.value, None);
    }

    #[test]
    fn lifecycle_prefixes_match_the_tagging_scheme() {
        assert_eq!(lifecycle_prefix(Status::Operating), "");
        assert_eq!(lifecycle_prefix(Status::Disused), "disused:");
        assert_eq!(lifecycle_prefix(Status::Construction), "construction:");
    }
}
