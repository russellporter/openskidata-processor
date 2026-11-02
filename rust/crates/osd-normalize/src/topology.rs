//! TopoJSON topology construction, ported from `topojson-server@3.0.1`.
//!
//! Replaces the `topojsonServer.topology()` call in `RunNormalizerAccumulator.ts`, and the
//! `topojson-client` decoding (`feature`) that follows it.
//!
//! The pipeline is the library's own: [`extract`] lays every line and ring into one shared
//! coordinate buffer, [`join`] finds the *junctions* -- points where one arc deviates from
//! another passing through the same place -- [`cut`] splits lines there (rings are rotated
//! to start at their first junction instead, so they stay closed when they can), and
//! [`dedup`] collapses duplicate arcs, forwards or backwards, into one.
//!
//! # Why a faithful port rather than a simpler algorithm
//!
//! What this decides is where runs get split, and that reaches the output: a run is cut at
//! each junction, and the pieces are then merged or joined by property. Several rules look
//! simplifiable and are not:
//!
//! - A point's neighbour pair is compared against the **first** pair seen, not the set of
//!   pairs seen, so the junction decision depends on visiting order (lines before rings,
//!   input order within each).
//! - Visiting a point twice within one arc is ignored entirely (self-intersection), so a
//!   figure-eight is not cut at its crossing unless another arc passes through too.
//! - Ring dedup needs a canonical start (the lexicographically smallest point) so that a
//!   ring and a rotated copy of it are recognised as the same ring.
//!
//! # Coordinates
//!
//! Points are [`FixedCoord`]. Upstream compares `x` and `y` as floats with `===`; on the
//! 1e-7 grid that the store snaps to, equality of fixed-point values is the same relation.
//! The oracle scenes are generated on that grid, so any difference found there is a bug and
//! not the documented snapping divergence.
//!
//! # Preconditions
//!
//! Every line and every ring has at least two points -- guaranteed upstream by
//! `isValidGeometryInFeature`. A line of fewer than two points would, in upstream's
//! `join`, mark an unrelated neighbouring coordinate as a junction; that is a quirk of
//! reading past the line's end, and it is refused here instead of reproduced.

use osd_store::FixedCoord;
use std::collections::{HashMap, HashSet};

/// A geometry going into the topology.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputGeometry {
    Line(Vec<FixedCoord>),
    /// Rings, each closed (first point equals last).
    Polygon(Vec<Vec<FixedCoord>>),
}

/// A geometry in the topology: signed arc indexes, where a negative index `i` means arc
/// `!i` walked backwards (TopoJSON's `~i`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TopoGeometry {
    Line(Vec<i32>),
    Polygon(Vec<Vec<i32>>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Topology {
    pub arcs: Vec<Vec<FixedCoord>>,
    pub geometries: Vec<TopoGeometry>,
    /// The object identity of every point of every arc, parallel to `arcs`.
    ///
    /// Two points with the same identity are the same JavaScript array upstream. That
    /// happens where a ring was rotated (its closing point is aliased to its first), where a
    /// ring walks the same arc twice, and where rings share an arc -- and `topojson-client`
    /// returns those arrays without copying, so the decoded polygon contains the same
    /// array more than once. `object-hash` writes each repeat as a back-reference, so it
    /// changes the polygon's id. See `osd_store::feature_id`.
    pub arc_objects: Vec<Vec<u32>>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum TopologyError {
    #[error("geometry {index} has a line with fewer than two points")]
    ShortLine { index: usize },
    #[error("geometry {index} has a ring with fewer than two points")]
    ShortRing { index: usize },
}

/// An inclusive range into the shared coordinate buffer.
///
/// `start > end` is meaningful after [`dedup`]: it marks an arc that duplicates an earlier
/// one run backwards.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Piece {
    start: usize,
    end: usize,
}

/// One extracted line or ring, as the chain of pieces it is cut into.
struct Chain {
    pieces: Vec<Piece>,
}

struct Extracted {
    coordinates: Vec<FixedCoord>,
    /// The identity of the JavaScript array each coordinate slot holds, parallel to
    /// `coordinates`. Upstream shares coordinate arrays between slots (a rotated ring's
    /// closing point *is* its first point) and hands them back from decoding, which matters
    /// for ids: see [`Topology::arc_objects`].
    objects: Vec<u32>,
    lines: Vec<Chain>,
    rings: Vec<Chain>,
    /// For each input geometry, the indexes into `lines` / `rings` that it consists of.
    geometry_parts: Vec<Vec<usize>>,
}

fn extract(input: &[InputGeometry]) -> Result<Extracted, TopologyError> {
    let mut coordinates = Vec::new();
    let mut lines = Vec::new();
    let mut rings = Vec::new();
    let mut geometry_parts = Vec::with_capacity(input.len());

    for (index, geometry) in input.iter().enumerate() {
        match geometry {
            InputGeometry::Line(points) => {
                if points.len() < 2 {
                    return Err(TopologyError::ShortLine { index });
                }
                let start = coordinates.len();
                coordinates.extend_from_slice(points);
                lines.push(Chain {
                    pieces: vec![Piece {
                        start,
                        end: coordinates.len() - 1,
                    }],
                });
                geometry_parts.push(vec![lines.len() - 1]);
            }
            InputGeometry::Polygon(polygon) => {
                let mut parts = Vec::with_capacity(polygon.len());
                for ring in polygon {
                    if ring.len() < 2 {
                        return Err(TopologyError::ShortRing { index });
                    }
                    let start = coordinates.len();
                    coordinates.extend_from_slice(ring);
                    rings.push(Chain {
                        pieces: vec![Piece {
                            start,
                            end: coordinates.len() - 1,
                        }],
                    });
                    parts.push(rings.len() - 1);
                }
                geometry_parts.push(parts);
            }
        }
    }

    let objects = (0..coordinates.len() as u32).collect();
    Ok(Extracted {
        coordinates,
        objects,
        lines,
        rings,
        geometry_parts,
    })
}

/// Identifies the junctions: points where arcs must be cut.
///
/// A junction is a point where at least one arc deviates from another arc through the same
/// point. With an arc through ABC and another through CBA, B is not a junction -- in both
/// the adjacent pair is {A, C}. Add an arc ABD and it is. The first and last point of a
/// line are always junctions, so a closed line is never rotated.
fn join(extracted: &Extracted) -> HashSet<FixedCoord> {
    let coordinates = &extracted.coordinates;

    // The first index of each distinct point, so comparisons are between integers.
    let mut first_index: HashMap<FixedCoord, usize> = HashMap::with_capacity(coordinates.len());
    let indexes: Vec<usize> = coordinates
        .iter()
        .enumerate()
        .map(|(i, &point)| *first_index.entry(point).or_insert(i))
        .collect();

    const NONE: i64 = -1;
    let mut visited = vec![NONE; coordinates.len()];
    let mut left = vec![NONE; coordinates.len()];
    let mut right = vec![NONE; coordinates.len()];
    let mut junction = vec![false; coordinates.len()];

    let mut sequence = |arc: usize,
                        previous: usize,
                        current: usize,
                        next: usize,
                        visited: &mut Vec<i64>,
                        junction: &mut Vec<bool>| {
        if visited[current] == arc as i64 {
            return; // self-intersection
        }
        visited[current] = arc as i64;
        let left_index = left[current];
        if left_index >= 0 {
            let right_index = right[current];
            let (previous, next) = (previous as i64, next as i64);
            if (left_index != previous || right_index != next)
                && (left_index != next || right_index != previous)
            {
                junction[current] = true;
            }
        } else {
            left[current] = previous as i64;
            right[current] = next as i64;
        }
    };

    for (i, line) in extracted.lines.iter().enumerate() {
        let piece = line.pieces[0];
        let mut line_start = piece.start;
        let mut current = indexes[line_start];
        junction[current] = true; // start
        line_start += 1;
        let mut next = indexes[line_start];
        loop {
            line_start += 1;
            if line_start > piece.end {
                break;
            }
            let previous = current;
            current = next;
            next = indexes[line_start];
            sequence(i, previous, current, next, &mut visited, &mut junction);
        }
        junction[next] = true; // end
    }

    visited.iter_mut().for_each(|v| *v = NONE);

    for (i, ring) in extracted.rings.iter().enumerate() {
        let piece = ring.pieces[0];
        let mut ring_start = piece.start + 1;
        let ring_end = piece.end;
        let mut previous = indexes[ring_end - 1];
        let mut current = indexes[ring_start - 1];
        let mut next = indexes[ring_start];
        sequence(i, previous, current, next, &mut visited, &mut junction);
        loop {
            ring_start += 1;
            if ring_start > ring_end {
                break;
            }
            previous = current;
            current = next;
            next = indexes[ring_start];
            sequence(i, previous, current, next, &mut visited, &mut junction);
        }
    }

    coordinates
        .iter()
        .enumerate()
        .filter(|&(i, _)| junction[indexes[i]])
        .map(|(_, &point)| point)
        .collect()
}

/// Reverses `array[start..end]`.
fn reverse<T>(array: &mut [T], start: usize, end: usize) {
    array[start..end].reverse();
}

/// Rotates `array[start..end]` so the element at `end - offset` comes first, by three
/// reversals as upstream does. `array[end]` is left alone.
fn rotate<T>(array: &mut [T], start: usize, end: usize, offset: usize) {
    reverse(array, start, end);
    reverse(array, start, start + offset);
    reverse(array, start + offset, end);
}

/// Cuts lines at junctions; cuts rings there too, except the first junction of an
/// unfixed ring, where it rotates the ring to start there instead.
fn cut(extracted: &mut Extracted, junctions: &HashSet<FixedCoord>) {
    let coordinates = &mut extracted.coordinates;
    let objects = &mut extracted.objects;

    for line in &mut extracted.lines {
        let piece = line.pieces[0];
        let mut pieces = Vec::new();
        let mut piece_start = piece.start;
        let mut mid = piece.start;
        loop {
            mid += 1;
            if mid >= piece.end {
                break;
            }
            if junctions.contains(&coordinates[mid]) {
                pieces.push(Piece {
                    start: piece_start,
                    end: mid,
                });
                piece_start = mid;
            }
        }
        pieces.push(Piece {
            start: piece_start,
            end: piece.end,
        });
        line.pieces = pieces;
    }

    for ring in &mut extracted.rings {
        let whole = ring.pieces[0];
        let ring_start = whole.start;
        let ring_end = whole.end;
        let mut ring_mid = ring_start;
        let mut fixed = junctions.contains(&coordinates[ring_start]);
        let mut pieces = Vec::new();
        let mut piece_start = ring_start;
        loop {
            ring_mid += 1;
            if ring_mid >= ring_end {
                break;
            }
            if junctions.contains(&coordinates[ring_mid]) {
                if fixed {
                    pieces.push(Piece {
                        start: piece_start,
                        end: ring_mid,
                    });
                    piece_start = ring_mid;
                } else {
                    // The first junction: rotate rather than cut.
                    rotate(coordinates, ring_start, ring_end, ring_end - ring_mid);
                    // The slots' identities are not rotated with the coordinates: within a
                    // ring they are all distinct, so permuting them would only relabel them.
                    // What matters is that the closing slot is now the *same object* as the
                    // first, which is upstream's `coordinates[ringEnd] = coordinates[ringStart]`.
                    coordinates[ring_end] = coordinates[ring_start];
                    objects[ring_end] = objects[ring_start];
                    fixed = true;
                    ring_mid = ring_start; // restart; we may have skipped junctions
                }
            }
        }
        pieces.push(Piece {
            start: piece_start,
            end: ring_end,
        });
        ring.pieces = pieces;
    }
}

/// Collapses duplicate arcs. Returns the unique arcs, in order of first appearance.
fn dedup(extracted: &mut Extracted) -> Vec<Piece> {
    let coordinates = &extracted.coordinates;
    let mut arcs: Vec<Piece> = Vec::new();
    let mut arcs_by_end: HashMap<FixedCoord, Vec<Piece>> = HashMap::new();

    let equal_line = |a: Piece, b: Piece| -> bool {
        let (mut ia, ja, mut ib) = (a.start as i64, a.end as i64, b.start as i64);
        if ia - ja != ib - b.end as i64 {
            return false;
        }
        while ia <= ja {
            if coordinates[ia as usize] != coordinates[ib as usize] {
                return false;
            }
            ia += 1;
            ib += 1;
        }
        true
    };

    let reverse_equal_line = |a: Piece, b: Piece| -> bool {
        let (mut ia, ja, mut jb) = (a.start as i64, a.end as i64, b.end as i64);
        if ia - ja != b.start as i64 - jb {
            return false;
        }
        while ia <= ja {
            if coordinates[ia as usize] != coordinates[jb as usize] {
                return false;
            }
            ia += 1;
            jb -= 1;
        }
        true
    };

    // Rings are rotated to a consistent, but arbitrary, start point, so that a ring and a
    // rotated copy of it can be recognised as the same ring.
    let minimum_offset = |arc: Piece| -> usize {
        let mut minimum = arc.start;
        let mut minimum_point = coordinates[minimum];
        let mut mid = arc.start;
        loop {
            mid += 1;
            if mid >= arc.end {
                break;
            }
            let point = coordinates[mid];
            if point.lng < minimum_point.lng
                || (point.lng == minimum_point.lng && point.lat < minimum_point.lat)
            {
                minimum = mid;
                minimum_point = point;
            }
        }
        minimum - arc.start
    };

    let equal_ring = |a: Piece, b: Piece| -> bool {
        let n = a.end - a.start;
        if n != b.end - b.start {
            return false;
        }
        let (ka, kb) = (minimum_offset(a), minimum_offset(b));
        (0..n).all(|i| coordinates[a.start + (i + ka) % n] == coordinates[b.start + (i + kb) % n])
    };

    let reverse_equal_ring = |a: Piece, b: Piece| -> bool {
        let n = a.end - a.start;
        if n != b.end - b.start {
            return false;
        }
        let ka = minimum_offset(a);
        let kb = n - minimum_offset(b);
        (0..n).all(|i| coordinates[a.start + (i + ka) % n] == coordinates[b.end - (i + kb) % n])
    };

    // `arcs_by_end` entries are looked up by value and the pieces in them are never
    // modified once registered, so storing copies is equivalent to upstream's shared refs.
    let dedup_line = |arc: &mut Piece,
                      arcs: &mut Vec<Piece>,
                      arcs_by_end: &mut HashMap<FixedCoord, Vec<Piece>>| {
        let start_point = coordinates[arc.start];
        let end_point = coordinates[arc.end];

        if let Some(start_arcs) = arcs_by_end.get(&start_point) {
            if let Some(&found) = start_arcs
                .iter()
                .find(|&&candidate| equal_line(candidate, *arc))
            {
                *arc = found;
                return;
            }
        }

        if let Some(end_arcs) = arcs_by_end.get(&end_point) {
            if let Some(&found) = end_arcs
                .iter()
                .find(|&&candidate| reverse_equal_line(candidate, *arc))
            {
                *arc = Piece {
                    start: found.end,
                    end: found.start,
                };
                return;
            }
        }

        arcs_by_end.entry(start_point).or_default().push(*arc);
        if end_point != start_point {
            arcs_by_end.entry(end_point).or_default().push(*arc);
        }
        arcs.push(*arc);
    };

    let dedup_ring = |arc: &mut Piece,
                      arcs: &mut Vec<Piece>,
                      arcs_by_end: &mut HashMap<FixedCoord, Vec<Piece>>| {
        // Does this arc match an existing line in order, or reverse order? Rings are
        // closed, so their start point and end point are the same.
        let start_point = coordinates[arc.start];
        if let Some(candidates) = arcs_by_end.get(&start_point) {
            for &candidate in candidates {
                if equal_ring(candidate, *arc) {
                    *arc = candidate;
                    return;
                }
                if reverse_equal_ring(candidate, *arc) {
                    *arc = Piece {
                        start: candidate.end,
                        end: candidate.start,
                    };
                    return;
                }
            }
        }

        // Otherwise, does it match an existing ring in order, or reverse order, keyed by
        // its canonical (smallest) point?
        let key_point = coordinates[arc.start + minimum_offset(*arc)];
        if let Some(candidates) = arcs_by_end.get(&key_point) {
            for &candidate in candidates {
                if equal_ring(candidate, *arc) {
                    *arc = candidate;
                    return;
                }
                if reverse_equal_ring(candidate, *arc) {
                    *arc = Piece {
                        start: candidate.end,
                        end: candidate.start,
                    };
                    return;
                }
            }
        }

        arcs_by_end.entry(key_point).or_default().push(*arc);
        arcs.push(*arc);
    };

    for line in &mut extracted.lines {
        for piece in &mut line.pieces {
            dedup_line(piece, &mut arcs, &mut arcs_by_end);
        }
    }
    for ring in &mut extracted.rings {
        if ring.pieces.len() > 1 {
            // No longer closed: the ring was cut, so its pieces are lines.
            for piece in &mut ring.pieces {
                dedup_line(piece, &mut arcs, &mut arcs_by_end);
            }
        } else {
            dedup_ring(&mut ring.pieces[0], &mut arcs, &mut arcs_by_end);
        }
    }

    arcs
}

/// Builds the topology of `input`.
pub fn topology(input: &[InputGeometry]) -> Result<Topology, TopologyError> {
    let mut extracted = extract(input)?;
    let junctions = join(&extracted);
    cut(&mut extracted, &junctions);
    let arcs = dedup(&mut extracted);

    let mut index_by_arc: HashMap<(usize, usize), i32> = HashMap::with_capacity(arcs.len());
    for (i, arc) in arcs.iter().enumerate() {
        index_by_arc.insert((arc.start.min(arc.end), arc.start.max(arc.end)), i as i32);
    }

    let index_pieces = |chain: &Chain| -> Vec<i32> {
        chain
            .pieces
            .iter()
            .map(|piece| {
                let index = index_by_arc[&(piece.start.min(piece.end), piece.start.max(piece.end))];
                if piece.start < piece.end {
                    index
                } else {
                    !index
                }
            })
            .collect()
    };

    let geometries = input
        .iter()
        .zip(&extracted.geometry_parts)
        .map(|(geometry, parts)| match geometry {
            InputGeometry::Line(_) => TopoGeometry::Line(index_pieces(&extracted.lines[parts[0]])),
            InputGeometry::Polygon(_) => TopoGeometry::Polygon(
                parts
                    .iter()
                    .map(|&ring| index_pieces(&extracted.rings[ring]))
                    .collect(),
            ),
        })
        .collect();

    let arc_objects = arcs
        .iter()
        .map(|arc| extracted.objects[arc.start.min(arc.end)..=arc.start.max(arc.end)].to_vec())
        .collect();

    let arcs = arcs
        .iter()
        .map(|arc| extracted.coordinates[arc.start..=arc.end].to_vec())
        .collect();

    Ok(Topology {
        arcs,
        geometries,
        arc_objects,
    })
}

impl Topology {
    /// The points of one arc reference, with their identities, reversed if negative.
    fn arc_points(&self, reference: i32) -> Vec<(FixedCoord, u32)> {
        let index = if reference < 0 { !reference } else { reference } as usize;
        let mut points: Vec<(FixedCoord, u32)> = self.arcs[index]
            .iter()
            .copied()
            .zip(self.arc_objects[index].iter().copied())
            .collect();
        if reference < 0 {
            points.reverse();
        }
        points
    }

    /// Stitches arcs into a line, dropping the repeated point at each junction.
    ///
    /// `topojson-client`'s `line`: each arc after the first replaces the previous arc's
    /// last point (which is the same point), and a result under two points is padded.
    fn line_points(&self, references: &[i32]) -> Vec<(FixedCoord, u32)> {
        let mut points: Vec<(FixedCoord, u32)> = Vec::new();
        for &reference in references {
            if !points.is_empty() {
                points.pop();
            }
            points.extend(self.arc_points(reference));
        }
        if points.len() < 2 {
            points.push(points[0]);
        }
        points
    }

    /// `topojson-client`'s `ring`: a line padded to at least four points.
    fn ring_points(&self, references: &[i32]) -> Vec<(FixedCoord, u32)> {
        let mut points = self.line_points(references);
        while points.len() < 4 {
            points.push(points[0]);
        }
        points
    }

    pub fn line_coordinates(&self, references: &[i32]) -> Vec<FixedCoord> {
        self.line_points(references)
            .into_iter()
            .map(|(coordinate, _)| coordinate)
            .collect()
    }

    pub fn ring_coordinates(&self, references: &[i32]) -> Vec<FixedCoord> {
        self.ring_points(references)
            .into_iter()
            .map(|(coordinate, _)| coordinate)
            .collect()
    }

    /// The identity of each point of a decoded ring (see [`Self::arc_objects`]).
    pub fn ring_objects(&self, references: &[i32]) -> Vec<u32> {
        self.ring_points(references)
            .into_iter()
            .map(|(_, object)| object)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(lng: i32, lat: i32) -> FixedCoord {
        FixedCoord { lng, lat }
    }

    fn line(points: &[(i32, i32)]) -> InputGeometry {
        InputGeometry::Line(points.iter().map(|&(x, y)| p(x, y)).collect())
    }

    #[test]
    fn a_lone_line_is_one_arc() {
        let topology = topology(&[line(&[(0, 0), (1, 0), (2, 0)])]).unwrap();
        assert_eq!(topology.arcs.len(), 1);
        assert_eq!(topology.geometries, vec![TopoGeometry::Line(vec![0])]);
    }

    #[test]
    fn a_reversed_duplicate_shares_the_arc_backwards() {
        let topology = topology(&[
            line(&[(0, 0), (1, 0), (2, 0)]),
            line(&[(2, 0), (1, 0), (0, 0)]),
        ])
        .unwrap();
        assert_eq!(topology.arcs.len(), 1);
        assert_eq!(
            topology.geometries,
            vec![TopoGeometry::Line(vec![0]), TopoGeometry::Line(vec![!0])]
        );
    }

    #[test]
    fn a_deviating_arc_makes_the_shared_point_a_junction() {
        // B=(1,0) is shared by ABC, CBA and ABD; ABD makes it a junction.
        let topology = topology(&[
            line(&[(0, 0), (1, 0), (2, 0)]),
            line(&[(0, 0), (1, 0), (1, 1)]),
        ])
        .unwrap();
        // ABC is cut at B into AB and BC; ABD into AB (shared) and BD.
        assert_eq!(topology.arcs.len(), 3);
        assert_eq!(topology.geometries[0], TopoGeometry::Line(vec![0, 1]));
        assert_eq!(topology.geometries[1], TopoGeometry::Line(vec![0, 2]));
    }

    #[test]
    fn stitching_drops_the_repeated_junction_point() {
        let topology = topology(&[
            line(&[(0, 0), (1, 0), (2, 0)]),
            line(&[(0, 0), (1, 0), (1, 1)]),
        ])
        .unwrap();
        let TopoGeometry::Line(references) = &topology.geometries[0] else {
            panic!()
        };
        assert_eq!(
            topology.line_coordinates(references),
            vec![p(0, 0), p(1, 0), p(2, 0)]
        );
    }

    #[test]
    fn a_line_shorter_than_two_points_is_refused() {
        assert_eq!(
            topology(&[line(&[(0, 0)])]),
            Err(TopologyError::ShortLine { index: 0 })
        );
    }
}
