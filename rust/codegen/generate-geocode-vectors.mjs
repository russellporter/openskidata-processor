#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-enrich/tests/geocode_vectors.json` from the real `Geocoder` and
 * `GeoTransforms`: how a Photon or Who's On First response becomes a place (`enhance`), and
 * which points `extractPointsAlongGeometry` samples along a geometry for geocoding.
 *
 * The Photon responses use country and region names from the very dataset the geocoder reads,
 * mixed with names that match nothing, empty and missing fields, and a second feature (of which
 * only the first is read).
 *
 * Requires a build (`npm run build`). Usage: node rust/codegen/generate-geocode-vectors.mjs [--check]
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { repoRoot } from "./tooling.mjs";
import { chance, int, pick, reseed } from "./osm-worlds.mjs";

const require = createRequire(join(repoRoot, "package.json"));
const iso3166 = require("iso3166-2-db");
iso3166.changeNameProvider("osm");
const dataset = iso3166.getDataSet();
const COUNTRY_CODES = Object.keys(dataset);

const dist = (p) => import(join(repoRoot, "dist", p));
const Geocoder = (await dist("transforms/Geocoder.js")).default;
const { extractPointsAlongGeometry } = await dist(
  "transforms/GeoTransforms.js",
);
const { getPostgresTestConfig } = await dist("Config.js");

const outPath = join(
  repoRoot,
  "rust/crates/osd-enrich/tests/geocode_vectors.json",
);
reseed(20261108);

// The geocoders are only asked to interpret responses; nothing connects to anything.
const config = (type) => ({
  url: "http://geocoder.invalid",
  type,
  cacheTTL: 1,
});
const photon = new Geocoder(config("photon"), getPostgresTestConfig());
const whosOnFirst = new Geocoder(
  config("geocode-api"),
  getPostgresTestConfig(),
);
const quiet = (fn) => {
  const { log, error, warn, assert } = console;
  console.log = console.error = console.warn = console.assert = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { log, error, warn, assert });
  }
};

const maybe = (p, value) => (chance(p) ? value : undefined);
const text = () =>
  pick([
    "Innsbruck",
    "Zürich",
    "Ålesund",
    "",
    "Niseko",
    "札幌市",
    "Tirol",
    "St. Anton",
  ]);

function photonProperties() {
  const code = pick([
    ...COUNTRY_CODES,
    ...COUNTRY_CODES,
    "XK",
    "ZZ",
    "",
    undefined,
    null,
  ]);
  const country = dataset[code];
  const regionName = () => {
    if (country && country.regions.length > 0 && chance(0.7)) {
      return pick(country.regions).name;
    }
    return pick([text(), undefined, null, ""]);
  };
  return {
    countrycode: code,
    country: maybe(0.5, text()),
    state: maybe(0.7, regionName()),
    county: maybe(0.5, regionName()),
    city: maybe(0.8, pick([text(), null])),
  };
}

const cases = [];

for (let n = 0; n < 1500; n++) {
  const features = chance(0.1)
    ? []
    : Array.from({ length: chance(0.05) ? 2 : 1 }, () => ({
        type: "Feature",
        properties: photonProperties(),
        geometry: { type: "Point", coordinates: [0, 0] },
      }));
  const raw = {
    url: "u",
    timestamp: 1,
    response: { type: "FeatureCollection", features },
  };
  cases.push({
    kind: "photon",
    raw,
    expected: quiet(() => photon.enhance(structuredClone(raw))) ?? null,
  });
}

for (let n = 0; n < 700; n++) {
  const geometries = Array.from({ length: int(6) }, () => ({
    id: int(1e6),
    name: text(),
    placetype: pick([
      "country",
      "region",
      "locality",
      "locality",
      "county",
      "borough",
    ]),
    iso_code: maybe(0.7, pick(["AT", "AT-7", "", "US", "XK", "US-CO"])),
    name_eng: maybe(0.5, pick([text(), null])),
  }));
  const raw = { url: "u", timestamp: 1, response: { geometries } };
  cases.push({
    kind: "wof",
    raw,
    expected: quiet(() => whosOnFirst.enhance(structuredClone(raw))) ?? null,
  });
}

/** A random walk of `n` positions, `step` degrees at a time. */
function walk(n, step) {
  let x = pick([11.3, 142.8, -106, 0, 179.9]) + int(100) / 100;
  let y = pick([47.2, 43.3, 39.6, 0, 60]) + int(100) / 100;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push([x, y]);
    x += (int(1000) / 1000 - 0.4) * step;
    y += (int(1000) / 1000 - 0.5) * step;
  }
  return out;
}
const ring = (n, step) => {
  const line = walk(n, step);
  return [...line, line[0]];
};
const attempt = (fn) => {
  try {
    return { ok: fn() };
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
};

for (let n = 0; n < 1500; n++) {
  const step = pick([0, 0.0005, 0.003, 0.01, 0.05, 0.3]);
  const geometry = pick([
    () => ({ type: "Point", coordinates: walk(1, 0)[0] }),
    () => ({ type: "LineString", coordinates: walk(2 + int(30), step) }),
    () => ({ type: "LineString", coordinates: walk(2, 0) }),
    // Along a meridian or a parallel, where the last sampled point can share the end's
    // longitude or latitude without being the end.
    () => {
      const [x, y] = walk(1, 0)[0];
      const length = pick([0.004, 0.0123, 0.05, 0.3]);
      return {
        type: "LineString",
        coordinates: [
          [x, y],
          [x, y + length / 2],
          [x, y + length],
        ],
      };
    },
    () => {
      const [x, y] = walk(1, 0)[0];
      const length = pick([0.004, 0.0123, 0.05, 0.3]);
      return {
        type: "LineString",
        coordinates: [
          [x, y],
          [x + length / 2, y],
          [x + length, y],
        ],
      };
    },
    () => ({
      type: "MultiLineString",
      coordinates: Array.from({ length: 1 + int(3) }, () =>
        walk(2 + int(10), step),
      ),
    }),
    () => ({
      type: "Polygon",
      coordinates: [ring(3 + int(12), step), ring(4, step / 3)],
    }),
    () => ({
      type: "MultiPolygon",
      coordinates: Array.from({ length: 1 + int(3) }, () => [
        ring(3 + int(8), step),
      ]),
    }),
    () => ({ type: "LineString", coordinates: walk(1, 0) }),
    () => ({ type: "MultiLineString", coordinates: [walk(1, 0)] }),
  ])();
  const interval = pick([1, 1, 1, 0.5, 2]);
  cases.push({
    kind: "points",
    geometry,
    interval,
    expected: attempt(() =>
      extractPointsAlongGeometry(structuredClone(geometry), interval),
    ),
  });
}

// The requests the real client makes: what a server is asked, for each kind and position.
{
  const asked = [];
  const server = createServer((request, response) => {
    asked.push(request.url);
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        type: "FeatureCollection",
        features: [],
        geometries: [],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/geo`;
  for (const type of ["photon", "geocode-api"]) {
    const geocoder = new Geocoder(
      { url, type, cacheTTL: 1e12 },
      getPostgresTestConfig(),
    );
    await geocoder.initialize();
    for (let n = 0; n < 200; n++) {
      const position = [int(36000) / 100 - 180, int(18000) / 100 - 90].map(
        (v) => v + int(1000) / 1e7,
      );
      const before = asked.length;
      await quiet(() => geocoder.rawGeocode(position));
      cases.push({
        kind: "url",
        type,
        position,
        expected: asked.slice(before),
      });
    }
    await geocoder.close();
  }
  server.close();
}

const generated =
  '{"cases":[\n' + cases.map((c) => JSON.stringify(c)).join(",\n") + "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-geocode-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("geocode_vectors.json is up to date");
} else {
  writeFileSync(outPath, generated);
  const tally = {};
  for (const c of cases) tally[c.kind] = (tally[c.kind] ?? 0) + 1;
  const nulls = cases.filter((c) => c.expected === null).length;
  console.log(`Wrote ${cases.length} cases`, tally, `(${nulls} with no place)`);
}
process.exit(0);
