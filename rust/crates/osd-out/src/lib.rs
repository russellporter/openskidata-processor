//! Output writers.
//!
//! Replaces: `src/clustering/FeatureExporter.ts`, `src/transforms/MapboxGLFormatter.ts`,
//! `src/transforms/CSVFormatter.ts`, `src/io/GeoPackageWriter.ts`,
//! `src/transforms/TilesGenerator.ts`, `src/statistics/DatasetMetadata.ts`.
//!
//! # Artifacts (names are a public contract — `openskidata.org` links to them)
//!
//! - `ski_areas.geojson`, `runs.geojson`, `lifts.geojson`, `spots.geojson`
//! - `mapboxgl_*.geojson` — the slimmed inputs that feed tippecanoe
//! - `csv/{ski_areas,runs,lifts,spots}.csv`
//! - `openskidata.gpkg` — one GeoPackage, four logical layers
//! - `openskimap.mbtiles` — only when tiles are enabled
//! - `metadata.json` — written last, once every file it describes exists
//!
//! # Keep tippecanoe
//!
//! It is already C++ and internally multithreaded, and it is well tuned. The only change
//! is to stop running the four layer builds **serially**
//! (`TilesGenerator.ts:16,32,50,68` each `await`ed in turn) — run them in parallel, or
//! fold them into one invocation with four `--named-layer`s. Bound the parallelism;
//! four concurrent planet-scale tile builds can exhaust memory.
//!
//! Upstream flags, which must be preserved exactly because they determine which features
//! survive at low zoom:
//!
//! | layer | `-Z` | `-z` | extra |
//! |---|---|---|---|
//! | lifts | 5 | 15 | `--simplify-only-low-zooms --drop-densest-as-needed` |
//! | runs | 9 | 15 | same |
//! | skiareas | 0 | 15 | `-B 0 --drop-densest-as-needed` |
//! | spots | 9 | 15 | `-B 10 --simplify-only-low-zooms --drop-densest-as-needed` |
//!
//! # GeoPackage should get smaller, not larger
//!
//! `GeoPackageWriter.ts` is 831 LOC of hand-written column schemas (~60 column
//! definitions across four types) driving `@ngageoint/geopackage`, which in turn needs
//! `better-sqlite3` and a cast through its private connection handle. A GeoPackage is
//! just SQLite plus WKB plus a few metadata tables, so writing it directly should
//! *shrink* this code. Keep the upstream table naming (`{layer}_{geomtype}`, plus the
//! ski-area centroid `{layer}_point` table) and the deferred spatial index.
//!
//! # Metadata counting is already free — keep it that way
//!
//! Upstream tallies `metadata.json` during the CSV pass rather than in a pass of its own
//! (`PrepareGeoJSON.ts:224`). Preserve that: counting is a fold over a stream that is
//! already flowing.

pub mod csv;
pub mod geojson;
pub mod mapboxgl;
pub mod tiles;

use anyhow::Result;
use osd_store::FeatureStore;
use std::path::Path;

/// Replaces `GeoPackageWriter`.
pub fn write_geopackage(_store: &FeatureStore, _path: &Path) -> Result<()> {
    todo!("write SQLite + WKB + gpkg metadata tables directly")
}

/// Replaces `DatasetMetadata`. Counts are folded in during the CSV pass.
pub fn write_metadata(_path: &Path) -> Result<()> {
    todo!("port DatasetMetadata, schema v1")
}

#[cfg(test)]
mod tests {}
