# Rust rewrite

A Cargo workspace that is replacing the TypeScript pipeline in `../src`, stage by stage.
It lives alongside the TypeScript rather than replacing it in place, so the existing
pipeline stays runnable as the **golden-master oracle** while the port proceeds.

The full plan, including the reasoning behind each design decision, is in the session plan
document. This README is the short version.

## Current state

Thin scaffold. Every crate, module boundary and public type is in place with `todo!()`
bodies, so the shape is reviewable and the real work can proceed crate by crate.

```
cargo check --workspace   # must pass
cargo test --workspace    # 6 real tests pass, the rest are #[ignore]d placeholders
```

The real tests are the wire-contract tests in `openskidata-format` and the activity-mask
tests in `osd-store`. Every `#[ignore]`d test names the upstream snapshot or behaviour it
must eventually satisfy — they are a worklist, not dead weight.

## Crates

| crate                | replaces                                         | notes                                |
| -------------------- | ------------------------------------------------ | ------------------------------------ |
| `openskidata-format` | the npm package of the same name                 | enums **generated**, see below       |
| `osd-store`          | per-feature GeoJSON objects, the `objects` table | coord arena + SoA columns            |
| `osd-osm`            | `io/OSMToGeoJSONConverter.ts`, the Overpass path | reads `.osm.pbf` directly            |
| `osd-tags`           | `transforms/{Run,Lift,SkiArea,Spot}Formatter.ts` | port mechanically                    |
| `osd-normalize`      | `RunNormalizerAccumulator` + `normalization/*`   | partitioned, streamed                |
| `osd-cluster`        | `SkiAreaClusteringService` + the PostGIS layer   | iterative flood fill                 |
| `osd-enrich`         | `Elevation.ts`, `Geocoder.ts`, snow cover        | batched, async                       |
| `osd-cache`          | `utils/PostgresCache.ts`                         | embedded store + migration           |
| `osd-out`            | the exporters and `TilesGenerator.ts`            | still drives tippecanoe              |
| `osd-pipeline`       | `PrepareGeoJSON.ts`                              | one process, one pass                |
| `osd-cli`            | `run.sh` and the npm scripts                     |                                      |
| `osd-golden`         | —                                                | fixture extraction and semantic diff |

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
3. **The 500 m clustering metric is spheroidal.** Substituting a local projection drifts
   ±0.5–1.5 m at 500 m, which can flip edges and change ski-area membership. Measure the
   blast radius first: `osd-cli metric-blast-radius`.

## Local development

Unlike the documented `docker compose` workflow, this container runs everything natively:
Postgres 16 + PostGIS 3.4, GEOS 3.12, tippecanoe 2.78.0 and the npm dependencies are all
installed directly. Start Postgres with `pg_ctlcluster 16 main start`.
