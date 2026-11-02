#!/usr/bin/env node
/**
 * Generates `rust/crates/openskidata-format/tests/viewport_vectors.json` by calling the
 * real `computeViewportHint` on randomised geometries of every type, with and without
 * elevation.
 *
 * Compared with a tolerance on the Rust side: `sin`, `cos` and `atan2` are not bit-identical
 * between V8 and the platform libm.
 *
 * Usage: node rust/codegen/generate-viewport-vectors.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "./tooling.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/openskidata-format/tests/viewport_vectors.json",
);
const { computeViewportHint } = await import("openskidata-format");

let seed = 55555;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const int = (n) => Math.floor(random() * n);
const pick = (items) => items[int(items.length)];

// Regions spread over the globe, including both sides of the antimeridian and the poles'
// neighbourhood, where the cosine of latitude and the bearing maths change character.
const origins = [
  [11.3, 47.2],
  [6.6, 45.3],
  [-106.0, 39.6],
  [170.1, -44.6],
  [-70.3, -33.4],
  [179.99, 10.0],
  [-179.99, 10.0],
  [0.0, 0.0],
  [25.0, 78.0],
  [142.8, 43.3],
];

const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;

function positions(origin, count, withElevation, spreadDegrees) {
  const out = [];
  let [lng, lat] = origin;
  let elev = 800 + int(2000);
  for (let i = 0; i < count; i++) {
    lng += (random() - 0.5) * spreadDegrees;
    lat += (random() - 0.5) * spreadDegrees;
    elev += (random() - 0.55) * 60;
    const p = [round(lng, 7), round(lat, 7)];
    if (withElevation && random() > 0.05) p.push(round(elev, 1));
    out.push(p);
  }
  return out;
}

function geometry(origin) {
  const withElevation = random() < 0.7;
  const spread = pick([0.0005, 0.005, 0.05]);
  const kind = int(7);
  const n = 2 + int(8);
  switch (kind) {
    case 0:
      return {
        type: "Point",
        coordinates: positions(origin, 1, withElevation, spread)[0],
      };
    case 1:
      return {
        type: "MultiPoint",
        coordinates: positions(origin, n, withElevation, spread),
      };
    case 2:
      return {
        type: "LineString",
        coordinates: positions(origin, n, withElevation, spread),
      };
    case 3:
      return {
        type: "MultiLineString",
        coordinates: [
          positions(origin, n, withElevation, spread),
          positions(origin, n, withElevation, spread),
        ],
      };
    case 4: {
      const ring = positions(origin, Math.max(n, 4), withElevation, spread);
      return { type: "Polygon", coordinates: [[...ring, ring[0]]] };
    }
    case 5: {
      const a = positions(origin, 4, withElevation, spread);
      const b = positions(origin, 4, withElevation, spread);
      return {
        type: "MultiPolygon",
        coordinates: [[[...a, a[0]]], [[...b, b[0]]]],
      };
    }
    default:
      return {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Point",
            coordinates: positions(origin, 1, withElevation, spread)[0],
          },
          {
            type: "LineString",
            coordinates: positions(origin, n, withElevation, spread),
          },
        ],
      };
  }
}

const cases = [];
// Hand-built cases on the exact branch points.
const exact = [
  // flat
  [
    {
      type: "LineString",
      coordinates: [
        [11, 47, 100],
        [11.01, 47, 100],
      ],
    },
  ],
  // an out-and-back with equal lengths: bearings cancel only approximately
  [
    {
      type: "LineString",
      coordinates: [
        [11, 47, 200],
        [11.01, 47, 100],
        [11, 47, 200],
      ],
    },
  ],
  // descending in each cardinal direction
  [
    {
      type: "LineString",
      coordinates: [
        [11, 47, 200],
        [11, 47.01, 100],
      ],
    },
  ],
  [
    {
      type: "LineString",
      coordinates: [
        [11, 47, 200],
        [11, 46.99, 100],
      ],
    },
  ],
  [
    {
      type: "LineString",
      coordinates: [
        [11, 47, 200],
        [11.01, 47, 100],
      ],
    },
  ],
  [
    {
      type: "LineString",
      coordinates: [
        [11, 47, 200],
        [10.99, 47, 100],
      ],
    },
  ],
  // a single position
  [{ type: "Point", coordinates: [11, 47] }],
  [{ type: "Point", coordinates: [11, 47, 1234.5] }],
  // across the antimeridian
  [
    {
      type: "LineString",
      coordinates: [
        [179.995, 10, 300],
        [-179.995, 10, 200],
      ],
    },
  ],
];
for (const geometries of exact) cases.push({ geometries });
for (let n = 0; n < 700; n++) {
  const origin = pick(origins);
  const count = 1 + (random() < 0.15 ? int(3) : 0);
  cases.push({
    geometries: Array.from({ length: count }, () => geometry(origin)),
  });
}
for (const c of cases) c.expected = computeViewportHint(c.geometries);

const generated =
  '{"cases":[\n' + cases.map((c) => JSON.stringify(c)).join(",\n") + "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-viewport-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("viewport vectors are up to date");
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  const nullBearing = cases.filter((c) => c.expected.bearing === null).length;
  console.log(`Wrote ${cases.length} cases (${nullBearing} without a bearing)`);
}
