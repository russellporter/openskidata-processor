#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-enrich/tests/snow_vectors.json`: the real snow cover history code
 * (`weekToDayAndYear`, and `getSnowCoverHistory` over a cache that is a plain map) on random
 * weekly VIIRS data -- with missing-data codes, cloud persistence that pushes a measurement into
 * the year before, duplicate days, malformed cache entries, repeated pixels and several tiles
 * interleaved.
 *
 * Usage: node rust/codegen/generate-snow-vectors.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./tooling.mjs";
import { chance, int, pick, reseed } from "./osm-worlds.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-enrich/tests/snow_vectors.json",
);
const history = await import(join(repoRoot, "dist/utils/snowCoverHistory.js"));
reseed(20261108);

// weekToDayAndYear
const weeks = [];
for (let i = 0; i < 600; i++) {
  const week = pick([0, 1, 2, 26, 52, 53, 54, -1, int(55)]);
  const cloud = pick([0, 0, 1, 7, 30, 365, 366, -1, int(400), int(3650) / 10]);
  const baseYear = pick([
    1899,
    1900,
    2000,
    2012,
    2016,
    2020,
    2023,
    2100,
    2101,
    2000 + int(30),
  ]);
  weeks.push({
    week,
    cloud,
    baseYear,
    result: history.weekToDayAndYear(week, cloud, baseYear),
  });
}

function weekData() {
  const snow = pick([
    int(101),
    int(101),
    int(101),
    0,
    100,
    101,
    250,
    301,
    400,
    -1,
    int(1000) / 10,
  ]);
  const cloud = pick([
    0,
    0,
    0,
    1,
    2,
    3,
    7,
    14,
    int(40),
    int(400),
    -1,
    int(100) / 10,
  ]);
  return [snow, cloud];
}

function yearEntry(year) {
  const n = pick([53, 53, 52, 20, 5, 0]);
  return { year, data: Array.from({ length: n }, weekData) };
}

function pixelValue() {
  switch (int(12)) {
    case 0:
      return undefined; // not in the cache
    case 1:
      return null;
    case 2:
      return { year: 2020 }; // not an array
    case 3:
      return [{ year: 2020, data: [[10, 0], "x"] }]; // a malformed week: the year is dropped
    case 4:
      return [{ year: 1850, data: [[10, 0]] }, yearEntry(2021)]; // an impossible year
    case 5:
      return [{ year: 2020, data: [[10]] }, yearEntry(2022)];
    case 6:
      return int(2) === 0
        ? []
        : [
            yearEntry(2020),
            yearEntry(2020),
            { year: 2101, data: [[5, 5]] },
            { year: 1899.5, data: [[5, 0]] },
          ];
    default: {
      const first = pick([2012, 2016, 2020, 2022, 1900, 2100]);
      const count = 1 + int(4);
      return Array.from({ length: count }, (_, i) =>
        yearEntry(first + i),
      ).filter((y) => y.year <= 2100);
    }
  }
}

const tiles = [
  [12, 4],
  [12, 5],
  [8, 4],
  [9, 3],
  [35, 17],
  [0, 0],
  [10, 4],
];
const cases = [];
for (let i = 0; i < 400; i++) {
  const pixelCount = pick([1, 2, 3, 5, 12, 40]);
  const pixels = [];
  for (let p = 0; p < pixelCount; p++) {
    const [h, v] = pick(tiles);
    const pixel = [
      h,
      v,
      int(chance(0.1) ? 3100 : 6),
      int(chance(0.1) ? 3100 : 6),
    ];
    pixels.push(pixel);
    if (chance(0.15)) pixels.push([...pixel]); // a repeat
  }
  const cache = {};
  for (const [h, v, col, row] of pixels) {
    const key = `snow_cover:h${String(h).padStart(2, "0")}v${String(v).padStart(2, "0")}:${row}:${col}`;
    if (!(key in cache)) cache[key] = pixelValue();
  }
  const fake = {
    getMany: async (keys) => keys.map((key) => cache[key]),
  };
  const expected = await history.getSnowCoverHistory(fake, pixels);
  // `undefined` does not survive JSON: leave such keys out.
  const stored = Object.fromEntries(
    Object.entries(cache).filter(([, value]) => value !== undefined),
  );
  cases.push({ pixels, cache: stored, expected });
}

// Constructed: 23 of 40 pixels measured on a day, where (23 / 40) * 100 and (23 * 100) / 40 round
// differently; and pixels on the edge of the tile.
{
  const pixels = [];
  const cache = {};
  for (let i = 0; i < 40; i++) {
    const pixel = [12, 4, i, 7];
    pixels.push(pixel);
    cache[`snow_cover:h12v04:7:${i}`] = [
      {
        year: 2020,
        data:
          i < 23
            ? [
                [50 + (i % 7), 0],
                [60, 0],
              ]
            : [
                [301, 0],
                [40, 0],
              ],
      },
    ];
  }
  const fake = { getMany: async (keys) => keys.map((key) => cache[key]) };
  cases.push({
    pixels,
    cache,
    expected: await history.getSnowCoverHistory(fake, pixels),
  });
}
for (const [row, col] of [
  [2999, 2999],
  [3000, 0],
  [0, 3000],
  [0, 0],
  [2999, 0],
]) {
  const pixels = [[12, 4, col, row]];
  const key = `snow_cover:h12v04:${row}:${col}`;
  const cache = { [key]: [yearEntry(2020)] };
  const fake = { getMany: async (keys) => keys.map((k) => cache[k]) };
  cases.push({
    pixels,
    cache,
    expected: await history.getSnowCoverHistory(fake, pixels),
  });
}

const generated =
  JSON.stringify({ weeks, cases }, null, 0).replace(/\},\{"/g, '},\n{"') + "\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-snow-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("snow_vectors.json is up to date");
} else {
  writeFileSync(outPath, generated);
  const nonEmpty = cases.filter((c) => c.expected.length > 0).length;
  console.log(
    `Wrote ${weeks.length} weeks, ${cases.length} cases (${nonEmpty} with a history)`,
  );
}
