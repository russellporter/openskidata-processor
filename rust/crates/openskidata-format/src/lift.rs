//! Replaces: `openskidata-format/dist/Lift.{d.ts,js}` and `LiftNameFormatter.{d.ts,js}`.

use crate::{
    FeatureType, LiftType, Status, elevation_profile::ElevationData, place::Place,
    ski_area::SkiAreaSummaryFeature, source::Source, spot::LiftStationSpotFeature,
    viewport_hint::ViewportHint,
};
use serde::{Deserialize, Serialize};

/// Upstream `Access = 'private' | null`. The field is always present, so it is
/// `Option<Access>` here with `null` meaning "not private".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Access {
    #[serde(rename = "private")]
    Private,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum LiftGeometry {
    Point {
        coordinates: Vec<f64>,
    },
    LineString {
        coordinates: Vec<Vec<f64>>,
    },
    Polygon {
        coordinates: Vec<Vec<Vec<f64>>>,
    },
    MultiLineString {
        coordinates: Vec<Vec<Vec<f64>>>,
    },
    MultiPolygon {
        coordinates: Vec<Vec<Vec<Vec<f64>>>>,
    },
}

/// Field order follows upstream `LiftProperties` so emitted JSON key order matches.
///
/// Note there is deliberately **no** `elevationProfile` field: unlike runs, lifts carry
/// elevation only inside their geometry, and `lift_elevation_data` derives statistics
/// from that.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiftProperties {
    #[serde(rename = "type")]
    pub feature_type: FeatureType,
    pub id: String,
    #[serde(rename = "liftType")]
    pub lift_type: LiftType,
    pub status: Status,
    pub access: Option<Access>,
    pub name: Option<String>,
    #[serde(rename = "ref")]
    pub reference: Option<String>,
    #[serde(rename = "refFRCAIRN")]
    pub ref_fr_cairn: Option<String>,
    pub description: Option<String>,
    pub oneway: Option<bool>,
    pub occupancy: Option<f64>,
    pub capacity: Option<f64>,
    pub duration: Option<f64>,
    pub detachable: Option<bool>,
    pub bubble: Option<bool>,
    pub heating: Option<bool>,
    pub tunnel: Option<bool>,
    /// Associated lift-station spots, attached by `osd_cluster`'s station associator.
    pub stations: Vec<LiftStationSpotFeature>,
    #[serde(rename = "skiAreas")]
    pub ski_areas: Vec<SkiAreaSummaryFeature>,
    pub sources: Vec<Source>,
    pub websites: Vec<String>,
    #[serde(rename = "wikidataID")]
    pub wikidata_id: Option<String>,
    pub places: Vec<Place>,
    #[serde(rename = "viewportHint")]
    pub viewport_hint: ViewportHint,
}

/// Replaces `getLiftElevationData`.
pub fn lift_elevation_data(_geometry: &LiftGeometry, _elevations: &[f64]) -> Option<ElevationData> {
    todo!("port getLiftElevationData")
}

/// Replaces `getLiftColor`.
pub fn lift_color(_status: Status) -> &'static str {
    todo!("port getLiftColor")
}

/// Replaces `getFormattedLiftType`.
pub fn formatted_lift_type(_lift_type: LiftType) -> &'static str {
    todo!("port getFormattedLiftType")
}

/// Replaces `getLiftNameAndType` from `LiftNameFormatter.js`.
pub fn lift_name_and_type(_properties: &LiftProperties) -> Option<String> {
    todo!("port getLiftNameAndType")
}
