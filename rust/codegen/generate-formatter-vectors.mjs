#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-tags/tests/vectors.json` by driving the real TypeScript
 * formatters over a systematic corpus of OSM tag sets.
 *
 * `osd-tags` is the largest and highest-risk part of the port: roughly 5k lines of
 * accumulated domain knowledge about OSM tagging, where a wrong answer looks entirely
 * plausible. The hand-written unit tests are good but cover a few dozen cases; this drives
 * the live implementation over the cross-product of the tags that actually matter, so the
 * Rust port is checked against hundreds of cases including combinations nobody wrote a
 * test for.
 *
 * Requires `npm run build`, since it imports the compiled formatters from `dist/`.
 *
 * Usage: node rust/codegen/generate-formatter-vectors.mjs [--check]
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const outPath = join(repoRoot, "rust/crates/osd-tags/tests/vectors.json");

const pkg = JSON.parse(
  readFileSync(
    join(repoRoot, "node_modules/openskidata-format/package.json"),
    "utf8",
  ),
);

const { formatRun } = await import(
  join(repoRoot, "dist/transforms/RunFormatter.js")
);
const { formatLift } = await import(
  join(repoRoot, "dist/transforms/LiftFormatter.js")
);

/** A short line, so geometry never varies between cases. */
const LINE = {
  type: "LineString",
  coordinates: [
    [11.0, 47.0],
    [11.001, 47.0],
  ],
};

function runFeature(tags) {
  return {
    type: "Feature",
    geometry: LINE,
    properties: { type: "way", id: 1, tags },
  };
}

/** Properties that are not a function of the tags, so comparing them proves nothing. */
const VOLATILE = new Set([
  "id", // deferred sentinel for runs; a content hash elsewhere
  "elevationProfile", // added by a later stage
  "places", // added by geocoding
  "skiAreas", // added by clustering
  "viewportHint", // float-sensitive, ported separately at tolerance
]);

function stable(properties) {
  const out = {};
  for (const key of Object.keys(properties).sort()) {
    if (!VOLATILE.has(key)) out[key] = properties[key];
  }
  return out;
}

/**
 * Tag axes worth crossing. Chosen to exercise the branches that carry real logic:
 * lifecycle prefixes, multi-value piste:type, grooming defaults derived from difficulty,
 * oneway defaults per use, and the piste:*-versus-plain tag fallbacks.
 */
const LIFECYCLE_PREFIXES = [
  "",
  "proposed:",
  "planned:",
  "construction:",
  "disused:",
  "abandoned:",
];
const PISTE_TYPES = [
  "downhill",
  "nordic",
  "skitour",
  "sled",
  "hike",
  "sleigh",
  "ice_skate",
  "snow_park",
  "playground",
  "connection",
  "fatbike",
  "downhill;nordic",
  "nordic;skitour",
  "downhill;nordic;skitour",
  "nonsense",
];
const DIFFICULTIES = [
  undefined,
  "novice",
  "easy",
  "intermediate",
  "advanced",
  "expert",
  "freeride",
  "extreme",
  "nonsense",
];
const GROOMING = [
  undefined,
  "classic",
  "mogul",
  "classic+skating",
  "skating",
  "scooter",
  "backcountry",
  "nonsense",
];
const BOOLEANS = [undefined, "yes", "no", "nonsense"];

const runCases = [];

// Axis 1: lifecycle prefix crossed with piste type. Covers filtering and status.
for (const prefix of LIFECYCLE_PREFIXES) {
  for (const pisteType of PISTE_TYPES) {
    runCases.push({ [`${prefix}piste:type`]: pisteType });
  }
}

// Axis 2: difficulty crossed with grooming, on the two uses with grading scales. This is
// where the grooming default derived from difficulty lives.
for (const pisteType of ["downhill", "nordic", "skitour"]) {
  for (const difficulty of DIFFICULTIES) {
    for (const grooming of GROOMING) {
      const tags = { "piste:type": pisteType };
      if (difficulty !== undefined) tags["piste:difficulty"] = difficulty;
      if (grooming !== undefined) tags["piste:grooming"] = grooming;
      runCases.push(tags);
    }
  }
}

// Axis 3: the boolean-ish tags, each on its own, plus the piste:-prefixed variant where
// one exists, since the fallback order between them is real logic.
for (const key of [
  "oneway",
  "piste:oneway",
  "lit",
  "piste:lit",
  "gladed",
  "patrolled",
  "piste:patrolled",
  "piste:snowmaking",
  "piste:snowfarming",
  "tunnel",
]) {
  for (const value of BOOLEANS) {
    if (value === undefined) continue;
    runCases.push({ "piste:type": "downhill", [key]: value });
  }
}

// Axis 4: name, ref and description fallbacks between piste:* and plain tags.
for (const [plain, prefixed] of [
  ["name", "piste:name"],
  ["ref", "piste:ref"],
  ["description", "piste:description"],
]) {
  runCases.push({ "piste:type": "downhill", [plain]: "Plain Value" });
  runCases.push({ "piste:type": "downhill", [prefixed]: "Prefixed Value" });
  runCases.push({
    "piste:type": "downhill",
    [plain]: "Plain Value",
    [prefixed]: "Prefixed Value",
  });
}

// Axis 5: a few assorted extras.
runCases.push({ "piste:type": "downhill", "piste:abandoned": "yes" });
runCases.push({ "piste:type": "downhill", "piste:status": "abandoned" });
runCases.push({ "piste:type": "downhill", website: "https://example.com" });
runCases.push({ "piste:type": "downhill", wikidata: "Q42" });
runCases.push({ "piste:type": "downhill", "piste:grooming:priority": "1" });
runCases.push({ route: "ski" });
runCases.push({});

const runs = runCases.map((tags) => {
  let output;
  try {
    output = formatRun(runFeature(tags)).map((f) => stable(f.properties));
  } catch (error) {
    output = { error: String(error?.message ?? error) };
  }
  return { tags, output };
});

// Lifts. The aerialway/railway axis plus lifecycle prefixes.
const LIFT_KEYS = ["aerialway", "railway"];
const AERIALWAY_VALUES = [
  "cable_car",
  "gondola",
  "chair_lift",
  "mixed_lift",
  "drag_lift",
  "t-bar",
  "j-bar",
  "platter",
  "rope_tow",
  "magic_carpet",
  "zip_line",
  "station",
  "pylon",
  "nonsense",
];
const RAILWAY_VALUES = ["funicular", "rail", "narrow_gauge", "nonsense"];

const liftCases = [];
for (const prefix of LIFECYCLE_PREFIXES) {
  for (const value of AERIALWAY_VALUES) {
    liftCases.push({ [`${prefix}aerialway`]: value });
  }
  for (const value of RAILWAY_VALUES) {
    liftCases.push({ [`${prefix}railway`]: value });
  }
}
for (const key of [
  "oneway",
  "foot",
  "access",
  "aerialway:bubble",
  "aerialway:heating",
  "tunnel",
]) {
  for (const value of ["yes", "no"]) {
    liftCases.push({ aerialway: "chair_lift", [key]: value });
  }
}
for (const key of [
  "aerialway:occupancy",
  "aerialway:capacity",
  "aerialway:duration",
]) {
  for (const value of ["4", "2400", "7.5", "nonsense"]) {
    liftCases.push({ aerialway: "chair_lift", [key]: value });
  }
}
liftCases.push({ aerialway: "chair_lift", name: "Sunrise Express" });
liftCases.push({ aerialway: "chair_lift", ref: "A1" });
liftCases.push({ railway: "funicular", "railway:traffic_mode": "passenger" });
liftCases.push({});

const lifts = liftCases.map((tags) => {
  let output;
  try {
    const result = formatLift(runFeature(tags));
    output = result === null ? null : stable(result.properties);
  } catch (error) {
    output = { error: String(error?.message ?? error) };
  }
  return { tags, output };
});

const vectors = { formatVersion: pkg.version, runs, lifts };
/**
 * Run the emitted JSON through Prettier, so the checked-in file is both
 * Prettier-clean (CI runs `prettier --check` over the repo) and byte-stable against this
 * script's own `--check`. Without this the two checks fight each other.
 */
function prettify(json) {
  try {
    return execFileSync(
      join(repoRoot, "node_modules/.bin/prettier"),
      ["--parser", "json"],
      { input: json, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch (error) {
    console.warn(
      "Prettier unavailable or failed; emitting unformatted JSON. " +
        "`prettier --check` will likely fail until it is installed.",
      error?.message ?? error,
    );
    return json;
  }
}

const generated = prettify(JSON.stringify(vectors, null, 2) + "\n");

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: npm run build && node rust/codegen/generate-formatter-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("formatter vectors.json is up to date");
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated);
  const emptyRuns = runs.filter(
    (r) => Array.isArray(r.output) && r.output.length === 0,
  ).length;
  const nullLifts = lifts.filter((l) => l.output === null).length;
  console.log(
    `Wrote ${runs.length} run cases (${emptyRuns} filtered out) and ` +
      `${lifts.length} lift cases (${nullLifts} rejected)`,
  );
}
