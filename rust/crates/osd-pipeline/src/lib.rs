//! Pipeline orchestration.
//!
//! Replaces: `src/PrepareGeoJSON.ts`, `src/scripts/download.ts`,
//! `src/scripts/prepare_geojson.ts`, `run.sh`. [`download::download`] fetches the inputs and
//! [`prepare::prepare`] turns them into the outputs; `openskidata run` is the two in a row.
//!
//! # One process, one pass
//!
//! Upstream serializes and re-parses the data about eight times:
//! `.osmjson` -> `input_*.geojson` -> `intermediate_*.geojson` -> Postgres ->
//! `*.geojson` -> (`mapboxgl_*.geojson`, `csv/*`, `.gpkg`) -> tippecanoe, every hop text
//! JSON through a pure-JS SAX parser. Here the Overpass JSON is read once, streamed element by
//! element, and the data stays in memory through formatting, normalization, enrichment and
//! clustering until it is written, once per output artifact. The intermediate files are gone;
//! the independent output files are written at the same time.
//!
//! # Stage order is load-bearing
//!
//! Normalization must run **before** elevation: TopoJSON's `dedup` compares only x and y,
//! so coalescing arcs after elevations are attached would silently merge arcs that differ
//! only in z. Upstream relies on this (`PrepareGeoJSON.ts:145-151`) and so must this.

pub mod download;
pub mod elevation;
pub mod format;
pub mod memory;
pub mod prepare;
