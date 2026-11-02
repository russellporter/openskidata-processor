//! The VIIRS pixels a geometry covers: 375 m cells of the sinusoidal grid the snow cover data
//! is published on.
//!
//! Replaces `src/utils/VIIRSPixelExtractor.ts`. Checked against the real extractor
//! (`rust/codegen/generate-viirs-vectors.mjs`) on random lines, polygons (with holes) and
//! multi-geometries around the world, and on inputs placed on pixel boundaries.
//!
//! A pixel is covered when turf's `booleanIntersects` of its square and the geometry says so
//! ([`osd_turf::intersects`]). Upstream tests every pixel of the geometry's bounding box (plus a
//! one pixel margin) against every segment; here a pixel is tested against the segments that
//! overlap it, which cannot change the answer: a segment that does not reach the pixel's box
//! has no vertex inside the pixel and no crossing with its outline.
//!
//! A geometry that covers no pixel (a point, or something smaller than the arithmetic can
//! resolve) is given the pixel of the centre of its bounding box.

use osd_osm::element::Geometry;
use osd_turf::Position;
use osd_turf::intersects::{Containment, outlines_intersect, point_in_polygon};

/// `[hTile, vTile, column, row]`.
pub type ViirsPixel = [u32; 4];

const PIXEL_SIZE: f64 = 375.0;
const TILE_SIZE_METERS: f64 = 1_111_950.519_667;
const PIXELS_PER_TILE: i64 = 3000;
const SPHERE_RADIUS: f64 = 6_371_007.181;
const GLOBAL_WIDTH: f64 = 20_015_109.354 * 2.0;
const GLOBAL_HEIGHT: f64 = 10_007_554.677 * 2.0;

/// How far a segment may lie from a pixel's box and still be handed to the intersection test,
/// in metres. The test's own arithmetic is good to nanometres at these magnitudes.
const SLACK: f64 = 1e-6;

/// `transformToSinusoidal`.
pub fn to_sinusoidal(lon: f64, lat: f64) -> Position {
    let lon_rad = (lon * std::f64::consts::PI) / 180.0;
    let lat_rad = (lat * std::f64::consts::PI) / 180.0;
    [
        SPHERE_RADIUS * lon_rad * libm::cos(lat_rad),
        SPHERE_RADIUS * lat_rad,
    ]
}

/// `sinusoidalToTileAndPixel`: `(hTile, vTile, column, row)`, clamped to the grid.
pub fn tile_and_pixel(x: f64, y: f64) -> (i64, i64, i64, i64) {
    let h_tile = (((x + GLOBAL_WIDTH / 2.0) / TILE_SIZE_METERS).floor()).clamp(0.0, 35.0) as i64;
    let v_tile = (((GLOBAL_HEIGHT / 2.0 - y) / TILE_SIZE_METERS).floor()).clamp(0.0, 17.0) as i64;
    let tile_left = h_tile as f64 * TILE_SIZE_METERS - GLOBAL_WIDTH / 2.0;
    let tile_top = GLOBAL_HEIGHT / 2.0 - v_tile as f64 * TILE_SIZE_METERS;
    let max = (PIXELS_PER_TILE - 1) as f64;
    let col = ((x - tile_left) / PIXEL_SIZE).floor().clamp(0.0, max) as i64;
    let row = ((tile_top - y) / PIXEL_SIZE).floor().clamp(0.0, max) as i64;
    (h_tile, v_tile, col, row)
}

/// One part of the projected geometry, with its box.
enum Part {
    Line(Vec<Position>),
    Polygon(Vec<Vec<Position>>),
}

struct Projected {
    part: Part,
    /// `[minX, minY, maxX, maxY]`.
    bounds: [f64; 4],
}

fn project(positions: &[Position]) -> Vec<Position> {
    positions
        .iter()
        .map(|p| to_sinusoidal(p[0], p[1]))
        .collect()
}

fn bounds_of<'a>(positions: impl Iterator<Item = &'a Position>) -> [f64; 4] {
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for p in positions {
        bounds[0] = bounds[0].min(p[0]);
        bounds[1] = bounds[1].min(p[1]);
        bounds[2] = bounds[2].max(p[0]);
        bounds[3] = bounds[3].max(p[1]);
    }
    bounds
}

fn parts_of(geometry: &Geometry) -> Vec<Projected> {
    let line = |positions: &[Position]| {
        let projected = project(positions);
        let bounds = bounds_of(projected.iter());
        Projected {
            part: Part::Line(projected),
            bounds,
        }
    };
    let polygon = |rings: &[Vec<Position>]| {
        let projected: Vec<Vec<Position>> = rings.iter().map(|r| project(r)).collect();
        let bounds = bounds_of(projected.iter().flatten());
        Projected {
            part: Part::Polygon(projected),
            bounds,
        }
    };
    match geometry {
        // A point is a line of one vertex for the bounds; no pixel will intersect it as a
        // polygon would, so it ends up on the centroid fallback or is found by its vertex.
        Geometry::Point(p) => vec![line(std::slice::from_ref(p))],
        Geometry::LineString(positions) => vec![line(positions)],
        Geometry::MultiLineString(lines) => lines.iter().map(|l| line(l)).collect(),
        Geometry::Polygon(rings) => vec![polygon(rings)],
        Geometry::MultiPolygon(polygons) => polygons.iter().map(|p| polygon(p)).collect(),
    }
}

/// The segments of the rings that reach the box, each as a two-vertex line.
fn segments_near<'a>(
    rings: impl Iterator<Item = &'a [Position]>,
    near: [f64; 4],
) -> Vec<[Position; 2]> {
    let mut found = Vec::new();
    for ring in rings {
        for pair in ring.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            if a[0].max(b[0]) < near[0]
                || a[0].min(b[0]) > near[2]
                || a[1].max(b[1]) < near[1]
                || a[1].min(b[1]) > near[3]
            {
                continue;
            }
            found.push([a, b]);
        }
    }
    found
}

fn in_box(p: Position, near: [f64; 4]) -> bool {
    p[0] >= near[0] && p[0] <= near[2] && p[1] >= near[1] && p[1] <= near[3]
}

fn overlaps(a: [f64; 4], b: [f64; 4]) -> bool {
    a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

/// `pixelIntersectsGeometry`: whether the pixel centred on `(pixel_x, pixel_y)` meets the
/// geometry.
fn pixel_intersects(pixel_x: f64, pixel_y: f64, parts: &[Projected]) -> bool {
    let (min_x, max_x) = (pixel_x - PIXEL_SIZE / 2.0, pixel_x + PIXEL_SIZE / 2.0);
    let (min_y, max_y) = (pixel_y - PIXEL_SIZE / 2.0, pixel_y + PIXEL_SIZE / 2.0);
    let ring: [Position; 5] = [
        [min_x, min_y],
        [max_x, min_y],
        [max_x, max_y],
        [min_x, max_y],
        [min_x, min_y],
    ];
    let pixel: [&[Position]; 1] = [&ring];
    let near = [min_x - SLACK, min_y - SLACK, max_x + SLACK, max_y + SLACK];

    parts.iter().any(|projected| {
        if !overlaps(projected.bounds, near) {
            return false;
        }
        match &projected.part {
            // isLineInPoly(pixel, line)
            Part::Line(line) => {
                line.iter().any(|&p| {
                    in_box(p, near) && point_in_polygon(p, &pixel) != Containment::Outside
                }) || {
                    let segments = segments_near(std::iter::once(line.as_slice()), near);
                    let rings: Vec<&[Position]> = segments.iter().map(|s| s.as_slice()).collect();
                    !rings.is_empty() && outlines_intersect(&rings, &pixel)
                }
            }
            // isPolyInPoly(polygon, pixel)
            Part::Polygon(rings) => {
                if rings.is_empty() {
                    return false;
                }
                rings[0].iter().any(|&p| {
                    in_box(p, near) && point_in_polygon(p, &pixel) != Containment::Outside
                }) || {
                    let all: Vec<&[Position]> = rings.iter().map(Vec::as_slice).collect();
                    ring.iter()
                        .any(|&p| point_in_polygon(p, &all) != Containment::Outside)
                } || {
                    let segments = segments_near(rings.iter().map(Vec::as_slice), near);
                    let lines: Vec<&[Position]> = segments.iter().map(|s| s.as_slice()).collect();
                    !lines.is_empty() && outlines_intersect(&lines, &pixel)
                }
            }
        }
    })
}

/// `getGeometryPixelCoordinates`: the pixels the geometry covers, tile by tile and row by row.
pub fn geometry_pixels(geometry: &Geometry) -> Vec<ViirsPixel> {
    let parts = parts_of(geometry);
    let bounds = bounds_of(
        parts
            .iter()
            .flat_map(|p| [[p.bounds[0], p.bounds[1]], [p.bounds[2], p.bounds[3]]])
            .collect::<Vec<_>>()
            .iter(),
    );
    let [min_x, min_y, max_x, max_y] = bounds;

    let min_info = tile_and_pixel(min_x, max_y);
    let max_info = tile_and_pixel(max_x, min_y);

    let mut pixels: Vec<ViirsPixel> = Vec::new();
    for h_tile in min_info.0..=max_info.0 {
        for v_tile in min_info.1..=max_info.1 {
            let tile_left = h_tile as f64 * TILE_SIZE_METERS - GLOBAL_WIDTH / 2.0;
            let tile_top = GLOBAL_HEIGHT / 2.0 - v_tile as f64 * TILE_SIZE_METERS;
            let last = PIXELS_PER_TILE - 1;
            let test_min_col = (((min_x - tile_left) / PIXEL_SIZE).floor() as i64 - 1).max(0);
            let test_max_col = (((max_x - tile_left) / PIXEL_SIZE).floor() as i64 + 1).min(last);
            let test_min_row = (((tile_top - max_y) / PIXEL_SIZE).floor() as i64 - 1).max(0);
            let test_max_row = (((tile_top - min_y) / PIXEL_SIZE).floor() as i64 + 1).min(last);

            for row in test_min_row..=test_max_row {
                for col in test_min_col..=test_max_col {
                    let pixel_x = tile_left + (col as f64 + 0.5) * PIXEL_SIZE;
                    let pixel_y = tile_top - (row as f64 + 0.5) * PIXEL_SIZE;
                    if pixel_intersects(pixel_x, pixel_y, &parts) {
                        pixels.push([h_tile as u32, v_tile as u32, col as u32, row as u32]);
                    }
                }
            }
        }
    }

    if pixels.is_empty() {
        let centre = ((min_x + max_x) / 2.0, (min_y + max_y) / 2.0);
        let (h, v, col, row) = tile_and_pixel(centre.0, centre.1);
        pixels.push([h as u32, v as u32, col as u32, row as u32]);
    }
    pixels
}
