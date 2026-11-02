//! Heights read from terrain tiles (Mapbox Terrain-RGB or Terrarium), fetched over HTTP and kept
//! on disk.
//!
//! Replaces `src/transforms/elevation/{TerrainTileElevationSource,TileCoordinates,
//! ElevationDecoder,TileDiskCache}.ts`. Checked against the real TypeScript
//! (`rust/codegen/generate-tile-vectors.mjs`): the Web Mercator tile maths, the two encodings and
//! the interpolation, what sharp decodes WebP and PNG tiles to, and whole runs of the source
//! against a local tile server -- the results, the URLs requested in order, and the cache directory
//! afterwards across a close and reopen.
//!
//! # The cache directory is upstream's
//!
//! `<dir>/<z>/<x>/<y>.webp`, with `cache-index.json` (`{"keys": [...]}`, least recently used
//! first) and `missing-tiles.json` (tiles the server answered 404 for), written on
//! [`TerrainTileSource::close`]. An existing cache is read as it stands, not refilled.
//!
//! # Behaviour kept
//!
//! - Each zoom in turn for the points still without a height; a point whose four surrounding
//!   pixels need a tile the server does not have (404) tries the next zoom; one whose tile
//!   failed (HTTP error, network error, undecodable) is an error for that point and is not tried
//!   again.
//! - A point whose neighbouring pixels would lie beyond the top or bottom row of the world is
//!   skipped, and tries the next zoom.
//! - A downloaded tile is written to the cache before it is decoded, so a corrupt one stays
//!   cached (and fails again).
//!
//! # Differences
//!
//! - Tiles are fetched `tile_concurrency` at a time like upstream, but the cache is read and
//!   written in tile order around each batch, so the LRU order is deterministic at any
//!   concurrency (upstream's depends on which request finishes first).
//! - Every tile is decoded to RGB. Upstream hard-codes three channels but takes sharp's output as
//!   it comes, so a tile with an alpha channel (or greyscale) is misread there.
//! - A cache that cannot be written is logged and the run goes on; upstream would fail.

use crate::elevation::{ElevationSource, Lookup};
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const USER_AGENT: &str =
    "openskidata-processor/1.0.0 (+https://github.com/russellporter/openskidata-processor)";

// ---------------------------------------------------------------------------------------
// Tile maths
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TilePixel {
    pub tile_x: i64,
    pub tile_y: i64,
    pub pixel_x: f64,
    pub pixel_y: f64,
}

/// A pixel in a tile, as the four neighbours of a point are named.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Corner {
    pub tile_x: i64,
    pub tile_y: i64,
    pub pixel_x: i64,
    pub pixel_y: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct InterpolationSetup {
    /// Top-left, top-right, bottom-left, bottom-right.
    pub corners: [Corner; 4],
    pub fx: f64,
    pub fy: f64,
}

/// `lonLatToTilePixel`: the tile and fractional pixel a point falls in (Web Mercator).
pub fn lon_lat_to_tile_pixel(lon: f64, lat: f64, zoom: u32, tile_size: u32) -> TilePixel {
    let tile_size = f64::from(tile_size);
    let mut siny = libm::sin((lat * std::f64::consts::PI) / 180.0);
    // Truncating to 0.9999 effectively limits latitude to 89.189.
    siny = siny.clamp(-0.9999, 0.9999); // NaN stays NaN, as in `Math.min(Math.max(..))`

    let x_world = tile_size * (0.5 + lon / 360.0);
    let y_world =
        tile_size * (0.5 - libm::log((1.0 + siny) / (1.0 - siny)) / (4.0 * std::f64::consts::PI));

    let scale = f64::from(1u32 << zoom);
    let tile_x = ((x_world * scale) / tile_size).floor();
    let tile_y = ((y_world * scale) / tile_size).floor();
    TilePixel {
        tile_x: tile_x as i64,
        tile_y: tile_y as i64,
        pixel_x: x_world * scale - tile_x * tile_size,
        pixel_y: y_world * scale - tile_y * tile_size,
    }
}

/// `getInterpolationSetup`: the four pixels around a point resolved across tile borders, or
/// `None` when one lies beyond the top or bottom of the world.
pub fn interpolation_setup(
    tile_x: i64,
    tile_y: i64,
    pixel_x: f64,
    pixel_y: f64,
    zoom: u32,
    tile_size: u32,
) -> Option<InterpolationSetup> {
    let x0 = pixel_x.floor();
    let y0 = pixel_y.floor();
    let fx = pixel_x - x0;
    let fy = pixel_y - y0;
    let (x0, y0) = (x0 as i64, y0 as i64);
    let tile_size = i64::from(tile_size);
    let num_tiles = 1i64 << zoom;

    let mut corners = [Corner {
        tile_x: 0,
        tile_y: 0,
        pixel_x: 0,
        pixel_y: 0,
    }; 4];
    for (slot, (px, py)) in
        corners
            .iter_mut()
            .zip([(x0, y0), (x0 + 1, y0), (x0, y0 + 1), (x0 + 1, y0 + 1)])
    {
        let (mut cx, mut cy, mut local_x, mut local_y) = (tile_x, tile_y, px, py);
        // `%` keeps the sign of the dividend here as it does in JavaScript.
        if local_x >= tile_size {
            local_x = 0;
            cx = (cx + 1) % num_tiles;
        } else if local_x < 0 {
            local_x = tile_size - 1;
            cx = (cx - 1 + num_tiles) % num_tiles;
        }
        if local_y >= tile_size {
            local_y = 0;
            cy += 1;
        } else if local_y < 0 {
            local_y = tile_size - 1;
            cy -= 1;
        }
        if cy < 0 || cy >= num_tiles {
            return None;
        }
        *slot = Corner {
            tile_x: cx,
            tile_y: cy,
            pixel_x: local_x,
            pixel_y: local_y,
        };
    }
    Some(InterpolationSetup { corners, fx, fy })
}

// ---------------------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TileEncoding {
    Mapbox,
    Terrarium,
}

/// `decodeMapboxElevation`.
pub fn decode_mapbox(r: f64, g: f64, b: f64) -> f64 {
    -10000.0 + (r * 65536.0 + g * 256.0 + b) * 0.1
}

/// `decodeTerrariumElevation`.
pub fn decode_terrarium(r: f64, g: f64, b: f64) -> f64 {
    r * 256.0 + g + b / 256.0 - 32768.0
}

/// A decoded tile: RGB, three bytes a pixel, `width` pixels a row.
#[derive(Debug)]
pub struct DecodedTile {
    pub rgb: Vec<u8>,
    pub width: usize,
}

impl DecodedTile {
    /// `elevationAtPixel`. A pixel outside the tile reads as `NaN`, as an out-of-range read of
    /// the buffer does upstream.
    pub fn elevation_at(&self, x: i64, y: i64, encoding: TileEncoding) -> f64 {
        let offset = (y * self.width as i64 + x) * 3;
        let read = |i: i64| {
            usize::try_from(i)
                .ok()
                .and_then(|i| self.rgb.get(i))
                .map_or(f64::NAN, |v| f64::from(*v))
        };
        let (r, g, b) = (read(offset), read(offset + 1), read(offset + 2));
        match encoding {
            TileEncoding::Mapbox => decode_mapbox(r, g, b),
            TileEncoding::Terrarium => decode_terrarium(r, g, b),
        }
    }
}

/// `bilinearInterpolate`: `e00` top-left, `e10` top-right, `e01` bottom-left, `e11` bottom-right.
pub fn bilinear_interpolate(e00: f64, e10: f64, e01: f64, e11: f64, fx: f64, fy: f64) -> f64 {
    let top = e00 * (1.0 - fx) + e10 * fx;
    let bottom = e01 * (1.0 - fx) + e11 * fx;
    top * (1.0 - fy) + bottom * fy
}

/// Decodes a WebP or PNG tile to RGB.
pub fn decode_tile(data: &[u8]) -> Result<DecodedTile, String> {
    if data.len() >= 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        let image = webp::Decoder::new(data)
            .decode()
            .ok_or_else(|| "webp: unable to decode".to_owned())?;
        let channels = if image.is_alpha() { 4 } else { 3 };
        let pixels: &[u8] = &image;
        let rgb = if channels == 3 {
            pixels.to_vec()
        } else {
            pixels
                .chunks_exact(4)
                .flat_map(|p| [p[0], p[1], p[2]])
                .collect()
        };
        return Ok(DecodedTile {
            rgb,
            width: image.width() as usize,
        });
    }
    if data.starts_with(&[0x89, b'P', b'N', b'G']) {
        let mut decoder = png::Decoder::new(std::io::Cursor::new(data));
        decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
        let mut reader = decoder.read_info().map_err(|e| format!("png: {e}"))?;
        let mut buffer = vec![0; reader.output_buffer_size().ok_or("png: too large")?];
        let info = reader
            .next_frame(&mut buffer)
            .map_err(|e| format!("png: {e}"))?;
        let pixels = &buffer[..info.buffer_size()];
        let rgb: Vec<u8> = match info.color_type {
            png::ColorType::Rgb => pixels.to_vec(),
            png::ColorType::Rgba => pixels
                .chunks_exact(4)
                .flat_map(|p| [p[0], p[1], p[2]])
                .collect(),
            png::ColorType::Grayscale => pixels.iter().flat_map(|&v| [v, v, v]).collect(),
            png::ColorType::GrayscaleAlpha => pixels
                .chunks_exact(2)
                .flat_map(|p| [p[0], p[0], p[0]])
                .collect(),
            png::ColorType::Indexed => return Err("png: unexpanded palette".into()),
        };
        return Ok(DecodedTile {
            rgb,
            width: info.width as usize,
        });
    }
    Err("Input buffer contains unsupported image format".into())
}

// ---------------------------------------------------------------------------------------
// The disk cache
// ---------------------------------------------------------------------------------------

fn tile_key(z: u32, x: i64, y: i64) -> String {
    format!("{z}/{x}/{y}")
}

#[derive(Deserialize)]
struct CacheIndex {
    keys: Vec<String>,
}

/// `TileDiskCache`: tile files with a least-recently-used bound, and the tiles known not to exist.
pub struct TileDiskCache {
    dir: PathBuf,
    max_tiles: usize,
    /// Key to the tick of its last use; `order` is the same, the other way round.
    last_use: HashMap<String, u64>,
    order: BTreeMap<u64, String>,
    tick: u64,
    missing: Vec<String>,
    missing_set: HashSet<String>,
}

impl TileDiskCache {
    /// Creates the directory and reads the index and missing-tile list that are there. A corrupt
    /// one is ignored (and replaced when the cache is closed).
    pub fn open(dir: &Path, max_tiles: usize) -> std::io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        let mut cache = TileDiskCache {
            dir: dir.to_owned(),
            max_tiles,
            last_use: HashMap::new(),
            order: BTreeMap::new(),
            tick: 0,
            missing: Vec::new(),
            missing_set: HashSet::new(),
        };
        let index = dir.join("cache-index.json");
        if index.exists() {
            match std::fs::read_to_string(&index)
                .map_err(|e| e.to_string())
                .and_then(|t| serde_json::from_str::<CacheIndex>(&t).map_err(|e| e.to_string()))
            {
                Ok(parsed) => {
                    for key in parsed.keys {
                        cache.touch(key);
                    }
                }
                Err(error) => {
                    tracing::warn!(
                        "Corrupted cache index at {}, clearing: {error}",
                        index.display()
                    );
                    cache.last_use.clear();
                    cache.order.clear();
                }
            }
        }
        let missing = dir.join("missing-tiles.json");
        if missing.exists() {
            match std::fs::read_to_string(&missing)
                .map_err(|e| e.to_string())
                .and_then(|t| serde_json::from_str::<Vec<String>>(&t).map_err(|e| e.to_string()))
            {
                Ok(parsed) => {
                    for key in parsed {
                        cache.insert_missing(key);
                    }
                }
                Err(error) => {
                    tracing::warn!(
                        "Corrupted missing-tiles index at {}, clearing: {error}",
                        missing.display()
                    );
                    cache.missing.clear();
                    cache.missing_set.clear();
                }
            }
        }
        Ok(cache)
    }

    fn touch(&mut self, key: String) {
        if let Some(old) = self.last_use.remove(&key) {
            self.order.remove(&old);
        }
        self.tick += 1;
        self.order.insert(self.tick, key.clone());
        self.last_use.insert(key, self.tick);
    }

    fn insert_missing(&mut self, key: String) {
        if self.missing_set.insert(key.clone()) {
            self.missing.push(key);
        }
    }

    fn tile_path(&self, z: u32, x: i64, y: i64) -> PathBuf {
        self.dir
            .join(z.to_string())
            .join(x.to_string())
            .join(format!("{y}.webp"))
    }

    pub fn is_missing(&self, z: u32, x: i64, y: i64) -> bool {
        self.missing_set.contains(&tile_key(z, x, y))
    }

    pub fn mark_missing(&mut self, z: u32, x: i64, y: i64) {
        self.insert_missing(tile_key(z, x, y));
    }

    /// The cached tile, which becomes the most recently used; `None` if it is not cached or its
    /// file has gone.
    pub fn get(&mut self, z: u32, x: i64, y: i64) -> Option<Vec<u8>> {
        let key = tile_key(z, x, y);
        if !self.last_use.contains_key(&key) {
            return None;
        }
        match std::fs::read(self.tile_path(z, x, y)) {
            Ok(data) => {
                self.touch(key);
                Some(data)
            }
            Err(_) => {
                // Removed externally.
                if let Some(old) = self.last_use.remove(&key) {
                    self.order.remove(&old);
                }
                None
            }
        }
    }

    /// Stores a tile, evicting the least recently used ones to stay within the bound.
    pub fn set(&mut self, z: u32, x: i64, y: i64, data: &[u8]) -> std::io::Result<()> {
        let key = tile_key(z, x, y);
        if !self.last_use.contains_key(&key) {
            while self.last_use.len() >= self.max_tiles {
                let Some((_, oldest)) = self.order.pop_first() else {
                    break;
                };
                self.last_use.remove(&oldest);
                let mut parts = oldest.split('/').map(|p| p.parse::<i64>().unwrap_or(0));
                let (ez, ex, ey) = (parts.next(), parts.next(), parts.next());
                if let (Some(ez), Some(ex), Some(ey)) = (ez, ex, ey) {
                    let _ = std::fs::remove_file(self.tile_path(ez as u32, ex, ey));
                }
            }
        }
        let path = self.tile_path(z, x, y);
        atomic_write(&path, data)?;
        self.touch(key);
        Ok(())
    }

    /// Writes the index and the missing-tile list.
    pub fn close(&self) -> std::io::Result<()> {
        let keys: Vec<&String> = self.order.values().collect();
        atomic_write(
            &self.dir.join("cache-index.json"),
            serde_json::to_string(&serde_json::json!({ "keys": keys }))?.as_bytes(),
        )?;
        atomic_write(
            &self.dir.join("missing-tiles.json"),
            serde_json::to_string(&self.missing)?.as_bytes(),
        )
    }
}

fn atomic_write(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(format!(".tmp.{}", std::process::id()));
    let temporary = PathBuf::from(temporary);
    std::fs::write(&temporary, data)?;
    std::fs::rename(&temporary, path)
}

// ---------------------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct TerrainTileConfig {
    /// With `{z}`, `{x}` and `{y}` in it.
    pub url_template: String,
    pub encoding: TileEncoding,
    pub tile_size: u32,
    pub cache_dir: PathBuf,
    pub cache_max_tiles: usize,
    /// Tiles fetched at once.
    pub tile_concurrency: usize,
    /// The zooms to try in turn.
    pub zooms: Vec<u32>,
}

pub struct TerrainTileSource {
    config: TerrainTileConfig,
    cache: Mutex<TileDiskCache>,
    client: reqwest::blocking::Client,
}

/// What became of one tile of a batch.
enum Fetched {
    Missing,
    Failed(String),
    Tile(Arc<DecodedTile>),
}

/// Phase one of a batch: what the cache knew.
enum Plan {
    Missing,
    Cached(Vec<u8>),
    Network,
}

impl TerrainTileSource {
    pub fn new(config: TerrainTileConfig) -> std::io::Result<Self> {
        let cache = TileDiskCache::open(&config.cache_dir, config.cache_max_tiles)?;
        Ok(TerrainTileSource {
            config,
            cache: Mutex::new(cache),
            client: reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(120))
                .user_agent(USER_AGENT)
                .build()
                .expect("a plain HTTP client"),
        })
    }

    /// Persists the cache index. Call when done.
    pub fn close(&self) -> std::io::Result<()> {
        self.cache.lock().unwrap().close()
    }

    fn fetch_from_network(&self, z: u32, x: i64, y: i64) -> Result<Option<Vec<u8>>, String> {
        let url = self
            .config
            .url_template
            .replacen("{z}", &z.to_string(), 1)
            .replacen("{x}", &x.to_string(), 1)
            .replacen("{y}", &y.to_string(), 1);
        let network = |e: reqwest::Error| format!("Network error fetching tile {z}/{x}/{y}: {e}");
        let response = self.client.get(&url).send().map_err(network)?;
        let status = response.status();
        if status.as_u16() == 404 {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(format!(
                "HTTP {} fetching tile {z}/{x}/{y}",
                status.as_u16()
            ));
        }
        Ok(Some(response.bytes().map_err(network)?.to_vec()))
    }

    /// One batch of tiles: the cache is consulted before and updated after, in order; the
    /// network and the decoding happen at once.
    fn load_batch(&self, zoom: u32, batch: &[(i64, i64)]) -> Vec<Fetched> {
        let plans: Vec<Plan> = {
            let mut cache = self.cache.lock().unwrap();
            batch
                .iter()
                .map(|&(x, y)| {
                    if cache.is_missing(zoom, x, y) {
                        Plan::Missing
                    } else if let Some(data) = cache.get(zoom, x, y) {
                        Plan::Cached(data)
                    } else {
                        Plan::Network
                    }
                })
                .collect()
        };

        type Loaded = (
            Option<Result<Option<Vec<u8>>, String>>,
            Option<Result<DecodedTile, String>>,
        );
        let loaded: Vec<Loaded> = std::thread::scope(|scope| {
            let handles: Vec<_> = batch
                .iter()
                .zip(&plans)
                .map(|(&(x, y), plan)| {
                    scope.spawn(move || match plan {
                        Plan::Missing => (None, None),
                        Plan::Cached(data) => (None, Some(decode_tile(data))),
                        Plan::Network => {
                            let fetched = self.fetch_from_network(zoom, x, y);
                            let decoded = match &fetched {
                                Ok(Some(data)) => Some(decode_tile(data)),
                                _ => None,
                            };
                            (Some(fetched), decoded)
                        }
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().expect("tile thread"))
                .collect()
        });

        let mut cache = self.cache.lock().unwrap();
        let mut out = Vec::with_capacity(batch.len());
        for ((&(x, y), plan), (fetched, decoded)) in batch.iter().zip(&plans).zip(loaded) {
            let decode_error = |e: String| format!("Failed to decode tile {zoom}/{x}/{y}: {e}");
            let finish = |decoded: Option<Result<DecodedTile, String>>| match decoded {
                Some(Ok(tile)) => Fetched::Tile(Arc::new(tile)),
                Some(Err(error)) => Fetched::Failed(decode_error(error)),
                None => Fetched::Missing,
            };
            out.push(match plan {
                Plan::Missing => Fetched::Missing,
                Plan::Cached(_) => finish(decoded),
                Plan::Network => match fetched.expect("a network result") {
                    Err(error) => Fetched::Failed(error),
                    Ok(None) => {
                        cache.mark_missing(zoom, x, y);
                        Fetched::Missing
                    }
                    Ok(Some(data)) => {
                        if let Err(error) = cache.set(zoom, x, y, &data) {
                            tracing::warn!("Could not cache tile {zoom}/{x}/{y}: {error}");
                        }
                        finish(decoded)
                    }
                },
            });
        }
        out
    }

    /// `fetchElevations`: heights for `[latitude, longitude]` pairs, trying each zoom in turn
    /// for the points that still have none.
    pub fn fetch_elevations(&self, coordinates: &[[f64; 2]], zooms: &[u32]) -> Vec<Lookup> {
        let mut results: Vec<Lookup> = vec![Ok(None); coordinates.len()];
        let mut remaining: Vec<usize> = (0..coordinates.len()).collect();

        for &zoom in zooms {
            if remaining.is_empty() {
                break;
            }
            // The interpolation setup of each remaining point, and the tiles all of them need,
            // in the order first seen.
            let mut setups: Vec<(usize, InterpolationSetup)> = Vec::new();
            let mut tile_order: Vec<(i64, i64)> = Vec::new();
            let mut seen: HashSet<(i64, i64)> = HashSet::new();
            for &index in &remaining {
                let [lat, lon] = coordinates[index];
                let p = lon_lat_to_tile_pixel(lon, lat, zoom, self.config.tile_size);
                let Some(setup) = interpolation_setup(
                    p.tile_x,
                    p.tile_y,
                    p.pixel_x,
                    p.pixel_y,
                    zoom,
                    self.config.tile_size,
                ) else {
                    continue; // at the world boundary: stays without a height, next zoom
                };
                for corner in &setup.corners {
                    if seen.insert((corner.tile_x, corner.tile_y)) {
                        tile_order.push((corner.tile_x, corner.tile_y));
                    }
                }
                setups.push((index, setup));
            }

            let mut tiles: HashMap<(i64, i64), Fetched> = HashMap::new();
            for batch in tile_order.chunks(self.config.tile_concurrency.max(1)) {
                for (key, fetched) in batch.iter().zip(self.load_batch(zoom, batch)) {
                    tiles.insert(*key, fetched);
                }
            }

            for (index, setup) in &setups {
                let corner_tiles: Vec<&Fetched> = setup
                    .corners
                    .iter()
                    .map(|c| &tiles[&(c.tile_x, c.tile_y)])
                    .collect();
                if let Some(error) = corner_tiles.iter().find_map(|t| match t {
                    Fetched::Failed(error) => Some(error),
                    _ => None,
                }) {
                    results[*index] = Err(error.clone());
                    continue;
                }
                if corner_tiles.iter().any(|t| matches!(t, Fetched::Missing)) {
                    continue; // stays without a height, tries the next zoom
                }
                let heights: Vec<f64> = setup
                    .corners
                    .iter()
                    .zip(&corner_tiles)
                    .map(|(corner, tile)| match tile {
                        Fetched::Tile(tile) => {
                            tile.elevation_at(corner.pixel_x, corner.pixel_y, self.config.encoding)
                        }
                        _ => unreachable!("failed and missing tiles were handled"),
                    })
                    .collect();
                results[*index] = Ok(Some(if setup.fx == 0.0 && setup.fy == 0.0 {
                    heights[0]
                } else {
                    bilinear_interpolate(
                        heights[0], heights[1], heights[2], heights[3], setup.fx, setup.fy,
                    )
                }));
            }

            remaining.retain(|&i| matches!(results[i], Ok(None)));
        }
        results
    }
}

impl ElevationSource for TerrainTileSource {
    fn fetch(&self, coordinates: &[[f64; 2]]) -> Result<Vec<Lookup>, String> {
        Ok(self.fetch_elevations(coordinates, &self.config.zooms))
    }

    fn close(&self) {
        if let Err(error) = TerrainTileSource::close(self) {
            tracing::warn!("Could not save the tile cache index: {error}");
        }
    }
}
