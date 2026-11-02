//! `prepare`: from the downloaded input files to the output files.
//!
//! Replaces `src/PrepareGeoJSON.ts` for the stages that are ported. It reads the same input
//! files the TypeScript pipeline does (`input_*.osmjson` from Overpass or `OSM_INPUT_DIR`,
//! and Skimap.org's GeoJSON), and writes `ski_areas.geojson`, `runs.geojson`, `lifts.geojson`
//! and `spots.geojson`, their `mapboxgl_*` counterparts, the CSV exports, `openskidata.gpkg`
//! and `metadata.json`. Not yet written: the tiles.
//!
//! Geocoding is applied when a geocoder is configured. Elevation and snow cover are not, so the
//! output equals what the TypeScript pipeline produces with those two switched off.

use crate::format::{FormatInput, SkimapSkiArea, format_all};
use anyhow::{Context, Result};
use openskidata_format::{FeatureType, SkiAreaActivity, Status};
use osd_cache::CacheStore;
use osd_cluster::engine::{ClusterOutput, Feature, cluster_with_geocoder};
use osd_enrich::http_geocoder::{HttpGeocoder, HttpGeocoderConfig, ServerType};
use osd_osm::element::{Element, Feature as OsmFeature, Relation};
use osd_osm::overpass::{convert_overpass_json, read_elements};
use osd_out::geojson::write_feature_collection;
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
    /// The reverse geocoder, if one is configured (`GEOCODING_SERVER_URL`).
    pub geocoding: Option<GeocodingSettings>,
}

/// A reverse-geocoding server and where its responses are cached.
#[derive(Debug, Clone)]
pub struct GeocodingSettings {
    pub url: String,
    pub server_type: ServerType,
    /// How long a cached response stays valid, in milliseconds.
    pub cache_ttl_ms: i64,
    /// The cache store (see `openskidata migrate-cache`).
    pub cache_path: PathBuf,
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
        "geometry": serde_json::to_value(&feature.geometry).expect("serializes"),
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

/// Writes every output file for a clustered dataset.
pub fn write_outputs(output: &ClusterOutput, output_dir: &Path) -> Result<()> {
    fs::create_dir_all(output_dir.join("csv"))?;

    write_geojson(
        &output_dir.join("ski_areas.geojson"),
        output.ski_areas.iter().map(feature_json),
    )?;
    write_geojson(
        &output_dir.join("runs.geojson"),
        output.runs.iter().map(feature_json),
    )?;
    write_geojson(
        &output_dir.join("lifts.geojson"),
        output.lifts.iter().map(feature_json),
    )?;
    write_geojson(
        &output_dir.join("spots.geojson"),
        output.spots.iter().map(feature_json),
    )?;

    write_geojson(
        &output_dir.join("mapboxgl_ski_areas.geojson"),
        output.ski_areas.iter().map(mapboxgl::ski_area),
    )?;
    write_geojson(
        &output_dir.join("mapboxgl_runs.geojson"),
        output.runs.iter().filter_map(mapboxgl::run),
    )?;
    write_geojson(
        &output_dir.join("mapboxgl_lifts.geojson"),
        output.lifts.iter().map(mapboxgl::lift),
    )?;
    write_geojson(
        &output_dir.join("mapboxgl_spots.geojson"),
        output.spots.iter().map(mapboxgl::spot),
    )?;

    let csv_dir = output_dir.join("csv");
    write_text(
        &csv_dir.join(csv::filename(FeatureType::SkiArea)),
        &csv::file(
            FeatureType::SkiArea,
            output.ski_areas.iter().map(csv::ski_area),
        ),
    )?;
    write_text(
        &csv_dir.join(csv::filename(FeatureType::Run)),
        &csv::file(FeatureType::Run, output.runs.iter().map(csv::run)),
    )?;
    write_text(
        &csv_dir.join(csv::filename(FeatureType::Lift)),
        &csv::file(FeatureType::Lift, output.lifts.iter().map(csv::lift)),
    )?;
    write_text(
        &csv_dir.join(csv::filename(FeatureType::Spot)),
        &csv::file(FeatureType::Spot, output.spots.iter().map(csv::spot)),
    )?;

    gpkg::write_geopackage(
        &output_dir.join("openskidata.gpkg"),
        &gpkg::Layers {
            ski_areas: &output.ski_areas,
            lifts: &output.lifts,
            runs: &output.runs,
            spots: &output.spots,
        },
    )?;
    Ok(())
}

/// Writes `metadata.json`, last, once every file it describes is on disk.
///
/// Counts are taken from the clustered output. A run's length is its inclined length from its
/// elevation profile, and zero without one, as upstream's is. Lifts need their geometry's
/// elevations, which this pipeline does not carry yet, so the lift total is zero.
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
    output.lifts.iter().for_each(|_| collector.add_lift(None));
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

/// Reads the input files, runs the pipeline and writes the output files.
pub fn prepare(config: &PrepareConfig) -> Result<()> {
    let input = FormatInput {
        runs: features_from_osm_json(&config.input_dir.join(RUNS))?,
        lifts: features_from_osm_json(&config.input_dir.join(LIFTS))?,
        ski_areas: features_from_osm_json(&config.input_dir.join(SKI_AREAS))?,
        sites: relations_from_osm_json(&config.input_dir.join(SKI_AREA_SITES))?,
        spots: features_from_osm_json(&config.input_dir.join(SPOTS))?,
        skimap: skimap_ski_areas(&config.input_dir.join(SKIMAP))?,
    };
    let formatted = format_all(&input)?;
    let output = match &config.geocoding {
        Some(settings) => {
            if let Some(parent) = settings
                .cache_path
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
            {
                fs::create_dir_all(parent)?;
            }
            let cache = CacheStore::open(&settings.cache_path)?;
            let geocoder = HttpGeocoder::new(
                HttpGeocoderConfig {
                    url: settings.url.clone(),
                    server_type: settings.server_type,
                    cache_ttl_ms: settings.cache_ttl_ms,
                },
                &cache,
            );
            cluster_with_geocoder(formatted.into_cluster_input(), Some(&geocoder))?
        }
        None => cluster_with_geocoder(formatted.into_cluster_input(), None)?,
    };
    write_outputs(&output, &config.output_dir)?;
    let download = metadata::read_download_metadata(&config.input_dir);
    write_metadata(
        &output,
        &config.output_dir,
        config.bbox.clone(),
        download.as_ref(),
    )
}
