//! Which run-difficulty colour convention a ski area uses.
//!
//! Replaces: `getRunDifficultyConvention` in
//! `openskidata-format/dist/RunDifficultyConvention.js`.
//!
//! The convention is a property of where a ski area is: Japan has its own, North America
//! has its own, and everywhere else uses the European one. It is decided by testing the
//! centre of the area's bounding box against two regions, Japan first.
//!
//! # Matching the reference exactly
//!
//! The test is point-in-polygon as implemented by `point-in-polygon-hao`, called through
//! turf's `booleanPointInPolygon`, and it is worth reproducing exactly rather than
//! approximately because a region border runs through real ski country. Three details
//! carry that:
//!
//! - **The boundary counts as inside.** A point exactly on an edge or vertex is in the
//!   region.
//! - **Holes are handled by parity, not separately.** The outer ring and any holes are
//!   walked together and the crossings counted, so a point in a hole crosses an even
//!   number of edges and is outside.
//! - **Collinearity is decided with an exact predicate.** Whether a point lies on an edge
//!   is a sign test on a determinant, and rounding error there would make the answer depend
//!   on the platform. Shewchuk's adaptive-precision `orient2d` is exact for any `f64`
//!   input, in either language, so the two agree bit for bit.
//!
//! # The sign of the predicate, and why it does not matter
//!
//! The JavaScript calls `orient2d(u1, u2, v1, v2, 0, 0)` from `robust-predicates`, which
//! returns `(ay - cy)(bx - cx) - (ax - cx)(by - cy)`. That is the **negation** of the
//! conventional determinant the `robust` crate returns (positive for counter-clockwise), so
//! [`orient`] negates it to mirror the reference step for step.
//!
//! That negation is for fidelity, not correctness, and it is worth being clear about which.
//! The sign only decides whether a crossing is counted to the left or to the right of the
//! point, and for a closed ring those two counts always have the same parity, so the result
//! is identical either way. Deleting the negation changes no output: this was checked by
//! doing exactly that against the 13,000-point oracle, and nothing differed. What *does*
//! depend on the predicate is the zero test, which decides the boundary, and zero has no
//! sign. An earlier version of this comment claimed the flip would invert every boundary
//! decision; that was wrong, and testing showed it.
//!
//! # Float parsing
//!
//! Boundary points sit exactly on polygon vertices, so a coordinate that is one ulp off is
//! enough to change the answer. Anything that reads coordinates must therefore parse them
//! exactly. `serde_json`'s default float parser is not correctly rounded; the workspace
//! enables its `float_roundtrip` feature for this reason, and the oracle tests are what
//! first surfaced the problem.

use crate::RunDifficultyConvention;
use crate::generated::convention_regions::{JAPAN, MultiPolygon, NORTH_AMERICA};

/// Where a point lies relative to a polygon.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Containment {
    Outside,
    Boundary,
    Inside,
}

/// The determinant `point-in-polygon-hao` uses, evaluated exactly.
///
/// Equals `u2 * v1 - u1 * v2`. This is the negation of `robust::orient2d`, mirrored from the
/// reference for fidelity; see the module docs for why the sign does not affect the result.
fn orient(u1: f64, u2: f64, v1: f64, v2: f64) -> f64 {
    -robust::orient2d(
        robust::Coord { x: u1, y: u2 },
        robust::Coord { x: v1, y: v2 },
        robust::Coord { x: 0.0, y: 0.0 },
    )
}

/// `point-in-polygon-hao`: ray crossing over every ring of one polygon, outer and holes
/// together.
fn point_in_polygon(x: f64, y: f64, polygon: &[&[[f64; 2]]]) -> Containment {
    let mut crossings = 0u32;

    for contour in polygon {
        let last = contour.len() - 1;
        let mut u1 = contour[0][0] - x;
        let mut v1 = contour[0][1] - y;

        for index in 0..last {
            let next = contour[index + 1];
            let u2 = next[0] - x;
            let v2 = next[1] - y;

            if v1 == 0.0 && v2 == 0.0 {
                // A horizontal edge level with the point: on the boundary if the point is
                // between its ends.
                if (u2 <= 0.0 && u1 >= 0.0) || (u1 <= 0.0 && u2 >= 0.0) {
                    return Containment::Boundary;
                }
            } else if (v2 >= 0.0 && v1 <= 0.0) || (v2 <= 0.0 && v1 >= 0.0) {
                // The edge straddles the horizontal line through the point.
                let f = orient(u1, u2, v1, v2);
                if f == 0.0 {
                    return Containment::Boundary;
                }
                if (f > 0.0 && v2 > 0.0 && v1 <= 0.0) || (f < 0.0 && v2 <= 0.0 && v1 > 0.0) {
                    crossings += 1;
                }
            }

            v1 = v2;
            u1 = u2;
        }
    }

    if crossings % 2 == 0 {
        Containment::Outside
    } else {
        Containment::Inside
    }
}

/// turf's `booleanPointInPolygon` over a multipolygon, with the boundary counted as inside.
fn point_in_multi_polygon(x: f64, y: f64, regions: MultiPolygon) -> bool {
    regions
        .iter()
        .any(|polygon| point_in_polygon(x, y, polygon) != Containment::Outside)
}

/// The convention for a point.
///
/// Japan is tested first, then North America; anywhere else is Europe. The order would only
/// matter if the regions overlapped, and they do not: `the_regions_do_not_overlap` checks
/// this over a dense grid, so the order is a property of the reference that cannot change
/// any result here, rather than something the oracle merely failed to notice.
pub fn run_difficulty_convention_at(lng: f64, lat: f64) -> RunDifficultyConvention {
    if point_in_multi_polygon(lng, lat, JAPAN) {
        RunDifficultyConvention::Japan
    } else if point_in_multi_polygon(lng, lat, NORTH_AMERICA) {
        RunDifficultyConvention::NorthAmerica
    } else {
        RunDifficultyConvention::Europe
    }
}

/// The centre of a bounding box.
///
/// turf's `center` is the middle of the bounding box, **not** the centroid, so a long thin
/// area is placed by its extent rather than by where most of it lies.
pub fn bbox_center(west: f64, south: f64, east: f64, north: f64) -> (f64, f64) {
    ((west + east) / 2.0, (south + north) / 2.0)
}

/// The convention for an area, from its bounding box.
pub fn run_difficulty_convention_for_bbox(
    west: f64,
    south: f64,
    east: f64,
    north: f64,
) -> RunDifficultyConvention {
    let (lng, lat) = bbox_center(west, south, east, north);
    run_difficulty_convention_at(lng, lat)
}

/// The convention for any set of positions, from the bounding box of all of them.
///
/// Returns `None` for no positions, where upstream throws.
pub fn run_difficulty_convention_for_positions(
    positions: impl IntoIterator<Item = (f64, f64)>,
) -> Option<RunDifficultyConvention> {
    let mut iter = positions.into_iter();
    let (first_x, first_y) = iter.next()?;
    let (mut west, mut east, mut south, mut north) = (first_x, first_x, first_y, first_y);
    for (x, y) in iter {
        west = west.min(x);
        east = east.max(x);
        south = south.min(y);
        north = north.max(y);
    }
    Some(run_difficulty_convention_for_bbox(west, south, east, north))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pins the sign convention of the `robust` crate, which `orient` depends on being the
    /// opposite of the JavaScript predicate. If a crate upgrade ever flipped it, every
    /// boundary decision would silently invert; this makes that loud.
    #[test]
    fn robust_orient2d_is_positive_for_counter_clockwise() {
        let ccw = robust::orient2d(
            robust::Coord { x: 0.0, y: 0.0 },
            robust::Coord { x: 1.0, y: 0.0 },
            robust::Coord { x: 0.0, y: 1.0 },
        );
        assert!(
            ccw > 0.0,
            "expected positive for counter-clockwise, got {ccw}"
        );
    }

    /// And pins `orient` itself to the JavaScript formula `u2 * v1 - u1 * v2`.
    #[test]
    fn orient_matches_the_javascript_formula() {
        for &(u1, u2, v1, v2) in &[
            (1.0, 2.0, 3.0, 4.0),
            (-5.0, 0.5, 2.0, -7.0),
            (0.1, 0.2, 0.3, 0.4),
            (1e-9, 1.0, 1.0, 1e-9),
        ] {
            let expected = u2 * v1 - u1 * v2;
            let actual = orient(u1, u2, v1, v2);
            // Well-conditioned inputs: the sign must agree with the naive formula.
            assert_eq!(
                actual.signum(),
                expected.signum(),
                "sign for ({u1}, {u2}, {v1}, {v2})"
            );
        }
        // Exactly collinear: zero, with no sign.
        assert_eq!(orient(1.0, 2.0, 2.0, 4.0), 0.0);
    }

    /// The two regions share no points, so the order they are tested in cannot matter.
    #[test]
    fn the_regions_do_not_overlap() {
        let mut inside_japan = 0;
        let mut inside_north_america = 0;

        let mut lat = -90.0;
        while lat <= 90.0 {
            let mut lng = -180.0;
            while lng <= 195.0 {
                let in_japan = point_in_multi_polygon(lng, lat, JAPAN);
                let in_north_america = point_in_multi_polygon(lng, lat, NORTH_AMERICA);
                assert!(
                    !(in_japan && in_north_america),
                    "({lng}, {lat}) is inside both regions, so test order would matter"
                );
                inside_japan += usize::from(in_japan);
                inside_north_america += usize::from(in_north_america);
                lng += 0.5;
            }
            lat += 0.5;
        }

        assert!(
            inside_japan > 100 && inside_north_america > 1000,
            "regions too sparse to mean anything"
        );
    }

    /// A ring that a point is inside, with a hole it is not: parity handles holes without
    /// special casing, so a point in the hole crosses an even number of edges.
    #[test]
    fn a_point_in_a_hole_is_outside() {
        const OUTER: &[[f64; 2]] = &[
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 10.0],
            [0.0, 10.0],
            [0.0, 0.0],
        ];
        const HOLE: &[[f64; 2]] = &[[4.0, 4.0], [6.0, 4.0], [6.0, 6.0], [4.0, 6.0], [4.0, 4.0]];
        let polygon: &[&[[f64; 2]]] = &[OUTER, HOLE];

        assert_eq!(point_in_polygon(2.0, 2.0, polygon), Containment::Inside);
        assert_eq!(
            point_in_polygon(5.0, 5.0, polygon),
            Containment::Outside,
            "in the hole"
        );
        assert_eq!(
            point_in_polygon(4.0, 5.0, polygon),
            Containment::Boundary,
            "on the hole's edge"
        );
        assert_eq!(
            point_in_polygon(10.0, 5.0, polygon),
            Containment::Boundary,
            "on the outer edge"
        );
        assert_eq!(point_in_polygon(11.0, 5.0, polygon), Containment::Outside);
    }

    #[test]
    fn the_regions_cover_where_they_should() {
        use RunDifficultyConvention as C;
        assert_eq!(run_difficulty_convention_at(11.3, 47.2), C::Europe);
        assert_eq!(run_difficulty_convention_at(142.8, 43.3), C::Japan);
        assert_eq!(run_difficulty_convention_at(-106.0, 39.6), C::NorthAmerica);
        assert_eq!(run_difficulty_convention_at(-30.0, 40.0), C::Europe);
    }

    #[test]
    fn a_bounding_box_is_placed_by_its_centre_not_its_extent() {
        // Spans from Europe well into North America's longitude range; the centre decides.
        let by_centre = run_difficulty_convention_for_bbox(-120.0, 40.0, -90.0, 41.0);
        assert_eq!(by_centre, run_difficulty_convention_at(-105.0, 40.5));
    }

    #[test]
    fn positions_are_reduced_to_their_bounding_box() {
        let direct = run_difficulty_convention_for_bbox(-110.0, 38.0, -100.0, 42.0);
        let from_positions = run_difficulty_convention_for_positions([
            (-110.0, 38.0),
            (-100.0, 42.0),
            (-105.0, 40.0),
        ]);
        assert_eq!(from_positions, Some(direct));
        assert_eq!(run_difficulty_convention_for_positions([]), None);
    }
}
