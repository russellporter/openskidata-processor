//! OSM tags to run properties.
//!
//! Replaces the tag-reading half of `src/transforms/RunFormatter.ts`, plus the shared
//! helpers in `OSMTransforms.ts` that it uses.

use crate::status::{Tags, status_and_value};
use openskidata_format::{RunDifficulty, RunGrooming, RunUse, Status};
use std::str::FromStr;

/// Reads an OSM boolean-ish tag.
///
/// Replaces `mapOSMBoolean`. Only `yes` and `no` are meaningful; anything else, including
/// an absent tag, is unknown rather than false. That distinction matters because these
/// reach the output as `true | false | null` and a null means "not surveyed".
pub fn osm_boolean(value: Option<&str>) -> Option<bool> {
    match value {
        Some("yes") => Some(true),
        Some("no") => Some(false),
        _ => None,
    }
}

/// First present tag among `keys`, in order.
///
/// Replaces `getOrElse`. The order is the fallback precedence, and for runs the
/// `piste:`-prefixed key always wins over the plain one — a `piste:oneway` is a statement
/// about the piste, whereas a bare `oneway` may be about the underlying road.
pub fn first_present<'a>(tags: &'a Tags, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| tags.get(*key))
        .map(String::as_str)
}

/// The uses a `piste:type` value denotes.
///
/// Replaces `getUses`. The tag is semicolon-separated and values are trimmed and
/// lower-cased; anything not a known use is dropped rather than rejected, so
/// `piste:type=downhill;nonsense` still yields a downhill run.
pub fn uses_from_piste_type(piste_type: &str) -> Vec<RunUse> {
    piste_type
        .split(';')
        .filter_map(|part| RunUse::from_str(part.trim().to_lowercase().as_str()).ok())
        .collect()
}

/// The status and uses of a run.
///
/// Replaces `getStatusAndUses`. Note the special case: `piste:abandoned=yes` forces the
/// status regardless of what the lifecycle resolution found, which is the convention the
/// OSM piste-map wiki documents.
pub fn status_and_uses(tags: &Tags) -> (Option<Status>, Vec<RunUse>) {
    let resolved = status_and_value("piste:type", tags);

    let status = if tags.get("piste:abandoned").map(String::as_str) == Some("yes") {
        // Only overrides a status that exists; an unsupported state still rejects.
        resolved.status.map(|_| Status::Abandoned)
    } else {
        resolved.status
    };

    let uses = resolved
        .value
        .as_deref()
        .map(uses_from_piste_type)
        .unwrap_or_default();

    (status, uses)
}

/// Whether a run is one-way.
///
/// Replaces `getOneway`. Downhill runs default to one-way when untagged, because you
/// cannot ski up them; every other use defaults to unknown.
pub fn oneway(tags: &Tags, uses: &[RunUse]) -> Option<bool> {
    if let Some(value) = osm_boolean(first_present(tags, &["piste:oneway", "oneway"])) {
        return Some(value);
    }
    if uses.contains(&RunUse::Downhill) {
        return Some(true);
    }
    None
}

/// The grooming of a run.
///
/// Replaces `getGrooming`. Three things here are not obvious:
///
/// - The tag is normalized by replacing `;` with `+`, so `classic;skating` and
///   `classic+skating` are the same value.
/// - `classic` together with `skating`, in either order, is the combined value.
/// - The hardest difficulties default to backcountry when grooming is untagged, as does
///   an explicit `piste:grooming=no`. Those defaults are why a run can be groomed
///   `backcountry` with no grooming tag at all.
pub fn grooming(tags: &Tags) -> Option<RunGrooming> {
    if let Some(raw) = tags.get("piste:grooming") {
        let normalized = raw.replace(';', "+");
        if !normalized.is_empty() {
            let parts: Vec<&str> = normalized.split('+').collect();
            if parts.contains(&RunGrooming::Classic.as_wire_str())
                && parts.contains(&RunGrooming::Skating.as_wire_str())
            {
                return Some(RunGrooming::ClassicAndSkating);
            }
            if let Ok(value) = RunGrooming::from_str(&normalized) {
                return Some(value);
            }
        }
    }

    // Defaults. Checked after the tag, so an explicit value always wins.
    if let Some(difficulty) = tags.get("piste:difficulty").map(String::as_str) {
        if matches!(difficulty, "expert" | "freeride" | "extreme") {
            return Some(RunGrooming::Backcountry);
        }
    }
    if tags.get("piste:grooming").map(String::as_str) == Some("no") {
        return Some(RunGrooming::Backcountry);
    }

    None
}

/// The difficulty of a run. An unrecognized value is unknown rather than an error.
pub fn difficulty(tags: &Tags) -> Option<RunDifficulty> {
    tags.get("piste:difficulty")
        .and_then(|value| RunDifficulty::from_str(value).ok())
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
    fn osm_booleans_distinguish_no_from_unknown() {
        assert_eq!(osm_boolean(Some("yes")), Some(true));
        assert_eq!(osm_boolean(Some("no")), Some(false));
        assert_eq!(osm_boolean(Some("maybe")), None);
        assert_eq!(osm_boolean(Some("")), None);
        assert_eq!(osm_boolean(None), None);
    }

    #[test]
    fn the_piste_prefixed_key_wins_over_the_plain_one() {
        let t = tags(&[("oneway", "no"), ("piste:oneway", "yes")]);
        assert_eq!(first_present(&t, &["piste:oneway", "oneway"]), Some("yes"));
    }

    #[test]
    fn multi_value_piste_types_yield_several_uses() {
        assert_eq!(
            uses_from_piste_type("downhill;nordic"),
            vec![RunUse::Downhill, RunUse::Nordic]
        );
        assert_eq!(
            uses_from_piste_type(" Downhill ; SKITOUR "),
            vec![RunUse::Downhill, RunUse::Skitour],
            "values are trimmed and lower-cased"
        );
    }

    #[test]
    fn unknown_uses_are_dropped_not_fatal() {
        assert_eq!(
            uses_from_piste_type("downhill;nonsense"),
            vec![RunUse::Downhill]
        );
        assert!(uses_from_piste_type("nonsense").is_empty());
    }

    #[test]
    fn piste_abandoned_overrides_the_resolved_status() {
        let (status, uses) = status_and_uses(&tags(&[
            ("piste:type", "downhill"),
            ("piste:abandoned", "yes"),
        ]));
        assert_eq!(status, Some(Status::Abandoned));
        assert_eq!(uses, vec![RunUse::Downhill]);
    }

    /// The override must not resurrect a feature that is gone.
    #[test]
    fn piste_abandoned_does_not_override_a_rejection() {
        let (status, _) = status_and_uses(&tags(&[
            ("piste:type", "demolished"),
            ("piste:abandoned", "yes"),
        ]));
        assert_eq!(status, None);
    }

    #[test]
    fn downhill_runs_default_to_oneway() {
        assert_eq!(oneway(&tags(&[]), &[RunUse::Downhill]), Some(true));
        assert_eq!(oneway(&tags(&[]), &[RunUse::Nordic]), None);
        assert_eq!(oneway(&tags(&[]), &[]), None);
    }

    #[test]
    fn an_explicit_oneway_beats_the_downhill_default() {
        assert_eq!(
            oneway(&tags(&[("oneway", "no")]), &[RunUse::Downhill]),
            Some(false)
        );
        assert_eq!(
            oneway(&tags(&[("piste:oneway", "no")]), &[RunUse::Downhill]),
            Some(false)
        );
    }

    #[test]
    fn grooming_normalizes_the_separator() {
        assert_eq!(
            grooming(&tags(&[("piste:grooming", "classic;skating")])),
            Some(RunGrooming::ClassicAndSkating)
        );
        assert_eq!(
            grooming(&tags(&[("piste:grooming", "classic+skating")])),
            Some(RunGrooming::ClassicAndSkating)
        );
        assert_eq!(
            grooming(&tags(&[("piste:grooming", "skating+classic")])),
            Some(RunGrooming::ClassicAndSkating),
            "order within the combined value must not matter"
        );
    }

    #[test]
    fn plain_grooming_values_pass_through() {
        assert_eq!(
            grooming(&tags(&[("piste:grooming", "mogul")])),
            Some(RunGrooming::Mogul)
        );
        assert_eq!(grooming(&tags(&[("piste:grooming", "nonsense")])), None);
    }

    #[test]
    fn the_hardest_difficulties_default_to_backcountry() {
        for difficulty in ["expert", "freeride", "extreme"] {
            assert_eq!(
                grooming(&tags(&[("piste:difficulty", difficulty)])),
                Some(RunGrooming::Backcountry),
                "difficulty {difficulty}"
            );
        }
        assert_eq!(grooming(&tags(&[("piste:difficulty", "easy")])), None);
    }

    #[test]
    fn an_explicit_grooming_beats_the_difficulty_default() {
        assert_eq!(
            grooming(&tags(&[
                ("piste:difficulty", "expert"),
                ("piste:grooming", "classic"),
            ])),
            Some(RunGrooming::Classic)
        );
    }

    #[test]
    fn grooming_no_means_backcountry() {
        assert_eq!(
            grooming(&tags(&[("piste:grooming", "no")])),
            Some(RunGrooming::Backcountry)
        );
    }

    #[test]
    fn difficulty_ignores_unknown_values() {
        assert_eq!(
            difficulty(&tags(&[("piste:difficulty", "advanced")])),
            Some(RunDifficulty::Advanced)
        );
        assert_eq!(difficulty(&tags(&[("piste:difficulty", "nonsense")])), None);
        assert_eq!(difficulty(&tags(&[])), None);
    }
}
