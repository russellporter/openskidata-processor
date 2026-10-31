//! Distance between two features' geometries.
//!
//! # The approximation, and what it costs
//!
//! The TypeScript pipeline asks PostGIS for
//! `ST_DWithin(geography(a), geography(b), metres)`, which with `use_spheroid` defaulting
//! to true is the minimum *spheroidal* distance between two arbitrary WGS84 geometries.
//!
//! This computes the minimum distance on a local equirectangular projection centred on
//! the pair, which carries roughly 0.1–0.3% error at these scales — about ±0.5 to 1.5 m
//! at the 500 m clustering threshold. Any pair whose true separation falls within that
//! band of the threshold can land on the other side of it, and a single flipped edge can
//! change a ski area's membership, its statistics, its viewport hint, and whether a
//! generated ski area exists at all.
//!
//! That is why the clustering stage is meant to land in two steps, with the exact metric
//! confirmed against PostGIS first (see `DistanceBackend`) and the blast radius of the
//! substitution measured before it is taken.

use osd_store::FixedCoord;

/// Mean Earth radius in metres, as used by the spherical approximations this mirrors.
const EARTH_RADIUS_M: f64 = 6_371_008.8;

/// Metres per degree of latitude.
fn metres_per_degree_lat() -> f64 {
    EARTH_RADIUS_M * std::f64::consts::PI / 180.0
}

/// Metres per degree of longitude at a given latitude.
fn metres_per_degree_lng(lat_degrees: f64) -> f64 {
    metres_per_degree_lat() * lat_degrees.to_radians().cos()
}

/// A coordinate projected to local metres.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Projected {
    x: f64,
    y: f64,
}

fn project(coord: FixedCoord, metres_per_lng: f64, metres_per_lat: f64) -> Projected {
    Projected {
        x: coord.lng_degrees() * metres_per_lng,
        y: coord.lat_degrees() * metres_per_lat,
    }
}

/// Squared distance from a point to a segment, in projected metres.
fn point_segment_distance_sq(p: Projected, a: Projected, b: Projected) -> f64 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let length_sq = dx * dx + dy * dy;

    if length_sq == 0.0 {
        let px = p.x - a.x;
        let py = p.y - a.y;
        return px * px + py * py;
    }

    // Projection of p onto the segment, clamped to its ends.
    let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / length_sq).clamp(0.0, 1.0);
    let cx = a.x + t * dx;
    let cy = a.y + t * dy;
    let px = p.x - cx;
    let py = p.y - cy;
    px * px + py * py
}

fn segments_intersect(a1: Projected, a2: Projected, b1: Projected, b2: Projected) -> bool {
    fn orientation(p: Projected, q: Projected, r: Projected) -> f64 {
        (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y)
    }
    let d1 = orientation(a1, a2, b1);
    let d2 = orientation(a1, a2, b2);
    let d3 = orientation(b1, b2, a1);
    let d4 = orientation(b1, b2, a2);
    ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0))
        && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0))
}

fn segment_segment_distance_sq(a1: Projected, a2: Projected, b1: Projected, b2: Projected) -> f64 {
    if segments_intersect(a1, a2, b1, b2) {
        return 0.0;
    }
    point_segment_distance_sq(a1, b1, b2)
        .min(point_segment_distance_sq(a2, b1, b2))
        .min(point_segment_distance_sq(b1, a1, a2))
        .min(point_segment_distance_sq(b2, a1, a2))
}

/// Minimum distance in metres between two coordinate runs.
///
/// A run of one coordinate is treated as a point, which is how OSM nodes and the
/// lift-station spots arrive here. Returns `None` when either run is empty, which only
/// happens for a placeholder geometry — those carry no position and must not be treated
/// as being at the origin.
pub fn min_distance_metres(left: &[FixedCoord], right: &[FixedCoord]) -> Option<f64> {
    if left.is_empty() || right.is_empty() {
        return None;
    }

    // Projected about the mean latitude of the two geometries, so the longitude scale is
    // right for the region being compared rather than for the equator.
    let mean_lat = (left
        .iter()
        .chain(right.iter())
        .map(|c| c.lat_degrees())
        .sum::<f64>())
        / ((left.len() + right.len()) as f64);
    let metres_per_lat = metres_per_degree_lat();
    let metres_per_lng = metres_per_degree_lng(mean_lat);

    let left_projected: Vec<Projected> = left
        .iter()
        .map(|&c| project(c, metres_per_lng, metres_per_lat))
        .collect();
    let right_projected: Vec<Projected> = right
        .iter()
        .map(|&c| project(c, metres_per_lng, metres_per_lat))
        .collect();

    // Single points on either side degenerate to point-to-segment or point-to-point.
    if left_projected.len() == 1 && right_projected.len() == 1 {
        let dx = left_projected[0].x - right_projected[0].x;
        let dy = left_projected[0].y - right_projected[0].y;
        return Some((dx * dx + dy * dy).sqrt());
    }

    let mut best_sq = f64::INFINITY;

    if left_projected.len() == 1 {
        for window in right_projected.windows(2) {
            best_sq = best_sq.min(point_segment_distance_sq(
                left_projected[0],
                window[0],
                window[1],
            ));
        }
        return Some(best_sq.sqrt());
    }
    if right_projected.len() == 1 {
        for window in left_projected.windows(2) {
            best_sq = best_sq.min(point_segment_distance_sq(
                right_projected[0],
                window[0],
                window[1],
            ));
        }
        return Some(best_sq.sqrt());
    }

    for left_window in left_projected.windows(2) {
        for right_window in right_projected.windows(2) {
            best_sq = best_sq.min(segment_segment_distance_sq(
                left_window[0],
                left_window[1],
                right_window[0],
                right_window[1],
            ));
            if best_sq == 0.0 {
                return Some(0.0);
            }
        }
    }

    Some(best_sq.sqrt())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coord(lng: f64, lat: f64) -> FixedCoord {
        FixedCoord::from_degrees(lng, lat).unwrap()
    }

    #[test]
    fn distance_between_two_points_is_about_right() {
        // One degree of latitude is close to 111 km.
        let a = [coord(11.0, 47.0)];
        let b = [coord(11.0, 48.0)];
        let d = min_distance_metres(&a, &b).unwrap();
        assert!(
            (d - 111_195.0).abs() < 500.0,
            "expected about 111 km, got {d}"
        );
    }

    #[test]
    fn longitude_is_scaled_by_latitude() {
        // At 60 degrees north a degree of longitude is about half its equatorial length.
        let north = min_distance_metres(&[coord(11.0, 60.0)], &[coord(12.0, 60.0)]).unwrap();
        let equator = min_distance_metres(&[coord(11.0, 0.0)], &[coord(12.0, 0.0)]).unwrap();
        assert!(
            (north / equator - 0.5).abs() < 0.02,
            "ratio was {}",
            north / equator
        );
    }

    #[test]
    fn crossing_lines_are_zero_apart() {
        let a = [coord(11.0, 47.0), coord(11.2, 47.2)];
        let b = [coord(11.0, 47.2), coord(11.2, 47.0)];
        assert_eq!(min_distance_metres(&a, &b), Some(0.0));
    }

    #[test]
    fn parallel_lines_measure_their_separation_not_their_endpoints() {
        // Two long parallel lines offset slightly in latitude. Comparing endpoints only
        // would give the same answer here, so the lines are offset in longitude too so
        // that the nearest approach is interior to both.
        let a = [coord(11.0, 47.0), coord(11.5, 47.0)];
        let b = [coord(11.1, 47.001), coord(11.6, 47.001)];
        let d = min_distance_metres(&a, &b).unwrap();
        // 0.001 degrees of latitude is about 111 m.
        assert!((d - 111.0).abs() < 5.0, "expected about 111 m, got {d}");
    }

    #[test]
    fn a_point_against_a_line_uses_the_perpendicular() {
        let line = [coord(11.0, 47.0), coord(11.5, 47.0)];
        let point = [coord(11.25, 47.001)];
        let d = min_distance_metres(&point, &line).unwrap();
        assert!((d - 111.0).abs() < 5.0, "expected about 111 m, got {d}");
    }

    /// Placeholder geometries carry no coordinates and must not read as being at the
    /// origin, which would put them 5000 km from the Alps rather than nowhere.
    #[test]
    fn an_empty_geometry_has_no_distance() {
        assert_eq!(min_distance_metres(&[], &[coord(11.0, 47.0)]), None);
        assert_eq!(min_distance_metres(&[coord(11.0, 47.0)], &[]), None);
    }
}
