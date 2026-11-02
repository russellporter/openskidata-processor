#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-pipeline/tests/format_scenes.json`: randomised OSM worlds
 * pushed through the real TypeScript front half of `PrepareGeoJSON.prepare` -- the OSM
 * converter, `formatSkiArea`/`formatRun`/`formatLift`/`formatSpots`, the ski-area site
 * provider, and run normalization -- with the intermediate output recorded.
 *
 * Production feeds five separate Overpass extracts (runs, lifts, ski areas, ski-area sites,
 * spots) through the converter independently, so a scene holds one element list per role.
 * Each extract only contains what its query would return: the roles' own ways, their nodes,
 * and for relations their members.
 *
 * Embedded `skiAreas` of runs, lifts and spots (the site ski areas, full features) are
 * recorded as their ids only; the Rust side holds them as references, and they are replaced
 * during clustering anyway.
 *
 * Build first (`npm run build`). Usage: node rust/codegen/generate-format-scenes.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "./tooling.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-pipeline/tests/format_scenes.json",
);
const dist = (p) => import(join(repoRoot, "dist", p));
const { convertOSMToGeoJSON } = await dist("io/OSMToGeoJSONConverter.js");
const { formatRun } = await dist("transforms/RunFormatter.js");
const { formatLift } = await dist("transforms/LiftFormatter.js");
const { formatSpots } = await dist("transforms/SpotFormatter.js");
const { formatSkiArea, InputSkiAreaType } = await dist(
  "transforms/SkiAreaFormatter.js",
);
const { SkiAreaSiteProvider, addSkiAreaSites } = await dist(
  "transforms/SkiAreaSiteProvider.js",
);
const { RunNormalizerAccumulator } = await dist(
  "transforms/accumulator/RunNormalizerAccumulator.js",
);

let seed = 1234567;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const int = (n) => Math.floor(random() * n);
const pick = (items) => items[int(items.length)];
const chance = (p) => random() < p;

// Origins in units of 1e-7 degrees, so every coordinate is on the store's grid.
const ORIGINS = [
  [113000000, 472000000], // Austrian Alps (europe)
  [1428000000, 433000000], // Hokkaido (japan)
  [-1060000000, 396000000], // Colorado (north america)
  [-703000000, -334000000], // Chilean Andes
];
const NARROW_STEP = 4000; // 0.0004 degrees
const STEP = NARROW_STEP; // the skimap points below use the narrow step

// A "wide" world spans a degree, across the Japan/Europe convention boundary near 130.2
// degrees east, so that an area's bounding-box centre and its first vertex can disagree.
const WIDE_ORIGIN = [1298000000, 360000000];
const WIDE_STEP = 2000000;

function makeWorld(wide) {
  const [ox, oy] = wide ? WIDE_ORIGIN : pick(ORIGINS);
  const STEP = wide ? WIDE_STEP : NARROW_STEP;
  const size = 6;
  let nextNode = 1000;
  const nodes = new Map(); // "gx,gy" -> id
  const nodeList = [];
  const node = (gx, gy) => {
    const key = gx + "," + gy;
    if (!nodes.has(key)) {
      const id = nextNode++;
      nodes.set(key, id);
      nodeList.push({
        type: "node",
        id,
        lat: (oy + gy * STEP) / 1e7,
        lon: (ox + gx * STEP) / 1e7,
      });
    }
    return nodes.get(key);
  };
  const walk = (n) => {
    let gx = int(size);
    let gy = int(size);
    const ids = [node(gx, gy)];
    while (ids.length < n) {
      const move = pick([
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
      ]);
      const nx = Math.min(size - 1, Math.max(0, gx + move[0]));
      const ny = Math.min(size - 1, Math.max(0, gy + move[1]));
      if (nx === gx && ny === gy) continue;
      gx = nx;
      gy = ny;
      ids.push(node(gx, gy));
    }
    return ids;
  };
  const square = () => {
    const x = int(size - 2);
    const y = int(size - 2);
    const s = 1 + int(2);
    const ring = [
      node(x, y),
      node(x + s, y),
      node(x + s, y + s),
      node(x, y + s),
    ];
    return [...ring, ring[0]];
  };
  return { node, walk, square, nodeList, size };
}

const pisteTypes = [
  "downhill",
  "nordic",
  "skitour",
  "sled",
  "hike",
  "sleigh",
  "snow_park",
  "ice_skate",
  "playground",
  "connection",
  "downhill;nordic",
  "unknown",
];
const difficulties = [
  "novice",
  "easy",
  "intermediate",
  "advanced",
  "expert",
  "freeride",
  "extreme",
  "bogus",
];

function runTags() {
  const tags = { "piste:type": pick(pisteTypes) };
  if (chance(0.7)) tags["piste:difficulty"] = pick(difficulties);
  if (chance(0.4))
    tags["piste:name"] = pick([
      "Alpha",
      "Beta",
      "Gamma",
      " Delta ",
      "11 - Peak",
    ]);
  if (chance(0.3)) tags.name = pick(["Alpha", "Valley", "Ski Run"]);
  if (chance(0.3)) tags["piste:ref"] = pick(["1", "2a", "11"]);
  if (chance(0.3)) tags.ref = pick(["R1", "11"]);
  if (chance(0.3)) tags.oneway = pick(["yes", "no"]);
  if (chance(0.2))
    tags["piste:grooming"] = pick([
      "classic",
      "skating",
      "classic+skating",
      "backcountry",
      "mogul",
    ]);
  if (chance(0.15)) tags.gladed = pick(["yes", "no"]);
  if (chance(0.15)) tags.lit = pick(["yes", "no"]);
  if (chance(0.1)) tags.tunnel = "yes";
  if (chance(0.1)) tags.website = pick(["https://example.org", ""]);
  if (chance(0.1)) tags.wikidata = "Q1;Q2";
  if (chance(0.08)) tags["piste:abandoned"] = "yes";
  if (chance(0.08)) {
    tags["disused:piste:type"] = tags["piste:type"];
    delete tags["piste:type"];
  }
  if (chance(0.1)) tags.description = "A run";
  return tags;
}

function liftTags() {
  const kinds = [
    "chair_lift",
    "gondola",
    "cable_car",
    "drag_lift",
    "t-bar",
    "j-bar",
    "platter",
    "rope_tow",
    "magic_carpet",
    "mixed_lift",
    "station",
    "pylon",
    "zip_line",
  ];
  const tags = { aerialway: pick(kinds) };
  if (chance(0.15)) {
    delete tags.aerialway;
    tags.railway = pick(["funicular", "rail", "narrow_gauge", "tram"]);
  }
  if (chance(0.15)) {
    const key = Object.keys(tags)[0];
    tags[
      pick(["disused", "abandoned", "proposed", "construction"]) + ":" + key
    ] = tags[key];
    delete tags[key];
  }
  if (chance(0.4)) tags.name = pick(["Sunrise Express", "Gondola 1", "Tow"]);
  if (chance(0.3)) tags["aerialway:occupancy"] = pick(["4", "6", "", "x"]);
  if (chance(0.3)) tags["aerialway:capacity"] = pick(["2400", "1800"]);
  if (chance(0.3)) tags["aerialway:duration"] = pick(["5", "7.5", "5:30"]);
  if (chance(0.2)) tags["aerialway:bubble"] = "yes";
  if (chance(0.1)) tags.access = pick(["private", "no", "forestry"]);
  if (chance(0.1)) tags.description = pick(["", "Fast"]);
  if (chance(0.1)) tags.tunnel = "yes";
  return tags;
}

function generate() {
  const wide = chance(0.12);
  const w = makeWorld(wide);
  let nextId = 1;
  const roles = {
    runs: [],
    lifts: [],
    skiAreas: [],
    sites: [],
    spots: [],
    skimap: [],
  };
  const wayIds = []; // [{id, role}]
  const used = {
    runs: new Set(),
    lifts: new Set(),
    skiAreas: new Set(),
    spots: new Set(),
  };
  const bag = { runs: [], lifts: [], skiAreas: [], spots: [] };
  const add = (role, element, nodeIds) => {
    bag[role].push(element);
    for (const id of nodeIds) used[role].add(id);
  };

  // Runs, some overlapping or touching (they share the world's grid points).
  for (let n = 0, count = 1 + int(5); n < count; n++) {
    const id = nextId++;
    if (chance(0.2)) {
      const ring = w.square();
      add(
        "runs",
        {
          type: "way",
          id,
          nodes: ring,
          tags: { ...runTags(), "piste:type": "downhill" },
        },
        ring,
      );
    } else if (chance(0.15)) {
      // a multipolygon relation made of one closed way
      const ring = w.square();
      const wayId = nextId++;
      add("runs", { type: "way", id: wayId, nodes: ring }, ring);
      add(
        "runs",
        {
          type: "relation",
          id,
          members: [{ type: "way", ref: wayId, role: "outer" }],
          tags: {
            ...runTags(),
            type: "multipolygon",
            "piste:type": "downhill",
          },
        },
        [],
      );
    } else if (chance(0.15)) {
      // a route relation of two ways
      const a = w.walk(2 + int(3));
      const b = [a[a.length - 1], ...w.walk(2 + int(2)).slice(1)];
      const wa = nextId++;
      const wb = nextId++;
      add("runs", { type: "way", id: wa, nodes: a }, a);
      add("runs", { type: "way", id: wb, nodes: b }, b);
      add(
        "runs",
        {
          type: "relation",
          id,
          members: [
            { type: "way", ref: wa, role: "" },
            { type: "way", ref: wb, role: "" },
          ],
          tags: { ...runTags(), type: "route" },
        },
        [],
      );
    } else {
      const ids = w.walk(2 + int(5));
      add("runs", { type: "way", id, nodes: ids, tags: runTags() }, ids);
    }
    wayIds.push({ type: bag.runs[bag.runs.length - 1].type, id, role: "runs" });
  }

  // Lifts.
  for (let n = 0, count = int(4); n < count; n++) {
    const id = nextId++;
    if (chance(0.15)) {
      // A closed way: an area, not a line, so it is not a lift.
      const ring = w.square();
      add(
        "lifts",
        { type: "way", id, nodes: ring, tags: { ...liftTags(), area: "yes" } },
        ring,
      );
      wayIds.push({ type: "way", id, role: "lifts" });
      continue;
    }
    const ids = w.walk(chance(0.1) ? 1 : 2 + int(3));
    add("lifts", { type: "way", id, nodes: ids, tags: liftTags() }, ids);
    wayIds.push({ type: "way", id, role: "lifts" });
  }

  // Ski areas: landuse polygons, some invalid or with the wrong sport.
  for (let n = 0, count = int(3); n < count; n++) {
    const id = nextId++;
    const ring = chance(0.15) ? [...w.walk(5), null] : w.square();
    const nodes = ring.includes(null) ? ring.slice(0, -1) : ring;
    const tags = { landuse: "winter_sports" };
    if (chance(0.5)) tags.name = pick(["Resort", "Ski Area", " Padded "]);
    if (chance(0.2)) tags.sport = pick(["skiing", "ski", "snowboard", ""]);
    if (chance(0.15)) {
      tags["disused:landuse"] = "winter_sports";
      delete tags.landuse;
    }
    if (chance(0.1)) tags.website = "https://resort.example";
    add("skiAreas", { type: "way", id, nodes, tags }, nodes);
    wayIds.push({ type: "way", id, role: "skiAreas" });
  }

  // Sites referencing earlier ways.
  for (let n = 0, count = chance(0.5) ? 1 + int(2) : 0; n < count; n++) {
    const id = nextId++;
    const members = wayIds
      .filter(() => chance(0.5))
      .map((m) => ({ type: m.type, ref: m.id, role: "" }));
    const tags = { site: "piste" };
    if (chance(0.5)) tags.name = "Piste Site";
    if (chance(0.2)) {
      delete tags.site;
      tags["disused:site"] = "piste";
    }
    roles.sites.push({ type: "relation", id, members, tags });
  }

  // Spots: tagged nodes and a polygon.
  const spotTagSets = [
    { "piste:dismount": "yes" },
    { "piste:dismount": "sometimes" },
    { "piste:dismount": "bogus" },
    {
      aerialway: "station",
      name: "Base Station",
      "aerialway:station": "bottom",
      "aerialway:access": "entry",
    },
    { aerialway: "station" },
    { amenity: "avalanche_transceiver", avalanche_transceiver: "training" },
    { amenity: "avalanche_transceiver", avalanche_transceiver: "checkpoint" },
    { man_made: "piste:halfpipe" },
    { "piste:dismount": "yes", aerialway: "station" },
  ];
  for (let n = 0, count = int(4); n < count; n++) {
    const id = nextId++;
    if (chance(0.2)) {
      const ring = w.square();
      add(
        "spots",
        { type: "way", id, nodes: ring, tags: { man_made: "piste:halfpipe" } },
        ring,
      );
    } else {
      const nodeId = w.node(int(w.size), int(w.size));
      const element = w.nodeList.find((e) => e.id === nodeId);
      // Tag the node itself, in a copy so the shared world node stays untagged elsewhere.
      bag.spots.push({ ...element, tags: pick(spotTagSets) });
      used.spots.add(-nodeId); // marks "node included with tags"
    }
  }

  // Skimap.org ski areas.
  for (let n = 0, count = int(3); n < count; n++) {
    const [ox, oy] = pick(ORIGINS);
    roles.skimap.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [(ox + int(40) * STEP) / 1e7, (oy + int(40) * STEP) / 1e7],
      },
      properties: {
        id: String(100 + n),
        name: pick(["Skimap Resort", "", undefined, "Another"]),
        scalerank: 3,
        status: pick(["operating", "operating", "abandoned", null]),
        activities: pick([
          ["downhill"],
          ["nordic"],
          ["downhill", "nordic"],
          [],
        ]),
        official_website: pick([null, "https://skimap.example", ""]),
      },
    });
  }

  const withNodes = (role) => {
    const included = w.nodeList.filter((e) => used[role].has(e.id));
    return [
      ...included,
      ...bag[role].filter((e) => e.type !== "node"),
      ...bag[role].filter((e) => e.type === "node"),
    ];
  };
  roles.runs = withNodes("runs");
  roles.lifts = withNodes("lifts");
  roles.skiAreas = withNodes("skiAreas");
  roles.spots = withNodes("spots");
  return roles;
}

// --- the TypeScript front half ---------------------------------------------------------

import { writeFileSync as writeTmp, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

function withoutSiteFeatures(feature) {
  const properties = { ...feature.properties };
  properties.siteSkiAreaIds = properties.skiAreas.map((s) => s.properties.id);
  delete properties.skiAreas;
  return { geometry: feature.geometry, properties };
}

function frontHalf(roles) {
  const dir = mkdtempSync(join(tmpdir(), "format-scene-"));
  const sitesPath = join(dir, "sites.json");
  writeTmp(sitesPath, JSON.stringify({ elements: roles.sites }));
  const siteProvider = new SkiAreaSiteProvider();
  siteProvider.loadSites(sitesPath);

  const convert = (elements) => convertOSMToGeoJSON({ elements }).features;

  const skiAreas = [
    ...convert(roles.skiAreas).flatMap(
      (f) => formatSkiArea(InputSkiAreaType.OPENSTREETMAP_LANDUSE)(f) ?? [],
    ),
    ...siteProvider.getGeoJSONSites(),
    ...roles.skimap.flatMap(
      (f) =>
        formatSkiArea(InputSkiAreaType.SKIMAP_ORG)(structuredClone(f)) ?? [],
    ),
  ];

  const tag = addSkiAreaSites(siteProvider);
  const accumulator = new RunNormalizerAccumulator();
  for (const feature of convert(roles.runs)) {
    for (const run of formatRun(feature)) accumulator.accumulate(tag(run));
  }
  const runs = accumulator.results();

  const lifts = convert(roles.lifts)
    .flatMap((f) => formatLift(f) ?? [])
    .map(tag);
  const spots = convert(roles.spots)
    .flatMap((f) => formatSpots(f))
    .map(tag);

  return {
    skiAreas: skiAreas.map((f) => ({
      geometry: f.geometry,
      properties: f.properties,
    })),
    runs: runs.map(withoutSiteFeatures),
    lifts: lifts.map(withoutSiteFeatures),
    spots: spots.map(withoutSiteFeatures),
  };
}

const scenes = [];
const silence = console.warn;
const silenceLog = console.log;
console.warn = () => {};
console.log = () => {};
for (let n = 0; n < 500; n++) {
  const roles = generate();
  let expected;
  try {
    expected = frontHalf(roles);
  } catch (error) {
    expected = { error: String(error?.stack ?? error) };
  }
  scenes.push({ roles, expected });
}
console.warn = silence;
console.log = silenceLog;

const errors = scenes.filter((s) => s.expected.error);
if (errors.length > 0) {
  console.error(
    `${errors.length} scenes threw; first: ${errors[0].expected.error}`,
  );
  process.exit(1);
}

const generated =
  '{"scenes":[\n' + scenes.map((s) => JSON.stringify(s)).join(",\n") + "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-format-scenes.mjs`,
    );
    process.exit(1);
  }
  console.log("format scenes are up to date");
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  const count = (key) => scenes.reduce((n, s) => n + s.expected[key].length, 0);
  console.log(
    `Wrote ${scenes.length} scenes: ${count("skiAreas")} ski areas, ${count("runs")} runs, ${count("lifts")} lifts, ${count("spots")} spots`,
  );
}
