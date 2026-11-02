//! Replaces: `openskidata-format/dist/ViewportHint.js`.
//!
//! A viewport hint tells a map client how to frame a feature: where to centre, which way to
//! turn the camera (so a run descends towards the viewer), and how much room the feature
//! needs once rotated. It is computed for every run, lift, spot and ski area.
//!
//! The algorithm is simpler than "rotated minimum bounding rectangle" suggests -- there is
//! no convex hull and no rotating calipers:
//!
//! 1. The centre is the middle of the longitude/latitude bounding box.
//! 2. Every consecutive pair of positions with different elevations votes for a bearing:
//!    its downhill direction, weighted by its haversine length. The dominant direction is
//!    the angle of the summed unit vectors.
//! 3. The camera looks uphill, turned 30 degrees off the fall line to show the terrain in
//!    profile. No elevation variation means no bearing (`None`).
//! 4. Every position is projected into camera space (metres, rotated by the bearing) and
//!    the extents are taken, with elevation above the mean shifting the apparent Y by the
//!    same amount (45-degree pitch).
//!
//! # Floating point
//!
//! This is the one module where the result depends on `sin`, `cos` and `atan2`, whose last
//! bit differs between V8's fdlibm and the platform libm. The recorded vectors are compared
//! with a tolerance (relative 1e-9), not for equality. Two branch points are exact
//! comparisons that a one-ulp difference could flip -- `sumSin !== 0 || sumCos !== 0`, and
//! the elevation equality test -- and the test corpus includes symmetric cases that sit on
//! them.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ViewportHint {
    /// Geographic centre of the bounding box, as `[lng, lat]`.
    pub center: (f64, f64),
    pub bearing: Option<f64>,
    #[serde(rename = "rotatedWidthMeters")]
    pub rotated_width_meters: f64,
    #[serde(rename = "rotatedHeightMeters")]
    pub rotated_height_meters: f64,
    #[serde(rename = "minCameraY")]
    pub min_camera_y: f64,
}

/// `[longitude, latitude, elevation in metres]`. Elevation is 0 where unknown.
pub type Position3 = [f64; 3];

const EARTH_RADIUS_METERS: f64 = 6_371_008.8;
const METERS_PER_DEGREE: f64 = 111_320.0;
const BEARING_SIDE_OFFSET_DEGREES: f64 = 30.0;

/// `@turf/distance`: haversine distance in metres.
fn haversine_meters(from: (f64, f64), to: (f64, f64)) -> f64 {
    // turf's `degreesToRadians` first reduces modulo 360, with JavaScript's `%`, which like
    // `f64::rem` keeps the dividend's sign.
    let radians = |degrees: f64| (degrees % 360.0) * std::f64::consts::PI / 180.0;
    let d_lat = radians(to.1 - from.1);
    let d_lon = radians(to.0 - from.0);
    let lat1 = radians(from.1);
    let lat2 = radians(to.1);
    let a = (d_lat / 2.0).sin().powi(2) + (d_lon / 2.0).sin().powi(2) * lat1.cos() * lat2.cos();
    2.0 * a.sqrt().atan2((1.0 - a).sqrt()) * EARTH_RADIUS_METERS
}

/// Great-circle bearing from `from` to `to`, in degrees `[0, 360)`.
fn great_circle_bearing(from_lat: f64, from_lng: f64, to_lat: f64, to_lng: f64) -> f64 {
    let rad = |d: f64| d * std::f64::consts::PI / 180.0;
    let (phi1, phi2, delta) = (rad(from_lat), rad(to_lat), rad(to_lng - from_lng));
    let y = delta.sin() * phi2.cos();
    let x = phi1.cos() * phi2.sin() - phi1.sin() * phi2.cos() * delta.cos();
    ((y.atan2(x) * 180.0) / std::f64::consts::PI + 360.0) % 360.0
}

/// Computes the hint of a geometry given as connected sequences of positions.
///
/// A line, or one ring of a polygon, is one sequence, and consecutive positions in it form
/// the segments that vote for the bearing. A point is a sequence of one position. Returns
/// `None` when there are no positions at all, where upstream throws.
pub fn compute_viewport_hint(sequences: &[&[Position3]]) -> Option<ViewportHint> {
    let all: Vec<Position3> = sequences.iter().flat_map(|s| s.iter().copied()).collect();
    if all.is_empty() {
        return None;
    }

    let (mut min_lng, mut max_lng) = (f64::INFINITY, f64::NEG_INFINITY);
    let (mut min_lat, mut max_lat) = (f64::INFINITY, f64::NEG_INFINITY);
    for &[lng, lat, _] in &all {
        min_lng = min_lng.min(lng);
        max_lng = max_lng.max(lng);
        min_lat = min_lat.min(lat);
        max_lat = max_lat.max(lat);
    }
    let center_lng = (min_lng + max_lng) / 2.0;
    let center_lat = (min_lat + max_lat) / 2.0;

    // Each segment's downhill direction, weighted by its length.
    let (mut sum_sin, mut sum_cos) = (0.0f64, 0.0f64);
    for sequence in sequences {
        for pair in sequence.windows(2) {
            let ([lng0, lat0, elev0], [lng1, lat1, elev1]) = (pair[0], pair[1]);
            if elev0 == elev1 {
                continue;
            }
            let (from_lng, from_lat, to_lng, to_lat) = if elev0 > elev1 {
                (lng0, lat0, lng1, lat1)
            } else {
                (lng1, lat1, lng0, lat0)
            };
            let bearing = great_circle_bearing(from_lat, from_lng, to_lat, to_lng);
            let length = haversine_meters((lng0, lat0), (lng1, lat1));
            let bearing_rad = bearing * std::f64::consts::PI / 180.0;
            sum_sin += bearing_rad.sin() * length;
            sum_cos += bearing_rad.cos() * length;
        }
    }

    // The camera looks uphill, offset from the fall line; null if nothing varies in height.
    let map_bearing = if sum_sin != 0.0 || sum_cos != 0.0 {
        let dominant_downhill = sum_sin.atan2(sum_cos) * 180.0 / std::f64::consts::PI;
        let normalized_downhill = ((dominant_downhill % 360.0) + 360.0) % 360.0;
        Some((normalized_downhill + 180.0 + BEARING_SIDE_OFFSET_DEGREES) % 360.0)
    } else {
        None
    };

    let cos_lat = (center_lat * (std::f64::consts::PI / 180.0)).cos();
    let bearing_rad = map_bearing.unwrap_or(0.0) * std::f64::consts::PI / 180.0;

    let mut elevation_sum = 0.0;
    for &[_, _, elevation] in &all {
        elevation_sum += elevation;
    }
    let mean_elevation = elevation_sum / all.len() as f64;

    let (mut min_x, mut max_x) = (f64::INFINITY, f64::NEG_INFINITY);
    let (mut min_y, mut max_y) = (f64::INFINITY, f64::NEG_INFINITY);
    for &[lng, lat, elevation] in &all {
        let dx = (lng - center_lng) * cos_lat * METERS_PER_DEGREE;
        let dy = (lat - center_lat) * METERS_PER_DEGREE;
        let cx = dx * bearing_rad.cos() - dy * bearing_rad.sin();
        let cy = dx * bearing_rad.sin() + dy * bearing_rad.cos();
        // At 45 degrees of pitch, elevation above the mean shifts the apparent Y by the
        // same amount (tan 45 = 1).
        let cy_effective = cy + (elevation - mean_elevation);
        min_x = min_x.min(cx);
        max_x = max_x.max(cx);
        min_y = min_y.min(cy_effective);
        max_y = max_y.max(cy_effective);
    }

    Some(ViewportHint {
        center: (center_lng, center_lat),
        bearing: map_bearing,
        rotated_width_meters: max_x - min_x,
        rotated_height_meters: max_y - min_y,
        min_camera_y: min_y,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_positions_has_no_hint() {
        assert_eq!(compute_viewport_hint(&[]), None);
        assert_eq!(compute_viewport_hint(&[&[]]), None);
    }

    #[test]
    fn a_flat_line_has_no_bearing() {
        let line = [[11.0, 47.0, 1000.0], [11.01, 47.0, 1000.0]];
        let hint = compute_viewport_hint(&[&line]).unwrap();
        assert_eq!(hint.bearing, None);
        assert_eq!(hint.center, (11.005, 47.0));
    }

    #[test]
    fn a_run_descending_east_looks_back_uphill_with_the_side_offset() {
        // Descending due east: downhill bearing 90, uphill 270, plus the 30 degree offset.
        let line = [[11.0, 47.0, 2000.0], [11.01, 47.0, 1900.0]];
        let hint = compute_viewport_hint(&[&line]).unwrap();
        let bearing = hint.bearing.unwrap();
        assert!((bearing - 300.0).abs() < 0.01, "bearing was {bearing}");
    }

    #[test]
    fn a_point_is_a_zero_extent_hint() {
        let hint = compute_viewport_hint(&[&[[11.0, 47.0, 500.0]]]).unwrap();
        assert_eq!(hint.rotated_width_meters, 0.0);
        assert_eq!(hint.rotated_height_meters, 0.0);
        assert_eq!(hint.bearing, None);
    }

    #[test]
    fn haversine_matches_turf() {
        // `turf.distance([10,45],[10.01,45.01],{units:'meters'})` in node.
        let d = haversine_meters((10.0, 45.0), (10.01, 45.01));
        assert!((d - 1361.8164244442553).abs() < 1e-6, "{d}");
    }
}
