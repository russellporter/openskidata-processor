//! Durable caches for the expensive external lookups, plus the one-off migration that
//! carries the existing Postgres contents across.
//!
//! Replaces: `src/utils/PostgresCache.ts`, `src/utils/getPostgresPoolConfig.ts`,
//! `src/transforms/elevation/TileDiskCache.ts`.
//!
//! # These contents are precious
//!
//! Three caches must survive the rewrite by **migration, not refill** — refilling means
//! re-hitting the elevation server, the geocoder and NASA NSIDC:
//!
//! | Postgres table | Key upstream | Value |
//! |---|---|---|
//! | `elevation_cache` | geohash, precision 10 (~1 m) | one elevation, `REAL` |
//! | `geocoding_photon_cache` | geohash, precision 6 (~0.6 km) | whole HTTP response, JSONB |
//! | `geocoding_geocode_api_cache` | same | same |
//! | `snow_cover_cache` | `snow_cover:{tile}:{row}:{col}` | per-year weekly arrays, JSONB |
//!
//! # Re-key elevation while migrating
//!
//! The elevation cache is on the order of 10^7 rows, and upstream stores a 4-byte value
//! behind a 10-character `TEXT` primary key *plus* a second index on `timestamp` — so it
//! costs several GB, dominated by index overhead, for what is semantically 4 bytes per
//! 1 m cell. A `u64` Morton code of the fixed-point coordinate mapping to an `f32` is
//! 12 bytes per entry. Do the re-key during migration, since every key has to be rewritten
//! anyway.
//!
//! # Batching
//!
//! `PostgresCache` already has `getMany`/`setMany`, but two call sites do not use them:
//! `snowCoverHistory.ts:298` issues one query *per VIIRS pixel*, and `Geocoder.ts:260`
//! issues one `INSERT` per remote hit. Both are batched here.
//!
//! Note also that upstream's `getMany` builds `WHERE key IN ($1..$N)` with N up to 10,000
//! and `setMany` up to 30,000 bind parameters — close to the wire protocol's 65,535 limit
//! and already pathological for planning time. Size batches to the store, not to the
//! elevation server's request size.

use anyhow::Result;
use std::path::Path;

/// Which logical cache a key belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheKind {
    Elevation,
    GeocodingPhoton,
    GeocodingGeocodeApi,
    SnowCover,
}

/// Embedded key/value store replacing the Postgres cache database.
#[derive(Debug)]
pub struct CacheStore {
    _placeholder: (),
}

impl CacheStore {
    pub fn open(_path: &Path) -> Result<CacheStore> {
        todo!("open the embedded store, creating tables if absent")
    }

    pub fn get_elevation_many(&self, _keys: &[u64]) -> Result<Vec<Option<f32>>> {
        todo!("batched lookup by Morton key")
    }

    pub fn set_elevation_many(&self, _entries: &[(u64, Option<f32>)]) -> Result<()> {
        todo!("batched upsert")
    }

    pub fn get_json_many(
        &self,
        _kind: CacheKind,
        _keys: &[String],
    ) -> Result<Vec<Option<Vec<u8>>>> {
        todo!("batched lookup for the JSON-valued caches")
    }

    pub fn set_json_many(&self, _kind: CacheKind, _entries: &[(String, Vec<u8>)]) -> Result<()> {
        todo!("batched upsert")
    }
}

/// Morton-encode a fixed-point coordinate into the elevation cache key.
///
/// Must be reversible, so a migration can be re-run and so cache contents can be
/// inspected.
pub fn morton_key(_lng_fixed: i32, _lat_fixed: i32) -> u64 {
    todo!("interleave the bits of the two i32s")
}

/// Stream every row of the three Postgres caches into the embedded store.
///
/// Idempotent and resumable: a planet-scale elevation cache is large enough that this
/// must survive being interrupted.
pub async fn migrate_from_postgres(
    _postgres_url: &str,
    _store: &CacheStore,
) -> Result<MigrationReport> {
    todo!("stream each table with a server-side cursor; re-key elevation to Morton")
}

#[derive(Debug, Default, Clone, Copy)]
pub struct MigrationReport {
    pub elevation_rows: u64,
    pub geocoding_rows: u64,
    pub snow_cover_rows: u64,
    pub skipped_rows: u64,
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "scaffold: implement morton_key first"]
    fn morton_key_is_reversible() {}

    #[test]
    #[ignore = "scaffold: implement migrate_from_postgres first"]
    fn migration_is_idempotent() {}

    /// The migration must not silently drop rows; the report has to account for every
    /// source row.
    #[test]
    #[ignore = "scaffold: implement migrate_from_postgres first"]
    fn migration_report_accounts_for_every_source_row() {}
}
