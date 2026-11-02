#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-cluster/tests/cluster_scenes.json`: randomised multi-resort
 * worlds pushed through the real TypeScript `prepare` -- converter, formatters,
 * normalization, clustering with PostGIS, statistics, augmentation -- with the final
 * `ski_areas`, `runs`, `lifts` and `spots` GeoJSON recorded.
 *
 * A scene is one to three clusters of features placed 300 m to 2 km apart, so that some
 * neighbouring clusters are within the 500 m search radius of each other (and so merge or
 * compete for objects) and some are not. No elevation, geocoding, snow cover or tiles: those
 * need external services and are ported separately.
 *
 * Requires PostgreSQL with PostGIS (`pg_ctlcluster 16 main start`) and a build
 * (`npm run build`). Usage: node rust/codegen/generate-cluster-scenes.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "./tooling.mjs";
import { chance, generate, int, pick, reseed } from "./osm-worlds.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-cluster/tests/cluster_scenes.json",
);
const dist = (p) => import(join(repoRoot, "dist", p));
const { convertOSMToGeoJSON } = await dist("io/OSMToGeoJSONConverter.js");
const { default: prepare } = await dist("PrepareGeoJSON.js");
const { getPostgresTestConfig } = await dist("Config.js");
const TestHelpers = await dist("TestHelpers.js");

reseed(20260901);

/** Cluster origins, in 1e-7 degrees, 300 m to 2 km apart. */
function origins(count) {
  const [ox, oy] = pick([
    [113000000, 472000000],
    [1428000000, 433000000],
    [-1060000000, 396000000],
  ]);
  const result = [[ox, oy]];
  for (let k = 1; k < count; k++) {
    const [px, py] = result[result.length - 1];
    const distance = pick([30000, 50000, 120000, 200000]); // 0.003 .. 0.02 degrees
    const direction = pick([
      [1, 0],
      [0, 1],
      [1, 1],
      [-1, 0],
    ]);
    result.push([px + direction[0] * distance, py + direction[1] * distance]);
  }
  return result;
}

function makeScene() {
  const count = 1 + int(3);
  const roles = {
    runs: [],
    lifts: [],
    skiAreas: [],
    sites: [],
    spots: [],
    skimap: [],
  };
  origins(count).forEach((origin, k) => {
    const part = generate({ wide: false, origin, idBase: (k + 1) * 10000 });
    for (const key of Object.keys(roles)) roles[key].push(...part[key]);
  });
  return roles;
}

function silenced(fn) {
  const { log, warn, error } = console;
  console.log = console.warn = console.error = () => {};
  return fn().finally(() => Object.assign(console, { log, warn, error }));
}

async function record(roles) {
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
  await prepare(paths, {
    elevationServer: null,
    bbox: null,
    geocodingServer: null,
    workingDir: TestHelpers.getTempWorkingDir(),
    osmInputDir: null,
    outputDir: TestHelpers.getTempWorkingDir(),
    snowCover: null,
    tiles: null,
    postgresCache: getPostgresTestConfig(),
  });
  const read = (path) => TestHelpers.fileContents(path).features;
  return {
    skiAreas: read(paths.output.skiAreas),
    runs: read(paths.output.runs),
    lifts: read(paths.output.lifts),
    spots: read(paths.output.spots),
  };
}

const scenes = [];
const scenesWanted = Number(process.env.CLUSTER_SCENES ?? 120);
for (let n = 0; n < scenesWanted; n++) {
  const roles = makeScene();
  const expected = await silenced(() => record(roles));
  scenes.push({ roles, expected });
}

const generated =
  '{"scenes":[\n' + scenes.map((s) => JSON.stringify(s)).join(",\n") + "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-cluster-scenes.mjs`,
    );
    process.exit(1);
  }
  console.log("cluster scenes are up to date");
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  const count = (key) => scenes.reduce((n, s) => n + s.expected[key].length, 0);
  const generatedAreas = scenes.reduce(
    (n, s) =>
      n +
      s.expected.skiAreas.filter(
        (a) =>
          a.properties.sources.length &&
          a.properties.sources.every(() => false),
      ).length,
    0,
  );
  console.log(
    `Wrote ${scenes.length} scenes: ${count("skiAreas")} ski areas, ${count("runs")} runs, ${count("lifts")} lifts, ${count("spots")} spots`,
  );
  void generatedAreas;
}
