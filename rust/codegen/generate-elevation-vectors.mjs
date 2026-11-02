#!/usr/bin/env node
/**
 * Generates `rust/crates/openskidata-format/tests/elevation_vectors.json`: the elevation maths
 * of the real `openskidata-format` package -- `lineChunkPatched`,
 * `extractPointsForElevationProfile`, `getProfileGeometry`, `getAscentAndDescent`,
 * `getPitchData`, `getElevationData`, `getRunElevationData`, `getLiftElevationData` -- run on
 * random lines, with the thrown strings recorded as errors.
 *
 * The lines are random walks at scales from a few centimetres to kilometres per step, at
 * several latitudes, with repeated points, closed loops, all-identical points and lines too
 * short to chunk, because the interesting behaviour is at those edges: the last segment being
 * dropped, chunks of one point, the resolution dividing the line exactly, elevation
 * interpolated across zero-length stretches.
 *
 * Usage: node rust/codegen/generate-elevation-vectors.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./tooling.mjs";
import { chance, int, pick, reseed } from "./osm-worlds.mjs";
import { length as turfLength } from "@turf/length";

const outPath = join(
  repoRoot,
  "rust/crates/openskidata-format/tests/elevation_vectors.json",
);
const f = await import("openskidata-format");

reseed(20261104);

const uniform = () => int(1_000_000) / 1_000_000;

/** A random walk. `z` is added when `withZ`. */
function line({ withZ }) {
  const n = 2 + int(pick([4, 10, 40, 80]));
  const lat0 = pick([0, 47.2, 60.5, -33.4, 85, 36.7, -0.001]);
  let lng = pick([11.3, 142.8, -106, 0, 179.99, -70.3]) + uniform();
  let lat = lat0 + uniform() / 10;
  let z = 800 + int(3000);
  const step = pick([0, 1e-7, 1e-6, 5e-6, 5e-5, 3e-4, 2e-3, 1e-2]);
  const coords = [];
  for (let i = 0; i < n; i++) {
    const c = [lng, lat];
    if (withZ) c.push(z);
    coords.push(c);
    if (!chance(0.1)) {
      lng += (uniform() - 0.4) * step * 2;
      lat += (uniform() - 0.5) * step * 2;
    }
    z += int(80) - 45 + (chance(0.05) ? 400 : 0);
  }
  // Some lines have an elevation on only some of their vertices. Upstream only checks the
  // first, so the rest read as `undefined` and every sum through them is `NaN`.
  if (withZ && chance(0.07)) {
    for (const c of coords.slice(1)) if (chance(0.4)) c.length = 2;
  }
  // A vertex repeated three times in place with an elevation, none, then another: the
  // elevations either side are at distance zero, with a point in between to interpolate.
  if (withZ && coords.length > 2 && chance(0.08)) {
    const k = 1 + int(coords.length - 2);
    const [x, y, z] = coords[k];
    coords.splice(k, 1, [x, y, z], [x, y], [x, y, z + int(40) - 20]);
  }
  const r = uniform();
  if (r < 0.06)
    coords.push([...coords[0]]); // closed loop
  else if (r < 0.1)
    for (const c of coords) {
      c[0] = coords[0][0];
      c[1] = coords[0][1];
    } // one point
  return coords;
}

/** `JSON.stringify` cannot write non-finite numbers; spell them out. */
function encode(_key, value) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    return {
      $nonFinite: Number.isNaN(value)
        ? "NaN"
        : value > 0
          ? "Infinity"
          : "-Infinity",
    };
  }
  return value;
}

function attempt(fn) {
  try {
    return { ok: fn() };
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

const RESOLUTIONS = [1, 5, 10, 25, 25, 25, 50, 100, 250, 1000, 100000];

/** A resolution that cuts the line into at most about 200 pieces, to keep the file small. */
function resolutionFor(coords) {
  const meters = turfLength(
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {},
    },
    { units: "meters" },
  );
  const candidates = RESOLUTIONS.filter((r) => meters / r <= 200);
  return candidates.length ? pick(candidates) : Math.ceil(meters / 100);
}

const cases = [];
const add = (kind, input, expected) => cases.push({ kind, input, expected });

for (let n = 0; n < 750; n++) {
  const withZ = chance(0.7);
  const coords = line({ withZ });
  const geometry = { type: "LineString", coordinates: structuredClone(coords) };
  const res = resolutionFor(coords);

  const clone = () => ({
    type: "LineString",
    coordinates: structuredClone(coords),
  });

  add(
    "chunk",
    { coords, res },
    attempt(() => {
      const { resolutionInMeters, geometry: chunks } = f.lineChunkPatched(
        clone(),
        res,
      );
      return {
        resolution: resolutionInMeters,
        chunks: chunks.map((c) => c.coordinates),
      };
    }),
  );

  add(
    "extract",
    { coords, res },
    attempt(() => {
      const { resolutionInMeters, geometry: g } =
        f.extractPointsForElevationProfile(clone(), res);
      return { resolution: resolutionInMeters, points: g.coordinates };
    }),
  );

  add(
    "ascent",
    { coords },
    attempt(() => f.getAscentAndDescent(clone())),
  );

  if (withZ) {
    const minRes = pick([undefined, 25, 25, 5, 100]);
    const lineMeters = turfLength(
      { type: "Feature", geometry: clone(), properties: {} },
      { units: "meters" },
    );
    if (lineMeters / (minRes ?? 25) > 200) continue;
    add(
      "pitch",
      { coords, minRes: minRes ?? 25 },
      attempt(() => f.getPitchData(clone(), minRes)),
    );
    add(
      "data",
      { coords },
      attempt(() => {
        const { profileGeometry, ...rest } = f.getElevationData(clone());
        return { ...rest, profile: profileGeometry.coordinates };
      }),
    );
  }

  // A profile for the line (valid, or deliberately not).
  const plain = coords.map(([x, y]) => [x, y]);
  const target = pick(
    [5, 25, 25, 100, 500]
      .filter(
        (t) =>
          turfLength(
            {
              type: "Feature",
              geometry: { type: "LineString", coordinates: plain },
              properties: {},
            },
            { units: "meters" },
          ) /
            t <=
          200,
      )
      .concat([100000]),
  );
  const sampled = attempt(() =>
    f.extractPointsForElevationProfile(
      { type: "LineString", coordinates: structuredClone(plain) },
      target,
    ),
  );
  if (sampled.ok) {
    const count = sampled.ok.geometry.coordinates.length;
    const wrong = pick([0, 0, 0, 0, 1, -1]);
    const heights = Array.from(
      { length: Math.max(0, count + wrong) },
      (_, i) => 1500 - i * 7 + int(30),
    );
    const resolution =
      sampled.ok.resolutionInMeters * pick([1, 1, 1, 1.0005, 1.01]);
    const profile = { heights, resolution, targetResolution: target };
    const lineIn = () => ({
      type: "LineString",
      coordinates: structuredClone(plain),
    });
    add(
      "profile",
      { coords: plain, profile },
      attempt(() => f.getProfileGeometry(lineIn(), profile).coordinates),
    );
    add(
      "run",
      { coords: plain, profile },
      attempt(() => {
        const data = f.getRunElevationData({
          type: "Feature",
          geometry: lineIn(),
          properties: { elevationProfile: profile },
        });
        if (!data) return null;
        const { profileGeometry, ...rest } = data;
        return { ...rest, profile: profileGeometry.coordinates };
      }),
    );
  }

  if (withZ) {
    const stationsOf = () => {
      const stations = [];
      const place = (position) => {
        const c = pick([0, coords.length - 1, int(coords.length)]);
        const base = coords[c];
        const point = chance(0.8)
          ? [base[0], base[1], base[2] + int(30)]
          : [base[0], base[1]];
        stations.push({ position, point });
      };
      if (chance(0.6)) place("bottom");
      if (chance(0.6)) place("top");
      if (chance(0.2)) place("mid");
      return stations;
    };
    const stations = stationsOf();
    const duration = pick([null, 0, 90, 140.5, undefined]);
    const feature = {
      type: "Feature",
      geometry: clone(),
      properties: {
        duration,
        stations: stations.map((s) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: s.point },
          properties: { position: s.position },
        })),
      },
    };
    add(
      "lift",
      { coords, duration: duration ?? null, stations },
      attempt(() => {
        const data = f.getLiftElevationData(feature);
        if (!data) return null;
        const { profileGeometry, ...rest } = data;
        return { ...rest, profile: profileGeometry.coordinates };
      }),
    );
  }
}

const generated =
  '{"cases":[\n' +
  cases.map((c) => JSON.stringify(c, encode)).join(",\n") +
  "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-elevation-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("elevation_vectors.json is up to date");
} else {
  writeFileSync(outPath, generated);
  const errors = cases.filter((c) => c.expected.error).length;
  const kinds = {};
  for (const c of cases) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
  console.log(`Wrote ${cases.length} cases (${errors} errors):`, kinds);
}
