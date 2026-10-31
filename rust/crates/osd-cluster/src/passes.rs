//! The clustering passes, in upstream's order.
//!
//! Replaces the pass sequence in `SkiAreaClusteringService.performClustering`. The
//! traversal itself lives in [`crate::flood`]; this is the loop around it, and it carries
//! the semantics the fill cannot express on its own — chiefly that seeds are processed
//! sequentially so an object is *consumed* by the first ski area to reach it.

use crate::{FillOptions, SpatialIndex, flood_fill};
use openskidata_format::{FeatureType, SkiAreaActivity, SourceType};
use osd_store::{ActivityMask, FeatureIdx, FeatureStore, SkiAreaIdx};

/// Which pass is running.
///
/// Upstream calls `assignObjectsToSkiAreas` three times with different option sets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pass {
    /// Objects inside OSM polygon ski areas. A depth-1 containment search, not a fill.
    InPolygon,
    /// Nearby objects for OSM ski areas; consumes unassigned objects.
    NearbyOpenStreetMap,
    /// Nearby objects for Skimap.org ski areas; consumes unassigned objects.
    NearbySkimapOrg,
}

impl Pass {
    fn source(self) -> SourceType {
        match self {
            Pass::InPolygon | Pass::NearbyOpenStreetMap => SourceType::Openstreetmap,
            Pass::NearbySkimapOrg => SourceType::SkimapOrg,
        }
    }

    fn fill_options(self) -> FillOptions {
        match self {
            // The polygon pass does not consume: upstream passes only `onlyInPolygon`,
            // leaving `onlyIfNotAlreadyAssigned` unset, so an object can be claimed by a
            // polygon ski area and still be reachable later.
            Pass::InPolygon => FillOptions {
                only_unassigned: false,
                fixed_search_area: true,
            },
            Pass::NearbyOpenStreetMap | Pass::NearbySkimapOrg => FillOptions {
                only_unassigned: true,
                fixed_search_area: false,
            },
        }
    }
}

/// What a pass did, for reporting and for the stage diff.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PassReport {
    pub seeds_processed: usize,
    pub objects_assigned: usize,
}

/// Every ski area in the store, in id order.
///
/// Order is not cosmetic: the `only_unassigned` passes consume objects, so the sequence
/// decides which ski area keeps a contested one. Upstream gets this from
/// `getSkiAreas`'s `ORDER BY key`; here it is the feature id.
pub fn ski_areas_in_id_order(store: &FeatureStore, source: SourceType) -> Vec<FeatureIdx> {
    let mut seeds: Vec<FeatureIdx> = (0..store.len())
        .map(|i| FeatureIdx(i as u32))
        .filter(|&idx| {
            store.feature_type[idx.0 as usize] == FeatureType::SkiArea
                && store.source_type[idx.0 as usize] == source
        })
        .collect();
    seeds.sort_by(|&a, &b| store.id_of(a).cmp(store.id_of(b)));
    seeds
}

/// Activities a ski area is searched with.
///
/// Upstream's `activitiesForClustering`: its own activities when it declares any,
/// otherwise every activity.
fn activities_for_clustering(store: &FeatureStore, seed: FeatureIdx) -> ActivityMask {
    let declared = store.activities[seed.0 as usize];
    if declared.is_empty() {
        ActivityMask::from_slice(SkiAreaActivity::ALL)
    } else {
        declared
    }
}

/// Derives a ski area's activities from its member **runs only**.
///
/// Replaces `getActivitiesBasedOnRuns`. Lifts and spots are deliberately ignored, and the
/// result is ordered by the canonical activity order rather than by member order — the
/// upstream comment says exactly why: "Ordered by allSkiAreaActivities so output is stable
/// regardless of row order."
pub fn activities_from_member_runs(
    store: &FeatureStore,
    members: &[FeatureIdx],
) -> Vec<SkiAreaActivity> {
    let mut found = ActivityMask::EMPTY;
    for &member in members {
        if store.feature_type[member.0 as usize] == FeatureType::Run {
            found = ActivityMask(found.0 | store.activities[member.0 as usize].0);
        }
    }
    found.to_vec()
}

/// Runs one pass over every ski area of its source.
///
/// Seeds are processed strictly sequentially, which is what makes "first in id order
/// wins" observable for the consuming passes.
pub fn run_pass(store: &mut FeatureStore, index: &SpatialIndex, pass: Pass) -> PassReport {
    let mut report = PassReport::default();
    let seeds = ski_areas_in_id_order(store, pass.source());
    let options = pass.fill_options();

    for seed in seeds {
        report.seeds_processed += 1;

        let activities = activities_for_clustering(store, seed);
        let members = flood_fill(store, index, &[seed], activities, options);

        // The seed itself is in the member list; only the objects it found are assigned.
        let found: Vec<FeatureIdx> = members
            .into_iter()
            .filter(|&idx| idx != seed)
            .filter(|&idx| store.feature_type[idx.0 as usize] != FeatureType::SkiArea)
            .collect();

        for &object in &found {
            store.assign_to_ski_area(object, SkiAreaIdx(seed.0));
        }
        report.objects_assigned += found.len();

        // A ski area that declares no activities takes them from its member runs. Done
        // after assignment so a later seed in the same pass sees the updated set.
        if store.activities[seed.0 as usize].is_empty() {
            let derived = activities_from_member_runs(store, &found);
            store.activities[seed.0 as usize] = ActivityMask::from_slice(&derived);
        }
    }

    report
}

/// Runs the three assignment passes in upstream's order.
///
/// Upstream's `performClustering` has nine steps; this covers the three that assign
/// objects to existing ski areas. The merge pass, the generation pass, geocoding, station
/// association and augmentation are separate and not yet ported.
pub fn run_assignment_passes(
    store: &mut FeatureStore,
    index: &SpatialIndex,
) -> Vec<(Pass, PassReport)> {
    [
        Pass::InPolygon,
        Pass::NearbyOpenStreetMap,
        Pass::NearbySkimapOrg,
    ]
    .into_iter()
    .map(|pass| {
        let report = run_pass(store, index, pass);
        (pass, report)
    })
    .collect()
}
