#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-pipeline/tests/gpkg_scenes.json`: the GeoPackage the real
 * TypeScript `prepare` writes for a sample of the worlds in `cluster_scenes.json`, dumped
 * to JSON so the Rust writer can be compared with it table by table and row by row.
 *
 * What is dumped, per world:
 *  - the DDL of every table, index, trigger and view (the shadow tables SQLite keeps for an
 *    R-tree are skipped; their content is checked through the R-tree itself);
 *  - every row of the GeoPackage metadata tables and feature tables, in rowid order, BLOBs
 *    as `{"blob": "<hex>"}`, with `gpkg_contents.last_change` left out (it is a clock);
 *  - every R-tree, ordered by id.
 *
 * The worlds are re-run rather than recorded alongside the cluster scenes so that the
 * (large) cluster fixture does not double in size.
 *
 * The real worlds never have places (no geocoding), wikidata ids, references, elevation
 * profiles, elevations or lift-station positions, so the first of them are also fed back
 * through the TypeScript writer as `synthetic` sets: the real output features with those
 * properties, and random boolean values, filled in. The Rust test takes the same features.
 *
 * Requires PostgreSQL with PostGIS (`pg_ctlcluster 16 main start`) and a build
 * (`npm run build`). Usage: node rust/codegen/generate-gpkg-scenes.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { repoRoot } from "./tooling.mjs";
import { chance, int, pick, reseed } from "./osm-worlds.mjs";

const clusterPath = join(
  repoRoot,
  "rust/crates/osd-cluster/tests/cluster_scenes.json",
);
const outPath = join(
  repoRoot,
  "rust/crates/osd-pipeline/tests/gpkg_scenes.json",
);
const dist = (p) => import(join(repoRoot, "dist", p));
const { convertOSMToGeoJSON } = await dist("io/OSMToGeoJSONConverter.js");
const { default: prepare } = await dist("PrepareGeoJSON.js");
const { getPostgresTestConfig } = await dist("Config.js");
const TestHelpers = await dist("TestHelpers.js");

/** How many worlds to sample, spread evenly over the cluster scenes. */
const SAMPLE = 36;

const { convertGeoJSONToGeoPackage } = await dist("io/GeoPackageWriter.js");
const { FeatureType } = await import("openskidata-format");

/** How many of the real worlds are also turned into synthetic ones. */
const SYNTHETIC = 16;

const { scenes } = JSON.parse(readFileSync(clusterPath, "utf8"));
const step = scenes.length / SAMPLE;
const picked = Array.from(
  { length: SAMPLE },
  (_, i) => scenes[Math.floor(i * step)],
);

function silenced(fn) {
  const { log, warn, error } = console;
  console.log = console.warn = console.error = () => {};
  return fn().finally(() => Object.assign(console, { log, warn, error }));
}

const value = (v) =>
  Buffer.isBuffer(v) ? { blob: v.toString("hex") } : v === undefined ? null : v;

function dump(path) {
  const db = new Database(path, { readonly: true });
  const shadow = /_(node|parent|rowid)$/;
  const schema = db
    .prepare(
      "select type, name, sql from sqlite_master where sql is not null and name not like 'sqlite_%' order by name",
    )
    .all()
    .filter((o) => !(o.type === "table" && shadow.test(o.name)));
  const tables = {};
  for (const { name, type, sql } of schema) {
    if (type !== "table") continue;
    const virtual = /^CREATE VIRTUAL TABLE/.test(sql);
    const rows = db
      .prepare(`select * from "${name}" order by ${virtual ? "id" : "rowid"}`)
      .all();
    tables[name] = rows.map((row) =>
      Object.entries(row)
        .filter(([column]) => column !== "last_change")
        .map(([, v]) => value(v)),
    );
  }
  const result = {
    applicationId: db.pragma("application_id", { simple: true }),
    userVersion: db.pragma("user_version", { simple: true }),
    schema: schema.map(({ type, name, sql }) => ({ type, name, sql })),
    tables,
    sequences: db
      .prepare("select name, seq from sqlite_sequence order by name")
      .all(),
  };
  db.close();
  return result;
}

const results = [];
const realOutputs = [];
for (const [n, scene] of picked.entries()) {
  const { roles } = scene;
  const paths = TestHelpers.getFilePaths();
  const convert = (elements) => convertOSMToGeoJSON({ elements }).features;
  TestHelpers.mockInputFiles(
    {
      skiMapSkiAreas: roles.skimap,
      openStreetMapSkiAreas: convert(roles.skiAreas),
      openStreetMapSkiAreaSites: roles.sites,
      lifts: convert(roles.lifts),
      runs: convert(roles.runs),
      spots: convert(roles.spots),
    },
    paths.input,
  );
  await silenced(() =>
    prepare(paths, {
      elevationServer: null,
      bbox: null,
      geocodingServer: null,
      workingDir: TestHelpers.getTempWorkingDir(),
      osmInputDir: null,
      outputDir: TestHelpers.getTempWorkingDir(),
      snowCover: null,
      tiles: null,
      postgresCache: getPostgresTestConfig(),
    }),
  );
  results.push({ roles, expected: dump(paths.output.geoPackage) });
  if (n < SYNTHETIC) {
    const read = (path) => TestHelpers.fileContents(path).features;
    realOutputs.push({
      skiAreas: read(paths.output.skiAreas),
      lifts: read(paths.output.lifts),
      runs: read(paths.output.runs),
      spots: read(paths.output.spots),
    });
  }
  process.stderr.write(`\r${n + 1}/${SAMPLE}`);
}
process.stderr.write("\n");

// ---------------------------------------------------------------------------------------
// Synthetic sets
// ---------------------------------------------------------------------------------------

reseed(20261102);

/** Object keys in PostgreSQL `jsonb` order -- shorter first, then bytewise -- recursively. */
function jsonbOrder(value) {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
        .map((k) => [k, jsonbOrder(value[k])]),
    );
  }
  return value;
}

const maybe = (p, make) => (chance(p) ? make() : null);
const bool = () => pick([true, false, null]);
// Awkward text: separators, quotes, newlines, and characters either side of the surrogate
// range, where UTF-16 and byte order disagree.
const WORDS = [
  "Alpha",
  "alpha",
  "Zeta",
  "Österreich",
  "Å",
  "𝒳 supplementary",
  "ｚ fullwidth",
  "",
  "a;b",
  'say "hi"',
  "line\nbreak",
  "tab\there",
  "日本",
  "Ça",
  "ñ",
];
const num = () =>
  pick([
    () => int(5000),
    () => int(2000000) / 1000 - 500,
    () => 0.1 + 0.2,
    () => -0.5,
    () => 1e21,
    () => 1e-7,
    () => 123456789.123456789,
  ])();

function place() {
  return {
    iso3166_1Alpha2: pick(["AT", "FR", "JP", "US", "XK", ""]),
    iso3166_2: maybe(0.6, () => pick(["AT-7", "FR-ARA", "JP-01", "", "US-CO"])),
    localized: {
      en: {
        country: pick(WORDS),
        region: maybe(0.7, () => pick(WORDS)),
        locality: maybe(0.7, () => pick(WORDS)),
      },
    },
  };
}

function common(properties) {
  properties.places = Array.from({ length: int(4) }, place);
  properties.wikidataID = maybe(0.5, () => `Q${int(100000)}`);
  properties.name = maybe(0.8, () => pick(WORDS));
  properties.websites = Array.from(
    { length: int(3) },
    () => `https://example.org/${int(99)}?a=1&b=${pick(WORDS)}`,
  );
}

/** The same shape moved by `(dx, dy)` degrees. */
function shifted(coordinates, dx, dy) {
  return typeof coordinates[0] === "number"
    ? [coordinates[0] + dx, coordinates[1] + dy]
    : coordinates.map((c) => shifted(c, dx, dy));
}

/** Turns some lines and polygons into their multi-part forms, which no real world yields. */
function multiplied(feature) {
  const { type, coordinates } = feature.geometry;
  if (!chance(0.5)) return;
  if (type === "LineString") {
    feature.geometry = {
      type: "MultiLineString",
      coordinates: [coordinates, shifted(coordinates, 0.001, 0.001)],
    };
  } else if (type === "Polygon") {
    feature.geometry = {
      type: "MultiPolygon",
      coordinates: [coordinates, shifted(coordinates, 0.01, 0.01)],
    };
  }
}

/** Gives some of a feature's embedded ski areas an empty or missing name. */
function renamed(properties) {
  for (const area of properties.skiAreas ?? []) {
    area.properties.name = pick([
      area.properties.name,
      "",
      null,
      "Résort, Nord",
    ]);
  }
}

/** The same shape with a height added to every coordinate. */
function elevated(coordinates) {
  return typeof coordinates[0] === "number"
    ? [coordinates[0], coordinates[1], 500 + int(2500) + int(10) / 10]
    : coordinates.map(elevated);
}

function enrich(outputs) {
  const copy = structuredClone(outputs);
  for (const key of ["skiAreas", "lifts", "runs"]) {
    for (const f of copy[key]) multiplied(f);
  }
  for (const key of ["lifts", "runs", "spots"]) {
    for (const f of copy[key]) renamed(f.properties);
  }
  // Elevated geometries, as the elevation stage produces: a height on every coordinate.
  for (const key of ["lifts", "runs", "spots"]) {
    for (const f of copy[key]) {
      if (chance(0.5))
        f.geometry.coordinates = elevated(f.geometry.coordinates);
    }
  }
  for (const f of copy.skiAreas) {
    common(f.properties);
    const stats = f.properties.statistics;
    if (stats && chance(0.7)) {
      stats.minElevation = num();
      stats.maxElevation = num();
    }
    if (stats) f.properties.statistics = jsonbOrder(stats);
  }
  for (const f of copy.lifts) {
    common(f.properties);
    f.properties.ref = maybe(0.5, () => pick(WORDS));
    f.properties.refFRCAIRN = maybe(0.5, () => pick(WORDS));
    for (const key of ["oneway", "detachable", "bubble", "heating"])
      f.properties[key] = bool();
    f.properties.occupancy = maybe(0.5, num);
    f.properties.access = maybe(0.5, () => "private");
  }
  for (const f of copy.runs) {
    common(f.properties);
    f.properties.ref = maybe(0.5, () => pick(WORDS));
    f.properties.description = maybe(0.5, () => pick(WORDS));
    for (const key of [
      "oneway",
      "lit",
      "gladed",
      "patrolled",
      "snowmaking",
      "snowfarming",
    ])
      f.properties[key] = bool();
    f.properties.elevationProfile = maybe(0.6, () => ({
      heights: Array.from({ length: 1 + int(6) }, num),
      resolution: pick([10, 12.5, 25]),
      targetResolution: 10,
    }));
  }
  for (const f of copy.spots) {
    f.properties.places = Array.from({ length: int(3) }, place);
    // Few real worlds contain lift stations, so turn some crossings into them.
    if (f.properties.spotType === "crossing" && chance(0.5)) {
      delete f.properties.dismount;
      f.properties.spotType = "lift_station";
      f.properties.liftId = `lift-${int(1000)}`;
    }
    if (f.properties.spotType === "lift_station") {
      f.properties.position = maybe(0.8, () => pick(["top", "mid", "bottom"]));
      f.properties.entry = bool();
      f.properties.exit = bool();
      f.properties.name = maybe(0.6, () => pick(WORDS));
    }
  }
  return copy;
}

const synthetic = [];
for (const [n, outputs] of realOutputs.entries()) {
  const features = enrich(outputs);
  const dir = TestHelpers.getTempWorkingDir();
  const gpkg = join(dir, `synthetic-${n}.gpkg`);
  const layers = [
    ["skiAreas", "ski_areas", FeatureType.SkiArea],
    ["lifts", "lifts", FeatureType.Lift],
    ["runs", "runs", FeatureType.Run],
    ["spots", "spots", FeatureType.Spot],
  ];
  for (const [key, layer, type] of layers) {
    const file = join(dir, `synthetic-${n}-${key}.geojson`);
    writeFileSync(
      file,
      JSON.stringify({ type: "FeatureCollection", features: features[key] }),
    );
    await silenced(() => convertGeoJSONToGeoPackage(file, gpkg, layer, type));
  }
  synthetic.push({ features, expected: dump(gpkg) });
}

const generated =
  '{"scenes":[\n' +
  results.map((r) => JSON.stringify(r)).join(",\n") +
  '\n],"synthetic":[\n' +
  synthetic.map((r) => JSON.stringify(r)).join(",\n") +
  "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-gpkg-scenes.mjs`,
    );
    process.exit(1);
  }
  console.log("gpkg_scenes.json is up to date");
} else {
  writeFileSync(outPath, generated);
  const rows = results.reduce(
    (sum, r) =>
      sum +
      Object.entries(r.expected.tables)
        .filter(([name]) => /^(ski_areas|lifts|runs|spots)_/.test(name))
        .reduce((s, [, t]) => s + t.length, 0),
    0,
  );
  console.log(
    `Wrote ${results.length} scenes (${rows} feature rows) and ${synthetic.length} synthetic sets`,
  );
}
