//! Elevation, reverse geocoding and snow cover enrichment.
//!
//! Replaces: `src/transforms/Elevation.ts`, `src/transforms/elevation/*`,
//! `src/transforms/Geocoder.ts`, `src/utils/snowCoverHistory.ts`,
//! `src/utils/VIIRSPixelExtractor.ts`.
//!
//! # What upstream already does well
//!
//! The elevation path is genuinely well engineered: a `DataLoader` coalesces lookups,
//! the Postgres cache is read with `getMany` and written with `setMany`, and nulls are
//! cached so known-missing data is not re-fetched. Keep that shape.
//!
//! # What to fix
//!
//! - **Throughput is capped by the wrong knob.** `mapAsync(…, 10)` in
//!   `PrepareGeoJSON.ts:143` keeps only ten features in flight, so the configured batch
//!   size of 10,000 coordinates is never reached. Decouple batch size from feature
//!   concurrency.
//! - **Decoded tiles are held for a whole batch and then thrown away.**
//!   `TerrainTileElevationSource` keeps every decoded tile of a batch live at once — a
//!   512×512 RGB tile is 786 KB — and re-decodes the same tile next batch. Add an LRU over
//!   *decoded* tiles.
//! - **Fixed-chunk concurrency stalls.** `for (i += concurrency) { await Promise.all(...) }`
//!   means one slow tile stalls its whole chunk. Use a bounded task set.
//! - **`sharp` is massively over-specified** for the single `.raw().toBuffer()` call it is
//!   used for; a plain WebP/PNG decoder suffices.
//! - **`TileDiskCache` does synchronous file I/O on the event loop** and persists its LRU
//!   index only on `close()`, so a crash orphans the files.
//! - **Geocoding writes one row per remote hit** (`Geocoder.ts:260`) while `setMany`
//!   exists, and `extractPointsAlongGeometry` dedupes with `filter` over `findIndex`,
//!   which is O(n²) (`GeoTransforms.ts:216`).
//! - **Two `Geocoder` instances are constructed per run** (clustering passes 7 and 9),
//!   each with its own loader cache and pool, so the in-process memo is discarded between
//!   passes. One shared instance here.
//! - **VIIRS pixel extraction brute-forces the bounding box.**
//!   `getGeometryPixelCoordinates` tests *every* pixel in the geometry's sinusoidal bbox
//!   with a freshly built 5-point polygon — quadratic waste for a long diagonal run, and
//!   it runs inline on the event loop during the load pass. Keep the
//!   `pixelIntersectsGeometry` predicate **exactly**, but restrict candidates to a
//!   supercover rasterization of the segments dilated by one pixel: same answers, O(n).

use anyhow::Result;
use osd_cache::CacheStore;
use osd_store::FeatureStore;

/// Elevation source, mirroring upstream's three `ELEVATION_SERVER_TYPE` variants.
#[derive(Debug, Clone)]
pub enum ElevationSource {
    Racemap {
        url: String,
    },
    TileserverGl {
        url: String,
        zoom: Vec<u8>,
    },
    TerrainTiles {
        url_template: String,
        encoding: TileEncoding,
        tile_size: u32,
        zoom: Vec<u8>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TileEncoding {
    Mapbox,
    Terrarium,
}

/// Attach elevations to every geometry vertex and to the sampled elevation profiles.
pub async fn enrich_elevations(
    _store: &mut FeatureStore,
    _source: &ElevationSource,
    _cache: &CacheStore,
) -> Result<()> {
    todo!("batch by cache key, not by feature concurrency")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GeocoderKind {
    Photon,
    GeocodeApi,
}

/// Attach `places` to every run, lift and spot.
pub async fn enrich_places(
    _store: &mut FeatureStore,
    _kind: GeocoderKind,
    _url: &str,
    _cache: &CacheStore,
) -> Result<()> {
    todo!("one shared geocoder; batched cache writes")
}

/// A VIIRS pixel: `[hTile, vTile, col, row]` upstream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ViirsPixel {
    pub h_tile: u8,
    pub v_tile: u8,
    pub col: u16,
    pub row: u16,
}

/// Pixels covered by a geometry.
///
/// Must return exactly what upstream's predicate returns; only the candidate enumeration
/// changes. See the module docs.
pub fn viirs_pixels_for(_store: &FeatureStore, _idx: osd_store::FeatureIdx) -> Vec<ViirsPixel> {
    todo!("supercover rasterization, then the upstream intersection predicate")
}

/// Attach snow cover history, reading the cache in batches.
pub async fn enrich_snow_cover(_store: &mut FeatureStore, _cache: &CacheStore) -> Result<()> {
    todo!("batch the per-pixel reads that upstream issues one at a time")
}

#[cfg(test)]
mod tests {
    /// The candidate-restriction optimization must not change the answer.
    #[test]
    #[ignore = "scaffold: implement viirs_pixels_for first"]
    fn rasterized_candidates_give_the_same_pixels_as_the_bbox_scan() {}

    #[test]
    #[ignore = "scaffold: implement enrich_elevations first"]
    fn nulls_are_cached_so_missing_data_is_not_refetched() {}

    #[test]
    #[ignore = "scaffold: implement enrich_places first"]
    fn geocoding_results_are_written_in_batches() {}
}
