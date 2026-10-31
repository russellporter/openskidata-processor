#!/usr/bin/env node
/**
 * Generates `rust/crates/openskidata-format/tests/vectors.json` by calling the real
 * `openskidata-format` package.
 *
 * The Rust port of these functions is verified against these vectors rather than against
 * a hand-copied table, because the failure mode being guarded against is exactly a
 * transcription slip — a colour assigned to the wrong difficulty reads perfectly well and
 * is wrong in every output file.
 *
 * Only the functions with enumerable inputs are covered here. The float-sensitive ones
 * (computeViewportHint, lineChunkPatched and the elevation maths) need geometry fixtures
 * and a numeric tolerance, so they are handled separately.
 *
 * Usage: node rust/codegen/generate-format-vectors.mjs [--check]
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const outPath = join(
  repoRoot,
  "rust/crates/openskidata-format/tests/vectors.json",
);

const pkg = JSON.parse(
  readFileSync(
    join(repoRoot, "node_modules/openskidata-format/package.json"),
    "utf8",
  ),
);
const f = await import("openskidata-format");

const difficulties = [...Object.values(f.RunDifficulty), null];
const conventions = Object.values(f.RunDifficultyConvention);

const vectors = {
  formatVersion: pkg.version,

  runColorName: conventions.flatMap((convention) =>
    difficulties.map((difficulty) => ({
      convention,
      difficulty,
      expected: f.getRunColorName(convention, difficulty),
    })),
  ),

  runColor: conventions.flatMap((convention) =>
    difficulties.map((difficulty) => ({
      convention,
      difficulty,
      expected: f.getRunColor(convention, difficulty),
    })),
  ),

  runColorNameToValue: Object.values(f.RunColorName).map((color) => ({
    color,
    expected: f.runColorNameToValue(color),
  })),

  liftColor: Object.values(f.Status).map((status) => ({
    status,
    expected: f.getLiftColor(status),
  })),

  formattedLiftType: Object.values(f.LiftType).map((liftType) => ({
    liftType,
    expected: f.getFormattedLiftType(liftType),
  })),

  sourceURL: Object.values(f.SourceType).map((type) => ({
    type,
    id: "example-id/123",
    expected: f.getSourceURL({ type, id: "example-id/123" }),
  })),

  sourceName: Object.values(f.SourceType).map((type) => ({
    type,
    expected: f.getSourceName(type),
  })),

  // getSlopeGradingScaleForUse is enumerable over (use, convention).
  slopeGradingScaleForUse: Object.values(f.RunUse).flatMap((runUse) =>
    conventions.map((convention) => ({
      runUse,
      convention,
      expected: f.getSlopeGradingScaleForUse(runUse, convention),
    })),
  ),

  // getRunDifficultyConvention takes a geometry and does point-in-polygon against
  // embedded region polygons. Sampled at points chosen to sit inside each convention's
  // region and at a few boundaries, since the polygon data itself is not reproduced in
  // Rust by hand.
  runDifficultyConvention: [
    { name: "Austrian Alps", lng: 11.3, lat: 47.2 },
    { name: "French Alps", lng: 6.6, lat: 45.3 },
    { name: "Hokkaido", lng: 142.8, lat: 43.3 },
    { name: "Honshu", lng: 138.2, lat: 36.7 },
    { name: "Colorado", lng: -106.0, lat: 39.6 },
    { name: "British Columbia", lng: -118.2, lat: 50.9 },
    { name: "Chilean Andes", lng: -70.3, lat: -33.4 },
    { name: "New Zealand", lng: 170.1, lat: -44.6 },
    { name: "Norway", lng: 8.5, lat: 60.9 },
    { name: "mid Atlantic", lng: -30.0, lat: 40.0 },
  ].map((point) => ({
    ...point,
    expected: f.getRunDifficultyConvention({
      type: "Point",
      coordinates: [point.lng, point.lat],
    }),
  })),
};

/**
 * JSON has no Infinity, and `JSON.stringify` silently turns it into `null`. The slope
 * grading scales use Infinity as their final threshold, and a null there would read as
 * "no threshold" instead of "unbounded", so it is encoded explicitly.
 */
function encodeNonFinite(_key, value) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    if (Number.isNaN(value)) return { $nonFinite: "NaN" };
    return { $nonFinite: value > 0 ? "Infinity" : "-Infinity" };
  }
  return value;
}

const generated = JSON.stringify(vectors, encodeNonFinite, 2) + "\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date with openskidata-format@${pkg.version}.\n` +
        "Run: node rust/codegen/generate-format-vectors.mjs",
    );
    process.exit(1);
  }
  console.log(
    `vectors.json is up to date with openskidata-format@${pkg.version}`,
  );
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  const total = Object.entries(vectors)
    .filter(([, v]) => Array.isArray(v))
    .reduce((sum, [, v]) => sum + v.length, 0);
  console.log(
    `Wrote ${total} test vectors from openskidata-format@${pkg.version}`,
  );
}
