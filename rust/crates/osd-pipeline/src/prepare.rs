//! `prepare`: from the downloaded input files to the output files.
//!
//! Replaces `src/PrepareGeoJSON.ts` for the stages that are ported. It reads the same input
//! files the TypeScript pipeline does (`input_*.osmjson` from Overpass or `OSM_INPUT_DIR`,
//! and Skimap.org's GeoJSON), and writes `ski_areas.geojson`, `runs.geojson`, `lifts.geojson`
//! and `spots.geojson`, their `mapboxgl_*` counterparts, the CSV exports, `openskidata.gpkg`
//! and `metadata.json`. Not yet written: the tiles.
//!
//! Geocoding and elevation are applied when configured. Snow cover is not, so the output equals
//! what the TypeScript pipeline produces with snow cover switched off.

use crate::elevation::apply_elevation;
use crate::format::{FormatInput, SkimapSkiArea, format_all_owned};
use anyhow::{Context, Result};
use openskidata_format::{FeatureType, SkiAreaActivity, Status};
use osd_cache::CacheStore;
use osd_cluster::engine::{ClusterOutput, Enrichment, Feature, cluster_enriched};
use osd_enrich::elevation::{ElevationLoader, ElevationSource, RacemapSource, TileserverGlSource};
use osd_enrich::http_geocoder::{HttpGeocoder, HttpGeocoderConfig, ServerType};
use osd_enrich::snow::{CachedSnowCover, SnowCoverSource};
use osd_osm::element::{Element, Feature as OsmFeature, Relation};
use osd_osm::overpass::{convert_overpass_json, read_elements};
use osd_out::geojson::{geometry_json, write_feature_collection};
use osd_out::metadata::{self, MetadataCollector, MetadataOptions};
use osd_out::{csv, gpkg, mapboxgl};
use serde_json::{Value, json};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use time::OffsetDateTime;

/// Input file names, as `src/io/GeoJSONFiles.ts` defines them.
pub const RUNS: &str = "input_runs.osmjson";
pub const LIFTS: &str = "input_lifts.osmjson";
pub const SKI_AREAS: &str = "input_ski_areas.osmjson";
pub const SKI_AREA_SITES: &str = "input_ski_area_sites.osmjson";
pub const SPOTS: &str = "input_spots.osmjson";
pub const SKIMAP: &str = "input_skimap_ski_areas.geojson";

#[derive(Debug, Clone)]
pub struct PrepareConfig {
    pub input_dir: PathBuf,
    pub output_dir: PathBuf,
    /// The bounding box the run is restricted to (`BBOX`), reported in `metadata.json`.
    pub bbox: Option<Vec<f64>>,
    /// Where the geocoder's and the elevation lookup's responses are cached (see
    /// `openskidata migrate-cache`). Only opened if one of them is configured.
    pub cache_path: PathBuf,
    /// The reverse geocoder, if one is configured (`GEOCODING_SERVER_URL`).
    pub geocoding: Option<GeocodingSettings>,
    /// The elevation server, if one is configured (`ELEVATION_SERVER_URL`).
    pub elevation: Option<ElevationSettings>,
    /// Snow cover from the archive in the cache (`ENABLE_SNOW_COVER`): each run's history, and
    /// the snow cover statistics of ski areas.
    pub snow_cover: Option<SnowCoverSettings>,
    /// Build `openskimap.mbtiles` from the mapboxgl files with tippecanoe (`GENERATE_TILES`).
    /// The four layers are built in the input directory, as upstream's working directory.
    pub generate_tiles: bool,
}

/// How the snow cover archive is brought up to date before it is read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnowCoverFetchPolicy {
    /// Fetch the data for every pixel of every run.
    Full,
    /// Fetch only what the archive is missing, as it is configured to be filled.
    Incremental,
    /// Use the archive as it is.
    None,
}

#[derive(Debug, Clone)]
pub struct SnowCoverSettings {
    pub fetch_policy: SnowCoverFetchPolicy,
    /// The fetcher, `snow-cover/src/fetch_snow_data.py`, relative to the working directory.
    pub script: PathBuf,
    /// The Python to run it with; `None` is `snow-cover/venv/bin/python` if that exists, else
    /// `python3`.
    pub python: Option<PathBuf>,
}

impl SnowCoverSettings {
    pub fn new(fetch_policy: SnowCoverFetchPolicy) -> Self {
        SnowCoverSettings {
            fetch_policy,
            script: PathBuf::from("snow-cover/src/fetch_snow_data.py"),
            python: None,
        }
    }
}

/// The pixels the runs cover, each once, as `{"h18v04": [[row, col], ...]}` in the order first
/// seen: what the fetcher is asked to bring into the archive. The same extraction later reads
/// the data back, so nothing that will be looked up is left out.
pub fn snow_cover_pixels_json(runs: &[crate::format::RunOut]) -> String {
    use rayon::prelude::*;
    let per_run: Vec<Vec<osd_enrich::viirs::ViirsPixel>> = runs
        .par_iter()
        .map(|run| {
            osd_enrich::viirs::geometry_pixels(&crate::format::geometry_of_run(&run.geometry))
        })
        .collect();
    let mut seen = std::collections::HashSet::new();
    let mut tiles: Vec<String> = Vec::new();
    let mut by_tile: std::collections::HashMap<String, Vec<[u32; 2]>> =
        std::collections::HashMap::new();
    for [h, v, col, row] in per_run.into_iter().flatten() {
        if !seen.insert([h, v, col, row]) {
            continue;
        }
        let tile = osd_enrich::snow::tile_id(h, v);
        by_tile
            .entry(tile.clone())
            .or_insert_with(|| {
                tiles.push(tile.clone());
                Vec::new()
            })
            .push([row, col]);
    }
    let mut out = String::from("{");
    for (i, tile) in tiles.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&format!("\"{tile}\":["));
        out.push_str(
            &by_tile[tile]
                .iter()
                .map(|[row, col]| format!("[{row},{col}]"))
                .collect::<Vec<_>>()
                .join(","),
        );
        out.push(']');
    }
    out.push('}');
    out
}

/// Brings the snow cover archive up to date with the Python fetcher, which writes into the same
/// cache file the processor reads: for the `Full` policy, the pixels of the runs; for
/// `Incremental`, the missing weeks of the pixels the archive already has. A failure fails the
/// run, as upstream's does.
fn fetch_snow_cover(
    settings: &SnowCoverSettings,
    runs: &[crate::format::RunOut],
    cache_path: &Path,
    scratch_dir: &Path,
) -> Result<()> {
    let python = settings.python.clone().unwrap_or_else(|| {
        let venv = PathBuf::from("snow-cover/venv/bin/python");
        if venv.exists() {
            venv
        } else {
            PathBuf::from("python3")
        }
    });
    let mut command = std::process::Command::new(&python);
    command
        .arg(&settings.script)
        .arg("--archive-file")
        .arg(cache_path);
    match settings.fetch_policy {
        SnowCoverFetchPolicy::None => return Ok(()),
        SnowCoverFetchPolicy::Incremental => {
            command.arg("--fill-cache");
        }
        SnowCoverFetchPolicy::Full => {
            if runs.is_empty() {
                return Ok(());
            }
            let pixels = scratch_dir.join("snow_cover_pixels.json");
            fs::write(&pixels, snow_cover_pixels_json(runs))?;
            command.arg("--pixels-json").arg(&pixels);
        }
    }
    tracing::info!("Running: {command:?}");
    let status = command
        .status()
        .with_context(|| format!("starting {}", python.display()))?;
    if !status.success() {
        anyhow::bail!("Snow cover processing failed: {command:?} exited with {status}");
    }
    Ok(())
}

/// A reverse-geocoding server.
#[derive(Debug, Clone)]
pub struct GeocodingSettings {
    pub url: String,
    pub server_type: ServerType,
    /// How long a cached response stays valid, in milliseconds.
    pub cache_ttl_ms: i64,
}

/// Which elevation server to ask, and how.
#[derive(Debug, Clone)]
pub enum ElevationServer {
    /// One POST of `[lat, lng]` pairs.
    Racemap { url: String },
    /// A batch endpoint tried at each zoom in turn.
    TileserverGl { url: String, zooms: Vec<u32> },
    /// Terrain tiles fetched and read here.
    Tile(osd_enrich::terrain::TerrainTileConfig),
}

#[derive(Debug, Clone)]
pub struct ElevationSettings {
    pub server: ElevationServer,
    /// The most cells asked of the server at once.
    pub batch_size: usize,
}

fn features_from_osm_json(path: &Path) -> Result<Vec<OsmFeature>> {
    let file = File::open(path).with_context(|| format!("opening {}", path.display()))?;
    convert_overpass_json(BufReader::new(file))
        .with_context(|| format!("converting {}", path.display()))
}

fn relations_from_osm_json(path: &Path) -> Result<Vec<Relation>> {
    let file = File::open(path).with_context(|| format!("opening {}", path.display()))?;
    let mut relations = Vec::new();
    read_elements(BufReader::new(file), |element| {
        if let Element::Relation(relation) = element {
            relations.push(relation);
        }
    })
    .with_context(|| format!("reading {}", path.display()))?;
    Ok(relations)
}

/// Skimap.org's ski areas. An unreadable feature is skipped, as upstream skips features it
/// cannot prepare.
fn skimap_ski_areas(path: &Path) -> Result<Vec<SkimapSkiArea>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let document: Value = serde_json::from_reader(BufReader::new(
        File::open(path).with_context(|| format!("opening {}", path.display()))?,
    ))?;
    let features = document["features"].as_array().cloned().unwrap_or_default();
    Ok(features.iter().filter_map(skimap_ski_area).collect())
}

fn skimap_ski_area(feature: &Value) -> Option<SkimapSkiArea> {
    let properties = &feature["properties"];
    let coordinates = feature["geometry"]["coordinates"].as_array()?;
    Some(SkimapSkiArea {
        id: match &properties["id"] {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            _ => return None,
        },
        name: properties["name"].as_str().map(str::to_owned),
        status: properties["status"]
            .as_str()
            .and_then(|s| Status::from_str(s).ok()),
        activities: properties["activities"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str())
                    .filter_map(|s| SkiAreaActivity::from_str(s).ok())
                    .collect()
            })
            .unwrap_or_default(),
        official_website: properties["official_website"].as_str().map(str::to_owned),
        coordinates: [
            coordinates.first()?.as_f64()?,
            coordinates.get(1)?.as_f64()?,
        ],
    })
}

fn feature_json<P: serde::Serialize>(feature: &Feature<P>) -> Value {
    json!({
        "type": "Feature",
        "geometry": geometry_json(&feature.geometry, feature.elevations.as_deref()),
        "properties": serde_json::to_value(&feature.properties).expect("serializes"),
    })
}

fn write_geojson(path: &Path, features: impl IntoIterator<Item = Value>) -> Result<()> {
    let mut out =
        BufWriter::new(File::create(path).with_context(|| format!("creating {}", path.display()))?);
    write_feature_collection(&mut out, features)?;
    out.flush()?;
    Ok(())
}

fn write_text(path: &Path, text: &str) -> Result<()> {
    fs::write(path, text).with_context(|| format!("writing {}", path.display()))
}

/// Writes every output file for a clustered dataset. The files do not depend on one another, so
/// they are written at once, one job each; the GeoPackage is the longest.
pub fn write_outputs(output: &ClusterOutput, output_dir: &Path) -> Result<()> {
    use rayon::prelude::*;
    fs::create_dir_all(output_dir.join("csv"))?;
    let csv_dir = output_dir.join("csv");

    type Job<'a> = Box<dyn FnOnce() -> Result<()> + Send + 'a>;
    let mut jobs: Vec<Job<'_>> = Vec::new();
    jobs.push(Box::new(|| {
        gpkg::write_geopackage(
            &output_dir.join("openskidata.gpkg"),
            &gpkg::Layers {
                ski_areas: &output.ski_areas,
                lifts: &output.lifts,
                runs: &output.runs,
                spots: &output.spots,
            },
        )
        .map(|_| ())
    }));
    jobs.push(Box::new(|| {
        write_geojson(
            &output_dir.join("runs.geojson"),
            output.runs.iter().map(feature_json),
        )
    }));
    jobs.push(Box::new(|| {
        write_geojson(
            &output_dir.join("mapboxgl_runs.geojson"),
            output.runs.iter().filter_map(mapboxgl::run),
        )
    }));
    jobs.push(Box::new(|| {
        write_geojson(
            &output_dir.join("ski_areas.geojson"),
            output.ski_areas.iter().map(feature_json),
        )?;
        write_geojson(
            &output_dir.join("lifts.geojson"),
            output.lifts.iter().map(feature_json),
        )?;
        write_geojson(
            &output_dir.join("spots.geojson"),
            output.spots.iter().map(feature_json),
        )
    }));
    jobs.push(Box::new(|| {
        write_geojson(
            &output_dir.join("mapboxgl_ski_areas.geojson"),
            output.ski_areas.iter().map(mapboxgl::ski_area),
        )?;
        write_geojson(
            &output_dir.join("mapboxgl_lifts.geojson"),
            output.lifts.iter().map(mapboxgl::lift),
        )?;
        write_geojson(
            &output_dir.join("mapboxgl_spots.geojson"),
            output.spots.iter().map(mapboxgl::spot),
        )
    }));
    jobs.push(Box::new(|| {
        write_text(
            &csv_dir.join(csv::filename(FeatureType::Run)),
            &csv::file(FeatureType::Run, output.runs.iter().map(csv::run)),
        )?;
        write_text(
            &csv_dir.join(csv::filename(FeatureType::SkiArea)),
            &csv::file(
                FeatureType::SkiArea,
                output.ski_areas.iter().map(csv::ski_area),
            ),
        )?;
        write_text(
            &csv_dir.join(csv::filename(FeatureType::Lift)),
            &csv::file(FeatureType::Lift, output.lifts.iter().map(csv::lift)),
        )?;
        write_text(
            &csv_dir.join(csv::filename(FeatureType::Spot)),
            &csv::file(FeatureType::Spot, output.spots.iter().map(csv::spot)),
        )
    }));

    jobs.into_par_iter()
        .map(|job| job())
        .collect::<Result<Vec<()>>>()?;
    Ok(())
}

/// Writes `metadata.json`, last, once every file it describes is on disk.
///
/// Counts are taken from the clustered output. A run's or lift's length is its inclined length
/// from its elevation data, and zero without any, as upstream's is.
pub fn write_metadata(
    output: &ClusterOutput,
    output_dir: &Path,
    bbox: Option<Vec<f64>>,
    download: Option<&metadata::DownloadMetadata>,
) -> Result<()> {
    let mut collector = MetadataCollector::new();
    for area in &output.ski_areas {
        let p = &area.properties;
        collector.add_ski_area(
            p.summary.status,
            &p.summary.activities,
            p.places.iter().map(|place| place.iso3166_1_alpha2.as_str()),
        );
    }
    for run in &output.runs {
        collector.add_run(csv::run_elevation(run).map(|e| e.pitch.inclined_length_in_meters));
    }
    for lift in &output.lifts {
        collector.add_lift(
            csv::lift_elevation(lift).map(|e| e.elevation.pitch.inclined_length_in_meters),
        );
    }
    output.spots.iter().for_each(|_| collector.add_spot());

    let geojson = [
        ("skiAreas", output_dir.join("ski_areas.geojson")),
        ("runs", output_dir.join("runs.geojson")),
        ("lifts", output_dir.join("lifts.geojson")),
        ("spots", output_dir.join("spots.geojson")),
    ];
    let csv_files = [
        ("skiAreas", FeatureType::SkiArea),
        ("runs", FeatureType::Run),
        ("lifts", FeatureType::Lift),
        ("spots", FeatureType::Spot),
    ]
    .map(|(key, kind)| (key, output_dir.join("csv").join(csv::filename(kind))));
    let files = metadata::collect_file_sizes(
        &geojson
            .iter()
            .map(|(k, p)| (*k, p.as_path()))
            .collect::<Vec<_>>(),
        &csv_files
            .iter()
            .map(|(k, p)| (*k, p.as_path()))
            .collect::<Vec<_>>(),
        &output_dir.join("openskidata.gpkg"),
    );

    let metadata = collector.metadata(
        MetadataOptions {
            format_version: openskidata_format::FORMAT_VERSION.to_owned(),
            bbox,
            started_at: download.map(|d| d.started_at.clone()),
            open_street_map_data_timestamp: download
                .and_then(|d| d.open_street_map.data_timestamp.clone()),
            ski_map_org_downloaded_at: download.map(|d| d.ski_map_org.downloaded_at.clone()),
            files,
        },
        OffsetDateTime::now_utc(),
    );
    write_text(&output_dir.join("metadata.json"), &metadata.to_json())
}

/// Reads the input files in `input_dir` and formats them.
pub fn load_formatted(input_dir: &Path) -> Result<crate::format::Formatted> {
    let started = std::time::Instant::now();
    let input = FormatInput {
        runs: features_from_osm_json(&input_dir.join(RUNS))?,
        lifts: features_from_osm_json(&input_dir.join(LIFTS))?,
        ski_areas: features_from_osm_json(&input_dir.join(SKI_AREAS))?,
        sites: relations_from_osm_json(&input_dir.join(SKI_AREA_SITES))?,
        spots: features_from_osm_json(&input_dir.join(SPOTS))?,
        skimap: skimap_ski_areas(&input_dir.join(SKIMAP))?,
    };
    tracing::info!(
        "read and convert the input: {:?}{}",
        started.elapsed(),
        crate::memory::describe()
    );
    let started = std::time::Instant::now();
    let formatted = format_all_owned(input)?;
    tracing::info!(
        "format: {:?}{}",
        started.elapsed(),
        crate::memory::describe()
    );
    Ok(formatted)
}

/// Reads the input files, runs the pipeline and writes the output files.
pub fn prepare(config: &PrepareConfig) -> Result<()> {
    let mut formatted = load_formatted(&config.input_dir)?;

    // The cache is shared by the geocoder and the elevation lookup, and opened only if needed.
    let cache = if config.geocoding.is_some()
        || config.elevation.is_some()
        || config.snow_cover.is_some()
    {
        if let Some(parent) = config
            .cache_path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
        {
            fs::create_dir_all(parent)?;
        }
        Some(CacheStore::open(&config.cache_path)?)
    } else {
        None
    };

    let elevation_source: Option<Box<dyn ElevationSource>> = config
        .elevation
        .as_ref()
        .map(|settings| -> Result<Box<dyn ElevationSource>> {
            Ok(match &settings.server {
                ElevationServer::Racemap { url } => Box::new(RacemapSource::new(url.clone())),
                ElevationServer::TileserverGl { url, zooms } => {
                    Box::new(TileserverGlSource::new(url.clone(), zooms.clone()))
                }
                ElevationServer::Tile(tiles) => Box::new(
                    osd_enrich::terrain::TerrainTileSource::new(tiles.clone()).with_context(
                        || format!("opening the tile cache {}", tiles.cache_dir.display()),
                    )?,
                ),
            })
        })
        .transpose()?;
    let elevation_loader = match (&elevation_source, &cache, &config.elevation) {
        (Some(source), Some(cache), Some(settings)) => Some(ElevationLoader::new(
            source.as_ref(),
            cache,
            settings.batch_size,
        )),
        _ => None,
    };
    if let Some(loader) = &elevation_loader {
        apply_elevation(&mut formatted, loader);
    }
    if let Some(source) = &elevation_source {
        source.close();
    }

    if let Some(settings) = &config.snow_cover {
        let started = std::time::Instant::now();
        fetch_snow_cover(
            settings,
            &formatted.runs,
            &config.cache_path,
            &config.input_dir,
        )?;
        tracing::info!("fetch snow cover: {:?}", started.elapsed());
    }

    let geocoder = match (&config.geocoding, &cache) {
        (Some(settings), Some(cache)) => Some(HttpGeocoder::new(
            HttpGeocoderConfig {
                url: settings.url.clone(),
                server_type: settings.server_type,
                cache_ttl_ms: settings.cache_ttl_ms,
            },
            cache,
        )),
        _ => None,
    };
    let snow_cover = match (&config.snow_cover, &cache) {
        (Some(_), Some(cache)) => Some(CachedSnowCover { cache }),
        _ => None,
    };
    let output = cluster_enriched(
        formatted.into_cluster_input(),
        &Enrichment {
            geocoder: geocoder
                .as_ref()
                .map(|g| g as &dyn osd_enrich::geocode::Geocoder),
            elevation: elevation_loader.as_ref(),
            snow_cover: snow_cover.as_ref().map(|s| s as &dyn SnowCoverSource),
        },
    )?;
    let started = std::time::Instant::now();
    write_outputs(&output, &config.output_dir)?;
    tracing::info!(
        "write the outputs: {:?}{}",
        started.elapsed(),
        crate::memory::describe()
    );
    if config.generate_tiles {
        let started = std::time::Instant::now();
        osd_out::tiles::generate_tiles(
            &config.output_dir,
            &config.input_dir,
            &config.output_dir.join("openskimap.mbtiles"),
        )?;
        tracing::info!("generate the tiles: {:?}", started.elapsed());
    }
    let download = metadata::read_download_metadata(&config.input_dir);
    write_metadata(
        &output,
        &config.output_dir,
        config.bbox.clone(),
        download.as_ref(),
    )
}
