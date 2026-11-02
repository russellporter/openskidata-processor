#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-normalize/tests/merge_vectors.json` by running randomised
 * run property sets through the real `mergedProperties` (`RunJoining.ts`).
 *
 * The merge is a collection of per-field reducers -- priority tables for difficulty and
 * grooming, tri-state booleans, order-preserving de-duplication, name joining -- and each
 * is easy to get subtly wrong (which side wins a tie, whether `null` outranks `false`).
 * Recording the live output beats writing expectations by hand.
 *
 * Also records `isPartOfSameRun`, the comparison that decides whether two segments are
 * joined: it ignores a fixed set of top-level keys and deep-compares the rest.
 *
 * Build first (`npm run build`). Usage: node rust/codegen/generate-merge-vectors.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "./tooling.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-normalize/tests/merge_vectors.json",
);
const { mergedProperties, isPartOfSameRun } = await import(
  join(repoRoot, "dist/transforms/normalization/RunJoining.js")
);
const f = await import("openskidata-format");

let seed = 987654321;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const int = (n) => Math.floor(random() * n);
const pick = (items) => items[int(items.length)];
const subset = (items, max) => {
  const chosen = items.filter(() => random() < 0.4);
  return chosen.slice(0, max);
};

const uses = Object.values(f.RunUse);
const difficulties = [...Object.values(f.RunDifficulty), null];
const conventions = Object.values(f.RunDifficultyConvention);
const groomings = [...Object.values(f.RunGrooming), null];
const statuses = Object.values(f.Status);
const tri = [true, false, null];
const texts = [
  null,
  null,
  "A",
  " A ",
  "B",
  "",
  "   ",
  "A, B",
  "Piste Noire",
  " A ",
  "﻿B",
];
const sourcePool = [
  { type: "openstreetmap", id: "way/1" },
  { type: "openstreetmap", id: "way/2" },
  { type: "openstreetmap", id: "relation/1" },
  { type: "skimap.org", id: "way/1" },
];
const skiAreaPool = ["a", "b", "c"].map((id) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [1, 2] },
  properties: {
    type: "skiArea",
    id,
    name: "Area " + id,
    activities: ["downhill"],
    status: "operating",
  },
}));
const place = (country, iso2, locality) => ({
  iso3166_1Alpha2: country,
  iso3166_2: iso2,
  localized: { en: { country, region: null, locality } },
});
const placePool = [
  place("AT", "AT-7", "Kitzbühel"),
  place("AT", "AT-7", "Kitzbühel"),
  place("AT", null, "Kitzbühel"),
  place("AT", "AT-7", null),
  place("DE", "DE-BY", "Garmisch"),
];
const websitePool = [
  "https://a.example",
  "https://b.example",
  "",
  "https://a.example",
];

let nextId = 0;
function randomProperties() {
  return {
    type: "run",
    uses: subset(uses, 4).length ? subset(uses, 4) : [pick(uses)],
    id: "run-" + nextId++,
    name: pick(texts),
    ref: pick(texts),
    description: pick(texts),
    difficulty: pick(difficulties),
    difficultyConvention: pick(conventions),
    status: pick(statuses),
    oneway: pick(tri),
    lit: pick(tri),
    gladed: pick(tri),
    patrolled: pick(tri),
    snowmaking: pick(tri),
    snowfarming: pick(tri),
    tunnel: pick(tri),
    grooming: pick(groomings),
    skiAreas: subset(skiAreaPool, 3),
    elevationProfile:
      random() < 0.3
        ? { heights: [1, 2, 3], resolution: 25, targetResolution: 25 }
        : null,
    sources: subset(sourcePool, 3).concat(
      random() < 0.3 ? [pick(sourcePool)] : [],
    ),
    websites: subset(websitePool, 3),
    wikidataID: pick([null, "", "Q1", "Q2"]),
    places: subset(placePool, 3),
    viewportHint: {
      center: [int(5), int(5)],
      bearing: pick([null, 10, 20]),
      rotatedWidthMeters: 100 + int(3),
      rotatedHeightMeters: 50,
      minCameraY: 0.5,
    },
  };
}

const merges = [];
for (let n = 0; n < 800; n++) {
  const inputs = Array.from({ length: 1 + int(4) }, randomProperties);
  merges.push({ inputs, expected: mergedProperties(inputs) });
}

// Comparison: pairs that differ in one field, in an ignored field, or not at all.
const comparisons = [];
const ignored = [
  "id",
  "sources",
  "skiAreas",
  "elevationProfile",
  "places",
  "viewportHint",
];
const comparable = [
  "uses",
  "name",
  "ref",
  "description",
  "difficulty",
  "difficultyConvention",
  "status",
  "oneway",
  "lit",
  "gladed",
  "patrolled",
  "snowmaking",
  "snowfarming",
  "tunnel",
  "grooming",
  "websites",
  "wikidataID",
];
for (let n = 0; n < 400; n++) {
  const left = randomProperties();
  const right = structuredClone(left);
  right.id = "other";
  const mode = int(4);
  if (mode === 1) {
    const key = pick(ignored);
    right[key] = randomProperties()[key];
  } else if (mode === 2) {
    const key = pick(comparable);
    right[key] = randomProperties()[key];
  } else if (mode === 3) {
    // key order differs, which must not matter
    const entries = Object.entries(right).reverse();
    for (const key of Object.keys(right)) delete right[key];
    for (const [k, v] of entries) right[k] = v;
  }
  comparisons.push({
    left,
    right,
    expected: isPartOfSameRun({ properties: left }, { properties: right }),
  });
}

const generated =
  '{"merges":[\n' +
  merges.map((c) => JSON.stringify(c)).join(",\n") +
  '\n],"comparisons":[\n' +
  comparisons.map((c) => JSON.stringify(c)).join(",\n") +
  "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-merge-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("merge vectors are up to date");
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  const same = comparisons.filter((c) => c.expected).length;
  console.log(
    `Wrote ${merges.length} merges and ${comparisons.length} comparisons (${same} equal)`,
  );
}
