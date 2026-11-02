//! turf's `booleanIntersects`, as it behaves when a rectangle (a satellite pixel) is tested
//! against a line or a polygon: `!booleanDisjoint`, which for these cases is a point-in-polygon
//! test of the vertices both ways plus `lineIntersect` of the outlines.
//!
//! Replaces `@turf/boolean-intersects` 7.4, `@turf/boolean-disjoint` 7.4, `@turf/line-intersect`
//! 7.4 (and the sweepline it carries), `@turf/boolean-point-in-polygon` and
//! `point-in-polygon-hao`. They are ported rather than replaced with a cleaner predicate because
//! the answers at the boundary are part of the output: a pixel that merely touches a run counts,
//! two collinear segments do not intersect (only their endpoints can), and whether a segment
//! reaches another is decided by `uA`/`uB` in `[0, 1]` computed in floating point.
//! `rust/codegen/generate-intersects-vectors.mjs` records the real functions on random inputs
//! and on grid-aligned ones where everything touches.
//!
//! The sweepline is ported with its queue (`tinyqueue`) and comparators as they are: neither is
//! a strict ordering, so the order events are processed in depends on the heap's exact sifting.

use crate::Position;
use std::cmp::Ordering;

// ---------------------------------------------------------------------------------------
// point-in-polygon-hao
// ---------------------------------------------------------------------------------------

/// Where a point lies relative to a polygon.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Containment {
    Outside,
    Boundary,
    Inside,
}

/// `pointInPolygon` of `point-in-polygon-hao`: a ray cast across every ring (outer and holes
/// together), `Boundary` if the point is on an edge.
pub fn point_in_polygon(point: Position, rings: &[&[Position]]) -> Containment {
    let (x, y) = (point[0], point[1]);
    let mut crossings = 0u32;
    for contour in rings {
        let last = contour.len() - 1;
        let mut u1 = contour[0][0] - x;
        let mut v1 = contour[0][1] - y;
        for index in 0..last {
            let next = contour[index + 1];
            let u2 = next[0] - x;
            let v2 = next[1] - y;
            if v1 == 0.0 && v2 == 0.0 {
                if (u2 <= 0.0 && u1 >= 0.0) || (u1 <= 0.0 && u2 >= 0.0) {
                    return Containment::Boundary;
                }
            } else if (v2 >= 0.0 && v1 <= 0.0) || (v2 <= 0.0 && v1 >= 0.0) {
                // robust-predicates' orient2d(u1, u2, v1, v2, 0, 0): the negation of Shewchuk's.
                let f = -robust::orient2d(
                    robust::Coord { x: u1, y: u2 },
                    robust::Coord { x: v1, y: v2 },
                    robust::Coord { x: 0.0, y: 0.0 },
                );
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
    if crossings.is_multiple_of(2) {
        Containment::Outside
    } else {
        Containment::Inside
    }
}

/// `booleanPointInPolygon(point, polygon)`: the boundary counts as inside.
fn in_polygon(point: Position, rings: &[&[Position]]) -> bool {
    point_in_polygon(point, rings) != Containment::Outside
}

// ---------------------------------------------------------------------------------------
// tinyqueue
// ---------------------------------------------------------------------------------------

/// `TinyQueue`: a binary heap over a comparator, with its exact sifting (and its data array,
/// which the sweepline reads in heap order).
struct Queue<T, F: Fn(&T, &T) -> i32> {
    data: Vec<T>,
    compare: F,
}

impl<T: Copy, F: Fn(&T, &T) -> i32> Queue<T, F> {
    fn new(compare: F) -> Self {
        Queue {
            data: Vec::new(),
            compare,
        }
    }

    fn push(&mut self, item: T) {
        self.data.push(item);
        self.up(self.data.len() - 1);
    }

    fn pop(&mut self) -> Option<T> {
        if self.data.is_empty() {
            return None;
        }
        let top = self.data[0];
        let bottom = self.data.pop().expect("not empty");
        if !self.data.is_empty() {
            self.data[0] = bottom;
            self.down(0);
        }
        Some(top)
    }

    fn up(&mut self, mut pos: usize) {
        let item = self.data[pos];
        while pos > 0 {
            let parent = (pos - 1) >> 1;
            let current = self.data[parent];
            if (self.compare)(&item, &current) >= 0 {
                break;
            }
            self.data[pos] = current;
            pos = parent;
        }
        self.data[pos] = item;
    }

    fn down(&mut self, mut pos: usize) {
        let length = self.data.len();
        let half = length >> 1;
        let item = self.data[pos];
        while pos < half {
            let mut left = (pos << 1) + 1;
            let mut best = self.data[left];
            let right = left + 1;
            if right < length && (self.compare)(&self.data[right], &best) < 0 {
                left = right;
                best = self.data[right];
            }
            if (self.compare)(&best, &item) >= 0 {
                break;
            }
            self.data[pos] = best;
            pos = left;
        }
        self.data[pos] = item;
    }
}

// ---------------------------------------------------------------------------------------
// The sweepline of @turf/line-intersect
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
struct Event {
    x: f64,
    y: f64,
    feature_id: u32,
    ring_id: u32,
    other: usize,
    is_left: Option<bool>,
}

impl Event {
    fn same_point(&self, other: &Event) -> bool {
        self.x == other.x && self.y == other.y
    }
}

/// `checkWhichEventIsLeft`.
fn which_event_is_left(e1: &Event, e2: &Event) -> i32 {
    if e1.x > e2.x {
        return 1;
    }
    if e1.x < e2.x {
        return -1;
    }
    if e1.x == e2.x
        && (e1.feature_id != e2.feature_id || e1.ring_id != e2.ring_id)
        && e1.is_left == Some(true)
        && e2.is_left != Some(true)
    {
        return -1;
    }
    if e1.y != e2.y {
        return if e1.y > e2.y { 1 } else { -1 };
    }
    1
}

/// `testSegmentIntersect`: whether two segments meet. Segments are `(left event, right event)`.
fn segments_intersect(events: &[Event], s1: (usize, usize), s2: (usize, usize)) -> bool {
    let (l1, r1, l2, r2) = (events[s1.0], events[s1.1], events[s2.0], events[s2.1]);
    let (x1, y1, x2, y2) = (l1.x, l1.y, r1.x, r1.y);
    let (x3, y3, x4, y4) = (l2.x, l2.y, r2.x, r2.y);
    let orient = |cx: f64, cy: f64| {
        robust::orient2d(
            robust::Coord { x: x1, y: y1 },
            robust::Coord { x: x2, y: y2 },
            robust::Coord { x: cx, y: cy },
        )
    };
    let score1 = orient(x3, y3);
    let score2 = orient(x4, y4);
    if score1 > 0.0 && score2 > 0.0 {
        return false;
    }
    if score1 < 0.0 && score2 < 0.0 {
        return false;
    }
    if l1.ring_id == l2.ring_id {
        if r1.same_point(&l2) || r1.same_point(&r2) || l1.same_point(&l2) || l1.same_point(&r2) {
            return false;
        }
    } else if r1.same_point(&l2) || r1.same_point(&r2) || l1.same_point(&l2) || l1.same_point(&r2) {
        return true;
    }
    let denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    let nume_a = (x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3);
    let nume_b = (x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3);
    if denom == 0.0 {
        return false;
    }
    let u_a = nume_a / denom;
    let u_b = nume_b / denom;
    (0.0..=1.0).contains(&u_a) && (0.0..=1.0).contains(&u_b)
}

/// `lineIntersect(a, b).features.length > 0` with `ignoreSelfIntersections`: whether any
/// segment of one outline meets any segment of the other. Each argument is the rings (or the one
/// line) of a feature.
pub fn outlines_intersect(a: &[&[Position]], b: &[&[Position]]) -> bool {
    let mut events: Vec<Event> = Vec::new();
    let mut ring_id = 0;
    for (feature_id, rings) in [a, b].into_iter().enumerate() {
        for ring in rings {
            ring_id += 1;
            for pair in ring.windows(2) {
                let e1 = events.len();
                let mut first = Event {
                    x: pair[0][0],
                    y: pair[0][1],
                    feature_id: feature_id as u32,
                    ring_id,
                    other: e1 + 1,
                    is_left: None,
                };
                let mut second = Event {
                    x: pair[1][0],
                    y: pair[1][1],
                    other: e1,
                    ..first
                };
                if which_event_is_left(&first, &second) > 0 {
                    second.is_left = Some(true);
                    first.is_left = Some(false);
                } else {
                    first.is_left = Some(true);
                    second.is_left = Some(false);
                }
                events.push(first);
                events.push(second);
            }
        }
    }

    let snapshot = events.clone();
    let mut queue =
        Queue::new(|i: &usize, j: &usize| which_event_is_left(&snapshot[*i], &snapshot[*j]));
    for index in 0..events.len() {
        queue.push(index);
    }

    // Active segments, the one whose right end comes first on top.
    let right_first = |s1: &(usize, usize), s2: &(usize, usize)| {
        let (r1, r2) = (&snapshot[s1.1], &snapshot[s2.1]);
        match r1.x.partial_cmp(&r2.x) {
            Some(Ordering::Greater) => 1,
            Some(Ordering::Less) => -1,
            _ if r1.y != r2.y => {
                if r1.y < r2.y {
                    1
                } else {
                    -1
                }
            }
            _ => 1,
        }
    };
    let mut active = Queue::new(right_first);
    while let Some(index) = queue.pop() {
        let event = snapshot[index];
        match event.is_left {
            Some(true) => {
                let segment = (index, event.other);
                for other in &active.data {
                    if snapshot[other.0].feature_id == event.feature_id {
                        continue;
                    }
                    if segments_intersect(&snapshot, segment, *other) {
                        return true;
                    }
                }
                active.push(segment);
            }
            Some(false) => {
                active.pop();
            }
            None => {}
        }
    }
    false
}

// ---------------------------------------------------------------------------------------
// booleanIntersects(pixel, part)
// ---------------------------------------------------------------------------------------

/// One part of a geometry to test against: a line, or a polygon as its rings (outer first).
#[derive(Debug, Clone, Copy)]
pub enum Part<'a> {
    LineString(&'a [Position]),
    Polygon(&'a [&'a [Position]]),
}

/// `booleanIntersects(polygon, part)` for a polygon with one ring (such as a pixel's square)
/// and a line or polygon part: `!booleanDisjoint`.
pub fn polygon_intersects(ring: &[Position], part: Part<'_>) -> bool {
    let polygon: [&[Position]; 1] = [ring];
    match part {
        // isLineInPoly(polygon, line)
        Part::LineString(line) => {
            line.iter().any(|&p| in_polygon(p, &polygon)) || outlines_intersect(&[line], &polygon)
        }
        // isPolyInPoly(part, polygon)
        Part::Polygon(rings) => {
            rings[0].iter().any(|&p| in_polygon(p, &polygon))
                || ring.iter().any(|&p| in_polygon(p, rings))
                || outlines_intersect(rings, &polygon)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SQUARE: [Position; 5] = [
        [0.0, 0.0],
        [10.0, 0.0],
        [10.0, 10.0],
        [0.0, 10.0],
        [0.0, 0.0],
    ];

    #[test]
    fn a_line_crossing_the_square_without_a_vertex_inside_intersects() {
        let line = [[-5.0, 5.0], [15.0, 5.0]];
        assert!(polygon_intersects(&SQUARE, Part::LineString(&line)));
    }

    #[test]
    fn touching_counts_but_collinear_overlap_on_its_own_does_not_cross() {
        // Ends exactly on a corner.
        assert!(polygon_intersects(
            &SQUARE,
            Part::LineString(&[[-5.0, -5.0], [0.0, 0.0]])
        ));
        // Runs along an edge, past both corners: found through the perpendicular edges.
        assert!(polygon_intersects(
            &SQUARE,
            Part::LineString(&[[-5.0, 0.0], [15.0, 0.0]])
        ));
        assert!(!polygon_intersects(
            &SQUARE,
            Part::LineString(&[[-5.0, 11.0], [15.0, 11.0]])
        ));
    }

    #[test]
    fn polygons_inside_each_other_intersect_either_way() {
        let big = [
            [-5.0, -5.0],
            [15.0, -5.0],
            [15.0, 15.0],
            [-5.0, 15.0],
            [-5.0, -5.0],
        ];
        assert!(polygon_intersects(&SQUARE, Part::Polygon(&[&big])));
        let small = [[4.0, 4.0], [6.0, 4.0], [6.0, 6.0], [4.0, 6.0], [4.0, 4.0]];
        assert!(polygon_intersects(&SQUARE, Part::Polygon(&[&small])));
        let far = [
            [20.0, 20.0],
            [30.0, 20.0],
            [30.0, 30.0],
            [20.0, 30.0],
            [20.0, 20.0],
        ];
        assert!(!polygon_intersects(&SQUARE, Part::Polygon(&[&far])));
    }

    #[test]
    fn a_hole_is_a_boundary_for_the_outline_test() {
        // A polygon whose hole contains the square: the square's corners are outside the
        // polygon, but the hole's outline is inside the square? No -- it encloses it, so only
        // the point tests say anything: the hole's vertices are outside the square.
        let outer = [
            [-50.0, -50.0],
            [50.0, -50.0],
            [50.0, 50.0],
            [-50.0, 50.0],
            [-50.0, -50.0],
        ];
        let hole = [
            [-20.0, -20.0],
            [-20.0, 20.0],
            [20.0, 20.0],
            [20.0, -20.0],
            [-20.0, -20.0],
        ];
        assert!(!polygon_intersects(
            &SQUARE,
            Part::Polygon(&[&outer, &hole])
        ));
    }
}
