//! The GeoPackage writer against the file the real TypeScript `prepare` writes
//! (`rust/codegen/generate-gpkg-scenes.mjs`): 36 worlds, compared as dumps of every table,
//! index, trigger and view, every row, and every R-tree.
//!
//! Four things are deliberately compared differently (see the `osd_out::gpkg` module docs):
//! `gpkg_contents.last_change` (a clock) is ignored; the bounding box in `gpkg_contents`
//! (upstream's is wrong) is checked against the R-tree instead; the `gpkg_schema` extension
//! rows (they describe tables upstream never creates) are ignored; boolean columns (upstream
//! writes `0` in every cell) are checked against the GeoJSON properties; and R-tree boxes may
//! differ by an f32 ulp or two, being rounded outwards by different SQLite versions.

use osd_cluster::engine::Feature;
use osd_osm::element::{Geometry, Position};
use osd_out::gpkg::{Layers, write_geopackage};
use rusqlite::Connection;
use rusqlite::types::ValueRef;
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::PathBuf;

mod common;
use common::Roles;

#[derive(Deserialize)]
struct Scenes {
    scenes: Vec<Scene>,
    synthetic: Vec<Synthetic>,
}

/// Real output features with extra properties filled in, and what upstream wrote for them.
#[derive(Deserialize)]
struct Synthetic {
    features: SyntheticFeatures,
    expected: Dump,
}

#[derive(Deserialize)]
struct SyntheticFeatures {
    #[serde(rename = "skiAreas")]
    ski_areas: Vec<Value>,
    lifts: Vec<Value>,
    runs: Vec<Value>,
    spots: Vec<Value>,
}

#[derive(Deserialize)]
struct Scene {
    roles: Roles,
    expected: Dump,
}

#[derive(Deserialize, Debug)]
struct Dump {
    #[serde(rename = "applicationId")]
    application_id: i64,
    #[serde(rename = "userVersion")]
    user_version: i64,
    schema: Vec<Object>,
    tables: serde_json::Map<String, Value>,
    sequences: Vec<Value>,
}

#[derive(Deserialize, Debug, PartialEq)]
struct Object {
    #[serde(rename = "type")]
    kind: String,
    name: String,
    sql: String,
}

fn value(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => json!(std::str::from_utf8(t).unwrap()),
        ValueRef::Blob(b) => {
            json!({ "blob": b.iter().map(|x| format!("{x:02x}")).collect::<String>() })
        }
    }
}

/// The same dump the generator takes of the TypeScript file.
fn dump(db: &Connection) -> Dump {
    let is_shadow = |name: &str| {
        ["_node", "_parent", "_rowid"]
            .iter()
            .any(|suffix| name.ends_with(suffix))
    };
    let mut statement = db
        .prepare("select type, name, sql from sqlite_master where sql is not null and name not like 'sqlite_%' order by name")
        .unwrap();
    let schema: Vec<Object> = statement
        .query_map([], |row| {
            Ok(Object {
                kind: row.get(0)?,
                name: row.get(1)?,
                sql: row.get(2)?,
            })
        })
        .unwrap()
        .map(Result::unwrap)
        .filter(|o| !(o.kind == "table" && is_shadow(&o.name)))
        .collect();

    let mut tables = serde_json::Map::new();
    for object in schema.iter().filter(|o| o.kind == "table") {
        let order = if object.sql.starts_with("CREATE VIRTUAL TABLE") {
            "id"
        } else {
            "rowid"
        };
        let mut statement = db
            .prepare(&format!(
                "select * from \"{}\" order by {order}",
                object.name
            ))
            .unwrap();
        let columns: Vec<String> = statement.column_names().map(|c| c.to_string()).collect();
        let rows: Vec<Value> = statement
            .query_map([], |row| {
                Ok(Value::Array(
                    columns
                        .iter()
                        .enumerate()
                        .filter(|(_, c)| *c != "last_change")
                        .map(|(i, _)| value(row.get_ref(i).unwrap()))
                        .collect(),
                ))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect();
        tables.insert(object.name.clone(), Value::Array(rows));
    }

    let mut statement = db
        .prepare("select name, seq from sqlite_sequence order by name")
        .unwrap();
    let sequences = statement
        .query_map([], |row| {
            Ok(json!({ "name": row.get::<_, String>(0)?, "seq": row.get::<_, i64>(1)? }))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();
    Dump {
        application_id: db
            .pragma_query_value(None, "application_id", |r| r.get(0))
            .unwrap(),
        user_version: db
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap(),
        schema,
        tables,
        sequences,
    }
}

/// Equality with numbers compared as `f64`, since JSON does not distinguish `1` from `1.0`.
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, p)| y.get(k).is_some_and(|q| same(p, q)))
        }
        _ => a == b,
    }
}

/// The positions (in a row) and names of a feature table's BOOLEAN columns.
fn boolean_columns(ddl: &str) -> Vec<(usize, String)> {
    ddl.lines()
        .filter(|l| l.starts_with("  \""))
        .enumerate()
        .filter_map(|(i, l)| {
            let (name, ty) = l.trim().trim_end_matches(',').split_once(' ')?;
            (ty == "BOOLEAN").then(|| (i, name.trim_matches('"').to_owned()))
        })
        .collect()
}

/// Rounds every decimal number in a `statistics` cell to nine significant digits.
///
/// Lengths come from turf's haversine, and a last-digit difference in the sum of segment
/// lengths is documented (the cluster scenes allow a relative 1e-9). The text around the
/// numbers, key order included, is still compared exactly.
fn round_statistics(rows: &Value, ddl: &str) -> Vec<Value> {
    let index = ddl
        .lines()
        .filter(|l| l.starts_with("  \""))
        .position(|l| l.trim_start().starts_with("\"statistics\""));
    let round = |text: &str| -> String {
        let mut out = String::new();
        let mut token = String::new();
        let flush = |token: &mut String, out: &mut String| {
            match token.parse::<f64>() {
                Ok(f) if token.contains('.') => out.push_str(&format!("{f:.8e}")),
                _ => out.push_str(token),
            }
            token.clear();
        };
        for c in text.chars() {
            if c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '-' | '+') {
                token.push(c);
            } else {
                flush(&mut token, &mut out);
                out.push(c);
            }
        }
        flush(&mut token, &mut out);
        out
    };
    rows.as_array()
        .unwrap()
        .iter()
        .map(|row| {
            let mut row = row.as_array().unwrap().clone();
            if let Some(text) = index.and_then(|i| row[i].as_str().map(round)) {
                row[index.unwrap()] = json!(text);
            }
            Value::Array(row)
        })
        .collect()
}

/// Drops the columns and rows this port intentionally does not reproduce.
fn comparable(table: &str, rows: &Value, ddl: &str) -> Value {
    let rows = &round_statistics(rows, ddl);
    let booleans = boolean_columns(ddl);
    if !booleans.is_empty() {
        return Value::Array(
            rows.iter()
                .map(|row| {
                    Value::Array(
                        row.as_array()
                            .unwrap()
                            .iter()
                            .enumerate()
                            .filter(|(i, _)| booleans.iter().all(|(b, _)| b != i))
                            .map(|(_, v)| v.clone())
                            .collect(),
                    )
                })
                .collect(),
        );
    }
    match table {
        // table_name, data_type, identifier, description, [min_x, min_y, max_x, max_y], srs_id
        "gpkg_contents" => Value::Array(
            rows.iter()
                .map(|row| {
                    let row = row.as_array().unwrap();
                    Value::Array(
                        row[..4]
                            .iter()
                            .chain(&row[8..])
                            .cloned()
                            .collect::<Vec<Value>>(),
                    )
                })
                .collect(),
        ),
        // table_name, column_name, extension_name, definition, scope
        "gpkg_extensions" => Value::Array(
            rows.iter()
                .filter(|row| row[2] != json!("gpkg_schema"))
                .cloned()
                .collect(),
        ),
        _ => Value::Array(rows.clone()),
    }
}

/// R-tree boxes agree when ours lies inside theirs by no more than two f32 ulps.
fn rtrees_agree(got: &Value, want: &Value) -> bool {
    let (got, want) = (got.as_array().unwrap(), want.as_array().unwrap());
    got.len() == want.len()
        && got.iter().zip(want).all(|(g, w)| {
            let nums = |v: &Value| -> Vec<f64> {
                v.as_array()
                    .unwrap()
                    .iter()
                    .map(|x| x.as_f64().unwrap())
                    .collect()
            };
            let (g, w) = (nums(g), nums(w));
            let slack = |a: f64, b: f64| 3.0 * f64::from(f32::EPSILON) * a.abs().max(b.abs());
            g[0] == w[0]
                && [(1, 2), (3, 4)].iter().all(|&(lo, hi)| {
                    g[lo] >= w[lo]
                        && g[lo] - w[lo] <= slack(g[lo], w[lo])
                        && g[hi] <= w[hi]
                        && w[hi] - g[hi] <= slack(g[hi], w[hi])
                })
        })
}

/// The largest `f32` not above `x`, and the smallest not below it: how SQLite's R-tree
/// rounds a box outwards.
fn f32_down(x: f64) -> f64 {
    let f = x as f32;
    f64::from(if f64::from(f) > x { f.next_down() } else { f })
}
fn f32_up(x: f64) -> f64 {
    let f = x as f32;
    f64::from(if f64::from(f) < x { f.next_up() } else { f })
}

fn temp_path(label: &str, n: usize) -> PathBuf {
    std::env::temp_dir().join(format!(
        "osd-gpkg-test-{}-{label}-{n}.gpkg",
        std::process::id()
    ))
}

/// The properties of each layer's features as JSON, by layer name.
struct Properties {
    lifts: Vec<Value>,
    runs: Vec<Value>,
    spots: Vec<Value>,
}

/// Writes the GeoPackage for `layers` and returns every way it differs from `want`.
fn verify(
    label: &str,
    n: usize,
    layers: &Layers<'_>,
    properties: &Properties,
    want: &Dump,
) -> Vec<String> {
    let path = temp_path(label, n);
    write_geopackage(&path, layers).unwrap();
    let db = Connection::open(&path).unwrap();
    let got = dump(&db);
    drop(db);
    let _ = std::fs::remove_file(&path);

    let mut problems: Vec<String> = Vec::new();
    let mut fail = |what: String| problems.push(format!("{label} {n}: {what}"));
    if got.application_id != want.application_id || got.user_version != want.user_version {
        fail(format!(
            "pragmas {}/{} vs {}/{}",
            got.application_id, got.user_version, want.application_id, want.user_version
        ));
    }
    if got.schema != want.schema {
        let g: Vec<_> = got.schema.iter().map(|o| &o.name).collect();
        let w: Vec<_> = want.schema.iter().map(|o| &o.name).collect();
        if g != w {
            fail(format!("objects {g:?} vs {w:?}"));
        } else if let Some((a, b)) = got.schema.iter().zip(&want.schema).find(|(a, b)| a != b) {
            fail(format!(
                "DDL of {}\n  actual:   {}\n  expected: {}",
                a.name, a.sql, b.sql
            ));
        }
    }
    if !same(&json!(got.sequences), &json!(want.sequences)) {
        fail(format!(
            "sqlite_sequence {:?} vs {:?}",
            got.sequences, want.sequences
        ));
    }
    if got.tables.keys().ne(want.tables.keys()) {
        fail("table sets differ".into());
    }
    for (table, rows) in &got.tables {
        let Some(expected) = want.tables.get(table) else {
            continue;
        };
        let ddl = got
            .schema
            .iter()
            .find(|o| o.name == *table)
            .map_or("", |o| o.sql.as_str());
        let (g, w) = (
            comparable(table, rows, ddl),
            comparable(table, expected, ddl),
        );
        if same(&g, &w) || (table.starts_with("rtree_") && rtrees_agree(&g, &w)) {
            continue;
        }
        let (g, w) = (g.as_array().unwrap(), w.as_array().unwrap());
        if g.len() != w.len() {
            fail(format!("{table}: {} rows, expected {}", g.len(), w.len()));
        } else if let Some((i, (a, b))) =
            g.iter().zip(w).enumerate().find(|(_, (a, b))| !same(a, b))
        {
            fail(format!("{table}[{i}]\n  actual:   {a}\n  expected: {b}"));
        }
    }

    // Booleans: the intended 1 / 0 / NULL for true / false / absent, from the properties
    // the GeoJSON carries (which the cluster scenes already prove equal to upstream's).
    for (table, rows) in &got.tables {
        let layer = match table.split('_').next() {
            Some("lifts") => &properties.lifts,
            Some("runs") => &properties.runs,
            Some("spots") => &properties.spots,
            _ => continue,
        };
        let ddl = &got.schema.iter().find(|o| o.name == *table).unwrap().sql;
        for row in rows.as_array().unwrap() {
            let row = row.as_array().unwrap();
            let id = row[2].as_str().unwrap();
            let feature = layer
                .iter()
                .find(|p| p["id"] == id)
                .unwrap_or_else(|| panic!("{label} {n}: no feature {id} for {table}"));
            for (i, name) in boolean_columns(ddl) {
                let want = match feature.get(&name) {
                    Some(Value::Bool(b)) => json!(i64::from(*b)),
                    _ => Value::Null,
                };
                if row[i] != want {
                    fail(format!("{table}.{name} of {id}: {} vs {want}", row[i]));
                }
            }
        }
    }

    // The bounding box upstream gets wrong: ours must be the extent of the R-tree.
    for row in got.tables["gpkg_contents"].as_array().unwrap() {
        let row = row.as_array().unwrap();
        let name = row[0].as_str().unwrap();
        let bbox: Vec<f64> = row[4..8].iter().map(|v| v.as_f64().unwrap()).collect();
        let (mut minx, mut maxx, mut miny, mut maxy) = (
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
        );
        for r in got.tables[&format!("rtree_{name}_geometry")]
            .as_array()
            .unwrap()
        {
            let r: Vec<f64> = r
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_f64().unwrap())
                .collect();
            (minx, maxx) = (minx.min(r[1]), maxx.max(r[2]));
            (miny, maxy) = (miny.min(r[3]), maxy.max(r[4]));
        }
        let want = [
            f32_down(bbox[0]),
            f32_down(bbox[1]),
            f32_up(bbox[2]),
            f32_up(bbox[3]),
        ];
        if [minx, miny, maxx, maxy] != want {
            fail(format!(
                "{name}: bbox {bbox:?} does not match R-tree {minx} {miny} {maxx} {maxy}"
            ));
        }
    }
    problems
}

fn assert_no_problems(failures: Vec<String>) {
    assert!(
        failures.is_empty(),
        "{} problems; first:\n{}",
        failures.len(),
        failures
            .iter()
            .take(6)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn every_recorded_geopackage_is_reproduced() {
    let scenes: Scenes = serde_json::from_str(include_str!("gpkg_scenes.json")).unwrap();
    assert!(scenes.scenes.len() >= 30);

    let mut failures = Vec::new();
    for (n, scene) in scenes.scenes.iter().enumerate() {
        let output = common::run(&scene.roles);
        let properties = Properties {
            lifts: output.lifts.iter().map(|f| json!(f.properties)).collect(),
            runs: output.runs.iter().map(|f| json!(f.properties)).collect(),
            spots: output.spots.iter().map(|f| json!(f.properties)).collect(),
        };
        failures.extend(verify(
            "scene",
            n,
            &Layers {
                ski_areas: &output.ski_areas,
                lifts: &output.lifts,
                runs: &output.runs,
                spots: &output.spots,
            },
            &properties,
            &scene.expected,
        ));
    }
    assert_no_problems(failures);
}

fn position(v: &Value) -> Position {
    [v[0].as_f64().unwrap(), v[1].as_f64().unwrap()]
}

fn positions(v: &Value) -> Vec<Position> {
    v.as_array().unwrap().iter().map(position).collect()
}

fn rings(v: &Value) -> Vec<Vec<Position>> {
    v.as_array().unwrap().iter().map(positions).collect()
}

fn geometry(v: &Value) -> Geometry {
    let c = &v["coordinates"];
    match v["type"].as_str().unwrap() {
        "Point" => Geometry::Point(position(c)),
        "LineString" => Geometry::LineString(positions(c)),
        "Polygon" => Geometry::Polygon(rings(c)),
        "MultiLineString" => Geometry::MultiLineString(rings(c)),
        "MultiPolygon" => Geometry::MultiPolygon(c.as_array().unwrap().iter().map(rings).collect()),
        other => panic!("unexpected geometry {other}"),
    }
}

fn features<P: serde::de::DeserializeOwned>(values: &[Value]) -> Vec<Feature<P>> {
    values
        .iter()
        .map(|v| Feature {
            geometry: geometry(&v["geometry"]),
            properties: serde_json::from_value(v["properties"].clone()).unwrap(),
        })
        .collect()
}

/// Places, references, elevations, lift-station positions and every boolean value, which no
/// real world exercises: random ones, written by the real writer and by this one.
#[test]
fn synthetic_properties_are_written_like_upstream() {
    let scenes: Scenes = serde_json::from_str(include_str!("gpkg_scenes.json")).unwrap();
    assert!(scenes.synthetic.len() >= 10);

    let mut failures = Vec::new();
    for (n, set) in scenes.synthetic.iter().enumerate() {
        let f = &set.features;
        let properties = |values: &[Value]| -> Vec<Value> {
            values.iter().map(|v| v["properties"].clone()).collect()
        };
        failures.extend(verify(
            "synthetic",
            n,
            &Layers {
                ski_areas: &features(&f.ski_areas),
                lifts: &features(&f.lifts),
                runs: &features(&f.runs),
                spots: &features(&f.spots),
            },
            &Properties {
                lifts: properties(&f.lifts),
                runs: properties(&f.runs),
                spots: properties(&f.spots),
            },
            &set.expected,
        ));
    }
    assert_no_problems(failures);
}
