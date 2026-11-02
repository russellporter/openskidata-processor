#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-enrich/tests/viirs_vectors.json`: the VIIRS pixels the real
 * `VIIRSPixelExtractor.getGeometryPixelCoordinates` gives random geometries -- lines, polygons
 * with holes, multi-geometries, tiny ones, and ones whose vertices are placed on pixel
 * boundaries -- around the world, including near the poles and the antimeridian.
 *
 * Usage: node rust/codegen/generate-viirs-vectors.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./tooling.mjs";
import { chance, int, pick, reseed } from "./osm-worlds.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-enrich/tests/viirs_vectors.json",
);
const { VIIRSPixelExtractor } = await import(
  join(repoRoot, "dist/utils/VIIRSPixelExtractor.js")
);
const extractor = new VIIRSPixelExtractor();
reseed(20261107);

const R = 6371007.181;
const PIXEL = 375;

function location() {
  const lat = chance(0.1)
    ? pick([-84, -60, 60, 84, 89]) + int(100) / 100
    : int(14000) / 100 - 70;
  const lon = chance(0.1)
    ? pick([179.99, -179.99, 0, 10, -10, 120.5]) + int(100) / 10000
    : int(36000) / 100 - 180;
  return [lon, lat];
}

/** `meters` east and north of a position (roughly: good enough to scatter vertices). */
function offset([lon, lat], east, north) {
  const dLat = (north / R) * (180 / Math.PI);
  const dLon = (east / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return [lon + dLon, Math.max(-89.9, Math.min(89.9, lat + dLat))];
}

function walk(start, steps, step) {
  const points = [start];
  let bearing = int(360);
  for (let i = 0; i < steps; i++) {
    bearing += int(61) - 30;
    const length = 5 + int(step);
    const last = points[points.length - 1];
    points.push(
      offset(
        last,
        length * Math.sin((bearing * Math.PI) / 180),
        length * Math.cos((bearing * Math.PI) / 180),
      ),
    );
  }
  return points;
}

function blob(centre, radius) {
  const n = 5 + int(8);
  const points = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * 2 * Math.PI;
    const r = radius * (0.5 + int(100) / 200);
    points.push(offset(centre, r * Math.cos(angle), r * Math.sin(angle)));
  }
  points.push(points[0]);
  return points;
}

/** A position that lies on a pixel corner of the sinusoidal grid (to within rounding). */
function onGrid(near) {
  const x =
    Math.round(
      (R * ((near[0] * Math.PI) / 180) * Math.cos((near[1] * Math.PI) / 180)) /
        PIXEL,
    ) * PIXEL;
  const y = Math.round((R * ((near[1] * Math.PI) / 180)) / PIXEL) * PIXEL;
  const lat = ((y / R) * 180) / Math.PI;
  const lon = ((x / (R * Math.cos((lat * Math.PI) / 180))) * 180) / Math.PI;
  return [lon, lat];
}

const cases = [];
function add(geometry) {
  cases.push({
    geometry,
    pixels: extractor.getGeometryPixelCoordinates(geometry),
  });
}

for (let i = 0; i < 700; i++) {
  const start = location();
  switch (int(8)) {
    case 0:
    case 1:
      add({ type: "LineString", coordinates: walk(start, 2 + int(12), 400) });
      break;
    case 2:
      add({ type: "LineString", coordinates: walk(start, 20 + int(60), 150) });
      break;
    case 3:
      add({ type: "Polygon", coordinates: [blob(start, 30 + int(1500))] });
      break;
    case 4: {
      const radius = 400 + int(2000);
      add({
        type: "Polygon",
        coordinates: [blob(start, radius), blob(start, radius / 4).reverse()],
      });
      break;
    }
    case 5:
      add({
        type: "MultiPolygon",
        coordinates: [
          [blob(start, 100 + int(500))],
          [blob(offset(start, 2000, 500), 100 + int(500))],
        ],
      });
      break;
    case 6:
      add({
        type: "MultiLineString",
        coordinates: [
          walk(start, 4, 300),
          walk(offset(start, 1500, -800), 4, 300),
        ],
      });
      break;
    default: {
      // On the grid: vertices at pixel corners, so everything touches.
      const a = onGrid(start);
      const b = onGrid(offset(a, PIXEL * (1 + int(4)), PIXEL * (int(5) - 2)));
      const c = onGrid(offset(a, PIXEL * (int(5) - 2), PIXEL * (1 + int(4))));
      add(
        chance(0.5)
          ? {
              type: "LineString",
              coordinates: [a, b, ...(chance(0.5) ? [c] : [])],
            }
          : { type: "Polygon", coordinates: [[a, b, c, a]] },
      );
    }
  }
}
// Tiny: smaller than a pixel, or a zero-length line (the centroid fallback).
for (let i = 0; i < 40; i++) {
  const p = location();
  add(
    chance(0.5)
      ? { type: "LineString", coordinates: [p, offset(p, int(3), int(3))] }
      : { type: "Polygon", coordinates: [blob(p, 1 + int(40))] },
  );
}

const generated =
  '{"cases":[\n' + cases.map((c) => JSON.stringify(c)).join(",\n") + "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-viirs-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("viirs_vectors.json is up to date");
} else {
  writeFileSync(outPath, generated);
  const total = cases.reduce((a, c) => a + c.pixels.length, 0);
  console.log(`Wrote ${cases.length} cases, ${total} pixels`);
}
