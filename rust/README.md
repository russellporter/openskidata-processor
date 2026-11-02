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
their `mapboxgl_*` counterparts, and the four CSV files.

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

**Not done yet.** The GeoPackage, `metadata.json`, elevation (and the float-heavy
`line_chunk_patched`/ascent/pitch maths behind the elevation CSV columns), geocoding, snow
cover, the Postgres cache migration, downloading from Overpass/Skimap.org, PBF input, and the
streaming driver that bounds normalization memory (`normalize_runs_partitioned` partitions in
memory today). No performance or memory figure has been measured: Overpass is unreachable
from the development container, so there is no large input to measure on.

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
- **Runs with `piste:type=downhill;nordic` count twice in the statistics** if two of their
  uses map to the same activity.
- **A lift's embedded `stations[].skiAreas` is stale upstream** (unresolved site ski areas
  with placeholder coordinates). Not reproduced: this pipeline resolves them the way
  `spots.geojson` does. The one deliberate divergence from the TypeScript output.

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
