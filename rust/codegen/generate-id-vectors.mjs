#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-store/tests/id_vectors.json`:
 *
 * - `ids`: randomised geometries of every type, with and without elevation, hashed by the
 *   real `featureID` (`FeatureBuilder.ts`, i.e. `object-hash`), and
 * - `numbers`: doubles across the whole range, with `String(x)`, because every coordinate
 *   in every id is formatted by `Number.prototype.toString()`.
 *
 * Build first (`npm run build`). Usage: node rust/codegen/generate-id-vectors.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "./tooling.mjs";

const outPath = join(repoRoot, "rust/crates/osd-store/tests/id_vectors.json");
const { featureID } = await import(
  join(repoRoot, "dist/transforms/FeatureBuilder.js")
);

let seed = 31337;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const int = (n) => Math.floor(random() * n);
const pick = (items) => items[int(items.length)];

// Coordinates as they occur: 7-decimal degrees, sometimes whole numbers, sometimes tiny
// values near zero (which JavaScript prints in exponent form), sometimes elevations.
function coordinate() {
  const kind = random();
  if (kind < 0.7) return Math.round((random() * 360 - 180) * 1e7) / 1e7;
  if (kind < 0.8) return int(360) - 180;
  if (kind < 0.9) return Math.round((random() - 0.5) * 2e-5 * 1e12) / 1e12; // near zero
  return Math.round(random() * 3000 * 10) / 10;
}
const position = (elevated) =>
  elevated
    ? [coordinate(), coordinate(), Math.round(random() * 3000 * 10) / 10]
    : [coordinate(), coordinate()];
const line = (n, e) => Array.from({ length: n }, () => position(e));
/**
 * A closed ring. When `shared`, the closing position is the very same array as the first,
 * which is what `topojson-server`'s ring rotation produces and `object-hash` renders as a
 * back-reference.
 */
const ring = (e, shared) => {
  const l = line(3 + int(4), e);
  return [...l, shared ? l[0] : [...l[0]]];
};

function geometry() {
  const elevated = random() < 0.3;
  switch (int(5)) {
    case 0:
      return {
        geometry: { type: "Point", coordinates: position(elevated) },
        shared: null,
      };
    case 1:
      return {
        geometry: {
          type: "LineString",
          coordinates: line(2 + int(8), elevated),
        },
        shared: null,
      };
    case 2: {
      const shared = [random() < 0.5];
      const rings = [ring(elevated, shared[0])];
      if (random() < 0.3) {
        shared.push(random() < 0.5);
        rings.push(ring(elevated, shared[1]));
      }
      return { geometry: { type: "Polygon", coordinates: rings }, shared };
    }
    case 3:
      return {
        geometry: {
          type: "MultiLineString",
          coordinates: [line(2 + int(4), elevated), line(2 + int(4), elevated)],
        },
        shared: null,
      };
    default: {
      const shared = [[random() < 0.5], [random() < 0.5]];
      return {
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [ring(elevated, shared[0][0])],
            [ring(elevated, shared[1][0])],
          ],
        },
        shared,
      };
    }
  }
}

const types = ["run", "lift", "skiArea", "spot"];
const ids = [];
for (let n = 0; n < 600; n++) {
  const { geometry: g, shared } = geometry();
  const type = pick(types);
  // `g` carries any shared closing positions as real shared references, so hashing it
  // directly includes the back-reference; the JSON copy is what the Rust side reads.
  ids.push({
    featureType: type,
    geometry: JSON.parse(JSON.stringify(g)),
    closingShared: shared,
    expected: featureID(g, type),
  });
}
// The ski area placeholder: [360, 360, relation id].
ids.push({
  featureType: "skiArea",
  geometry: { type: "Point", coordinates: [360, 360, 123456789] },
  closingShared: null,
  expected: featureID(
    { type: "Point", coordinates: [360, 360, 123456789] },
    "skiArea",
  ),
});

const numbers = [];
const edge = [
  0,
  1,
  -1,
  0.1,
  0.5,
  1e-6,
  1e-7,
  1.5e-7,
  9.999999e-7,
  123456789012345680000,
  1e20,
  1e21,
  1.5e21,
  2 ** 53,
  2 ** 53 + 2,
  0.000001,
  1234.5678,
  5e-324,
  1.7976931348623157e308,
  11.3,
  47.2,
  179.9999999,
  -0.0000001,
  100,
  1e5,
  123456.789,
];
for (const x of edge) numbers.push({ x, expected: String(x) });
for (let n = 0; n < 1500; n++) {
  const magnitude = 10 ** (random() * 40 - 20);
  const x = (random() < 0.5 ? -1 : 1) * random() * magnitude;
  numbers.push({ x, expected: String(x) });
}

const generated =
  '{"ids":[\n' +
  ids.map((c) => JSON.stringify(c)).join(",\n") +
  '\n],"numbers":[\n' +
  numbers.map((c) => JSON.stringify(c)).join(",\n") +
  "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-id-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("id vectors are up to date");
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  console.log(`Wrote ${ids.length} ids and ${numbers.length} numbers`);
}
