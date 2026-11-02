//! Ski area statistics, replacing `src/statistics/SkiAreaStatistics.ts`.
//!
//! Elevation statistics (`minElevation`, `maxElevation`, `combinedElevationChange`) come from
//! the third coordinate of a line's geometry, so they are present only for members that were
//! elevated, as upstream's are. Upstream tests them for truthiness, so a minimum or maximum of
//! exactly zero, and an elevation change of zero, are ignored; this does the same.

use crate::turf::length_km;
use openskidata_format::ski_area::{
    LiftStatistics, LiftTypeStatistics, RunDifficultyStatistics, RunStatistics,
    RunStatisticsByDifficultyWrapper, SkiAreaStatistics, activity_key, difficulty_key,
    lift_type_key,
};
use openskidata_format::{LiftType, RunDifficulty, SkiAreaActivity};
use osd_osm::element::Geometry;
use std::collections::BTreeMap;

pub enum MemberKind<'a> {
    Run {
        difficulty: Option<RunDifficulty>,
        activities: &'a [SkiAreaActivity],
        snowmaking: Option<bool>,
        snowfarming: Option<bool>,
    },
    Lift {
        lift_type: LiftType,
    },
    Other,
}

pub struct Member<'a> {
    pub geometry: &'a Geometry,
    /// The elevation of each coordinate of `geometry`, if it was elevated.
    pub elevations: Option<&'a [f64]>,
    pub kind: MemberKind<'a>,
}

/// `elevationStatistics`: for a line with elevations, its change from first to last, highest and
/// lowest.
#[derive(Clone, Copy, Default)]
struct Elevation {
    change: Option<f64>,
    max: Option<f64>,
    min: Option<f64>,
}

fn elevation_statistics(member: &Member<'_>) -> Elevation {
    let (Geometry::LineString(_), Some(z)) = (member.geometry, member.elevations) else {
        return Elevation::default();
    };
    if z.is_empty() {
        return Elevation::default();
    }
    Elevation {
        change: Some(z[z.len() - 1] - z[0]),
        max: Some(z.iter().copied().fold(-f64::MAX, f64::max)),
        min: Some(z.iter().copied().fold(f64::MAX, f64::min)),
    }
}

/// JavaScript truthiness of a number: not zero, not `NaN`.
fn truthy(value: Option<f64>) -> Option<f64> {
    value.filter(|v| *v != 0.0 && !v.is_nan())
}

/// `augmentElevationStatistics`: widens a minimum and a maximum to include an object's.
fn augment(min: &mut Option<f64>, max: &mut Option<f64>, object: &Elevation) {
    if let Some(low) = truthy(object.min)
        && truthy(*min).is_none_or(|current| low < current)
    {
        *min = Some(low);
    }
    if let Some(high) = truthy(object.max)
        && truthy(*max).is_none_or(|current| high > current)
    {
        *max = Some(high);
    }
}

/// The part of `augmentRunOrLiftStatistics` that follows the length: the bucket's elevation
/// range, and its combined change of elevation.
fn augment_bucket(
    min: &mut Option<f64>,
    max: &mut Option<f64>,
    combined: &mut Option<f64>,
    object: &Elevation,
) {
    augment(min, max, object);
    if let Some(change) = truthy(object.change) {
        *combined = Some(truthy(*combined).unwrap_or(0.0) + change.abs());
    }
}

/// `skiAreaStatistics` (without snow cover).
pub fn ski_area_statistics(members: &[Member<'_>]) -> SkiAreaStatistics {
    let runs = run_statistics(members);
    let lifts = lift_statistics(members);
    // The highest "lift serviced" elevation that also has runs, and the lowest.
    let max = match (truthy(runs.max_elevation), truthy(lifts.max_elevation)) {
        (None, lift) => lift,
        (run, None) => run,
        (Some(run), Some(lift)) => Some(run.min(lift)),
    };
    let min = match (truthy(runs.min_elevation), truthy(lifts.min_elevation)) {
        (None, lift) => lift,
        (run, None) => run,
        (Some(run), Some(lift)) => Some(run.max(lift)),
    };
    SkiAreaStatistics {
        runs,
        lifts,
        min_elevation: truthy(min),
        max_elevation: truthy(max),
        snow_cover: None,
    }
}

fn run_statistics(members: &[Member<'_>]) -> RunStatistics {
    let mut by_activity: BTreeMap<String, RunStatisticsByDifficultyWrapper> = BTreeMap::new();
    let (mut min_elevation, mut max_elevation) = (None, None);

    for member in members {
        let MemberKind::Run {
            difficulty,
            activities,
            snowmaking,
            snowfarming,
        } = &member.kind
        else {
            continue;
        };
        // Polygons are excluded: typically redundant with LineString-based runs.
        if matches!(member.geometry, Geometry::Polygon(_)) {
            continue;
        }
        let distance = length_km(member.geometry);
        let elevation = elevation_statistics(member);

        for activity in activities
            .iter()
            .filter(|a| matches!(a, SkiAreaActivity::Downhill | SkiAreaActivity::Nordic))
        {
            let wrapper = by_activity
                .entry(activity_key(*activity))
                .or_insert_with(|| RunStatisticsByDifficultyWrapper {
                    by_difficulty: BTreeMap::new(),
                });
            let stats = wrapper
                .by_difficulty
                .entry(difficulty_key(*difficulty))
                .or_insert(RunDifficultyStatistics {
                    count: 0,
                    length_in_km: 0.0,
                    snowmaking_length_in_km: Some(0.0),
                    snowfarming_length_in_km: Some(0.0),
                    min_elevation: None,
                    max_elevation: None,
                    combined_elevation_change: None,
                });
            stats.count += 1;
            stats.length_in_km += distance;
            augment_bucket(
                &mut stats.min_elevation,
                &mut stats.max_elevation,
                &mut stats.combined_elevation_change,
                &elevation,
            );
            if *snowmaking == Some(true) {
                stats.snowmaking_length_in_km =
                    Some(stats.snowmaking_length_in_km.unwrap_or(0.0) + distance);
            }
            if *snowfarming == Some(true) {
                stats.snowfarming_length_in_km =
                    Some(stats.snowfarming_length_in_km.unwrap_or(0.0) + distance);
            }
            augment(&mut min_elevation, &mut max_elevation, &elevation);
        }
    }

    RunStatistics {
        min_elevation,
        max_elevation,
        by_activity,
    }
}

fn lift_statistics(members: &[Member<'_>]) -> LiftStatistics {
    let mut by_type: BTreeMap<String, LiftTypeStatistics> = BTreeMap::new();
    let (mut min_elevation, mut max_elevation) = (None, None);
    for member in members {
        let MemberKind::Lift { lift_type } = &member.kind else {
            continue;
        };
        let stats = by_type
            .entry(lift_type_key(Some(*lift_type)))
            .or_insert(LiftTypeStatistics {
                count: 0,
                length_in_km: 0.0,
                min_elevation: None,
                max_elevation: None,
                combined_elevation_change: None,
            });
        let elevation = elevation_statistics(member);
        stats.count += 1;
        stats.length_in_km += length_km(member.geometry);
        augment_bucket(
            &mut stats.min_elevation,
            &mut stats.max_elevation,
            &mut stats.combined_elevation_change,
            &elevation,
        );
        augment(&mut min_elevation, &mut max_elevation, &elevation);
    }
    LiftStatistics {
        min_elevation,
        max_elevation,
        by_type,
    }
}
