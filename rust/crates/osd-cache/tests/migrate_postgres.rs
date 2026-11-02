//! The migration from the Postgres cache database, against a real one.
//!
//! The tables are created with the DDL `PostgresCache.createCacheTable` runs
//! (`key TEXT PRIMARY KEY, value REAL | JSONB NOT NULL, timestamp BIGINT NOT NULL`, plus the
//! timestamp index) and filled with the kinds of rows the pipeline writes, and some it would
//! not: keys that are not geohashes, to check the report accounts for them.
//!
//! Needs PostgreSQL, like the TypeScript tests: `OSD_TEST_POSTGRES` is the connection string
//! of a server to create a scratch database on (default: localhost as `POSTGRES_USER`, with
//! `POSTGRES_PASSWORD` if set, as the TypeScript tests connect).

use osd_cache::geohash;
use osd_cache::{CacheKind, CacheStore, elevation_key, migrate_from_postgres};
use serde_json::{Value, json};
use tokio_postgres::{Client, NoTls};

fn server() -> String {
    std::env::var("OSD_TEST_POSTGRES").unwrap_or_else(|_| {
        // As the TypeScript tests connect: `POSTGRES_USER` / `POSTGRES_PASSWORD`.
        let user = std::env::var("POSTGRES_USER").unwrap_or_else(|_| "postgres".into());
        match std::env::var("POSTGRES_PASSWORD") {
            Ok(password) => format!("host=localhost user={user} password={password}"),
            Err(_) => format!("host=localhost user={user}"),
        }
    })
}

async fn connect(config: &str) -> Client {
    let (client, connection) = tokio_postgres::connect(config, NoTls)
        .await
        .unwrap_or_else(|e| panic!("these tests need PostgreSQL ({config}): {e}"));
    tokio::spawn(connection);
    client
}

/// A scratch database, dropped afterwards.
struct Scratch {
    name: String,
}

impl Scratch {
    async fn create(label: &str) -> (Scratch, Client) {
        let name = format!("osd_cache_migration_{label}_{}", std::process::id());
        let admin = connect(&server()).await;
        // Separate statements: `DROP/CREATE DATABASE` cannot run in a transaction block, which
        // is what a multi-statement batch is.
        admin
            .batch_execute(&format!("DROP DATABASE IF EXISTS {name}"))
            .await
            .unwrap();
        admin
            .batch_execute(&format!("CREATE DATABASE {name}"))
            .await
            .unwrap();
        let client = connect(&format!("{} dbname={name}", server())).await;
        (Scratch { name }, client)
    }

    fn url(&self) -> String {
        format!("{} dbname={}", server(), self.name)
    }

    async fn drop(self) {
        let admin = connect(&server()).await;
        admin
            .batch_execute(&format!(
                "DROP DATABASE IF EXISTS {} WITH (FORCE)",
                self.name
            ))
            .await
            .unwrap();
    }
}

async fn create_tables(client: &Client, prefix: &str) {
    for (name, value_type) in [
        ("elevation", "REAL"),
        ("geocoding_photon", "JSONB NOT NULL"),
        ("geocoding_geocode_api", "JSONB NOT NULL"),
        ("snow_cover", "JSONB NOT NULL"),
    ] {
        client
            .batch_execute(&format!(
                "CREATE TABLE {prefix}{name}_cache (key TEXT PRIMARY KEY, value {value_type}, timestamp BIGINT NOT NULL);
                 CREATE INDEX IF NOT EXISTS idx_{prefix}{name}_cache_timestamp ON {prefix}{name}_cache(timestamp)"
            ))
            .await
            .unwrap();
    }
}

fn cell(lat: f64, lng: f64) -> String {
    geohash::to_string(elevation_key(lat, lng), 10)
}

#[tokio::test]
async fn the_caches_are_carried_across_and_accounted_for() {
    let (scratch, client) = Scratch::create("carried").await;
    create_tables(&client, "p_").await;

    // Elevation: values, a negative, zero, a cached "no data", a float4 that is not exact.
    let elevations: Vec<(String, Option<f32>, i64)> = vec![
        (cell(47.2, 11.3), Some(1234.5), 1_700_000_000_000),
        (cell(47.2001, 11.3001), Some(0.0), 1_700_000_000_001),
        (cell(-33.4, -70.3), Some(-12.25), 1_700_000_000_002),
        (cell(36.7, 138.2), None, 1_700_000_000_003),
        (cell(43.3, 142.8), Some(2999.9), 1_700_000_000_004),
    ];
    for (key, value, ts) in &elevations {
        client
            .execute(
                "INSERT INTO p_elevation_cache (key, value, timestamp) VALUES ($1, $2, $3)",
                &[key, value, ts],
            )
            .await
            .unwrap();
    }
    // Rows whose key is not a 10-character geohash cannot be carried across.
    for bad in ["short", "u0yjjd6gqa0", "u0yjjd6gqa", ""] {
        client
            .execute(
                "INSERT INTO p_elevation_cache (key, value, timestamp) VALUES ($1, 1.0, 1)",
                &[&bad],
            )
            .await
            .unwrap();
    }

    let documents: Vec<(&str, Value)> = vec![
        (
            "u0yjjd",
            json!({"b": 1, "a": [1, 2, {"z": null}], "unicode": "Zürich ☃"}),
        ),
        (
            "u0yjjf",
            json!({"features": [], "type": "FeatureCollection"}),
        ),
        ("xn76ur", json!([1.5, "two", null, true])),
    ];
    for (n, (key, value)) in documents.iter().enumerate() {
        client
            .execute(
                "INSERT INTO p_geocoding_photon_cache (key, value, timestamp) VALUES ($1, $2::text::jsonb, $3)",
                &[key, &value.to_string(), &(2_000 + n as i64)],
            )
            .await
            .unwrap();
    }
    client
        .execute(
            "INSERT INTO p_geocoding_geocode_api_cache (key, value, timestamp) VALUES ('u0yjjd', '{\"api\": true}', 3000), ('gcpvj0', '{\"api\": false}', 3001)",
            &[],
        )
        .await
        .unwrap();
    client
        .execute(
            "INSERT INTO p_snow_cover_cache (key, value, timestamp) VALUES
             ('snow_cover:h12v04:100:200', '[{\"year\": 2023, \"data\": [[1, 2], [3, 4]]}]', 4000),
             ('snow_cover:h12v04:100:201', '[]', 4001),
             ('snow_cover:h12v05:0:0', '[{\"year\": 2024, \"data\": []}]', 4002),
             ('snow_cover:h12v05:1:0', '[]', 4003)",
            &[],
        )
        .await
        .unwrap();

    let store = CacheStore::open_in_memory().unwrap();
    let report = migrate_from_postgres(&scratch.url(), "p_", &store)
        .await
        .unwrap();

    assert_eq!(report.elevation_rows, 9, "every source row is counted");
    assert_eq!(report.skipped_rows, 4);
    assert_eq!(report.geocoding_rows, 5);
    assert_eq!(report.snow_cover_rows, 4);
    assert!(report.missing_tables.is_empty());
    assert_eq!(report.total_rows(), 18);

    let counts = store.counts().unwrap();
    assert_eq!(counts.elevation, 5);
    assert_eq!(counts.geocoding_photon, 3);
    assert_eq!(counts.geocoding_geocode_api, 2);
    assert_eq!(counts.snow_cover, 4);

    // Each elevation is found under the cell of a coordinate in it, with its value and timestamp.
    let keys: Vec<u64> = elevations
        .iter()
        .map(|(k, _, _)| geohash::from_str(k, 10).unwrap())
        .collect();
    let got = store
        .get_elevation_many(&keys, 1_700_000_000_004, 0)
        .unwrap();
    let want: Vec<_> = elevations.iter().map(|(_, v, _)| Some(*v)).collect();
    assert_eq!(got, want);
    // The timestamps came across: with a one-millisecond time to live only the newest is fresh.
    let fresh = store
        .get_elevation_many(&keys, 1_700_000_000_004, 1)
        .unwrap();
    assert_eq!(
        fresh.iter().map(Option::is_some).collect::<Vec<_>>(),
        vec![false, false, false, true, true]
    );

    // JSON values are equal as JSON (jsonb does not keep key order or whitespace).
    let photon = store
        .get_json_many(
            CacheKind::GeocodingPhoton,
            &documents
                .iter()
                .map(|(k, _)| k.to_string())
                .collect::<Vec<_>>(),
            4000,
            0,
        )
        .unwrap();
    for ((_, expected), stored) in documents.iter().zip(photon) {
        let stored: Value = serde_json::from_str(&stored.expect("migrated")).unwrap();
        assert_eq!(&stored, expected);
    }
    let snow = store
        .get_json_many(
            CacheKind::SnowCover,
            &["snow_cover:h12v04:100:200".to_owned()],
            4000,
            0,
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(snow[0].as_ref().unwrap()).unwrap(),
        json!([{"year": 2023, "data": [[1, 2], [3, 4]]}])
    );
    // The two geocoders' caches do not mix: the same key holds different values.
    let api = store
        .get_json_many(
            CacheKind::GeocodingGeocodeApi,
            &["u0yjjd".to_owned()],
            4000,
            0,
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(api[0].as_ref().unwrap()).unwrap(),
        json!({"api": true})
    );

    // Repeating it changes nothing ...
    let again = migrate_from_postgres(&scratch.url(), "p_", &store)
        .await
        .unwrap();
    assert_eq!(again, report);
    assert_eq!(store.counts().unwrap(), counts);

    // ... and does not overwrite what a later run has written since.
    store
        .set_elevation_many(&[(keys[0], Some(1.0))], 1_800_000_000_000)
        .unwrap();
    migrate_from_postgres(&scratch.url(), "p_", &store)
        .await
        .unwrap();
    assert_eq!(
        store
            .get_elevation_many(&keys[..1], 1_800_000_000_000, 0)
            .unwrap()[0],
        Some(Some(1.0))
    );

    scratch.drop().await;
}

#[tokio::test]
async fn tables_that_do_not_exist_are_reported_not_fatal() {
    let (scratch, _client) = Scratch::create("missing").await;
    let store = CacheStore::open_in_memory().unwrap();
    let report = migrate_from_postgres(&scratch.url(), "", &store)
        .await
        .unwrap();
    assert_eq!(report.total_rows(), 0);
    assert_eq!(
        report.missing_tables,
        vec![
            "elevation_cache",
            "geocoding_photon_cache",
            "geocoding_geocode_api_cache",
            "snow_cover_cache"
        ]
    );
    scratch.drop().await;
}

#[tokio::test]
async fn a_table_prefix_that_is_not_an_identifier_is_refused() {
    let store = CacheStore::open_in_memory().unwrap();
    let error = migrate_from_postgres(
        "host=localhost user=postgres",
        "x; DROP TABLE y; --",
        &store,
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("table prefix"), "{error}");
}
