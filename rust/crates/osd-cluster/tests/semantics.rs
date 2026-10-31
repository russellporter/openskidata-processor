//! The five traversal semantics the flood fill has to preserve.
//!
//! Each of these is easy to lose by "simplifying" the traversal, and each would change
//! the published dataset if lost. The first test is the most important one in the
//! repository: it is the counterexample that rules out replacing this with union-find.

use openskidata_format::{FeatureType, LiftType, SkiAreaActivity, Status};
use osd_cluster::{FillOptions, MAX_DISTANCE_KM, SpatialIndex, flood_fill};
use osd_store::{ActivityMask, FeatureIdx, FeatureStore, GeometryKind, builder::DraftFeature};

const SEARCH_RADIUS_M: f64 = MAX_DISTANCE_KM * 1000.0;

/// Both activities, which is what a ski area declaring none is searched with.
fn all_activities() -> ActivityMask {
    ActivityMask::from_slice(&[SkiAreaActivity::Downhill, SkiAreaActivity::Nordic])
}

/// A run at a given longitude, as a short line at latitude 47.
///
/// Longitude is used as the position knob because 0.001 degrees of longitude at this
/// latitude is about 76 m, so features can be placed a known distance apart.
fn run(store: &mut FeatureStore, id: &str, lng: f64, activities: &[SkiAreaActivity]) -> FeatureIdx {
    store.push(
        DraftFeature::new(FeatureType::Run, GeometryKind::LineString)
            .with_degrees(&[(lng, 47.0), (lng + 0.0001, 47.0)])
            .unwrap()
            .with_activities(activities)
            .with_id(id),
    )
}

fn lift(
    store: &mut FeatureStore,
    id: &str,
    lng: f64,
    status: Status,
    activities: &[SkiAreaActivity],
) -> FeatureIdx {
    store.push(
        DraftFeature::new(FeatureType::Lift, GeometryKind::LineString)
            .with_degrees(&[(lng, 47.0), (lng + 0.0001, 47.0)])
            .unwrap()
            .with_activities(activities)
            .with_status(status)
            .with_lift_type(LiftType::ChairLift)
            .with_id(id),
    )
}

fn ids(store: &FeatureStore, members: &[FeatureIdx]) -> Vec<String> {
    let mut out: Vec<String> = members
        .iter()
        .map(|&idx| store.id_of(idx).to_owned())
        .collect();
    out.sort();
    out
}

/// **The counterexample that rules out union-find.**
///
/// Run A is downhill only, run B is tagged `piste:type=downhill;nordic` so it carries
/// both, and run C is nordic only. A–B and B–C are within the threshold; A–C are not.
///
/// Visiting A narrows the search to downhill, and that narrowed set is what B's
/// neighbours are searched with, so C is not reachable. Union-find over "within range and
/// shares an activity" would union A∪B and then B∪C, pulling the nordic network into the
/// downhill resort.
#[test]
fn nordic_only_run_is_excluded_behind_a_downhill_narrowing() {
    let mut store = FeatureStore::default();
    // ~76 m apart, so each neighbouring pair is in range and A–C (152 m) also would be;
    // the exclusion must come from the activity narrowing, not from distance. To make
    // that unambiguous they are spaced so A–C is beyond 500 m while A–B and B–C are not.
    let a = run(&mut store, "a-downhill", 11.0, &[SkiAreaActivity::Downhill]);
    let b = run(
        &mut store,
        "b-both",
        11.004,
        &[SkiAreaActivity::Downhill, SkiAreaActivity::Nordic],
    );
    let c = run(&mut store, "c-nordic", 11.008, &[SkiAreaActivity::Nordic]);

    let index = SpatialIndex::build(&store, SEARCH_RADIUS_M);

    // Confirm the geometry is as intended before relying on it.
    let neighbours_of_a = index.candidates_within(&store, a, SEARCH_RADIUS_M);
    assert!(neighbours_of_a.contains(&b), "A and B must be in range");
    assert!(
        !neighbours_of_a.contains(&c),
        "A and C must be out of range, or the test proves nothing about narrowing"
    );
    assert!(
        index
            .candidates_within(&store, b, SEARCH_RADIUS_M)
            .contains(&c)
    );

    let members = flood_fill(
        &store,
        &index,
        &[a],
        all_activities(),
        FillOptions::default(),
    );

    assert_eq!(
        ids(&store, &members),
        vec!["a-downhill", "b-both"],
        "the nordic-only run must not be pulled in through the dual-use run"
    );
}

/// The mirror image: seeding from the nordic end excludes the downhill-only run.
#[test]
fn the_narrowing_is_symmetric_from_the_other_end() {
    let mut store = FeatureStore::default();
    run(&mut store, "a-downhill", 11.0, &[SkiAreaActivity::Downhill]);
    run(
        &mut store,
        "b-both",
        11.004,
        &[SkiAreaActivity::Downhill, SkiAreaActivity::Nordic],
    );
    let c = run(&mut store, "c-nordic", 11.008, &[SkiAreaActivity::Nordic]);

    let index = SpatialIndex::build(&store, SEARCH_RADIUS_M);
    let members = flood_fill(
        &store,
        &index,
        &[c],
        all_activities(),
        FillOptions::default(),
    );

    assert_eq!(ids(&store, &members), vec!["b-both", "c-nordic"]);
}

/// With a single activity throughout there is nothing to narrow, so the whole chain is
/// reachable. This is the control for the two tests above: it shows the exclusion comes
/// from the narrowing and not from the traversal failing to walk a chain.
#[test]
fn a_uniform_chain_is_fully_traversed() {
    let mut store = FeatureStore::default();
    let a = run(&mut store, "a", 11.0, &[SkiAreaActivity::Downhill]);
    run(&mut store, "b", 11.004, &[SkiAreaActivity::Downhill]);
    run(&mut store, "c", 11.008, &[SkiAreaActivity::Downhill]);
    run(&mut store, "d", 11.012, &[SkiAreaActivity::Downhill]);

    let index = SpatialIndex::build(&store, SEARCH_RADIUS_M);
    let members = flood_fill(
        &store,
        &index,
        &[a],
        all_activities(),
        FillOptions::default(),
    );

    assert_eq!(ids(&store, &members), vec!["a", "b", "c", "d"]);
}

/// A non-operating lift joins the cluster but the search does not continue through it.
///
/// Without this, a proposed interconnect lift bridges two resorts into one.
#[test]
fn a_non_operating_lift_is_absorbed_but_not_traversed_through() {
    let mut store = FeatureStore::default();
    let near = run(&mut store, "a-near", 11.0, &[SkiAreaActivity::Downhill]);
    let interconnect = lift(
        &mut store,
        "b-proposed-lift",
        11.004,
        Status::Proposed,
        &[SkiAreaActivity::Downhill],
    );
    // Beyond the seed but reachable through the proposed lift.
    let far = run(&mut store, "c-far", 11.008, &[SkiAreaActivity::Downhill]);

    let index = SpatialIndex::build(&store, SEARCH_RADIUS_M);
    assert!(
        index
            .candidates_within(&store, interconnect, SEARCH_RADIUS_M)
            .contains(&far)
    );

    let members = flood_fill(
        &store,
        &index,
        &[near],
        all_activities(),
        FillOptions::default(),
    );

    assert_eq!(
        ids(&store, &members),
        vec!["a-near", "b-proposed-lift"],
        "the lift joins, but the resort on its far side must not"
    );
}

/// An operating lift in the same position does continue the search, which shows the
/// previous test is about the lift's status and not about lifts generally.
#[test]
fn an_operating_lift_does_continue_the_search() {
    let mut store = FeatureStore::default();
    let near = run(&mut store, "a-near", 11.0, &[SkiAreaActivity::Downhill]);
    lift(
        &mut store,
        "b-lift",
        11.004,
        Status::Operating,
        &[SkiAreaActivity::Downhill],
    );
    run(&mut store, "c-far", 11.008, &[SkiAreaActivity::Downhill]);

    let index = SpatialIndex::build(&store, SEARCH_RADIUS_M);
    let members = flood_fill(
        &store,
        &index,
        &[near],
        all_activities(),
        FillOptions::default(),
    );

    assert_eq!(ids(&store, &members), vec!["a-near", "b-lift", "c-far"]);
}

/// Ski areas are seeds, never nodes: the traversal must not hop from one ski area to
/// another through a shared neighbour.
#[test]
fn ski_areas_are_never_traversal_nodes() {
    let mut store = FeatureStore::default();
    let seed_run = run(&mut store, "a-run", 11.0, &[SkiAreaActivity::Downhill]);
    store.push(
        DraftFeature::new(FeatureType::SkiArea, GeometryKind::Point)
            .with_degrees(&[(11.002, 47.0)])
            .unwrap()
            .with_activities(&[SkiAreaActivity::Downhill])
            .with_id("b-other-ski-area"),
    );

    let index = SpatialIndex::build(&store, SEARCH_RADIUS_M);
    assert_eq!(
        index
            .candidates_within(&store, seed_run, SEARCH_RADIUS_M)
            .len(),
        1,
        "the ski area is within range, so the filter is what must exclude it"
    );

    let members = flood_fill(
        &store,
        &index,
        &[seed_run],
        all_activities(),
        FillOptions::default(),
    );
    assert_eq!(ids(&store, &members), vec!["a-run"]);
}

/// `only_unassigned` makes objects consumed, so a second fill cannot claim them.
#[test]
fn already_assigned_objects_are_not_claimed_again() {
    let mut store = FeatureStore::default();
    let a = run(&mut store, "a", 11.0, &[SkiAreaActivity::Downhill]);
    let b = run(&mut store, "b", 11.004, &[SkiAreaActivity::Downhill]);

    store.assign_to_ski_area(b, osd_store::SkiAreaIdx(0));

    let index = SpatialIndex::build(&store, SEARCH_RADIUS_M);
    let members = flood_fill(
        &store,
        &index,
        &[a],
        all_activities(),
        FillOptions {
            only_unassigned: true,
            ..FillOptions::default()
        },
    );
    assert_eq!(ids(&store, &members), vec!["a"]);

    // Without the option the same fill takes it.
    let members = flood_fill(
        &store,
        &index,
        &[a],
        all_activities(),
        FillOptions::default(),
    );
    assert_eq!(ids(&store, &members), vec!["a", "b"]);
}

/// The depth-1 passes take the seed's neighbours and stop.
#[test]
fn a_fixed_search_area_pass_does_not_recurse() {
    let mut store = FeatureStore::default();
    let a = run(&mut store, "a", 11.0, &[SkiAreaActivity::Downhill]);
    run(&mut store, "b", 11.004, &[SkiAreaActivity::Downhill]);
    run(&mut store, "c", 11.008, &[SkiAreaActivity::Downhill]);

    let index = SpatialIndex::build(&store, SEARCH_RADIUS_M);
    let members = flood_fill(
        &store,
        &index,
        &[a],
        all_activities(),
        FillOptions {
            fixed_search_area: true,
            ..FillOptions::default()
        },
    );

    assert_eq!(
        ids(&store, &members),
        vec!["a", "b"],
        "c is only reachable through b, so a depth-1 pass must not reach it"
    );
}

/// The same input must give the same output, which upstream's unordered neighbour query
/// did not guarantee.
#[test]
fn the_traversal_is_deterministic() {
    let mut store = FeatureStore::default();
    let seed = run(&mut store, "seed", 11.0, &[SkiAreaActivity::Downhill]);
    for i in 0..12 {
        run(
            &mut store,
            &format!("run-{i:02}"),
            11.0 + 0.0005 * (i as f64 + 1.0),
            &[SkiAreaActivity::Downhill],
        );
    }

    let index = SpatialIndex::build(&store, SEARCH_RADIUS_M);
    let first = flood_fill(
        &store,
        &index,
        &[seed],
        all_activities(),
        FillOptions::default(),
    );
    for _ in 0..5 {
        let again = flood_fill(
            &store,
            &index,
            &[seed],
            all_activities(),
            FillOptions::default(),
        );
        assert_eq!(first, again, "visit order must be a function of the data");
    }
}

/// A placeholder geometry carries no position, so it neither finds nor is found.
#[test]
fn placeholder_geometries_are_not_spatial() {
    let mut store = FeatureStore::default();
    let mut draft = DraftFeature::new(FeatureType::SkiArea, GeometryKind::Point)
        .with_activities(&[SkiAreaActivity::Downhill])
        .with_id("placeholder");
    draft.has_placeholder_geometry = true;
    let placeholder = store.push(draft);
    run(&mut store, "nearby", 11.0, &[SkiAreaActivity::Downhill]);

    let index = SpatialIndex::build(&store, SEARCH_RADIUS_M);
    assert!(
        index
            .candidates_within(&store, placeholder, SEARCH_RADIUS_M)
            .is_empty()
    );

    let members = flood_fill(
        &store,
        &index,
        &[placeholder],
        all_activities(),
        FillOptions::default(),
    );
    assert_eq!(ids(&store, &members), vec!["placeholder"]);
}
