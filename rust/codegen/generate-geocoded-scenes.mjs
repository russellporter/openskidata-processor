#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-pipeline/tests/geocoded_scenes.json`: the real TypeScript
 * `prepare` run with a geocoder, on a sample of the worlds in `cluster_scenes.json`, so the
 * `places` of every run, lift, spot and ski area -- the geocoding of each geometry, the
 * ski areas' places collected from their members, the centroid fallback, the ordering by
 * `localeCompare` -- are checked end to end.
 *
 * The geocoder is a local HTTP server that answers like Photon, with a response that is a
 * fixed function of the one-hundred-metre geohash cell asked about (`mockPhoton`). The Rust test
 * computes the same function in-process. Cities are chosen to include a composed and a
 * decomposed "Zürich", which compare equal without being the same string.
 *
 * Requires PostgreSQL with PostGIS (`pg_ctlcluster 16 main start`) and a build
 * (`npm run build`). Usage: node rust/codegen/generate-geocoded-scenes.mjs [--check]
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import geohash from "ngeohash";
import { repoRoot } from "./tooling.mjs";

const require = createRequire(join(repoRoot, "package.json"));
const iso3166 = require("iso3166-2-db");
iso3166.changeNameProvider("osm");
const dataset = iso3166.getDataSet();

const clusterPath = join(
  repoRoot,
  "rust/crates/osd-cluster/tests/cluster_scenes.json",
);
const outPath = join(
  repoRoot,
  "rust/crates/osd-pipeline/tests/geocoded_scenes.json",
);
const dist = (p) => import(join(repoRoot, "dist", p));
const { convertOSMToGeoJSON } = await dist("io/OSMToGeoJSONConverter.js");
const { default: prepare } = await dist("PrepareGeoJSON.js");
const { getPostgresTestConfig } = await dist("Config.js");
const TestHelpers = await dist("TestHelpers.js");

const SAMPLE = 30;

const COUNTRIES = ["AT", "CH", "FR", "DE", "IT", "JP", "US", "XK", "ZZ", "NO"];
const CITIES = [
  "Innsbruck",
  "Zürich",
  "Zürich",
  "Ålesund",
  "Chamonix",
  "Niseko",
  "St. Anton",
  "Sankt Anton",
  "Aspen",
  "Bariloche",
  "Vail",
  "Åre",
];

/** The Photon response for a cell: a function of the cell's 30 bits alone. */
export function mockPhoton(h) {
  const features = [];
  if (h % 17 !== 0) {
    const code = COUNTRIES[h % COUNTRIES.length];
    const regions = dataset[code]?.regions ?? [];
    const properties = { countrycode: code };
    if (regions.length > 0 && h % 5 !== 0) {
      properties.state = regions[(h >> 3) % regions.length].name;
    } else if (regions.length > 0 && h % 7 === 0) {
      properties.county = regions[(h >> 4) % regions.length].name;
    }
    if (h % 3 !== 0) properties.city = CITIES[(h >> 2) % CITIES.length];
    features.push({
      type: "Feature",
      properties,
      geometry: { type: "Point", coordinates: [0, 0] },
    });
  }
  return { type: "FeatureCollection", features };
}

const alphabet = "0123456789bcdefghjkmnpqrstuvwxyz";
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const cell = geohash.encode(
    Number(url.searchParams.get("lat")),
    Number(url.searchParams.get("lon")),
    6,
  );
  let bits = 0;
  for (const c of cell) bits = bits * 32 + alphabet.indexOf(c);
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(mockPhoton(bits)));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const geocodingUrl = `http://127.0.0.1:${server.address().port}/`;

const { scenes } = JSON.parse(readFileSync(clusterPath, "utf8"));
const step = scenes.length / SAMPLE;
const picked = Array.from(
  { length: SAMPLE },
  (_, i) => scenes[Math.floor(i * step)],
);

function silenced(fn) {
  const { log, warn, error } = console;
  console.log = console.warn = console.error = () => {};
  return fn().finally(() => Object.assign(console, { log, warn, error }));
}

const results = [];
for (const [n, scene] of picked.entries()) {
  const { roles } = scene;
  const paths = TestHelpers.getFilePaths();
  const convert = (elements) => convertOSMToGeoJSON({ elements }).features;
  TestHelpers.mockInputFiles(
    {
      skiMapSkiAreas: roles.skimap,
      openStreetMapSkiAreas: convert(roles.skiAreas),
      openStreetMapSkiAreaSites: roles.sites,
      lifts: convert(roles.lifts),
      runs: convert(roles.runs),
      spots: convert(roles.spots),
    },
    paths.input,
  );
  await silenced(() =>
    prepare(paths, {
      elevationServer: null,
      bbox: null,
      geocodingServer: { url: geocodingUrl, type: "photon", cacheTTL: 1e12 },
      workingDir: TestHelpers.getTempWorkingDir(),
      osmInputDir: null,
      outputDir: TestHelpers.getTempWorkingDir(),
      snowCover: null,
      tiles: null,
      postgresCache: getPostgresTestConfig(),
    }),
  );
  const read = (path) => TestHelpers.fileContents(path).features;
  results.push({
    roles,
    expected: {
      skiAreas: read(paths.output.skiAreas),
      runs: read(paths.output.runs),
      lifts: read(paths.output.lifts),
      spots: read(paths.output.spots),
    },
  });
  process.stderr.write(`\r${n + 1}/${SAMPLE}`);
}
process.stderr.write("\n");
server.close();

const generated =
  '{"scenes":[\n' +
  results.map((r) => JSON.stringify(r)).join(",\n") +
  "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-geocoded-scenes.mjs`,
    );
    process.exit(1);
  }
  console.log("geocoded_scenes.json is up to date");
} else {
  writeFileSync(outPath, generated);
  const withPlaces = results.reduce(
    (n, r) =>
      n +
      [
        ...r.expected.runs,
        ...r.expected.lifts,
        ...r.expected.spots,
        ...r.expected.skiAreas,
      ].filter((f) => f.properties.places.length > 0).length,
    0,
  );
  console.log(
    `Wrote ${results.length} scenes; ${withPlaces} features have places`,
  );
}
process.exit(0);
