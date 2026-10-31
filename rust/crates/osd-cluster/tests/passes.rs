//! The pass-level semantics: seed ordering, object consumption, and activity derivation.
//!
//! The fill itself is covered in `semantics.rs`. What is tested here is the loop around
//! it, which is where "an object is consumed by the first ski area to reach it" lives —
//! a property the fill cannot express on its own, because it depends on the order seeds
//! are processed in.

use openskidata_format::{FeatureType, SkiAreaActivity, SourceType};
use osd_cluster::{
    MAX_DISTANCE_KM, Pass, SpatialIndex, activities_from_member_runs, run_assignment_passes,
    run_pass, ski_areas_in_id_order,
};
use osd_store::{FeatureIdx, FeatureStore, GeometryKind, builder::DraftFeature};

const SEARCH_RADIUS_M: f64 = MAX_DISTANCE_KM * 1000.0;

fn run(store: &mut FeatureStore, id: &str, lng: f64, activities: &[SkiAreaActivity]) -> FeatureIdx {
    store.push(
        DraftFeature::new(FeatureType::Run, GeometryKind::LineString)
            .with_degrees(&[(lng, 47.0), (lng + 0.0001, 47.0)])
            .unwrap()
            .with_activities(activities)
            .with_id(id),
    )
}

fn ski_area(
    store: &mut FeatureStore,
    id: &str,
    lng: f64,
    activities: &[SkiAreaActivity],
    source: SourceType,
) -> FeatureIdx {
    store.push(
        DraftFeature::new(FeatureType::SkiArea, GeometryKind::Point)
            .with_degrees(&[(lng, 47.0)])
            .unwrap()
            .with_activities(activities)
            .with_source(source)
            .with_id(id),
    )
}

fn assigned_to(store: &FeatureStore, object: FeatureIdx) -> Vec<u32> {
    store.assigned_ski_areas[object.0 as usize]
        .iter()
        .map(|s| s.0)
        .collect()
}

/// **Semantic 1 at the pass level.** Two ski areas are both within range of one run. The
/// one that comes first in id order keeps it; the second finds nothing, because the
/// consuming passes exclude objects that already belong to a ski area.
#[test]
fn the_first_ski_area_in_id_order_claims_a_contested_object() {
    let mut store = FeatureStore::default();
    // The contested run sits between the two ski areas, in range of both.
    let contested = run(
        &mut store,
        "run-contested",
        11.002,
        &[SkiAreaActivity::Downhill],
    );
    // Deliberately pushed in the opposite order to their ids, so passing cannot be an
    // accident of insertion order.
    let second = ski_area(
        &mut store,
        "ski-area-b",
        11.004,
        &[SkiAreaActivity::Downhill],
        SourceType::Openstreetmap,
    );
    let first = ski_area(
        &mut store,
        "ski-area-a",
        11.0,
        &[SkiAreaActivity::Downhill],
        SourceType::Openstreetmap,
    );

    let index = SpatialIndex::build(&store, SEARCH_RADIUS_M);
    // Both must genuinely be in range, or the test proves nothing.
    assert!(
        index
            .candidates_within(&store, first, SEARCH_RADIUS_M)
            .contains(&contested)
    );
    assert!(
        index
            .candidates_within(&store, second, SEARCH_RADIUS_M)
            .contains(&contested)
    );

    let report = run_pass(&mut store, &index, Pass::NearbyOpenStreetMap);

    assert_eq!(report.seeds_processed, 2);
    assert_eq!(
        report.objects_assigned, 1,
        "the run must be claimed exactly once"
    );
    assert_eq!(
        assigned_to(&store, contested),
        vec![first.0],
        "ski-area-a sorts first, so it keeps the run"
    );
}

/// Seed order comes from the id, not from the order features were pushed.
#[test]
fn seeds_are_ordered_by_id_not_insertion() {
    let mut store = FeatureStore::default();
    ski_area(
        &mut store,
        "zebra",
        11.0,
        &[SkiAreaActivity::Downhill],
        SourceType::Openstreetmap,
    );
    ski_area(
        &mut store,
        "alpha",
        12.0,
        &[SkiAreaActivity::Downhill],
        SourceType::Openstreetmap,
    );
    ski_area(
        &mut store,
        "mike",
        13.0,
        &[SkiAreaActivity::Downhill],
        SourceType::Openstreetmap,
    );

    let seeds = ski_areas_in_id_order(&store, SourceType::Openstreetmap);
    let ids: Vec<&str> = seeds.iter().map(|&s| store.id_of(s)).collect();
    assert_eq!(ids, vec!["alpha", "mike", "zebra"]);
}

/// A pass only seeds from its own source. The Skimap.org pass must not drive OSM ski
/// areas, and vice versa.
#[test]
fn a_pass_only_seeds_from_its_own_source() {
    let mut store = FeatureStore::default();
    ski_area(
        &mut store,
        "osm",
        11.0,
        &[SkiAreaActivity::Downhill],
        SourceType::Openstreetmap,
    );
    ski_area(
        &mut store,
        "skimap",
        12.0,
        &[SkiAreaActivity::Downhill],
        SourceType::SkimapOrg,
    );

    assert_eq!(
        ski_areas_in_id_order(&store, SourceType::Openstreetmap).len(),
        1
    );
    assert_eq!(
        ski_areas_in_id_order(&store, SourceType::SkimapOrg).len(),
        1
    );
}

/// A ski area declaring no activities takes them from its member **runs**, and in the
/// canonical activity order rather than in member order.
#[test]
fn activities_are_derived_from_member_runs_in_canonical_order() {
    let mut store = FeatureStore::default();
    // Pushed nordic-first so a member-order-dependent implementation would emit
    // [nordic, downhill].
    let nordic = run(&mut store, "r-nordic", 11.0, &[SkiAreaActivity::Nordic]);
    let downhill = run(
        &mut store,
        "r-downhill",
        11.001,
        &[SkiAreaActivity::Downhill],
    );

    let derived = activities_from_member_runs(&store, &[nordic, downhill]);
    assert_eq!(
        derived,
        vec![SkiAreaActivity::Downhill, SkiAreaActivity::Nordic],
        "order must come from the canonical activity list"
    );
}

/// Lifts and spots do not contribute activities, only runs do.
#[test]
fn only_runs_contribute_derived_activities() {
    let mut store = FeatureStore::default();
    let lift = store.push(
        DraftFeature::new(FeatureType::Lift, GeometryKind::LineString)
            .with_degrees(&[(11.0, 47.0), (11.001, 47.0)])
            .unwrap()
            .with_activities(&[SkiAreaActivity::Downhill])
            .with_id("lift"),
    );
    let spot = store.push(
        DraftFeature::new(FeatureType::Spot, GeometryKind::Point)
            .with_degrees(&[(11.0, 47.0)])
            .unwrap()
            .with_activities(&[SkiAreaActivity::Nordic])
            .with_id("spot"),
    );

    assert!(
        activities_from_member_runs(&store, &[lift, spot]).is_empty(),
        "a ski area with only lifts and spots derives no activities"
    );
}

/// A ski area with no declared activities gets them filled in by the pass.
#[test]
fn a_pass_fills_in_undeclared_activities() {
    let mut store = FeatureStore::default();
    run(&mut store, "r-nordic", 11.002, &[SkiAreaActivity::Nordic]);
    let seed = ski_area(&mut store, "s", 11.0, &[], SourceType::Openstreetmap);

    assert!(store.activities[seed.0 as usize].is_empty());

    let index = SpatialIndex::build(&store, SEARCH_RADIUS_M);
    run_pass(&mut store, &index, Pass::NearbyOpenStreetMap);

    assert_eq!(
        store.activities[seed.0 as usize].to_vec(),
        vec![SkiAreaActivity::Nordic],
        "an undeclared ski area takes its activities from what it found"
    );
}

/// A ski area that declares activities keeps them, even if its members suggest others.
#[test]
fn declared_activities_are_not_overwritten() {
    let mut store = FeatureStore::default();
    run(&mut store, "r-nordic", 11.002, &[SkiAreaActivity::Nordic]);
    let seed = ski_area(
        &mut store,
        "s",
        11.0,
        &[SkiAreaActivity::Downhill],
        SourceType::Openstreetmap,
    );

    let index = SpatialIndex::build(&store, SEARCH_RADIUS_M);
    run_pass(&mut store, &index, Pass::NearbyOpenStreetMap);

    assert_eq!(
        store.activities[seed.0 as usize].to_vec(),
        vec![SkiAreaActivity::Downhill],
        "a declared activity set is authoritative"
    );
}

/// The three passes run in order, and the whole sequence is deterministic.
#[test]
fn the_pass_sequence_is_deterministic() {
    fn build() -> FeatureStore {
        let mut store = FeatureStore::default();
        for i in 0..6 {
            run(
                &mut store,
                &format!("run-{i:02}"),
                11.0 + 0.0008 * i as f64,
                &[SkiAreaActivity::Downhill],
            );
        }
        ski_area(
            &mut store,
            "osm-a",
            11.0,
            &[SkiAreaActivity::Downhill],
            SourceType::Openstreetmap,
        );
        ski_area(
            &mut store,
            "skimap-b",
            11.004,
            &[SkiAreaActivity::Downhill],
            SourceType::SkimapOrg,
        );
        store
    }

    let mut baseline = build();
    let index = SpatialIndex::build(&baseline, SEARCH_RADIUS_M);
    let baseline_reports = run_assignment_passes(&mut baseline, &index);
    let baseline_assignments: Vec<Vec<u32>> = (0..baseline.len())
        .map(|i| assigned_to(&baseline, FeatureIdx(i as u32)))
        .collect();

    for _ in 0..3 {
        let mut again = build();
        let index = SpatialIndex::build(&again, SEARCH_RADIUS_M);
        let reports = run_assignment_passes(&mut again, &index);
        assert_eq!(reports, baseline_reports);

        let assignments: Vec<Vec<u32>> = (0..again.len())
            .map(|i| assigned_to(&again, FeatureIdx(i as u32)))
            .collect();
        assert_eq!(assignments, baseline_assignments);
    }

    // Order is upstream's: polygon containment, then OSM, then Skimap.org.
    assert_eq!(
        baseline_reports.iter().map(|(p, _)| *p).collect::<Vec<_>>(),
        vec![
            Pass::InPolygon,
            Pass::NearbyOpenStreetMap,
            Pass::NearbySkimapOrg
        ]
    );
}

/// The polygon pass does not consume, so an object it claims is still reachable by the
/// later passes. Upstream leaves `onlyIfNotAlreadyAssigned` unset for that pass.
#[test]
fn the_polygon_pass_does_not_consume_objects() {
    let mut store = FeatureStore::default();
    let shared = run(&mut store, "run", 11.002, &[SkiAreaActivity::Downhill]);
    let polygon_area = store.push(
        DraftFeature::new(FeatureType::SkiArea, GeometryKind::Polygon)
            .with_degrees(&[(11.0, 47.0), (11.004, 47.0)])
            .unwrap()
            .with_activities(&[SkiAreaActivity::Downhill])
            .with_source(SourceType::Openstreetmap)
            .with_id("a-polygon-area"),
    );

    let index = SpatialIndex::build(&store, SEARCH_RADIUS_M);
    run_pass(&mut store, &index, Pass::InPolygon);
    assert_eq!(assigned_to(&store, shared), vec![polygon_area.0]);

    // The nearby pass can still reach it, because the polygon pass did not consume it...
    ski_area(
        &mut store,
        "b-nearby-area",
        11.003,
        &[SkiAreaActivity::Downhill],
        SourceType::Openstreetmap,
    );
    let index = SpatialIndex::build(&store, SEARCH_RADIUS_M);
    run_pass(&mut store, &index, Pass::NearbyOpenStreetMap);

    // ...but only_unassigned now excludes it, since the polygon pass assigned it.
    assert_eq!(
        assigned_to(&store, shared),
        vec![polygon_area.0],
        "the nearby pass excludes already-assigned objects"
    );
}
