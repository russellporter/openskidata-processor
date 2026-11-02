//! `metadata.json`.
//!
//! Replaces `src/statistics/DatasetMetadata.ts` and `src/io/DownloadMetadata.ts`'s reader.
//!
//! The counts are folded in while the output is written, as upstream does during its CSV
//! pass, so they cost no pass over the data of their own.
//!
//! # Inputs that are not the collector's to compute
//!
//! A run's or lift's contribution to `totals` is its inclined length, which upstream gets
//! from `getRunElevationData` / `getLiftElevationData`. That needs elevation, which is not
//! ported, so the caller passes it in; `None` counts as zero, exactly as upstream treats a
//! feature without an elevation profile.
//!
//! # Where this is stricter or looser than upstream
//!
//! - `startedAt` is parsed as RFC 3339 (what the download step writes). JavaScript's `Date`
//!   also accepts other spellings; a string only it would accept gives a `null` duration here.
//! - An unreadable or malformed download-metadata file gives no provenance (`null`s). Upstream
//!   accepts any JSON object and then fails on a missing `openStreetMap` key.

use osd_tags::js_number;
use serde::{Deserialize, Serialize, Serializer};
use std::collections::BTreeSet;
use std::path::Path;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use openskidata_format::{SkiAreaActivity, Status};

/// Schema version of `metadata.json`. Bump on any breaking change.
pub const METADATA_VERSION: u32 = 1;

/// A number as `JSON.stringify` prints it: whole values without a fractional part.
fn js_f64<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    if value.is_finite() && value.fract() == 0.0 && value.abs() < 1e15 {
        serializer.serialize_i64(*value as i64)
    } else {
        serializer.serialize_f64(*value)
    }
}

fn js_bbox<S: Serializer>(value: &Option<Vec<f64>>, serializer: S) -> Result<S::Ok, S::Error> {
    #[derive(Serialize)]
    struct N(#[serde(serialize_with = "js_f64")] f64);
    match value {
        None => serializer.serialize_none(),
        Some(numbers) => serializer.collect_seq(numbers.iter().copied().map(N)),
    }
}

/// An object whose keys keep the order they were inserted in.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Sizes(pub Vec<(String, u64)>);

impl Serialize for Sizes {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_map(self.0.iter().map(|(k, v)| (k, v)))
    }
}

/// Uncompressed sizes of the published files. A file that could not be read is omitted rather
/// than reported as zero, so consumers can tell unknown from empty.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct FileSizes {
    pub geojson: Sizes,
    pub csv: Sizes,
    #[serde(rename = "geoPackage")]
    pub geo_package: Option<u64>,
}

fn size_of(path: &Path) -> Option<u64> {
    match std::fs::metadata(path) {
        Ok(metadata) => Some(metadata.len()),
        Err(error) => {
            tracing::warn!("could not read size of {}: {error}", path.display());
            None
        }
    }
}

/// Never fails: a missing size is not worth failing a multi-hour run over.
pub fn collect_file_sizes(
    geojson: &[(&str, &Path)],
    csv: &[(&str, &Path)],
    geo_package: &Path,
) -> FileSizes {
    let sizes = |files: &[(&str, &Path)]| {
        Sizes(
            files
                .iter()
                .filter_map(|(key, path)| Some(((*key).to_owned(), size_of(path)?)))
                .collect(),
        )
    };
    FileSizes {
        geojson: sizes(geojson),
        csv: sizes(csv),
        geo_package: size_of(geo_package),
    }
}

// ---------------------------------------------------------------------------------------
// Download provenance
// ---------------------------------------------------------------------------------------

/// What the download step recorded about where the input came from.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct DownloadMetadata {
    #[serde(rename = "startedAt")]
    pub started_at: String,
    #[serde(rename = "openStreetMap")]
    pub open_street_map: OpenStreetMapProvenance,
    #[serde(rename = "skiMapOrg")]
    pub ski_map_org: SkiMapOrgProvenance,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct OpenStreetMapProvenance {
    #[serde(rename = "dataTimestamp")]
    pub data_timestamp: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SkiMapOrgProvenance {
    #[serde(rename = "downloadedAt")]
    pub downloaded_at: String,
}

pub const DOWNLOAD_METADATA_FILE: &str = "input_download_metadata.json";

/// Reads the download step's provenance, or `None` when it is missing or unreadable.
pub fn read_download_metadata(folder: &Path) -> Option<DownloadMetadata> {
    let path = folder.join(DOWNLOAD_METADATA_FILE);
    let contents = match std::fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) => {
            tracing::info!("could not read download metadata: {error}");
            return None;
        }
    };
    match serde_json::from_str(&contents) {
        Ok(metadata) => Some(metadata),
        Err(error) => {
            tracing::info!("could not parse {}: {error}", path.display());
            None
        }
    }
}

// ---------------------------------------------------------------------------------------
// The collector
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct DatasetMetadata {
    pub version: u32,
    #[serde(rename = "formatVersion")]
    pub format_version: String,
    #[serde(serialize_with = "js_bbox")]
    pub bbox: Option<Vec<f64>>,
    pub source: Source,
    pub run: RunInfo,
    pub counts: Counts,
    pub files: FileSizes,
    pub totals: Totals,
}

#[derive(Debug, Clone, Serialize)]
pub struct Source {
    #[serde(rename = "openStreetMap")]
    pub open_street_map: OpenStreetMapSource,
    #[serde(rename = "skiMapOrg")]
    pub ski_map_org: SkiMapOrgSource,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpenStreetMapSource {
    #[serde(rename = "dataTimestamp")]
    pub data_timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkiMapOrgSource {
    #[serde(rename = "downloadedAt")]
    pub downloaded_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunInfo {
    #[serde(rename = "startedAt")]
    pub started_at: Option<String>,
    #[serde(rename = "finishedAt")]
    pub finished_at: String,
    #[serde(rename = "durationSeconds")]
    pub duration_seconds: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Counts {
    #[serde(rename = "skiAreas")]
    pub ski_areas: SkiAreaCounts,
    pub runs: u64,
    pub lifts: u64,
    pub spots: u64,
}

/// Ski areas offering each activity do not partition `total`: a ski area may offer both
/// activities, or neither.
#[derive(Debug, Clone, Serialize)]
pub struct SkiAreaCounts {
    pub total: u64,
    pub operating: u64,
    pub downhill: u64,
    pub nordic: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Totals {
    #[serde(rename = "runLengthKm", serialize_with = "js_f64")]
    pub run_length_km: f64,
    #[serde(rename = "liftLengthKm", serialize_with = "js_f64")]
    pub lift_length_km: f64,
    pub countries: u64,
}

/// What `metadata()` is told besides the counts.
#[derive(Debug, Clone, Default)]
pub struct MetadataOptions {
    pub format_version: String,
    /// The bounding box the run was restricted to, or `None` for a worldwide run.
    pub bbox: Option<Vec<f64>>,
    pub started_at: Option<String>,
    pub open_street_map_data_timestamp: Option<String>,
    pub ski_map_org_downloaded_at: Option<String>,
    pub files: FileSizes,
}

/// Tallies dataset-wide figures as features are written.
#[derive(Debug, Default)]
pub struct MetadataCollector {
    ski_areas: u64,
    operating_ski_areas: u64,
    downhill_ski_areas: u64,
    nordic_ski_areas: u64,
    runs: u64,
    lifts: u64,
    spots: u64,
    run_length_in_meters: f64,
    lift_length_in_meters: f64,
    countries: BTreeSet<String>,
}

impl MetadataCollector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_ski_area<'a>(
        &mut self,
        status: Option<Status>,
        activities: &[SkiAreaActivity],
        countries: impl IntoIterator<Item = &'a str>,
    ) {
        self.ski_areas += 1;
        if status == Some(Status::Operating) {
            self.operating_ski_areas += 1;
        }
        if activities.contains(&SkiAreaActivity::Downhill) {
            self.downhill_ski_areas += 1;
        }
        if activities.contains(&SkiAreaActivity::Nordic) {
            self.nordic_ski_areas += 1;
        }
        self.countries
            .extend(countries.into_iter().map(str::to_owned));
    }

    /// `inclined_length_m` is the run's inclined length from its elevation profile, if any.
    pub fn add_run(&mut self, inclined_length_m: Option<f64>) {
        self.runs += 1;
        self.run_length_in_meters += inclined_length_m.unwrap_or(0.0);
    }

    pub fn add_lift(&mut self, inclined_length_m: Option<f64>) {
        self.lifts += 1;
        self.lift_length_in_meters += inclined_length_m.unwrap_or(0.0);
    }

    pub fn add_spot(&mut self) {
        self.spots += 1;
    }

    /// The metadata as of `finished_at`.
    pub fn metadata(
        &self,
        options: MetadataOptions,
        finished_at: OffsetDateTime,
    ) -> DatasetMetadata {
        let finished_ms = unix_millis(finished_at);
        let duration_seconds = options
            .started_at
            .as_deref()
            .and_then(|s| OffsetDateTime::parse(s, &Rfc3339).ok())
            .map(|started| {
                js_number::round((finished_ms - unix_millis(started)) as f64 / 1000.0) as i64
            });

        DatasetMetadata {
            version: METADATA_VERSION,
            format_version: options.format_version,
            bbox: options.bbox,
            source: Source {
                open_street_map: OpenStreetMapSource {
                    data_timestamp: options.open_street_map_data_timestamp,
                },
                ski_map_org: SkiMapOrgSource {
                    downloaded_at: options.ski_map_org_downloaded_at,
                },
            },
            run: RunInfo {
                started_at: options.started_at,
                finished_at: to_iso_string(finished_ms),
                duration_seconds,
            },
            counts: Counts {
                ski_areas: SkiAreaCounts {
                    total: self.ski_areas,
                    operating: self.operating_ski_areas,
                    downhill: self.downhill_ski_areas,
                    nordic: self.nordic_ski_areas,
                },
                runs: self.runs,
                lifts: self.lifts,
                spots: self.spots,
            },
            files: options.files,
            totals: Totals {
                run_length_km: round(self.run_length_in_meters / 1000.0, 1),
                lift_length_km: round(self.lift_length_in_meters / 1000.0, 1),
                countries: self.countries.len() as u64,
            },
        }
    }
}

/// `Math.round(value * 10^decimals) / 10^decimals`.
fn round(value: f64, decimals: i32) -> f64 {
    let factor = 10f64.powi(decimals);
    js_number::round(value * factor) / factor
}

/// `Date.prototype.getTime`: milliseconds since the epoch, sub-millisecond digits dropped.
fn unix_millis(at: OffsetDateTime) -> i64 {
    at.unix_timestamp_nanos().div_euclid(1_000_000) as i64
}

/// `Date.prototype.toISOString`: `YYYY-MM-DDTHH:mm:ss.sssZ` in UTC.
fn to_iso_string(millis: i64) -> String {
    let at = OffsetDateTime::from_unix_timestamp_nanos(i128::from(millis) * 1_000_000)
        .expect("a representable instant");
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        at.year(),
        u8::from(at.month()),
        at.day(),
        at.hour(),
        at.minute(),
        at.second(),
        at.millisecond()
    )
}

impl DatasetMetadata {
    /// The file's contents: indented two spaces, with a trailing newline, as upstream writes it.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).expect("serializes") + "\n"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_strings_have_millisecond_precision() {
        assert_eq!(to_iso_string(0), "1970-01-01T00:00:00.000Z");
        // Values taken from Node's `new Date(ms).toISOString()`.
        assert_eq!(to_iso_string(1_785_000_123_456), "2026-07-25T17:22:03.456Z");
        assert_eq!(to_iso_string(-1), "1969-12-31T23:59:59.999Z");
        assert_eq!(to_iso_string(951_782_400_999), "2000-02-29T00:00:00.999Z");
    }

    #[test]
    fn get_time_floors_sub_millisecond_digits_like_javascript() {
        // `new Date(s).getTime()` in Node: it floors, also before the epoch.
        for (text, millis) in [
            ("1969-12-31T23:59:59.9995Z", -1),
            ("1969-12-31T23:59:59.0005Z", -1000),
            ("2026-01-01T00:00:00.1239Z", 1_767_225_600_123),
            ("1970-01-01T00:00:00.0009Z", 0),
        ] {
            let parsed = OffsetDateTime::parse(text, &Rfc3339).unwrap();
            assert_eq!(unix_millis(parsed), millis, "{text}");
        }
    }

    #[test]
    fn rounding_matches_math_round() {
        assert_eq!(round(0.25, 1), 0.3);
        assert_eq!(round(12.0, 1), 12.0);
        assert_eq!(round(0.0, 1), 0.0);
    }
}
