//! Looking up elevations: `Elevation.ts` without the terrain-tile source.
//!
//! A coordinate's elevation is the elevation of its geohash cell (ten characters, about a
//! metre), which is also the cache key, so repeated and nearby coordinates share one lookup:
//!
//! 1. the cache, with a time to live of a year (`NULL` is cached: "looked up, none there");
//! 2. else the server, asked for the cell's centre, in batches of at most `batch_size`;
//! 3. a result is cached (including "no data"); a failed lookup is not, and reads as no data.
//!
//! An elevation is rounded to a tenth of a metre. A coordinate with no data fails the whole
//! geometry ("No elevation data available"), which the caller leaves as it was.
//!
//! # What reads the cache back differently
//!
//! The cache stores a `REAL` (a 32-bit float), so an elevation read back from it is the
//! float's shortest decimal text as a double, whereas one just fetched is the server's
//! double. Rounding to a tenth hides this except within a rounding error of a tie; it is
//! reproduced because it is what upstream does.
//!
//! # Differences from upstream
//!
//! Upstream batches whatever is asked for in one tick, across every feature in flight, and
//! rejects the batch if the server fails; here a call batches its own cells. The results do
//! not depend on batching. Lookups of cells already looked up are remembered for the loader's
//! lifetime, as a `DataLoader` does; a batch that fails is not remembered, so its cells are
//! asked for again.

use osd_cache::geohash;
use osd_cache::store::CacheStore;
use osd_osm::element::{Geometry, Position};
use osd_store::feature_id::js_number_to_string;
use osd_tags::js_number;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Geohash characters of an elevation cell (about a metre).
pub const ELEVATION_CELL_CHARS: usize = 10;

/// How long a cached elevation is valid: a year.
pub const ELEVATION_CACHE_TTL_MS: i64 = 365 * 24 * 60 * 60 * 1000;

/// One elevation lookup: a height, `None` for no data, or why it failed (and is not cached).
pub type Lookup = Result<Option<f64>, String>;

/// Where heights come from.
pub trait ElevationSource: Sync {
    /// Heights for `[latitude, longitude]` pairs, one result per pair, in order. An `Err`
    /// fails the whole request.
    fn fetch(&self, coordinates: &[[f64; 2]]) -> Result<Vec<Lookup>, String>;

    /// Called once when no more heights will be asked for; a source that keeps state on disk
    /// saves it here.
    fn close(&self) {}
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// JavaScript's `JSON.stringify` of `[[lat, lng], ...]`.
fn coordinates_json(coordinates: &[[f64; 2]]) -> String {
    let mut out = String::from("[");
    for (i, c) in coordinates.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "[{},{}]",
            js_number_to_string(c[0]),
            js_number_to_string(c[1])
        ));
    }
    out.push(']');
    out
}

/// `fetchElevationsFromRacemap`: one POST of `[[lat, lng], ...]`, answered with an array of
/// heights or `null`s.
pub struct RacemapSource {
    pub url: String,
    client: reqwest::blocking::Client,
}

impl RacemapSource {
    pub fn new(url: impl Into<String>) -> Self {
        RacemapSource {
            url: url.into(),
            client: reqwest::blocking::Client::new(),
        }
    }
}

impl ElevationSource for RacemapSource {
    fn fetch(&self, coordinates: &[[f64; 2]]) -> Result<Vec<Lookup>, String> {
        let response = self
            .client
            .post(&self.url)
            .header("Content-Type", "application/json")
            .body(coordinates_json(coordinates))
            .send()
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "Failed status code: {}",
                response.status().as_u16()
            ));
        }
        let heights: Vec<Option<f64>> = response.json().map_err(|e| e.to_string())?;
        Ok(heights.into_iter().map(Ok).collect())
    }
}

/// `fetchElevationsFromTileserverGL`: a batch endpoint asked for `{points: [{lon, lat, z}]}` at
/// each zoom in turn, until every point has a height.
pub struct TileserverGlSource {
    pub url: String,
    pub zooms: Vec<u32>,
    client: reqwest::blocking::Client,
}

impl TileserverGlSource {
    pub fn new(url: impl Into<String>, zooms: Vec<u32>) -> Self {
        TileserverGlSource {
            url: url.into(),
            zooms,
            client: reqwest::blocking::Client::new(),
        }
    }

    fn at_zoom(&self, coordinates: &[[f64; 2]], zoom: u32) -> Result<Vec<Option<f64>>, String> {
        // `JSON.stringify({ points })` with each point `{ lon, lat, z }`, in that key order.
        let points: Vec<String> = coordinates
            .iter()
            .map(|c| {
                format!(
                    "{{\"lon\":{},\"lat\":{},\"z\":{zoom}}}",
                    js_number_to_string(c[1]),
                    js_number_to_string(c[0])
                )
            })
            .collect();
        let body = format!("{{\"points\":[{}]}}", points.join(","));
        (|| {
            let response = self
                .client
                .post(&self.url)
                .header("Content-Type", "application/json")
                .header(
                    "User-Agent",
                    "openskidata-processor/1.0.0 (+https://github.com/russellporter/openskidata-processor)",
                )
                .body(body.clone())
                .send()
                .map_err(|e| format!("Fetch error at zoom {zoom}: {e}"))?;
            if !response.status().is_success() {
                return Err(format!(
                    "HTTP {} at zoom {zoom}",
                    response.status().as_u16()
                ));
            }
            let elevations: Value = response
                .json()
                .map_err(|e| format!("Fetch error at zoom {zoom}: {e}"))?;
            match elevations.as_array() {
                Some(a) if a.len() == coordinates.len() => {
                    Ok(a.iter().map(Value::as_f64).collect::<Vec<_>>())
                }
                _ => Err(format!(
                    "Invalid batch response: expected array of {} elevations",
                    coordinates.len()
                )),
            }
        })()
    }
}

impl ElevationSource for TileserverGlSource {
    fn fetch(&self, coordinates: &[[f64; 2]]) -> Result<Vec<Lookup>, String> {
        let mut results: Vec<Lookup> = vec![Ok(None); coordinates.len()];
        let mut needing: Vec<usize> = (0..coordinates.len()).collect();
        for &zoom in &self.zooms {
            if needing.is_empty() {
                break;
            }
            let asked: Vec<[f64; 2]> = needing.iter().map(|&i| coordinates[i]).collect();
            match self.at_zoom(&asked, zoom) {
                Err(error) => {
                    for &i in &needing {
                        results[i] = Err(error.clone());
                    }
                    return Ok(results);
                }
                Ok(heights) => {
                    let mut still = Vec::new();
                    for (&i, height) in needing.iter().zip(heights) {
                        match height {
                            Some(h) => results[i] = Ok(Some(h)),
                            None => still.push(i),
                        }
                    }
                    needing = still;
                }
            }
        }
        Ok(results)
    }
}

/// The cache stores a 32-bit float; read back, it is that float's shortest decimal text as a
/// double.
fn as_cached(height: f32) -> f64 {
    height.to_string().parse().unwrap_or(f64::from(height))
}

/// `roundElevation`: to a tenth of a metre, `Math.round(e * 10) / 10`.
fn round_elevation(elevation: f64) -> f64 {
    js_number::round(elevation * 10.0) / 10.0
}

pub struct ElevationLoader<'a> {
    source: &'a dyn ElevationSource,
    cache: &'a CacheStore,
    batch_size: usize,
    /// Each cell's height (or none), for this loader's lifetime.
    memo: Mutex<HashMap<u64, Option<f64>>>,
}

impl<'a> ElevationLoader<'a> {
    pub fn new(source: &'a dyn ElevationSource, cache: &'a CacheStore, batch_size: usize) -> Self {
        ElevationLoader {
            source,
            cache,
            batch_size: batch_size.max(1),
            memo: Mutex::new(HashMap::new()),
        }
    }

    /// `batchLoadElevations` for cells not yet looked up.
    fn batch_load(&self, cells: &[u64]) -> Result<Vec<Option<f64>>, String> {
        let cached = self
            .cache
            .get_elevation_many(cells, now_ms(), ELEVATION_CACHE_TTL_MS)
            .map_err(|e| e.to_string())?;
        let mut results: Vec<Option<f64>> = vec![None; cells.len()];
        let mut uncached: Vec<usize> = Vec::new();
        for (i, entry) in cached.into_iter().enumerate() {
            match entry {
                Some(height) => results[i] = height.map(as_cached),
                None => uncached.push(i),
            }
        }
        if uncached.is_empty() {
            return Ok(results);
        }

        let coordinates: Vec<[f64; 2]> = uncached
            .iter()
            .map(|&i| {
                let (latitude, longitude) = geohash::decode(cells[i], ELEVATION_CELL_CHARS);
                [latitude, longitude]
            })
            .collect();
        let fetched = self.source.fetch(&coordinates)?;
        if fetched.len() != coordinates.len() {
            return Err(format!(
                "Number of uncached coordinates ({}) is different than number of fetched elevations ({})",
                coordinates.len(),
                fetched.len()
            ));
        }

        let mut entries: Vec<(u64, Option<f32>)> = Vec::new();
        for (&i, lookup) in uncached.iter().zip(fetched) {
            match lookup {
                Ok(height) => {
                    entries.push((cells[i], height.map(|h| h as f32)));
                    results[i] = height;
                }
                Err(error) => tracing::warn!("elevation fetch error: {error}"),
            }
        }
        self.cache
            .set_elevation_many(&entries, now_ms())
            .map_err(|e| e.to_string())?;
        Ok(results)
    }

    /// `loadElevations`: the rounded elevation of each `[longitude, latitude]`, or an error if
    /// the server failed or any coordinate has no data.
    pub fn load_elevations(&self, coordinates: &[Position]) -> Result<Vec<f64>, String> {
        let cells: Vec<u64> = coordinates
            .iter()
            .map(|c| geohash::encode(c[1], c[0], ELEVATION_CELL_CHARS))
            .collect();

        let missing: Vec<u64> = {
            let memo = self.memo.lock().expect("memo lock");
            let mut seen = HashSet::new();
            cells
                .iter()
                .copied()
                .filter(|c| !memo.contains_key(c) && seen.insert(*c))
                .collect()
        };
        let mut failure: Option<String> = None;
        for batch in missing.chunks(self.batch_size) {
            match self.batch_load(batch) {
                Ok(heights) => {
                    let mut memo = self.memo.lock().expect("memo lock");
                    memo.extend(batch.iter().copied().zip(heights));
                }
                Err(error) => {
                    failure.get_or_insert(error);
                }
            }
        }
        if let Some(error) = failure {
            return Err(error);
        }

        let memo = self.memo.lock().expect("memo lock");
        cells
            .iter()
            .map(|cell| {
                memo.get(cell)
                    .copied()
                    .flatten()
                    .map(round_elevation)
                    .ok_or_else(|| "No elevation data available".to_owned())
            })
            .collect()
    }
}

/// The coordinates of a geometry in the order elevations are assigned: a polygon's rings and
/// a multipolygon's polygons in turn.
pub fn flat_coordinates(geometry: &Geometry) -> Vec<Position> {
    match geometry {
        Geometry::Point(p) => vec![*p],
        Geometry::LineString(l) => l.clone(),
        Geometry::MultiLineString(lines) => lines.iter().flatten().copied().collect(),
        Geometry::Polygon(rings) => rings.iter().flatten().copied().collect(),
        Geometry::MultiPolygon(polygons) => polygons.iter().flatten().flatten().copied().collect(),
    }
}

/// `enhanceGeometry`: the elevation of every coordinate of a geometry, in
/// [`flat_coordinates`] order, or why there is none.
pub fn geometry_elevations(
    loader: &ElevationLoader<'_>,
    geometry: &Geometry,
) -> Result<Vec<f64>, String> {
    loader.load_elevations(&flat_coordinates(geometry))
}
