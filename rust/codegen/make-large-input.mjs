#!/usr/bin/env node
/**
 * Writes a large synthetic input for timing both pipelines: `RESORTS` randomly generated ski
 * resorts (the same worlds the oracles use), each on its own patch of a grid ~11 km apart so they
 * do not interact, in the files the Rust `prepare` reads (`input_*.osmjson`,
 * `input_skimap_ski_areas.geojson`).
 *
 * Not part of the test suite. Usage:
 *   node rust/codegen/make-large-input.mjs <resorts> <output dir> [--dense]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generate, reseed } from "./osm-worlds.mjs";

const [resortsArg, outDir, ...flags] = process.argv.slice(2);
const resorts = Number(resortsArg);
if (!(resorts > 0) || !outDir) {
  console.error("usage: make-large-input.mjs <resorts> <output dir> [--dense]");
  process.exit(1);
}
const dense = flags.includes("--dense");
reseed(20261110);
mkdirSync(outDir, { recursive: true });

const roles = {
  runs: [],
  lifts: [],
  skiAreas: [],
  sites: [],
  spots: [],
  skimap: [],
};
const columns = 200;
for (let k = 0; k < resorts; k++) {
  // Origins in units of 1e-7 degrees, 0.1 degree apart.
  const origin = [
    100_000_000 + (k % columns) * 1_000_000,
    300_000_000 + Math.floor(k / columns) * 1_000_000,
  ];
  const part = generate({
    wide: false,
    dense,
    origin,
    idBase: (k + 1) * 10_000,
  });
  for (const key of Object.keys(roles))
    for (const item of part[key]) roles[key].push(item);
}

const write = (name, value) =>
  writeFileSync(join(outDir, name), JSON.stringify(value));
const osm = (elements) => ({
  version: 0.6,
  osm3s: { timestamp_osm_base: "2026-01-01T00:00:00Z" },
  elements,
});
write("input_runs.osmjson", osm(roles.runs));
write("input_lifts.osmjson", osm(roles.lifts));
write("input_ski_areas.osmjson", osm(roles.skiAreas));
write("input_ski_area_sites.osmjson", osm(roles.sites));
write("input_spots.osmjson", osm(roles.spots));
write("input_skimap_ski_areas.geojson", {
  type: "FeatureCollection",
  features: roles.skimap,
});
console.log(
  `${resorts} resorts: ${roles.runs.length} run elements, ${roles.lifts.length} lift elements, ${roles.skiAreas.length} ski area elements, ${roles.sites.length} sites, ${roles.spots.length} spot elements, ${roles.skimap.length} skimap ski areas`,
);
