//! Ski area statistics, replacing `src/statistics/SkiAreaStatistics.ts`.
//!
//! Elevation statistics (`minElevation`, `maxElevation`, ascent) need geometries with a
//! third coordinate, which exist only after the elevation stage; until that is ported the
//! geometries here are 2D and those fields are absent, as they are upstream when no
//! elevation server is configured.

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
    pub kind: MemberKind<'a>,
}

/// `skiAreaStatistics` (without snow cover).
pub fn ski_area_statistics(members: &[Member<'_>]) -> SkiAreaStatistics {
    SkiAreaStatistics {
        runs: run_statistics(members),
        lifts: lift_statistics(members),
        min_elevation: None,
        max_elevation: None,
        snow_cover: None,
    }
}

fn run_statistics(members: &[Member<'_>]) -> RunStatistics {
    let mut by_activity: BTreeMap<String, RunStatisticsByDifficultyWrapper> = BTreeMap::new();

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
                });
            stats.count += 1;
            stats.length_in_km += distance;
            if *snowmaking == Some(true) {
                stats.snowmaking_length_in_km =
                    Some(stats.snowmaking_length_in_km.unwrap_or(0.0) + distance);
            }
            if *snowfarming == Some(true) {
                stats.snowfarming_length_in_km =
                    Some(stats.snowfarming_length_in_km.unwrap_or(0.0) + distance);
            }
        }
    }

    RunStatistics {
        min_elevation: None,
        max_elevation: None,
        by_activity,
    }
}

fn lift_statistics(members: &[Member<'_>]) -> LiftStatistics {
    let mut by_type: BTreeMap<String, LiftTypeStatistics> = BTreeMap::new();
    for member in members {
        let MemberKind::Lift { lift_type } = &member.kind else {
            continue;
        };
        let stats = by_type
            .entry(lift_type_key(Some(*lift_type)))
            .or_insert(LiftTypeStatistics {
                count: 0,
                length_in_km: 0.0,
            });
        stats.count += 1;
        stats.length_in_km += length_km(member.geometry);
    }
    LiftStatistics {
        min_elevation: None,
        max_elevation: None,
        by_type,
    }
}
