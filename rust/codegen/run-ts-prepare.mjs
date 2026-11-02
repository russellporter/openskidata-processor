#!/usr/bin/env node
/**
 * Runs the real TypeScript `prepare` on the files `make-large-input.mjs` wrote, for timing. The
 * OSM JSON is converted in memory first (production streams it to disk in the download step), and
 * the two phases are timed separately.
 *
 * Not part of the test suite. Usage: node rust/codegen/run-ts-prepare.mjs <input dir> <output dir>
 */
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./tooling.mjs";

const [inputDir, outputDir] = process.argv.slice(2);
const dist = (p) => import(join(repoRoot, "dist", p));
const { convertOSMToGeoJSON } = await dist("io/OSMToGeoJSONConverter.js");
const { default: prepare } = await dist("PrepareGeoJSON.js");
const { getPostgresTestConfig } = await dist("Config.js");
const TestHelpers = await dist("TestHelpers.js");

const read = (name) => JSON.parse(readFileSync(join(inputDir, name), "utf8"));
const started = Date.now();
const elements = (name) => read(name).elements;
const convert = (name) =>
  convertOSMToGeoJSON({ elements: elements(name) }).features;
const paths = TestHelpers.getFilePaths();
TestHelpers.mockInputFiles(
  {
    skiMapSkiAreas: read("input_skimap_ski_areas.geojson").features,
    openStreetMapSkiAreas: convert("input_ski_areas.osmjson"),
    openStreetMapSkiAreaSites: elements("input_ski_area_sites.osmjson"),
    lifts: convert("input_lifts.osmjson"),
    runs: convert("input_runs.osmjson"),
    spots: convert("input_spots.osmjson"),
  },
  paths.input,
);
const converted = Date.now();
mkdirSync(outputDir, { recursive: true });
const { log, warn } = console;
console.log = console.warn = () => {};
await prepare(paths, {
  elevationServer: null,
  bbox: null,
  geocodingServer: null,
  workingDir: TestHelpers.getTempWorkingDir(),
  osmInputDir: null,
  outputDir,
  snowCover: null,
  tiles: null,
  postgresCache: getPostgresTestConfig(),
});
Object.assign(console, { log, warn });
const finished = Date.now();
console.log(
  `convert ${(converted - started) / 1000}s, prepare ${(finished - converted) / 1000}s`,
);
console.log(`outputs in ${paths.output.skiAreas.replace(/\/[^/]*$/, "")}`);
process.exit(0);
