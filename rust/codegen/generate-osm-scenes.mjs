#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-osm/tests/scenes.json` by running synthetic Overpass-JSON
 * scenes through the real TypeScript converter (`dist/io/OSMToGeoJSONConverter.js`).
 *
 * Each scene targets one rule of the converter (see the header comment of
 * `src/io/OSMToGeoJSONConverter.ts`); the Rust port must reproduce the recorded output
 * exactly, feature for feature and in the same order. Run `npm run build` first.
 *
 * Usage: node rust/codegen/generate-osm-scenes.mjs [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { prettifyJson, repoRoot } from "./tooling.mjs";

const outPath = join(repoRoot, "rust/crates/osd-osm/tests/scenes.json");
const { convertOSMToGeoJSON } = await import(
  join(repoRoot, "dist/io/OSMToGeoJSONConverter.js")
);

const node = (id, lon, lat, tags) =>
  tags === undefined
    ? { type: "node", id, lat, lon }
    : { type: "node", id, lat, lon, tags };
const way = (id, nodes, tags) => {
  const w = { type: "way", id };
  if (nodes !== undefined) w.nodes = nodes;
  if (tags !== undefined) w.tags = tags;
  return w;
};
const rel = (id, members, tags) => {
  const r = { type: "relation", id };
  if (members !== undefined) r.members = members;
  if (tags !== undefined) r.tags = tags;
  return r;
};
const m = (type, ref, role) =>
  role === undefined ? { type, ref } : { type, ref, role };

/** Corners of a square with its lower-left at (x, y), as nodes with ids base..base+3. */
const squareNodes = (base, x, y, size = 1) => [
  node(base, x, y),
  node(base + 1, x + size, y),
  node(base + 2, x + size, y + size),
  node(base + 3, x, y + size),
];

const scenes = [
  {
    name: "tagged and untagged nodes, unreferenced and in ways",
    elements: [
      node(5, 1, 1),
      node(1, 0, 0, { name: "tagged" }),
      node(3, 0.5, 0.5),
      node(2, 0, 1),
      way(10, [2, 3], { aerialway: "chair_lift" }),
    ],
  },
  {
    name: "unsorted nodes with duplicate ids",
    elements: [
      node(30, 3, 3, { a: "b" }),
      node(10, 1, 1),
      node(20, 2, 2),
      node(10, 9, 9, { dup: "yes" }),
      way(1, [10, 20, 30], { highway: "path" }),
    ],
  },
  {
    name: "coordinate rounding",
    elements: [
      node(1, 11.123456789012349, 47.100000000000001, { t: "1" }),
      node(2, -0.0000000000005, 0.0000000000005, { t: "2" }),
      node(3, 0.0000000000015, -0.0000000000015, { t: "3" }),
      node(4, 179.99999999999999, -89.123456789012345678, { t: "4" }),
      node(5, 1e-13, -1e-13, { t: "5" }),
    ],
  },
  {
    name: "open and closed ways, area-tagged or not",
    elements: [
      ...squareNodes(1, 0, 0),
      way(100, [1, 2, 3, 4, 1], { landuse: "winter_sports" }),
      way(101, [1, 2, 3, 4, 1], { aerialway: "chair_lift" }),
      way(102, [1, 2, 3, 4], { landuse: "winter_sports" }),
      way(103, [1, 2, 3, 4, 1], { "piste:type": "downhill" }),
      way(104, [1, 2, 3, 4, 1], { "piste:type": "nordic" }),
      way(105, [1, 2, 3, 4, 1], { landuse: "winter_sports", area: "no" }),
      way(106, [1, 2, 3, 4, 1], { "piste:type": "downhill", area: "yes" }),
      way(107, [1, 2, 3, 4, 1], { "piste:type": "downhill", area: "no" }),
      way(108, [1, 2, 3, 4, 1]),
      way(109, [1, 2], {}),
    ],
  },
  {
    name: "polygon winding is normalised",
    elements: [
      ...squareNodes(1, 0, 0),
      way(1, [1, 2, 3, 4, 1], { landuse: "winter_sports" }),
      way(2, [1, 4, 3, 2, 1], { landuse: "winter_sports" }),
    ],
  },
  {
    name: "ways with missing nodes or no node list",
    elements: [
      node(1, 0, 0),
      node(2, 1, 1),
      way(10, [1, 99, 2], { highway: "path" }),
      way(11, [99, 98], { highway: "path" }),
      way(12, [1, 99], { highway: "path" }),
      way(13, undefined, { highway: "path" }),
      way(14, [], { highway: "path" }),
      way(15, [1, 2, 99, 1], { landuse: "winter_sports" }),
      way(16, [99, 1, 2, 99], { landuse: "winter_sports" }),
    ],
  },
  {
    name: "duplicate way ids",
    elements: [
      node(1, 0, 0),
      node(2, 1, 1),
      node(3, 2, 2),
      way(10, [1, 2], { a: "first" }),
      way(10, [2, 3], { a: "second" }),
      rel(50, [m("way", 10, "")], { type: "route", route: "piste" }),
    ],
  },
  {
    name: "route relation joining ways in both directions",
    elements: [
      node(1, 0, 0),
      node(2, 1, 0),
      node(3, 2, 0),
      node(4, 3, 0),
      node(5, 4, 0),
      way(10, [1, 2], {}),
      way(11, [3, 2], {}),
      way(12, [3, 4], {}),
      way(13, [5, 4], {}),
      rel(20, [m("way", 10), m("way", 11), m("way", 12), m("way", 13)], {
        type: "route",
        route: "piste",
      }),
    ],
  },
  {
    name: "route relation with a gap yields a multilinestring",
    elements: [
      node(1, 0, 0),
      node(2, 1, 0),
      node(3, 5, 5),
      node(4, 6, 5),
      way(10, [1, 2], {}),
      way(11, [3, 4], {}),
      rel(20, [m("way", 10), m("way", 11)], { type: "waterway" }),
    ],
  },
  {
    name: "route relation edge cases",
    elements: [
      node(1, 0, 0),
      node(2, 1, 0),
      way(10, [1, 2], {}),
      way(11, [97, 98], {}),
      rel(20, [m("way", 10), m("way", 404)], { type: "route" }),
      rel(21, [m("way", 404)], { type: "route" }),
      rel(22, [m("way", 11)], { type: "route" }),
      rel(23, [], { type: "route" }),
      rel(24, undefined, { type: "route" }),
      rel(25, [m("way", 10)], undefined),
      rel(26, [m("way", 10)], { type: "restriction" }),
      rel(27, [m("way", 10)], { name: "no type" }),
      rel(28, [m("node", 1), m("relation", 20)], { type: "route" }),
    ],
  },
  {
    name: "simple multipolygon with an inner ring",
    elements: [
      ...squareNodes(1, 0, 0, 10),
      ...squareNodes(11, 4, 4, 2),
      way(100, [1, 2, 3, 4, 1], {}),
      way(101, [11, 12, 13, 14, 11], {}),
      rel(200, [m("way", 100, "outer"), m("way", 101, "inner")], {
        type: "multipolygon",
        landuse: "winter_sports",
      }),
    ],
  },
  {
    name: "multipolygon outers split across ways in mixed directions",
    elements: [
      ...squareNodes(1, 0, 0, 10),
      way(100, [1, 2, 3], {}),
      way(101, [1, 4, 3], {}),
      rel(200, [m("way", 100, "outer"), m("way", 101, "outer")], {
        type: "multipolygon",
      }),
    ],
  },
  {
    name: "multipolygon with two outers and inners assigned to the right one",
    elements: [
      ...squareNodes(1, 0, 0, 10),
      ...squareNodes(11, 20, 0, 10),
      ...squareNodes(21, 2, 2, 2),
      ...squareNodes(31, 22, 2, 2),
      ...squareNodes(41, 50, 50, 1),
      way(100, [1, 2, 3, 4, 1], {}),
      way(101, [11, 12, 13, 14, 11], {}),
      way(102, [21, 22, 23, 24, 21], {}),
      way(103, [31, 32, 33, 34, 31], {}),
      way(104, [41, 42, 43, 44, 41], {}),
      rel(
        200,
        [
          m("way", 100, "outer"),
          m("way", 101, "outer"),
          m("way", 102, "inner"),
          m("way", 103, "inner"),
          m("way", 104, "inner"),
        ],
        { type: "multipolygon" },
      ),
    ],
  },
  {
    name: "inner ring contained by two nested outers goes to the first listed",
    elements: [
      ...squareNodes(1, 0, 0, 100),
      ...squareNodes(11, 10, 10, 50),
      ...squareNodes(21, 20, 20, 5),
      way(100, [1, 2, 3, 4, 1], {}),
      way(101, [11, 12, 13, 14, 11], {}),
      way(102, [21, 22, 23, 24, 21], {}),
      rel(
        200,
        [
          m("way", 100, "outer"),
          m("way", 101, "outer"),
          m("way", 102, "inner"),
        ],
        { type: "multipolygon" },
      ),
      rel(
        201,
        [
          m("way", 101, "outer"),
          m("way", 100, "outer"),
          m("way", 102, "inner"),
        ],
        { type: "multipolygon" },
      ),
    ],
  },
  {
    name: "multipolygon roles: missing, empty and unknown",
    elements: [
      ...squareNodes(1, 0, 0, 10),
      ...squareNodes(11, 30, 0, 10),
      ...squareNodes(21, 60, 0, 10),
      way(100, [1, 2, 3, 4, 1], {}),
      way(101, [11, 12, 13, 14, 11], {}),
      way(102, [21, 22, 23, 24, 21], {}),
      // no raw "outer" member at all: no geometry
      rel(200, [m("way", 100), m("way", 101, "")], { type: "multipolygon" }),
      // one raw outer; role-less and empty members are treated as outers too
      rel(201, [m("way", 100, "outer"), m("way", 101), m("way", 102, "")], {
        type: "multipolygon",
      }),
      // an unknown role is neither outer nor inner
      rel(202, [m("way", 100, "outer"), m("way", 101, "subarea")], {
        type: "boundary",
      }),
    ],
  },
  {
    name: "multipolygon rings too short or unclosed",
    elements: [
      ...squareNodes(1, 0, 0, 10),
      ...squareNodes(11, 4, 4, 2),
      node(21, 0, 0),
      node(22, 1, 1),
      node(23, 2, 0),
      way(100, [1, 2, 3, 4, 1], {}),
      way(101, [11, 12, 13, 14, 11], {}),
      way(102, [21, 22, 21], {}),
      way(103, [1, 2, 3], {}),
      rel(200, [m("way", 102, "outer"), m("way", 101, "inner")], {
        type: "multipolygon",
      }),
      rel(201, [m("way", 103, "outer")], { type: "multipolygon" }),
      rel(202, [m("way", 100, "outer"), m("way", 102, "inner")], {
        type: "multipolygon",
      }),
      rel(203, [m("way", 100, "outer"), m("way", 999, "inner")], {
        type: "multipolygon",
      }),
    ],
  },
  {
    name: "points: relation node members, nodes in ways, tagged nodes",
    elements: [
      node(1, 0, 0),
      node(2, 1, 0),
      node(3, 2, 0),
      node(4, 3, 0, { place: "x" }),
      node(5, 4, 0),
      way(10, [1, 2], { highway: "path" }),
      rel(
        20,
        [m("node", 1, "stop"), m("node", 3), m("node", 999), m("way", 10)],
        { type: "route" },
      ),
    ],
  },
  {
    name: "emission order: relations, polygon ways, line ways, points",
    elements: [
      node(9, 9, 9, { name: "point" }),
      ...squareNodes(1, 0, 0),
      way(300, [1, 2], { highway: "path" }),
      way(301, [1, 2, 3, 4, 1], { landuse: "winter_sports" }),
      way(302, [3, 4], { highway: "path" }),
      rel(400, [m("way", 300)], { type: "route" }),
      way(303, [2, 3, 4, 2], { landuse: "winter_sports" }),
    ],
  },
  {
    name: "ids_only style elements",
    elements: [
      way(1, undefined),
      rel(2, undefined, { type: "multipolygon" }),
      rel(3, undefined, undefined),
      way(4, undefined, undefined),
    ],
  },
  {
    name: "unknown member types do not break relations",
    elements: [
      ...squareNodes(1, 0, 0),
      way(100, [1, 2, 3, 4, 1], {}),
      rel(200, [m("area", 5, "outer")], { type: "multipolygon" }),
      rel(201, [m("area", 5, "outer"), m("way", 100, "inner")], {
        type: "multipolygon",
      }),
    ],
  },
];

const recorded = scenes.map((scene) => ({
  name: scene.name,
  elements: scene.elements,
  expected: convertOSMToGeoJSON({ elements: scene.elements }).features,
}));

const generated = prettifyJson(
  JSON.stringify({ scenes: recorded }, null, 2) + "\n",
);

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-osm-scenes.mjs`,
    );
    process.exit(1);
  }
  console.log("osm scenes are up to date");
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  const featureCount = recorded.reduce((n, s) => n + s.expected.length, 0);
  console.log(`Wrote ${recorded.length} scenes, ${featureCount} features`);
}
