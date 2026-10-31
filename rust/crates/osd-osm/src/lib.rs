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
//!   memory-conscious and its approach carries over directly to [`NodeTable`].

use anyhow::Result;
use osd_store::FeatureStore;
use std::path::Path;

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

/// Nodes held as parallel columns, sorted by id for binary-search lookup.
///
/// Mirrors `NodeStore` in `OSMToGeoJSONConverter.ts:259`, whose own comment notes that
/// planet-scale extracts hold millions of nodes and that parallel arrays are several
/// times more compact than a map of objects.
#[derive(Debug, Default)]
pub struct NodeTable {
    _ids: Vec<i64>,
    _lngs: Vec<i32>,
    _lats: Vec<i32>,
}

impl NodeTable {
    pub fn lookup(&self, _id: i64) -> Option<osd_store::FixedCoord> {
        todo!("binary search _ids")
    }
}

/// Read a PBF and append the matching features to the store.
pub fn read_pbf(_path: &Path, _subsets: &[OsmSubset], _store: &mut FeatureStore) -> Result<()> {
    todo!("single pass over the PBF: nodes, then ways, then relations")
}

/// Assemble a closed ring set from member ways.
///
/// Replaces `joinWays`; must keep upstream's right-hand-rule winding (RFC 7946) and its
/// compensated-summation shoelace in `rewindRing`.
pub fn join_ways(_way_node_ids: &[Vec<i64>]) -> Result<Vec<Vec<i64>>> {
    todo!("endpoint-indexed ring assembly")
}

#[cfg(test)]
mod tests {
    /// Upstream behaviour pinned by `src/io/OSMToGeoJSONConverter.unit.test.ts`.
    #[test]
    #[ignore = "scaffold: port read_pbf first"]
    fn matches_the_overpass_converter_fixtures() {}

    /// Upstream emits relations, then polygon ways, then line ways, then points in
    /// ascending node id order. Downstream normalization order depends on it.
    #[test]
    #[ignore = "scaffold: port read_pbf first"]
    fn preserves_upstream_feature_emission_order() {}
}
