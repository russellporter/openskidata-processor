#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-osm/tests/validity_vectors.json` by running randomised
 * geometries through the real `@turf/boolean-valid` (what `isValidGeometryInFeature` calls).
 *
 * Geometries live on a tiny integer grid so that degenerate configurations -- spikes,
 * rings touching themselves, holes touching or crossing the outer ring, overlapping
 * multipolygon members, collinear overlaps -- occur constantly rather than almost never.
 *
 * Usage: node rust/codegen/generate-validity-vectors.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "./tooling.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-osm/tests/validity_vectors.json",
);
const { default: booleanValid } = await import("@turf/boolean-valid");

let seed = 8675309;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const int = (n) => Math.floor(random() * n);
const pick = (items) => items[int(items.length)];

const SIZE = 5;
const point = () => [int(SIZE), int(SIZE)];
const path = (n) => Array.from({ length: n }, point);
const closed = (n) => {
  const p = path(n);
  return [...p, [...p[0]]];
};
// A square-ish ring at a random offset and size: valid more often than a random walk.
const square = (x, y, s) => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
];
const ring = () =>
  random() < 0.5 ? closed(3 + int(5)) : square(int(3), int(3), 1 + int(3));

function geometry() {
  switch (int(8)) {
    case 0:
      return { type: "Point", coordinates: point() };
    case 1:
      return { type: "LineString", coordinates: path(1 + int(5)) };
    case 2:
      return {
        type: "MultiLineString",
        coordinates: Array.from({ length: int(3) }, () => path(int(4))),
      };
    case 3:
    case 4:
      return { type: "Polygon", coordinates: [ring()] };
    case 5:
      return { type: "Polygon", coordinates: [ring(), ring()] };
    case 6:
      return { type: "MultiPolygon", coordinates: [[ring()], [ring()]] };
    default:
      return {
        type: "MultiPolygon",
        coordinates: [[ring(), ring()], [ring()]],
      };
  }
}

const cases = [];
// Named configurations first.
const named = [
  { type: "LineString", coordinates: [[0, 0]] },
  {
    type: "LineString",
    coordinates: [
      [0, 0],
      [1, 1],
    ],
  },
  { type: "Polygon", coordinates: [square(0, 0, 2)] },
  {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 0],
      ],
    ],
  },
  {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [2, 0],
        [1, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ],
    ],
  }, // spike
  {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    ],
  }, // not closed
  { type: "Polygon", coordinates: [square(0, 0, 4), square(1, 1, 2)] }, // hole inside
  { type: "Polygon", coordinates: [square(0, 0, 4), square(0, 0, 2)] }, // hole sharing a corner and edges
  { type: "Polygon", coordinates: [square(0, 0, 4), square(3, 1, 2)] }, // hole crossing the boundary
  {
    type: "Polygon",
    coordinates: [
      square(0, 0, 4),
      [
        [0, 1],
        [1, 2],
        [0, 3],
        [0, 1],
      ],
    ],
  }, // hole touching one edge
  { type: "MultiPolygon", coordinates: [[square(0, 0, 2)], [square(3, 3, 1)]] }, // disjoint
  { type: "MultiPolygon", coordinates: [[square(0, 0, 3)], [square(1, 1, 3)]] }, // overlapping
  { type: "MultiPolygon", coordinates: [[square(0, 0, 2)], [square(2, 0, 2)]] }, // sharing an edge
  { type: "MultiPolygon", coordinates: [[square(0, 0, 4)], [square(1, 1, 1)]] }, // nested
];
for (const g of named) cases.push(g);
for (let n = 0; n < 3000; n++) cases.push(geometry());

const recorded = cases.map((g) => {
  let expected;
  try {
    expected = booleanValid(g);
  } catch (error) {
    expected = "throws";
  }
  return { geometry: g, expected };
});

const generated =
  '{"cases":[\n' +
  recorded.map((c) => JSON.stringify(c)).join(",\n") +
  "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-validity-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("validity vectors are up to date");
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  const by = {};
  for (const c of recorded) {
    const k = c.geometry.type + ":" + c.expected;
    by[k] = (by[k] || 0) + 1;
  }
  console.log(`Wrote ${recorded.length} cases`, JSON.stringify(by));
}
