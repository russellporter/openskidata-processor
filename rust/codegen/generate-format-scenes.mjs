#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-pipeline/tests/format_scenes.json`: randomised OSM worlds
 * pushed through the real TypeScript front half of `PrepareGeoJSON.prepare` -- the OSM
 * converter, `formatSkiArea`/`formatRun`/`formatLift`/`formatSpots`, the ski-area site
 * provider, and run normalization -- with the intermediate output recorded.
 *
 * Production feeds five separate Overpass extracts (runs, lifts, ski areas, ski-area sites,
 * spots) through the converter independently, so a scene holds one element list per role.
 * Each extract only contains what its query would return: the roles' own ways, their nodes,
 * and for relations their members.
 *
 * Embedded `skiAreas` of runs, lifts and spots (the site ski areas, full features) are
 * recorded as their ids only; the Rust side holds them as references, and they are replaced
 * during clustering anyway.
 *
 * Build first (`npm run build`). Usage: node rust/codegen/generate-format-scenes.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "./tooling.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-pipeline/tests/format_scenes.json",
);
const dist = (p) => import(join(repoRoot, "dist", p));
const { convertOSMToGeoJSON } = await dist("io/OSMToGeoJSONConverter.js");
const { formatRun } = await dist("transforms/RunFormatter.js");
const { formatLift } = await dist("transforms/LiftFormatter.js");
const { formatSpots } = await dist("transforms/SpotFormatter.js");
const { formatSkiArea, InputSkiAreaType } = await dist(
  "transforms/SkiAreaFormatter.js",
);
const { SkiAreaSiteProvider, addSkiAreaSites } = await dist(
  "transforms/SkiAreaSiteProvider.js",
);
const { RunNormalizerAccumulator } = await dist(
  "transforms/accumulator/RunNormalizerAccumulator.js",
);

import { generate, reseed } from "./osm-worlds.mjs";

reseed(1234567);

// --- the TypeScript front half ---------------------------------------------------------

import { writeFileSync as writeTmp, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

function withoutSiteFeatures(feature) {
  const properties = { ...feature.properties };
  properties.siteSkiAreaIds = properties.skiAreas.map((s) => s.properties.id);
  delete properties.skiAreas;
  return { geometry: feature.geometry, properties };
}

function frontHalf(roles) {
  const dir = mkdtempSync(join(tmpdir(), "format-scene-"));
  const sitesPath = join(dir, "sites.json");
  writeTmp(sitesPath, JSON.stringify({ elements: roles.sites }));
  const siteProvider = new SkiAreaSiteProvider();
  siteProvider.loadSites(sitesPath);

  const convert = (elements) => convertOSMToGeoJSON({ elements }).features;

  const skiAreas = [
    ...convert(roles.skiAreas).flatMap(
      (f) => formatSkiArea(InputSkiAreaType.OPENSTREETMAP_LANDUSE)(f) ?? [],
    ),
    ...siteProvider.getGeoJSONSites(),
    ...roles.skimap.flatMap(
      (f) =>
        formatSkiArea(InputSkiAreaType.SKIMAP_ORG)(structuredClone(f)) ?? [],
    ),
  ];

  const tag = addSkiAreaSites(siteProvider);
  const accumulator = new RunNormalizerAccumulator();
  for (const feature of convert(roles.runs)) {
    for (const run of formatRun(feature)) accumulator.accumulate(tag(run));
  }
  const runs = accumulator.results();

  const lifts = convert(roles.lifts)
    .flatMap((f) => formatLift(f) ?? [])
    .map(tag);
  const spots = convert(roles.spots)
    .flatMap((f) => formatSpots(f))
    .map(tag);

  return {
    skiAreas: skiAreas.map((f) => ({
      geometry: f.geometry,
      properties: f.properties,
    })),
    runs: runs.map(withoutSiteFeatures),
    lifts: lifts.map(withoutSiteFeatures),
    spots: spots.map(withoutSiteFeatures),
  };
}

const scenes = [];
const silence = console.warn;
const silenceLog = console.log;
console.warn = () => {};
console.log = () => {};
for (let n = 0; n < 500; n++) {
  const roles = generate();
  let expected;
  try {
    expected = frontHalf(roles);
  } catch (error) {
    expected = { error: String(error?.stack ?? error) };
  }
  scenes.push({ roles, expected });
}
console.warn = silence;
console.log = silenceLog;

const errors = scenes.filter((s) => s.expected.error);
if (errors.length > 0) {
  console.error(
    `${errors.length} scenes threw; first: ${errors[0].expected.error}`,
  );
  process.exit(1);
}

const generated =
  '{"scenes":[\n' + scenes.map((s) => JSON.stringify(s)).join(",\n") + "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-format-scenes.mjs`,
    );
    process.exit(1);
  }
  console.log("format scenes are up to date");
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  const count = (key) => scenes.reduce((n, s) => n + s.expected[key].length, 0);
  console.log(
    `Wrote ${scenes.length} scenes: ${count("skiAreas")} ski areas, ${count("runs")} runs, ${count("lifts")} lifts, ${count("spots")} spots`,
  );
}
