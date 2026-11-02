# Rust rewrite

A Cargo workspace that is replacing the TypeScript pipeline in `../src`, stage by stage.
It lives alongside the TypeScript rather than replacing it in place, so the existing
pipeline stays runnable as the **golden-master oracle** while the port proceeds.

The full plan, including the reasoning behind each design decision, is in the session plan
document. This README is the short version.

## Current state

`openskidata prepare` works: given the downloaded input files (`input_*.osmjson` and
`input_skimap_ski_areas.geojson`), it reproduces what the TypeScript pipeline writes with
elevation, geocoding and snow cover switched off -- `ski_areas|runs|lifts|spots.geojson`,
their `mapboxgl_*` counterparts, the four CSV files, `openskidata.gpkg` and `metadata.json`.

```bash
cargo build --release -p osd-cli
target/release/openskidata prepare --input-dir data/input --output-dir data/output
```

**How it is known to be right.** Every stage was checked against the real TypeScript, never
against expectations written by the same hand as the port. A generator in `rust/codegen/`
runs the real code on randomised inputs and records its output; a Rust test reproduces it.
The pieces and what they were checked on:

| stage                                   | checked against                                                             |
| --------------------------------------- | --------------------------------------------------------------------------- |
| format enums, colours, lift names       | the npm package: 119 vectors, 3,000+ lift-name cases                        |
| tag derivations, run/lift/ski area/spot | 244 lift, 379 run, 85 ski area, 53 spot cases, full output objects          |
| OSM to geometry (the converter)         | 20 scenes, 84 features                                                      |
| geometry validity (`booleanValid`)      | 3,014 degenerate-heavy cases, including turf's sweep-line quirks            |
| topology, merge and join of runs        | 606 topology scenes, 800 merges, 700 end-to-end scenes (3,036 runs)         |
| feature ids (`object-hash`)             | 601 geometries, 1,526 number formats -- ids are byte-identical              |
| viewport hints                          | 709 cases at 1e-9                                                           |
| the format stage                        | 500 worlds (1,140 ski areas, 1,254 runs, 424 lifts, 756 spots)              |
| clustering, statistics, the exports     | 188 worlds: final GeoJSON, mapboxgl GeoJSON and CSV text, plus the file I/O |
| the GeoPackage                          | 36 worlds dumped table by table (DDL, rows, R-tree) + 16 synthetic sets     |

Each check was then **mutation tested**: deliberately break the port, confirm the test
fails, and add inputs until it does. That found real gaps every time (areas straddling a
convention boundary, closed-way lifts, station ties, places, long names) and a handful of
upstream behaviours worth knowing -- see "Behaviours reproduced" below. Equivalent mutants
are documented where they were found, not forced.

```bash
cargo test --workspace                      # ~255 tests
cargo clippy --workspace --all-targets      # clean
node rust/codegen/generate-*.mjs --check    # every generated file up to date (CI)
```

The clustering oracle (`osd-cluster/tests/cluster_scenes.json`) needs PostgreSQL to
regenerate and takes about eight minutes, so CI does not re-check it; the Rust tests that
read it do run in CI.

The GeoPackage oracle (`osd-pipeline/tests/gpkg_scenes.json`) re-runs the real `prepare` on a
sample of the cluster worlds and dumps the `.gpkg` it writes; because those worlds never carry
places, wikidata ids, references, elevation profiles or lift-station positions, 16 further
sets feed the real writer real output features with those properties and random booleans
filled in. The Rust writer is compared on every table's DDL, every row and every R-tree.

**Not done yet.** Applying elevation: the maths is ported (`openskidata-format::elevation_profile`)
and feeds a run's CSV columns and `metadata.json`, but heights are not fetched, and the pipeline's
geometry is 2D, so lifts' elevation columns, ski-area elevations and lift-station positions wait
for geometry that carries elevations. Also geocoding, snow cover, downloading from
Overpass/Skimap.org, PBF input, and the streaming driver that bounds normalization memory
(`normalize_runs_partitioned` partitions in memory today). The Postgres caches migrate with
`openskidata migrate-cache`. No performance or memory figure has been measured: Overpass is
unreachable from the development container, so there is no large input to measure on.

## Behaviours reproduced

Things the TypeScript does that a clean reimplementation would not, kept because the output
depends on them. Each is pinned by a test and explained where it lives.

- **Feature ids depend on JavaScript object identity.** `object-hash` writes a back-reference
  for an object it has already seen, and `topojson-client` returns the arc's own coordinate
  arrays, so a polygon run whose ring was rotated, or that walks an arc twice, hashes
  differently from the same polygon built another way. `osd_store::feature_id`.
- **`booleanValid` uses a sweep line that retires the wrong segment.** Its heap pops the
  segment with the smallest right endpoint, not the one that ended, so it finds different
  intersections from a textbook sweep. `osd_osm::validity`.
- **An empty CSV stream writes an empty file**, header included.
- **`toFixed` rounds ties up, not to even**, and ties are real: `11.0078125` is a valid
  coordinate.
- **A run's activities are a list, not a set.** A run whose uses map to the same activity
  (`downhill` and `snow_park`) lists it twice and is counted twice in a ski area's
  statistics. Kept by construction in `osd_cluster::engine`; no recorded case covers it, so
  this one rests on reading the TypeScript rather than on a test.
- **A lift's embedded `stations[].skiAreas` is stale upstream** (unresolved site ski areas
  with placeholder coordinates). Not reproduced: this pipeline resolves them the way
  `spots.geojson` does. A deliberate divergence from the TypeScript output.
- **Every boolean cell of an upstream GeoPackage is `0`.** `@ngageoint/geopackage` stores a
  BOOLEAN as `value === true ? 1 : 0`, and the writer hands it the numbers `1`/`0`, so `lit`,
  `oneway`, `bubble` and the rest are `0` whatever the feature says, and unknown is `0`, not
  `NULL`. Not reproduced: this writes the intended `1`/`0`/`NULL`, and the test checks them
  against the GeoJSON properties instead of against upstream's file. The other GeoPackage
  differences: `gpkg_contents` carries the true bounding box (upstream's has latitude and
  longitude crossed, from the first 1,000 features only), the `gpkg_schema` extension rows for
  tables that do not exist are left out, and R-tree boxes are as tight as the bundled SQLite
  makes them (upstream's, from an older SQLite, are an f32 ulp or two wider).
- **`metadata.json`'s length totals need elevation.** `runLengthKm` and `liftLengthKm` sum the
  inclined length elevation produces; the collector takes it as an input (the oracle feeds it the
  real `getRunElevationData` results). `prepare` passes each run's from its elevation profile; the
  lift total stays `0` until the pipeline's geometry can carry elevations.
- **`sortPlaces` can depend on V8's sort.** Two names that are canonically equivalent but not the
  same string (`Zürich` composed and decomposed) make `localeCompare` return `0`, and `sortPlaces`
  stops there instead of comparing the next field, so its comparison is not transitive and the
  result depends on the algorithm. Under 64 places this reproduces V8's (run detection and binary
  insertion); from 64 it is a stable sort, identical whenever the comparison is consistent, as it
  is for any real geocoder output.
- **A run whose elevation profile does not fit its line** makes upstream's CSV export throw; here it
  is logged and the run's elevation columns are left empty.

## The generated enums

`openskidata-format`'s 13 enums carry the **wire contract**: their string values land in
GeoJSON properties, CSV cells, GeoPackage `TEXT` columns and MVT attributes, and
openskimap.org reads them. They are generated from the installed npm package rather than
hand-typed, because a single typo'd string literal would be a silent data corruption that
no type system catches:

```bash
node rust/codegen/generate-format-enums.mjs           # regenerate (checked in)
node rust/codegen/generate-format-enums.mjs --check    # CI: fail if stale
```

Re-run after every `openskidata-format` bump.

## Three things not to undo

These are conclusions from auditing the TypeScript, and each is easy to "simplify" back
into a bug. They are documented at length in the relevant crate's module docs.

1. **Clustering is not a connected-components problem.** The edge predicate is
   path-dependent — the activity set narrows along each traversal path — so union-find
   produces different, wrong answers. `osd-cluster`'s docs carry the counterexample, and
   `nordic_only_neighbour_is_excluded_behind_a_downhill_narrowing` pins it.
2. **Run normalization must stay 2D, and must run before elevation.** TopoJSON's `dedup`
   compares only x and y, so coalescing arcs after elevations are attached would silently
   merge arcs differing only in z.
3. **The 500 m clustering metric is spheroidal.** PostGIS measures geography on the WGS84
   ellipsoid; a spherical approximation is off by up to 0.4% at mid latitudes (2 m at
   500 m), enough to flip an edge. `osd_cluster::spatial` measures on a local tangent plane
   built from the ellipsoid's own radii of curvature, which is accurate to well under a
   millimetre at these ranges. Do not swap in a haversine.

## Local development

Unlike the documented `docker compose` workflow, this container runs everything natively:
Postgres 16 + PostGIS 3.4, GEOS 3.12, tippecanoe 2.78.0 and the npm dependencies are all
installed directly. Start Postgres with `pg_ctlcluster 16 main start`.
