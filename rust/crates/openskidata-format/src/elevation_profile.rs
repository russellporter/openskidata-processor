//! Replaces: `openskidata-format/dist/ElevationProfile.{d.ts,js}`.
//!
//! **Float-sensitive. Port last.** `line_chunk_patched` is a *patched* turf `lineChunk`
//! working around four bugs documented in the upstream source; the patched behaviour is
//! the contract, not textbook turf. Every run's and lift's elevation statistics flow
//! from these functions, so last-digit drift here is visible in every feature.

use geo_types::LineString;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ElevationProfile {
    pub heights: Vec<f64>,
    pub resolution: f64,
    #[serde(rename = "targetResolution")]
    pub target_resolution: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AscentDescentData {
    #[serde(rename = "ascentInMeters")]
    pub ascent_in_meters: f64,
    #[serde(rename = "descentInMeters")]
    pub descent_in_meters: f64,
    #[serde(rename = "minElevationInMeters")]
    pub min_elevation_in_meters: f64,
    #[serde(rename = "maxElevationInMeters")]
    pub max_elevation_in_meters: f64,
    #[serde(rename = "verticalInMeters")]
    pub vertical_in_meters: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PitchData {
    #[serde(rename = "averagePitchInPercent")]
    pub average_pitch_in_percent: Option<f64>,
    #[serde(rename = "maxPitchInPercent")]
    pub max_pitch_in_percent: Option<f64>,
    #[serde(rename = "inclinedLengthInMeters")]
    pub inclined_length_in_meters: f64,
    #[serde(rename = "overallPitchInPercent")]
    pub overall_pitch_in_percent: Option<f64>,
    #[serde(rename = "pitchCalculationResolutionInMeters")]
    pub pitch_calculation_resolution_in_meters: f64,
}

/// Upstream `ElevationData` is the intersection `AscentDescentData & PitchData &
/// { profileGeometry }`, so it serializes **flat**. `#[serde(flatten)]` preserves that.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ElevationData {
    #[serde(flatten)]
    pub ascent_descent: AscentDescentData,
    #[serde(flatten)]
    pub pitch: PitchData,
    /// 3D line; `geo_types` is 2D, so elevations travel alongside in `heights`.
    #[serde(rename = "profileGeometry")]
    pub profile_geometry: LineString<f64>,
}

/// Replaces `getElevationData`.
pub fn elevation_data(_profile_geometry: &LineString<f64>, _heights: &[f64]) -> ElevationData {
    todo!("port getElevationData")
}

/// Replaces `getAscentAndDescent`.
pub fn ascent_and_descent(
    _profile_geometry: &LineString<f64>,
    _heights: &[f64],
) -> AscentDescentData {
    todo!("port getAscentAndDescent")
}

/// Replaces `getPitchData`.
pub fn pitch_data(
    _profile_geometry: &LineString<f64>,
    _heights: &[f64],
    _min_resolution_in_meters: Option<f64>,
) -> PitchData {
    todo!("port getPitchData")
}

/// Replaces `getProfileGeometry`.
pub fn profile_geometry(
    _geometry: &LineString<f64>,
    _profile: &ElevationProfile,
) -> LineString<f64> {
    todo!("port getProfileGeometry")
}

/// Replaces `extractPointsForElevationProfile`.
///
/// Called once per run and lift with a 25 m target resolution, so this is on the hot
/// path for the elevation cache's key count.
pub fn extract_points_for_elevation_profile(
    _geometry: &LineString<f64>,
    _min_resolution_in_meters: f64,
) -> (f64, LineString<f64>) {
    todo!("port extractPointsForElevationProfile")
}

/// Replaces `lineChunkPatched`.
///
/// See the module docs: this must reproduce the *patched* behaviour.
pub fn line_chunk_patched(
    _geometry: &LineString<f64>,
    _min_resolution_in_meters: f64,
) -> (f64, Vec<LineString<f64>>) {
    todo!("port lineChunkPatched, including its four turf bug workarounds")
}
