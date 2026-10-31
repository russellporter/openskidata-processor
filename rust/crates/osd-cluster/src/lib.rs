//! Ski area clustering: an R-tree plus an **iterative flood fill**.
//!
//! Replaces: `src/clustering/SkiAreaClusteringService.ts` (1,416 LOC),
//! `src/clustering/database/PostgreSQLClusteringDatabase.ts` (1,095 LOC),
//! `LiftStationAssociator.ts`, `MergeSkiAreaObjects.ts`.
//!
//! # Why this is the largest performance win
//!
//! Upstream `visitObject` (`SkiAreaClusteringService.ts:753`) recurses through
//! `processFoundObjects` (:811) into `findNearbyObjects`
//! (`PostgreSQLClusteringDatabase.ts:705`), **one `await` per hop**. Each hop runs
//! `ST_DWithin(geography(geom), geography(ST_GeomFromGeoJSON($1)), $2)` — re-parsing a
//! GeoJSON string server-side and re-casting to geography — and `SELECT *` ships back
//! full geometry plus JSONB properties for every neighbour, to be re-parsed in JS. On top
//! of that, `SearchContext.alreadyVisited` is spliced into the same query as
//! `AND key NOT IN ($6,$7,…)`, one bind parameter per object already seen, so **the SQL
//! text grows quadratically with the size of the ski area being built**.
//!
//! Here it is a `visited` bitset and an R-tree query. No round trips, no SQL.
//!
//! # Union-find is rejected — do not "simplify" this into connected components
//!
//! It looks like a connected-components problem. It is not, because the edge predicate is
//! **path-dependent**, and the counterexample is ordinary OSM data:
//!
//! - Run `A` has activities `[downhill]`; run `B` is a way tagged
//!   `piste:type=downhill;nordic` so it has `[downhill, nordic]`; run `C` has `[nordic]`.
//! - `A`–`B` are within 500 m and `B`–`C` are within 500 m, but `A`–`C` are not.
//! - The seed is an OSM ski area whose only in-range object is `A`.
//!
//! Upstream narrows the search context's activity set at every hop
//! (`SkiAreaClusteringService.ts:759`) and that narrowed set becomes the
//! `activities @> …` clause of the child query (`PostgreSQLClusteringDatabase.ts:757`).
//! So the context becomes `{downhill}` at `A`, and `C` is **excluded**. Union-find over
//! "within 500 m and shares at least one activity" unions `A∪B` then `B∪C` and
//! **includes** `C` — silently merging a nordic network into a downhill resort.
//!
//! Reachability here is not an equivalence relation, so no disjoint-set structure can
//! express it. The same argument applies to non-operating lifts, which upstream absorbs
//! *without* traversing through them (:820-832) — and whose comment describes exactly the
//! bug union-find would reintroduce: "otherwise e.g. a proposed interconnect lift would
//! pull a neighbouring ski area's objects into this one".
//!
//! # Five semantics to preserve
//!
//! Each is easy to lose silently, so each has a test below.
//!
//! 1. **First-come-wins claiming.** `assignObjectsToSkiAreas` (:556) iterates ski areas
//!    strictly sequentially when `onlyIfNotAlreadyAssigned` is set, and the query adds
//!    `AND (ski_areas = '[]' OR ski_areas IS NULL)` (:772). Objects are *consumed*; seed
//!    order is a priority, not a partition.
//! 2. **Path-dependent activity narrowing** (:759) — the narrowed mask must live on the
//!    stack frame, never in a global edge predicate.
//! 3. **Absorb-but-don't-traverse lifts** (:820) — such a node may be the *target* of an
//!    edge but never a *source*, and one reachable from two clusters goes to whichever
//!    traversal arrives first.
//! 4. **Ski areas are seeds, never nodes.** All four `findNearbyObjects` variants append
//!    `AND type != 'skiArea'` (:725, :733, :744, :750).
//! 5. **`isFixedSearchArea` passes are depth-1**, not fills (:815).
//!
//! A cost note: `getObjectDerivedSkiAreaGeometry`'s `ST_Union` is **not** a per-hop cost,
//! contrary to first appearances. Because `findNearbyObjects` excludes ski areas, the
//! `object.type === FeatureType.SkiArea` branch (:787) can only fire for the *root*; and
//! `markObjectsAsPartOfSkiArea` runs only after the traversal returns (:567, :602), so the
//! member set is frozen for a traversal's duration. It is one union per ski area per pass.
//!
//! # The metric, and why it is split into two steps
//!
//! Upstream uses `ST_DWithin(geography, geography, m)` with `use_spheroid` defaulting to
//! true: minimum *spheroidal* distance between two arbitrary WGS84 geometries. `geo` has
//! geodesic point-to-point but not linestring-to-linestring minimum distance, so a
//! local-projection substitute carries roughly 0.1–0.3 % error — ±0.5 to 1.5 m at 500 m.
//! Any pair whose true separation lands in about `[498.5, 501.5]` m can flip an edge, and
//! one flipped edge can change a ski area's membership, its statistics, its viewport hint,
//! and even whether a generated ski area exists at all.
//!
//! So: [`DistanceBackend::Postgis`] first (R-tree prefilter, one *batched* `ST_DWithin`
//! per hop over the tiny candidate set) captures essentially the whole round-trip and
//! quadratic-SQL win with **zero** metric change. Only once that diff is clean does
//! [`DistanceBackend::LocalProjection`] land, as a separately measured commit, with the
//! `[490, 510]` m blast radius already instrumented.

use anyhow::Result;
use osd_store::{ActivityMask, FeatureIdx, FeatureStore, SkiAreaIdx};

/// Upstream `maxDistanceInKilometers` (`SkiAreaClusteringService.ts:68`).
pub const MAX_DISTANCE_KM: f64 = 0.5;

/// Upstream `maxSkiAreaMergeDistanceInKilometers` (:69).
pub const MAX_SKI_AREA_MERGE_DISTANCE_KM: f64 = 0.25;

/// How pairwise distance is evaluated. See the module docs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DistanceBackend {
    /// Stage 4a: exact spheroidal distance, confirmed by one batched query per hop.
    Postgis,
    /// Stage 4b: in-process local projection. Carries ±0.5–1.5 m error at 500 m.
    LocalProjection,
}

/// A frame of the explicit traversal stack.
///
/// The activity mask lives **here**, not in a shared context, which is what preserves
/// semantic 2.
#[derive(Debug, Clone, Copy)]
pub struct Frame {
    pub feature: FeatureIdx,
    /// Activities narrowed along the path taken to reach this feature.
    pub activities: ActivityMask,
}

/// Which pass is running. Upstream calls `assignObjectsToSkiAreas` three times with
/// different options, plus a merge pass and a generation pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pass {
    /// Objects inside OSM polygon ski areas. Depth-1 containment, not a fill
    /// (semantic 5).
    InPolygon,
    /// Nearby objects for OSM ski areas; consumes unassigned objects (semantic 1).
    NearbyOpenStreetMap,
    /// Nearby objects for Skimap.org ski areas; consumes unassigned objects.
    NearbySkimapOrg,
}

/// Spatial index over feature bounding boxes.
///
/// Built once with `rstar`'s bulk (STR) load, which is both faster to construct and
/// better quality than repeated insertion.
#[derive(Debug, Default)]
pub struct SpatialIndex {
    _placeholder: (),
}

impl SpatialIndex {
    pub fn build(_store: &FeatureStore) -> SpatialIndex {
        todo!("rstar bulk_load over bounding boxes expanded by MAX_DISTANCE_KM")
    }

    /// Candidates whose expanded bbox may be within `MAX_DISTANCE_KM`.
    ///
    /// Returned **sorted by feature id**, because candidate order drives the traversal,
    /// which drives the activity narrowing, which decides membership. Upstream's
    /// `findNearbyObjects` has no `ORDER BY` at all, so its membership is not reproducible
    /// run to run; sorting here is a deliberate improvement.
    pub fn candidates(&self, _store: &FeatureStore, _of: FeatureIdx) -> Vec<FeatureIdx> {
        todo!("query the R-tree, then sort by id")
    }
}

/// Run every clustering pass, in upstream's order.
pub fn cluster(
    _store: &mut FeatureStore,
    _index: &SpatialIndex,
    _backend: DistanceBackend,
) -> Result<()> {
    todo!("the nine passes of performClustering, in order")
}

/// One flood fill from a seed ski area.
///
/// Explicit stack, DFS pre-order, children in sorted candidate order, shared `visited`
/// set. Preserves semantics 1–5.
pub fn flood_fill(
    _store: &FeatureStore,
    _index: &SpatialIndex,
    _seed: SkiAreaIdx,
    _pass: Pass,
    _backend: DistanceBackend,
) -> Result<Vec<FeatureIdx>> {
    todo!("iterative DFS with the activity mask carried on the frame")
}

/// Replaces `generateSkiAreasForUnassignedObjects`.
///
/// Upstream seeds this from `getNextUnassignedRun`, which is `LIMIT 1` with **no
/// `ORDER BY`** (`PostgreSQLClusteringDatabase.ts:847`) — so upstream's generated ski
/// areas are not reproducible between runs. Seed in id order here, and derive the
/// generated id from the sorted member set rather than `randomUUID()`
/// (`SkiAreaClusteringService.ts:1016`) so it is stable across runs *and* across
/// implementations.
pub fn generate_ski_areas_for_unassigned(
    _store: &mut FeatureStore,
    _index: &SpatialIndex,
    _backend: DistanceBackend,
) -> Result<Vec<SkiAreaIdx>> {
    todo!("seed in id order; content-derived ids")
}

/// Replaces `LiftStationAssociator`.
pub fn associate_lift_stations(_store: &mut FeatureStore, _index: &SpatialIndex) -> Result<()> {
    todo!("port LiftStationAssociator: 30 m search, nearest point on line, snap")
}

/// Replaces `mergeSkimapOrgWithOpenStreetMapSkiAreas` and `MergeSkiAreaObjects.ts`.
pub fn merge_skimap_org_into_openstreetmap(
    _store: &mut FeatureStore,
    _index: &SpatialIndex,
) -> Result<()> {
    todo!("port the depth-1 merge pass")
}

/// Instrumentation for the metric blast radius.
///
/// Logs every candidate pair whose exact spheroidal separation lands in
/// `[490, 510]` m. Run this under [`DistanceBackend::Postgis`] *before* switching to
/// local projection, so the number of edges that could flip is known in advance rather
/// than discovered from a diff.
pub fn report_metric_blast_radius(
    _store: &FeatureStore,
    _index: &SpatialIndex,
) -> Result<Vec<(FeatureIdx, FeatureIdx, f64)>> {
    todo!("collect pairs with distance in [490, 510] m")
}

#[cfg(test)]
mod tests {
    /// Semantic 2, and the reason union-find is rejected. This is the module-doc
    /// counterexample, and it is the single most important test in this crate.
    #[test]
    #[ignore = "scaffold: implement flood_fill first"]
    fn nordic_only_neighbour_is_excluded_behind_a_downhill_narrowing() {}

    /// Semantic 3.
    #[test]
    #[ignore = "scaffold: implement flood_fill first"]
    fn non_operating_lift_is_absorbed_but_not_traversed_through() {}

    /// Semantic 1.
    #[test]
    #[ignore = "scaffold: implement cluster first"]
    fn first_ski_area_in_id_order_claims_a_contested_object() {}

    /// Semantic 4.
    #[test]
    #[ignore = "scaffold: implement flood_fill first"]
    fn ski_areas_are_never_traversal_nodes() {}

    /// Semantic 5.
    #[test]
    #[ignore = "scaffold: implement cluster first"]
    fn in_polygon_pass_does_not_recurse() {}

    /// Unlike upstream, the same input must give the same output every time.
    #[test]
    #[ignore = "scaffold: implement cluster first"]
    fn clustering_is_deterministic_across_runs() {}

    /// The 53 inline snapshots in `ClusterSkiAreas.integration.test.ts` are the de-facto
    /// specification for this crate.
    #[test]
    #[ignore = "scaffold: implement cluster first"]
    fn matches_cluster_ski_areas_integration_snapshots() {}
}
