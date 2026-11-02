//! The embedded cache store: one SQLite file in place of the Postgres cache database.
//!
//! # Layout
//!
//! - `elevation(key, value, ts)`: `key` is the 50-bit geohash cell (see [`crate::geohash`]) as
//!   the table's own integer key, `value` the elevation as `REAL` or `NULL` for "looked up,
//!   none there", `ts` the time it was stored in milliseconds. Upstream spends a 10-character
//!   text key and a second index on `timestamp` on each of these.
//! - `json_cache(kind, key, value, ts)`: the geocoding and snow cover caches, whose values are
//!   JSON text. Their keys stay the text they were upstream.
//!
//! Both are `WITHOUT ROWID`, so a row is stored once, in the primary key's b-tree.
//!
//! # Semantics kept from `PostgresCache`
//!
//! - an entry older than the time-to-live reads as absent (it is not deleted by a read of
//!   many keys; a time-to-live of 0 means entries never expire);
//! - `NULL` is a value, distinct from absent: an elevation looked up and not found is cached;
//! - writing the same key twice in one batch keeps the last, and a write replaces what was
//!   there and restamps it.
//!
//! The reads and writes here are single statements in a loop inside one transaction. SQLite
//! does that in microseconds a row, which is why the batched-`IN` lists of up to 30,000 bind
//! parameters upstream needed (and which it was close to the wire protocol's limit for)
//! have no counterpart.

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

/// Which JSON-valued cache an entry belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CacheKind {
    GeocodingPhoton = 1,
    GeocodingGeocodeApi = 2,
    SnowCover = 3,
}

/// A cached elevation: `None` is "looked up, no data"; the whole `Option` being `None` is
/// "not cached".
pub type ElevationLookup = Option<Option<f32>>;

#[derive(Debug)]
pub struct CacheStore {
    connection: Mutex<Connection>,
}

/// How many entries each cache holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Counts {
    pub elevation: u64,
    pub geocoding_photon: u64,
    pub geocoding_geocode_api: u64,
    pub snow_cover: u64,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS elevation (
  key INTEGER PRIMARY KEY,
  value REAL,
  ts INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS json_cache (
  kind INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (kind, key)
) WITHOUT ROWID;
";

impl CacheStore {
    /// Opens (creating if absent) the store at `path`.
    pub fn open(path: &Path) -> Result<CacheStore> {
        let connection = Connection::open(path)
            .with_context(|| format!("opening cache store {}", path.display()))?;
        // A cache can be rebuilt, so durability is bought down: a crash may lose the last
        // moments of writes, never corrupt the file.
        connection.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
        Self::with_connection(connection)
    }

    pub fn open_in_memory() -> Result<CacheStore> {
        Self::with_connection(Connection::open_in_memory()?)
    }

    fn with_connection(connection: Connection) -> Result<CacheStore> {
        connection.execute_batch(SCHEMA)?;
        Ok(CacheStore {
            connection: Mutex::new(connection),
        })
    }

    fn connection(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.connection.lock().expect("cache store lock")
    }

    /// Looks up elevations, in the order of `keys`. An entry stored more than `ttl_ms` before
    /// `now_ms` reads as absent; `ttl_ms == 0` disables expiry.
    pub fn get_elevation_many(
        &self,
        keys: &[u64],
        now_ms: i64,
        ttl_ms: i64,
    ) -> Result<Vec<ElevationLookup>> {
        let connection = self.connection();
        let mut statement =
            connection.prepare_cached("SELECT value, ts FROM elevation WHERE key = ?")?;
        keys.iter()
            .map(|&key| {
                let row = statement
                    .query_row([key as i64], |row| {
                        Ok((row.get::<_, Option<f64>>(0)?, row.get::<_, i64>(1)?))
                    })
                    .optional()?;
                Ok(row.and_then(|(value, ts)| {
                    (!expired(ts, now_ms, ttl_ms)).then_some(value.map(|v| v as f32))
                }))
            })
            .collect()
    }

    /// Stores elevations, stamped `now_ms`, replacing any there. The last of repeated keys wins.
    pub fn set_elevation_many(&self, entries: &[(u64, Option<f32>)], now_ms: i64) -> Result<()> {
        let unique: HashMap<u64, Option<f32>> = entries.iter().copied().collect();
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        {
            let mut statement = transaction.prepare_cached(
                "INSERT INTO elevation (key, value, ts) VALUES (?, ?, ?)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value, ts = excluded.ts",
            )?;
            for (key, value) in unique {
                statement.execute(params![key as i64, value.map(f64::from), now_ms])?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    /// Looks up JSON values, in the order of `keys`; expired or missing entries are `None`.
    pub fn get_json_many(
        &self,
        kind: CacheKind,
        keys: &[String],
        now_ms: i64,
        ttl_ms: i64,
    ) -> Result<Vec<Option<String>>> {
        let connection = self.connection();
        let mut statement = connection
            .prepare_cached("SELECT value, ts FROM json_cache WHERE kind = ? AND key = ?")?;
        keys.iter()
            .map(|key| {
                let row = statement
                    .query_row(params![kind as i64, key], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                    })
                    .optional()?;
                Ok(row.and_then(|(value, ts)| (!expired(ts, now_ms, ttl_ms)).then_some(value)))
            })
            .collect()
    }

    /// Stores JSON values, stamped `now_ms`, replacing any there. The last of repeated keys wins.
    pub fn set_json_many(
        &self,
        kind: CacheKind,
        entries: &[(String, String)],
        now_ms: i64,
    ) -> Result<()> {
        let unique: HashMap<&str, &str> = entries
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        {
            let mut statement = transaction.prepare_cached(
                "INSERT INTO json_cache (kind, key, value, ts) VALUES (?, ?, ?, ?)
                 ON CONFLICT (kind, key) DO UPDATE SET value = excluded.value, ts = excluded.ts",
            )?;
            for (key, value) in unique {
                statement.execute(params![kind as i64, key, value, now_ms])?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    /// Imports entries carrying their own timestamps, keeping whichever of a stored entry and an
    /// imported one is newer, so a migration never overwrites what a later run has written and
    /// can be repeated.
    pub(crate) fn import_elevation(&self, rows: &[(u64, Option<f32>, i64)]) -> Result<()> {
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        {
            let mut statement = transaction.prepare_cached(
                "INSERT INTO elevation (key, value, ts) VALUES (?, ?, ?)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value, ts = excluded.ts
                 WHERE excluded.ts > elevation.ts",
            )?;
            for (key, value, ts) in rows {
                statement.execute(params![*key as i64, value.map(f64::from), ts])?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    /// As [`Self::import_elevation`], for the JSON caches.
    pub(crate) fn import_json(
        &self,
        kind: CacheKind,
        rows: &[(String, String, i64)],
    ) -> Result<()> {
        let mut connection = self.connection();
        let transaction = connection.transaction()?;
        {
            let mut statement = transaction.prepare_cached(
                "INSERT INTO json_cache (kind, key, value, ts) VALUES (?, ?, ?, ?)
                 ON CONFLICT (kind, key) DO UPDATE SET value = excluded.value, ts = excluded.ts
                 WHERE excluded.ts > json_cache.ts",
            )?;
            for (key, value, ts) in rows {
                statement.execute(params![kind as i64, key, value, ts])?;
            }
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn counts(&self) -> Result<Counts> {
        let connection = self.connection();
        let json = |kind: CacheKind| -> Result<u64> {
            Ok(connection.query_row(
                "SELECT count(*) FROM json_cache WHERE kind = ?",
                [kind as i64],
                |row| row.get::<_, i64>(0),
            )? as u64)
        };
        Ok(Counts {
            elevation: connection.query_row("SELECT count(*) FROM elevation", [], |row| {
                row.get::<_, i64>(0)
            })? as u64,
            geocoding_photon: json(CacheKind::GeocodingPhoton)?,
            geocoding_geocode_api: json(CacheKind::GeocodingGeocodeApi)?,
            snow_cover: json(CacheKind::SnowCover)?,
        })
    }
}

/// `ttl_ms > 0 && now - ts > ttl_ms`.
fn expired(ts: i64, now_ms: i64, ttl_ms: i64) -> bool {
    ttl_ms > 0 && now_ms - ts > ttl_ms
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = 24 * 60 * 60 * 1000;

    #[test]
    fn null_is_a_value_and_absent_is_not() {
        let store = CacheStore::open_in_memory().unwrap();
        store
            .set_elevation_many(&[(1, Some(1234.5)), (2, None)], 1000)
            .unwrap();
        assert_eq!(
            store.get_elevation_many(&[1, 2, 3], 1000, 0).unwrap(),
            vec![Some(Some(1234.5)), Some(None), None]
        );
    }

    #[test]
    fn expiry_is_strictly_older_than_the_time_to_live() {
        let store = CacheStore::open_in_memory().unwrap();
        store.set_elevation_many(&[(7, Some(1.0))], 0).unwrap();
        let get = |now, ttl| store.get_elevation_many(&[7], now, ttl).unwrap()[0];
        assert_eq!(
            get(DAY, DAY),
            Some(Some(1.0)),
            "exactly the time to live is still fresh"
        );
        assert_eq!(get(DAY + 1, DAY), None, "older than it is gone");
        assert_eq!(
            get(1000 * DAY, 0),
            Some(Some(1.0)),
            "a time to live of 0 never expires"
        );
    }

    #[test]
    fn the_last_of_repeated_keys_wins_and_a_write_replaces() {
        let store = CacheStore::open_in_memory().unwrap();
        store
            .set_elevation_many(&[(1, Some(1.0)), (1, Some(2.0))], 10)
            .unwrap();
        assert_eq!(
            store.get_elevation_many(&[1], 10, 0).unwrap()[0],
            Some(Some(2.0))
        );
        store.set_elevation_many(&[(1, None)], 20).unwrap();
        assert_eq!(
            store.get_elevation_many(&[1], 20, 0).unwrap()[0],
            Some(None)
        );
        // Restamped: fresh at 20 even with a short time to live.
        assert_eq!(
            store.get_elevation_many(&[1], 25, 10).unwrap()[0],
            Some(None)
        );
    }

    #[test]
    fn json_caches_are_separate_by_kind() {
        let store = CacheStore::open_in_memory().unwrap();
        let key = "u0yjjd".to_owned();
        store
            .set_json_many(
                CacheKind::GeocodingPhoton,
                &[(key.clone(), "{\"a\":1}".into())],
                5,
            )
            .unwrap();
        let get = |kind| {
            store
                .get_json_many(kind, std::slice::from_ref(&key), 5, 0)
                .unwrap()[0]
                .clone()
        };
        assert_eq!(
            get(CacheKind::GeocodingPhoton).as_deref(),
            Some("{\"a\":1}")
        );
        assert_eq!(get(CacheKind::GeocodingGeocodeApi), None);
        assert_eq!(get(CacheKind::SnowCover), None);
    }

    #[test]
    fn an_import_never_replaces_something_newer() {
        let store = CacheStore::open_in_memory().unwrap();
        store.set_elevation_many(&[(1, Some(5.0))], 200).unwrap();
        store
            .import_elevation(&[(1, Some(9.0), 100), (2, Some(8.0), 100)])
            .unwrap();
        assert_eq!(
            store.get_elevation_many(&[1, 2], 200, 0).unwrap(),
            vec![Some(Some(5.0)), Some(Some(8.0))]
        );
        store.import_elevation(&[(1, Some(7.0), 300)]).unwrap();
        assert_eq!(
            store.get_elevation_many(&[1], 300, 0).unwrap()[0],
            Some(Some(7.0))
        );
    }

    #[test]
    fn a_json_import_never_replaces_something_newer_either() {
        let store = CacheStore::open_in_memory().unwrap();
        let key = "snow_cover:h12v04:1:2".to_owned();
        store
            .set_json_many(CacheKind::SnowCover, &[(key.clone(), "[1]".into())], 200)
            .unwrap();
        store
            .import_json(CacheKind::SnowCover, &[(key.clone(), "[0]".into(), 100)])
            .unwrap();
        let get = || {
            store
                .get_json_many(CacheKind::SnowCover, std::slice::from_ref(&key), 300, 0)
                .unwrap()[0]
                .clone()
        };
        assert_eq!(
            get().as_deref(),
            Some("[1]"),
            "the newer stored entry stays"
        );
        store
            .import_json(CacheKind::SnowCover, &[(key.clone(), "[2]".into(), 300)])
            .unwrap();
        assert_eq!(
            get().as_deref(),
            Some("[2]"),
            "a newer imported one replaces it"
        );
    }

    #[test]
    fn keys_above_the_signed_range_round_trip() {
        let store = CacheStore::open_in_memory().unwrap();
        let key = (1u64 << 63) + 12345;
        store.set_elevation_many(&[(key, Some(3.0))], 1).unwrap();
        assert_eq!(
            store.get_elevation_many(&[key], 1, 0).unwrap()[0],
            Some(Some(3.0))
        );
    }
}
