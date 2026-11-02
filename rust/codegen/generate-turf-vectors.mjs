#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-cluster/tests/turf_vectors.json` from the real turf functions
 * the clustering stage depends on:
 *
 * - `skiAreaGeometry`, copied from `SkiAreaClusteringService` (centroid of a geometry
 *   collection, nearest vertex, and `along` 100 m from it), over randomised member sets;
 * - `length` of every geometry type, which the statistics and the site-coverage rule use.
 *
 * Usage: node rust/codegen/generate-turf-vectors.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "./tooling.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-cluster/tests/turf_vectors.json",
);
const { default: along } = await import("@turf/along");
const { default: centroid } = await import("@turf/centroid");
const turf = await import("@turf/helpers");
const { default: length } = await import("@turf/length");
const { default: nearestPoint } = await import("@turf/nearest-point");
const dist = await import(join(repoRoot, "dist/transforms/GeoTransforms.js"));

let seed = 777;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const int = (n) => Math.floor(random() * n);
const pick = (items) => items[int(items.length)];

const ORIGINS = [
  [11.3, 47.2],
  [142.8, 43.3],
  [-106.0, 39.6],
  [-70.3, -33.4],
  [8.5, 60.9],
];
const round7 = (x) => Math.round(x * 1e7) / 1e7;

function line(origin, n, spread) {
  let [lng, lat] = origin;
  return Array.from({ length: n }, () => {
    lng += (random() - 0.5) * spread;
    lat += (random() - 0.5) * spread;
    return [round7(lng), round7(lat)];
  });
}

function geometry(origin) {
  const spread = pick([0.0004, 0.004, 0.02]);
  switch (int(5)) {
    case 0:
      return { type: "Point", coordinates: line(origin, 1, spread)[0] };
    case 1:
      return {
        type: "LineString",
        coordinates: line(origin, 2 + int(6), spread),
      };
    case 2:
      return {
        type: "MultiLineString",
        coordinates: [
          line(origin, 2 + int(3), spread),
          line(origin, 2 + int(3), spread),
        ],
      };
    case 3: {
      const ring = line(origin, 3 + int(4), spread);
      return { type: "Polygon", coordinates: [[...ring, ring[0]]] };
    }
    default: {
      const a = line(origin, 3, spread);
      const b = line(origin, 3, spread);
      return {
        type: "MultiPolygon",
        coordinates: [[[...a, a[0]]], [[...b, b[0]]]],
      };
    }
  }
}

/** `SkiAreaClusteringService.skiAreaGeometry`, verbatim. */
function skiAreaGeometry(memberObjects) {
  const centroidPoint = centroid({
    type: "GeometryCollection",
    geometries: memberObjects,
  }).geometry;
  const nearestPointToCentroid = nearestPoint(
    centroidPoint,
    dist.getPoints(memberObjects.flatMap((g) => dist.getPositions(g))),
  ).geometry;
  const l = turf.lineString([
    nearestPointToCentroid.coordinates,
    centroidPoint.coordinates,
  ]);
  if (length(l) > 0.1) {
    return along(l, 0.1).geometry;
  } else {
    return centroidPoint;
  }
}

const skiAreaGeometries = [];
for (let n = 0; n < 600; n++) {
  const origin = pick(ORIGINS);
  const members = Array.from({ length: 1 + int(5) }, () => geometry(origin));
  // Points are valid members only through the multi-geometry helpers; keep the mix.
  skiAreaGeometries.push({
    members,
    expected: skiAreaGeometry(members).coordinates,
  });
}

// Hand-built: members symmetric about their centroid (binary-exact offsets), so two vertices
// are exactly equidistant from it and the first one must win; and the same set reversed.
const ties = [
  [
    { type: "Point", coordinates: [10, 45] },
    { type: "Point", coordinates: [10.5, 45] },
  ],
  [
    { type: "Point", coordinates: [10.5, 45] },
    { type: "Point", coordinates: [10, 45] },
  ],
  [
    {
      type: "LineString",
      coordinates: [
        [10, 45],
        [10.5, 45],
      ],
    },
  ],
  [
    {
      type: "LineString",
      coordinates: [
        [10.5, 45],
        [10, 45],
      ],
    },
  ],
  [
    { type: "Point", coordinates: [10, 45] },
    { type: "Point", coordinates: [10, 45.5] },
  ],
  [
    { type: "Point", coordinates: [10, 45.5] },
    { type: "Point", coordinates: [10, 45] },
  ],
];
for (const members of ties) {
  skiAreaGeometries.push({
    members,
    expected: skiAreaGeometry(members).coordinates,
  });
}

const lengths = [];
for (let n = 0; n < 400; n++) {
  const g = geometry(pick(ORIGINS));
  lengths.push({ geometry: g, expected: length(turf.feature(g)) });
}

// Polygons with holes, whose holes are rings that count towards the length too.
for (let n = 0; n < 60; n++) {
  const [lng, lat] = pick(ORIGINS);
  const size = pick([0.001, 0.01]);
  const outer = [
    [lng, lat],
    [lng + size, lat],
    [lng + size, lat + size],
    [lng, lat + size],
    [lng, lat],
  ];
  const hole = [
    [lng + size / 4, lat + size / 4],
    [lng + size / 4, lat + size / 2],
    [lng + size / 2, lat + size / 2],
    [lng + size / 2, lat + size / 4],
    [lng + size / 4, lat + size / 4],
  ].map(([x, y]) => [round7(x), round7(y)]);
  const g = {
    type: "Polygon",
    coordinates: [outer.map(([x, y]) => [round7(x), round7(y)]), hole],
  };
  lengths.push({ geometry: g, expected: length(turf.feature(g)) });
}

const generated =
  '{"skiAreaGeometry":[\n' +
  skiAreaGeometries.map((c) => JSON.stringify(c)).join(",\n") +
  '\n],"length":[\n' +
  lengths.map((c) => JSON.stringify(c)).join(",\n") +
  "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-turf-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("turf vectors are up to date");
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  const far = skiAreaGeometries.filter((c) => true).length;
  console.log(`Wrote ${far} ski area geometries and ${lengths.length} lengths`);
}
