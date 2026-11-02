#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-enrich/tests/elevation_loader_vectors.json` from the real
 * `ElevationProcessor`: what `enhanceGeometry` does to geometries when the elevation server is
 * a local Racemap-style endpoint whose answer is a function of the one-metre geohash cell
 * asked about (`height`).
 *
 * Three batch sizes (10000, 7 and 1) each run all the geometries twice, with a fresh processor
 * the second time but the same cache: the first pass reads the server's doubles, the second
 * reads back what the cache stored, which is a 32-bit float. Some cells have no data and some
 * make the server fail the whole request.
 *
 * Requires PostgreSQL (`pg_ctlcluster 16 main start`) and a build (`npm run build`).
 * Usage: node rust/codegen/generate-elevation-loader-vectors.mjs [--check]
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import geohash from "ngeohash";
import { repoRoot } from "./tooling.mjs";
import { chance, int, pick, reseed } from "./osm-worlds.mjs";

const dist = (p) => import(join(repoRoot, "dist", p));
const { createElevationProcessor } = await dist("transforms/Elevation.js");
const { getPostgresTestConfig } = await dist("Config.js");

const outPath = join(
  repoRoot,
  "rust/crates/osd-enrich/tests/elevation_loader_vectors.json",
);
reseed(20261109);

const alphabet = "0123456789bcdefghjkmnpqrstuvwxyz";
const bits = (hash) =>
  [...hash].reduce((n, c) => n * 32 + alphabet.indexOf(c), 0);

/** The height at a cell: `null` for no data, `undefined` for a server failure. */
function height(h) {
  if (h % 797 === 0) return undefined;
  if (h % 211 === 0) return null;
  let value =
    (h % 3000) -
    400 +
    (Math.floor(h / 128) % 10) / 10 +
    (Math.floor(h / 2048) % 7) * 0.013;
  // A quarter of the cells sit just under a rounding tie, which a 32-bit float (the cache's
  // column type) moves to the tie, so they round differently when read back from the cache.
  if (Math.floor(h / 16384) % 4 === 0) value += 0.0499999;
  return value;
}

const requests = [];
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const coordinates = JSON.parse(body);
    requests.push(coordinates.length);
    const heights = coordinates.map(([lat, lng]) =>
      height(bits(geohash.encode(lat, lng, 10))),
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
const url = `http://127.0.0.1:${server.address().port}/elevation`;

/** A random walk of `n` positions in steps small enough for cells to repeat. */
function walk(n) {
  let x = pick([11.3, 142.8, -106, 0, 6.6]) + int(1000) / 1e4;
  let y = pick([47.2, 43.3, 39.6, 0, 45.3]) + int(1000) / 1e4;
  const step = pick([0, 2e-6, 1e-5, 6e-5, 3e-4]);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push([x, y]);
    x += (int(1000) / 1000 - 0.45) * step;
    y += (int(1000) / 1000 - 0.5) * step;
  }
  return out;
}
const ring = (n) => {
  const line = walk(n);
  return [...line, line[0]];
};

const geometries = [];
for (let i = 0; i < 160; i++) {
  geometries.push(
    pick([
      () => ({ type: "Point", coordinates: walk(1)[0] }),
      () => ({ type: "LineString", coordinates: walk(2 + int(40)) }),
      () => ({ type: "LineString", coordinates: walk(2 + int(120)) }),
      () => ({
        type: "MultiLineString",
        coordinates: [walk(2 + int(10)), walk(2 + int(10))],
      }),
      () => ({ type: "Polygon", coordinates: [ring(4 + int(10)), ring(4)] }),
      () => ({
        type: "MultiPolygon",
        coordinates: [[ring(4 + int(6))], [ring(4 + int(6)), ring(4)]],
      }),
    ])(),
  );
}

function flatten(geometry) {
  switch (geometry.type) {
    case "Point":
      return [geometry.coordinates];
    case "LineString":
      return geometry.coordinates;
    case "MultiLineString":
    case "Polygon":
      return geometry.coordinates.flat();
    case "MultiPolygon":
      return geometry.coordinates.flat(2);
  }
}

const quiet = async (fn) => {
  const { log, warn, error } = console;
  console.log = console.warn = console.error = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, { log, warn, error });
  }
};

const runs = [];
for (const batchSize of [10000, 7, 1]) {
  const postgres = getPostgresTestConfig();
  const passes = [];
  for (const pass of [1, 2]) {
    const requestedBefore = requests.reduce((a, b) => a + b, 0);
    const processor = await quiet(() =>
      createElevationProcessor({ type: "racemap", url, batchSize }, postgres),
    );
    const results = [];
    for (const geometry of geometries) {
      const copy = structuredClone(geometry);
      try {
        await quiet(() => processor.enhanceGeometry(copy));
        results.push({ z: flatten(copy).map((c) => c[2]) });
      } catch (error) {
        results.push({ error: String(error?.message ?? error) });
      }
    }
    await quiet(() => processor.close());
    passes.push({
      results,
      requested: requests.reduce((a, b) => a + b, 0) - requestedBefore,
    });
  }
  runs.push({ batchSize, passes });
}
server.close();

const generated = JSON.stringify({ geometries, runs }) + "\n";
if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-elevation-loader-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("elevation_loader_vectors.json is up to date");
} else {
  writeFileSync(outPath, generated);
  const tally = {};
  for (const run of runs)
    for (const [n, pass] of run.passes.entries()) {
      const key = `batch ${run.batchSize} pass ${n + 1}`;
      tally[key] =
        `${pass.results.filter((r) => r.z).length} ok, ${pass.results.filter((r) => r.error === "No elevation data available").length} no data, ${pass.results.filter((r) => r.error && r.error !== "No elevation data available").length} server failures`;
    }
  console.log(`Wrote ${geometries.length} geometries`, tally);
}
process.exit(0);
