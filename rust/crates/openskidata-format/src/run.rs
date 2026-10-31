//! Replaces: `openskidata-format/dist/Run.{d.ts,js}`.

use crate::viewport_hint::ViewportHint;
use crate::{
    FeatureType, RunColorName, RunColorValue, RunDifficulty, RunDifficultyConvention, RunGrooming,
    RunUse, Status,
    elevation_profile::{ElevationData, ElevationProfile},
    place::Place,
    ski_area::SkiAreaSummary,
    snow_cover::SnowCoverHistory,
    source::Source,
};
use serde::{Deserialize, Serialize};

/// Output geometry for a run: upstream narrows to `LineString | Polygon` *after*
/// normalization, even though the OSM input may also be multi-geometry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RunGeometry {
    LineString { coordinates: Vec<Vec<f64>> },
    Polygon { coordinates: Vec<Vec<Vec<f64>>> },
}

/// Field order here follows upstream `RunProperties` so the emitted JSON key order
/// matches, which keeps diffs against the TypeScript output readable.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RunProperties {
    #[serde(rename = "type")]
    pub feature_type: FeatureType,
    pub uses: Vec<RunUse>,
    pub id: String,
    pub name: Option<String>,
    #[serde(rename = "ref")]
    pub reference: Option<String>,
    pub status: Status,
    pub description: Option<String>,
    pub difficulty: Option<RunDifficulty>,
    #[serde(rename = "difficultyConvention")]
    pub difficulty_convention: RunDifficultyConvention,
    pub oneway: Option<bool>,
    pub lit: Option<bool>,
    pub gladed: Option<bool>,
    pub patrolled: Option<bool>,
    pub snowmaking: Option<bool>,
    pub snowfarming: Option<bool>,
    pub tunnel: Option<bool>,
    pub grooming: Option<RunGrooming>,
    #[serde(rename = "skiAreas")]
    pub ski_areas: Vec<SkiAreaSummary>,
    #[serde(rename = "elevationProfile")]
    pub elevation_profile: Option<ElevationProfile>,
    pub sources: Vec<Source>,
    pub websites: Vec<String>,
    #[serde(rename = "wikidataID")]
    pub wikidata_id: Option<String>,
    pub places: Vec<Place>,
    /// Upstream marks this optional (`snowCoverHistory?`), so it must be omitted
    /// entirely — not emitted as `null` — when absent.
    #[serde(rename = "snowCoverHistory", skip_serializing_if = "Option::is_none")]
    pub snow_cover_history: Option<SnowCoverHistory>,
    #[serde(rename = "viewportHint")]
    pub viewport_hint: ViewportHint,
}

/// Replaces `getRunElevationData`.
pub fn run_elevation_data(
    _properties: &RunProperties,
    _geometry: &RunGeometry,
) -> Option<ElevationData> {
    todo!("port getRunElevationData")
}

/// Replaces `getRunColor`.
pub fn run_color(
    convention: RunDifficultyConvention,
    difficulty: Option<RunDifficulty>,
) -> RunColorValue {
    run_color_name_to_value(run_color_name(convention, difficulty))
}

/// Replaces `getRunColorName`.
///
/// The three conventions differ in how they colour the easier end of the range: Europe
/// distinguishes novice (green) from easy (blue), while Japan and North America group
/// both as green and then diverge — Japan uses red for intermediate, North America blue.
/// An unknown difficulty is grey in every convention.
pub fn run_color_name(
    convention: RunDifficultyConvention,
    difficulty: Option<RunDifficulty>,
) -> RunColorName {
    use RunColorName as C;
    use RunDifficulty as D;

    let Some(difficulty) = difficulty else {
        return C::Grey;
    };

    match convention {
        RunDifficultyConvention::Europe => match difficulty {
            D::Novice => C::Green,
            D::Easy => C::Blue,
            D::Intermediate => C::Red,
            D::Advanced | D::Expert => C::Black,
            D::Freeride | D::Extreme => C::Orange,
        },
        RunDifficultyConvention::Japan => match difficulty {
            D::Novice | D::Easy => C::Green,
            D::Intermediate => C::Red,
            D::Advanced | D::Expert => C::Black,
            D::Freeride | D::Extreme => C::Orange,
        },
        RunDifficultyConvention::NorthAmerica => match difficulty {
            D::Novice | D::Easy => C::Green,
            D::Intermediate => C::Blue,
            D::Advanced | D::Expert => C::Black,
            D::Freeride | D::Extreme => C::Orange,
        },
    }
}

/// Replaces `runColorNameToValue`.
pub fn run_color_name_to_value(color: RunColorName) -> RunColorValue {
    match color {
        RunColorName::Green => RunColorValue::Green,
        RunColorName::Blue => RunColorValue::Blue,
        RunColorName::Red => RunColorValue::Red,
        RunColorName::Black => RunColorValue::Black,
        RunColorName::Orange => RunColorValue::Orange,
        RunColorName::Grey => RunColorValue::Grey,
    }
}

/// Replaces `getRunDifficultyConvention` from
/// `openskidata-format/dist/RunDifficultyConvention.js`, which does point-in-polygon
/// against 15.5 KB of embedded region polygons. Those polygons must be carried over
/// verbatim, along with the exact boundary behaviour.
pub fn run_difficulty_convention(_lng: f64, _lat: f64) -> RunDifficultyConvention {
    todo!("port getRunDifficultyConvention, including its embedded region polygons")
}
