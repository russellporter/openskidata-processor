#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-normalize/tests/normalize_scenes.json` by running randomised
 * run sets through the real `RunNormalizerAccumulator` -- topology, merge of overlapping
 * runs, and joining of segments, end to end.
 *
 * Scenes use the same small grid as the topology scenes, so that runs overlap, branch,
 * reverse and chain in every way the merge rules distinguish. Each run draws its
 * properties from a small pool, so neighbouring runs are sometimes the same run (and join)
 * and sometimes not, and a random `oneway` exercises the direction rules. A "variant" bit
 * changes only the viewport hint, which is part of full-property equality (it decides
 * whether two arcs belong to the same group of runs) but not of the same-run comparison
 * (which ignores it): both comparisons need exercising.
 *
 * The comparison on the Rust side ignores `id` and `viewportHint` in the output, because
 * both are recomputed from the final geometry (the id by the hashing stage, the hint by
 * the float-sensitive viewport code); the grouping decisions that depend on them are what
 * the variant bit covers.
 *
 * Build first (`npm run build`). Usage: node rust/codegen/generate-normalize-scenes.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "./tooling.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-normalize/tests/normalize_scenes.json",
);
const { RunNormalizerAccumulator } = await import(
  join(repoRoot, "dist/transforms/accumulator/RunNormalizerAccumulator.js")
);
const f = await import("openskidata-format");

const SCALE = 1e7;
const toDegrees = ([x, y]) => [x / SCALE, y / SCALE];
const toFixed = ([x, y]) => [Math.round(x * SCALE), Math.round(y * SCALE)];

let seed = 424242;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const int = (n) => Math.floor(random() * n);
const pick = (items) => items[int(items.length)];

const STEP = 1000;
const point = (gx, gy) => [gx * STEP, gy * STEP];

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

const tri = [true, false, null];
const poolEntries = [
  { name: "Alpha", difficulty: "easy", uses: ["downhill"], oneway: true },
  { name: "Alpha", difficulty: "easy", uses: ["downhill"], oneway: null },
  { name: "Alpha", difficulty: "easy", uses: ["downhill"], oneway: false },
  {
    name: "Beta",
    difficulty: "advanced",
    uses: ["downhill", "nordic"],
    oneway: true,
  },
  { name: null, difficulty: null, uses: ["nordic"], oneway: null },
  { name: "Alpha", difficulty: "novice", uses: ["downhill"], oneway: true },
];

function properties(entry, variant, source) {
  return {
    type: "run",
    uses: entry.uses,
    id: "__deferred_feature_id__",
    name: entry.name,
    ref: null,
    status: "operating",
    description: null,
    difficulty: entry.difficulty,
    difficultyConvention: "europe",
    oneway: entry.oneway,
    lit: null,
    gladed: null,
    patrolled: random() < 0.2 ? true : null,
    snowmaking: null,
    snowfarming: null,
    tunnel: null,
    grooming: null,
    skiAreas: [],
    elevationProfile: null,
    sources: [{ type: "openstreetmap", id: "way/" + source }],
    websites: [],
    wikidataID: null,
    places: [],
    viewportHint: {
      center: [variant, 0],
      bearing: null,
      rotatedWidthMeters: 100,
      rotatedHeightMeters: 50,
      minCameraY: 0.5,
    },
  };
}

function randomScene() {
  const size = pick([3, 4, 5, 6]);
  const runs = [];
  const count = 1 + int(8);
  let source = 1;
  while (runs.length < count) {
    const entry = pick(poolEntries);
    const variant = random() < 0.8 ? 0 : 1;
    const kind = random();
    const previous = runs.length > 0 ? pick(runs) : null;
    let geometry;
    if (kind < 0.4 || previous === null) {
      geometry = { type: "LineString", coordinates: walk(size, 2 + int(6)) };
    } else if (kind < 0.6 && previous.geometry.type === "LineString") {
      // Continue an earlier line from one of its ends.
      const coords = previous.geometry.coordinates;
      const end = random() < 0.5 ? coords[coords.length - 1] : coords[0];
      geometry = {
        type: "LineString",
        coordinates: [end, ...walk(size, 2 + int(3))],
      };
    } else if (kind < 0.8 && previous.geometry.type === "LineString") {
      // Overlap an earlier line: a sub-path, possibly reversed.
      const coords = previous.geometry.coordinates;
      const from = int(coords.length - 1);
      const to = from + 1 + int(coords.length - from - 1);
      const sub = coords.slice(from, to + 1);
      geometry = {
        type: "LineString",
        coordinates: random() < 0.5 ? sub.slice().reverse() : sub,
      };
    } else if (kind < 0.9) {
      const path = walk(size, 4 + int(3));
      geometry = { type: "Polygon", coordinates: [[...path, path[0]]] };
    } else {
      const path = walk(size, 3 + int(3));
      geometry = { type: "LineString", coordinates: [...path, path[0]] };
    }
    // Skip degenerate (zero-length) lines, which upstream's formatter never emits.
    if (
      geometry.type === "LineString" &&
      geometry.coordinates.every(
        (c) =>
          c[0] === geometry.coordinates[0][0] &&
          c[1] === geometry.coordinates[0][1],
      )
    ) {
      continue;
    }
    runs.push({ geometry, properties: properties(entry, variant, source++) });
  }
  return runs;
}

function toFeature(run) {
  const g = run.geometry;
  return {
    type: "Feature",
    properties: structuredClone(run.properties),
    geometry: {
      type: g.type,
      coordinates:
        g.type === "LineString"
          ? g.coordinates.map(toDegrees)
          : g.coordinates.map((ring) => ring.map(toDegrees)),
    },
  };
}

function normalize(runs) {
  const accumulator = new RunNormalizerAccumulator();
  for (const run of runs) accumulator.accumulate(toFeature(run));
  return accumulator.results().map((feature) => {
    const { id, viewportHint, ...rest } = feature.properties;
    const g = feature.geometry;
    return {
      geometry: {
        type: g.type,
        coordinates:
          g.type === "LineString"
            ? g.coordinates.map(toFixed)
            : g.coordinates.map((ring) => ring.map(toFixed)),
      },
      properties: rest,
    };
  });
}

const scenes = [];
for (let n = 0; n < 700; n++) {
  const runs = randomScene();
  let expected;
  try {
    expected = normalize(runs);
  } catch (error) {
    expected = { error: String(error?.message ?? error) };
  }
  scenes.push({ runs, expected });
}

const generated =
  '{"scenes":[\n' +
  scenes.map((scene) => JSON.stringify(scene)).join(",\n") +
  "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-normalize-scenes.mjs`,
    );
    process.exit(1);
  }
  console.log("normalize scenes are up to date");
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  const outputs = scenes.reduce(
    (n, s) => n + (Array.isArray(s.expected) ? s.expected.length : 0),
    0,
  );
  const errors = scenes.filter((s) => !Array.isArray(s.expected)).length;
  console.log(
    `Wrote ${scenes.length} scenes, ${outputs} output runs, ${errors} errors`,
  );
}
