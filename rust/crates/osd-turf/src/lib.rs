//! The turf functions the pipeline's results depend on, ported with their arithmetic intact.
//!
//! Ski area geometry, lengths, station snapping and every elevation statistic go through
//! turf, and the results are written to the output, so these keep turf's own formulas --
//! haversine distance with its modulo-360 degree reduction, `destination` via `asin` /
//! `atan2` -- rather than the closest equivalent from a Rust geodesy crate. Trigonometry
//! comes from `libm` (musl, from the same fdlibm lineage as V8's), not `f64::sin`, which
//! calls the platform's libm and need not agree with it in the last digit.
//!
//! Positions are `[longitude, latitude]` in degrees. [`Coord`] adds an optional elevation,
//! for the functions that carry it along (`lineSliceAlong`, `lineChunk`).

pub mod intersects;

use std::f64::consts::PI;

/// A position as `[longitude, latitude]`.
pub type Position = [f64; 2];

/// `earthRadius` in `@turf/helpers`, in metres.
pub const EARTH_RADIUS_M: f64 = 6_371_008.8;

/// The length units turf is used with here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Units {
    Meters,
    Kilometers,
}

impl Units {
    /// `factors[units]`: radians of arc to this unit.
    pub fn factor(self) -> f64 {
        match self {
            Units::Meters => EARTH_RADIUS_M,
            Units::Kilometers => EARTH_RADIUS_M / 1000.0,
        }
    }
}

/// `degreesToRadians`: reduced modulo 360 first, with JavaScript's `%`.
pub fn degrees_to_radians(degrees: f64) -> f64 {
    (degrees % 360.0) * PI / 180.0
}

/// `radiansToDegrees`: reduced modulo 2 pi first.
pub fn radians_to_degrees(radians: f64) -> f64 {
    (radians % (2.0 * PI)) * 180.0 / PI
}

/// `@turf/distance`: haversine distance.
pub fn distance(from: Position, to: Position, units: Units) -> f64 {
    let d_lat = degrees_to_radians(to[1] - from[1]);
    let d_lon = degrees_to_radians(to[0] - from[0]);
    let lat1 = degrees_to_radians(from[1]);
    let lat2 = degrees_to_radians(to[1]);
    let a = libm::sin(d_lat / 2.0).powi(2)
        + libm::sin(d_lon / 2.0).powi(2) * libm::cos(lat1) * libm::cos(lat2);
    2.0 * libm::atan2(a.sqrt(), (1.0 - a).sqrt()) * units.factor()
}

/// [`distance`] in kilometres.
pub fn distance_km(from: Position, to: Position) -> f64 {
    distance(from, to, Units::Kilometers)
}

/// The sum of the geodesic lengths of the segments of a path, left to right.
pub fn path_length(positions: &[Position], units: Units) -> f64 {
    positions
        .windows(2)
        .fold(0.0, |sum, pair| sum + distance(pair[0], pair[1], units))
}

/// `@turf/bearing`, in degrees.
pub fn bearing(start: Position, end: Position) -> f64 {
    let lon1 = degrees_to_radians(start[0]);
    let lon2 = degrees_to_radians(end[0]);
    let lat1 = degrees_to_radians(start[1]);
    let lat2 = degrees_to_radians(end[1]);
    let a = libm::sin(lon2 - lon1) * libm::cos(lat2);
    let b = libm::cos(lat1) * libm::sin(lat2)
        - libm::sin(lat1) * libm::cos(lat2) * libm::cos(lon2 - lon1);
    radians_to_degrees(libm::atan2(a, b))
}

/// `@turf/destination`.
pub fn destination(
    origin: Position,
    distance: f64,
    bearing_degrees: f64,
    units: Units,
) -> Position {
    let longitude1 = degrees_to_radians(origin[0]);
    let latitude1 = degrees_to_radians(origin[1]);
    let bearing_rad = degrees_to_radians(bearing_degrees);
    let radians = distance / units.factor();

    let latitude2 = libm::asin(
        libm::sin(latitude1) * libm::cos(radians)
            + libm::cos(latitude1) * libm::sin(radians) * libm::cos(bearing_rad),
    );
    let longitude2 = longitude1
        + libm::atan2(
            libm::sin(bearing_rad) * libm::sin(radians) * libm::cos(latitude1),
            libm::cos(radians) - libm::sin(latitude1) * libm::sin(latitude2),
        );
    [
        radians_to_degrees(longitude2),
        radians_to_degrees(latitude2),
    ]
}

/// [`destination`] for a distance in kilometres.
pub fn destination_km(origin: Position, distance_km: f64, bearing_degrees: f64) -> Position {
    destination(origin, distance_km, bearing_degrees, Units::Kilometers)
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

// ---------------------------------------------------------------------------------------
// Coordinates with an elevation
// ---------------------------------------------------------------------------------------

/// A coordinate that may carry an elevation, as a GeoJSON position may have a third number.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Coord {
    pub x: f64,
    pub y: f64,
    pub z: Option<f64>,
}

impl Coord {
    pub fn new(x: f64, y: f64) -> Self {
        Coord { x, y, z: None }
    }

    pub fn with_z(x: f64, y: f64, z: f64) -> Self {
        Coord { x, y, z: Some(z) }
    }

    pub fn xy(&self) -> Position {
        [self.x, self.y]
    }
}

/// `@turf/length` of a LineString.
pub fn length(coords: &[Coord], units: Units) -> f64 {
    coords.windows(2).fold(0.0, |sum, pair| {
        sum + distance(pair[0].xy(), pair[1].xy(), units)
    })
}

/// What `lineString(coordinates)` checks.
fn line_string(coords: Vec<Coord>) -> Result<Vec<Coord>, String> {
    if coords.len() < 2 {
        return Err("coordinates must be an array of two or more positions".into());
    }
    Ok(coords)
}

/// `destination` as `lineSliceAlong` calls it: the new point keeps the origin's elevation.
fn destination_coord(origin: Coord, distance: f64, bearing_degrees: f64, units: Units) -> Coord {
    let [x, y] = destination(origin.xy(), distance, bearing_degrees, units);
    Coord { x, y, z: origin.z }
}

/// `@turf/line-slice-along`: the part of a line between two distances from its start.
///
/// New end points are interpolated with `destination` and carry the elevation of the vertex
/// they were measured back from, which is turf 7.3+'s behaviour and the reason
/// `lineChunkPatched` strips them again.
pub fn line_slice_along(
    coords: &[Coord],
    start_dist: f64,
    stop_dist: f64,
    units: Units,
) -> Result<Vec<Coord>, String> {
    let n = coords.len();
    let mut slice: Vec<Coord> = Vec::new();
    let mut travelled = 0.0;
    for i in 0..n {
        if start_dist >= travelled && i == n - 1 {
            break;
        } else if travelled > start_dist && slice.is_empty() {
            let overshot = start_dist - travelled;
            if overshot == 0.0 || overshot.is_nan() {
                slice.push(coords[i]);
                return line_string(slice);
            }
            if i == 0 {
                return Err("cannot read properties of undefined".into());
            }
            let direction = bearing(coords[i].xy(), coords[i - 1].xy()) - 180.0;
            slice.push(destination_coord(coords[i], overshot, direction, units));
        }
        if travelled >= stop_dist {
            let overshot = stop_dist - travelled;
            if overshot == 0.0 || overshot.is_nan() {
                slice.push(coords[i]);
                return line_string(slice);
            }
            if i == 0 {
                return Err("cannot read properties of undefined".into());
            }
            let direction = bearing(coords[i].xy(), coords[i - 1].xy()) - 180.0;
            slice.push(destination_coord(coords[i], overshot, direction, units));
            return line_string(slice);
        }
        if travelled >= start_dist {
            slice.push(coords[i]);
        }
        if i == n - 1 {
            return line_string(slice);
        }
        travelled += distance(coords[i].xy(), coords[i + 1].xy(), units);
    }
    if travelled < start_dist {
        return Err("Start position is beyond line".into());
    }
    let last = coords[n - 1];
    line_string(vec![last, last])
}

/// `@turf/line-chunk` for a LineString: it cut into pieces of `segment_length`, the last
/// possibly shorter. A line no longer than that is returned whole, with its own coordinates.
pub fn line_chunk(
    coords: &[Coord],
    segment_length: f64,
    units: Units,
) -> Result<Vec<Vec<Coord>>, String> {
    if segment_length <= 0.0 {
        return Err("segmentLength must be greater than 0".into());
    }
    let line_length = length(coords, units);
    if line_length <= segment_length {
        return Ok(vec![coords.to_vec()]);
    }
    let mut number_of_segments = line_length / segment_length;
    if number_of_segments.fract() != 0.0 {
        number_of_segments = number_of_segments.floor() + 1.0;
    }
    let mut chunks = Vec::new();
    let mut i = 0.0;
    while i < number_of_segments {
        chunks.push(line_slice_along(
            coords,
            segment_length * i,
            segment_length * (i + 1.0),
            units,
        )?);
        i += 1.0;
    }
    Ok(chunks)
}
