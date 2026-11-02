#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-cache/tests/geohash_vectors.json` from the real `ngeohash`: the
 * cache keys upstream derives from coordinates (`encode`) and the coordinates it asks the
 * elevation server about for a cell (`decode`).
 *
 * The coordinates are uniform over the world, then clustered on the places an implementation
 * gets wrong: the bisection midpoints (where `>` against `>=` matters), the four edges of the
 * world, zero, and a few ulps either side of each.
 *
 * Usage: node rust/codegen/generate-geohash-vectors.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import geohash from "ngeohash";
import { repoRoot } from "./tooling.mjs";
import { int, pick, reseed } from "./osm-worlds.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-cache/tests/geohash_vectors.json",
);
reseed(20261105);

const uniform = () => int(1 << 30) / (1 << 30);
const nextUp = (x) => {
  const buffer = new DataView(new ArrayBuffer(8));
  buffer.setFloat64(0, x);
  let bits = buffer.getBigInt64(0);
  bits += x >= 0 ? 1n : -1n;
  buffer.setBigInt64(0, bits);
  return buffer.getFloat64(0);
};
const nextDown = (x) => -nextUp(-x);

/** The midpoint a bisection at some depth compares against. */
function midpoint(low, high, depth) {
  let lo = low;
  let hi = high;
  let mid = (lo + hi) / 2;
  for (let i = 0; i < depth; i++) {
    mid = (lo + hi) / 2;
    if (pick([true, false])) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const points = [];
for (let i = 0; i < 1500; i++) {
  points.push([uniform() * 180 - 90, uniform() * 360 - 180]);
}
for (const lat of [-90, 90, 0, -0, 45, -45, 89.9999999, -89.9999999]) {
  for (const lng of [-180, 180, 0, -0, 90, -90, 179.9999999, -179.9999999]) {
    points.push([lat, lng]);
  }
}
for (let i = 0; i < 700; i++) {
  const lat = midpoint(-90, 90, int(24));
  const lng = midpoint(-180, 180, int(24));
  for (const [a, b] of [
    [lat, lng],
    [nextUp(lat), lng],
    [nextDown(lat), lng],
    [lat, nextUp(lng)],
    [lat, nextDown(lng)],
  ]) {
    points.push([a, b]);
  }
}

const cases = [];
for (const [lat, lng] of points) {
  const chars = pick([1, 2, 3, 5, 6, 6, 6, 8, 10, 10, 10, 10, 12]);
  const hash = geohash.encode(lat, lng, chars);
  const { latitude, longitude } = geohash.decode(hash);
  cases.push({ lat, lng, chars, hash, decoded: [latitude, longitude] });
}

const generated =
  '{"cases":[\n' + cases.map((c) => JSON.stringify(c)).join(",\n") + "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-geohash-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("geohash_vectors.json is up to date");
} else {
  writeFileSync(outPath, generated);
  console.log(`Wrote ${cases.length} cases`);
}
