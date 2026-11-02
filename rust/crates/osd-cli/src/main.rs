//! Command line entry point.
//!
//! Replaces: `run.sh`, plus the `npm run download` / `npm run prepare-geojson` /
//! `npm run clear-cache` / `npm run merge-outputs` / `npm run extract-tiles` scripts.

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(name = "openskidata", about = "OpenSkiData processor", version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Turn the downloaded input files into the output files.
    ///
    /// Reads `input_*.osmjson` (from Overpass, or the files `OSM_INPUT_DIR` points at) and
    /// `input_skimap_ski_areas.geojson` from the input directory, and writes GeoJSON, the
    /// slimmed mapboxgl GeoJSON and CSV to the output directory. Elevation, geocoding, snow
    /// cover and tiles are not applied yet.
    Prepare {
        #[arg(long, env = "INPUT_DIR", default_value = "data/input")]
        input_dir: std::path::PathBuf,
        #[arg(long, env = "OUTPUT_DIR", default_value = "data/output")]
        output_dir: std::path::PathBuf,
        /// Bounding box the input was restricted to, as JSON `[west, south, east, north]`.
        /// Only reported in `metadata.json`.
        #[arg(long, env = "BBOX")]
        bbox: Option<String>,
    },
    /// Run the full pipeline.
    Run {
        #[arg(long, env = "OSM_PBF")]
        osm_pbf: std::path::PathBuf,
        #[arg(long, env = "OUTPUT_DIR", default_value = "data")]
        output_dir: std::path::PathBuf,
        #[arg(long, env = "CACHE_PATH", default_value = "data/cache.db")]
        cache_path: std::path::PathBuf,
        #[arg(long, env = "GENERATE_TILES")]
        generate_tiles: bool,
    },
    /// Migrate the Postgres caches into the embedded store. Run once; safe to repeat.
    ///
    /// Carries the elevation, geocoding and snow cover caches across with their timestamps,
    /// so nothing has to be fetched again. Elevation keys become the geohash cell's bits.
    MigrateCache {
        /// A libpq-style connection string for the cache database, e.g.
        /// `host=localhost user=postgres dbname=openskidata_cache`.
        #[arg(long, env = "POSTGRES_URL")]
        postgres_url: String,
        #[arg(long, env = "CACHE_PATH", default_value = "data/cache.db")]
        cache_path: std::path::PathBuf,
        /// The prefix of the cache tables (upstream's `tablePrefix`; empty in production).
        #[arg(long, env = "TABLE_PREFIX", default_value = "")]
        table_prefix: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let cli = Cli::parse();
    match cli.command {
        Command::Prepare {
            input_dir,
            output_dir,
            bbox,
        } => {
            let bbox: Option<Vec<f64>> =
                bbox.map(|text| serde_json::from_str(&text))
                    .transpose()
                    .map_err(|e| anyhow::anyhow!("BBOX must be a JSON array of numbers: {e}"))?;
            osd_pipeline::prepare::prepare(&osd_pipeline::prepare::PrepareConfig {
                input_dir,
                output_dir,
                bbox,
            })
        }
        Command::Run { .. } => todo!("wire up osd_pipeline::run"),
        Command::MigrateCache {
            postgres_url,
            cache_path,
            table_prefix,
        } => {
            if let Some(parent) = cache_path.parent().filter(|p| !p.as_os_str().is_empty()) {
                std::fs::create_dir_all(parent)?;
            }
            let store = osd_cache::CacheStore::open(&cache_path)?;
            let report =
                osd_cache::migrate_from_postgres(&postgres_url, &table_prefix, &store).await?;
            println!("{report:#?}");
            println!("{:#?}", store.counts()?);
            Ok(())
        }
    }
}
