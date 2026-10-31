//! Replaces: `openskidata-format/dist/Spot.{d.ts,js}`.

use crate::{
    DismountRequirement, FeatureType, LiftStationPosition, place::Place,
    ski_area::SkiAreaSummaryFeature, source::Source, viewport_hint::ViewportHint,
};
use serde::{Deserialize, Serialize};

/// Spots are always points upstream.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpotGeometry {
    #[serde(rename = "type")]
    pub geometry_type: PointTag,
    pub coordinates: Vec<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PointTag {
    Point,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpotBaseProperties {
    #[serde(rename = "type")]
    pub feature_type: FeatureType,
    pub id: String,
    #[serde(rename = "skiAreas")]
    pub ski_areas: Vec<SkiAreaSummaryFeature>,
    pub sources: Vec<Source>,
    pub places: Vec<Place>,
    #[serde(rename = "viewportHint")]
    pub viewport_hint: ViewportHint,
}

/// Upstream is a discriminated union on `spotType`; the per-variant fields are flattened
/// alongside the shared base, so `#[serde(flatten)]` on both halves reproduces the shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpotProperties {
    #[serde(flatten)]
    pub base: SpotBaseProperties,
    #[serde(flatten)]
    pub kind: SpotKind,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "spotType")]
pub enum SpotKind {
    #[serde(rename = "crossing")]
    Crossing { dismount: DismountRequirement },
    #[serde(rename = "lift_station")]
    LiftStation {
        name: Option<String>,
        position: Option<LiftStationPosition>,
        entry: Option<bool>,
        exit: Option<bool>,
        #[serde(rename = "liftId")]
        lift_id: String,
    },
    #[serde(rename = "avalanche_transceiver_training")]
    AvalancheTransceiverTraining {},
    #[serde(rename = "avalanche_transceiver_checkpoint")]
    AvalancheTransceiverCheckpoint {},
    #[serde(rename = "halfpipe")]
    Halfpipe {},
}

/// A lift-station spot as embedded in `LiftProperties::stations`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiftStationSpotFeature {
    #[serde(rename = "type")]
    pub feature_tag: FeatureTag,
    pub geometry: SpotGeometry,
    pub properties: SpotProperties,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FeatureTag {
    Feature,
}
