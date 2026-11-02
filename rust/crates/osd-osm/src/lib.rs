//! OpenStreetMap input: read `.osm.pbf` directly and assemble way/relation geometry.
//!
//! Replaces: `src/io/OSMToGeoJSONConverter.ts` (713 LOC) **and** the Overpass download
//! path in `src/io/GeoJSONDownloader.ts`.
//!
//! # What this removes
//!
//! Upstream reads Overpass JSON (`input_*.osmjson`) and converts it to
//! `input_*.geojson` — two full text-JSON round trips through a pure-JS SAX parser
//! before any real work starts. Reading PBF directly deletes both intermediates.
//!
//! `OSM_INPUT_DIR` is already the production path (files produced nightly from a planet
//! file by `osm-preprocess`), so upstream only has to emit PBF instead of Overpass JSON.
//!
//! # Algorithmic fixes to carry over
//!
//! - `joinWays` upstream is an O(ways²) scan-and-splice ring assembly
//!   (`OSMToGeoJSONConverter.ts:615`). Index ways by their endpoint node ids instead.
//! - `multipolygonGeometry` assigns inner rings with `findIndex` plus per-point ray
//!   casting, O(inners × outers × points). Use a prepared point-in-polygon test and an
//!   R-tree over outer-ring bounding boxes.
//! - The existing `NodeStore` (three parallel `number[]` with binary search) is already
//!   memory-conscious and its approach carries over directly to [`NodeStore`].

pub mod converter;
pub mod element;
pub mod geometry;
pub mod node_store;
pub mod overpass;
pub mod polygon_features;
pub mod validity;

pub use converter::Converter;
pub use element::{Element, Feature, Geometry};
pub use node_store::NodeStore;

/// Which OSM elements to keep. Upstream issues five separate Overpass queries; a single
/// PBF pass can satisfy all of them with one filter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OsmSubset {
    Runs,
    Lifts,
    SkiAreas,
    SkiAreaSites,
    Spots,
}
