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

**Download.** `openskidata download` fetches the five Overpass queries and Skimap.org
(`osd-pipeline/src/download.rs`); `openskidata run` is download then prepare, `--skip-download`
to prepare only. The query texts, the bounding-box filter on Skimap.org, the provenance file and
`encodeURIComponent` are compared with the TypeScript builders
(`codegen/generate-download-vectors.mjs`); retries, concurrency (the runs query beside the others,
one Overpass endpoint never asked twice at once) and `OSM_INPUT_DIR` are tested against stub
servers. The commands read the same environment variables as upstream (`WORKING_DIR`,
`OUTPUT_DIR`, `BBOX`, `OSM_INPUT_DIR`, ...). The download has never been run against the real
Overpass: it is unreachable from the development container.

**Terrain tiles.** `ELEVATION_SERVER_TYPE=tile` reads heights from Mapbox Terrain-RGB or Terrarium
tiles (`osd-enrich/src/terrain.rs`), alongside the Racemap and tileserver-gl servers. The Web Mercator
maths, both encodings, the interpolation, what sharp decodes lossless and lossy WebP and PNG tiles to
(libwebp itself, so lossy tiles match to the byte), and whole runs against a local tile server are
compared with the TypeScript (`codegen/generate-tile-vectors.mjs`): the heights, every URL
requested in order, and the cache directory left behind (tile files, `cache-index.json`,
`missing-tiles.json`) across a close and reopen. An existing upstream tile cache is reused as it
stands. The cache is read and written in tile order around each concurrent batch, so its LRU order
is deterministic at any concurrency; tiles with an alpha channel are decoded as RGB where upstream
misreads them.

**Tiles.** `GENERATE_TILES=1` (or `--generate-tiles`) builds `openskimap.mbtiles` with tippecanoe,
as upstream does (the four layers in the working directory, at most `TILE_CONCURRENCY` at once,
then `tile-join`). On 500 resorts the Rust and TypeScript pipelines' tile sets decode to
identical tiles: 3,491 tiles, 32,242 features, no differences (compared with a real MVT decoder;
the bytes differ because the mapboxgl GeoJSON lists properties in a different key order).

**Snow cover (reading the archive).** `ENABLE_SNOW_COVER=1` adds each run's `snowCoverHistory` and
each ski area's `statistics.snowCover` (overall and per activity) from the weekly VIIRS data in the
cache store, whose `snow_cover` entries `openskidata migrate-cache` carries across from Postgres.
Compared with the TypeScript: turf's `booleanIntersects` (including the sweepline and
point-in-polygon it is built on, 17,000 cases on random and grid-aligned inputs), the VIIRS
pixels covered by 740 random geometries (10,862 pixels, identical), the history maths (600 week
conversions, 406 archives) and the whole of `prepare` on 24 resorts over a seeded archive.
The comparison found one thing worth knowing: date-fns's `subDays` is `setDate(getDate() - n)`,
which truncates the sum, so a fractional cloud persistence rounds the other way from truncating it
first. A pixel is tested only against the segments that reach it (upstream tests every segment
for every pixel in the geometry's bounding box), which cannot change the answer.
Fetching new data is the Python in `snow-cover/`, repaired: it imported two modules that do not
exist (`sqlite_cache`, `cache_manager`), and wrote to a file the processor did not read. It now
writes the processor's own cache file (`snow-cover/src/sqlite_cache.py` shares the table
definitions in `osd-cache`, and a test runs it against the Rust reader), takes the pixels to fetch
from the processor (`--pixels-json`, the same extraction that later reads them back; upstream's
Python extracted them itself with shapely and could disagree at the margins), can list the pixels
it already holds for `--fill-cache`, and its tests run in CI. `SNOW_COVER_FETCH_POLICY` is `full`
(fetch the runs' pixels), `incremental` (fill the weeks missing for pixels already held) or
`none`. The download from NASA itself has not been run: it needs Earthdata credentials.

**Not done yet.** PBF input, and the streaming driver that bounds normalization memory
(`normalize_runs_partitioned` partitions in memory today). The Postgres caches migrate with
`openskidata migrate-cache`.

### Performance

Overpass is unreachable from the development container, so the inputs are synthetic:
`codegen/make-large-input.mjs <resorts> <dir>` tiles recorded resort worlds across the globe
(`codegen/run-ts-prepare.mjs` runs the TypeScript `prepare` on the same input). Measured on 4 cores
and 16 GB, `prepare` only (no elevation, geocoding or tiles), TypeScript with Postgres running beside
it:

| Resorts | Ski areas / runs / lifts / spots | TypeScript (node only) | Rust          |
| ------: | -------------------------------- | ---------------------- | ------------- |
|     500 |                                  | 16 s, 138 MB           | 0.3 s, 20 MB  |
|   2,000 |                                  | 80 s, 177 MB           | 1.0 s, 53 MB  |
|   5,000 | 9,539 / 12,871 / 4,250 / 4,915   | 199 s, 208 MB          | 2.4 s, 131 MB |
|  20,000 |                                  | not run                | 11 s, 0.5 GB  |
|  50,000 |                                  | not run                | 45 s, 1.2 GB  |

The Rust and TypeScript outputs are identical feature by feature at 500, 2,000 and 5,000 resorts.
Time and memory are roughly linear; the first Rust version was not (77 s at 5,000), because the
engine rescanned all objects to find a ski area's members, to find nearby ski areas, and to pick the
next run to generate a ski area from. Those are now a membership index, a ski-area R-tree kept in
step with geometry changes, and a cursor over the candidates. The TypeScript figure excludes the
Postgres server's own memory. Memory is dominated by the whole dataset being held in memory
(about 24 KB per resort); the streaming normalization driver is the remaining lever.

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
- **A snapped lift station on a cell with no elevation stops upstream.** `LiftStationAssociator`
  elevates a station again after snapping it onto its lift, and an error there (a cell with no data)
  is not caught, so the whole run stops. Here it is logged and the station is left without an
  elevation.
- **A failing geocoding cell fails only itself.** Upstream's `DataLoader` batches every cell
  geocoded in the same tick and rejects the whole batch when one fails, so one bad cell loses the
  places of every object in it, and each is asked again by the next object to want it. Here a failed
  cell fails the objects that touch it and is remembered, not asked again.
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
