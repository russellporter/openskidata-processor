//! The snow cover history against the real functions
//! (`rust/codegen/generate-snow-vectors.mjs`).

use openskidata_format::snow_cover::SnowCoverHistory;
use osd_cache::{CacheKind, CacheStore};
use osd_enrich::snow::{snow_cover_history, week_to_day_and_year};
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Deserialize)]
struct Vectors {
    weeks: Vec<WeekCase>,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct WeekCase {
    week: i64,
    cloud: f64,
    #[serde(rename = "baseYear")]
    base_year: f64,
    result: Option<WeekResult>,
}

#[derive(Deserialize)]
struct WeekResult {
    year: i32,
    #[serde(rename = "dayOfYear")]
    day_of_year: u16,
}

#[derive(Deserialize)]
struct Case {
    pixels: Vec<[u32; 4]>,
    cache: BTreeMap<String, Value>,
    expected: SnowCoverHistory,
}

fn vectors() -> Vectors {
    serde_json::from_str(include_str!("snow_vectors.json")).unwrap()
}

#[test]
fn weeks_become_days_of_the_right_year() {
    let (mut found, mut none) = (0, 0);
    for case in vectors().weeks {
        let got = week_to_day_and_year(case.week, case.cloud, case.base_year);
        match case.result {
            Some(want) => {
                found += 1;
                assert_eq!(
                    got,
                    Some((want.year, want.day_of_year)),
                    "{} {} {}",
                    case.week,
                    case.cloud,
                    case.base_year
                );
            }
            None => {
                none += 1;
                assert_eq!(got, None, "{} {} {}", case.week, case.cloud, case.base_year);
            }
        }
    }
    assert!(found > 300 && none > 50, "{found} {none}");
}

#[test]
fn every_recorded_history_is_reproduced() {
    let (mut non_empty, mut empty) = (0, 0);
    for (i, case) in vectors().cases.into_iter().enumerate() {
        let cache = CacheStore::open_in_memory().unwrap();
        let entries: Vec<(String, String)> = case
            .cache
            .iter()
            .map(|(k, v)| (k.clone(), v.to_string()))
            .collect();
        cache
            .set_json_many(CacheKind::SnowCover, &entries, 1)
            .unwrap();
        let got = snow_cover_history(&cache, &case.pixels).unwrap();
        assert_eq!(got, case.expected, "case {i}: {:?}", case.pixels);
        if got.is_empty() {
            empty += 1
        } else {
            non_empty += 1
        }
    }
    assert!(non_empty > 250 && empty > 20, "{non_empty} {empty}");
}
