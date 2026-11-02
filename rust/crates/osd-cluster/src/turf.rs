//! The turf functions the clustering stage uses, ported with their arithmetic intact.
//!
//! Ski area geometry, lengths and (later) station snapping all go through turf, and the
//! results are written to the output, so these keep turf's own formulas -- haversine distance
//! with its modulo-360 degree reduction, `destination` via `asin`/`atan2` -- rather than
//! using the closest equivalent from a Rust geodesy crate.

use osd_osm::element::{Geometry, Position};
use std::f64::consts::PI;

/// `earthRadius` in `@turf/helpers`.
const EARTH_RADIUS_M: f64 = 6_371_008.8;

/// `degreesToRadians`: reduced modulo 360 first, with JavaScript's `%`.
fn degrees_to_radians(degrees: f64) -> f64 {
    (degrees % 360.0) * PI / 180.0
}

/// `radiansToDegrees`: reduced modulo 2 pi first.
fn radians_to_degrees(radians: f64) -> f64 {
    (radians % (2.0 * PI)) * 180.0 / PI
}

/// `@turf/distance`: haversine distance in kilometres.
pub fn distance_km(from: Position, to: Position) -> f64 {
    let d_lat = degrees_to_radians(to[1] - from[1]);
    let d_lon = degrees_to_radians(to[0] - from[0]);
    let lat1 = degrees_to_radians(from[1]);
    let lat2 = degrees_to_radians(to[1]);
    let a = (d_lat / 2.0).sin().powi(2) + (d_lon / 2.0).sin().powi(2) * lat1.cos() * lat2.cos();
    2.0 * a.sqrt().atan2((1.0 - a).sqrt()) * (EARTH_RADIUS_M / 1000.0)
}

fn path_length(positions: &[Position]) -> f64 {
    positions
        .windows(2)
        .fold(0.0, |sum, pair| sum + distance_km(pair[0], pair[1]))
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

/// `@turf/bearing`, in degrees.
pub fn bearing(start: Position, end: Position) -> f64 {
    let lon1 = degrees_to_radians(start[0]);
    let lon2 = degrees_to_radians(end[0]);
    let lat1 = degrees_to_radians(start[1]);
    let lat2 = degrees_to_radians(end[1]);
    let a = (lon2 - lon1).sin() * lat2.cos();
    let b = lat1.cos() * lat2.sin() - lat1.sin() * lat2.cos() * (lon2 - lon1).cos();
    radians_to_degrees(a.atan2(b))
}

/// `@turf/destination` for a distance in kilometres.
pub fn destination_km(origin: Position, distance_km: f64, bearing_degrees: f64) -> Position {
    let longitude1 = degrees_to_radians(origin[0]);
    let latitude1 = degrees_to_radians(origin[1]);
    let bearing_rad = degrees_to_radians(bearing_degrees);
    let radians = distance_km / (EARTH_RADIUS_M / 1000.0);

    let latitude2 = (latitude1.sin() * radians.cos()
        + latitude1.cos() * radians.sin() * bearing_rad.cos())
    .asin();
    let longitude2 = longitude1
        + (bearing_rad.sin() * radians.sin() * latitude1.cos())
            .atan2(radians.cos() - latitude1.sin() * latitude2.sin());
    [
        radians_to_degrees(longitude2),
        radians_to_degrees(latitude2),
    ]
}

/// `@turf/along`: the point a distance in kilometres along a line.
pub fn along(coords: &[Position], distance: f64) -> Position {
    let mut travelled = 0.0;
    for i in 0..coords.len() {
        if distance >= travelled && i == coords.len() - 1 {
            break;
        } else if travelled >= distance {
            let overshot = distance - travelled;
            if overshot == 0.0 {
                return coords[i];
            }
            let direction = bearing(coords[i], coords[i - 1]) - 180.0;
            return destination_km(coords[i], overshot, direction);
        } else {
            travelled += distance_km(coords[i], coords[i + 1]);
        }
    }
    coords[coords.len() - 1]
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
