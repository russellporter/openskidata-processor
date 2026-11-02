#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-pipeline/tests/download_vectors.json`: what the real TypeScript
 * download step builds and decides, for the Rust download step to reproduce.
 *
 * - the five Overpass queries (and the URL each is fetched from) for a set of bounding boxes,
 *   including ones with longitudes outside [-180, 180), awkward numbers and a box that is not
 *   2D (which throws);
 * - which of a set of points turf's `booleanContains(bboxPolygon(bbox), point)` keeps, with
 *   points on the box's edges and corners, and boxes whose west edge is east of the east edge;
 * - `readOSMDataTimestamp` on file heads of several shapes, and `earliestTimestamp`;
 * - the text `writeDownloadMetadata` writes.
 *
 * Usage: node rust/codegen/generate-download-vectors.mjs [--check]
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "./tooling.mjs";
import { chance, int, pick, reseed } from "./osm-worlds.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-pipeline/tests/download_vectors.json",
);
const dist = (p) => import(join(repoRoot, "dist", p));
const urls = await dist("io/DownloadURLs.js");
const meta = await dist("io/DownloadMetadata.js");
const { default: bboxPolygon } = await import("@turf/bbox-polygon");
const { default: booleanContains } = await import("@turf/boolean-contains");

reseed(20261104);

// ---------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------

const awkward = [
  0.1 + 0.2,
  1e-7,
  1e21,
  -0,
  123456789.123456789,
  5e-324,
  0.000001,
];
const bboxes = [
  null,
  [132.34, 34.78, 132.4, 34.84],
  [-125, 49, -115, 52],
  [190, -10, 200, 10],
  [-200, -10, -170, 10],
  [-190, 0, 540, 1],
  [180, -90, 180, 90],
  [awkward[0], awkward[1], awkward[3], awkward[4]],
  [awkward[2], awkward[5], awkward[6], 1],
  [1, 2, 3],
  [1, 2, 3, 4, 5, 6],
];
for (let i = 0; i < 25; i++) {
  const w = (int(7200) - 3600) / 10 + int(1000) / 1e7;
  const s = (int(1600) - 800) / 10 + int(1000) / 1e7;
  bboxes.push([w, s, w + int(100) / 10 + 0.001, s + int(50) / 10 + 0.001]);
}

const endpoint = "https://lz4.overpass-api.de/api/interpreter";
const queries = bboxes.map((bbox) => {
  const entry = { bbox };
  try {
    entry.queries = {
      runs: urls.runsDownloadConfig.query(bbox),
      lifts: urls.liftsDownloadConfig.query(bbox),
      skiAreas: urls.skiAreasDownloadConfig.query(bbox),
      skiAreaSites: urls.skiAreaSitesDownloadConfig.query(bbox),
      spots: urls.spotsDownloadConfig.query(bbox),
    };
    entry.urls = Object.fromEntries(
      Object.entries(entry.queries).map(([k, q]) => [
        k,
        endpoint + "?data=" + encodeURIComponent(q),
      ]),
    );
  } catch (error) {
    entry.error = error.message;
  }
  return entry;
});

// ---------------------------------------------------------------------------------------
// URI encoding, beyond the queries' characters
// ---------------------------------------------------------------------------------------

const uriInputs = [
  "",
  "abc XYZ 019 -_.!~*'()",
  '[]{};:,<>="#%&+/?@\\^`|$',
  "héllo wörld ✓ 日本 😀",
  "line\nbreak\ttab",
];
const uri = uriInputs.map((text) => ({
  text,
  encoded: encodeURIComponent(text),
}));

// ---------------------------------------------------------------------------------------
// Skimap bounding box filter
// ---------------------------------------------------------------------------------------

const containment = [];
for (let i = 0; i < 60; i++) {
  const flipped = chance(0.15);
  const w = int(40) - 20;
  const s = int(40) - 20;
  const bbox = flipped
    ? [w + 10, s + 10, w, s]
    : [w, s, w + 1 + int(10), s + 1 + int(10)];
  const xs = [bbox[0], bbox[2], (bbox[0] + bbox[2]) / 2, bbox[0] + 0.5];
  const ys = [bbox[1], bbox[3], (bbox[1] + bbox[3]) / 2, bbox[1] + 0.5];
  const points = [];
  for (let k = 0; k < 14; k++) {
    points.push(
      chance(0.5)
        ? [pick(xs), pick(ys)]
        : [int(60) - 25 + int(10) / 10, int(60) - 25 + int(10) / 10],
    );
  }
  const polygon = bboxPolygon(bbox);
  containment.push({
    bbox,
    points,
    inside: points.map((point) =>
      booleanContains(polygon, {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: point },
      }),
    ),
  });
}

// ---------------------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), "download-vectors-"));
const heads = [
  '{"version":0.6,"generator":"Overpass API","osm3s":{"timestamp_osm_base":"2026-11-02T10:11:12Z","copyright":"x"},"elements":[]}',
  '{\n  "version": 0.6,\n  "osm3s": {\n    "timestamp_osm_base" :\n "2026-11-02T10:00:00Z"\n  }\n}',
  '{"osm3s":{"timestamp_osm_base":"2026-11-02T09:59:59Z"}}',
  '{"elements":[]}',
  '{"timestamp_osm_base": 5}',
  '{"osm3s":{"timestamp_osm_base":"not a date"}}',
  '{"osm3s":{"timestamp_osm_base":"2026-11-02T10:11:12.345Z"}}',
  '{"osm3s":{"timestamp_osm_base":"unterminated',
  "",
  "é".repeat(2100) + '"timestamp_osm_base":"2026-01-01T00:00:00Z"',
  // Straddling the 4096 byte limit: found when the value ends inside it, not when it is cut.
  "é".repeat(2010) + '"timestamp_osm_base":"2026-01-01T00:00:00Z"',
  "é".repeat(2040) + '"timestamp_osm_base":"2026-01-01T00:00:00Z"',
  "a".repeat(4040) + '"timestamp_osm_base":"2026-01-01T00:00:00Z"',
];
const timestamps = [];
for (let i = 0; i < heads.length; i++) {
  const path = join(dir, `head-${i}.json`);
  writeFileSync(path, heads[i]);
  timestamps.push({
    head: heads[i],
    timestamp: await meta.readOSMDataTimestamp(path),
  });
}
const earliest = [];
const pool = [
  "2026-11-02T10:11:12Z",
  "2026-11-02T09:59:59Z",
  "2026-11-02T10:11:12.345Z",
  "2025-12-31T23:59:59Z",
  "not a date",
  null,
  "2026-11-02T12:00:00+02:00",
];
for (let i = 0; i < 40; i++) {
  const n = int(5);
  const input = Array.from({ length: n }, () => pick(pool));
  earliest.push({ input, expected: meta.earliestTimestamp(input) });
}

const metadataFolder = mkdtempSync(join(tmpdir(), "download-meta-"));
const metadataTexts = [];
for (const [startedAt, dataTimestamp, downloadedAt] of [
  [
    "2026-11-02T10:00:00.000Z",
    "2026-11-02T09:59:59.000Z",
    "2026-11-02T10:05:00.123Z",
  ],
  ["2026-11-02T10:00:00.000Z", null, "2026-11-02T10:05:00.123Z"],
]) {
  await meta.writeDownloadMetadata(metadataFolder, {
    startedAt,
    openStreetMap: { dataTimestamp },
    skiMapOrg: { downloadedAt },
  });
  metadataTexts.push({
    startedAt,
    dataTimestamp,
    downloadedAt,
    text: readFileSync(meta.getDownloadMetadataPath(metadataFolder), "utf8"),
  });
}

const generated =
  JSON.stringify(
    {
      queries,
      uri,
      containment,
      timestamps,
      earliest,
      metadata: metadataTexts,
    },
    null,
    1,
  ) + "\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-download-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("download_vectors.json is up to date");
} else {
  writeFileSync(outPath, generated);
  console.log(
    `Wrote ${queries.length} bboxes, ${containment.length} containment sets (${containment.reduce((a, c) => a + c.inside.filter(Boolean).length, 0)} inside)`,
  );
}
