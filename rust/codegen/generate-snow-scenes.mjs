#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-pipeline/tests/snow_scenes.json`: randomised resorts pushed through
 * the real TypeScript `prepare` with snow cover enabled over a snow cover archive seeded with
 * synthetic VIIRS data, and the final `ski_areas` and `runs` recorded -- the `snowCoverHistory` of
 * each run and the `statistics.snowCover` of each ski area, with their per-activity breakdowns.
 *
 * The archive covers every pixel around the world, with some pixels having no data, some partial
 * years, some missing-data codes, so that the pixels of a run differ in what they have.
 *
 * Requires PostgreSQL with PostGIS (`pg_ctlcluster 16 main start`) and a build. Usage:
 * node rust/codegen/generate-snow-scenes.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./tooling.mjs";
import { chance, generate, int, pick, reseed } from "./osm-worlds.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-pipeline/tests/snow_scenes.json",
);
const dist = (p) => import(join(repoRoot, "dist", p));
const { convertOSMToGeoJSON } = await dist("io/OSMToGeoJSONConverter.js");
const { default: prepare } = await dist("PrepareGeoJSON.js");
const { getPostgresTestConfig } = await dist("Config.js");
const { PostgresCache } = await dist("utils/PostgresCache.js");
const { closeSnowCoverCaches } = await dist("utils/snowCoverHistory.js");
const { VIIRSPixelExtractor } = await dist("utils/VIIRSPixelExtractor.js");
const TestHelpers = await dist("TestHelpers.js");

reseed(20261109);

const ORIGINS = [
  [113000000, 472000000],
  [1428000000, 433000000],
  [-1060000000, 396000000],
  [-1200000000, 500000000],
  [70000000, -330000000],
];

function makeScene(dense) {
  const count = 1 + int(2);
  const roles = {
    runs: [],
    lifts: [],
    skiAreas: [],
    sites: [],
    spots: [],
    skimap: [],
  };
  const [ox, oy] = pick(ORIGINS);
  for (let k = 0; k < count; k++) {
    const part = generate({
      wide: false,
      dense,
      origin: [ox + k * pick([30000, 120000]), oy + k * pick([0, 30000])],
      idBase: (k + 1) * 10000,
    });
    for (const key of Object.keys(roles)) roles[key].push(...part[key]);
  }
  return roles;
}

function silenced(fn) {
  const { log, warn, error } = console;
  console.log = console.warn = console.error = () => {};
  return fn().finally(() => Object.assign(console, { log, warn, error }));
}

/** Synthetic weekly data for one pixel: a pure function of its position and the scene's salt. */
function pixelData(salt, tile, row, col) {
  const h = (a) => {
    let x = (a * 2654435761) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0;
    return (x ^ (x >>> 13)) >>> 0;
  };
  const seed = h(
    salt + h(row * 3001 + col) + h(tile.length * 7 + tile.charCodeAt(2)),
  );
  const kind = seed % 10;
  if (kind < 2) return undefined; // not in the archive
  const years =
    kind < 4 ? [2021] : kind < 8 ? [2020, 2021, 2022] : [2019, 2020];
  return years.map((year, y) => ({
    year,
    data: Array.from({ length: 53 }, (_, week) => {
      const r = h(seed + y * 977 + week * 31);
      const snow = r % 11 === 0 ? 301 : r % 13 === 0 ? 400 : (r >>> 4) % 101;
      return [snow, (r >>> 9) % 9 === 0 ? (r >>> 13) % 12 : 0];
    }),
  }));
}

function tileName(h, v) {
  return `h${String(h).padStart(2, "0")}v${String(v).padStart(2, "0")}`;
}

async function record(roles, salt) {
  const paths = TestHelpers.getFilePaths();
  const convert = (elements) => convertOSMToGeoJSON({ elements }).features;
  const runFeatures = convert(roles.runs);
  TestHelpers.mockInputFiles(
    {
      skiMapSkiAreas: roles.skimap,
      openStreetMapSkiAreas: convert(roles.skiAreas),
      openStreetMapSkiAreaSites: roles.sites,
      lifts: convert(roles.lifts),
      runs: runFeatures,
      spots: convert(roles.spots),
    },
    paths.input,
  );

  // Every pixel around the resort, so that whatever the final runs cover has data or not.
  const xs = [];
  const ys = [];
  for (const feature of [...runFeatures, ...convert(roles.lifts)]) {
    const walk = (c) =>
      typeof c[0] === "number"
        ? (xs.push(c[0]), ys.push(c[1]))
        : c.forEach(walk);
    walk(feature.geometry.coordinates);
  }
  const pad = 0.01;
  const [w, s, e, n] = [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) + pad,
    Math.max(...ys) + pad,
  ];
  const extractor = new VIIRSPixelExtractor();
  const pixels = extractor.getGeometryPixelCoordinates({
    type: "Polygon",
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  });
  const cacheConfig = getPostgresTestConfig();
  const archive = new PostgresCache("snow_cover", cacheConfig, 0);
  await archive.initialize();
  const entries = {};
  for (const [h, v, col, row] of pixels) {
    const tile = tileName(h, v);
    const value = pixelData(salt, tile, row, col);
    if (value !== undefined)
      entries[`snow_cover:${tile}:${row}:${col}`] = value;
  }
  await archive.setMany(
    Object.entries(entries).map(([key, value]) => ({ key, value })),
  );

  await prepare(paths, {
    elevationServer: null,
    bbox: null,
    geocodingServer: null,
    workingDir: TestHelpers.getTempWorkingDir(),
    osmInputDir: null,
    outputDir: TestHelpers.getTempWorkingDir(),
    snowCover: { fetchPolicy: "none" },
    tiles: null,
    postgresCache: cacheConfig,
  });
  await closeSnowCoverCaches();
  await archive.close();
  const read = (path) => TestHelpers.fileContents(path).features;
  return {
    archive: entries,
    expected: {
      skiAreas: read(paths.output.skiAreas),
      runs: read(paths.output.runs),
    },
  };
}

const scenes = [];
for (let i = 0; i < 24; i++) {
  const roles = makeScene(i % 3 === 0);
  const salt = 1000 + i;
  const { archive, expected } = await silenced(() => record(roles, salt));
  scenes.push({ roles, archive, expected });
}

const generated =
  '{"scenes":[\n' + scenes.map((s) => JSON.stringify(s)).join(",\n") + "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-snow-scenes.mjs`,
    );
    process.exit(1);
  }
  console.log("snow_scenes.json is up to date");
} else {
  writeFileSync(outPath, generated);
  const withHistory = scenes.reduce(
    (a, s) =>
      a + s.expected.runs.filter((r) => r.properties.snowCoverHistory).length,
    0,
  );
  const withStats = scenes.reduce(
    (a, s) =>
      a +
      s.expected.skiAreas.filter((r) => r.properties.statistics?.snowCover)
        .length,
    0,
  );
  console.log(
    `Wrote ${scenes.length} scenes; ${withHistory} runs with a history, ${withStats} ski areas with snow statistics`,
  );
}
