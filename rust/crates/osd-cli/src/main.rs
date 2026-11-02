//! Command line entry point.
//!
//! Replaces: `run.sh`, plus the `npm run download` / `npm run prepare-geojson` /
//! `npm run clear-cache` / `npm run merge-outputs` / `npm run extract-tiles` scripts.

use anyhow::Result;

// The pipeline allocates and frees millions of small strings in bursts, from many threads;
// jemalloc is faster at that than the system allocator and hands memory back between phases.
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

/// jemalloc's configuration string. Freed pages go back to the operating system after a second
/// instead of ten, which takes about 12% off the peak memory of a large run for 3% of its time
/// (returning them at once costs a quarter more time). `_RJEM_MALLOC_CONF` overrides it.
#[repr(transparent)]
pub struct MallocConf(*const u8);
// The pointer is to a string literal.
unsafe impl Sync for MallocConf {}
#[unsafe(export_name = "_rjem_malloc_conf")]
pub static MALLOC_CONF: MallocConf =
    MallocConf(c"dirty_decay_ms:1000,muzzy_decay_ms:1000".as_ptr().cast());
use clap::{Parser, Subcommand};

#[derive(clap::ValueEnum, Debug, Clone, Copy)]
enum GeocodingServerType {
    Photon,
    #[value(name = "geocode-api")]
    GeocodeApi,
}

#[derive(clap::ValueEnum, Debug, Clone, Copy)]
enum ElevationServerType {
    Racemap,
    #[value(name = "tileserver-gl")]
    TileserverGl,
    /// Terrain tiles (Mapbox Terrain-RGB or Terrarium) fetched from a URL template.
    Tile,
}

#[derive(clap::ValueEnum, Debug, Clone, Copy)]
enum SnowCoverFetchPolicyArg {
    Full,
    Incremental,
    None,
}

#[derive(clap::ValueEnum, Debug, Clone, Copy)]
enum TileEncodingArg {
    Mapbox,
    Terrarium,
}

#[derive(Parser, Debug)]
#[command(name = "openskidata", about = "OpenSkiData processor", version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

/// What every pipeline command needs: where the files are, and the area they cover.
#[derive(clap::Args, Debug)]
struct Common {
    /// Where the input files (`input_*.osmjson`, `input_skimap_ski_areas.geojson`) are and
    /// the download writes them.
    #[arg(long, env = "WORKING_DIR", default_value = "data")]
    working_dir: std::path::PathBuf,
    /// Bounding box, as JSON `[west, south, east, north]`: restricts the download and is
    /// reported in `metadata.json`.
    #[arg(long, env = "BBOX")]
    bbox: Option<String>,
}

#[derive(clap::Args, Debug)]
struct DownloadArgs {
    /// Use the five Overpass JSON files in this directory instead of querying Overpass.
    #[arg(long, env = "OSM_INPUT_DIR")]
    osm_input_dir: Option<std::path::PathBuf>,
}

#[derive(clap::Args, Debug)]
struct PrepareArgs {
    #[arg(long, env = "OUTPUT_DIR", default_value = "data")]
    output_dir: std::path::PathBuf,
    /// A reverse geocoder (Photon, or a Who's On First `geocode-api`) to find the places
    /// objects lie in. Without one, `places` are empty.
    #[arg(long, env = "GEOCODING_SERVER_URL")]
    geocoding_server_url: Option<String>,
    #[arg(
        long,
        env = "GEOCODING_SERVER_TYPE",
        value_enum,
        default_value = "photon"
    )]
    geocoding_server_type: GeocodingServerType,
    /// How long a cached geocoding response stays valid, in milliseconds (default a year).
    #[arg(
        long,
        env = "GEOCODING_SERVER_URL_TTL",
        default_value_t = 31_536_000_000
    )]
    geocoding_cache_ttl_ms: i64,
    /// An elevation server, to give runs, lifts and spots their elevations. For the `tile`
    /// type, a URL template with `{z}`, `{x}` and `{y}`.
    #[arg(long, env = "ELEVATION_SERVER_URL")]
    elevation_server_url: Option<String>,
    /// `racemap` (one POST of coordinates), `tileserver-gl` (a batch endpoint) or `tile`
    /// (terrain tiles read here).
    #[arg(
        long,
        env = "ELEVATION_SERVER_TYPE",
        value_enum,
        default_value = "racemap"
    )]
    elevation_server_type: ElevationServerType,
    /// For `tileserver-gl` and `tile`: the zooms to try in turn, comma separated.
    #[arg(
        long,
        env = "ELEVATION_SERVER_ZOOM",
        value_delimiter = ',',
        default_value = "12"
    )]
    elevation_server_zoom: Vec<u32>,
    /// The most coordinates asked of the elevation server at once.
    #[arg(long, env = "ELEVATION_SERVER_BATCH_SIZE", default_value_t = 10_000)]
    elevation_server_batch_size: usize,
    /// For `tile`: how the tiles encode height.
    #[arg(
        long,
        env = "ELEVATION_SERVER_TILE_ENCODING",
        value_enum,
        default_value = "mapbox"
    )]
    elevation_tile_encoding: TileEncodingArg,
    /// For `tile`: the width of a tile in pixels.
    #[arg(long, env = "ELEVATION_TILE_SIZE", default_value_t = 512)]
    elevation_tile_size: u32,
    /// For `tile`: where downloaded tiles are kept.
    #[arg(
        long,
        env = "ELEVATION_TILE_CACHE_DIR",
        default_value = "data/tile-cache"
    )]
    elevation_tile_cache_dir: std::path::PathBuf,
    /// For `tile`: the most tiles kept on disk.
    #[arg(
        long,
        env = "ELEVATION_TILE_CACHE_MAX_TILES",
        default_value_t = 100_000
    )]
    elevation_tile_cache_max_tiles: usize,
    /// For `tile`: tiles downloaded at once.
    #[arg(long, env = "ELEVATION_TILE_CONCURRENCY", default_value_t = 4)]
    elevation_tile_concurrency: usize,
    /// Add snow cover histories to runs and snow cover statistics to ski areas, from the VIIRS
    /// archive in the cache store.
    #[arg(long, env = "ENABLE_SNOW_COVER", action = clap::ArgAction::SetTrue, value_parser = clap::builder::FalseyValueParser::new())]
    enable_snow_cover: bool,
    /// How the archive is brought up to date first: `full`, `incremental` or `none`.
    #[arg(
        long,
        env = "SNOW_COVER_FETCH_POLICY",
        value_enum,
        default_value = "full"
    )]
    snow_cover_fetch_policy: SnowCoverFetchPolicyArg,
    /// The snow cover fetcher (default `snow-cover/src/fetch_snow_data.py`).
    #[arg(long, env = "SNOW_COVER_SCRIPT")]
    snow_cover_script: Option<std::path::PathBuf>,
    /// The Python to run it with (default `snow-cover/venv/bin/python` if it exists, else
    /// `python3`).
    #[arg(long, env = "SNOW_COVER_PYTHON")]
    snow_cover_python: Option<std::path::PathBuf>,
    /// Build `openskimap.mbtiles` with tippecanoe. `TILE_CONCURRENCY` bounds how many of the
    /// four layers are built at once (default 2).
    #[arg(long, env = "GENERATE_TILES", action = clap::ArgAction::SetTrue, value_parser = clap::builder::FalseyValueParser::new())]
    generate_tiles: bool,
    /// The cache store the geocoder's and the elevation lookup's responses are kept in.
    #[arg(long, env = "CACHE_PATH", default_value = "data/cache.db")]
    cache_path: std::path::PathBuf,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Download the OpenStreetMap data from Overpass and the ski areas from Skimap.org.
    ///
    /// Writes `input_*.osmjson`, `input_skimap_ski_areas.geojson` and
    /// `input_download_metadata.json` to the working directory.
    Download {
        #[command(flatten)]
        common: Common,
        #[command(flatten)]
        download: DownloadArgs,
    },
    /// Turn the downloaded input files into the output files.
    ///
    /// Reads the files `download` wrote, and writes GeoJSON, the slimmed mapboxgl GeoJSON,
    /// CSV and the GeoPackage to the output directory, and with `--generate-tiles` the vector
    /// tiles. Snow cover is not applied yet.
    Prepare {
        #[command(flatten)]
        common: Common,
        #[command(flatten)]
        prepare: PrepareArgs,
    },
    /// Download, then prepare (`run.sh`).
    Run {
        #[command(flatten)]
        common: Common,
        #[command(flatten)]
        download: DownloadArgs,
        #[command(flatten)]
        prepare: PrepareArgs,
        /// Use the files already in the working directory.
        #[arg(long)]
        skip_download: bool,
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

fn parse_bbox(bbox: &Option<String>) -> Result<Option<Vec<f64>>> {
    bbox.as_ref()
        .map(|text| serde_json::from_str(text))
        .transpose()
        .map_err(|e| anyhow::anyhow!("BBOX must be a JSON array of numbers: {e}"))
}

fn run_download(common: &Common, download: &DownloadArgs) -> Result<()> {
    osd_pipeline::download::download(&osd_pipeline::download::DownloadConfig::new(
        common.working_dir.clone(),
        parse_bbox(&common.bbox)?,
        download.osm_input_dir.clone(),
    ))
}

fn run_prepare(common: &Common, args: PrepareArgs) -> Result<()> {
    osd_pipeline::prepare::prepare(&osd_pipeline::prepare::PrepareConfig {
        input_dir: common.working_dir.clone(),
        output_dir: args.output_dir,
        bbox: parse_bbox(&common.bbox)?,
        cache_path: args.cache_path,
        generate_tiles: args.generate_tiles,
        snow_cover: args.enable_snow_cover.then(|| {
            let mut settings =
                osd_pipeline::prepare::SnowCoverSettings::new(match args.snow_cover_fetch_policy {
                    SnowCoverFetchPolicyArg::Full => {
                        osd_pipeline::prepare::SnowCoverFetchPolicy::Full
                    }
                    SnowCoverFetchPolicyArg::Incremental => {
                        osd_pipeline::prepare::SnowCoverFetchPolicy::Incremental
                    }
                    SnowCoverFetchPolicyArg::None => {
                        osd_pipeline::prepare::SnowCoverFetchPolicy::None
                    }
                });
            if let Some(script) = args.snow_cover_script.clone() {
                settings.script = script;
            }
            settings.python = args.snow_cover_python.clone();
            settings
        }),
        geocoding: args
            .geocoding_server_url
            .map(|url| osd_pipeline::prepare::GeocodingSettings {
                url,
                server_type: match args.geocoding_server_type {
                    GeocodingServerType::Photon => osd_enrich::http_geocoder::ServerType::Photon,
                    GeocodingServerType::GeocodeApi => {
                        osd_enrich::http_geocoder::ServerType::GeocodeApi
                    }
                },
                cache_ttl_ms: args.geocoding_cache_ttl_ms,
            }),
        elevation: args
            .elevation_server_url
            .map(|url| osd_pipeline::prepare::ElevationSettings {
                server: match args.elevation_server_type {
                    ElevationServerType::Racemap => {
                        osd_pipeline::prepare::ElevationServer::Racemap { url }
                    }
                    ElevationServerType::TileserverGl => {
                        osd_pipeline::prepare::ElevationServer::TileserverGl {
                            url,
                            zooms: args.elevation_server_zoom.clone(),
                        }
                    }
                    ElevationServerType::Tile => osd_pipeline::prepare::ElevationServer::Tile(
                        osd_enrich::terrain::TerrainTileConfig {
                            url_template: url,
                            encoding: match args.elevation_tile_encoding {
                                TileEncodingArg::Mapbox => {
                                    osd_enrich::terrain::TileEncoding::Mapbox
                                }
                                TileEncodingArg::Terrarium => {
                                    osd_enrich::terrain::TileEncoding::Terrarium
                                }
                            },
                            tile_size: args.elevation_tile_size,
                            cache_dir: args.elevation_tile_cache_dir.clone(),
                            cache_max_tiles: args.elevation_tile_cache_max_tiles,
                            tile_concurrency: args.elevation_tile_concurrency,
                            zooms: args.elevation_server_zoom.clone(),
                        },
                    ),
                },
                batch_size: args.elevation_server_batch_size,
            }),
    })
}

// Not `#[tokio::main]`: the pipeline uses blocking HTTP clients, which must not be created
// inside an async runtime. Only the Postgres migration needs one.
fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    match Cli::parse().command {
        Command::Download { common, download } => run_download(&common, &download),
        Command::Prepare { common, prepare } => run_prepare(&common, prepare),
        Command::Run {
            common,
            download,
            prepare,
            skip_download,
        } => {
            if !skip_download {
                run_download(&common, &download)?;
            }
            run_prepare(&common, prepare)
        }
        Command::MigrateCache {
            postgres_url,
            cache_path,
            table_prefix,
        } => {
            if let Some(parent) = cache_path.parent().filter(|p| !p.as_os_str().is_empty()) {
                std::fs::create_dir_all(parent)?;
            }
            let store = osd_cache::CacheStore::open(&cache_path)?;
            let report = tokio::runtime::Runtime::new()?.block_on(
                osd_cache::migrate_from_postgres(&postgres_url, &table_prefix, &store),
            )?;
            println!("{report:#?}");
            println!("{:#?}", store.counts()?);
            Ok(())
        }
    }
}
