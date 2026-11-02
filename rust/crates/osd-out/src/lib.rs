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
//! # The GeoPackage
//!
//! Written directly with `rusqlite` (see [`gpkg`]): a GeoPackage is SQLite plus WKB plus a few
//! metadata tables, so this replaces 831 lines of column schemas driving
//! `@ngageoint/geopackage`. The upstream table naming (`{layer}_{geomtype}`, plus the ski-area
//! centroid `{layer}_point` table) and the deferred spatial index are kept.
//!
//! # Metadata counting is already free — keep it that way
//!
//! Upstream tallies `metadata.json` during the CSV pass rather than in a pass of its own
//! (`PrepareGeoJSON.ts:224`). Preserve that: counting is a fold over a stream that is
//! already flowing.

pub mod csv;
pub mod geojson;
pub mod gpkg;
pub mod mapboxgl;
pub mod metadata;
pub mod tiles;
