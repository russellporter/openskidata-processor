//! Ski area clustering: the whole of `SkiAreaClusteringService`, in memory.
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
//! Here it is a visited set and an R-tree query. No round trips, no SQL.
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
//! Each is easy to lose silently. All five are exercised by the recorded scenes (dense
//! resorts, chains of runs with mixed activities, competing polygons, non-operating bridging
//! lifts), and mutating any of them fails them.
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
//! # The metric
//!
//! Upstream uses `ST_DWithin(geography, geography, m)` with `use_spheroid` defaulting to
//! true: the minimum *spheroidal* distance between two arbitrary WGS84 geometries. A
//! spherical approximation is off by up to 0.4 % at mid latitudes -- 2 m at the 500 m
//! threshold -- and one flipped edge can change a ski area's membership, its statistics, its
//! viewport hint, and whether a generated ski area exists at all. So [`spatial`] measures on
//! a local tangent plane built from the ellipsoid's own radii of curvature, which at
//! sub-kilometre ranges differs from the true geodesic by far less than a millimetre. Do not
//! replace it with a haversine.
//!
//! # Verification
//!
//! `osd-pipeline/tests/cluster_scenes.rs` runs 188 recorded worlds through format, cluster
//! and export and compares the final ski areas, runs, lifts and spots -- and the mapboxgl
//! GeoJSON and CSV derived from them -- with the real pipeline's. See `rust/README.md`.
//!
//! # Not done
//!
//! Geocoding (places), snow cover, and the elevation-dependent parts of the statistics and of
//! lift-station position inference; each needs the elevation or geocoding stage first.

pub mod engine;
pub mod spatial;
pub mod stats;
pub mod turf;
