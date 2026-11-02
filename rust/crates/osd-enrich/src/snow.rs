//! Snow cover history from the weekly VIIRS data in the cache.
//!
//! Replaces `src/utils/snowCoverHistory.ts`. Checked against the real functions
//! (`rust/codegen/generate-snow-vectors.mjs`) on random weekly data and cache contents,
//! including the malformed entries upstream tolerates.
//!
//! The cache holds, per 375 m pixel, `snow_cover:<tile>:<row>:<col>` -> a JSON array of
//! `{year, data: [[snowCover, cloudPersistence], ...]}` with one pair per week of the year. A
//! measurement of week `w` with cloud persistence `c` is the snow cover `c` days before the
//! start of that week, which can be in the previous year. The history of a set of pixels is, for
//! every year and day with a measurement, the rounded mean of the pixels that have one and the
//! percentage of the pixels that do.
//!
//! # Details kept
//!
//! - Pixels are looked up grouped by tile, tiles in the order first seen: the order pixels are
//!   averaged in is observable only through floating point, but a pixel listed twice counts
//!   once in the sums and twice in the percentage's denominator, as upstream's does.
//! - Values outside `0..=100` (301 and 400 are the missing data codes) and negative cloud
//!   persistence are skipped; of two measurements for the same day, the one with the lower
//!   cloud persistence wins, the first on a tie.
//! - Calendar arithmetic only (no time zone), as date-fns does it.

use openskidata_format::SkiAreaActivity;
use openskidata_format::ski_area::{SkiAreaSnowCoverStatistics, activity_key};
use openskidata_format::snow_cover::{SnowCoverDay, SnowCoverHistory, SnowCoverYear};
use osd_cache::{CacheKind, CacheStore};
use osd_tags::js_number;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use time::{Date, Duration, Month};

use crate::viirs::ViirsPixel;

/// One year of a pixel's cached data.
#[derive(Debug, Clone, PartialEq)]
pub struct YearData {
    pub year: f64,
    /// `[snowCover, cloudPersistence]` for each week, week 1 first.
    pub weeks: Vec<(f64, f64)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PixelData {
    pub tile_id: String,
    pub row: i64,
    pub col: i64,
    pub data: Vec<YearData>,
}

/// `weekToDayAndYear`: the year and day of year `cloud_persistence` days before the start of
/// 1-indexed `week` of `base_year`.
pub fn week_to_day_and_year(
    week: i64,
    cloud_persistence: f64,
    base_year: f64,
) -> Option<(i32, u16)> {
    if !(1..=53).contains(&week) || !(0.0..=365.0).contains(&cloud_persistence) {
        return None;
    }
    let year_start = Date::from_calendar_date(base_year.trunc() as i32, Month::January, 1).ok()?;
    // addWeeks: whole days.
    let week_start = year_start.checked_add(Duration::days((week - 1) * 7))?;
    // subDays is `date.setDate(date.getDate() - cloudPersistence)`, and setDate truncates the
    // *sum* to an integer (towards zero), so a fractional cloud persistence rounds the other way
    // from truncating it first: day 30 less 22.1 is day 7, not 8.
    let day_of_month = (f64::from(week_start.day()) - cloud_persistence).trunc() as i64;
    let first_of_month = Date::from_calendar_date(week_start.year(), week_start.month(), 1).ok()?;
    let date = first_of_month.checked_add(Duration::days(day_of_month - 1))?;
    Some((date.year(), date.ordinal()))
}

/// `isValidSnowCover`: 301 and 400 are the missing data codes.
pub fn is_valid_snow_cover(snow_cover: f64) -> bool {
    (0.0..=100.0).contains(&snow_cover)
}

/// One pixel's measurements as `(year, [(day, snowCover)])`, years and days ascending
/// (`convertPixelDataToHistory`, whose "100% valid" third element is added when aggregating).
pub fn convert_pixel_data_to_history(pixel: &PixelData) -> Vec<(i32, Vec<(u16, f64)>)> {
    // year -> day -> (snow cover, cloud persistence)
    let mut by_year: BTreeMap<i32, BTreeMap<u16, (f64, f64)>> = BTreeMap::new();
    for year_data in &pixel.data {
        for (index, &(snow_cover, cloud)) in year_data.weeks.iter().enumerate() {
            if !is_valid_snow_cover(snow_cover) || cloud < 0.0 {
                continue;
            }
            let Some((year, day)) = week_to_day_and_year(index as i64 + 1, cloud, year_data.year)
            else {
                continue;
            };
            let days = by_year.entry(year).or_default();
            match days.get(&day) {
                // Keep the one with less cloud persistence.
                Some(&(_, existing)) if cloud >= existing => {}
                _ => {
                    days.insert(day, (snow_cover, cloud));
                }
            }
        }
    }
    by_year
        .into_iter()
        .map(|(year, days)| {
            (
                year,
                days.into_iter()
                    .map(|(day, (snow, _))| (day, snow))
                    .collect(),
            )
        })
        .filter(|(_, days): &(i32, Vec<(u16, f64)>)| !days.is_empty())
        .collect()
}

/// `aggregatePixelHistories`.
pub fn aggregate_pixel_histories(pixels: &[PixelData]) -> SnowCoverHistory {
    let valid: Vec<&PixelData> = pixels.iter().filter(|p| !p.data.is_empty()).collect();
    if valid.is_empty() {
        return Vec::new();
    }

    struct Measurement {
        year: i32,
        day: u16,
        values: Vec<f64>,
        pixel_ids: HashSet<(String, i64, i64)>,
    }
    // Insertion-ordered: the order the values are averaged in follows the pixels'.
    let mut measurements: Vec<Measurement> = Vec::new();
    let mut index: HashMap<(i32, u16), usize> = HashMap::new();

    for pixel in &valid {
        let pixel_id = (pixel.tile_id.clone(), pixel.row, pixel.col);
        for (year, days) in convert_pixel_data_to_history(pixel) {
            for (day, snow_cover) in days {
                if !(1..=366).contains(&day) || !(0.0..=100.0).contains(&snow_cover) {
                    continue;
                }
                let slot = *index.entry((year, day)).or_insert_with(|| {
                    measurements.push(Measurement {
                        year,
                        day,
                        values: Vec::new(),
                        pixel_ids: HashSet::new(),
                    });
                    measurements.len() - 1
                });
                let measurement = &mut measurements[slot];
                if !measurement.pixel_ids.insert(pixel_id.clone()) {
                    continue; // this pixel was already counted for the day
                }
                measurement.values.push(snow_cover);
            }
        }
    }
    if measurements.is_empty() {
        return Vec::new();
    }

    let total = valid.len() as f64;
    let mut years: BTreeMap<i32, Vec<SnowCoverDay>> = BTreeMap::new();
    for measurement in &measurements {
        if measurement.values.is_empty() {
            continue;
        }
        let sum: f64 = measurement.values.iter().sum();
        let average = js_number::round(sum / measurement.values.len() as f64);
        let valid_percentage = js_number::round((measurement.values.len() as f64 / total) * 100.0);
        years.entry(measurement.year).or_default().push((
            measurement.day,
            average as i16,
            valid_percentage as u8,
        ));
    }

    years
        .into_iter()
        .filter_map(|(year, mut days)| {
            days.sort_by_key(|d| d.0);
            ((1900..=2100).contains(&year) && !days.is_empty())
                .then_some(SnowCoverYear { year, days })
        })
        .collect()
}

/// `parsePixelCacheData`: the valid years of one cached value, or `None` if there are none.
pub fn parse_pixel_cache_data(value: &Value) -> Option<Vec<YearData>> {
    let years = value.as_array()?;
    let valid: Vec<YearData> = years
        .iter()
        .filter_map(|entry| {
            let year = entry.get("year")?.as_f64()?;
            if !(1900.0..=2100.0).contains(&year) {
                return None;
            }
            let weeks = entry.get("data")?.as_array()?;
            let parsed: Option<Vec<(f64, f64)>> = weeks
                .iter()
                .map(|week| {
                    let week = week.as_array()?;
                    (week.len() >= 2)
                        .then(|| Some((week[0].as_f64()?, week[1].as_f64()?)))
                        .flatten()
                })
                .collect();
            Some(YearData {
                year,
                weeks: parsed?,
            })
        })
        .collect();
    (!valid.is_empty()).then_some(valid)
}

/// The cache key of a pixel.
pub fn pixel_cache_key(tile_id: &str, row: i64, col: i64) -> String {
    format!("snow_cover:{tile_id}:{row}:{col}")
}

/// `isValidPixelReference`.
fn is_valid_pixel_reference(tile_id: &str, row: i64, col: i64) -> bool {
    let bytes = tile_id.as_bytes();
    (0..3000).contains(&row)
        && (0..3000).contains(&col)
        && bytes.len() == 6
        && bytes[0] == b'h'
        && bytes[3] == b'v'
        && bytes[1..3]
            .iter()
            .chain(&bytes[4..6])
            .all(u8::is_ascii_digit)
}

/// The tile a pixel belongs to: `h12v04`.
pub fn tile_id(h_tile: u32, v_tile: u32) -> String {
    format!("h{h_tile:02}v{v_tile:02}")
}

/// `getSnowCoverHistory`: the history across the pixels, from the cache.
pub fn snow_cover_history(
    cache: &CacheStore,
    pixels: &[ViirsPixel],
) -> anyhow::Result<SnowCoverHistory> {
    // Grouped by tile, tiles in the order first seen.
    let mut tile_order: Vec<String> = Vec::new();
    let mut by_tile: HashMap<String, Vec<(i64, i64)>> = HashMap::new();
    for &[h, v, col, row] in pixels {
        let tile = tile_id(h, v);
        by_tile
            .entry(tile.clone())
            .or_insert_with(|| {
                tile_order.push(tile.clone());
                Vec::new()
            })
            .push((i64::from(row), i64::from(col)));
    }
    let requests: Vec<(String, i64, i64)> = tile_order
        .iter()
        .flat_map(|tile| {
            by_tile[tile]
                .iter()
                .map(move |&(row, col)| (tile.clone(), row, col))
        })
        .filter(|(tile, row, col)| is_valid_pixel_reference(tile, *row, *col))
        .collect();

    let keys: Vec<String> = requests
        .iter()
        .map(|(tile, row, col)| pixel_cache_key(tile, *row, *col))
        .collect();
    // No expiry: the archive is the data.
    let values = cache.get_json_many(CacheKind::SnowCover, &keys, 0, 0)?;

    let mut pixels_data = Vec::new();
    for ((tile, row, col), value) in requests.into_iter().zip(values) {
        let Some(text) = value else { continue };
        let Ok(parsed) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        if let Some(data) = parse_pixel_cache_data(&parsed) {
            pixels_data.push(PixelData {
                tile_id: tile,
                row,
                col,
                data,
            });
        }
    }
    Ok(aggregate_pixel_histories(&pixels_data))
}

/// Where snow cover histories come from.
pub trait SnowCoverSource: Sync {
    /// The history across the pixels (`getSnowCoverHistoryFromCache`).
    fn history(&self, pixels: &[ViirsPixel]) -> anyhow::Result<SnowCoverHistory>;
}

/// The snow cover archive in the cache store.
pub struct CachedSnowCover<'a> {
    pub cache: &'a CacheStore,
}

impl SnowCoverSource for CachedSnowCover<'_> {
    fn history(&self, pixels: &[ViirsPixel]) -> anyhow::Result<SnowCoverHistory> {
        snow_cover_history(self.cache, pixels)
    }
}

/// A run, as the ski area statistics see it.
pub struct SnowRun<'a> {
    pub pixels: &'a [ViirsPixel],
    pub activities: &'a [SkiAreaActivity],
}

/// The pixels of the runs, each once, in the order first seen.
fn unique_pixels<'a>(runs: impl Iterator<Item = &'a SnowRun<'a>>) -> Vec<ViirsPixel> {
    let mut seen = HashSet::new();
    runs.flat_map(|run| run.pixels.iter().copied())
        .filter(|pixel| seen.insert(*pixel))
        .collect()
}

/// `generateSnowCoverStatistics`: the history over all the runs' pixels, and over those of the
/// runs of each activity (a run without a ski area activity is under `other`). `None` for no
/// runs, or if the archive cannot be read.
pub fn ski_area_snow_cover(
    runs: &[SnowRun<'_>],
    source: &dyn SnowCoverSource,
) -> Option<SkiAreaSnowCoverStatistics> {
    if runs.is_empty() {
        return None;
    }
    let result = (|| -> anyhow::Result<SkiAreaSnowCoverStatistics> {
        let overall = source.history(&unique_pixels(runs.iter()))?;

        let mut by_activity = BTreeMap::new();
        let mut groups: Vec<(String, Vec<&SnowRun<'_>>)> = vec![
            ("other".to_owned(), Vec::new()),
            (activity_key(SkiAreaActivity::Downhill), Vec::new()),
            (activity_key(SkiAreaActivity::Nordic), Vec::new()),
        ];
        for run in runs {
            let in_ski_area_activity = |a: SkiAreaActivity| run.activities.contains(&a);
            let (downhill, nordic) = (
                in_ski_area_activity(SkiAreaActivity::Downhill),
                in_ski_area_activity(SkiAreaActivity::Nordic),
            );
            if !downhill && !nordic {
                groups[0].1.push(run);
            }
            if downhill {
                groups[1].1.push(run);
            }
            if nordic {
                groups[2].1.push(run);
            }
        }
        for (key, group) in groups {
            if group.is_empty() {
                continue;
            }
            let history = source.history(&unique_pixels(group.into_iter()))?;
            if !history.is_empty() {
                by_activity.insert(key, history);
            }
        }
        Ok(SkiAreaSnowCoverStatistics {
            overall,
            by_activity,
        })
    })();
    match result {
        Ok(statistics) => Some(statistics),
        Err(error) => {
            tracing::error!("Failed to generate snow cover statistics: {error}");
            None
        }
    }
}
