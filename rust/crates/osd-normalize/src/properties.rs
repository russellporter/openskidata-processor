//! Merging and comparing run properties.
//!
//! Replaces `src/transforms/normalization/RunJoining.ts`.
//!
//! When pieces of a run are put back together, or two ways describing the same piste are
//! combined, their properties must be reconciled field by field. The rules are upstream's
//! and are easy to get subtly wrong -- which side wins a tie, whether `null` outranks
//! `false` -- so they are checked against recorded output of the real implementation
//! (`tests/merge_vectors.json`), not against expectations written here.

use openskidata_format::place::Place;
use openskidata_format::source::Source;
use openskidata_format::{FeatureType, RunDifficulty, RunGrooming, Status, run::RunProperties};
use osd_tags::js_number::trim;
use std::collections::HashSet;

/// Top-level keys that take no part in deciding whether two segments are the same run.
const IGNORED_FOR_COMPARISON: &[&str] = &[
    "id",
    "sources",
    "skiAreas",
    "elevationProfile",
    "places",
    "viewportHint",
];

/// A canonical string that is equal for two properties exactly when upstream's
/// `isPartOfSameRun` considers them the same run.
///
/// Upstream deep-compares the properties minus [`IGNORED_FOR_COMPARISON`]. Doing that for
/// every candidate at every endpoint was a measured cost, so each run is reduced to this
/// key once and candidates are compared as keys. The serialization is sorted by key, so
/// the result does not depend on property order -- which is not part of what "same run"
/// means.
pub fn comparison_key(properties: &RunProperties) -> String {
    let mut value = serde_json::to_value(properties).expect("run properties serialize");
    if let Some(object) = value.as_object_mut() {
        for key in IGNORED_FOR_COMPARISON {
            object.remove(*key);
        }
    }
    value.to_string()
}

/// A canonical string for deep equality of the complete properties.
///
/// The merge step compares whole property sets (including the id and viewport hint) to
/// decide whether two arcs belong to the same group of runs, so runs that came from one
/// source feature must compare equal and different ones must not.
pub fn identity_key(properties: &RunProperties) -> String {
    serde_json::to_value(properties)
        .expect("run properties serialize")
        .to_string()
}

pub fn is_part_of_same_run(left: &RunProperties, right: &RunProperties) -> bool {
    comparison_key(left) == comparison_key(right)
}

/// `reduce` with a priority table: the earlier in `order`, the higher the priority.
///
/// Upstream's tie goes to the current value. Every value has a distinct priority, so a tie
/// only ever compares a value with itself and the choice cannot be observed (mutating it
/// is an equivalent mutant).
///
/// # Panics
///
/// If a value is missing from `order`; upstream throws "Missing priority".
fn priority_reduce<T: Copy + PartialEq + std::fmt::Debug>(values: &[T], order: &[T]) -> T {
    let priority = |value: T| -> usize {
        let index = order
            .iter()
            .position(|&candidate| candidate == value)
            .unwrap_or_else(|| panic!("Missing priority for {value:?}"));
        order.len() - index
    };
    values
        .iter()
        .copied()
        .reduce(|previous, current| {
            if priority(previous) > priority(current) {
                previous
            } else {
                current
            }
        })
        .expect("at least one value")
}

fn tri_state(values: &[Option<bool>]) -> Option<bool> {
    priority_reduce(values, &[Some(true), Some(false), None])
}

/// `sanitizeUniqueAndJoin`: trimmed, non-empty, de-duplicated values joined with `", "`.
fn sanitize_unique_and_join(values: &[Option<&str>]) -> Option<String> {
    let mut unique: Vec<&str> = Vec::new();
    for value in values.iter().flatten() {
        let value = trim(value);
        if !value.is_empty() && !unique.contains(&value) {
            unique.push(value);
        }
    }
    (!unique.is_empty()).then(|| unique.join(", "))
}

fn unique_in_order<T: Clone + Eq + std::hash::Hash>(values: impl Iterator<Item = T>) -> Vec<T> {
    let mut seen = HashSet::new();
    values.filter(|value| seen.insert(value.clone())).collect()
}

fn place_key(place: &Place) -> (String, Option<String>, Option<String>) {
    (
        place.iso3166_1_alpha2.clone(),
        place.iso3166_2.clone(),
        place.localized.en.locality.clone(),
    )
}

/// `mergedProperties`.
///
/// # Panics
///
/// If `all` is empty (upstream throws "No input properties").
pub fn merged_properties(all: &[&RunProperties]) -> RunProperties {
    assert!(!all.is_empty(), "No input properties");
    let first = all[0];

    let column = |f: fn(&RunProperties) -> Option<bool>| -> Vec<Option<bool>> {
        all.iter().map(|p| f(p)).collect()
    };

    let difficulties: Vec<Option<RunDifficulty>> = all.iter().map(|p| p.difficulty).collect();
    let difficulty_order = [
        Some(RunDifficulty::Novice),
        Some(RunDifficulty::Easy),
        Some(RunDifficulty::Intermediate),
        Some(RunDifficulty::Advanced),
        Some(RunDifficulty::Expert),
        Some(RunDifficulty::Freeride),
        Some(RunDifficulty::Extreme),
        None,
    ];

    let groomings: Vec<Option<RunGrooming>> = all.iter().map(|p| p.grooming).collect();
    let grooming_order = [
        Some(RunGrooming::ClassicAndSkating),
        Some(RunGrooming::Skating),
        Some(RunGrooming::Classic),
        Some(RunGrooming::Mogul),
        Some(RunGrooming::Scooter),
        Some(RunGrooming::Backcountry),
        None,
    ];

    let statuses: Vec<Status> = all.iter().map(|p| p.status).collect();
    let status_order = [
        Status::Operating,
        Status::Construction,
        Status::Planned,
        Status::Proposed,
        Status::Disused,
        Status::Abandoned,
    ];

    // `accumulated && properties.oneway`, skipping nulls; null only if all are null.
    let oneway = all.iter().fold(None, |accumulated: Option<bool>, p| {
        match (accumulated, p.oneway) {
            (None, oneway) => oneway,
            (accumulated, None) => accumulated,
            (Some(a), Some(b)) => Some(a && b),
        }
    });

    let mut ski_area_ids = HashSet::new();
    let ski_areas = all
        .iter()
        .flat_map(|p| p.ski_areas.iter())
        .filter(|ski_area| ski_area_ids.insert(ski_area.properties.id.clone()))
        .cloned()
        .collect();

    let mut place_keys = HashSet::new();
    let places: Vec<Place> = all
        .iter()
        .flat_map(|p| p.places.iter())
        .filter(|place| place_keys.insert(place_key(place)))
        .cloned()
        .collect();

    let mut source_keys = HashSet::new();
    let sources: Vec<Source> = all
        .iter()
        .flat_map(|p| p.sources.iter())
        .filter(|source| source_keys.insert((source.source_type, source.id.clone())))
        .cloned()
        .collect();

    RunProperties {
        feature_type: FeatureType::Run,
        id: first.id.clone(),
        uses: unique_in_order(all.iter().flat_map(|p| p.uses.iter().copied())),
        name: sanitize_unique_and_join(&all.iter().map(|p| p.name.as_deref()).collect::<Vec<_>>()),
        reference: sanitize_unique_and_join(
            &all.iter()
                .map(|p| p.reference.as_deref())
                .collect::<Vec<_>>(),
        ),
        description: sanitize_unique_and_join(
            &all.iter()
                .map(|p| p.description.as_deref())
                .collect::<Vec<_>>(),
        ),
        difficulty: priority_reduce(&difficulties, &difficulty_order),
        difficulty_convention: first.difficulty_convention,
        status: priority_reduce(&statuses, &status_order),
        oneway,
        lit: tri_state(&column(|p| p.lit)),
        gladed: tri_state(&column(|p| p.gladed)),
        patrolled: tri_state(&column(|p| p.patrolled)),
        snowmaking: tri_state(&column(|p| p.snowmaking)),
        snowfarming: tri_state(&column(|p| p.snowfarming)),
        grooming: priority_reduce(&groomings, &grooming_order),
        tunnel: tri_state(&column(|p| p.tunnel)),
        ski_areas,
        elevation_profile: first.elevation_profile.clone(),
        sources,
        websites: unique_in_order(all.iter().flat_map(|p| p.websites.iter().cloned())),
        // `.find(id => id !== null) || null`: the first non-null wins even when it is the
        // empty string, which `|| null` then turns into null.
        wikidata_id: all
            .iter()
            .find_map(|p| p.wikidata_id.as_ref())
            .filter(|id| !id.is_empty())
            .cloned(),
        places,
        viewport_hint: first.viewport_hint,
        snow_cover_history: None,
    }
}
