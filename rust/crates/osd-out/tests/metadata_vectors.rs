//! `metadata.json` against the real TypeScript `MetadataCollector`
//! (`rust/codegen/generate-metadata-vectors.mjs`): 300 random datasets, with a fixed clock,
//! compared as the exact text of the file.

use openskidata_format::{SkiAreaActivity, Status};
use osd_out::metadata::{FileSizes, MetadataCollector, MetadataOptions, Sizes};
use serde::Deserialize;
use serde_json::Value;
use std::str::FromStr;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

#[derive(Deserialize)]
struct Vectors {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    #[serde(rename = "skiAreas")]
    ski_areas: Vec<SkiArea>,
    runs: Vec<Option<f64>>,
    lifts: Vec<Option<f64>>,
    spots: u64,
    options: Options,
    #[serde(rename = "finishedAt")]
    finished_at: String,
    expected: String,
}

#[derive(Deserialize)]
struct SkiArea {
    status: Option<String>,
    activities: Vec<String>,
    countries: Vec<String>,
}

#[derive(Deserialize)]
struct Options {
    #[serde(rename = "formatVersion")]
    format_version: String,
    bbox: Option<Vec<f64>>,
    #[serde(rename = "startedAt")]
    started_at: Option<String>,
    #[serde(rename = "openStreetMapDataTimestamp")]
    open_street_map_data_timestamp: Option<String>,
    #[serde(rename = "skiMapOrgDownloadedAt")]
    ski_map_org_downloaded_at: Option<String>,
    files: Files,
}

#[derive(Deserialize)]
struct Files {
    /// Keys in file order; missing ones are files that could not be read.
    geojson: serde_json::Map<String, Value>,
    csv: serde_json::Map<String, Value>,
    #[serde(rename = "geoPackage")]
    geo_package: Option<u64>,
}

/// The recorded objects list their keys in dataset order, which `serde_json::Map` (sorted)
/// does not keep, so the order is rebuilt; absent keys are files that could not be read.
fn sizes(map: &serde_json::Map<String, Value>) -> Sizes {
    Sizes(
        ["skiAreas", "runs", "lifts", "spots"]
            .into_iter()
            .filter_map(|key| Some((key.to_owned(), map.get(key)?.as_u64()?)))
            .collect(),
    )
}

#[test]
fn every_recorded_metadata_file_is_reproduced() {
    let vectors: Vectors = serde_json::from_str(include_str!("metadata_vectors.json")).unwrap();
    assert!(vectors.cases.len() >= 300);

    for (n, case) in vectors.cases.iter().enumerate() {
        let mut collector = MetadataCollector::new();
        for area in &case.ski_areas {
            let activities: Vec<SkiAreaActivity> = area
                .activities
                .iter()
                .map(|a| SkiAreaActivity::from_str(a).unwrap())
                .collect();
            collector.add_ski_area(
                area.status.as_deref().map(|s| Status::from_str(s).unwrap()),
                &activities,
                area.countries.iter().map(String::as_str),
            );
        }
        case.runs.iter().for_each(|l| collector.add_run(*l));
        case.lifts.iter().for_each(|l| collector.add_lift(*l));
        (0..case.spots).for_each(|_| collector.add_spot());

        let o = &case.options;
        let metadata = collector.metadata(
            MetadataOptions {
                format_version: o.format_version.clone(),
                bbox: o.bbox.clone(),
                started_at: o.started_at.clone(),
                open_street_map_data_timestamp: o.open_street_map_data_timestamp.clone(),
                ski_map_org_downloaded_at: o.ski_map_org_downloaded_at.clone(),
                files: FileSizes {
                    geojson: sizes(&o.files.geojson),
                    csv: sizes(&o.files.csv),
                    geo_package: o.files.geo_package,
                },
            },
            OffsetDateTime::parse(&case.finished_at, &Rfc3339).unwrap(),
        );
        let actual = metadata.to_json();
        assert!(
            actual == case.expected,
            "case {n}\n--- actual\n{actual}\n--- expected\n{}",
            case.expected
        );
    }
}
