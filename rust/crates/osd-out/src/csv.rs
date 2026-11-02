//! CSV exports.
//!
//! Replaces `src/transforms/CSVFormatter.ts`. The headers are literal and fixed; escaping is
//! hand-rolled upstream (quote on `,`, `"`, newline, carriage return and `;`) and is kept so
//! that existing consumers keep parsing the same files.
//!
//! A run's elevation columns (`inclined_length_m`, `descent_m`, ... ) come from its elevation
//! profile; they are empty for a run without one, as upstream leaves them. A lift's need its
//! geometry's elevations, which this pipeline's 2D geometry does not carry yet, so they stay
//! empty; upstream's are empty too when no elevation server is configured.

use openskidata_format::elevation_profile::ElevationData;
use openskidata_format::lift::{
    LiftElevationData, LiftProperties, StationPoint, lift_elevation_data,
};
use openskidata_format::place::Place;
use openskidata_format::run::{RunProperties, run_color_name, run_elevation_data};
use openskidata_format::ski_area::{SkiAreaProperties, SkiAreaSummaryFeature};
use openskidata_format::source::{Source, source_url};
use openskidata_format::spot::{SpotKind, SpotProperties};
use openskidata_format::{FeatureType, LiftType, SkiAreaActivity};
use osd_cluster::engine::Feature;
use osd_cluster::turf;
use osd_osm::element::Geometry;
use osd_store::feature_id::js_number_to_string;
use osd_tags::js_number::round;
use osd_turf::Coord;

pub const RUN_HEADERS: &str = "name,ref,countries,regions,localities,ski_area_names,difficulty,color,oneway,lit,gladed,patrolled,grooming,uses,inclined_length_m,descent_m,ascent_m,average_pitch_%,max_pitch_%,min_elevation_m,max_elevation_m,difficulty_convention,wikidata_id,websites,openskimap,id,geometry,lat,lng,ski_area_ids,sources,description";
pub const LIFT_HEADERS: &str = "name,ref,ref_fr_cairn,lift_type,status,access,countries,regions,localities,ski_area_names,oneway,duration_sec,capacity,occupancy,detachable,bubble,heating,inclined_length_m,vertical_m,speed_m_per_s,vertical_speed_m_per_s,min_elevation_m,max_elevation_m,overall_pitch_%,wikidata_id,websites,openskimap,id,geometry,lat,lng,ski_area_ids,sources,description";
pub const SKI_AREA_HEADERS: &str = "name,countries,regions,localities,status,has_downhill,has_nordic,downhill_distance_km,nordic_distance_km,vertical_m,min_elevation_m,max_elevation_m,lift_count,surface_lifts_count,run_convention,wikidata_id,websites,openskimap,id,geometry,lat,lng,sources";
pub const SPOT_HEADERS: &str = "id,spot_type,longitude,latitude,sources,ski_areas,countries,regions,localities,dismount,name,position,entry,exit";

pub fn headers(feature_type: FeatureType) -> &'static str {
    match feature_type {
        FeatureType::Run => RUN_HEADERS,
        FeatureType::Lift => LIFT_HEADERS,
        FeatureType::SkiArea => SKI_AREA_HEADERS,
        FeatureType::Spot => SPOT_HEADERS,
    }
}

pub fn filename(feature_type: FeatureType) -> &'static str {
    match feature_type {
        FeatureType::SkiArea => "ski_areas.csv",
        FeatureType::Run => "runs.csv",
        FeatureType::Lift => "lifts.csv",
        FeatureType::Spot => "spots.csv",
    }
}

/// `Number.prototype.toFixed`: the decimal with `digits` places closest to `x`, a tie going
/// to the larger. That differs from Rust's formatting, which rounds a tie to even, and ties
/// do occur: 11.0078125 is a valid coordinate and exactly representable.
pub fn to_fixed(x: f64, digits: usize) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }
    let negative = x < 0.0;
    // The exact decimal expansion of a double has at most about 1074 fractional digits; 80 is
    // plenty to decide a tie for values this program handles.
    let exact = format!("{:.80}", x.abs());
    let (integer, fraction) = exact.split_once('.').expect("a fractional part");

    let mut digits_vec: Vec<u8> = integer
        .bytes()
        .chain(fraction.bytes().take(digits))
        .collect();
    let round_up = fraction.as_bytes().get(digits).is_some_and(|d| *d >= b'5');
    if round_up {
        let mut i = digits_vec.len();
        loop {
            if i == 0 {
                digits_vec.insert(0, b'1');
                break;
            }
            i -= 1;
            if digits_vec[i] == b'9' {
                digits_vec[i] = b'0';
            } else {
                digits_vec[i] += 1;
                break;
            }
        }
    }
    let integer_len = digits_vec.len() - digits;
    let (int_part, frac_part) = digits_vec.split_at(integer_len);
    let mut out = String::new();
    if negative {
        out.push('-');
    }
    out.push_str(std::str::from_utf8(int_part).expect("ascii"));
    if digits > 0 {
        out.push('.');
        out.push_str(std::str::from_utf8(frac_part).expect("ascii"));
    }
    out
}

/// `escapeField`.
pub fn escape_field(value: Option<&str>) -> String {
    let Some(value) = value else {
        return String::new();
    };
    if value.contains([',', '"', '\n', '\r', ';']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

fn format_boolean(value: Option<bool>) -> &'static str {
    match value {
        None => "",
        Some(true) => "yes",
        Some(false) => "no",
    }
}

/// `extractSkiAreaNames`: names joined with commas after sorting. A missing name sorts as the
/// text "null" (JavaScript sorts by string conversion) and prints as nothing.
fn ski_area_names(ski_areas: &[SkiAreaSummaryFeature]) -> String {
    let mut names: Vec<Option<&str>> = ski_areas
        .iter()
        .map(|a| a.properties.name.as_deref())
        .collect();
    names.sort_by(|a, b| a.unwrap_or("null").cmp(b.unwrap_or("null")));
    let joined = names
        .iter()
        .map(|n| n.unwrap_or(""))
        .collect::<Vec<_>>()
        .join(",");
    escape_field(Some(&joined))
}

fn ski_area_ids(ski_areas: &[SkiAreaSummaryFeature]) -> String {
    ski_areas
        .iter()
        .map(|a| a.properties.id.as_str())
        .collect::<Vec<_>>()
        .join(";")
}

/// `extractPlaces`: countries, regions and localities, each unique, sorted and joined.
fn places(places: &[Place]) -> [String; 3] {
    fn column<'a>(values: impl Iterator<Item = Option<&'a str>>) -> String {
        let mut unique: Vec<&str> = Vec::new();
        for value in values.flatten().filter(|v| !v.is_empty()) {
            if !unique.contains(&value) {
                unique.push(value);
            }
        }
        unique.sort_unstable();
        escape_field(Some(&unique.join(";")))
    }
    [
        column(places.iter().map(|p| Some(p.localized.en.country.as_str()))),
        column(places.iter().map(|p| p.localized.en.region.as_deref())),
        column(places.iter().map(|p| p.localized.en.locality.as_deref())),
    ]
}

fn sources(sources: &[Source]) -> String {
    let mut urls: Vec<String> = sources.iter().map(source_url).collect();
    urls.sort();
    escape_field(Some(&urls.join(" ")))
}

fn websites(websites: &[String]) -> String {
    let mut sorted = websites.to_vec();
    sorted.sort();
    escape_field(Some(&sorted.join(" ")))
}

fn open_ski_map_url(id: &str) -> String {
    format!("https://openskimap.org/?obj={id}")
}

fn enum_text<T: serde::Serialize>(value: &Option<T>) -> String {
    match serde_json::to_value(value) {
        Ok(serde_json::Value::String(s)) => s,
        _ => String::new(),
    }
}

fn plain<T: serde::Serialize>(value: &T) -> String {
    match serde_json::to_value(value) {
        Ok(serde_json::Value::String(s)) => s,
        _ => String::new(),
    }
}

fn geometry_type(geometry: &Geometry) -> &'static str {
    match geometry {
        Geometry::Point(_) => "Point",
        Geometry::LineString(_) => "LineString",
        Geometry::MultiLineString(_) => "MultiLineString",
        Geometry::Polygon(_) => "Polygon",
        Geometry::MultiPolygon(_) => "MultiPolygon",
    }
}

/// `getGeometry`: the geometry type and the centroid as latitude then longitude.
fn geometry_columns(geometry: &Geometry) -> [String; 3] {
    let centroid = turf::centroid(&[geometry]);
    [
        geometry_type(geometry).to_owned(),
        to_fixed(centroid[1], 6),
        to_fixed(centroid[0], 6),
    ]
}

fn number(value: Option<f64>) -> String {
    // `x ? x.toString() : ""`: zero is empty.
    value
        .filter(|v| *v != 0.0 && !v.is_nan())
        .map(js_number_to_string)
        .unwrap_or_default()
}

/// A run's elevation data: its elevation profile laid along its line. `None` for a run
/// without a profile or that is not a line.
///
/// Upstream throws if the profile does not fit the line (a different number of points, or a
/// resolution that disagrees), which stops the whole export. A mismatch here is logged and
/// the run's elevation columns are left empty instead.
pub fn run_elevation(f: &Feature<RunProperties>) -> Option<ElevationData> {
    let Geometry::LineString(line) = &f.geometry else {
        return None;
    };
    let coordinates: Vec<Coord> = line.iter().map(|p| Coord::new(p[0], p[1])).collect();
    match run_elevation_data(&coordinates, f.properties.elevation_profile.as_ref()) {
        Ok(data) => data,
        Err(error) => {
            tracing::warn!("run {}: elevation data unusable: {error}", f.properties.id);
            None
        }
    }
}

/// `value?.toFixed(digits)`: empty when there is no value.
fn optional_fixed(value: Option<f64>, digits: usize) -> String {
    value.map_or(String::new(), |v| to_fixed(v, digits))
}

pub fn run(f: &Feature<RunProperties>) -> String {
    let p = &f.properties;
    let elevation = run_elevation(f);
    let color = run_color_name(p.difficulty_convention, p.difficulty);
    let [countries, regions, localities] = places(&p.places);
    let [geometry, lat, lng] = geometry_columns(&f.geometry);
    [
        escape_field(p.name.as_deref()),
        escape_field(p.reference.as_deref()),
        countries,
        regions,
        localities,
        ski_area_names(&p.ski_areas),
        enum_text(&p.difficulty),
        plain(&color),
        format_boolean(p.oneway).into(),
        format_boolean(p.lit).into(),
        format_boolean(p.gladed).into(),
        format_boolean(p.patrolled).into(),
        enum_text(&p.grooming),
        p.uses.iter().map(plain).collect::<Vec<_>>().join(";"),
        elevation.as_ref().map_or(String::new(), |e| {
            to_fixed(e.pitch.inclined_length_in_meters, 0)
        }),
        elevation.as_ref().map_or(String::new(), |e| {
            to_fixed(e.ascent_descent.descent_in_meters, 0)
        }),
        elevation.as_ref().map_or(String::new(), |e| {
            to_fixed(e.ascent_descent.ascent_in_meters, 0)
        }),
        optional_fixed(
            elevation
                .as_ref()
                .and_then(|e| e.pitch.average_pitch_in_percent),
            2,
        ),
        optional_fixed(
            elevation
                .as_ref()
                .and_then(|e| e.pitch.max_pitch_in_percent),
            2,
        ),
        elevation.as_ref().map_or(String::new(), |e| {
            to_fixed(e.ascent_descent.min_elevation_in_meters, 0)
        }),
        elevation.as_ref().map_or(String::new(), |e| {
            to_fixed(e.ascent_descent.max_elevation_in_meters, 0)
        }),
        plain(&p.difficulty_convention),
        escape_field(p.wikidata_id.as_deref()),
        websites(&p.websites),
        open_ski_map_url(&p.id),
        p.id.clone(),
        geometry,
        lat,
        lng,
        ski_area_ids(&p.ski_areas),
        sources(&p.sources),
        p.description
            .as_deref()
            .filter(|d| !d.is_empty())
            .map(|d| escape_field(Some(d)))
            .unwrap_or_default(),
    ]
    .join(",")
}

/// A lift's elevation data: its elevated line, with the elevations of its terminal stations
/// used for its speeds. `None` for a lift that has none.
pub fn lift_elevation(f: &Feature<LiftProperties>) -> Option<LiftElevationData> {
    let (Geometry::LineString(line), Some(z)) = (&f.geometry, f.elevations.as_deref()) else {
        return None;
    };
    let coordinates: Vec<Coord> = line
        .iter()
        .zip(z)
        .map(|(p, z)| Coord::with_z(p[0], p[1], *z))
        .collect();
    let stations: Vec<StationPoint> = f
        .properties
        .stations
        .iter()
        .filter_map(|station| {
            let SpotKind::LiftStation { position, .. } = &station.properties.kind else {
                return None;
            };
            let c = &station.geometry.coordinates;
            Some(StationPoint {
                position: *position,
                coord: Coord {
                    x: *c.first()?,
                    y: *c.get(1)?,
                    z: c.get(2).copied(),
                },
            })
        })
        .collect();
    match lift_elevation_data(&coordinates, f.properties.duration, &stations) {
        Ok(data) => data,
        Err(error) => {
            tracing::warn!("lift {}: elevation data unusable: {error}", f.properties.id);
            None
        }
    }
}

pub fn lift(f: &Feature<LiftProperties>) -> String {
    let p = &f.properties;
    let lift_elevation = lift_elevation(f);
    let [countries, regions, localities] = places(&p.places);
    let [geometry, lat, lng] = geometry_columns(&f.geometry);
    [
        escape_field(p.name.as_deref()),
        escape_field(p.reference.as_deref()),
        escape_field(p.ref_fr_cairn.as_deref()),
        plain(&p.lift_type),
        plain(&p.status),
        p.access.map(|a| plain(&a)).unwrap_or_default(),
        countries,
        regions,
        localities,
        ski_area_names(&p.ski_areas),
        format_boolean(p.oneway).into(),
        number(p.duration),
        number(p.capacity),
        number(p.occupancy),
        format_boolean(p.detachable).into(),
        format_boolean(p.bubble).into(),
        format_boolean(p.heating).into(),
        lift_elevation.as_ref().map_or(String::new(), |e| {
            to_fixed(e.elevation.pitch.inclined_length_in_meters, 0)
        }),
        lift_elevation.as_ref().map_or(String::new(), |e| {
            to_fixed(e.elevation.ascent_descent.vertical_in_meters, 0)
        }),
        optional_fixed(
            lift_elevation
                .as_ref()
                .and_then(|e| e.speed_in_meters_per_second),
            1,
        ),
        optional_fixed(
            lift_elevation
                .as_ref()
                .and_then(|e| e.vertical_speed_in_meters_per_second),
            2,
        ),
        lift_elevation.as_ref().map_or(String::new(), |e| {
            to_fixed(e.elevation.ascent_descent.min_elevation_in_meters, 0)
        }),
        lift_elevation.as_ref().map_or(String::new(), |e| {
            to_fixed(e.elevation.ascent_descent.max_elevation_in_meters, 0)
        }),
        optional_fixed(
            lift_elevation
                .as_ref()
                .and_then(|e| e.elevation.pitch.overall_pitch_in_percent),
            2,
        ),
        escape_field(p.wikidata_id.as_deref()),
        websites(&p.websites),
        open_ski_map_url(&p.id),
        p.id.clone(),
        geometry,
        lat,
        lng,
        ski_area_ids(&p.ski_areas),
        sources(&p.sources),
        p.description
            .as_deref()
            .filter(|d| !d.is_empty())
            .map(|d| escape_field(Some(d)))
            .unwrap_or_default(),
    ]
    .join(",")
}

fn run_distance(properties: &SkiAreaProperties, activity: &str) -> String {
    let distance = properties
        .statistics
        .as_ref()
        .and_then(|s| s.runs.by_activity.get(activity))
        .map(|a| {
            a.by_difficulty
                .values()
                .map(|d| d.length_in_km)
                .sum::<f64>()
        });
    match distance {
        Some(d) => js_number_to_string(round(d)),
        None => String::new(),
    }
}

pub fn ski_area(f: &Feature<SkiAreaProperties>) -> String {
    let p = &f.properties;
    let statistics = p.statistics.as_ref();
    let truthy = |v: Option<f64>| v.filter(|x| *x != 0.0);
    let (max, min) = (
        truthy(statistics.and_then(|s| s.max_elevation)),
        truthy(statistics.and_then(|s| s.min_elevation)),
    );

    let (total_lifts, surface_lifts) = statistics.map_or((0, 0), |s| {
        let total: u64 = s.lifts.by_type.values().map(|t| t.count).sum();
        let surface: u64 = [
            LiftType::TBar,
            LiftType::JBar,
            LiftType::Platter,
            LiftType::RopeTow,
            LiftType::MagicCarpet,
            LiftType::DragLift,
        ]
        .iter()
        .map(|t| s.lifts.by_type.get(t.as_wire_str()).map_or(0, |c| c.count))
        .sum();
        (total, surface)
    });

    let [countries, regions, localities] = places(&p.places);
    let [geometry, lat, lng] = geometry_columns(&f.geometry);
    [
        escape_field(p.summary.name.as_deref()),
        countries,
        regions,
        localities,
        enum_text(&p.summary.status),
        format_boolean(Some(
            p.summary.activities.contains(&SkiAreaActivity::Downhill),
        ))
        .into(),
        format_boolean(Some(
            p.summary.activities.contains(&SkiAreaActivity::Nordic),
        ))
        .into(),
        run_distance(p, "downhill"),
        run_distance(p, "nordic"),
        match (max, min) {
            (Some(max), Some(min)) => js_number_to_string(round(max - min)),
            _ => String::new(),
        },
        min.map(|m| js_number_to_string(round(m)))
            .unwrap_or_default(),
        max.map(|m| js_number_to_string(round(m)))
            .unwrap_or_default(),
        if total_lifts > 0 {
            total_lifts.to_string()
        } else {
            String::new()
        },
        if surface_lifts > 0 {
            surface_lifts.to_string()
        } else {
            String::new()
        },
        plain(&p.run_convention),
        escape_field(p.wikidata_id.as_deref()),
        websites(&p.websites),
        open_ski_map_url(&p.summary.id),
        p.summary.id.clone(),
        geometry,
        lat,
        lng,
        sources(&p.sources),
    ]
    .join(",")
}

pub fn spot(f: &Feature<SpotProperties>) -> String {
    let p = &f.properties;
    let Geometry::Point(point) = f.geometry else {
        return String::new();
    };
    let [countries, regions, localities] = places(&p.base.places);
    let spot_type = serde_json::to_value(&p.kind).expect("serializes")["spotType"]
        .as_str()
        .unwrap_or_default()
        .to_owned();

    let mut row = vec![
        p.base.id.clone(),
        escape_field(Some(&spot_type)),
        to_fixed(point[0], 6),
        to_fixed(point[1], 6),
        sources(&p.base.sources),
        ski_area_names(&p.base.ski_areas),
        countries,
        regions,
        localities,
    ];
    match &p.kind {
        SpotKind::Crossing { dismount } => row.extend([
            escape_field(Some(&plain(dismount))),
            String::new(),
            String::new(),
            String::new(),
            String::new(),
        ]),
        SpotKind::LiftStation {
            name,
            position,
            entry,
            exit,
            ..
        } => row.extend([
            String::new(),
            escape_field(name.as_deref()),
            escape_field(position.map(|p| plain(&p)).as_deref()),
            format_boolean(*entry).into(),
            format_boolean(*exit).into(),
        ]),
        _ => row.extend(std::iter::repeat_n(String::new(), 5)),
    }
    row.join(",")
}

/// A whole file: the header and one line per feature.
///
/// With no features the file is empty, header included: upstream writes the header when the
/// first row arrives, so a stream with no rows never writes it.
pub fn file(feature_type: FeatureType, rows: impl IntoIterator<Item = String>) -> String {
    let mut rows = rows.into_iter().peekable();
    if rows.peek().is_none() {
        return String::new();
    }
    let mut out = String::new();
    out.push_str(headers(feature_type));
    out.push('\n');
    for row in rows {
        out.push_str(&row);
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_fixed_matches_javascript_including_ties() {
        // Each is `(x).toFixed(n)` as printed by node (checked, not remembered).
        assert_eq!(to_fixed(11.0078125, 6), "11.007813"); // exact tie: up
        assert_eq!(to_fixed(0.0078125, 6), "0.007813");
        assert_eq!(to_fixed(2.5, 0), "3");
        assert_eq!(to_fixed(-2.5, 0), "-3");
        assert_eq!(to_fixed(0.5, 0), "1");
        assert_eq!(to_fixed(1.005, 2), "1.00"); // 1.005 is below the tie in binary
        assert_eq!(to_fixed(47.123456789, 6), "47.123457");
        assert_eq!(to_fixed(9.9999996, 6), "10.000000");
        assert_eq!(to_fixed(0.0, 2), "0.00");
        assert_eq!(to_fixed(-0.0000001, 2), "-0.00");
        assert_eq!(to_fixed(123.456, 1), "123.5");
        assert_eq!(to_fixed(999.95, 1), "1000.0"); // 999.95 is just above the tie in binary
        assert_eq!(to_fixed(1.45, 1), "1.4"); // and 1.45 just below
        assert_eq!(to_fixed(8.345, 2), "8.35");
        assert_eq!(to_fixed(-1.5, 0), "-2");
        assert_eq!(to_fixed(0.0000005, 6), "0.000000");
    }

    #[test]
    fn fields_are_quoted_only_when_needed() {
        assert_eq!(escape_field(None), "");
        assert_eq!(escape_field(Some("plain")), "plain");
        assert_eq!(escape_field(Some("a,b")), "\"a,b\"");
        assert_eq!(escape_field(Some("a;b")), "\"a;b\"");
        assert_eq!(escape_field(Some("say \"hi\"")), "\"say \"\"hi\"\"\"");
        assert_eq!(escape_field(Some("line\nbreak")), "\"line\nbreak\"");
    }

    #[test]
    fn headers_have_the_documented_column_counts() {
        assert_eq!(RUN_HEADERS.split(',').count(), 32);
        assert_eq!(LIFT_HEADERS.split(',').count(), 34);
        assert_eq!(SKI_AREA_HEADERS.split(',').count(), 23);
        assert_eq!(SPOT_HEADERS.split(',').count(), 14);
    }
}
