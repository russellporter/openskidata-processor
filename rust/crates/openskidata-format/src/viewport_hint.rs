//! Replaces: `openskidata-format/dist/ViewportHint.{d.ts,js}` (6.2 KB of upstream JS).
//!
//! **Float-sensitive. Port last.** This is a rotated minimum bounding rectangle:
//! convex hull plus rotating calipers, with tie-breaking and trigonometry. It is
//! computed for every run, lift, spot and ski area, so drift is visible everywhere.
//! Pin it against the extracted snapshots with per-field numeric tolerance, never
//! string equality.

use geo_types::Geometry;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ViewportHint {
    /// Geographic centre of the rotated bounding box, as `[lng, lat]`.
    pub center: (f64, f64),
    pub bearing: Option<f64>,
    #[serde(rename = "rotatedWidthMeters")]
    pub rotated_width_meters: f64,
    #[serde(rename = "rotatedHeightMeters")]
    pub rotated_height_meters: f64,
    #[serde(rename = "minCameraY")]
    pub min_camera_y: f64,
}

/// Replaces `computeViewportHint`.
pub fn compute_viewport_hint(_geometries: &[Geometry<f64>]) -> ViewportHint {
    todo!("port computeViewportHint: convex hull + rotating calipers + camera maths")
}
