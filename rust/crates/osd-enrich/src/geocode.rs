//! Interpreting reverse-geocoding responses, and choosing where to ask.
//!
//! Replaces the pure parts of `src/transforms/Geocoder.ts` (`enhancePhoton`,
//! `enhanceWhosOnFirst`) and `extractPointsAlongGeometry` from `GeoTransforms.ts`. The
//! requests, caching and concurrency around them are separate.
//!
//! The country and region names and codes a Photon response is resolved against are
//! `iso3166-2-db`'s, with the "osm" name provider, read from `src/iso3166.json`, which
//! `rust/codegen/generate-iso3166-data.mjs` writes from the npm package.

use crate::places::{sort_places, unique_places};
use openskidata_format::place::{Localized, LocalizedNames, Place};
use osd_osm::element::{Geometry, Position};
use osd_turf::{Units, along, path_length};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::LazyLock;

#[derive(Deserialize)]
struct Dataset {
    countries: HashMap<String, Country>,
}

#[derive(Deserialize)]
struct Country {
    iso: String,
    en: String,
    /// `(name, code)` in the dataset's order; the first with a matching name wins.
    regions: Vec<(String, String)>,
}

static DATASET: LazyLock<Dataset> = LazyLock::new(|| {
    serde_json::from_str(include_str!("iso3166.json")).expect("the embedded ISO 3166 data parses")
});

/// JavaScript's `value || null` for a string-or-missing value.
fn non_empty(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

fn place(
    country_code: String,
    region_code: Option<String>,
    country: String,
    region: Option<String>,
    locality: Option<String>,
) -> Place {
    Place {
        iso3166_1_alpha2: country_code,
        iso3166_2: region_code,
        localized: Localized {
            en: LocalizedNames {
                country,
                region,
                locality,
            },
        },
    }
}

/// `enhancePhoton`: the place a Photon response (`{url, timestamp, response}`) describes, or
/// `None` for one with no feature, no country code, or a country code not in the dataset.
pub fn enhance_photon(raw: &Value) -> Option<Place> {
    let properties = raw["response"]["features"]
        .as_array()?
        .first()?
        .get("properties")?;
    // An empty code is no country either way: it is not in the dataset.
    let code = properties.get("countrycode").and_then(Value::as_str)?;
    let city = non_empty(properties.get("city"));

    let Some(country) = DATASET.countries.get(code) else {
        // Kosovo is not in the iso3166-2-db dataset.
        return (code == "XK").then(|| place("XK".into(), None, "Kosovo".into(), None, city));
    };

    // The state, else the county, by exact name.
    let region = ["state", "county"].into_iter().find_map(|field| {
        let name = properties.get(field)?.as_str()?;
        country.regions.iter().find(|(n, _)| n == name)
    });
    Some(place(
        country.iso.clone(),
        region.map(|(_, code)| format!("{}-{code}", country.iso)),
        country.en.clone(),
        region
            .map(|(name, _)| name.clone())
            .filter(|n| !n.is_empty()),
        city,
    ))
}

/// `enhanceWhosOnFirst`: the place a Who's On First response describes, built from its first
/// country, region and locality geometries; `None` without a country that has an ISO code.
pub fn enhance_whos_on_first(raw: &Value) -> Option<Place> {
    let geometries = raw["response"]["geometries"].as_array()?;
    let first = |placetype: &str| {
        geometries
            .iter()
            .find(|g| g.get("placetype").and_then(Value::as_str) == Some(placetype))
    };
    let country = first("country")?;
    let country_code = non_empty(country.get("iso_code"))?;
    let region = first("region");
    let locality = first("locality");

    // `name_eng || name`
    let name = |geometry: &Value| {
        non_empty(geometry.get("name_eng")).or_else(|| non_empty(geometry.get("name")))
    };
    Some(place(
        country_code,
        region.and_then(|r| non_empty(r.get("iso_code"))),
        // The country's name is taken even when empty, as upstream does.
        non_empty(country.get("name_eng"))
            .or_else(|| {
                country
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .unwrap_or_default(),
        region.and_then(name),
        locality.and_then(name),
    ))
}

/// What `lineString(coordinates)` checks.
fn line(coordinates: &[Position]) -> Result<&[Position], String> {
    if coordinates.len() < 2 {
        return Err("coordinates must be an array of two or more positions".into());
    }
    Ok(coordinates)
}

/// `extractPointsFromLine`: the start, a point every `interval_km` along, and the end.
fn points_along_line(coordinates: &[Position], interval_km: f64) -> Result<Vec<Position>, String> {
    let coordinates = line(coordinates)?;
    let line_length = path_length(coordinates, Units::Kilometers);
    let mut points = vec![coordinates[0]];
    let mut distance = interval_km;
    while distance < line_length {
        points.push(along(coordinates, distance));
        distance += interval_km;
    }
    let end = coordinates[coordinates.len() - 1];
    let last = points[points.len() - 1];
    if end[0] != last[0] || end[1] != last[1] {
        points.push(end);
    }
    Ok(points)
}

/// `extractPointsAlongGeometry`: the positions to geocode for a geometry -- a point itself, a
/// line every `interval_km`, a polygon's outer ring every `interval_km` -- without repeats.
pub fn extract_points_along_geometry(
    geometry: &Geometry,
    interval_km: f64,
) -> Result<Vec<Position>, String> {
    let mut points: Vec<Position> = Vec::new();
    match geometry {
        Geometry::Point(p) => points.push(*p),
        Geometry::LineString(l) => points.extend(points_along_line(l, interval_km)?),
        Geometry::MultiLineString(lines) => {
            for l in lines {
                points.extend(points_along_line(l, interval_km)?);
            }
        }
        Geometry::Polygon(rings) => {
            points.extend(points_along_line(first_ring(rings)?, interval_km)?);
        }
        Geometry::MultiPolygon(polygons) => {
            for rings in polygons {
                points.extend(points_along_line(first_ring(rings)?, interval_km)?);
            }
        }
    }
    let mut unique: Vec<Position> = Vec::with_capacity(points.len());
    for point in points {
        if !unique.iter().any(|p| p[0] == point[0] && p[1] == point[1]) {
            unique.push(point);
        }
    }
    Ok(unique)
}

fn first_ring(rings: &[Vec<Position>]) -> Result<&[Position], String> {
    rings
        .first()
        .map(Vec::as_slice)
        .ok_or_else(|| "Cannot read properties of undefined".to_owned())
}

/// What the clustering stage needs of a geocoder: the place at a position.
///
/// Implemented by the real client (requests, cache, concurrency) and by test doubles.
/// `Sync` because objects are geocoded in parallel.
pub trait Geocoder: Sync {
    /// `Geocoder.geocode`: the place at `position`, or `None` where there is none. An error is
    /// a failed lookup (the network, a bad response), which fails the object being geocoded.
    fn geocode(&self, position: Position) -> Result<Option<Place>, String>;
}

/// `Geocoder.geocodeGeometry`: the distinct places along a geometry (sampled every kilometre),
/// sorted. Fails if sampling or any one lookup fails.
pub fn geocode_geometry(
    geocoder: &dyn Geocoder,
    geometry: &Geometry,
) -> Result<Vec<Place>, String> {
    let mut places = Vec::new();
    for point in extract_points_along_geometry(geometry, 1.0)? {
        if let Some(place) = geocoder.geocode(point)? {
            places.push(place);
        }
    }
    Ok(sort_places(&unique_places(&places)))
}
