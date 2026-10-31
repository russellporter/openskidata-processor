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

pub mod flood;
pub mod geometry;
pub mod index;
pub mod passes;

pub use flood::{FillOptions, Frame, flood_fill, is_non_operating_lift};
pub use index::SpatialIndex;
pub use passes::{
    Pass, PassReport, activities_from_member_runs, run_assignment_passes, run_pass,
    ski_areas_in_id_order,
};

use anyhow::Result;
use osd_store::{FeatureIdx, FeatureStore, SkiAreaIdx};

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
    /// The 53 inline snapshots in `ClusterSkiAreas.integration.test.ts` are the de-facto
    /// specification for this crate.
    #[test]
    #[ignore = "scaffold: implement cluster first"]
    fn matches_cluster_ski_areas_integration_snapshots() {}
}
