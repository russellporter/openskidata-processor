#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-out/tests/output_vectors.json`: synthetic features run through
 * the real `CSVFormatter` and `MapboxGLFormatter`.
 *
 * The end-to-end scenes cannot reach several branches of these formatters -- there is no
 * geocoding, so no places; names are short; ski area polygons are convex -- so they are fed
 * features built to hit them: places in awkward order and with gaps, names around the
 * 20-character limit, quoted and multi-line descriptions, ski areas with concave polygons
 * whose centroid lies outside them, holes, and multipolygons.
 *
 * Build first (`npm run build`). Usage: node rust/codegen/generate-output-vectors.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "./tooling.mjs";

const outPath = join(repoRoot, "rust/crates/osd-out/tests/output_vectors.json");
const csv = await import(join(repoRoot, "dist/transforms/CSVFormatter.js"));
const mapbox = await import(
  join(repoRoot, "dist/transforms/MapboxGLFormatter.js")
);
const f = await import("openskidata-format");

let seed = 4242;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const int = (n) => Math.floor(random() * n);
const pick = (items) => items[int(items.length)];
const chance = (p) => random() < p;

const hint = {
  center: [11, 47],
  bearing: null,
  rotatedWidthMeters: 1,
  rotatedHeightMeters: 1,
  minCameraY: 0,
};
const place = (country, region, locality, iso2 = null) => ({
  iso3166_1Alpha2: country.slice(0, 2).toUpperCase(),
  iso3166_2: iso2,
  localized: { en: { country, region, locality } },
});
const placePool = [
  place("Austria", "Tyrol", "Kitzbühel"),
  place("Austria", "Tyrol", "Innsbruck"),
  place("Austria", null, "Wien"),
  place("Germany", "Bavaria", null),
  place("Germany", "Bavaria", "Garmisch, Partenkirchen"),
  place("Switzerland", "Valais", "Zermatt"),
  place("Switzerland", "Valais", "Zermatt"),
  place("Éire", "Münster", "Ålesund"),
];
const somePlaces = () => placePool.filter(() => chance(0.4));

const names = [
  null,
  "Short",
  "Exactly Twenty Chars",
  "Exactly Twenty-One Chr",
  "A Rather Long Name (with suffix)",
  "Another Long Name Here (and (nested) parentheses)",
  "Ünïcödé Nåme with accents (x)",
  "Has, comma",
  'Has "quote"',
  "  padded (name)  ",
  "",
  "Resort; with semicolon",
  "Abcdefghijklmnop (x)",
  "Abcdefghijklmnopq (x)",
  "Abcdefghijklmnopqr (x)",
];
const summary = (id, name) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [11, 47] },
  properties: {
    type: "skiArea",
    id,
    name,
    activities: ["downhill"],
    status: "operating",
  },
});
const someSkiAreas = () => {
  const areas = ["a", "b", "c"]
    .filter(() => chance(0.5))
    .map((id) => summary("area-" + id, pick(names)));
  return areas;
};
const sources = () =>
  [
    { type: "openstreetmap", id: "way/12" },
    { type: "openstreetmap", id: "relation/3" },
    { type: "skimap.org", id: "55" },
  ].filter(() => chance(0.6));
const websites = () =>
  ["https://b.example", "https://a.example", "https://c.example,x", ""].filter(
    () => chance(0.4),
  );

const square = (x, y, s) => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
];
// A "C": its centroid falls in the notch, outside the polygon.
const cShape = (x, y, s) => [
  [x, y],
  [x + 3 * s, y],
  [x + 3 * s, y + s],
  [x + s, y + s],
  [x + s, y + 2 * s],
  [x + 3 * s, y + 2 * s],
  [x + 3 * s, y + 3 * s],
  [x, y + 3 * s],
  [x, y],
];
const polygons = () => [
  { type: "Point", coordinates: [11.5, 47.5] },
  { type: "Polygon", coordinates: [square(11, 47, 0.02)] },
  { type: "Polygon", coordinates: [cShape(11, 47, 0.01)] },
  {
    type: "Polygon",
    coordinates: [square(11, 47, 0.04), square(11.01, 47.01, 0.02)],
  },
  {
    type: "Polygon",
    coordinates: [square(11, 47, 0.04), cShape(11.005, 47.005, 0.008)],
  },
  {
    type: "MultiPolygon",
    coordinates: [[square(11, 47, 0.01)], [cShape(11.1, 47.1, 0.01)]],
  },
  {
    type: "MultiPolygon",
    coordinates: [
      [square(11, 47, 0.01)],
      [square(11.2, 47.2, 0.01), square(11.205, 47.205, 0.002)],
    ],
  },
];

function lineGeometry() {
  const x = 11 + random() * 0.01;
  const y = 47 + random() * 0.01;
  return {
    type: "LineString",
    coordinates: [
      [x, y],
      [x + 0.001, y + 0.001 * random()],
    ],
  };
}

function statistics() {
  if (chance(0.3)) return undefined;
  const lengths = () => ({
    count: 1 + int(5),
    lengthInKm: Math.round(random() * 1e4) / 100,
    snowmakingLengthInKm: 0,
    snowfarmingLengthInKm: 0,
  });
  const byActivity = {};
  if (chance(0.7))
    byActivity.downhill = {
      byDifficulty: {
        easy: lengths(),
        intermediate: lengths(),
        other: lengths(),
      },
    };
  if (chance(0.5)) byActivity.nordic = { byDifficulty: { novice: lengths() } };
  const byType = {};
  for (const t of Object.values(f.LiftType))
    if (chance(0.4))
      byType[t] = { count: 1 + int(6), lengthInKm: random() * 10 };
  return { runs: { byActivity }, lifts: { byType } };
}

const skiAreaCases = polygons().flatMap((geometry) =>
  Array.from({ length: 8 }, () => {
    const properties = {
      type: "skiArea",
      id: "ski-" + int(1e6),
      name: pick(names),
      activities: ["downhill", "nordic"].filter(() => chance(0.6)),
      status: pick([...Object.values(f.Status), null]),
      sources: sources(),
      runConvention: pick(Object.values(f.RunDifficultyConvention)),
      websites: websites(),
      wikidataID: pick([null, "Q1", "Q,2"]),
      places: somePlaces(),
      viewportHint: hint,
    };
    const st = statistics();
    if (st) properties.statistics = st;
    const feature = { type: "Feature", geometry, properties };
    return {
      feature,
      csv: csv.formatter("skiArea")(structuredClone(feature)),
      mapboxgl: mapbox.formatter("skiArea")(structuredClone(feature)),
    };
  }),
);

const runCases = Array.from({ length: 80 }, () => {
  const properties = {
    type: "run",
    uses: ["downhill", "nordic", "skitour", "connection", "sled", "hike"]
      .filter(() => chance(0.35))
      .slice(0, 4),
    id: "run-" + int(1e6),
    name: pick(names),
    ref: pick([null, "R1", "1,2", "A;B"]),
    status: "operating",
    description: pick([null, "", "A run", 'Say "hi", then\nleave']),
    difficulty: pick([...Object.values(f.RunDifficulty), null]),
    difficultyConvention: pick(Object.values(f.RunDifficultyConvention)),
    oneway: pick([true, false, null]),
    lit: pick([true, false, null]),
    gladed: pick([true, false, null]),
    patrolled: pick([true, false, null]),
    snowmaking: null,
    snowfarming: null,
    tunnel: pick([true, null]),
    grooming: pick([...Object.values(f.RunGrooming), null]),
    skiAreas: someSkiAreas(),
    elevationProfile: null,
    sources: sources(),
    websites: websites(),
    wikidataID: pick([null, "Q9"]),
    places: somePlaces(),
    viewportHint: hint,
  };
  if (properties.uses.length === 0) properties.uses = ["downhill"];
  const feature = { type: "Feature", geometry: lineGeometry(), properties };
  return {
    feature,
    csv: csv.formatter("run")(structuredClone(feature)),
    mapboxgl: mapbox.formatter("run")(structuredClone(feature)),
  };
});

const liftCases = Array.from({ length: 60 }, () => {
  const properties = {
    type: "lift",
    id: "lift-" + int(1e6),
    liftType: pick(Object.values(f.LiftType)),
    status: pick(Object.values(f.Status)),
    access: pick([null, "private"]),
    name: pick(names),
    ref: pick([null, "L1", "1,2"]),
    refFRCAIRN: pick([null, "FR1"]),
    description: pick([null, "Fast", 'Has "quotes"']),
    oneway: pick([true, false, null]),
    occupancy: pick([null, 0, 2, 4, 2.5]),
    capacity: pick([null, 0, 2400]),
    duration: pick([null, 0, 330, 7.5]),
    detachable: pick([true, false, null]),
    bubble: pick([true, false, null]),
    heating: pick([true, false, null]),
    tunnel: pick([true, null]),
    stations: [],
    skiAreas: someSkiAreas(),
    sources: sources(),
    websites: websites(),
    wikidataID: pick([null, "Q3"]),
    places: somePlaces(),
    viewportHint: hint,
  };
  const feature = { type: "Feature", geometry: lineGeometry(), properties };
  return {
    feature,
    csv: csv.formatter("lift")(structuredClone(feature)),
    mapboxgl: mapbox.formatter("lift")(structuredClone(feature)),
  };
});

const spotKinds = [
  { spotType: "crossing", dismount: pick(["yes", "no", "sometimes"]) },
  {
    spotType: "lift_station",
    name: pick(names),
    position: pick(["bottom", "mid", "top", null]),
    entry: pick([true, false, null]),
    exit: pick([true, false, null]),
    liftId: "lift-1",
  },
  { spotType: "avalanche_transceiver_training" },
  { spotType: "avalanche_transceiver_checkpoint" },
  { spotType: "halfpipe" },
];
const spotCases = Array.from({ length: 60 }, () => {
  const properties = {
    type: "spot",
    id: "spot-" + int(1e6),
    skiAreas: someSkiAreas(),
    sources: sources(),
    places: somePlaces(),
    viewportHint: hint,
    ...pick(spotKinds),
  };
  const feature = {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [11 + random() * 0.01, 47 + random() * 0.01],
    },
    properties,
  };
  return {
    feature,
    csv: csv.formatter("spot")(structuredClone(feature)),
    mapboxgl: mapbox.formatter("spot")(structuredClone(feature)),
  };
});

/**
 * The same runs again, on longer lines with a valid elevation profile, so that the CSV's
 * elevation columns (inclined length, ascent, descent, pitch, elevations) are exercised.
 * They come last so that adding them does not shift the random numbers the rest draws.
 */
const elevatedRunCases = runCases.map(({ feature: original }, index) => {
  const feature = structuredClone(original);
  feature.properties.id = "run-elevated-" + index;
  const n = 2 + int(10);
  let x = 11 + random() * 0.01;
  let y = 47 + random() * 0.01;
  const coordinates = [];
  for (let i = 0; i < n; i++) {
    coordinates.push([x, y]);
    x += (random() - 0.3) * pick([0.0004, 0.004]);
    y += (random() - 0.5) * pick([0.0004, 0.004]);
  }
  feature.geometry = { type: "LineString", coordinates };
  const target = pick([25, 25, 50, 100, 250]);
  const sampled = f.extractPointsForElevationProfile(
    structuredClone(feature.geometry),
    target,
  );
  let height = 900 + int(2200);
  const heights = sampled.geometry.coordinates.map(() => {
    height += int(70) - 45;
    return height;
  });
  feature.properties.elevationProfile = {
    heights,
    resolution: sampled.resolutionInMeters,
    targetResolution: target,
  };
  return {
    feature,
    csv: csv.formatter("run")(structuredClone(feature)),
    mapboxgl: mapbox.formatter("run")(structuredClone(feature)),
  };
});
runCases.push(...elevatedRunCases);

/**
 * Lifts again, on elevated lines (a height on every coordinate) with stations of their own: a
 * top and a bottom station, sometimes one elevated and one not, which is what the lift's speeds
 * are measured between. They come last, like the elevated runs, so earlier cases do not move.
 */
const elevatedLiftCases = liftCases.map(({ feature: original }, index) => {
  const feature = structuredClone(original);
  feature.properties.id = "lift-elevated-" + index;
  const n = 2 + int(5);
  let x = 11 + random() * 0.01;
  let y = 47 + random() * 0.01;
  let z = 1000 + int(1500);
  const coordinates = [];
  for (let i = 0; i < n; i++) {
    coordinates.push([x, y, z]);
    x += random() * 0.002;
    y += random() * 0.002;
    z += int(200) - 20;
  }
  feature.geometry = { type: "LineString", coordinates };
  const station = (position, point) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: point },
    properties: {
      type: "spot",
      spotType: "lift_station",
      id: "station-" + int(1e6),
      name: null,
      position,
      entry: null,
      exit: null,
      liftId: feature.properties.id,
      skiAreas: [],
      sources: [],
      places: [],
      viewportHint: hint,
    },
  });
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  const at = (c) =>
    chance(0.85) ? [c[0], c[1], c[2] + int(40)] : [c[0], c[1]];
  feature.properties.stations = [
    ...(chance(0.8) ? [station("bottom", at(first))] : []),
    ...(chance(0.8) ? [station("top", at(last))] : []),
    ...(chance(0.3) ? [station("mid", at(coordinates[1]))] : []),
  ];
  feature.properties.duration = pick([null, 0, 120, 330, 7.5, 1e-3]);
  return {
    feature,
    csv: csv.formatter("lift")(structuredClone(feature)),
    mapboxgl: mapbox.formatter("lift")(structuredClone(feature)),
  };
});
liftCases.push(...elevatedLiftCases);

const lines = (cases) =>
  "[\n" + cases.map((c) => JSON.stringify(c)).join(",\n") + "\n]";
const generated =
  '{"skiAreas":' +
  lines(skiAreaCases) +
  ',"runs":' +
  lines(runCases) +
  ',"lifts":' +
  lines(liftCases) +
  ',"spots":' +
  lines(spotCases) +
  "}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-output-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("output vectors are up to date");
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  console.log(
    `Wrote ${skiAreaCases.length} ski areas, ${runCases.length} runs, ${liftCases.length} lifts, ${spotCases.length} spots`,
  );
}
