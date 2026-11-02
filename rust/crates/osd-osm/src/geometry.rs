//! Way joining, ring containment and winding.
//!
//! Replaces the free functions at the bottom of `OSMToGeoJSONConverter.ts`. Each is
//! reproduced step for step rather than reimplemented in a cleaner form: ring assembly
//! decides which ways join and in which order, and a different but equally valid assembly
//! would still change the output geometry.

use crate::element::Position;

/// Joins ways that share end nodes into linestrings or closed rings.
///
/// Ways that connect to nothing start a linestring of their own. Replaces `joinWays`.
///
/// The procedure is greedy and order-dependent, and both properties are deliberate to
/// preserve:
///
/// - Ways are taken from the **end** of the input, so the last way seeds the first result.
/// - A growing line is extended at either end, trying in a fixed order: append a way that
///   starts at the line's end, append one that *ends* there (reversed), prepend one that
///   ends at the line's start, prepend one that starts there (reversed).
/// - It stops growing once the line is closed. An open line that cannot be extended is
///   emitted as it stands, which is how dangling ways and unclosed rings survive.
///
/// An empty way yields an empty line. That falls out naturally here, and matters: a way
/// whose nodes are all missing from the extract becomes an empty line rather than vanishing.
pub fn join_ways(ways: &[Vec<i64>]) -> Vec<Vec<i64>> {
    let mut remaining: Vec<Vec<i64>> = ways.to_vec();
    let mut joined: Vec<Vec<i64>> = Vec::new();

    while let Some(seed) = remaining.pop() {
        let mut current = seed;

        // `current[0] !== current[len - 1]` in JavaScript: for an empty line both sides are
        // `undefined`, so it counts as closed and growth stops.
        while !remaining.is_empty() && !is_closed(&current) {
            let first = current[0];
            let last = current[current.len() - 1];

            let mut found = None;
            for (index, way) in remaining.iter().enumerate() {
                if way.is_empty() {
                    continue;
                }
                let way_first = way[0];
                let way_last = way[way.len() - 1];

                if last == way_first {
                    current.extend_from_slice(&way[1..]);
                    found = Some(index);
                    break;
                } else if last == way_last {
                    current.extend(way[..way.len() - 1].iter().rev());
                    found = Some(index);
                    break;
                } else if first == way_last {
                    let mut prefix = way[..way.len() - 1].to_vec();
                    prefix.extend_from_slice(&current);
                    current = prefix;
                    found = Some(index);
                    break;
                } else if first == way_first {
                    let mut prefix: Vec<i64> = way[1..].iter().rev().copied().collect();
                    prefix.extend_from_slice(&current);
                    current = prefix;
                    found = Some(index);
                    break;
                }
            }

            match found {
                Some(index) => {
                    remaining.remove(index);
                }
                // Invalid geometry: a dangling way or an unclosed ring.
                None => break,
            }
        }

        joined.push(current);
    }

    joined
}

fn is_closed(line: &[i64]) -> bool {
    line.is_empty() || line[0] == line[line.len() - 1]
}

/// Ray-casting point-in-polygon, from
/// <http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html>.
///
/// Replaces `pointInPolygon`. Points exactly on the boundary are not reliably classified,
/// which is inherent to the method and the same upstream.
pub fn point_in_polygon(point: Position, polygon: &[Position]) -> bool {
    let (x, y) = (point[0], point[1]);
    let mut inside = false;

    let mut j = polygon.len().wrapping_sub(1);
    for i in 0..polygon.len() {
        let (xi, yi) = (polygon[i][0], polygon[i][1]);
        let (xj, yj) = (polygon[j][0], polygon[j][1]);

        let intersect = ((yi > y) != (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
        if intersect {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Enforces the RFC 7946 right-hand rule on one ring: counter-clockwise for an outer ring,
/// clockwise for an inner one.
///
/// Replaces `rewindRing`. The signed area is the shoelace sum accumulated with compensated
/// (Neumaier) summation. The compensation is not decoration: a sliver ring or a coordinate
/// far from the origin can make the plain sum's sign wrong, and the sign is all that is
/// used. The operations are reproduced in the same order so the floating-point result is
/// the same.
pub fn rewind_ring(ring: &mut [Position], clockwise: bool) {
    let mut area = 0.0_f64;
    let mut error = 0.0_f64;

    let mut j = ring.len().wrapping_sub(1);
    for i in 0..ring.len() {
        let term = (ring[i][0] - ring[j][0]) * (ring[j][1] + ring[i][1]);
        let sum = area + term;
        error += if area.abs() >= term.abs() {
            area - sum + term
        } else {
            term - sum + area
        };
        area = sum;
        j = i;
    }

    if ((area + error) >= 0.0) != clockwise {
        ring.reverse();
    }
}

/// Rewinds every ring of a polygon: the first is the outer ring, the rest are holes.
pub fn rewind_polygon(rings: &mut [Vec<Position>]) {
    for (index, ring) in rings.iter_mut().enumerate() {
        rewind_ring(ring, index != 0);
    }
}

/// JavaScript's `Math.round`: nearest integer, with ties going toward positive infinity.
///
/// Rust's `f64::round` sends ties away from zero, so `-2.5` rounds to `-3` there and to
/// `-2` in JavaScript. For positive values they agree, which is why this is easy to miss.
pub fn js_round(x: f64) -> f64 {
    let floor = x.floor();
    // `x - floor` is exact for any |x| below 2^52, which covers a coordinate scaled by 1e12.
    if x - floor >= 0.5 { floor + 1.0 } else { floor }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_round_sends_ties_toward_positive_infinity() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0, "Rust's round() would give -3");
        assert_eq!(js_round(0.5), 1.0);
        assert_eq!(js_round(-0.5), 0.0);
        assert_eq!(js_round(1.4999999999999998), 1.0);
        assert_eq!(js_round(-1.5), -1.0);
        assert_eq!(js_round(3.0), 3.0);
    }

    /// The case where adding 0.5 and flooring goes wrong: 0.49999999999999994 + 0.5 rounds up
    /// to 1.0 in floating point, but the number is below one half.
    #[test]
    fn js_round_survives_the_largest_value_below_one_half() {
        assert_eq!(js_round(0.49999999999999994), 0.0);
    }

    /// The last way seeds the result (ways are popped from the end), and the first is then
    /// prepended because its end meets the seed's start.
    #[test]
    fn a_way_that_ends_where_another_starts_is_prepended() {
        assert_eq!(
            join_ways(&[vec![1, 2, 3], vec![3, 4, 5]]),
            vec![vec![1, 2, 3, 4, 5]]
        );
    }

    #[test]
    fn a_way_running_the_other_direction_is_reversed_into_place() {
        // Seed [3,4,5]; [3,2,1] starts where the seed starts, so it is reversed and
        // prepended.
        assert_eq!(
            join_ways(&[vec![3, 2, 1], vec![3, 4, 5]]),
            vec![vec![1, 2, 3, 4, 5]]
        );
        // Seed [1,2,3]; [5,4,3] ends where the seed ends, so it is reversed and appended.
        assert_eq!(
            join_ways(&[vec![5, 4, 3], vec![1, 2, 3]]),
            vec![vec![1, 2, 3, 4, 5]]
        );
    }

    #[test]
    fn ways_forming_a_ring_close_it() {
        // Three ways around a triangle, deliberately in mixed directions.
        let rings = join_ways(&[vec![1, 2], vec![3, 2], vec![3, 1]]);
        assert_eq!(rings.len(), 1);
        assert_eq!(rings[0].first(), rings[0].last(), "the ring must be closed");
        assert_eq!(rings[0].len(), 4);
    }

    #[test]
    fn unconnected_ways_each_start_their_own_line() {
        let lines = join_ways(&[vec![1, 2], vec![3, 4]]);
        assert_eq!(lines.len(), 2);
        // Popped from the end, so the last input comes first.
        assert_eq!(lines[0], vec![3, 4]);
        assert_eq!(lines[1], vec![1, 2]);
    }

    /// An open line that cannot be extended is emitted as it stands rather than discarded.
    #[test]
    fn a_dangling_way_survives_unjoined() {
        let lines = join_ways(&[vec![1, 2, 3], vec![7, 8]]);
        assert_eq!(lines, vec![vec![7, 8], vec![1, 2, 3]]);
    }

    /// A way with every node missing from the extract becomes an empty line, not nothing.
    #[test]
    fn an_empty_way_yields_an_empty_line() {
        assert_eq!(join_ways(&[vec![]]), vec![Vec::<i64>::new()]);
        assert!(join_ways(&[]).is_empty());
    }

    /// A one-node way touching the current line's start is absorbed without adding a node
    /// (traced by hand through upstream's `joinWays`: `unshift(...[])`).
    #[test]
    fn a_single_node_way_is_absorbed_by_the_line_it_touches() {
        assert_eq!(join_ways(&[vec![5], vec![5, 6]]), vec![vec![5, 6]]);
    }

    fn square() -> Vec<Position> {
        vec![
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 10.0],
            [0.0, 10.0],
            [0.0, 0.0],
        ]
    }

    #[test]
    fn point_in_polygon_distinguishes_inside_from_outside() {
        let sq = square();
        assert!(point_in_polygon([5.0, 5.0], &sq));
        assert!(!point_in_polygon([15.0, 5.0], &sq));
        assert!(!point_in_polygon([5.0, -1.0], &sq));
        assert!(
            !point_in_polygon([5.0, 5.0], &[]),
            "no polygon contains nothing"
        );
    }

    #[test]
    fn an_outer_ring_is_rewound_counter_clockwise() {
        // This square is counter-clockwise already (x increases along the bottom edge).
        let mut ccw = square();
        let original = ccw.clone();
        rewind_ring(&mut ccw, false);
        assert_eq!(ccw, original, "already counter-clockwise: left alone");

        let mut cw: Vec<Position> = square().into_iter().rev().collect();
        rewind_ring(&mut cw, false);
        assert_eq!(cw, original, "clockwise input is reversed");
    }

    #[test]
    fn an_inner_ring_is_rewound_clockwise() {
        let mut ccw = square();
        rewind_ring(&mut ccw, true);
        let expected: Vec<Position> = square().into_iter().rev().collect();
        assert_eq!(ccw, expected);
    }

    #[test]
    fn rewinding_a_polygon_treats_only_the_first_ring_as_outer() {
        let mut rings = vec![
            square().into_iter().rev().collect::<Vec<_>>(), // clockwise outer
            square(),                                       // counter-clockwise hole
        ];
        rewind_polygon(&mut rings);
        assert_eq!(rings[0], square(), "outer becomes counter-clockwise");
        assert_eq!(
            rings[1],
            square().into_iter().rev().collect::<Vec<_>>(),
            "hole becomes clockwise"
        );
    }
}
