//! GeoPackage output.
//!
//! Replaces `src/io/GeoPackageWriter.ts` (831 lines driving `@ngageoint/geopackage`). A
//! GeoPackage is SQLite plus WKB plus a few metadata tables, so this writes it directly.
//!
//! # Layout (as upstream)
//!
//! One file with four layers. Each layer is split into one table per geometry type, named
//! `{layer}_{type}`: `lifts_linestring`, `runs_linestring`, `spots_point`,
//! `ski_areas_multipolygon`, and so on. Polygons are stored as multipolygons so a layer has
//! one polygon table. Ski areas additionally get `ski_areas_point`, holding the centroid of
//! every ski area, whatever its own geometry, so a point layer covers them all; ski areas
//! that are themselves points appear only there.
//!
//! Each feature table has an integer primary key `id`, a `geometry` column holding a
//! GeoPackage geometry blob (`GP`, version 0, flags 0, SRS 4326, then little-endian WKB), and
//! one column per property in the layer's schema. Booleans are stored as 0/1. The `sources`,
//! `websites` and `statistics` columns hold JSON text with object keys in PostgreSQL `jsonb`
//! order (shorter keys first, then bytewise), which is the order the TypeScript pipeline
//! happens to emit because its features pass through that column type.
//!
//! # Divergences from upstream
//!
//! - `gpkg_contents` carries the true bounding box of each table. Upstream passes the
//!   box's corners to the library in the wrong order (its `min_y` is a longitude and its
//!   `max_x` a latitude), and computes it from the first batch of 1,000 features only.
//! - `gpkg_extensions` lists the R-tree extension and `gpkg_crs_wkt` (the
//!   `definition_12_063` column), but not the `gpkg_schema` extension. Upstream lists that
//!   too, for `gpkg_data_columns` and `gpkg_data_column_constraints`, which it never creates.
//! - Boolean columns hold the intended `1`, `0` or `NULL`. Upstream passes the library the
//!   numbers `1`/`0`, which `@ngageoint/geopackage` treats as "not `true`" and stores as `0`,
//!   so every boolean cell (`lit`, `oneway`, `bubble`, ...) of an upstream file is `0`
//!   whatever the feature says, and an unknown value is `0` rather than `NULL`.
//! - R-tree boxes are as tight as the bundled SQLite makes them; upstream's were rounded
//!   outwards by an extra f32 ulp or two by an older SQLite. Both contain the geometry.
//! - Elevation-derived columns (`min_elevation`, `elevation_profile_*`) are null until the
//!   elevation stage is ported, as they are upstream when elevation is not configured.

use anyhow::{Context, Result};
use openskidata_format::lift::LiftProperties;
use openskidata_format::place::Place;
use openskidata_format::run::RunProperties;
use openskidata_format::ski_area::{SkiAreaProperties, SkiAreaSummaryFeature};
use openskidata_format::spot::{SpotKind, SpotProperties};
use osd_cluster::engine::Feature;
use osd_cluster::turf;
use osd_osm::element::{Geometry, Position};
use osd_store::feature_id::js_number_to_string;
use rusqlite::types::Value as Sql;
use rusqlite::{Connection, params_from_iter};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

/// `application_id` of a GeoPackage, `GPKG` in ASCII.
const APPLICATION_ID: i64 = 0x4750_4B47;
/// GeoPackage 1.2.
const USER_VERSION: i64 = 10200;
const WGS84: i64 = 4326;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ty {
    Text,
    Real,
    Boolean,
}

impl Ty {
    fn sql(self) -> &'static str {
        match self {
            Ty::Text => "TEXT",
            Ty::Real => "REAL",
            Ty::Boolean => "BOOLEAN",
        }
    }
}

type Columns = Vec<(&'static str, Ty)>;

// ---------------------------------------------------------------------------------------
// JSON text in jsonb key order
// ---------------------------------------------------------------------------------------

/// Serializes `value` as JavaScript's `JSON.stringify` would after a round trip through
/// PostgreSQL `jsonb`: object keys ordered by length, then bytewise.
fn jsonb_text(value: &impl Serialize) -> String {
    fn write(value: &Value, out: &mut String) {
        match value {
            Value::Object(map) => {
                let mut entries: Vec<(&String, &Value)> = map.iter().collect();
                entries.sort_by(|a, b| a.0.len().cmp(&b.0.len()).then_with(|| a.0.cmp(b.0)));
                out.push('{');
                for (i, (key, value)) in entries.into_iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push_str(&serde_json::to_string(key).expect("string"));
                    out.push(':');
                    write(value, out);
                }
                out.push('}');
            }
            Value::Array(items) => {
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write(item, out);
                }
                out.push(']');
            }
            Value::Number(n) => {
                // JavaScript prints whole numbers without a fractional part.
                match n.as_f64() {
                    Some(f) if n.is_f64() => out.push_str(&js_number_to_string(f)),
                    _ => out.push_str(&n.to_string()),
                }
            }
            other => out.push_str(&serde_json::to_string(other).expect("scalar")),
        }
    }
    let value = serde_json::to_value(value).expect("serializes");
    let mut out = String::new();
    write(&value, &mut out);
    out
}

// ---------------------------------------------------------------------------------------
// Column values
// ---------------------------------------------------------------------------------------

fn text(value: Option<&str>) -> Sql {
    value.map_or(Sql::Null, |v| Sql::Text(v.to_owned()))
}

fn real(value: Option<f64>) -> Sql {
    value.map_or(Sql::Null, Sql::Real)
}

fn boolean(value: Option<bool>) -> Sql {
    value.map_or(Sql::Null, |v| Sql::Integer(i64::from(v)))
}

fn wire<T: Serialize>(value: &T) -> Option<String> {
    match serde_json::to_value(value).ok()? {
        Value::String(s) => Some(s),
        _ => None,
    }
}

/// A `;`-joined list of the distinct values, sorted as JavaScript's `Array.prototype.sort`
/// does (by UTF-16 code units, which differs from byte order for characters above U+FFFF),
/// or `NULL` when there are none. `skip_empty` mirrors the `.filter((x) => x)` upstream
/// applies to the optional fields but not to the mandatory ones.
fn unique_sorted<'a>(values: impl Iterator<Item = Option<&'a str>>, skip_empty: bool) -> Sql {
    let mut unique: Vec<&str> = Vec::new();
    for value in values.flatten().filter(|v| !skip_empty || !v.is_empty()) {
        if !unique.contains(&value) {
            unique.push(value);
        }
    }
    unique.sort_unstable_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    if unique.is_empty() {
        Sql::Null
    } else {
        Sql::Text(unique.join(";"))
    }
}

/// `country_codes`, `region_codes`, `countries`, `regions`, `localities`.
fn place_columns() -> Columns {
    vec![
        ("country_codes", Ty::Text),
        ("region_codes", Ty::Text),
        ("countries", Ty::Text),
        ("regions", Ty::Text),
        ("localities", Ty::Text),
    ]
}

fn place_values(places: &[Place]) -> Vec<Sql> {
    vec![
        unique_sorted(
            places.iter().map(|p| Some(p.iso3166_1_alpha2.as_str())),
            false,
        ),
        unique_sorted(places.iter().map(|p| p.iso3166_2.as_deref()), true),
        unique_sorted(
            places.iter().map(|p| Some(p.localized.en.country.as_str())),
            false,
        ),
        unique_sorted(
            places.iter().map(|p| p.localized.en.region.as_deref()),
            true,
        ),
        unique_sorted(
            places.iter().map(|p| p.localized.en.locality.as_deref()),
            true,
        ),
    ]
}

fn ski_area_ids(areas: &[SkiAreaSummaryFeature]) -> Sql {
    Sql::Text(
        areas
            .iter()
            .map(|a| a.properties.id.as_str())
            .collect::<Vec<_>>()
            .join(","),
    )
}

fn ski_area_names(areas: &[SkiAreaSummaryFeature]) -> Sql {
    Sql::Text(
        areas
            .iter()
            .filter_map(|a| a.properties.name.as_deref())
            .filter(|n| !n.is_empty())
            .collect::<Vec<_>>()
            .join(","),
    )
}

fn common_columns() -> Columns {
    let mut columns = vec![
        ("feature_id", Ty::Text),
        ("name", Ty::Text),
        ("status", Ty::Text),
        ("sources", Ty::Text),
        ("websites", Ty::Text),
        ("wikidata_id", Ty::Text),
    ];
    columns.extend(place_columns());
    columns
}

fn ski_area_schema() -> Columns {
    let mut columns = common_columns();
    columns.extend([
        ("activities", Ty::Text),
        ("min_elevation", Ty::Real),
        ("max_elevation", Ty::Real),
        ("statistics", Ty::Text),
        ("run_convention", Ty::Text),
    ]);
    columns
}

fn ski_area_values(p: &SkiAreaProperties) -> Vec<Sql> {
    let mut values = vec![
        Sql::Text(p.summary.id.clone()),
        text(p.summary.name.as_deref()),
        text(wire(&p.summary.status).as_deref()),
        Sql::Text(jsonb_text(&p.sources)),
        Sql::Text(jsonb_text(&p.websites)),
        text(p.wikidata_id.as_deref()),
    ];
    values.extend(place_values(&p.places));
    values.extend([
        Sql::Text(
            p.summary
                .activities
                .iter()
                .filter_map(wire)
                .collect::<Vec<_>>()
                .join(","),
        ),
        real(p.statistics.as_ref().and_then(|s| s.min_elevation)),
        real(p.statistics.as_ref().and_then(|s| s.max_elevation)),
        p.statistics
            .as_ref()
            .map_or(Sql::Null, |s| Sql::Text(jsonb_text(s))),
        text(wire(&p.run_convention).as_deref()),
    ]);
    values
}

fn lift_schema() -> Columns {
    let mut columns = common_columns();
    columns.extend([
        ("lift_type", Ty::Text),
        ("access", Ty::Text),
        ("ref", Ty::Text),
        ("ref_fr_cairn", Ty::Text),
        ("description", Ty::Text),
        ("oneway", Ty::Boolean),
        ("occupancy", Ty::Real),
        ("capacity", Ty::Real),
        ("duration", Ty::Real),
        ("detachable", Ty::Boolean),
        ("bubble", Ty::Boolean),
        ("heating", Ty::Boolean),
        ("ski_area_ids", Ty::Text),
        ("ski_area_names", Ty::Text),
    ]);
    columns
}

fn lift_values(p: &LiftProperties) -> Vec<Sql> {
    let mut values = vec![
        Sql::Text(p.id.clone()),
        text(p.name.as_deref()),
        text(wire(&p.status).as_deref()),
        Sql::Text(jsonb_text(&p.sources)),
        Sql::Text(jsonb_text(&p.websites)),
        text(p.wikidata_id.as_deref()),
    ];
    values.extend(place_values(&p.places));
    values.extend([
        text(wire(&p.lift_type).as_deref()),
        text(p.access.and_then(|a| wire(&a)).as_deref()),
        text(p.reference.as_deref()),
        text(p.ref_fr_cairn.as_deref()),
        text(p.description.as_deref()),
        boolean(p.oneway),
        real(p.occupancy),
        real(p.capacity),
        real(p.duration),
        boolean(p.detachable),
        boolean(p.bubble),
        boolean(p.heating),
        ski_area_ids(&p.ski_areas),
        ski_area_names(&p.ski_areas),
    ]);
    values
}

fn run_schema() -> Columns {
    let mut columns = common_columns();
    columns.extend([
        ("uses", Ty::Text),
        ("ref", Ty::Text),
        ("description", Ty::Text),
        ("difficulty", Ty::Text),
        ("difficulty_convention", Ty::Text),
        ("oneway", Ty::Boolean),
        ("lit", Ty::Boolean),
        ("gladed", Ty::Boolean),
        ("patrolled", Ty::Boolean),
        ("snowmaking", Ty::Boolean),
        ("snowfarming", Ty::Boolean),
        ("grooming", Ty::Text),
        ("elevation_profile_heights", Ty::Text),
        ("elevation_profile_resolution", Ty::Real),
        ("ski_area_ids", Ty::Text),
        ("ski_area_names", Ty::Text),
    ]);
    columns
}

fn run_values(p: &RunProperties) -> Vec<Sql> {
    let mut values = vec![
        Sql::Text(p.id.clone()),
        text(p.name.as_deref()),
        text(wire(&p.status).as_deref()),
        Sql::Text(jsonb_text(&p.sources)),
        Sql::Text(jsonb_text(&p.websites)),
        text(p.wikidata_id.as_deref()),
    ];
    values.extend(place_values(&p.places));
    values.extend([
        Sql::Text(p.uses.iter().filter_map(wire).collect::<Vec<_>>().join(",")),
        text(p.reference.as_deref()),
        text(p.description.as_deref()),
        text(p.difficulty.and_then(|d| wire(&d)).as_deref()),
        text(wire(&p.difficulty_convention).as_deref()),
        boolean(p.oneway),
        boolean(p.lit),
        boolean(p.gladed),
        boolean(p.patrolled),
        boolean(p.snowmaking),
        boolean(p.snowfarming),
        text(p.grooming.and_then(|g| wire(&g)).as_deref()),
        p.elevation_profile.as_ref().map_or(Sql::Null, |e| {
            Sql::Text(
                e.heights
                    .iter()
                    .map(|h| js_number_to_string(*h))
                    .collect::<Vec<_>>()
                    .join(","),
            )
        }),
        real(p.elevation_profile.as_ref().map(|e| e.resolution)),
        ski_area_ids(&p.ski_areas),
        ski_area_names(&p.ski_areas),
    ]);
    values
}

fn spot_schema() -> Columns {
    let mut columns: Columns = vec![
        ("feature_id", Ty::Text),
        ("spot_type", Ty::Text),
        ("sources", Ty::Text),
        ("ski_area_ids", Ty::Text),
        ("ski_area_names", Ty::Text),
    ];
    columns.extend(place_columns());
    columns.extend([
        ("dismount", Ty::Text),
        ("name", Ty::Text),
        ("position", Ty::Text),
        ("entry", Ty::Boolean),
        ("exit", Ty::Boolean),
    ]);
    columns
}

fn spot_values(p: &SpotProperties) -> Vec<Sql> {
    let spot_type = serde_json::to_value(&p.kind).expect("serializes")["spotType"]
        .as_str()
        .map(str::to_owned);
    let mut values = vec![
        Sql::Text(p.base.id.clone()),
        text(spot_type.as_deref()),
        Sql::Text(jsonb_text(&p.base.sources)),
        ski_area_ids(&p.base.ski_areas),
        ski_area_names(&p.base.ski_areas),
    ];
    values.extend(place_values(&p.base.places));
    let (dismount, name, position, entry, exit) = match &p.kind {
        SpotKind::Crossing { dismount } => (
            text(wire(dismount).as_deref()),
            Sql::Null,
            Sql::Null,
            Sql::Null,
            Sql::Null,
        ),
        SpotKind::LiftStation {
            name,
            position,
            entry,
            exit,
            ..
        } => (
            Sql::Null,
            text(name.as_deref()),
            text(position.and_then(|p| wire(&p)).as_deref()),
            boolean(*entry),
            boolean(*exit),
        ),
        _ => (Sql::Null, Sql::Null, Sql::Null, Sql::Null, Sql::Null),
    };
    values.extend([dismount, name, position, entry, exit]);
    values
}

// ---------------------------------------------------------------------------------------
// Geometry blobs
// ---------------------------------------------------------------------------------------

/// The Z flag of a WKB geometry type, as the library writes it for elevated geometries.
const WKB_Z: u32 = 0x8000_0000;

/// Hands out the elevations of a geometry's coordinates in order, if it has any.
struct Elevations<'a>(Option<std::slice::Iter<'a, f64>>);

impl<'a> Elevations<'a> {
    fn new(elevations: Option<&'a [f64]>) -> Self {
        Elevations(elevations.map(|e| e.iter()))
    }

    fn present(&self) -> bool {
        self.0.is_some()
    }

    fn type_flag(&self) -> u32 {
        if self.present() { WKB_Z } else { 0 }
    }
}

fn wkb_header(out: &mut Vec<u8>, geometry_type: u32, z: &Elevations<'_>) {
    out.push(1); // little endian
    out.extend((geometry_type | z.type_flag()).to_le_bytes());
}

fn wkb_position(out: &mut Vec<u8>, p: &Position, z: &mut Elevations<'_>) {
    out.extend(p[0].to_le_bytes());
    out.extend(p[1].to_le_bytes());
    if let Some(height) = z.0.as_mut().map(|e| e.next().copied().unwrap_or(f64::NAN)) {
        out.extend(height.to_le_bytes());
    }
}

fn wkb_line(out: &mut Vec<u8>, positions: &[Position], z: &mut Elevations<'_>) {
    out.extend((positions.len() as u32).to_le_bytes());
    positions.iter().for_each(|p| wkb_position(out, p, z));
}

fn wkb_polygon(out: &mut Vec<u8>, rings: &[Vec<Position>], z: &mut Elevations<'_>) {
    wkb_header(out, 3, z);
    out.extend((rings.len() as u32).to_le_bytes());
    rings.iter().for_each(|r| wkb_line(out, r, z));
}

fn wkb(geometry: &Geometry, elevations: Option<&[f64]>) -> Vec<u8> {
    let mut z = Elevations::new(elevations);
    let mut out = Vec::new();
    match geometry {
        Geometry::Point(p) => {
            wkb_header(&mut out, 1, &z);
            wkb_position(&mut out, p, &mut z);
        }
        Geometry::LineString(line) => {
            wkb_header(&mut out, 2, &z);
            wkb_line(&mut out, line, &mut z);
        }
        Geometry::MultiLineString(lines) => {
            wkb_header(&mut out, 5, &z);
            out.extend((lines.len() as u32).to_le_bytes());
            for line in lines {
                wkb_header(&mut out, 2, &z);
                wkb_line(&mut out, line, &mut z);
            }
        }
        // A layer has one polygon table, so a polygon is stored as a multipolygon of one.
        Geometry::Polygon(rings) => {
            wkb_header(&mut out, 6, &z);
            out.extend(1u32.to_le_bytes());
            wkb_polygon(&mut out, rings, &mut z);
        }
        Geometry::MultiPolygon(polygons) => {
            wkb_header(&mut out, 6, &z);
            out.extend((polygons.len() as u32).to_le_bytes());
            polygons
                .iter()
                .for_each(|rings| wkb_polygon(&mut out, rings, &mut z));
        }
    }
    out
}

/// A GeoPackage geometry blob: `GP`, version 0, flags 0 (big-endian header, no envelope),
/// the SRS id, then the WKB.
fn blob(geometry: &Geometry, elevations: Option<&[f64]>) -> Vec<u8> {
    let mut out = vec![b'G', b'P', 0, 0];
    out.extend((WGS84 as u32).to_be_bytes());
    out.extend(wkb(geometry, elevations));
    out
}

/// `[min_x, min_y, max_x, max_y]`.
fn envelope(geometry: &Geometry) -> [f64; 4] {
    let mut e = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for p in turf::positions(geometry) {
        e = [
            e[0].min(p[0]),
            e[1].min(p[1]),
            e[2].max(p[0]),
            e[3].max(p[1]),
        ];
    }
    e
}

/// The table suffix and `geometry_type_name` of a geometry, with polygons as multipolygons.
fn table_kind(geometry: &Geometry) -> (&'static str, &'static str) {
    match geometry {
        Geometry::Point(_) => ("point", "POINT"),
        Geometry::LineString(_) => ("linestring", "LINESTRING"),
        Geometry::MultiLineString(_) => ("multilinestring", "MULTILINESTRING"),
        Geometry::Polygon(_) | Geometry::MultiPolygon(_) => ("multipolygon", "MULTIPOLYGON"),
    }
}

// ---------------------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------------------

// The DDL below is copied from a file the TypeScript pipeline wrote, by
// `rust/codegen/generate-gpkg-scenes.mjs`, so that the schema text matches exactly.
const SPATIAL_REF_SYS: &str = include_str!("gpkg_sql/spatial_ref_sys.sql");
const CONTENTS: &str = include_str!("gpkg_sql/contents.sql");
const GEOMETRY_COLUMNS: &str = include_str!("gpkg_sql/geometry_columns.sql");
const EXTENSIONS: &str = include_str!("gpkg_sql/extensions.sql");
const VIEWS: [&str; 4] = [
    include_str!("gpkg_sql/view_st_spatial_ref_sys.sql"),
    include_str!("gpkg_sql/view_spatial_ref_sys.sql"),
    include_str!("gpkg_sql/view_st_geometry_columns.sql"),
    include_str!("gpkg_sql/view_geometry_columns.sql"),
];
const SRS_ROWS: &str = include_str!("gpkg_sql/spatial_ref_sys_rows.json");
const RTREE: &str = include_str!("gpkg_sql/rtree.sql");
const TRIGGERS: [&str; 6] = [
    include_str!("gpkg_sql/trigger_insert.sql"),
    include_str!("gpkg_sql/trigger_update1.sql"),
    include_str!("gpkg_sql/trigger_update2.sql"),
    include_str!("gpkg_sql/trigger_update3.sql"),
    include_str!("gpkg_sql/trigger_update4.sql"),
    include_str!("gpkg_sql/trigger_delete.sql"),
];

fn create_metadata(db: &Connection) -> Result<()> {
    db.pragma_update(None, "application_id", APPLICATION_ID)?;
    db.pragma_update(None, "user_version", USER_VERSION)?;
    for sql in [SPATIAL_REF_SYS, CONTENTS, GEOMETRY_COLUMNS, EXTENSIONS] {
        db.execute(sql, [])?;
    }
    let rows: Vec<Value> = serde_json::from_str(SRS_ROWS).expect("embedded SRS rows");
    for row in rows {
        db.execute(
            "INSERT INTO gpkg_spatial_ref_sys (srs_name, srs_id, organization, organization_coordsys_id, definition, description, definition_12_063) VALUES (?, ?, ?, ?, ?, ?, ?)",
            rusqlite::params![
                row["srs_name"].as_str(),
                row["srs_id"].as_i64(),
                row["organization"].as_str(),
                row["organization_coordsys_id"].as_i64(),
                row["definition"].as_str(),
                row["description"].as_str(),
                row["definition_12_063"].as_str(),
            ],
        )?;
    }
    for sql in VIEWS {
        db.execute(sql, [])?;
    }
    // The R-tree extension is registered per table; the CRS WKT extension is what the
    // `definition_12_063` column implements.
    db.execute(
        "INSERT INTO gpkg_extensions (table_name, column_name, extension_name, definition, scope) VALUES (NULL, NULL, 'gpkg_crs_wkt', 'http://www.geopackage.org/spec/#extension_crs_wkt', 'read-write')",
        [],
    )?;
    Ok(())
}

/// One feature table being filled: its rows are inserted as they arrive.
struct Table {
    name: String,
    geometry_type_name: &'static str,
    insert: String,
    rows: usize,
    bounds: [f64; 4],
}

impl Table {
    fn create(
        db: &Connection,
        name: String,
        geometry_type_name: &'static str,
        columns: &Columns,
    ) -> Result<Table> {
        let mut sql = format!(
            "CREATE TABLE \"{name}\" (\n  \"id\" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,\n  \"geometry\" GEOMETRY"
        );
        for (column, ty) in columns {
            sql.push_str(&format!(",\n  \"{column}\" {}", ty.sql()));
        }
        sql.push_str("\n)");
        db.execute(&sql, [])?;

        let names: Vec<String> = columns.iter().map(|(c, _)| format!("\"{c}\"")).collect();
        let marks = vec!["?"; columns.len() + 1].join(", ");
        Ok(Table {
            insert: format!(
                "INSERT INTO \"{name}\" (\"geometry\", {}) VALUES ({marks})",
                names.join(", ")
            ),
            name,
            geometry_type_name,
            rows: 0,
            bounds: [
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ],
        })
    }

    fn insert(
        &mut self,
        db: &Connection,
        geometry: &Geometry,
        elevations: Option<&[f64]>,
        values: Vec<Sql>,
    ) -> Result<()> {
        let e = envelope(geometry);
        self.bounds = [
            self.bounds[0].min(e[0]),
            self.bounds[1].min(e[1]),
            self.bounds[2].max(e[2]),
            self.bounds[3].max(e[3]),
        ];
        let mut row = vec![Sql::Blob(blob(geometry, elevations))];
        row.extend(values);
        db.prepare_cached(&self.insert)?
            .execute(params_from_iter(row))?;
        self.rows += 1;
        Ok(())
    }

    /// Registers the table and builds its R-tree index.
    fn finish(&self, db: &Connection) -> Result<()> {
        let n = &self.name;
        db.execute(
            "INSERT INTO gpkg_contents (table_name, data_type, identifier, description, min_x, min_y, max_x, max_y, srs_id) VALUES (?, 'features', ?, '', ?, ?, ?, ?, ?)",
            rusqlite::params![n, n, self.bounds[0], self.bounds[1], self.bounds[2], self.bounds[3], WGS84],
        )?;
        db.execute(
            "INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id, z, m) VALUES (?, 'geometry', ?, ?, 0, 0)",
            rusqlite::params![n, self.geometry_type_name, WGS84],
        )?;
        db.execute(
            "INSERT INTO gpkg_extensions (table_name, column_name, extension_name, definition, scope) VALUES (?, 'geometry', 'gpkg_rtree_index', 'http://www.geopackage.org/spec/#extension_rtree', 'write-only')",
            [n],
        )?;

        let rtree = format!("rtree_{n}_geometry");
        db.execute(&RTREE.replace("{rtree}", &rtree), [])?;
        // The bounds of every row come from the blobs just written, via the same envelope
        // computation, so the index needs no SQL spatial functions to be built.
        let mut read = db.prepare(&format!("SELECT id, geometry FROM \"{n}\""))?;
        let mut rows = read.query([])?;
        let mut insert = db.prepare(&format!(
            "INSERT OR REPLACE INTO \"{rtree}\" VALUES (?, ?, ?, ?, ?)"
        ))?;
        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let geometry: Vec<u8> = row.get(1)?;
            let e = blob_envelope(&geometry);
            insert.execute(rusqlite::params![id, e[0], e[2], e[1], e[3]])?;
        }
        drop(rows);
        for template in TRIGGERS {
            db.execute(
                &template.replace("{rtree}", &rtree).replace("{table}", n),
                [],
            )?;
        }
        Ok(())
    }
}

/// The envelope of a blob this module wrote: the WKB after the 8-byte header, scanned for its
/// coordinate doubles. Only used to build the index, so it need only be correct for this
/// writer's own geometries (little-endian, 2D).
fn blob_envelope(blob: &[u8]) -> [f64; 4] {
    fn u32_at(b: &[u8], at: usize) -> u32 {
        u32::from_le_bytes(b[at..at + 4].try_into().expect("4 bytes"))
    }
    fn f64_at(b: &[u8], at: usize) -> f64 {
        f64::from_le_bytes(b[at..at + 8].try_into().expect("8 bytes"))
    }
    fn walk(b: &[u8], at: &mut usize, e: &mut [f64; 4]) {
        *at += 1; // byte order
        let raw = u32_at(b, *at);
        *at += 4;
        let kind = raw & !WKB_Z;
        // Three doubles a position if the geometry is elevated, else two.
        let stride = if raw & WKB_Z != 0 { 24 } else { 16 };
        let point = |at: &mut usize, e: &mut [f64; 4]| {
            let (x, y) = (f64_at(b, *at), f64_at(b, *at + 8));
            *at += stride;
            *e = [e[0].min(x), e[1].min(y), e[2].max(x), e[3].max(y)];
        };
        match kind {
            1 => point(at, e),
            2 => {
                let n = u32_at(b, *at);
                *at += 4;
                (0..n).for_each(|_| point(at, e));
            }
            3 => {
                let rings = u32_at(b, *at);
                *at += 4;
                for _ in 0..rings {
                    let n = u32_at(b, *at);
                    *at += 4;
                    (0..n).for_each(|_| point(at, e));
                }
            }
            5 | 6 => {
                let parts = u32_at(b, *at);
                *at += 4;
                for _ in 0..parts {
                    walk(b, at, e);
                }
            }
            other => panic!("unexpected WKB type {other}"),
        }
    }
    let mut e = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    let mut at = 8;
    walk(blob, &mut at, &mut e);
    e
}

/// Writes a layer: its features split into one table per geometry type, tables created in
/// order of first appearance.
fn write_layer<P>(
    db: &Connection,
    layer: &str,
    features: &[Feature<P>],
    columns: &Columns,
    values: impl Fn(&P) -> Vec<Sql>,
    centroid_table: bool,
) -> Result<()> {
    let mut tables: Vec<Table> = Vec::new();
    let slot = |db: &Connection, geometry: &Geometry, tables: &mut Vec<Table>| -> Result<usize> {
        let (suffix, type_name) = table_kind(geometry);
        let name = format!("{layer}_{suffix}");
        if let Some(i) = tables.iter().position(|t| t.name == name) {
            return Ok(i);
        }
        tables.push(Table::create(db, name, type_name, columns)?);
        Ok(tables.len() - 1)
    };

    // Ski areas: a point table with the centroid of every one of them comes first.
    if centroid_table {
        for feature in features {
            let center = Geometry::Point(turf::centroid(&[&feature.geometry]));
            let i = slot(db, &center, &mut tables)?;
            tables[i].insert(db, &center, None, values(&feature.properties))?;
        }
    }
    for feature in features {
        if centroid_table && matches!(feature.geometry, Geometry::Point(_)) {
            continue;
        }
        let i = slot(db, &feature.geometry, &mut tables)?;
        tables[i].insert(
            db,
            &feature.geometry,
            feature.elevations.as_deref(),
            values(&feature.properties),
        )?;
    }
    for table in &tables {
        table.finish(db)?;
    }
    Ok(())
}

/// Everything that goes into the GeoPackage.
pub struct Layers<'a> {
    pub ski_areas: &'a [Feature<SkiAreaProperties>],
    pub lifts: &'a [Feature<LiftProperties>],
    pub runs: &'a [Feature<RunProperties>],
    pub spots: &'a [Feature<SpotProperties>],
}

/// Writes the GeoPackage, replacing any existing file at `path`.
pub fn write_geopackage(path: &Path, layers: &Layers<'_>) -> Result<()> {
    if path.exists() {
        std::fs::remove_file(path).with_context(|| format!("removing {}", path.display()))?;
    }
    let db = Connection::open(path).with_context(|| format!("creating {}", path.display()))?;
    db.execute_batch(
        "PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = MEMORY;",
    )?;
    create_metadata(&db)?;

    db.execute_batch("BEGIN")?;
    write_layer(
        &db,
        "ski_areas",
        layers.ski_areas,
        &ski_area_schema(),
        ski_area_values,
        true,
    )?;
    write_layer(
        &db,
        "lifts",
        layers.lifts,
        &lift_schema(),
        lift_values,
        false,
    )?;
    write_layer(&db, "runs", layers.runs, &run_schema(), run_values, false)?;
    write_layer(
        &db,
        "spots",
        layers.spots,
        &spot_schema(),
        spot_values,
        false,
    )?;
    db.execute_batch("COMMIT")?;
    db.execute_batch("VACUUM")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn jsonb_orders_keys_by_length_then_bytes() {
        let text = jsonb_text(
            &json!({"type": "openstreetmap", "id": "way/1", "a": {"zz": 1.0, "b": 2, "ccc": 3}}),
        );
        assert_eq!(
            text,
            r#"{"a":{"b":2,"zz":1,"ccc":3},"id":"way/1","type":"openstreetmap"}"#
        );
    }

    #[test]
    fn blobs_carry_the_gp_header_and_little_endian_wkb() {
        let b = blob(&Geometry::Point([1.0, 2.0]), None);
        assert_eq!(&b[..8], &[b'G', b'P', 0, 0, 0, 0, 0x10, 0xe6]);
        assert_eq!(b[8], 1);
        assert_eq!(&b[9..13], &1u32.to_le_bytes());
        assert_eq!(&b[13..21], &1.0f64.to_le_bytes());
    }

    #[test]
    fn an_elevated_geometry_has_the_z_flag_and_three_doubles_a_position() {
        let line = Geometry::LineString(vec![[1.0, 2.0], [3.0, 4.0]]);
        let b = wkb(&line, Some(&[10.0, 20.0]));
        assert_eq!(&b[1..5], &(2u32 | 0x8000_0000).to_le_bytes());
        assert_eq!(b.len(), 1 + 4 + 4 + 2 * 24);
        assert_eq!(&b[9..17], &1.0f64.to_le_bytes());
        assert_eq!(&b[25..33], &10.0f64.to_le_bytes());
        // Parts of a multi-geometry carry the flag too, and the envelope ignores the heights.
        let multi = Geometry::MultiLineString(vec![
            vec![[0.0, 0.0], [1.0, 1.0]],
            vec![[4.0, 4.0], [5.0, 6.0]],
        ]);
        let e = Some(&[7.0, 8.0, 9.0, 99.0][..]);
        let b = wkb(&multi, e);
        assert_eq!(&b[1..5], &(5u32 | 0x8000_0000).to_le_bytes());
        assert_eq!(&b[10..14], &(2u32 | 0x8000_0000).to_le_bytes());
        assert_eq!(blob_envelope(&blob(&multi, e)), [0.0, 0.0, 5.0, 6.0]);
    }

    #[test]
    fn a_polygon_is_stored_as_a_multipolygon_of_one() {
        let polygon = Geometry::Polygon(vec![vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 0.0]]]);
        let b = wkb(&polygon, None);
        assert_eq!(&b[1..5], &6u32.to_le_bytes());
        assert_eq!(&b[5..9], &1u32.to_le_bytes());
        assert_eq!(&b[10..14], &3u32.to_le_bytes());
    }

    #[test]
    fn the_envelope_of_a_blob_matches_the_geometry() {
        for geometry in [
            Geometry::Point([3.0, 4.0]),
            Geometry::LineString(vec![[0.0, 1.0], [5.0, -2.0]]),
            Geometry::MultiLineString(vec![
                vec![[0.0, 0.0], [1.0, 1.0]],
                vec![[4.0, 4.0], [5.0, 6.0]],
            ]),
            Geometry::Polygon(vec![vec![[0.0, 0.0], [7.0, 0.0], [7.0, 3.0], [0.0, 0.0]]]),
            Geometry::MultiPolygon(vec![
                vec![vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 0.0]]],
                vec![vec![[8.0, 9.0], [9.0, 9.0], [9.0, 10.0], [8.0, 9.0]]],
            ]),
        ] {
            assert_eq!(
                blob_envelope(&blob(&geometry, None)),
                envelope(&geometry),
                "{geometry:?}"
            );
        }
    }
}
