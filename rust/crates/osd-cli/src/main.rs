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
    /// cover, the GeoPackage and tiles are not applied yet.
    Prepare {
        #[arg(long, env = "INPUT_DIR", default_value = "data/input")]
        input_dir: std::path::PathBuf,
        #[arg(long, env = "OUTPUT_DIR", default_value = "data/output")]
        output_dir: std::path::PathBuf,
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
    /// Migrate the Postgres caches into the embedded store. Run once.
    MigrateCache {
        #[arg(long, env = "POSTGRES_URL")]
        postgres_url: String,
        #[arg(long, env = "CACHE_PATH", default_value = "data/cache.db")]
        cache_path: std::path::PathBuf,
    },
    /// Report how many candidate pairs sit near the 500 m clustering threshold.
    ///
    /// Run this before switching the distance backend to local projection, so the blast
    /// radius of the metric change is a known number.
    MetricBlastRadius {
        #[arg(long, env = "OSM_PBF")]
        osm_pbf: std::path::PathBuf,
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
        } => osd_pipeline::prepare::prepare(&osd_pipeline::prepare::PrepareConfig {
            input_dir,
            output_dir,
        }),
        Command::Run { .. } => todo!("wire up osd_pipeline::run"),
        Command::MigrateCache { .. } => todo!("wire up osd_cache::migrate_from_postgres"),
        Command::MetricBlastRadius { .. } => {
            todo!("wire up osd_cluster::report_metric_blast_radius")
        }
    }
}
