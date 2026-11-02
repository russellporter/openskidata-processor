//! The download step: Overpass queries and Skimap.org into the input directory.
//!
//! Replaces `src/io/GeoJSONDownloader.ts`, `DownloadURLs.ts`, `DownloadMetadata.ts` (the
//! writer) and `src/utils/overpassBBoxQuery.ts`. It stops at the `input_*.osmjson` files and
//! `input_skimap_ski_areas.geojson`: the conversion to GeoJSON that upstream does here is part
//! of [`crate::prepare`], which reads the Overpass JSON directly.
//!
//! The query texts are reproduced character for character (`rust/codegen/generate-download-
//! vectors.mjs` records the TypeScript builders for a set of bounding boxes), so the Overpass
//! server sees exactly what it sees today.
//!
//! # Behaviour kept
//!
//! - The same endpoints and the same concurrency: the runs query on `z.overpass-api.de` in
//!   parallel with the lifts, ski areas, sites and spots queries one after another on
//!   `lz4.overpass-api.de` (so one endpoint is never asked twice at once), and Skimap.org in
//!   parallel with both.
//! - Ten retries, a minute apart, on any failure; a 30 minute timeout per request.
//! - With a bounding box, Skimap.org's ski areas are filtered to the ones strictly inside it
//!   (turf's `booleanContains` of a point: the boundary does not count).
//! - `OSM_INPUT_DIR` supplies the five Overpass files instead of querying.
//! - `input_download_metadata.json` records when the download started, the earliest
//!   `timestamp_osm_base` of the five files, and when Skimap.org was fetched. Failing to
//!   record it is logged, not fatal.
//!
//! # Deliberate differences
//!
//! - A Skimap feature without a point geometry is dropped by the bounding box filter; upstream
//!   would throw on it.
//! - Timestamps other than RFC 3339 (which Overpass always writes) are ignored rather than
//!   parsed with JavaScript's `Date`.

use anyhow::{Context, Result, anyhow, bail};
use osd_out::metadata::{DOWNLOAD_METADATA_FILE, to_iso_string, unix_millis};
use osd_store::feature_id::js_number_to_string;
use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::prepare::{LIFTS, RUNS, SKI_AREA_SITES, SKI_AREAS, SKIMAP, SPOTS};

pub const SKIMAP_URL: &str = "https://skimap.org/SkiAreas/index.geojson";
pub const OVERPASS_LZ4: &str = "https://lz4.overpass-api.de/api/interpreter";
pub const OVERPASS_Z: &str = "https://z.overpass-api.de/api/interpreter";

#[derive(Debug, Clone)]
pub struct DownloadConfig {
    pub dir: PathBuf,
    /// `[west, south, east, north]`.
    pub bbox: Option<Vec<f64>>,
    /// Use the Overpass files in this directory instead of querying.
    pub osm_input_dir: Option<PathBuf>,
    pub overpass_lz4: String,
    pub overpass_z: String,
    pub skimap_url: String,
    /// Further attempts after a failure.
    pub retries: u32,
    pub retry_wait: Duration,
    pub timeout: Duration,
}

impl DownloadConfig {
    pub fn new(dir: PathBuf, bbox: Option<Vec<f64>>, osm_input_dir: Option<PathBuf>) -> Self {
        DownloadConfig {
            dir,
            bbox,
            osm_input_dir,
            overpass_lz4: OVERPASS_LZ4.into(),
            overpass_z: OVERPASS_Z.into(),
            skimap_url: SKIMAP_URL.into(),
            retries: 10,
            retry_wait: Duration::from_secs(60),
            timeout: Duration::from_secs(30 * 60),
        }
    }
}

// ---------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------

/// `overpassBBoxQuery`: the `[bbox:south,west,north,east]` setting, longitudes wrapped.
pub fn bbox_setting(bbox: Option<&[f64]>) -> Result<String> {
    let Some(bbox) = bbox else {
        return Ok(String::new());
    };
    if bbox.len() != 4 {
        bail!("Only 2d boxes are supported");
    }
    let number = js_number_to_string;
    Ok(format!(
        "[bbox:{},{},{},{}]",
        number(bbox[1]),
        number(normalize_longitude(bbox[0])),
        number(bbox[3]),
        number(normalize_longitude(bbox[2]))
    ))
}

/// `((longitude + 180) % 360) - 180`, JavaScript's remainder (the sign of the dividend), which
/// is also what `%` is on `f64` here: -190 stays -190.
fn normalize_longitude(longitude: f64) -> f64 {
    ((longitude + 180.0) % 360.0) - 180.0
}

const LIFECYCLE_SITE_STATES: [&str; 5] = [
    "disused",
    "abandoned",
    "proposed",
    "planned",
    "construction",
];

fn ski_area_site_relations_query() -> String {
    let mut filters = vec!["rel[site=piste]".to_owned()];
    filters.extend(
        LIFECYCLE_SITE_STATES
            .iter()
            .map(|state| format!("rel[\"{state}:site\"=piste]")),
    );
    format!("(\n    {};\n  );", filters.join(";\n    "))
}

pub fn runs_query(bbox: Option<&[f64]>) -> Result<String> {
    Ok(format!(
        r#"
    [out:json][timeout:1800]{};
    wr["piste:type"];
    (._; >;);
    out;
    "#,
        bbox_setting(bbox)?
    ))
}

pub fn lifts_query(bbox: Option<&[f64]>) -> Result<String> {
    Ok(format!(
        r#"
    [out:json][timeout:1800]{};
    {}
    >>;
    way(r)[railway]->.siterailways;
    ((
      way[aerialway];
      way["disused:aerialway"];
      way["abandoned:aerialway"];
      way["proposed:aerialway"];
      way["planned:aerialway"];
      way["construction:aerialway"];
      way[railway=funicular];
      .siterailways;
    ); >;);
    out;
    "#,
        bbox_setting(bbox)?,
        ski_area_site_relations_query()
    ))
}

pub fn ski_areas_query(bbox: Option<&[f64]>) -> Result<String> {
    Ok(format!(
        r#"
    [out:json][timeout:1800]{};
    (
      wr[landuse=winter_sports];
      wr["disused:landuse"=winter_sports];
      wr["abandoned:landuse"=winter_sports];
      wr["proposed:landuse"=winter_sports];
      wr["planned:landuse"=winter_sports];
      wr["construction:landuse"=winter_sports];
    );
    (._; >;);
    out;
    "#,
        bbox_setting(bbox)?
    ))
}

pub fn ski_area_sites_query(bbox: Option<&[f64]>) -> Result<String> {
    Ok(format!(
        r#"
  [out:json][timeout:1800]{};
  {}
  out;
  "#,
        bbox_setting(bbox)?,
        ski_area_site_relations_query()
    ))
}

pub fn spots_query(bbox: Option<&[f64]>) -> Result<String> {
    Ok(format!(
        r#"
    [out:json][timeout:1800]{};
    (
      node["piste:dismount"];
      nw[aerialway=station];
      nw[amenity=avalanche_transceiver][avalanche_transceiver=training];
      nw[amenity=avalanche_transceiver][avalanche_transceiver=checkpoint];
      nw["man_made"="piste:halfpipe"];
    );
    (._; >;);
    out;
    "#,
        bbox_setting(bbox)?
    ))
}

/// `encodeURIComponent`: everything but letters, digits and `-_.!~*'()` is percent-encoded
/// (as UTF-8).
pub fn encode_uri_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn overpass_url(endpoint: &str, query: &str) -> String {
    format!("{endpoint}?data={}", encode_uri_component(query))
}

// ---------------------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------------------

fn client(timeout: Duration) -> Result<reqwest::blocking::Client> {
    Ok(reqwest::blocking::Client::builder()
        .timeout(timeout)
        .user_agent("openskidata-processor (+https://openskimap.org)")
        .default_headers(
            [(
                reqwest::header::REFERER,
                reqwest::header::HeaderValue::from_static("https://openskimap.org"),
            )]
            .into_iter()
            .collect(),
        )
        .build()?)
}

fn download_once(client: &reqwest::blocking::Client, url: &str, target: &Path) -> Result<()> {
    let mut response = client.get(url).send()?;
    if !response.status().is_success() {
        bail!(
            "Failed downloading file at URL (status: {}): {url}",
            response.status().as_u16()
        );
    }
    let partial = target.with_extension("part");
    let mut file = std::fs::File::create(&partial)
        .with_context(|| format!("creating {}", partial.display()))?;
    response.copy_to(&mut file)?;
    drop(file);
    std::fs::rename(&partial, target)?;
    Ok(())
}

fn download_to_file(config: &DownloadConfig, url: &str, target: &Path) -> Result<()> {
    let client = client(config.timeout)?;
    let mut remaining = config.retries;
    loop {
        match download_once(&client, url, target) {
            Ok(()) => return Ok(()),
            Err(error) if remaining == 0 => return Err(error),
            Err(error) => {
                tracing::warn!(
                    "Download failed due to {error:#}. Will wait {:?} and try again.",
                    config.retry_wait
                );
                std::thread::sleep(config.retry_wait);
                remaining -= 1;
            }
        }
    }
}

fn download_overpass(
    config: &DownloadConfig,
    endpoint: &str,
    query: Result<String>,
    file: &str,
) -> Result<()> {
    let query = query?;
    tracing::info!("Performing overpass query...{query}");
    download_to_file(
        config,
        &overpass_url(endpoint, &query),
        &config.dir.join(file),
    )
}

/// Whether the point lies strictly inside the box: turf's `booleanContains(bboxPolygon(bbox),
/// point)`, where a point on the boundary is not contained. A box whose west edge is east of
/// its east edge still spans the same rectangle.
pub fn point_strictly_inside(bbox: &[f64], point: [f64; 2]) -> bool {
    let (west, east) = (bbox[0].min(bbox[2]), bbox[0].max(bbox[2]));
    let (south, north) = (bbox[1].min(bbox[3]), bbox[1].max(bbox[3]));
    west < point[0] && point[0] < east && south < point[1] && point[1] < north
}

/// Keeps the features strictly inside the box, and writes the file back.
fn filter_skimap_to_bbox(path: &Path, bbox: &[f64]) -> Result<()> {
    if bbox.len() != 4 {
        bail!("Only 2d boxes are supported");
    }
    let mut document: Value = serde_json::from_reader(std::io::BufReader::new(
        std::fs::File::open(path).with_context(|| format!("opening {}", path.display()))?,
    ))?;
    if let Some(features) = document.get_mut("features").and_then(Value::as_array_mut) {
        features.retain(|feature| {
            let coordinates = &feature["geometry"]["coordinates"];
            feature["geometry"]["type"] == "Point"
                && match (coordinates[0].as_f64(), coordinates[1].as_f64()) {
                    (Some(x), Some(y)) => point_strictly_inside(bbox, [x, y]),
                    _ => false,
                }
        });
    }
    std::fs::write(path, serde_json::to_vec(&document)?)?;
    Ok(())
}

fn download_skimap(config: &DownloadConfig) -> Result<()> {
    let target = config.dir.join(SKIMAP);
    download_to_file(config, &config.skimap_url, &target)?;
    if let Some(bbox) = &config.bbox {
        // For consistency with the OSM data (which has the box applied by Overpass).
        filter_skimap_to_bbox(&target, bbox)?;
    }
    Ok(())
}

fn copy_osm_files(source: &Path, dir: &Path) -> Result<()> {
    for file in OSM_FILES {
        let from = source.join(file);
        tracing::info!("Using {} instead of querying Overpass", from.display());
        std::fs::copy(&from, dir.join(file))
            .with_context(|| format!("copying {}", from.display()))?;
    }
    Ok(())
}

const OSM_FILES: [&str; 5] = [RUNS, LIFTS, SKI_AREAS, SKI_AREA_SITES, SPOTS];

// ---------------------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------------------

/// `timestamp_osm_base` from the header of an Overpass JSON file, which is at the very start of
/// a document that can be gigabytes long, so only the first 4 KiB are read.
pub fn read_osm_data_timestamp(path: &Path) -> Option<String> {
    let mut head = vec![0u8; 4096];
    let read = match std::fs::File::open(path).and_then(|mut f| f.read(&mut head)) {
        Ok(read) => read,
        Err(error) => {
            tracing::info!(
                "Could not read OSM data timestamp from {}: {error}",
                path.display()
            );
            return None;
        }
    };
    let head = String::from_utf8_lossy(&head[..read]);
    let after_key = &head[head.find("\"timestamp_osm_base\"")? + "\"timestamp_osm_base\"".len()..];
    let after_colon = after_key.trim_start().strip_prefix(':')?.trim_start();
    let value = after_colon.strip_prefix('"')?;
    Some(value[..value.find('"')?].to_owned())
}

/// The earliest of the timestamps, as `Date.prototype.toISOString` writes it; ones that do not
/// parse are ignored.
pub fn earliest_timestamp(timestamps: &[Option<String>]) -> Option<String> {
    timestamps
        .iter()
        .flatten()
        .filter_map(|text| OffsetDateTime::parse(text, &Rfc3339).ok())
        .map(unix_millis)
        .min()
        .map(to_iso_string)
}

fn now_iso() -> String {
    to_iso_string(unix_millis(OffsetDateTime::now_utc()))
}

/// `JSON.stringify(metadata, null, 2) + "\n"`.
pub fn download_metadata_json(
    started_at: &str,
    data_timestamp: Option<&str>,
    skimap_downloaded_at: &str,
) -> String {
    // Written by hand: keys must stay in this order, which `serde_json` would sort.
    let string = |text: &str| serde_json::to_string(text).expect("a string");
    let data_timestamp = data_timestamp.map_or("null".to_owned(), string);
    format!(
        "{{\n  \"startedAt\": {},\n  \"openStreetMap\": {{\n    \"dataTimestamp\": {data_timestamp}\n  }},\n  \"skiMapOrg\": {{\n    \"downloadedAt\": {}\n  }}\n}}\n",
        string(started_at),
        string(skimap_downloaded_at)
    )
}

// ---------------------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------------------

pub fn download(config: &DownloadConfig) -> Result<()> {
    std::fs::create_dir_all(&config.dir)?;
    let started_at = now_iso();
    let bbox = config.bbox.as_deref();

    let skimap_downloaded_at = std::thread::scope(|scope| -> Result<String> {
        let skimap = scope.spawn(|| -> Result<String> {
            download_skimap(config)?;
            Ok(now_iso())
        });
        match &config.osm_input_dir {
            Some(source) => copy_osm_files(source, &config.dir)?,
            None => {
                // One endpoint is never asked twice at once, so as not to be rate limited.
                let runs = scope.spawn(|| {
                    download_overpass(config, &config.overpass_z, runs_query(bbox), RUNS)
                });
                let others = scope.spawn(|| -> Result<()> {
                    let lz4 = &config.overpass_lz4;
                    download_overpass(config, lz4, lifts_query(bbox), LIFTS)?;
                    download_overpass(config, lz4, ski_areas_query(bbox), SKI_AREAS)?;
                    download_overpass(config, lz4, ski_area_sites_query(bbox), SKI_AREA_SITES)?;
                    download_overpass(config, lz4, spots_query(bbox), SPOTS)
                });
                runs.join()
                    .map_err(|_| anyhow!("download thread panicked"))??;
                others
                    .join()
                    .map_err(|_| anyhow!("download thread panicked"))??;
            }
        }
        skimap
            .join()
            .map_err(|_| anyhow!("download thread panicked"))?
    })?;

    // Provenance is not worth failing the run over.
    let timestamps: Vec<Option<String>> = OSM_FILES
        .iter()
        .map(|file| read_osm_data_timestamp(&config.dir.join(file)))
        .collect();
    let metadata = download_metadata_json(
        &started_at,
        earliest_timestamp(&timestamps).as_deref(),
        &skimap_downloaded_at,
    );
    if let Err(error) = std::fs::write(config.dir.join(DOWNLOAD_METADATA_FILE), metadata) {
        tracing::warn!("Failed recording download metadata: {error}");
    }
    Ok(())
}
