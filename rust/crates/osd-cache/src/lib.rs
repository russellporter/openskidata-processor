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
//! # Elevation is re-keyed while migrating
//!
//! The elevation cache is on the order of 10^7 rows, and upstream stores a 4-byte value
//! behind a 10-character `TEXT` primary key *plus* a second index on `timestamp` — so it
//! costs several GB, dominated by index overhead, for what is semantically 4 bytes per
//! 1 m cell. Here the key is the geohash's own bits as an integer (a geohash is a Morton
//! code), in a table with no other index. It is the *geohash* rather than a code of the
//! fixed-point coordinate so that every cached value stays attached to the cell it was
//! fetched for.
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

pub mod geohash;
pub mod migrate;
pub mod store;

pub use migrate::{MigrationReport, migrate_from_postgres};
pub use store::{CacheKind, CacheStore, Counts, ElevationLookup};

/// The elevation cache's key for a coordinate: the 10-character geohash cell it falls in.
pub fn elevation_key(latitude: f64, longitude: f64) -> u64 {
    geohash::encode(latitude, longitude, migrate::ELEVATION_GEOHASH_CHARS)
}
