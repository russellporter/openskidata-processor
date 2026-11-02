//! Spatial predicates over geometries, standing in for the PostGIS calls the clustering
//! stage makes.
//!
//! - **Distance** (`ST_DWithin(geography, geography, metres)`): the minimum distance between
//!   two geometries on the WGS84 spheroid. Computed on a local tangent plane built from the
//!   ellipsoid's meridional and prime-vertical radii of curvature at the pair's latitude,
//!   which at the sub-kilometre ranges used here differs from the true geodesic by far less
//!   than a millimetre -- unlike a spherical approximation, which is off by up to 0.4 % at
//!   mid latitudes (2 m at the 500 m clustering threshold). Polygon interiors count: a point
//!   inside a polygon is at distance zero.
//! - **Planar relations** (`ST_Intersects`, `ST_Covers`, `ST_CoveredBy`): evaluated in
//!   longitude/latitude, as PostGIS `geometry` does, with `geo`'s DE-9IM.
//!
//! Not reproduced: `ST_MakeValid`. Invalid polygons are used as given.

use geo::{Intersects, Relate};
use geo_types::{
    Coord, Geometry as GeoGeometry, LineString, MultiLineString, MultiPolygon, Point, Polygon,
};
use osd_osm::element::{Geometry, Position};

const WGS84_A: f64 = 6_378_137.0;
const WGS84_F: f64 = 1.0 / 298.257_223_563;

/// Metres per degree of latitude and of longitude at `lat_degrees`, on the WGS84 ellipsoid.
fn metres_per_degree(lat_degrees: f64) -> (f64, f64) {
    let e2 = WGS84_F * (2.0 - WGS84_F);
    let phi = lat_degrees.to_radians();
    let s = phi.sin();
    let w = 1.0 - e2 * s * s;
    let meridional = WGS84_A * (1.0 - e2) / (w * w.sqrt());
    let prime_vertical = WGS84_A / w.sqrt();
    let per_degree = std::f64::consts::PI / 180.0;
    (
        prime_vertical * phi.cos() * per_degree,
        meridional * per_degree,
    )
}

/// An axis-aligned box in degrees: `[min_lng, min_lat, max_lng, max_lat]`.
pub type BBox = [f64; 4];

pub fn bbox(geometry: &Geometry) -> BBox {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for p in crate::turf::positions(geometry) {
        b[0] = b[0].min(p[0]);
        b[1] = b[1].min(p[1]);
        b[2] = b[2].max(p[0]);
        b[3] = b[3].max(p[1]);
    }
    b
}

/// A box grown by `metres` in every direction, with a margin, for index lookups.
pub fn expand(b: BBox, metres: f64) -> BBox {
    let worst_lat = b[1].abs().max(b[3].abs()).min(89.0);
    let (per_lng, per_lat) = metres_per_degree(worst_lat);
    let d_lng = metres * 1.05 / per_lng.max(1.0);
    let d_lat = metres * 1.05 / per_lat;
    [b[0] - d_lng, b[1] - d_lat, b[2] + d_lng, b[3] + d_lat]
}

#[derive(Clone, Copy)]
struct P {
    x: f64,
    y: f64,
}

struct Shape {
    points: Vec<P>,
    segments: Vec<(P, P)>,
    /// Polygons as rings, outer first.
    polygons: Vec<Vec<Vec<P>>>,
}

fn shape(geometry: &Geometry, project: &impl Fn(Position) -> P) -> Shape {
    let line = |l: &[Position]| -> Vec<P> { l.iter().map(|&p| project(p)).collect() };
    let mut shape = Shape {
        points: Vec::new(),
        segments: Vec::new(),
        polygons: Vec::new(),
    };
    let add_line = |shape: &mut Shape, l: Vec<P>| {
        if l.len() == 1 {
            shape.points.push(l[0]);
        }
        for pair in l.windows(2) {
            shape.segments.push((pair[0], pair[1]));
        }
    };
    match geometry {
        Geometry::Point(p) => shape.points.push(project(*p)),
        Geometry::LineString(l) => add_line(&mut shape, line(l)),
        Geometry::MultiLineString(lines) => {
            for l in lines {
                add_line(&mut shape, line(l));
            }
        }
        Geometry::Polygon(rings) => {
            let rings: Vec<Vec<P>> = rings.iter().map(|r| line(r)).collect();
            for ring in &rings {
                add_line(&mut shape, ring.clone());
            }
            shape.polygons.push(rings);
        }
        Geometry::MultiPolygon(polygons) => {
            for rings in polygons {
                let rings: Vec<Vec<P>> = rings.iter().map(|r| line(r)).collect();
                for ring in &rings {
                    add_line(&mut shape, ring.clone());
                }
                shape.polygons.push(rings);
            }
        }
    }
    shape
}

fn point_segment_distance_sq(p: P, a: P, b: P) -> f64 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let length_sq = dx * dx + dy * dy;
    let t = if length_sq == 0.0 {
        0.0
    } else {
        (((p.x - a.x) * dx + (p.y - a.y) * dy) / length_sq).clamp(0.0, 1.0)
    };
    let cx = a.x + t * dx;
    let cy = a.y + t * dy;
    (p.x - cx).powi(2) + (p.y - cy).powi(2)
}

fn orientation(p: P, q: P, r: P) -> f64 {
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
}

fn segments_cross_or_touch(a1: P, a2: P, b1: P, b2: P) -> bool {
    let d1 = orientation(a1, a2, b1);
    let d2 = orientation(a1, a2, b2);
    let d3 = orientation(b1, b2, a1);
    let d4 = orientation(b1, b2, a2);
    if ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0))
        && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0))
    {
        return true;
    }
    let on_segment = |p: P, q: P, r: P| {
        r.x >= p.x.min(q.x) && r.x <= p.x.max(q.x) && r.y >= p.y.min(q.y) && r.y <= p.y.max(q.y)
    };
    (d1 == 0.0 && on_segment(a1, a2, b1))
        || (d2 == 0.0 && on_segment(a1, a2, b2))
        || (d3 == 0.0 && on_segment(b1, b2, a1))
        || (d4 == 0.0 && on_segment(b1, b2, a2))
}

/// Whether `p` is inside or on the boundary of a polygon (even-odd over all rings).
fn in_polygon(p: P, rings: &[Vec<P>]) -> bool {
    let mut inside = false;
    for ring in rings {
        let mut j = ring.len() - 1;
        for i in 0..ring.len() {
            let (a, b) = (ring[i], ring[j]);
            if (a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x {
                inside = !inside;
            }
            j = i;
        }
    }
    inside
}

/// The minimum distance in metres between two geometries; zero if they intersect.
pub fn distance_m(a: &Geometry, b: &Geometry) -> f64 {
    let (ba, bb) = (bbox(a), bbox(b));
    let lat0 = (ba[1] + ba[3] + bb[1] + bb[3]) / 4.0;
    let lng0 = (ba[0] + ba[2] + bb[0] + bb[2]) / 4.0;
    let (kx, ky) = metres_per_degree(lat0);
    let project = move |p: Position| P {
        x: (p[0] - lng0) * kx,
        y: (p[1] - lat0) * ky,
    };
    let (sa, sb) = (shape(a, &project), shape(b, &project));

    // Containment: a vertex of one inside a polygon of the other.
    let vertices = |s: &Shape| -> Vec<P> {
        let mut v = s.points.clone();
        v.extend(s.segments.iter().map(|&(p, _)| p));
        v.extend(s.segments.iter().map(|&(_, q)| q));
        v
    };
    for polygon in &sb.polygons {
        if vertices(&sa).into_iter().any(|p| in_polygon(p, polygon)) {
            return 0.0;
        }
    }
    for polygon in &sa.polygons {
        if vertices(&sb).into_iter().any(|p| in_polygon(p, polygon)) {
            return 0.0;
        }
    }

    let mut best = f64::INFINITY;
    for &(a1, a2) in &sa.segments {
        for &(b1, b2) in &sb.segments {
            if segments_cross_or_touch(a1, a2, b1, b2) {
                return 0.0;
            }
            best = best
                .min(point_segment_distance_sq(a1, b1, b2))
                .min(point_segment_distance_sq(a2, b1, b2))
                .min(point_segment_distance_sq(b1, a1, a2))
                .min(point_segment_distance_sq(b2, a1, a2));
        }
    }
    for &p in &sa.points {
        for &(b1, b2) in &sb.segments {
            best = best.min(point_segment_distance_sq(p, b1, b2));
        }
        for &q in &sb.points {
            best = best.min((p.x - q.x).powi(2) + (p.y - q.y).powi(2));
        }
    }
    for &q in &sb.points {
        for &(a1, a2) in &sa.segments {
            best = best.min(point_segment_distance_sq(q, a1, a2));
        }
    }
    best.sqrt()
}

/// `ST_DWithin(geography(a), geography(b), metres)`.
pub fn within_m(a: &Geometry, b: &Geometry, metres: f64) -> bool {
    distance_m(a, b) <= metres
}

// ---------------------------------------------------------------------------------------
// Planar relations
// ---------------------------------------------------------------------------------------

fn coord(p: &Position) -> Coord<f64> {
    Coord { x: p[0], y: p[1] }
}

fn line_string(l: &[Position]) -> LineString<f64> {
    LineString::new(l.iter().map(coord).collect())
}

fn polygon(rings: &[Vec<Position>]) -> Polygon<f64> {
    Polygon::new(
        line_string(&rings[0]),
        rings[1..].iter().map(|r| line_string(r)).collect(),
    )
}

pub fn to_geo(geometry: &Geometry) -> GeoGeometry<f64> {
    match geometry {
        Geometry::Point(p) => GeoGeometry::Point(Point::new(p[0], p[1])),
        Geometry::LineString(l) => GeoGeometry::LineString(line_string(l)),
        Geometry::MultiLineString(lines) => GeoGeometry::MultiLineString(MultiLineString::new(
            lines.iter().map(|l| line_string(l)).collect(),
        )),
        Geometry::Polygon(rings) => GeoGeometry::Polygon(polygon(rings)),
        Geometry::MultiPolygon(polygons) => GeoGeometry::MultiPolygon(MultiPolygon::new(
            polygons.iter().map(|rings| polygon(rings)).collect(),
        )),
    }
}

/// `ST_Intersects(a, b)`.
pub fn intersects(a: &Geometry, b: &Geometry) -> bool {
    to_geo(a).intersects(&to_geo(b))
}

/// `ST_CoveredBy(a, b)`: no point of `a` is outside `b`.
pub fn covered_by(a: &Geometry, b: &Geometry) -> bool {
    to_geo(a).relate(&to_geo(b)).is_coveredby()
}

/// `ST_Covers(a, b)`.
pub fn covers(a: &Geometry, b: &Geometry) -> bool {
    covered_by(b, a)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_point_is_its_distance_from_a_line() {
        // 0.001 degrees of latitude is about 111 m.
        let line = Geometry::LineString(vec![[11.0, 47.0], [11.01, 47.0]]);
        let point = Geometry::Point([11.005, 47.001]);
        let d = distance_m(&point, &line);
        assert!((d - 111.2).abs() < 0.5, "{d}");
    }

    #[test]
    fn a_point_inside_a_polygon_is_at_distance_zero() {
        let square = Geometry::Polygon(vec![vec![
            [0.0, 0.0],
            [1.0, 0.0],
            [1.0, 1.0],
            [0.0, 1.0],
            [0.0, 0.0],
        ]]);
        assert_eq!(distance_m(&Geometry::Point([0.5, 0.5]), &square), 0.0);
        assert!(distance_m(&Geometry::Point([2.0, 0.5]), &square) > 100_000.0);
    }

    #[test]
    fn crossing_lines_are_at_distance_zero() {
        let a = Geometry::LineString(vec![[0.0, 0.0], [1.0, 1.0]]);
        let b = Geometry::LineString(vec![[0.0, 1.0], [1.0, 0.0]]);
        assert_eq!(distance_m(&a, &b), 0.0);
    }

    #[test]
    fn a_hole_is_not_inside() {
        let donut = Geometry::Polygon(vec![
            vec![[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0], [0.0, 0.0]],
            vec![[1.0, 1.0], [3.0, 1.0], [3.0, 3.0], [1.0, 3.0], [1.0, 1.0]],
        ]);
        assert!(distance_m(&Geometry::Point([2.0, 2.0]), &donut) > 50_000.0);
        assert_eq!(distance_m(&Geometry::Point([0.5, 0.5]), &donut), 0.0);
    }

    #[test]
    fn planar_relations() {
        let square = Geometry::Polygon(vec![vec![
            [0.0, 0.0],
            [2.0, 0.0],
            [2.0, 2.0],
            [0.0, 2.0],
            [0.0, 0.0],
        ]]);
        let inside = Geometry::LineString(vec![[0.5, 0.5], [1.5, 1.5]]);
        let across = Geometry::LineString(vec![[1.0, 1.0], [3.0, 3.0]]);
        assert!(covered_by(&inside, &square));
        assert!(!covered_by(&across, &square));
        assert!(intersects(&across, &square));
        assert!(covers(&square, &inside));
    }
}
