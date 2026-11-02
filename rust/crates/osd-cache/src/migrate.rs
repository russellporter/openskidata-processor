//! The one-off migration from the Postgres cache database.
//!
//! Streams each table through a portal, so a cache of tens of millions of rows never has to
//! fit in memory, and writes it in batches of [`BATCH`] rows, each in a transaction.
//!
//! It is **idempotent and resumable**: there is nothing to checkpoint because repeating it is
//! cheap and safe -- every row is imported with its original timestamp and only replaces a
//! stored row that is older, so running it again, running it after a run has written newer
//! entries, or running it after being interrupted, all converge on the same store.
//!
//! The report accounts for every source row: written, or skipped with the reason counted.
//!
//! The tables are those `PostgresCache` creates, `{prefix}{name}_cache`, with columns
//! `key TEXT`, `value` (`REAL` for elevation, `JSONB` for the rest) and `timestamp BIGINT`.
//! A table that does not exist is not an error -- a deployment that never geocoded has no
//! geocoding cache -- and is listed in the report.

use crate::geohash;
use crate::store::{CacheKind, CacheStore};
use anyhow::{Context, Result, bail};
use futures_util::TryStreamExt;
use tokio_postgres::{Client, NoTls};

/// Rows per transaction in the store.
pub const BATCH: usize = 20_000;

/// Characters of the geohash an elevation cache key is.
pub const ELEVATION_GEOHASH_CHARS: usize = 10;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct MigrationReport {
    /// Rows read from each source table.
    pub elevation_rows: u64,
    pub geocoding_rows: u64,
    pub snow_cover_rows: u64,
    /// Rows not carried across because their key is not a 10-character geohash.
    pub skipped_rows: u64,
    /// Tables that do not exist in the source.
    pub missing_tables: Vec<String>,
}

impl MigrationReport {
    pub fn total_rows(&self) -> u64 {
        self.elevation_rows + self.geocoding_rows + self.snow_cover_rows
    }
}

/// A table prefix is spliced into SQL as an identifier, so it is restricted to what an
/// unquoted identifier is made of.
fn check_prefix(prefix: &str) -> Result<()> {
    if prefix
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        Ok(())
    } else {
        bail!("table prefix {prefix:?} may only contain letters, digits and underscores")
    }
}

async fn table_exists(client: &Client, table: &str) -> Result<bool> {
    let row = client
        .query_one("SELECT to_regclass($1)::text", &[&table])
        .await?;
    Ok(row.get::<_, Option<String>>(0).is_some())
}

/// Copies the elevation, geocoding and snow cover caches from the Postgres database at
/// `postgres_url` (e.g. `host=localhost user=postgres dbname=openskidata_cache`) into `store`.
/// `table_prefix` is upstream's `tablePrefix` (empty outside tests).
pub async fn migrate_from_postgres(
    postgres_url: &str,
    table_prefix: &str,
    store: &CacheStore,
) -> Result<MigrationReport> {
    check_prefix(table_prefix)?;
    let (client, connection) = tokio_postgres::connect(postgres_url, NoTls)
        .await
        .with_context(|| "connecting to the Postgres cache database")?;
    tokio::spawn(async move {
        if let Err(error) = connection.await {
            tracing_error(&error);
        }
    });

    let mut report = MigrationReport::default();

    // Elevation: geohash text -> the cell's bits.
    let table = format!("{table_prefix}elevation_cache");
    if table_exists(&client, &table).await? {
        let mut rows = std::pin::pin!(
            client
                .query_raw(
                    &format!("SELECT key, value, timestamp FROM {table}"),
                    std::iter::empty::<&str>(),
                )
                .await?
        );
        let mut batch: Vec<(u64, Option<f32>, i64)> = Vec::with_capacity(BATCH);
        while let Some(row) = rows.try_next().await? {
            report.elevation_rows += 1;
            let key: String = row.get(0);
            let Some(cell) = geohash::from_str(&key, ELEVATION_GEOHASH_CHARS) else {
                report.skipped_rows += 1;
                continue;
            };
            batch.push((cell, row.get::<_, Option<f32>>(1), row.get::<_, i64>(2)));
            if batch.len() >= BATCH {
                store.import_elevation(&batch)?;
                batch.clear();
            }
        }
        store.import_elevation(&batch)?;
    } else {
        report.missing_tables.push(table);
    }

    // The JSON caches keep their text keys; `jsonb` is read as its canonical text.
    for (name, kind) in [
        ("geocoding_photon_cache", CacheKind::GeocodingPhoton),
        (
            "geocoding_geocode_api_cache",
            CacheKind::GeocodingGeocodeApi,
        ),
        ("snow_cover_cache", CacheKind::SnowCover),
    ] {
        let table = format!("{table_prefix}{name}");
        if !table_exists(&client, &table).await? {
            report.missing_tables.push(table);
            continue;
        }
        let mut rows = std::pin::pin!(
            client
                .query_raw(
                    &format!("SELECT key, value::text, timestamp FROM {table}"),
                    std::iter::empty::<&str>(),
                )
                .await?
        );
        let mut batch: Vec<(String, String, i64)> = Vec::with_capacity(BATCH);
        let mut read = 0u64;
        while let Some(row) = rows.try_next().await? {
            read += 1;
            batch.push((row.get(0), row.get(1), row.get(2)));
            if batch.len() >= BATCH {
                store.import_json(kind, &batch)?;
                batch.clear();
            }
        }
        store.import_json(kind, &batch)?;
        match kind {
            CacheKind::SnowCover => report.snow_cover_rows += read,
            _ => report.geocoding_rows += read,
        }
    }
    Ok(report)
}

fn tracing_error(error: &tokio_postgres::Error) {
    eprintln!("postgres connection error: {error}");
}
