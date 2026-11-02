#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-turf/tests/intersects_vectors.json`: the real turf
 * `booleanIntersects(polygon, line-or-polygon)` on random inputs and on small integer grids,
 * where vertices land on edges and corners and segments run collinear, so the boundary
 * behaviour (and the sweepline's quirks) is exercised.
 *
 * Usage: node rust/codegen/generate-intersects-vectors.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./tooling.mjs";
import { chance, int, pick, reseed } from "./osm-worlds.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-turf/tests/intersects_vectors.json",
);
const { default: booleanIntersects } = await import("@turf/boolean-intersects");
reseed(20261106);

function ring(min, max) {
  return [min, [max[0], min[1]], max, [min[0], max[1]], min];
}

function intersects(pixel, geometry) {
  return booleanIntersects(
    {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [pixel] },
    },
    { type: "Feature", properties: {}, geometry },
  );
}

const cases = [];
function add(pixel, geometry) {
  cases.push({ pixel, geometry, result: intersects(pixel, geometry) });
}

/** Coordinates from a coarse grid, or from a fine random one. */
function coordinate(grid) {
  return grid === 0
    ? [int(2001) / 100 - 10, int(2001) / 100 - 10]
    : [int(grid * 4 + 1) - grid * 2, int(grid * 4 + 1) - grid * 2];
}

function line(grid) {
  const n = 2 + int(chance(0.2) ? 8 : 3);
  return Array.from({ length: n }, () => coordinate(grid));
}

function closedRing(grid) {
  const n = 3 + int(5);
  const points = Array.from({ length: n }, () => coordinate(grid));
  points.push(points[0]);
  return points;
}

function square(grid) {
  // The pixel: a square, on the grid or not.
  if (grid === 0) {
    const x = int(1001) / 100 - 5;
    const y = int(1001) / 100 - 5;
    const size = 0.5 + int(500) / 100;
    return ring([x, y], [x + size, y + size]);
  }
  const x = int(grid * 2 + 1) - grid;
  const y = int(grid * 2 + 1) - grid;
  const size = 1 + int(grid);
  return ring([x, y], [x + size, y + size]);
}

for (let i = 0; i < 9000; i++) {
  const grid = pick([0, 1, 2, 2, 3, 4]);
  const pixel = square(grid);
  switch (int(5)) {
    case 0:
    case 1:
      add(pixel, { type: "LineString", coordinates: line(grid) });
      break;
    case 2:
      add(pixel, { type: "Polygon", coordinates: [closedRing(grid)] });
      break;
    case 3:
      add(pixel, {
        type: "Polygon",
        coordinates: [closedRing(grid), closedRing(grid)],
      });
      break;
    default: {
      // A line along or through the pixel's own edges.
      const [a, b, c] = [pixel[0], pixel[1], pixel[2]];
      const start = pick([a, b, c, pixel[3]]);
      const end = pick([a, b, c, pixel[3], coordinate(grid)]);
      const extend = (p, q, k) => [
        p[0] + (p[0] - q[0]) * k,
        p[1] + (p[1] - q[1]) * k,
      ];
      add(pixel, {
        type: "LineString",
        coordinates: chance(0.5)
          ? [extend(start, end, int(3)), extend(end, start, int(3))]
          : [start, end],
      });
    }
  }
}

// Targeted: lines through a corner or an edge point from outside (a touch, or a crossing), and
// polygons that sit inside the pixel, enclose it, share an edge or a corner with it, or have it
// in a hole.
for (let i = 0; i < 4000; i++) {
  const grid = pick([1, 2, 3]);
  const pixel = square(grid);
  const [min, max] = [pixel[0], pixel[2]];
  const size = max[0] - min[0];
  const onEdge = pick([
    min,
    pixel[1],
    max,
    pixel[3],
    [min[0] + size / 2, min[1]],
    [max[0], min[1] + size / 2],
    [min[0] + size / 2, max[1]],
    [min[0], min[1] + size / 2],
  ]);
  const direction = pick([
    [1, 1],
    [1, -1],
    [1, 0],
    [0, 1],
    [2, 1],
    [1, 2],
    [-1, 2],
    [-2, 1],
  ]);
  const before = 1 + int(2 * size + 2);
  const after = 1 + int(2 * size + 2);
  add(pixel, {
    type: "LineString",
    coordinates: [
      [onEdge[0] - direction[0] * before, onEdge[1] - direction[1] * before],
      [onEdge[0] + direction[0] * after, onEdge[1] + direction[1] * after],
    ],
  });

  const inside = () => [
    min[0] + (int(size * 8 - 1) + 1) / 8,
    min[1] + (int(size * 8 - 1) + 1) / 8,
  ];
  switch (int(6)) {
    case 0: {
      const ringInside = [inside(), inside(), inside()];
      ringInside.push(ringInside[0]);
      add(pixel, { type: "Polygon", coordinates: [ringInside] });
      break;
    }
    case 1:
      add(pixel, {
        type: "Polygon",
        coordinates: [ring([min[0] - 1, min[1] - 1], [max[0] + 1, max[1] + 1])],
      });
      break;
    case 2:
      add(pixel, { type: "Polygon", coordinates: [ring(min, max)] });
      break;
    case 3: {
      // Shares the right edge, or a corner.
      const dy = pick([0, size, -size, size / 2]);
      add(pixel, {
        type: "Polygon",
        coordinates: [
          ring([max[0], min[1] + dy], [max[0] + size, max[1] + dy]),
        ],
      });
      break;
    }
    case 4:
      // The pixel lies in the polygon's hole.
      add(pixel, {
        type: "Polygon",
        coordinates: [
          ring([min[0] - 3, min[1] - 3], [max[0] + 3, max[1] + 3]),
          ring([min[0] - 1, min[1] - 1], [max[0] + 1, max[1] + 1]),
        ],
      });
      break;
    default:
      // Its hole lies in the pixel.
      add(pixel, {
        type: "Polygon",
        coordinates: [
          ring([min[0] - 3, min[1] - 3], [max[0] + 3, max[1] + 3]),
          ring([min[0] + 0.25, min[1] + 0.25], [max[0] - 0.25, max[1] - 0.25]),
        ],
      });
  }
}

const generated =
  '{"cases":[\n' + cases.map((c) => JSON.stringify(c)).join(",\n") + "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-intersects-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("intersects_vectors.json is up to date");
} else {
  writeFileSync(outPath, generated);
  const yes = cases.filter((c) => c.result).length;
  console.log(`Wrote ${cases.length} cases (${yes} intersect)`);
}
