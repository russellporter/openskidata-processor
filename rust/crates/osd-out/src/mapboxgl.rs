//! The slimmed GeoJSON that feeds tippecanoe.
//!
//! Replaces `src/transforms/MapboxGLFormatter.ts`: each feature keeps only the properties a
//! map style needs -- ids, display names, colours, the ids of its ski areas -- and ski areas
//! are reduced to a single point guaranteed to lie within them.
//!
//! Property names are part of the contract with the map style (`openskimap.org`), so they
//! are as upstream's, including the mixed `name_and_type`, `has_downhill`, `stationIds` and
//! `downhillDistance`.

use openskidata_format::lift::{LiftProperties, lift_color, lift_name_and_type};
use openskidata_format::run::{RunProperties, run_color_name, run_color_name_to_value};
use openskidata_format::ski_area::SkiAreaProperties;
use openskidata_format::spot::{SpotKind, SpotProperties};
use openskidata_format::{RunUse, SkiAreaActivity};
use osd_cluster::engine::Feature;
use osd_cluster::turf;
use osd_osm::element::{Geometry, Position};
use osd_tags::js_number::{round, trim};
use serde_json::{Map, Value, json};

fn feature(geometry: Value, properties: Map<String, Value>) -> Value {
    json!({ "type": "Feature", "geometry": geometry, "properties": properties })
}

fn to_value<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("serializes")
}

/// `getNameIncludingRef`.
fn name_including_ref(name: Option<&str>, reference: Option<&str>) -> Value {
    match (name, reference) {
        (name, None) => name.map_or(Value::Null, |n| json!(n)),
        (None, Some(reference)) => json!(reference),
        (Some(name), Some(reference)) => json!(format!("{reference} - {name}")),
    }
}

/// The run's use, folded into the four the style knows.
fn style_use(use_: RunUse) -> &'static str {
    match use_ {
        RunUse::Downhill => "downhill",
        RunUse::Nordic => "nordic",
        RunUse::Skitour => "skitour",
        _ => "other",
    }
}

/// A run, or `None` for one whose every use is a connection (those are not drawn).
pub fn run(f: &Feature<RunProperties>) -> Option<Value> {
    let p = &f.properties;
    if p.uses.iter().all(|u| *u == RunUse::Connection) {
        return None;
    }
    let color_name = run_color_name(p.difficulty_convention, p.difficulty);
    let mut properties = Map::new();
    properties.insert("id".into(), json!(p.id));
    properties.insert(
        "name".into(),
        name_including_ref(p.name.as_deref(), p.reference.as_deref()),
    );
    properties.insert("difficulty".into(), to_value(&p.difficulty));
    properties.insert("oneway".into(), json!(p.oneway));
    properties.insert("lit".into(), json!(p.lit));
    properties.insert("gladed".into(), json!(p.gladed));
    properties.insert("patrolled".into(), json!(p.patrolled));
    properties.insert(
        "color".into(),
        to_value(&run_color_name_to_value(color_name)),
    );
    properties.insert("colorName".into(), to_value(&color_name));
    properties.insert("grooming".into(), to_value(&p.grooming));
    properties.insert("snowmaking".into(), json!(p.snowmaking));
    properties.insert("snowfarming".into(), json!(p.snowfarming));
    properties.insert("tunnel".into(), json!(p.tunnel));
    properties.insert(
        "skiAreas".into(),
        json!(
            p.ski_areas
                .iter()
                .map(|s| &s.properties.id)
                .collect::<Vec<_>>()
        ),
    );

    // Parallel lines, one per distinct use, centred on the run: offsets average to zero.
    let mut uses: Vec<&str> = p.uses.iter().map(|u| style_use(*u)).collect();
    uses.sort_unstable();
    uses.dedup();
    for (index, use_) in uses.iter().enumerate() {
        let offset = index as f64 - (uses.len() as f64 - 1.0) / 2.0;
        properties.insert((*use_).into(), json!(offset));
    }
    Some(feature(to_value(&f.geometry), properties))
}

pub fn lift(f: &Feature<LiftProperties>) -> Value {
    let p = &f.properties;
    let mut properties = Map::new();
    properties.insert("id".into(), json!(p.id));
    properties.insert(
        "name_and_type".into(),
        name_including_ref(lift_name_and_type(p).as_deref(), p.reference.as_deref()),
    );
    properties.insert("color".into(), json!(lift_color(p.status)));
    properties.insert("status".into(), to_value(&p.status));
    properties.insert("access".into(), to_value(&p.access));
    properties.insert(
        "stationIds".into(),
        json!(
            p.stations
                .iter()
                .map(|s| &s.properties.base.id)
                .collect::<Vec<_>>()
        ),
    );
    properties.insert(
        "skiAreas".into(),
        json!(
            p.ski_areas
                .iter()
                .map(|s| &s.properties.id)
                .collect::<Vec<_>>()
        ),
    );
    properties.insert("tunnel".into(), json!(p.tunnel));
    feature(to_value(&f.geometry), properties)
}

pub fn spot(f: &Feature<SpotProperties>) -> Value {
    let p = &f.properties;
    let mut properties = Map::new();
    properties.insert("id".into(), json!(p.base.id));
    properties.insert("spotType".into(), spot_type(&p.kind));
    properties.insert(
        "skiAreas".into(),
        json!(
            p.base
                .ski_areas
                .iter()
                .map(|s| &s.properties.id)
                .collect::<Vec<_>>()
        ),
    );
    match &p.kind {
        SpotKind::LiftStation {
            name,
            position,
            entry,
            exit,
            lift_id,
        } => {
            properties.insert("name".into(), json!(name));
            properties.insert("liftId".into(), json!(lift_id));
            properties.insert("position".into(), to_value(position));
            properties.insert("entry".into(), json!(entry));
            properties.insert("exit".into(), json!(exit));
        }
        SpotKind::Crossing { dismount } => {
            properties.insert("dismount".into(), to_value(dismount));
        }
        _ => {}
    }
    feature(to_value(&f.geometry), properties)
}

fn spot_type(kind: &SpotKind) -> Value {
    to_value(kind)["spotType"].clone()
}

/// `shortenedName`: long names lose a trailing parenthetical.
fn shortened_name(name: Option<&str>) -> Value {
    match name {
        Some(name) if name.encode_utf16().count() > 20 => {
            json!(trim(name.split('(').next().unwrap_or(name)))
        }
        Some(name) => json!(name),
        None => Value::Null,
    }
}

fn run_distance_km(properties: &SkiAreaProperties, activity: &str) -> Option<f64> {
    let statistics = properties.statistics.as_ref()?;
    let by_difficulty = &statistics.runs.by_activity.get(activity)?.by_difficulty;
    Some(by_difficulty.values().map(|s| s.length_in_km).sum())
}

pub fn ski_area(f: &Feature<SkiAreaProperties>) -> Value {
    let p = &f.properties;
    let statistics = p.statistics.as_ref();
    let rounded = |value: Option<f64>| value.map_or(Value::Null, |v| json!(round(v)));
    // JavaScript truthiness: an elevation of zero is no elevation.
    let truthy = |value: Option<f64>| value.filter(|v| *v != 0.0);

    let mut properties = Map::new();
    properties.insert("id".into(), json!(p.summary.id));
    properties.insert("name".into(), shortened_name(p.summary.name.as_deref()));
    properties.insert("status".into(), to_value(&p.summary.status));
    properties.insert(
        "downhillDistance".into(),
        rounded(run_distance_km(p, "downhill")),
    );
    properties.insert(
        "nordicDistance".into(),
        rounded(run_distance_km(p, "nordic")),
    );
    properties.insert(
        "maxElevation".into(),
        rounded(truthy(statistics.and_then(|s| s.max_elevation))),
    );
    let vertical = statistics.and_then(|s| {
        truthy(s.max_elevation)
            .zip(truthy(s.min_elevation))
            .map(|(max, min)| max - min)
    });
    properties.insert("vertical".into(), rounded(vertical));
    if p.summary.activities.contains(&SkiAreaActivity::Downhill) {
        properties.insert("has_downhill".into(), json!(true));
    }
    if p.summary.activities.contains(&SkiAreaActivity::Nordic) {
        properties.insert("has_nordic".into(), json!(true));
    }
    feature(central_points(&f.geometry), properties)
}

/// `centralPointsInFeature`: a point guaranteed to lie within each polygon.
///
/// The centroid if it is inside, otherwise the closest point on the polygon's rings.
pub fn central_points(geometry: &Geometry) -> Value {
    match geometry {
        Geometry::Point(p) => json!({ "type": "Point", "coordinates": p }),
        Geometry::Polygon(rings) => {
            json!({ "type": "Point", "coordinates": central_point_of_polygon(rings) })
        }
        Geometry::MultiPolygon(polygons) => json!({
            "type": "MultiPoint",
            "coordinates": polygons.iter().map(|rings| central_point_of_polygon(rings)).collect::<Vec<_>>(),
        }),
        other => panic!("a ski area cannot have geometry {other:?}"),
    }
}

fn central_point_of_polygon(rings: &[Vec<Position>]) -> Position {
    let center = turf::centroid(&[&Geometry::Polygon(rings.to_vec())]);
    let ring_refs: Vec<&[[f64; 2]]> = rings.iter().map(Vec::as_slice).collect();
    if openskidata_format::convention::point_in_polygon(center[0], center[1], &ring_refs)
        != openskidata_format::convention::Containment::Outside
    {
        return center;
    }

    // The closest point on any ring. Upstream's reduce returns the candidate whenever the
    // running distance or the candidate's distance is zero (falsy), and otherwise keeps the
    // strictly closer one, preferring the candidate on a tie.
    let mut best: Option<(Position, f64)> = None;
    for ring in rings {
        let (point, distance) = turf::nearest_point_on_line(ring, center);
        best = match best {
            None => Some((point, distance)),
            Some(_) if distance == 0.0 || distance.is_nan() => Some((point, distance)),
            Some((_, best_distance)) if best_distance == 0.0 || best_distance.is_nan() => {
                Some((point, distance))
            }
            Some(current) if current.1 < distance => Some(current),
            Some(_) => Some((point, distance)),
        };
    }
    best.expect("a polygon has a ring").0
}
