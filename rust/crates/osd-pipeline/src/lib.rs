//! Pipeline orchestration.
//!
//! Replaces: `src/PrepareGeoJSON.ts`, `src/scripts/download.ts`,
//! `src/scripts/prepare_geojson.ts`, `run.sh`.
//!
//! # One process, one pass
//!
//! Upstream serializes and re-parses the data about eight times:
//! `.osmjson` -> `input_*.geojson` -> `intermediate_*.geojson` -> Postgres ->
//! `*.geojson` -> (`mapboxgl_*.geojson`, `csv/*`, `.gpkg`) -> tippecanoe, every hop text
//! JSON through a pure-JS SAX parser. Here the data is read once from PBF, stays in the
//! [`osd_store::FeatureStore`], and is written once per output artifact.
//!
//! Intermediate files are therefore gone. Keep a `--checkpoint` escape hatch for
//! debugging, but write it as a binary dump, not JSON.
//!
//! # Stage order is load-bearing
//!
//! Normalization must run **before** elevation: TopoJSON's `dedup` compares only x and y,
//! so coalescing arcs after elevations are attached would silently merge arcs that differ
//! only in z. Upstream relies on this (`PrepareGeoJSON.ts:145-151`) and so must this.

use anyhow::Result;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Config {
    pub osm_pbf: PathBuf,
    pub skimap_geojson: Option<PathBuf>,
    pub output_dir: PathBuf,
    pub cache_path: PathBuf,
    pub generate_tiles: bool,
    pub bbox: Option<[f64; 4]>,
}

/// Phase timings, mirroring `PerformanceMonitor`'s timeline so the two pipelines can be
/// compared phase by phase.
#[derive(Debug, Default, Clone)]
pub struct Timeline {
    pub phases: Vec<(String, std::time::Duration)>,
    pub peak_rss_bytes: u64,
}

/// Run the whole pipeline.
pub async fn run(_config: &Config) -> Result<Timeline> {
    todo!("read -> format -> normalize -> enrich -> cluster -> write")
}

#[cfg(test)]
mod tests {
    /// Semantics depend on it; see the module docs.
    #[test]
    #[ignore = "scaffold: implement run first"]
    fn normalization_runs_before_elevation() {}

    /// The end-to-end equivalent of `PrepareGeoJSON.int.test.ts`.
    #[test]
    #[ignore = "scaffold: implement run first"]
    fn matches_prepare_geojson_integration_snapshots() {}
}
