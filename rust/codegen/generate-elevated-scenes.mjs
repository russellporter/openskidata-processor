#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-pipeline/tests/elevated_scenes.json`: the real TypeScript `prepare`
 * run with an elevation server, on a sample of the worlds in `cluster_scenes.json`, recording the
 * GeoJSON, the mapboxgl GeoJSON and the CSV of each. Elevations reach every run, lift and spot
 * coordinate; runs get an elevation profile; viewport hints are recomputed from the elevated
 * geometry; ski area statistics, lift stations and the CSV elevation columns follow.
 *
 * The server is a local Racemap-style endpoint answering with a function of the one-metre geohash
 * cell (`height`); some cells have no data and some make a whole request fail, so the failure
 * paths (a feature left without elevation) are exercised too.
 *
 * Requires PostgreSQL with PostGIS (`pg_ctlcluster 16 main start`) and a build
 * (`npm run build`). Usage: node rust/codegen/generate-elevated-scenes.mjs [--check]
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import geohash from "ngeohash";
import { repoRoot } from "./tooling.mjs";

const clusterPath = join(
  repoRoot,
  "rust/crates/osd-cluster/tests/cluster_scenes.json",
);
const outPath = join(
  repoRoot,
  "rust/crates/osd-pipeline/tests/elevated_scenes.json",
);
const dist = (p) => import(join(repoRoot, "dist", p));
const { convertOSMToGeoJSON } = await dist("io/OSMToGeoJSONConverter.js");
const { default: prepare } = await dist("PrepareGeoJSON.js");
const { getPostgresTestConfig } = await dist("Config.js");
const TestHelpers = await dist("TestHelpers.js");

const SAMPLE = 30;
/** One in this many cells has no data, and one in this many fails the request. */
const NO_DATA_EVERY = 211;
const FAILS_EVERY = 797;

const alphabet = "0123456789bcdefghjkmnpqrstuvwxyz";
const bits = (hash) =>
  [...hash].reduce((n, c) => n * 32 + alphabet.indexOf(c), 0);

/**
 * Whether the server has cells with no data or that fail. The scenes with lift stations run
 * without: when a station snapped onto its lift lands on such a cell, upstream's
 * `LiftStationAssociator` throws, unhandled, and the whole run stops.
 */
let failures = true;

/**
 * The height at a cell centre: `null` for no data, `undefined` for a server failure. Otherwise a
 * gently sloping surface (about 10% grades) with a little noise from the cell, built from
 * additions and multiplications only so that JavaScript and Rust agree exactly. (Heights that
 * jump hundreds of metres between neighbours make the viewport hint's bearing, which is
 * computed in 3D, hopelessly ill-conditioned.)
 */
export function height(h, lat, lng) {
  if (failures && h % FAILS_EVERY === 0) return undefined;
  if (failures && h % NO_DATA_EVERY === 0) return null;
  return (
    1500 +
    12000 * (lat - Math.round(lat)) +
    8000 * (lng - Math.round(lng)) +
    (Math.floor(h / 128) % 10) / 10 +
    (Math.floor(h / 2048) % 7) * 0.013
  );
}

const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const heights = JSON.parse(body).map(([lat, lng]) =>
      height(bits(geohash.encode(lat, lng, 10)), lat, lng),
    );
    if (heights.some((h) => h === undefined)) {
      response.statusCode = 500;
      response.end("{}");
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(heights));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const elevationUrl = `http://127.0.0.1:${server.address().port}/elevation`;

const { scenes } = JSON.parse(readFileSync(clusterPath, "utf8"));
// Lift stations are placed on their lifts and given a position from their elevation, which needs
// scenes that have them; take all of those (they are a minority) and a spread of the rest.
const hasStation = (scene) =>
  scene.expected.spots.some((f) => f.properties.spotType === "lift_station");
const withStations = scenes.filter(hasStation);
const others = scenes.filter((scene) => !hasStation(scene));
const step = others.length / SAMPLE;
const picked = [
  ...Array.from({ length: SAMPLE }, (_, i) => ({
    scene: others[Math.floor(i * step)],
    failures: true,
  })),
  ...withStations.map((scene) => ({ scene, failures: false })),
];

function silenced(fn) {
  const { log, warn, error } = console;
  console.log = console.warn = console.error = () => {};
  return fn().finally(() => Object.assign(console, { log, warn, error }));
}

const results = [];
for (const [n, { scene, failures: serverFails }] of picked.entries()) {
  failures = serverFails;
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
      elevationServer: { type: "racemap", url: elevationUrl, batchSize: 10000 },
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
  const read = (path) => TestHelpers.fileContents(path).features;
  const csv = (name) => readFileSync(join(paths.output.csv, name), "utf8");
  results.push({
    roles,
    failures: serverFails,
    expected: {
      skiAreas: read(paths.output.skiAreas),
      runs: read(paths.output.runs),
      lifts: read(paths.output.lifts),
      spots: read(paths.output.spots),
      mapboxgl: {
        skiAreas: read(paths.output.mapboxGL.skiAreas),
        runs: read(paths.output.mapboxGL.runs),
        lifts: read(paths.output.mapboxGL.lifts),
        spots: read(paths.output.mapboxGL.spots),
      },
      csv: {
        skiAreas: csv("ski_areas.csv"),
        runs: csv("runs.csv"),
        lifts: csv("lifts.csv"),
        spots: csv("spots.csv"),
      },
    },
  });
  process.stderr.write(`\r${n + 1}/${picked.length}`);
}
process.stderr.write("\n");
server.close();

const generated =
  '{"scenes":[\n' +
  results.map((r) => JSON.stringify(r)).join(",\n") +
  "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-elevated-scenes.mjs`,
    );
    process.exit(1);
  }
  console.log("elevated_scenes.json is up to date");
} else {
  writeFileSync(outPath, generated);
  const count = (key) =>
    results.reduce(
      (n, r) =>
        n +
        r.expected[key].filter(
          (f) =>
            JSON.stringify(f.geometry).split("],[")[0].split(",").length >= 3,
        ).length,
      0,
    );
  console.log(
    `Wrote ${results.length} scenes; features with elevation: runs ${count("runs")}, lifts ${count("lifts")}, spots ${count("spots")}`,
  );
}
process.exit(0);
