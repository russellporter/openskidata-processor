#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-cluster/tests/cluster_scenes.json`: randomised multi-resort
 * worlds pushed through the real TypeScript `prepare` -- converter, formatters,
 * normalization, clustering with PostGIS, statistics, augmentation -- with the final
 * `ski_areas`, `runs`, `lifts` and `spots` GeoJSON recorded.
 *
 * A scene is one to three clusters of features placed 300 m to 2 km apart, so that some
 * neighbouring clusters are within the 500 m search radius of each other (and so merge or
 * compete for objects) and some are not. No elevation, geocoding, snow cover or tiles: those
 * need external services and are ported separately.
 *
 * Requires PostgreSQL with PostGIS (`pg_ctlcluster 16 main start`) and a build
 * (`npm run build`). Usage: node rust/codegen/generate-cluster-scenes.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "./tooling.mjs";
import { chance, generate, int, pick, reseed } from "./osm-worlds.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-cluster/tests/cluster_scenes.json",
);
const dist = (p) => import(join(repoRoot, "dist", p));
const { convertOSMToGeoJSON } = await dist("io/OSMToGeoJSONConverter.js");
const { default: prepare } = await dist("PrepareGeoJSON.js");
const { getPostgresTestConfig } = await dist("Config.js");
const TestHelpers = await dist("TestHelpers.js");

reseed(20260901);

/** Cluster origins, in 1e-7 degrees, 300 m to 2 km apart. */
function origins(count) {
  const [ox, oy] = pick([
    [113000000, 472000000],
    [1428000000, 433000000],
    [-1060000000, 396000000],
  ]);
  const result = [[ox, oy]];
  for (let k = 1; k < count; k++) {
    const [px, py] = result[result.length - 1];
    const distance = pick([30000, 50000, 120000, 200000]); // 0.003 .. 0.02 degrees
    const direction = pick([
      [1, 0],
      [0, 1],
      [1, 1],
      [-1, 0],
    ]);
    result.push([px + direction[0] * distance, py + direction[1] * distance]);
  }
  return result;
}

function makeScene(dense) {
  const count = 1 + int(3);
  const roles = {
    runs: [],
    lifts: [],
    skiAreas: [],
    sites: [],
    spots: [],
    skimap: [],
  };
  origins(count).forEach((origin, k) => {
    const part = generate({
      wide: false,
      dense,
      origin,
      idBase: (k + 1) * 10000,
    });
    for (const key of Object.keys(roles)) roles[key].push(...part[key]);
  });
  return roles;
}

function silenced(fn) {
  const { log, warn, error } = console;
  console.log = console.warn = console.error = () => {};
  return fn().finally(() => Object.assign(console, { log, warn, error }));
}

async function record(roles) {
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
  await prepare(paths, {
    elevationServer: null,
    bbox: null,
    geocodingServer: null,
    workingDir: TestHelpers.getTempWorkingDir(),
    osmInputDir: null,
    outputDir: TestHelpers.getTempWorkingDir(),
    snowCover: null,
    tiles: null,
    postgresCache: getPostgresTestConfig(),
  });
  const read = (path) => TestHelpers.fileContents(path).features;
  const csv = (name) => readFileSync(join(paths.output.csv, name), "utf8");
  return {
    skiAreas: read(paths.output.skiAreas),
    runs: read(paths.output.runs),
    lifts: read(paths.output.lifts),
    spots: read(paths.output.spots),
    // The slimmed GeoJSON fed to tippecanoe, and the CSV exports.
    mapboxgl: {
      skiAreas: read(paths.output.mapboxGL.skiAreas),
      runs: read(paths.output.mapboxGL.runs),
      lifts: read(paths.output.mapboxGL.lifts),
      spots: read(paths.output.mapboxGL.spots),
    },
    csv: {
      skiAreas: csv("ski_areas.csv"),
      runs: csv("runs.csv"),
      lifts: csv("lifts.csv"),
      spots: csv("spots.csv"),
    },
  };
}

/**
 * A station shared by two lifts, one of which is in the same site relation as the station.
 * Both lifts then have the station's position as a vertex, so their distances to it are
 * exactly equal (zero) and the tie-break -- prefer the lift in the station's ski area --
 * decides. The lifts' coordinates are shifted per scene so that the key order of the two
 * (a hash) varies, and the preferred lift is sometimes found first and sometimes second.
 */
function stationTie(shift) {
  const lng = 113000000 + shift * 3000;
  const lat = 472000000 + shift * 1000;
  const at = (dx, dy) => ({ lon: (lng + dx) / 1e7, lat: (lat + dy) / 1e7 });
  const nodes = [
    {
      type: "node",
      id: 1,
      ...at(0, 0),
      tags: { aerialway: "station", name: "Shared" },
    },
    { type: "node", id: 2, ...at(0, 4000) },
    { type: "node", id: 3, ...at(2000, 0 + shift * 10) },
    { type: "node", id: 4, ...at(-2000, 4000 + shift * 10) },
  ];
  const lifts = [
    { type: "way", id: 10, nodes: [1, 2], tags: { aerialway: "chair_lift" } },
    { type: "way", id: 11, nodes: [1, 4], tags: { aerialway: "chair_lift" } },
    { type: "way", id: 12, nodes: [3, 1], tags: { aerialway: "gondola" } },
  ];
  return {
    runs: [],
    lifts: [...nodes, ...lifts],
    skiAreas: [],
    // Two sites: the station and one lift belong to the first, another lift to the second.
    // Site members are already assigned, so the nearby pass does not move them between ski
    // areas, and the tie-break has a real difference to act on.
    sites: [
      {
        type: "relation",
        id: 20,
        members: [
          { type: "node", ref: 1, role: "" },
          { type: "way", ref: [10, 11, 12][shift % 3], role: "" },
        ],
        tags: { site: "piste", name: "Station Site" },
      },
      {
        type: "relation",
        id: 21,
        members: [{ type: "way", ref: [11, 12, 10][shift % 3], role: "" }],
        tags: { site: "piste", name: "Other Site" },
      },
    ],
    spots: [nodes[0]],
    skimap: [],
  };
}

/**
 * Runs along a line, each 46 m long and 410 m from the next, so a run is within the 500 m
 * search radius of its two neighbours and of nothing else. With mixed activities this makes
 * the traversal's path dependence observable: which activities a path carries decides how
 * far it can go, and when an object is reachable by two paths whoever reaches it first (in
 * key order) decides which narrowing applies. Polygon ski areas at one or two points of the
 * chain compete for its runs, and lifts bridge some of the gaps, some of them not operating
 * (which join a ski area without extending it).
 */
function chainScene() {
  const lng0 = 113000000;
  const lat0 = 472000000;
  const step = 60000; // 0.006 degrees of longitude, 456 m at this latitude
  const half = 3000;
  const count = 5 + int(5);
  const elements = [];
  let nodeId = 1000;
  const node = (lng, lat) => {
    const id = nodeId++;
    elements.push({ type: "node", id, lon: lng / 1e7, lat: lat / 1e7 });
    return id;
  };
  const runs = [];
  const lifts = [];
  let wayId = 1;
  const uses = ["downhill", "nordic", "downhill;nordic"];
  const centres = [];
  for (let i = 0; i < count; i++) {
    const cx = lng0 + i * step;
    const cy = lat0 + (i % 2) * 2000;
    centres.push([cx, cy]);
    const a = node(cx - half, cy);
    const b = node(cx + half, cy);
    runs.push({
      type: "way",
      id: wayId++,
      nodes: [a, b],
      tags: {
        "piste:type": pick(uses),
        "piste:difficulty": pick(["easy", "intermediate"]),
      },
    });
  }
  for (let i = 0; i + 1 < count; i++) {
    if (!chance(0.4)) continue;
    const a = node(centres[i][0] + half, centres[i][1]);
    const b = node(centres[i + 1][0] - half, centres[i + 1][1]);
    const key = chance(0.5)
      ? "aerialway"
      : pick(["proposed", "disused", "construction"]) + ":aerialway";
    lifts.push({
      type: "way",
      id: wayId++,
      nodes: [a, b],
      tags: { [key]: "chair_lift" },
    });
  }
  const skiAreas = [];
  const polygonAt = (i) => {
    const [cx, cy] = centres[i];
    const w = 6000;
    const ring = [
      node(cx - w, cy - w),
      node(cx + w, cy - w),
      node(cx + w, cy + w),
      node(cx - w, cy + w),
    ];
    skiAreas.push({
      type: "way",
      id: wayId++,
      nodes: [...ring, ring[0]],
      tags: { landuse: "winter_sports", name: "Chain " + i },
    });
  };
  polygonAt(0);
  if (count > 6 && chance(0.7)) polygonAt(count - 1);
  return {
    runs: [...elements, ...runs],
    lifts: [...elements, ...lifts],
    skiAreas: [...elements, ...skiAreas],
    sites: [],
    spots: [],
    skimap: chance(0.3)
      ? [
          {
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [(lng0 + 2 * step) / 1e7, lat0 / 1e7],
            },
            properties: {
              id: "900",
              name: "Chain Skimap",
              scalerank: 3,
              status: "operating",
              activities: ["downhill"],
              official_website: null,
            },
          },
        ]
      : [],
  };
}

const scenes = [];
const scenesWanted = Number(process.env.CLUSTER_SCENES ?? 60);
for (const dense of [false, true]) {
  for (let n = 0; n < scenesWanted; n++) {
    const roles = makeScene(dense);
    const expected = await silenced(() => record(roles));
    scenes.push({ roles, expected });
  }
}
for (let n = 0; n < Number(process.env.CLUSTER_CHAINS ?? 60); n++) {
  const roles = chainScene();
  const expected = await silenced(() => record(roles));
  scenes.push({ roles, expected });
}
for (let shift = 0; shift < 8; shift++) {
  const roles = stationTie(shift);
  const expected = await silenced(() => record(roles));
  scenes.push({ roles, expected });
}

const generated =
  '{"scenes":[\n' + scenes.map((s) => JSON.stringify(s)).join(",\n") + "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-cluster-scenes.mjs`,
    );
    process.exit(1);
  }
  console.log("cluster scenes are up to date");
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  const count = (key) => scenes.reduce((n, s) => n + s.expected[key].length, 0);
  const generatedAreas = scenes.reduce(
    (n, s) =>
      n +
      s.expected.skiAreas.filter(
        (a) =>
          a.properties.sources.length &&
          a.properties.sources.every(() => false),
      ).length,
    0,
  );
  console.log(
    `Wrote ${scenes.length} scenes: ${count("skiAreas")} ski areas, ${count("runs")} runs, ${count("lifts")} lifts, ${count("spots")} spots`,
  );
  void generatedAreas;
}
