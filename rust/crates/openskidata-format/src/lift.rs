//! Replaces: `openskidata-format/dist/Lift.{d.ts,js}` and `LiftNameFormatter.{d.ts,js}`.

use crate::{
    FeatureType, LiftType, Status,
    elevation_profile::{ElevationData, elevation_data},
    place::Place,
    ski_area::SkiAreaSummaryFeature,
    source::Source,
    spot::LiftStationSpotFeature,
    viewport_hint::ViewportHint,
};
use osd_turf::Coord;
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

/// A lift station as `getLiftElevationData` reads it: where on the lift it is, and its
/// position (with elevation, when known).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StationPoint {
    pub position: Option<crate::LiftStationPosition>,
    pub coord: Coord,
}

/// `getLiftElevationData`'s result: the elevation data of the line, and how fast the lift
/// climbs it.
#[derive(Debug, Clone, PartialEq)]
pub struct LiftElevationData {
    pub elevation: ElevationData,
    pub speed_in_meters_per_second: Option<f64>,
    pub vertical_speed_in_meters_per_second: Option<f64>,
}

/// Replaces `getLiftElevationData`. `None` when the line carries no elevation.
///
/// Lifts keep their elevation in the geometry itself rather than in a separate profile. When
/// the top and bottom stations both have an elevation, their distance replaces the line's for
/// the speeds, since the line often runs past the stations.
pub fn lift_elevation_data(
    coordinates: &[Coord],
    duration_in_seconds: Option<f64>,
    stations: &[StationPoint],
) -> Result<Option<LiftElevationData>, String> {
    if coordinates.first().is_none_or(|c| c.z.is_none()) {
        return Ok(None);
    }
    let elevation = elevation_data(coordinates)?;
    let terminal = terminal_station_distances(stations);
    let inclined_length = terminal.map_or(elevation.pitch.inclined_length_in_meters, |t| t.0);
    let vertical_length = terminal.map_or(elevation.ascent_descent.vertical_in_meters, |t| t.1);
    // JavaScript truthiness: `0`, `NaN` and absent give `null`.
    let duration = duration_in_seconds.filter(|d| *d != 0.0 && !d.is_nan());
    Ok(Some(LiftElevationData {
        speed_in_meters_per_second: duration.map(|d| inclined_length / d),
        vertical_speed_in_meters_per_second: duration.map(|d| vertical_length / d),
        elevation,
    }))
}

/// `(inclined length, vertical)` between the top and bottom stations, if both have elevations.
fn terminal_station_distances(stations: &[StationPoint]) -> Option<(f64, f64)> {
    use crate::LiftStationPosition::{Bottom, Top};
    let top = stations.iter().find(|s| s.position == Some(Top))?;
    let bottom = stations.iter().find(|s| s.position == Some(Bottom))?;
    let (top_z, bottom_z) = (top.coord.z?, bottom.coord.z?);
    let horizontal = osd_turf::distance(top.coord.xy(), bottom.coord.xy(), osd_turf::Units::Meters);
    let vertical = (top_z - bottom_z).abs();
    Some((
        (horizontal * horizontal + vertical * vertical).sqrt(),
        vertical,
    ))
}

/// Replaces `getLiftColor`.
pub fn lift_color(status: Status) -> &'static str {
    const BRIGHT_RED: &str = "hsl(0, 82%, 42%)";
    const DIM_RED: &str = "hsl(0, 53%, 42%)";
    match status {
        // A lift that no longer runs is drawn dimmer. Note that proposed, planned and
        // under-construction lifts use the bright colour, like operating ones.
        Status::Disused | Status::Abandoned => DIM_RED,
        Status::Proposed | Status::Planned | Status::Construction | Status::Operating => BRIGHT_RED,
    }
}

/// Replaces `getFormattedLiftType`.
///
/// These are display strings, so the exact casing is what users see: "Chairlift" and
/// "Ropetow" are one word, "Cable Car" and "Magic Carpet" are two, and "Drag lift" has a
/// lower-case second word.
pub fn formatted_lift_type(lift_type: LiftType) -> &'static str {
    match lift_type {
        LiftType::CableCar => "Cable Car",
        LiftType::Gondola => "Gondola",
        LiftType::ChairLift => "Chairlift",
        LiftType::MixedLift => "Hybrid",
        LiftType::DragLift => "Drag lift",
        LiftType::TBar => "T-bar",
        LiftType::JBar => "J-bar",
        LiftType::Platter => "Platter",
        LiftType::RopeTow => "Ropetow",
        LiftType::MagicCarpet => "Magic Carpet",
        LiftType::Funicular => "Funicular",
        LiftType::Railway => "Railway",
    }
}

/// Replaces `getLiftNameAndType` from `LiftNameFormatter.js`: the name with the lift's type
/// in parentheses, e.g. `"Sunrise (Heated Bubble Quad)"`.
///
/// The type phrase is built from the lift's heating, bubble, occupancy and type. Two things
/// are implied and so not repeated: a chairlift's occupancy is spelled out as a word
/// (`Quad` rather than `4p`), and surface lifts and chairlifts whose name already says so
/// (`"T-bar"`, `"4er"`, `"Quad"`) get no occupancy.
pub fn lift_name_and_type(properties: &LiftProperties) -> Option<String> {
    let lift_type = augmented_lift_type(properties);
    match properties.name.as_deref().filter(|name| !name.is_empty()) {
        Some(name) if !lift_type.is_empty() => Some(format!("{name} ({lift_type})")),
        Some(name) => Some(name.to_owned()),
        None => Some(lift_type),
    }
}

fn augmented_lift_type(properties: &LiftProperties) -> String {
    let mut components: Vec<String> = Vec::new();
    if properties.heating == Some(true) {
        components.push("Heated".into());
    }
    if properties.bubble == Some(true)
        && properties.lift_type != LiftType::CableCar
        && properties.lift_type != LiftType::Gondola
    {
        components.push("Bubble".into());
    }
    // `properties.occupancy` is a JavaScript truthiness test: zero and NaN are absent.
    if let Some(occupancy) = properties.occupancy.filter(|o| *o != 0.0 && !o.is_nan())
        && !is_occupancy_implicit(properties)
    {
        components.push(format!("{occupancy}p"));
    }
    let implicit = implicit_occupancy_lift_type(properties);
    components.push(
        implicit
            .map(str::to_owned)
            .unwrap_or_else(|| formatted_lift_type(properties.lift_type).to_owned()),
    );
    components.join(" ")
}

fn implicit_occupancy_lift_type(properties: &LiftProperties) -> Option<&'static str> {
    if properties.lift_type == LiftType::ChairLift {
        return match properties.occupancy {
            Some(1.0) => Some("Single"),
            Some(2.0) => Some("Double"),
            Some(3.0) => Some("Triple"),
            Some(4.0) => Some("Quad"),
            _ => None,
        };
    }
    match properties.lift_type {
        LiftType::TBar => Some("T-bar"),
        LiftType::JBar => Some("J-bar"),
        LiftType::Platter => Some("Platter"),
        LiftType::RopeTow => Some("Ropetow"),
        LiftType::MagicCarpet => Some("Magic Carpet"),
        _ => None,
    }
}

fn is_occupancy_implicit(properties: &LiftProperties) -> bool {
    if implicit_occupancy_lift_type(properties).is_some() {
        return true;
    }
    const NAME_HINTS: [&str; 17] = [
        "t-bar", "j-bar", "platter", "rope tow", "ropetow", "rope-tow", "carpet", "single",
        "double", "triple", "quad", "1er", "2er", "3er", "4er", "6er", "8er",
    ];
    match &properties.name {
        Some(name) => {
            let lower = name.to_lowercase();
            NAME_HINTS.iter().any(|hint| lower.contains(hint))
        }
        None => false,
    }
}
