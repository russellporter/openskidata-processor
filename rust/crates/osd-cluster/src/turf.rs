//! The turf functions the clustering stage uses, ported with their arithmetic intact.
//!
//! Ski area geometry, lengths and (later) station snapping all go through turf, and the
//! results are written to the output, so these keep turf's own formulas -- haversine distance
//! with its modulo-360 degree reduction, `destination` via `asin`/`atan2` -- rather than
//! using the closest equivalent from a Rust geodesy crate.

use osd_osm::element::{Geometry, Position};

use osd_turf::{Units, path_length as turf_path_length};
pub use osd_turf::{
    along, bearing, degrees_to_radians, destination_km, distance_km, radians_to_degrees,
};

fn path_length(positions: &[Position]) -> f64 {
    turf_path_length(positions, Units::Kilometers)
}

/// `@turf/length` in kilometres: the sum of the geodesic lengths of every segment, of every
/// line and every polygon ring.
pub fn length_km(geometry: &Geometry) -> f64 {
    match geometry {
        Geometry::Point(_) => 0.0,
        Geometry::LineString(line) => path_length(line),
        Geometry::MultiLineString(lines) => {
            lines.iter().fold(0.0, |sum, line| sum + path_length(line))
        }
        Geometry::Polygon(rings) => rings.iter().fold(0.0, |sum, ring| sum + path_length(ring)),
        Geometry::MultiPolygon(polygons) => polygons.iter().fold(0.0, |sum, rings| {
            rings.iter().fold(sum, |sum, ring| sum + path_length(ring))
        }),
    }
}

/// `getPositions`: every position of a geometry, rings and parts flattened.
pub fn positions(geometry: &Geometry) -> Vec<Position> {
    match geometry {
        Geometry::Point(p) => vec![*p],
        Geometry::LineString(l) => l.clone(),
        Geometry::MultiLineString(lines) => lines.iter().flatten().copied().collect(),
        Geometry::Polygon(rings) => rings.iter().flatten().copied().collect(),
        Geometry::MultiPolygon(polygons) => polygons.iter().flatten().flatten().copied().collect(),
    }
}

/// `@turf/centroid` of a geometry collection: the mean of every vertex, not counting the
/// closing vertex of a polygon ring.
pub fn centroid(geometries: &[&Geometry]) -> Position {
    let mut x_sum = 0.0;
    let mut y_sum = 0.0;
    let mut len = 0usize;
    let mut add = |p: &Position| {
        x_sum += p[0];
        y_sum += p[1];
        len += 1;
    };
    for geometry in geometries {
        match geometry {
            Geometry::Point(p) => add(p),
            Geometry::LineString(l) => l.iter().for_each(&mut add),
            Geometry::MultiLineString(lines) => lines.iter().flatten().for_each(&mut add),
            Geometry::Polygon(rings) => {
                for ring in rings {
                    ring[..ring.len() - 1].iter().for_each(&mut add);
                }
            }
            Geometry::MultiPolygon(polygons) => {
                for ring in polygons.iter().flatten() {
                    ring[..ring.len() - 1].iter().for_each(&mut add);
                }
            }
        }
    }
    [x_sum / len as f64, y_sum / len as f64]
}

/// `@turf/nearest-point`: the first of the closest positions.
pub fn nearest_point(target: Position, points: &[Position]) -> Position {
    let mut min = f64::INFINITY;
    let mut best = 0;
    for (index, &point) in points.iter().enumerate() {
        let distance = distance_km(target, point);
        if distance < min {
            best = index;
            min = distance;
        }
    }
    points[best]
}

/// `SkiAreaClusteringService.skiAreaGeometry`: a point inside the cluster of members.
///
/// The centroid of the members' vertices, pulled back to within 100 m of the member vertex
/// nearest to it, so the point lands on the ski area itself rather than in a valley between
/// its parts.
///
/// # Panics
///
/// With no members, where upstream throws.
pub fn ski_area_geometry(members: &[&Geometry]) -> Position {
    assert!(
        !members.is_empty(),
        "No member objects to compute geometry from"
    );
    let centroid_point = centroid(members);
    let all: Vec<Position> = members.iter().flat_map(|g| positions(g)).collect();
    let nearest = nearest_point(centroid_point, &all);
    let line = [nearest, centroid_point];
    if length_km(&Geometry::LineString(line.to_vec())) > 0.1 {
        along(&line, 0.1)
    } else {
        centroid_point
    }
}

// ---------------------------------------------------------------------------------------
// nearestPointOnLine
// ---------------------------------------------------------------------------------------

type Vec3 = [f64; 3];

fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn magnitude(v: Vec3) -> f64 {
    (v[0].powi(2) + v[1].powi(2) + v[2].powi(2)).sqrt()
}

fn normalize(v: Vec3) -> Vec3 {
    let m = magnitude(v);
    [v[0] / m, v[1] / m, v[2] / m]
}

fn lng_lat_to_vector(a: Position) -> Vec3 {
    let lat = degrees_to_radians(a[1]);
    let lng = degrees_to_radians(a[0]);
    [
        libm::cos(lat) * libm::cos(lng),
        libm::cos(lat) * libm::sin(lng),
        libm::sin(lat),
    ]
}

fn vector_to_lng_lat(v: Vec3) -> Position {
    let z = v[2].clamp(-1.0, 1.0);
    [
        radians_to_degrees(libm::atan2(v[1], v[0])),
        radians_to_degrees(libm::asin(z)),
    ]
}

/// The closest point to `c` on the great-circle segment `a`-`b`, and whether it is the end.
fn nearest_point_on_segment(a: Position, b: Position, c: Position) -> (Position, bool) {
    let (va, vb, vc) = (
        lng_lat_to_vector(a),
        lng_lat_to_vector(b),
        lng_lat_to_vector(c),
    );
    let segment_axis = cross(va, vb);
    if segment_axis == [0.0, 0.0, 0.0] {
        return if dot(va, vb) > 0.0 {
            (b, true)
        } else {
            (c, false)
        };
    }
    let target_axis = cross(segment_axis, vc);
    if target_axis == [0.0, 0.0, 0.0] {
        return (b, true);
    }
    let intersection_axis = cross(target_axis, segment_axis);
    let i1 = normalize(intersection_axis);
    let i2 = [-i1[0], -i1[1], -i1[2]];
    let i = if dot(vc, i1) > dot(vc, i2) { i1 } else { i2 };

    let segment_axis_norm = normalize(segment_axis);
    let cmp_ai = dot(cross(va, i), segment_axis_norm);
    let cmp_ib = dot(cross(i, vb), segment_axis_norm);
    if cmp_ai >= 0.0 && cmp_ib >= 0.0 {
        return (vector_to_lng_lat(i), false);
    }
    if dot(va, vc) > dot(vb, vc) {
        (a, false)
    } else {
        (b, true)
    }
}

/// `@turf/nearest-point-on-line` for one line: the closest point on it to `input`, and the
/// distance to it in kilometres.
pub fn nearest_point_on_line(line: &[Position], input: Position) -> (Position, f64) {
    let mut closest = [f64::INFINITY, f64::INFINITY];
    let mut closest_distance = f64::INFINITY;
    for i in 0..line.len().saturating_sub(1) {
        let (start, stop) = (line[i], line[i + 1]);
        let intersect = if stop[0] == input[0] && stop[1] == input[1] {
            stop
        } else if start[0] == input[0] && start[1] == input[1] {
            start
        } else {
            nearest_point_on_segment(start, stop, input).0
        };
        let point_distance = distance_km(input, intersect);
        if point_distance < closest_distance {
            closest = intersect;
            closest_distance = point_distance;
        }
    }
    (closest, closest_distance)
}
