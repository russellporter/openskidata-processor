//! OSM tags to run properties.
//!
//! Replaces the tag-reading half of `src/transforms/RunFormatter.ts`, plus the shared
//! helpers in `OSMTransforms.ts` that it uses.

use crate::osm::{first_value, osm_name, osm_ref};
use crate::status::{Tags, status_and_value};
use openskidata_format::source::Source;
use openskidata_format::{
    FeatureType, RunDifficulty, RunDifficultyConvention, RunGrooming, RunUse, SourceType, Status,
};
use serde::Serialize;
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
    if let Some(difficulty) = tags.get("piste:difficulty").map(String::as_str)
        && matches!(difficulty, "expert" | "freeride" | "extreme")
    {
        return Some(RunGrooming::Backcountry);
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

/// Whether a run goes through trees.
///
/// Replaces `getGladed`. An explicit tag wins; failing that, a run mapped through woodland
/// is assumed gladed. That inference is why `natural=wood` alone yields `true` rather than
/// unknown, and why an explicit `piste:gladed=no` beats it.
pub fn gladed(tags: &Tags) -> Option<bool> {
    if let Some(value) = osm_boolean(first_present(tags, &["piste:gladed", "gladed"])) {
        return Some(value);
    }
    let is = |key: &str, value: &str| tags.get(key).map(String::as_str) == Some(value);
    if is("natural", "wood") || is("landuse", "forest") {
        return Some(true);
    }
    None
}

/// Whether a run is patrolled. The `piste:`-prefixed key wins over the plain one.
pub fn patrolled(tags: &Tags) -> Option<bool> {
    osm_boolean(first_present(tags, &["piste:patrolled", "patrolled"]))
}

/// Whether a run is lit for night skiing. The `piste:`-prefixed key wins over the plain one.
pub fn lit(tags: &Tags) -> Option<bool> {
    osm_boolean(first_present(tags, &["piste:lit", "lit"]))
}

/// Whether snow is made on the run. Only the `piste:`-prefixed key is read.
pub fn snowmaking(tags: &Tags) -> Option<bool> {
    osm_boolean(tags.get("piste:snowmaking").map(String::as_str))
}

/// Whether the run's early season is secured by stored snow. Only the `piste:` key is read.
pub fn snowfarming(tags: &Tags) -> Option<bool> {
    osm_boolean(tags.get("piste:snowfarming").map(String::as_str))
}

/// Whether the run passes through a tunnel.
///
/// Presence is what counts, not the value: `tunnel=no` is still `true`. Upstream tests
/// `tags["tunnel"] !== undefined`, and the format documentation describes it as true for
/// any tunnel value. An untagged run is unknown rather than false.
pub fn tunnel(tags: &Tags) -> Option<bool> {
    tags.contains_key("tunnel").then_some(true)
}

/// The description, preferring the `piste:`-prefixed key.
pub fn description(tags: &Tags) -> Option<String> {
    first_present(tags, &["piste:description", "description"]).map(str::to_owned)
}

/// The websites of a run.
///
/// `[tags.website].filter(notEmpty)` upstream, and `notEmpty` rejects only null and
/// undefined, so an empty-string website is kept as `[""]`.
pub fn websites(tags: &Tags) -> Vec<String> {
    tags.get("website").cloned().into_iter().collect()
}

/// The properties of a run that tags alone determine.
///
/// What `formatRun` returns minus the fields filled in later: `id` (a content hash of the
/// final geometry), `skiAreas`, `places`, `elevationProfile` and `viewportHint`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RunTagProperties {
    #[serde(rename = "type")]
    pub feature_type: FeatureType,
    pub uses: Vec<RunUse>,
    pub name: Option<String>,
    #[serde(rename = "ref")]
    pub reference: Option<String>,
    pub description: Option<String>,
    pub difficulty: Option<RunDifficulty>,
    #[serde(rename = "difficultyConvention")]
    pub difficulty_convention: RunDifficultyConvention,
    pub oneway: Option<bool>,
    pub gladed: Option<bool>,
    pub patrolled: Option<bool>,
    pub snowmaking: Option<bool>,
    pub snowfarming: Option<bool>,
    pub tunnel: Option<bool>,
    pub lit: Option<bool>,
    pub grooming: Option<RunGrooming>,
    pub status: Status,
    pub sources: Vec<Source>,
    pub websites: Vec<String>,
    #[serde(rename = "wikidataID")]
    pub wikidata_id: Option<String>,
}

/// Replaces the tag half of `formatRun`: `None` when the element is not a run for this
/// dataset -- no recognised use, or not currently operating.
///
/// The geometry checks (points and invalid geometries are rejected) belong to the caller,
/// as does the difficulty convention, which is a function of where the geometry is.
pub fn run_properties(
    tags: &Tags,
    osm_type: &str,
    osm_id: i64,
    convention: RunDifficultyConvention,
) -> Option<RunTagProperties> {
    let (status, uses) = status_and_uses(tags);
    if uses.is_empty() || status != Some(Status::Operating) {
        return None;
    }

    let reference = osm_ref(tags);
    Some(RunTagProperties {
        feature_type: FeatureType::Run,
        name: osm_name(tags, "piste:name", Some("name"), reference.as_deref()),
        reference,
        description: description(tags),
        difficulty: difficulty(tags),
        difficulty_convention: convention,
        oneway: oneway(tags, &uses),
        gladed: gladed(tags),
        patrolled: patrolled(tags),
        snowmaking: snowmaking(tags),
        snowfarming: snowfarming(tags),
        tunnel: tunnel(tags),
        lit: lit(tags),
        grooming: grooming(tags),
        status: Status::Operating,
        sources: vec![Source {
            source_type: SourceType::Openstreetmap,
            id: format!("{osm_type}/{osm_id}"),
        }],
        websites: websites(tags),
        wikidata_id: first_value(tags, "wikidata"),
        uses,
    })
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
    fn gladed_falls_back_to_woodland_but_an_explicit_tag_wins() {
        assert_eq!(gladed(&tags(&[("natural", "wood")])), Some(true));
        assert_eq!(gladed(&tags(&[("landuse", "forest")])), Some(true));
        assert_eq!(gladed(&tags(&[("natural", "scrub")])), None);
        assert_eq!(
            gladed(&tags(&[("natural", "wood"), ("piste:gladed", "no")])),
            Some(false),
            "an explicit tag beats the woodland inference"
        );
    }

    #[test]
    fn tunnel_is_presence_not_value() {
        assert_eq!(tunnel(&tags(&[("tunnel", "yes")])), Some(true));
        assert_eq!(
            tunnel(&tags(&[("tunnel", "no")])),
            Some(true),
            "even tunnel=no"
        );
        assert_eq!(
            tunnel(&tags(&[("tunnel", "avalanche_protector")])),
            Some(true)
        );
        assert_eq!(tunnel(&tags(&[])), None);
    }

    #[test]
    fn an_empty_website_is_kept() {
        assert_eq!(websites(&tags(&[("website", "")])), vec![String::new()]);
        assert_eq!(websites(&tags(&[])), Vec::<String>::new());
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
