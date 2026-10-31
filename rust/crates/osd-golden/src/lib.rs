//! Golden-master harness: fixture extraction, canonicalization and semantic diff.
//!
//! This crate is the safety net for the whole rewrite. The goldens are captured from the
//! **current TypeScript pipeline**, so they are implementation-independent and stay
//! authoritative as each stage is ported.
//!
//! # Why canonicalization, not byte comparison
//!
//! Several artifacts must never be byte-diffed:
//!
//! - **`.gpkg`** is SQLite: rowids, page layout and a `gpkg_contents.last_change`
//!   timestamp all vary between identical runs. Diff ordered `SELECT * ORDER BY id`
//!   dumps per layer instead.
//! - **`.mbtiles`** depends on input feature order, and `--drop-densest-as-needed` makes
//!   dropping density-dependent — so a benign reordering upstream changes which features
//!   survive at low zoom. Diff the tile set, then decode a sample.
//! - **`metadata.json`** carries `startedAt`, `openStreetMapDataTimestamp`,
//!   `skiMapOrgDownloadedAt` and file sizes.
//! - **Floats** need per-field tolerance, especially `viewportHint.bearing` and the
//!   `rotated*Meters` fields.
//!
//! # Nondeterminism in the baseline itself
//!
//! Before any golden is captured, the current pipeline must be pinned, because three of
//! its queries have no `ORDER BY` and the row order they return **changes membership**,
//! not merely ordering:
//!
//! - `findNearbyObjects` (`PostgreSQLClusteringDatabase.ts:705-800`) — drives the DFS,
//!   which drives the activity narrowing, which decides membership.
//! - `getNextUnassignedRun` (:847) — `LIMIT 1`, chooses each generated ski area's seed.
//! - `getObjectsForSkiArea` (:803) — feeds `computeViewportHint` and the statistics,
//!   which are float-sum-order sensitive.
//!
//! Plus four concurrent read-modify-write sites on `properties` where interleaving
//! decides which write wins. A `FORCE_SEQUENTIAL` switch pins those for capture.

use anyhow::Result;
use std::path::Path;

/// Which artifact a file is, since each needs its own canonicalizer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Artifact {
    GeoJson,
    MapboxGlGeoJson,
    Csv,
    GeoPackage,
    MBTiles,
    Metadata,
}

/// Per-field float tolerance.
#[derive(Debug, Clone, Copy)]
pub struct Tolerance {
    pub coordinate_decimals: u32,
    pub relative: f64,
}

impl Default for Tolerance {
    fn default() -> Self {
        // 7 decimals matches the fixed-point grid the rewrite works on.
        Tolerance {
            coordinate_decimals: 7,
            relative: 1e-9,
        }
    }
}

/// Normalize an artifact into a comparable form.
pub fn canonicalize(_path: &Path, _artifact: Artifact, _tolerance: Tolerance) -> Result<Vec<u8>> {
    todo!("per-artifact canonicalization; see the module docs")
}

/// Extract inputs and expected outputs from the TypeScript tests into language-neutral
/// fixtures.
///
/// The integration tests build both halves as **inline source literals**
/// (`TestHelpers.mockInputFiles` plus `toMatchInlineSnapshot`) rather than fixture files,
/// so there is nothing to copy — this reads them out. 117 snapshots across 15 files, the
/// bulk of them the 53 in `ClusterSkiAreas.integration.test.ts`, which is the de-facto
/// clustering specification.
pub fn extract_fixtures(_repo_root: &Path, _out_dir: &Path) -> Result<usize> {
    todo!("drive vitest with a reporter that dumps inputs and snapshots as JSON")
}

/// The report that actually gets reviewed before a stage merges.
///
/// The raw diff is for drilling in; these are the numbers that say whether the traversal
/// semantics survived.
#[derive(Debug, Default, Clone)]
pub struct SemanticReport {
    pub ski_area_count: (usize, usize),
    pub generated_ski_area_count: (usize, usize),
    /// Per-object ski-area membership Jaccard against the baseline.
    pub membership_jaccard: f64,
    pub run_length_km: (f64, f64),
    pub lift_length_km: (f64, f64),
    /// Features whose content-hash id changed. Expected to be wholesale if the hash
    /// changes, but an *unexpected* change here is a build failure, not noise.
    pub ids_changed: usize,
    pub geometry_deltas_beyond_tolerance: usize,
}

pub fn compare(_baseline_dir: &Path, _candidate_dir: &Path) -> Result<SemanticReport> {
    todo!("canonicalize both sides, then compute the semantic report")
}

/// Find the first object whose membership differs and dump, for both implementations,
/// the candidate list and activity mask at each hop.
///
/// Chasing a single membership flip through a planet-scale run without this is hopeless.
pub fn explain_divergence(_baseline_dir: &Path, _candidate_dir: &Path) -> Result<String> {
    todo!("walk both traversals in lockstep and report the first divergence")
}
