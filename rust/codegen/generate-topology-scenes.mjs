#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-normalize/tests/topology_scenes.json` by running randomised
 * line and polygon scenes through the real `topojson-server` `topology()`.
 *
 * Scenes live on a small integer grid so that arcs overlap, reverse, share vertices and
 * cross in every way the algorithm distinguishes: shared sub-paths, reversed duplicates,
 * closed lines, self-intersections, rings that are rotated or reversed copies of each
 * other, and rings sharing a stretch with a line. Coordinates are written as integers in
 * 1e-7 degrees -- the store's fixed-point unit -- and divided by 1e7 on the way in, so the
 * floats given to topojson are exactly the ones the Rust side reconstructs.
 *
 * Usage: node rust/codegen/generate-topology-scenes.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as topojsonServer from "topojson-server";
import { repoRoot } from "./tooling.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-normalize/tests/topology_scenes.json",
);

const SCALE = 1e7;
const toDegrees = ([x, y]) => [x / SCALE, y / SCALE];
const toFixed = ([x, y]) => [Math.round(x * SCALE), Math.round(y * SCALE)];

// A deterministic generator so the checked-in file is reproducible.
let seed = 20240607;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const int = (n) => Math.floor(random() * n);
const pick = (items) => items[int(items.length)];

const STEP = 1000; // 1e-4 degrees, comfortably on the grid
const point = (gx, gy) => [gx * STEP, gy * STEP];

/** A random walk on a `size` x `size` grid, which revisits points when `size` is small. */
function walk(size, length) {
  let gx = int(size);
  let gy = int(size);
  const points = [point(gx, gy)];
  while (points.length < length) {
    const move = pick([
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
    ]);
    const nx = Math.min(size - 1, Math.max(0, gx + move[0]));
    const ny = Math.min(size - 1, Math.max(0, gy + move[1]));
    if (nx === gx && ny === gy) continue;
    gx = nx;
    gy = ny;
    points.push(point(gx, gy));
  }
  return points;
}

function ringFrom(points) {
  // Close a path into a ring, dropping a repeated closing point.
  const ring = points.slice();
  if (ring.length < 3) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return ring.length >= 4 ? ring : null;
}

const rotateRing = (ring, k) => {
  const open = ring.slice(0, -1);
  const rotated = open.slice(k).concat(open.slice(0, k));
  return rotated.concat([rotated[0]]);
};
const reverseCopy = (points) => points.slice().reverse();

function randomScene() {
  const size = pick([3, 4, 5, 8]);
  const geometries = [];
  const count = 1 + int(7);
  while (geometries.length < count) {
    const kind = random();
    const previous = geometries.length > 0 ? pick(geometries) : null;
    if (kind < 0.35 || previous === null) {
      geometries.push({
        type: "LineString",
        coordinates: walk(size, 2 + int(7)),
      });
    } else if (kind < 0.5 && previous.type === "LineString") {
      // Reversed duplicate, or a sub-path of an earlier line.
      const coords = previous.coordinates;
      const from = int(coords.length - 1);
      const to = from + 1 + int(coords.length - from - 1);
      const sub = coords.slice(from, to + 1);
      geometries.push({
        type: "LineString",
        coordinates: random() < 0.5 ? reverseCopy(sub) : sub,
      });
    } else if (kind < 0.58 && previous.type === "LineString") {
      // Branch off an earlier line.
      const coords = previous.coordinates;
      const at = coords[int(coords.length)];
      const branch = walk(size, 2 + int(3));
      geometries.push({ type: "LineString", coordinates: [at, ...branch] });
    } else if (kind < 0.7) {
      const ring = ringFrom(walk(size, 4 + int(5)));
      if (ring) geometries.push({ type: "Polygon", coordinates: [ring] });
    } else if (kind < 0.8 && previous.type === "Polygon") {
      // Rotated and/or reversed copy of an earlier ring.
      let ring = previous.coordinates[0];
      ring = rotateRing(ring, int(ring.length - 1));
      if (random() < 0.5) ring = reverseCopy(ring);
      geometries.push({ type: "Polygon", coordinates: [ring] });
    } else if (kind < 0.88 && previous.type === "Polygon") {
      // A line running along part of an earlier ring.
      const ring = previous.coordinates[0];
      const from = int(ring.length - 2);
      const sub = ring.slice(from, from + 2 + int(3));
      if (sub.length >= 2)
        geometries.push({ type: "LineString", coordinates: sub });
    } else if (kind < 0.94) {
      // A closed line.
      const path = walk(size, 3 + int(4));
      geometries.push({ type: "LineString", coordinates: [...path, path[0]] });
    } else {
      // A polygon with a hole.
      const outer = ringFrom(walk(size, 4 + int(4)));
      const inner = ringFrom(walk(size, 4 + int(3)));
      if (outer && inner) {
        geometries.push({ type: "Polygon", coordinates: [outer, inner] });
      }
    }
  }
  return geometries;
}

function record(geometries) {
  const features = geometries.map((geometry, i) => ({
    type: "Feature",
    properties: { i },
    geometry: {
      type: geometry.type,
      coordinates:
        geometry.type === "LineString"
          ? geometry.coordinates.map(toDegrees)
          : geometry.coordinates.map((ring) => ring.map(toDegrees)),
    },
  }));
  const topology = topojsonServer.topology({
    runs: { type: "FeatureCollection", features },
  });
  return {
    input: geometries,
    arcs: topology.arcs.map((arc) => arc.map(toFixed)),
    geometries: topology.objects.runs.geometries.map((g) => ({
      type: g.type,
      arcs: g.arcs,
    })),
  };
}

const scenes = [];
// Hand-built cases first: the situations the algorithm's comments call out by name.
const handBuilt = [
  // ABC, CBA: B is not a junction.
  [
    {
      type: "LineString",
      coordinates: [point(0, 0), point(1, 0), point(2, 0)],
    },
    {
      type: "LineString",
      coordinates: [point(2, 0), point(1, 0), point(0, 0)],
    },
  ],
  // ... plus ABD: it is.
  [
    {
      type: "LineString",
      coordinates: [point(0, 0), point(1, 0), point(2, 0)],
    },
    {
      type: "LineString",
      coordinates: [point(2, 0), point(1, 0), point(0, 0)],
    },
    {
      type: "LineString",
      coordinates: [point(0, 0), point(1, 0), point(1, 1)],
    },
  ],
  // A closed line is never rotated.
  [
    {
      type: "LineString",
      coordinates: [
        point(0, 0),
        point(1, 0),
        point(1, 1),
        point(0, 1),
        point(0, 0),
      ],
    },
    { type: "LineString", coordinates: [point(1, 1), point(2, 1)] },
  ],
  // A figure eight crossing itself with nothing else through the crossing.
  [
    {
      type: "LineString",
      coordinates: [
        point(0, 0),
        point(1, 1),
        point(2, 2),
        point(2, 0),
        point(1, 1),
        point(0, 2),
      ],
    },
  ],
  // A ring and its rotated, reversed copy.
  [
    {
      type: "Polygon",
      coordinates: [
        [point(0, 0), point(2, 0), point(2, 2), point(0, 2), point(0, 0)],
      ],
    },
    {
      type: "Polygon",
      coordinates: [
        [point(2, 2), point(2, 0), point(0, 0), point(0, 2), point(2, 2)],
      ],
    },
  ],
  // Adjacent polygons sharing an edge.
  [
    {
      type: "Polygon",
      coordinates: [
        [point(0, 0), point(1, 0), point(1, 1), point(0, 1), point(0, 0)],
      ],
    },
    {
      type: "Polygon",
      coordinates: [
        [point(1, 0), point(2, 0), point(2, 1), point(1, 1), point(1, 0)],
      ],
    },
  ],
];
for (const geometries of handBuilt) scenes.push(record(geometries));
for (let n = 0; n < 600; n++) scenes.push(record(randomScene()));

// One scene per line: diffable, and small enough to check in. Excluded from Prettier via
// .prettierignore, which would otherwise put every number on its own line.
const generated =
  '{"scenes":[\n' +
  scenes.map((scene) => JSON.stringify(scene)).join(",\n") +
  "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-topology-scenes.mjs`,
    );
    process.exit(1);
  }
  console.log("topology scenes are up to date");
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  const arcs = scenes.reduce((n, s) => n + s.arcs.length, 0);
  console.log(`Wrote ${scenes.length} scenes, ${arcs} arcs`);
}
