#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-out/tests/metadata_vectors.json`: `metadata.json` as the real
 * TypeScript `MetadataCollector` writes it, for random sets of features.
 *
 * Each case records what the collector is fed -- the fields of each ski area it reads, the
 * per-feature inclined length of each run and lift (which the real `getRunElevationData` /
 * `getLiftElevationData` derive from elevation, a stage not yet ported, so they are inputs
 * here) -- the options, a fixed clock, and the exact text `metadata.json` comes out as.
 *
 * The clock is faked because the collector stamps `finishedAt` with `new Date()`. Start times
 * are chosen so the duration lands on half seconds, where `Math.round` of a negative number
 * rounds towards +infinity.
 *
 * Usage: node rust/codegen/generate-metadata-vectors.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./tooling.mjs";
import { chance, int, pick, reseed } from "./osm-worlds.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-out/tests/metadata_vectors.json",
);
const dist = (p) => import(join(repoRoot, "dist", p));
const { MetadataCollector } = await dist("statistics/DatasetMetadata.js");
const {
  FeatureType,
  getRunElevationData,
  getLiftElevationData,
  extractPointsForElevationProfile,
  Status,
  SkiAreaActivity,
} = await import("openskidata-format");

reseed(20261103);

const RealDate = Date;
function withClock(ms, fn) {
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(ms);
      else super(...args);
    }
    static now() {
      return ms;
    }
  };
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

const STATUSES = [...Object.values(Status), null];
const ACTIVITIES = Object.values(SkiAreaActivity);
const COUNTRIES = ["AT", "FR", "JP", "US", "CH", "NO", "XK", ""];

function skiArea() {
  return {
    status: pick(STATUSES),
    activities: ACTIVITIES.filter(() => chance(0.5)),
    countries: Array.from({ length: int(4) }, () => pick(COUNTRIES)),
  };
}

/** A 3D line with an elevation profile, so the real `getRunElevationData` has a length. */
function elevated() {
  const n = 2 + int(5);
  let lng = 7 + int(100) / 10;
  let lat = 45 + int(100) / 10;
  let z = 1500 + int(1500);
  const coordinates = [];
  for (let i = 0; i < n; i++) {
    coordinates.push([lng, lat, z]);
    lng += (int(40) + 1) / 5000;
    lat += (int(40) - 10) / 5000;
    z -= int(80);
  }
  return coordinates;
}

function run() {
  if (!chance(0.7)) return { length: null };
  const coordinates = elevated().map(([lng, lat]) => [lng, lat]);
  const geometry = { type: "LineString", coordinates };
  const target = pick([50, 100, 250, 1000]);
  const { geometry: sampled, resolutionInMeters } =
    extractPointsForElevationProfile(geometry, target);
  let z = 1500 + int(1500);
  const heights = sampled.coordinates.map(() => (z -= int(60) - 15));
  const feature = {
    type: "Feature",
    geometry,
    properties: {
      type: FeatureType.Run,
      elevationProfile: {
        heights,
        resolution: resolutionInMeters,
        targetResolution: target,
      },
    },
  };
  let data = null;
  try {
    data = getRunElevationData(feature);
  } catch {
    return { length: null };
  }
  return { length: data?.inclinedLengthInMeters ?? null, feature };
}

function lift() {
  if (!chance(0.7)) return { length: null };
  const feature = {
    type: "Feature",
    geometry: { type: "LineString", coordinates: elevated() },
    properties: { type: FeatureType.Lift, stations: [] },
  };
  let data = null;
  try {
    data = getLiftElevationData(feature);
  } catch {
    return { length: null };
  }
  return { length: data?.inclinedLengthInMeters ?? null, feature };
}

function iso(ms) {
  return new RealDate(ms).toISOString();
}

function options(finishedMs) {
  // Whole seconds, half seconds, and sub-second noise either side of "now", sometimes after it.
  const offset =
    pick([0, 500, 1500, 1000, 7, 123456, 3600500]) * pick([1, 1, -1]);
  const startedAt = pick([
    null,
    "not a date",
    "",
    iso(finishedMs - offset),
    iso(finishedMs - offset)
      .replace(".", ".0")
      .replace("Z", "Z"),
  ]);
  const size = () => (chance(0.2) ? undefined : int(200000000));
  const group = () =>
    Object.fromEntries(
      ["skiAreas", "runs", "lifts", "spots"]
        .map((k) => [k, size()])
        .filter(([, v]) => v !== undefined),
    );
  return {
    formatVersion: pick(["13.0.0", "16.0.0"]),
    bbox: pick([
      null,
      [132.34, 34.78, 132.4, 34.84],
      [-125, 49, -115, 52],
      [0, 0, 1, 1],
    ]),
    startedAt,
    openStreetMapDataTimestamp: pick([null, "2026-08-22T19:36:10Z"]),
    skiMapOrgDownloadedAt: pick([null, "2026-08-22T20:05:31.000Z"]),
    files: {
      geojson: group(),
      csv: group(),
      geoPackage: pick([null, int(900000000)]),
    },
  };
}

const cases = [];
for (let n = 0; n < 300; n++) {
  const skiAreas = Array.from({ length: n % 7 === 0 ? 0 : int(12) }, skiArea);
  const runs = Array.from({ length: int(25) }, run);
  const lifts = Array.from({ length: int(15) }, lift);
  const spots = int(20);
  const finishedMs = Date.UTC(
    2026,
    int(12),
    1 + int(28),
    int(24),
    int(60),
    int(60),
    int(1000),
  );
  const opts = options(finishedMs);

  const collector = new MetadataCollector();
  skiAreas.forEach((a) =>
    collector.collector(FeatureType.SkiArea)({
      properties: {
        status: a.status,
        activities: a.activities,
        places: a.countries.map((c) => ({ iso3166_1Alpha2: c })),
      },
    }),
  );
  runs.forEach(
    (r) => r.feature && collector.collector(FeatureType.Run)(r.feature),
  );
  runs
    .filter((r) => !r.feature)
    .forEach(() =>
      collector.collector(FeatureType.Run)({
        geometry: { type: "Point" },
        properties: {},
      }),
    );
  lifts.forEach(
    (l) => l.feature && collector.collector(FeatureType.Lift)(l.feature),
  );
  lifts
    .filter((l) => !l.feature)
    .forEach(() =>
      collector.collector(FeatureType.Lift)({
        geometry: { type: "Point" },
        properties: {},
      }),
    );
  for (let i = 0; i < spots; i++) collector.collector(FeatureType.Spot)({});

  const expected = withClock(
    finishedMs,
    () => JSON.stringify(collector.metadata(opts), null, 2) + "\n",
  );
  cases.push({
    skiAreas,
    runs: runs.map((r) => r.length),
    lifts: lifts.map((l) => l.length),
    spots,
    options: opts,
    finishedAt: iso(finishedMs),
    expected,
  });
}

const generated =
  '{"cases":[\n' + cases.map((c) => JSON.stringify(c)).join(",\n") + "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-metadata-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("metadata_vectors.json is up to date");
} else {
  writeFileSync(outPath, generated);
  const withLength = cases.filter((c) => c.runs.some((l) => l !== null)).length;
  console.log(
    `Wrote ${cases.length} cases (${withLength} with elevation lengths)`,
  );
}
