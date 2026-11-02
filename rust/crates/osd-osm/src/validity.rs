//! Geometry validity, ported literally from `@turf/boolean-valid@7.4.0`.
//!
//! Replaces `isValidGeometryInFeature` in `GeoTransforms.ts`, which decides whether an OSM
//! way or relation is usable at all. The checks are turf's, not a standard definition of
//! validity -- OGC validity would reject and accept different things -- so each is ported
//! from its source:
//!
//! - `boolean-valid`: ring length, closure, "spikes and punctures", and the hole and
//!   multipolygon checks;
//! - `boolean-point-on-line`: exact collinearity by cross product;
//! - `line-intersect`: a sweep line, ported with its heap, because its behaviour is part of
//!   the answer. The segment it retires when a right endpoint is reached is the one with the
//!   smallest right endpoint, not necessarily the one that ended, so the active set can
//!   differ from a textbook sweep and so can the intersections found;
//! - `boolean-disjoint` and `boolean-crosses` for the polygon-against-polygon check.
//!
//! Points are compared with `===` on floats, as upstream does.

use crate::element::{Geometry, Position};
use openskidata_format::convention::{Containment, point_in_polygon};
use osd_store::feature_id::js_number_to_string;
use std::collections::HashSet;

// ---------------------------------------------------------------------------------------
// boolean-point-on-line (the variants used by boolean-valid)
// ---------------------------------------------------------------------------------------

/// `isPointOnLineSegment` from `@turf/boolean-point-on-line`, with no excluded boundary and
/// no epsilon.
fn point_on_segment(start: Position, end: Position, pt: Position) -> bool {
    let (x, y) = (pt[0], pt[1]);
    let (x1, y1, x2, y2) = (start[0], start[1], end[0], end[1]);
    let dxc = pt[0] - x1;
    let dyc = pt[1] - y1;
    let dxl = x2 - x1;
    let dyl = y2 - y1;
    let cross = dxc * dyl - dyc * dxl;
    if cross != 0.0 {
        return false;
    }
    if dxl.abs() == dyl.abs() && dxl.abs() == 0.0 {
        return pt[0] == start[0] && pt[1] == start[1];
    }
    if dxl.abs() >= dyl.abs() {
        return if dxl > 0.0 {
            x1 <= x && x <= x2
        } else {
            x2 <= x && x <= x1
        };
    }
    if dyl > 0.0 {
        y1 <= y && y <= y2
    } else {
        y2 <= y && y <= y1
    }
}

// ---------------------------------------------------------------------------------------
// line-intersect: turf's sweep line
// ---------------------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct SweepEvent {
    x: f64,
    y: f64,
    feature_id: u32,
    ring_id: u32,
    other: usize,
    is_left_endpoint: Option<bool>,
}

impl SweepEvent {
    fn same_point(&self, other: &SweepEvent) -> bool {
        self.x == other.x && self.y == other.y
    }
}

/// `checkWhichEventIsLeft`. Not a consistent ordering (it returns 1 for ties, in both
/// directions); it is only ever used through the heap below, which is ported as is.
fn event_order(e1: &SweepEvent, e2: &SweepEvent) -> i32 {
    if e1.x > e2.x {
        return 1;
    }
    if e1.x < e2.x {
        return -1;
    }
    if e1.x == e2.x && (e1.feature_id != e2.feature_id || e1.ring_id != e2.ring_id) {
        if e1.is_left_endpoint == Some(true) && e2.is_left_endpoint != Some(true) {
            return -1;
        }
    }
    if e1.y != e2.y {
        return if e1.y > e2.y { 1 } else { -1 };
    }
    1
}

/// `tinyqueue`: a binary min-heap with a caller-supplied comparator, ported exactly so that
/// ties and the inconsistent comparators above resolve as they do upstream.
struct TinyQueue<T, F: Fn(&T, &T) -> i32> {
    data: Vec<T>,
    compare: F,
}

impl<T: Clone, F: Fn(&T, &T) -> i32> TinyQueue<T, F> {
    fn new(compare: F) -> Self {
        TinyQueue {
            data: Vec::new(),
            compare,
        }
    }

    fn len(&self) -> usize {
        self.data.len()
    }

    fn push(&mut self, item: T) {
        self.data.push(item);
        let last = self.data.len() - 1;
        self.up(last);
    }

    fn pop(&mut self) -> Option<T> {
        if self.data.is_empty() {
            return None;
        }
        let top = self.data[0].clone();
        let bottom = self.data.pop().expect("non-empty");
        if !self.data.is_empty() {
            self.data[0] = bottom;
            self.down(0);
        }
        Some(top)
    }

    fn up(&mut self, mut pos: usize) {
        let item = self.data[pos].clone();
        while pos > 0 {
            let parent = (pos - 1) >> 1;
            let current = self.data[parent].clone();
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
        let half_length = length >> 1;
        let item = self.data[pos].clone();
        while pos < half_length {
            let mut left = (pos << 1) + 1;
            let mut best = self.data[left].clone();
            let right = left + 1;
            if right < length && (self.compare)(&self.data[right], &best) < 0 {
                left = right;
                best = self.data[right].clone();
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

#[derive(Clone, Copy)]
struct Segment {
    left: usize,
    right: usize,
}

/// `testSegmentIntersect`; `None` for upstream's `false`.
fn test_segment_intersect(events: &[SweepEvent], s1: Segment, s2: Segment) -> Option<Position> {
    let (l1, r1, l2, r2) = (
        &events[s1.left],
        &events[s1.right],
        &events[s2.left],
        &events[s2.right],
    );
    let (x1, y1, x2, y2) = (l1.x, l1.y, r1.x, r1.y);
    let (x3, y3, x4, y4) = (l2.x, l2.y, r2.x, r2.y);

    let orient = |cx: f64, cy: f64| -> f64 {
        robust::orient2d(
            robust::Coord { x: x1, y: y1 },
            robust::Coord { x: x2, y: y2 },
            robust::Coord { x: cx, y: cy },
        )
    };
    let score1 = orient(x3, y3);
    let score2 = orient(x4, y4);
    if score1 > 0.0 && score2 > 0.0 {
        return None;
    } else if score1 < 0.0 && score2 < 0.0 {
        return None;
    }

    if l1.ring_id == l2.ring_id {
        if r1.same_point(l2) || r1.same_point(r2) || l1.same_point(l2) || l1.same_point(r2) {
            return None;
        }
    } else {
        if r1.same_point(l2) {
            return Some([l2.x, l2.y]);
        }
        if r1.same_point(r2) {
            return Some([r2.x, r2.y]);
        }
        if l1.same_point(l2) {
            return Some([l2.x, l2.y]);
        }
        if l1.same_point(r2) {
            return Some([r2.x, r2.y]);
        }
    }

    let denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    let nume_a = (x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3);
    if denom == 0.0 {
        return None;
    }
    let u_a = nume_a / denom;
    let nume_b = (x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3);
    let u_b = nume_b / denom;
    if (0.0..=1.0).contains(&u_a) && (0.0..=1.0).contains(&u_b) {
        let x = x1 + u_a * (x2 - x1);
        let y = y1 + u_a * (y2 - y1);
        return Some([x, y]);
    }
    None
}

/// `lineIntersect` over features, each a list of lines/rings, with `removeDuplicates` and
/// `ignoreSelfIntersections` on (the defaults). Returns the distinct intersection points in
/// the order found.
fn line_intersect(features: &[Vec<&[Position]>]) -> Vec<Position> {
    // Build events as upstream's `fillEventQueue` does.
    let mut events: Vec<SweepEvent> = Vec::new();
    let mut ring_id = 0u32;
    let mut order: Vec<usize> = Vec::new(); // indexes into `events`, in insertion order
    for (feature_id, lines) in features.iter().enumerate() {
        for line in lines {
            if line.is_empty() {
                continue;
            }
            ring_id += 1;
            let mut current = line[0];
            for next in line.iter().skip(1) {
                let e1 = events.len();
                let e2 = e1 + 1;
                events.push(SweepEvent {
                    x: current[0],
                    y: current[1],
                    feature_id: feature_id as u32,
                    ring_id,
                    other: e2,
                    is_left_endpoint: None,
                });
                events.push(SweepEvent {
                    x: next[0],
                    y: next[1],
                    feature_id: feature_id as u32,
                    ring_id,
                    other: e1,
                    is_left_endpoint: None,
                });
                if event_order(&events[e1], &events[e2]) > 0 {
                    events[e2].is_left_endpoint = Some(true);
                    events[e1].is_left_endpoint = Some(false);
                } else {
                    events[e1].is_left_endpoint = Some(true);
                    events[e2].is_left_endpoint = Some(false);
                }
                order.push(e1);
                order.push(e2);
                current = *next;
            }
        }
    }

    // The event queue holds event indexes; the comparator reads the (now final) events.
    let snapshot = events.clone();
    let mut event_queue =
        TinyQueue::new(|a: &usize, b: &usize| event_order(&snapshot[*a], &snapshot[*b]));
    for index in order {
        event_queue.push(index);
    }

    let segment_order = |a: &Segment, b: &Segment| -> i32 {
        let (r1, r2) = (&snapshot[a.right], &snapshot[b.right]);
        if r1.x > r2.x {
            return 1;
        }
        if r1.x < r2.x {
            return -1;
        }
        if r1.y != r2.y {
            return if r1.y < r2.y { 1 } else { -1 };
        }
        1
    };
    let mut out_queue = TinyQueue::new(segment_order);

    let mut points: Vec<Position> = Vec::new();
    while event_queue.len() > 0 {
        let event_index = event_queue.pop().expect("non-empty");
        match snapshot[event_index].is_left_endpoint {
            Some(true) => {
                let segment = Segment {
                    left: event_index,
                    right: snapshot[event_index].other,
                };
                for other in out_queue.data.clone() {
                    if snapshot[other.left].feature_id == snapshot[event_index].feature_id {
                        continue;
                    }
                    if let Some(point) = test_segment_intersect(&snapshot, segment, other) {
                        points.push(point);
                    }
                }
                out_queue.push(segment);
            }
            Some(false) => {
                out_queue.pop();
            }
            None => {}
        }
    }

    let mut seen = HashSet::new();
    points
        .into_iter()
        .filter(|p| {
            seen.insert(format!(
                "{},{}",
                js_number_to_string(p[0]),
                js_number_to_string(p[1])
            ))
        })
        .collect()
}

// ---------------------------------------------------------------------------------------
// boolean-valid
// ---------------------------------------------------------------------------------------

fn rings_close(ring: &[Position]) -> bool {
    ring[0][0] == ring[ring.len() - 1][0] && ring[0][1] == ring[ring.len() - 1][1]
}

/// `checkRingsForSpikesPunctures`: some vertex lies on a later, non-adjacent segment.
fn has_spikes_or_punctures(ring: &[Position]) -> bool {
    for i in 0..ring.len().saturating_sub(1) {
        let point = ring[i];
        let mut ii = i + 1;
        while ii + 2 < ring.len() {
            if point_on_segment(ring[ii], ring[ii + 1], point) {
                return true;
            }
            ii += 1;
        }
    }
    false
}

/// A polygon as turf's `polygon([...])` feature, for the intersection helpers.
type Rings = Vec<Vec<Position>>;

fn in_polygon(pt: Position, polygon: &Rings) -> bool {
    let rings: Vec<&[[f64; 2]]> = polygon.iter().map(Vec::as_slice).collect();
    point_in_polygon(pt[0], pt[1], &rings) != Containment::Outside
}

/// `isPolyInPoly(feature1, feature2)` from `boolean-disjoint`: the polygons intersect.
fn polygons_intersect(feature1: &Rings, feature2: &Rings) -> bool {
    if feature1[0].iter().any(|&c| in_polygon(c, feature2)) {
        return true;
    }
    if feature2[0].iter().any(|&c| in_polygon(c, feature1)) {
        return true;
    }
    let lines1: Vec<&[Position]> = feature1.iter().map(Vec::as_slice).collect();
    let lines2: Vec<&[Position]> = feature2.iter().map(Vec::as_slice).collect();
    !line_intersect(&[lines1, lines2]).is_empty()
}

/// `checkPolygonAgainstOthers`.
fn polygon_clear_of_later_ones(polygon: &Rings, all: &[Rings], index: usize) -> bool {
    for other in all.iter().skip(index + 1) {
        // `booleanDisjoint(polyToCheck, polygon(geom[i]))`, which is `!isPolyInPoly(second, first)`.
        let disjoint = !polygons_intersect(other, polygon);
        if !disjoint {
            // `booleanCrosses(polyToCheck, lineString(geom[i][0]))`: the other polygon's
            // outer ring against this polygon's boundary.
            let ring: &[Position] = &other[0];
            let boundary: Vec<&[Position]> = polygon.iter().map(Vec::as_slice).collect();
            if !line_intersect(&[vec![ring], boundary]).is_empty() {
                return false;
            }
        }
    }
    true
}

fn polygon_rings_valid(rings: &Rings) -> bool {
    for (i, ring) in rings.iter().enumerate() {
        if ring.len() < 4 || !rings_close(ring) || has_spikes_or_punctures(ring) {
            return false;
        }
        if i > 0 {
            let outer: Vec<&[Position]> = vec![&rings[0]];
            let hole: Vec<&[Position]> = vec![ring];
            if line_intersect(&[outer, hole]).len() > 1 {
                return false;
            }
        }
    }
    true
}

/// `booleanValid` for the geometry types the pipeline produces.
pub fn is_valid(geometry: &Geometry) -> bool {
    match geometry {
        Geometry::Point(_) => true,
        Geometry::LineString(line) => line.len() >= 2,
        Geometry::MultiLineString(lines) => !lines.is_empty() && lines.iter().all(|l| l.len() >= 2),
        Geometry::Polygon(rings) => polygon_rings_valid(rings),
        Geometry::MultiPolygon(polygons) => {
            for (i, polygon) in polygons.iter().enumerate() {
                for (ii, ring) in polygon.iter().enumerate() {
                    if ring.len() < 4 || !rings_close(ring) || has_spikes_or_punctures(ring) {
                        return false;
                    }
                    if ii == 0 && !polygon_clear_of_later_ones(polygon, polygons, i) {
                        return false;
                    }
                    if ii > 0 {
                        let outer: Vec<&[Position]> = vec![&polygon[0]];
                        let hole: Vec<&[Position]> = vec![ring];
                        if line_intersect(&[outer, hole]).len() > 1 {
                            return false;
                        }
                    }
                }
            }
            true
        }
    }
}
