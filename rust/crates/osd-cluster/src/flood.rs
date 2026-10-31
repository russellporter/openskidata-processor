//! The iterative flood fill.
//!
//! See the crate docs for why this is not a connected-components problem. The short
//! version: the edge predicate narrows the activity set along each path, so reachability
//! is not an equivalence relation and no disjoint-set structure can express it.

use crate::{MAX_DISTANCE_KM, SpatialIndex, geometry::min_distance_metres};
use openskidata_format::{FeatureType, Status};
use osd_store::{ActivityMask, FeatureIdx, FeatureStore};
use std::collections::HashSet;

/// A frame of the explicit traversal stack.
///
/// The activity mask lives here rather than in a shared context. That is what preserves
/// the path dependency: two paths reaching the same object can carry different narrowed
/// sets, and each continues with its own.
#[derive(Debug, Clone, Copy)]
pub struct Frame {
    pub feature: FeatureIdx,
    pub activities: ActivityMask,
    /// Hops from the seed. Only used to stop the depth-1 passes.
    pub depth: u32,
}

/// Options for one fill, mirroring the option sets `assignObjectsToSkiAreas` is called
/// with.
#[derive(Debug, Clone, Copy, Default)]
pub struct FillOptions {
    /// Skip objects that already belong to a ski area.
    ///
    /// Upstream this is `excludeObjectsAlreadyInSkiArea`, which adds
    /// `AND (ski_areas = '[]' OR ski_areas IS NULL)`. Combined with processing seeds
    /// sequentially it makes objects *consumed*: the first ski area to reach one keeps it.
    pub only_unassigned: bool,
    /// Stop after the seed's immediate neighbours.
    ///
    /// Upstream this is `isFixedSearchArea`, which makes `processFoundObjects` return
    /// without recursing. The polygon-containment and ski-area-merge passes are depth-1
    /// searches, not fills.
    pub fixed_search_area: bool,
}

/// Whether a lift is one the search may pass through.
///
/// Upstream `isNonOperatingLift`. Such a lift joins the ski area but the search does not
/// continue from it, because a proposed interconnect lift would otherwise pull a
/// neighbouring resort's objects in — which is exactly the failure a symmetric
/// connected-components pass reintroduces.
pub fn is_non_operating_lift(store: &FeatureStore, idx: FeatureIdx) -> bool {
    let i = idx.0 as usize;
    store.feature_type[i] == FeatureType::Lift && store.status[i] != Status::Operating
}

/// Runs one fill from a set of seed candidates.
///
/// `initial_activities` is the seed ski area's activity set, or every activity when it
/// declares none — matching `activitiesForClustering` upstream.
///
/// Returns the members in the order they were visited, which is the order upstream's
/// depth-first traversal produces.
pub fn flood_fill(
    store: &FeatureStore,
    index: &SpatialIndex,
    seeds: &[FeatureIdx],
    initial_activities: ActivityMask,
    options: FillOptions,
) -> Vec<FeatureIdx> {
    let mut visited: HashSet<FeatureIdx> = HashSet::new();
    let mut members: Vec<FeatureIdx> = Vec::new();

    // Seeds are pushed in reverse so that popping yields them in the given order, making
    // the traversal pre-order over the seed list.
    let mut stack: Vec<Frame> = seeds
        .iter()
        .rev()
        .map(|&feature| Frame {
            feature,
            activities: initial_activities,
            depth: 0,
        })
        .collect();

    while let Some(frame) = stack.pop() {
        if !visited.insert(frame.feature) {
            continue;
        }
        members.push(frame.feature);

        // A non-operating lift may be the target of an edge but never a source.
        if is_non_operating_lift(store, frame.feature) {
            continue;
        }

        // Depth-1 passes take the seed's neighbours and stop there.
        if options.fixed_search_area && frame.depth >= 1 {
            continue;
        }

        // The narrowing happens on the object being visited, using that object's own
        // activities, and the result becomes the context its children are searched with.
        // Upstream keeps the incoming set when the intersection is empty.
        let narrowed = {
            let intersection = frame
                .activities
                .intersection(store.activities[frame.feature.0 as usize]);
            if intersection.is_empty() {
                frame.activities
            } else {
                intersection
            }
        };

        let mut candidates =
            index.candidates_within(store, frame.feature, MAX_DISTANCE_KM * 1000.0);
        // Sorted by id so the traversal order is a function of the data. Upstream's query
        // has no ORDER BY, so its order came from the query plan — and because that order
        // feeds this narrowing, it decided membership.
        candidates.sort_by(|&a, &b| store.id_of(a).cmp(store.id_of(b)));

        for candidate in candidates.into_iter().rev() {
            if visited.contains(&candidate) {
                continue;
            }
            // Ski areas are seeds, never nodes: upstream appends
            // `AND type != 'skiArea'` to every neighbour query.
            if store.feature_type[candidate.0 as usize] == FeatureType::SkiArea {
                continue;
            }
            if options.only_unassigned && store.is_assigned(candidate) {
                continue;
            }
            // The candidate must share at least one activity with the narrowed set,
            // mirroring the `activities @> …` disjunction upstream builds.
            if narrowed
                .intersection(store.activities[candidate.0 as usize])
                .is_empty()
            {
                continue;
            }

            stack.push(Frame {
                feature: candidate,
                activities: narrowed,
                depth: frame.depth + 1,
            });
        }
    }

    members
}

/// Confirms a candidate pair is within `metres`, using the in-process metric.
///
/// Separated so the exact-metric backend can replace just this step.
pub fn within_distance(
    store: &FeatureStore,
    left: FeatureIdx,
    right: FeatureIdx,
    metres: f64,
) -> bool {
    match min_distance_metres(store.coords_of(left), store.coords_of(right)) {
        Some(distance) => distance <= metres,
        // A placeholder geometry has no position, so nothing is near it.
        None => false,
    }
}
