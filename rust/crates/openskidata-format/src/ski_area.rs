//! Replaces: `openskidata-format/dist/SkiArea.{d.ts,js}`.

use crate::snow_cover::SnowCoverHistory;
use crate::{
    FeatureType, LiftType, RunDifficulty, RunDifficultyConvention, SkiAreaActivity, Status,
    place::Place, source::Source, spot::FeatureTag, viewport_hint::ViewportHint,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SkiAreaGeometry {
    Point {
        coordinates: Vec<f64>,
    },
    Polygon {
        coordinates: Vec<Vec<Vec<f64>>>,
    },
    MultiPolygon {
        coordinates: Vec<Vec<Vec<Vec<f64>>>>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkiAreaSummaryProperties {
    #[serde(rename = "type")]
    pub feature_type: FeatureType,
    pub id: String,
    pub name: Option<String>,
    pub activities: Vec<SkiAreaActivity>,
    pub status: Option<Status>,
}

/// The embedded `skiAreas: SkiAreaSummaryFeature[]` carried by runs, lifts and spots.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkiAreaSummaryFeature {
    #[serde(rename = "type")]
    pub feature_tag: FeatureTag,
    pub geometry: SkiAreaGeometry,
    pub properties: SkiAreaSummaryProperties,
}

/// Convenience alias used by the other modules' signatures.
pub type SkiAreaSummary = SkiAreaSummaryFeature;

/// Upstream `SkiAreaProperties = SkiAreaSummaryProperties & { … }`, so it serializes
/// flat.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkiAreaProperties {
    #[serde(flatten)]
    pub summary: SkiAreaSummaryProperties,
    pub sources: Vec<Source>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub statistics: Option<SkiAreaStatistics>,
    #[serde(rename = "runConvention")]
    pub run_convention: RunDifficultyConvention,
    pub websites: Vec<String>,
    #[serde(rename = "wikidataID")]
    pub wikidata_id: Option<String>,
    pub places: Vec<Place>,
    #[serde(rename = "viewportHint")]
    pub viewport_hint: ViewportHint,
}

/// Several statistics maps are keyed by `SkiAreaActivity | 'other'` or
/// `RunDifficulty | 'other'`. `BTreeMap<String, _>` keeps the key set open while also
/// giving a deterministic iteration order, which matters because these maps are
/// serialized straight into the output.
pub type ActivityKey = String;
pub type DifficultyKey = String;
pub type LiftTypeKey = String;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkiAreaStatistics {
    pub runs: RunStatistics,
    pub lifts: LiftStatistics,
    #[serde(rename = "minElevation", skip_serializing_if = "Option::is_none")]
    pub min_elevation: Option<f64>,
    #[serde(rename = "maxElevation", skip_serializing_if = "Option::is_none")]
    pub max_elevation: Option<f64>,
    #[serde(rename = "snowCover", skip_serializing_if = "Option::is_none")]
    pub snow_cover: Option<SkiAreaSnowCoverStatistics>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkiAreaSnowCoverStatistics {
    pub overall: SnowCoverHistory,
    #[serde(rename = "byActivity")]
    pub by_activity: BTreeMap<ActivityKey, SnowCoverHistory>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RunStatistics {
    #[serde(rename = "minElevation", skip_serializing_if = "Option::is_none")]
    pub min_elevation: Option<f64>,
    #[serde(rename = "maxElevation", skip_serializing_if = "Option::is_none")]
    pub max_elevation: Option<f64>,
    #[serde(rename = "byActivity")]
    pub by_activity: BTreeMap<ActivityKey, RunStatisticsByDifficultyWrapper>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RunStatisticsByDifficultyWrapper {
    #[serde(rename = "byDifficulty")]
    pub by_difficulty: BTreeMap<DifficultyKey, RunDifficultyStatistics>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RunDifficultyStatistics {
    pub count: u64,
    #[serde(rename = "lengthInKm")]
    pub length_in_km: f64,
    #[serde(
        rename = "snowmakingLengthInKm",
        skip_serializing_if = "Option::is_none"
    )]
    pub snowmaking_length_in_km: Option<f64>,
    #[serde(
        rename = "snowfarmingLengthInKm",
        skip_serializing_if = "Option::is_none"
    )]
    pub snowfarming_length_in_km: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiftStatistics {
    #[serde(rename = "minElevation", skip_serializing_if = "Option::is_none")]
    pub min_elevation: Option<f64>,
    #[serde(rename = "maxElevation", skip_serializing_if = "Option::is_none")]
    pub max_elevation: Option<f64>,
    #[serde(rename = "byType")]
    pub by_type: BTreeMap<LiftTypeKey, LiftTypeStatistics>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiftTypeStatistics {
    pub count: u64,
    #[serde(rename = "lengthInKm")]
    pub length_in_km: f64,
}

/// The literal `'other'` bucket key shared by the statistics maps.
pub const OTHER_KEY: &str = "other";

/// Key for an activity bucket.
pub fn activity_key(activity: SkiAreaActivity) -> ActivityKey {
    activity.as_wire_str().to_owned()
}

/// Key for a difficulty bucket.
pub fn difficulty_key(difficulty: Option<RunDifficulty>) -> DifficultyKey {
    match difficulty {
        Some(d) => d.as_wire_str().to_owned(),
        None => OTHER_KEY.to_owned(),
    }
}

/// Key for a lift-type bucket.
pub fn lift_type_key(lift_type: Option<LiftType>) -> LiftTypeKey {
    match lift_type {
        Some(t) => t.as_wire_str().to_owned(),
        None => OTHER_KEY.to_owned(),
    }
}
