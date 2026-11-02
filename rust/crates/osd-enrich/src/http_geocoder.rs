//! The reverse-geocoding client: `Geocoder.ts` without its response handling (which is in
//! [`crate::geocode`]).
//!
//! A position is looked up by its geohash cell, six characters (about 1.2 km by 0.6 km):
//!
//! 1. the cache, with the configured time to live;
//! 2. else the server, one request for the cell's centre, with one retry after two seconds,
//!    at most four requests in flight, and no more attempts at all after 100 failures in a
//!    row ("Too many errors");
//! 3. a response is cached and read back through [`crate::geocode`].
//!
//! Like the `DataLoader` it replaces, it shares one request between cells asked for at the same
//! moment and remembers each cell's response for its own lifetime. It differs in failures: a
//! `DataLoader` clears the keys of a failed batch, and since upstream batches every cell of
//! every object geocoded in the same tick, one failing cell fails all of them and each is
//! asked again by the next object to want it. Here a failure fails only the cell, and is
//! remembered, so a cell that failed is not asked again by another object.
//!
//! Where upstream issues one `INSERT` per response, the store here takes one write per
//! response too; with SQLite a write costs microseconds, so batching them would buy nothing.

use crate::geocode::{Geocoder, enhance_photon, enhance_whos_on_first};
use openskidata_format::place::Place;
use osd_cache::geohash;
use osd_cache::store::{CacheKind, CacheStore};
use osd_osm::element::Position;
use osd_store::feature_id::js_number_to_string;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The precision of the cells that are looked up (+-0.61 km).
pub const GEOCODE_PRECISION: usize = 6;
const MAX_CONCURRENT_REMOTE_REQUESTS: usize = 4;
const MAX_REMOTE_ERRORS: usize = 100;
const RETRY_DELAY: Duration = Duration::from_millis(2000);

/// The kind of server: the response format and the table the responses are cached in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerType {
    /// <https://github.com/komoot/photon>
    Photon,
    /// A Who's On First based `geocode-api`.
    GeocodeApi,
}

impl ServerType {
    fn cache_kind(self) -> CacheKind {
        match self {
            ServerType::Photon => CacheKind::GeocodingPhoton,
            ServerType::GeocodeApi => CacheKind::GeocodingGeocodeApi,
        }
    }
}

#[derive(Debug, Clone)]
pub struct HttpGeocoderConfig {
    pub url: String,
    pub server_type: ServerType,
    /// How long a cached response stays valid, in milliseconds (0: for ever).
    pub cache_ttl_ms: i64,
}

/// The request for the centre of a cell, as `Geocoder.rawGeocodeRemote` builds it.
pub fn request_url(base: &str, server_type: ServerType, cell: u64) -> String {
    let (latitude, longitude) = geohash::decode(cell, GEOCODE_PRECISION);
    let (lon, lat) = (
        js_number_to_string(longitude),
        js_number_to_string(latitude),
    );
    match server_type {
        ServerType::GeocodeApi => format!(
            "{base}?lon={lon}&lat={lat}&fields=id,name,placetype,iso_code,name_eng&placetype=country,region,locality"
        ),
        ServerType::Photon => format!("{base}?lon={lon}&lat={lat}&lang=en&limit=1&radius=5"),
    }
}

/// A counting semaphore: `std` has none.
struct Slots {
    free: Mutex<usize>,
    available: Condvar,
}

struct Permit<'a>(&'a Slots);

impl Slots {
    fn acquire(&self) -> Permit<'_> {
        let mut free = self.free.lock().expect("slot lock");
        while *free == 0 {
            free = self.available.wait(free).expect("slot lock");
        }
        *free -= 1;
        Permit(self)
    }
}

impl Drop for Permit<'_> {
    fn drop(&mut self) {
        *self.0.free.lock().expect("slot lock") += 1;
        self.0.available.notify_one();
    }
}

type Outcome = Result<Arc<Value>, String>;

pub struct HttpGeocoder<'a> {
    config: HttpGeocoderConfig,
    cache: &'a CacheStore,
    client: reqwest::blocking::Client,
    retry_delay: Duration,
    remote_errors: AtomicUsize,
    slots: Slots,
    /// Each cell's raw response (or failure), for this instance's lifetime.
    memo: Mutex<HashMap<String, Arc<OnceLock<Outcome>>>>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

impl<'a> HttpGeocoder<'a> {
    pub fn new(config: HttpGeocoderConfig, cache: &'a CacheStore) -> Self {
        HttpGeocoder {
            config,
            cache,
            client: reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(300))
                .build()
                .expect("an HTTP client"),
            retry_delay: RETRY_DELAY,
            remote_errors: AtomicUsize::new(0),
            slots: Slots {
                free: Mutex::new(MAX_CONCURRENT_REMOTE_REQUESTS),
                available: Condvar::new(),
            },
            memo: Mutex::new(HashMap::new()),
        }
    }

    /// Waits this long before retrying a failed request (two seconds unless changed).
    pub fn with_retry_delay(mut self, delay: Duration) -> Self {
        self.retry_delay = delay;
        self
    }

    /// `rawGeocode`: the cell's cached or freshly fetched response.
    pub fn raw_geocode(&self, position: Position) -> Outcome {
        let cell = geohash::encode(position[1], position[0], GEOCODE_PRECISION);
        let key = geohash::to_string(cell, GEOCODE_PRECISION);
        let entry = {
            let mut memo = self.memo.lock().expect("memo lock");
            Arc::clone(memo.entry(key.clone()).or_default())
        };
        entry
            .get_or_init(|| self.local_or_remote(cell, &key))
            .clone()
    }

    fn local_or_remote(&self, cell: u64, key: &str) -> Outcome {
        let kind = self.config.server_type.cache_kind();
        match self
            .cache
            .get_json_many(kind, &[key.to_owned()], now_ms(), self.config.cache_ttl_ms)
        {
            Ok(mut found) => {
                if let Some(Ok(raw)) = found.pop().flatten().map(|t| serde_json::from_str(&t)) {
                    return Ok(Arc::new(raw));
                }
            }
            Err(error) => tracing::warn!("local cache lookup failed: {error}"),
        }

        if self.remote_errors.load(Ordering::SeqCst) >= MAX_REMOTE_ERRORS {
            return Err("Too many errors, not trying remote".into());
        }
        match self.remote_with_retry(cell, key) {
            Ok(raw) => {
                self.remote_errors.store(0, Ordering::SeqCst);
                Ok(Arc::new(raw))
            }
            Err(error) => {
                self.remote_errors.fetch_add(1, Ordering::SeqCst);
                Err(error)
            }
        }
    }

    fn remote_with_retry(&self, cell: u64, key: &str) -> Result<Value, String> {
        self.remote(cell, key).or_else(|_| {
            tracing::info!("geocoding failed, retrying in {:?}", self.retry_delay);
            std::thread::sleep(self.retry_delay);
            self.remote(cell, key)
        })
    }

    fn remote(&self, cell: u64, key: &str) -> Result<Value, String> {
        let _permit = self.slots.acquire();
        let url = request_url(&self.config.url, self.config.server_type, cell);
        let response = self
            .client
            .get(&url)
            .header("Content-Type", "application/json")
            .send()
            .map_err(|e| format!("Geocoding fetch failed for {url}: {e}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Geocoding request failed with status {} for {url}",
                response.status().as_u16()
            ));
        }
        let body: Value = response
            .json()
            .map_err(|e| format!("Failed to parse JSON response from {url}: {e}"))?;
        let now = now_ms();
        let data = json!({ "url": url, "response": body, "timestamp": now });
        self.cache
            .set_json_many(
                self.config.server_type.cache_kind(),
                &[(key.to_owned(), data.to_string())],
                now,
            )
            .map_err(|e| format!("could not cache the response: {e}"))?;
        Ok(data)
    }
}

impl Geocoder for HttpGeocoder<'_> {
    fn geocode(&self, position: Position) -> Result<Option<Place>, String> {
        let raw = self.raw_geocode(position)?;
        Ok(match self.config.server_type {
            ServerType::Photon => enhance_photon(&raw),
            ServerType::GeocodeApi => enhance_whos_on_first(&raw),
        })
    }
}
