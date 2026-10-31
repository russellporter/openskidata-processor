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

use anyhow::Result;
use openskidata_format::FeatureType;
use osd_store::FeatureStore;
use std::path::Path;

/// Stream features to a GeoJSON `FeatureCollection`.
///
/// Upstream writes one `JSON.stringify(feature)` per line between a fixed prelude and
/// epilogue (`src/transforms/FeatureCollection.ts`), making the files effectively
/// newline-delimited. `src/scripts/merge_outputs.ts` depends on exactly that shape, so
/// keep it.
pub fn write_geojson(
    _store: &FeatureStore,
    _feature_type: FeatureType,
    _path: &Path,
) -> Result<()> {
    todo!("streaming FeatureCollection writer, one feature per line")
}

/// Replaces `MapboxGLFormatter`: drops heavy properties, replaces ski-area polygons with
/// central points, drops connection-only runs, shortens long names, precomputes colors.
pub fn write_mapboxgl_geojson(
    _store: &FeatureStore,
    _feature_type: FeatureType,
    _path: &Path,
) -> Result<()> {
    todo!("port MapboxGLFormatter")
}

/// Replaces `CSVFormatter`. Headers are literal and fixed (33 columns for runs, 34 for
/// lifts, 23 for ski areas, 14 for spots) and the escaping is hand-rolled upstream:
/// quote on `,`, `"`, `\n`, `\r` and `;`.
pub fn write_csv(_store: &FeatureStore, _feature_type: FeatureType, _path: &Path) -> Result<()> {
    todo!("port CSVFormatter, preserving the exact header lists and escaping")
}

/// Replaces `GeoPackageWriter`.
pub fn write_geopackage(_store: &FeatureStore, _path: &Path) -> Result<()> {
    todo!("write SQLite + WKB + gpkg metadata tables directly")
}

/// Tile build configuration for one layer.
#[derive(Debug, Clone)]
pub struct TileLayer {
    pub name: &'static str,
    pub min_zoom: u8,
    pub max_zoom: u8,
    pub extra_args: &'static [&'static str],
}

/// Upstream's four layers, with flags preserved verbatim.
pub const TILE_LAYERS: &[TileLayer] = &[
    TileLayer {
        name: "lifts",
        min_zoom: 5,
        max_zoom: 15,
        extra_args: &["--simplify-only-low-zooms", "--drop-densest-as-needed"],
    },
    TileLayer {
        name: "runs",
        min_zoom: 9,
        max_zoom: 15,
        extra_args: &["--simplify-only-low-zooms", "--drop-densest-as-needed"],
    },
    TileLayer {
        name: "skiareas",
        min_zoom: 0,
        max_zoom: 15,
        extra_args: &["-B", "0", "--drop-densest-as-needed"],
    },
    TileLayer {
        name: "spots",
        min_zoom: 9,
        max_zoom: 15,
        extra_args: &[
            "-B",
            "10",
            "--simplify-only-low-zooms",
            "--drop-densest-as-needed",
        ],
    },
];

/// Drive tippecanoe for every layer, then `tile-join`.
pub fn generate_tiles(_mapboxgl_dir: &Path, _working_dir: &Path, _output: &Path) -> Result<()> {
    todo!("run the four layers in parallel, then tile-join")
}

/// Replaces `DatasetMetadata`. Counts are folded in during the CSV pass.
pub fn write_metadata(_path: &Path) -> Result<()> {
    todo!("port DatasetMetadata, schema v1")
}

#[cfg(test)]
mod tests {
    /// `merge_outputs.ts` parses these files line by line, so the layout matters beyond
    /// being valid JSON.
    #[test]
    #[ignore = "scaffold: implement write_geojson first"]
    fn geojson_output_stays_newline_delimited() {}

    #[test]
    #[ignore = "scaffold: implement write_csv first"]
    fn csv_headers_match_upstream_exactly() {}

    /// Not covered by any upstream test: tippecanoe runs in no test today.
    #[test]
    #[ignore = "scaffold: implement generate_tiles first"]
    fn tile_build_produces_the_expected_layer_set() {}
}
