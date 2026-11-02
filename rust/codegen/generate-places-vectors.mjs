#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-enrich/tests/places_vectors.json`: `sortPlaces` and
 * `uniquePlaces` from the real `PlaceUtils`, on random lists of places drawn from a small pool
 * of names (so there are ties, duplicates and nulls), including names that differ only in case,
 * in accents, or in being canonically equivalent (`localeCompare` returns 0 for those without
 * the strings being equal, which `sortPlaces` treats as equal at once).
 *
 * Requires a build (`npm run build`). Usage: node rust/codegen/generate-places-vectors.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./tooling.mjs";
import { chance, int, pick, reseed } from "./osm-worlds.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-enrich/tests/places_vectors.json",
);
const { sortPlaces, uniquePlaces } = await import(
  join(repoRoot, "dist/transforms/PlaceUtils.js")
);

reseed(20261107);

const NAMES = [
  "Innsbruck",
  "innsbruck",
  "Zürich",
  "Zurich",
  "Zürich",
  "Zürich",
  "Åre",
  "Are",
  "Ålesund",
  "Chamonix-Mont-Blanc",
  "Chamonix",
  "St. Anton",
  "Sankt Anton",
  "Tirol",
  "Tyrol",
  "Savoie",
  "Vaud",
  "札幌市",
  "長野県",
  "Colorado",
  "Québec",
  "Quebec",
  "Österreich",
  "Austria",
  "Switzerland",
  "Suisse",
  "A",
  "a",
  "B",
  "b",
  "10",
  "9",
  "",
  " ",
  "-",
  "Ñ",
  "N",
];
const CODES = ["AT", "CH", "FR", "JP", "US", "CA", "NO"];
const REGION_CODES = [
  null,
  "AT-7",
  "AT-8",
  "CH-VS",
  "FR-ARA",
  "JP-01",
  "US-CO",
  "CA-QC",
];

function place() {
  const maybe = (p) => (chance(p) ? pick(NAMES) : null);
  return {
    iso3166_1Alpha2: pick(CODES),
    iso3166_2: pick(REGION_CODES),
    localized: {
      en: { country: pick(NAMES), region: maybe(0.7), locality: maybe(0.7) },
    },
  };
}

const cases = [];
for (let n = 0; n < 600; n++) {
  const places = Array.from({ length: int(9) }, place);
  // Make repeats likely: copy some, and some that differ only in the country's name.
  if (places.length > 2 && chance(0.5))
    places.push(structuredClone(pick(places)));
  if (places.length > 2 && chance(0.3)) {
    const copy = structuredClone(pick(places));
    copy.localized.en.country = pick(NAMES);
    places.push(copy);
  }
  // Places that compare equal to another while being different: only the codes differ, so
  // the order they come out in is the stable sort's.
  for (let k = 0; k < 2 && places.length > 1 && chance(0.7); k++) {
    const twin = structuredClone(pick(places));
    twin.iso3166_1Alpha2 = pick(CODES);
    twin.iso3166_2 = pick(REGION_CODES);
    places.splice(int(places.length + 1), 0, twin);
  }
  cases.push({
    places,
    sorted: sortPlaces(structuredClone(places)),
    unique: uniquePlaces(structuredClone(places)),
  });
}

// Lists with few distinct names, so that very many places tie. Under 64 places V8 sorts by
// insertion, step for step what the Rust port does, even when the comparison is inconsistent
// (the composed and decomposed "Zürich" below compare equal without being the same string, which
// makes `sortPlaces`' comparison intransitive). From 64 places V8 merges runs; the port uses a
// stable sort there, which agrees only for a consistent comparison, so those lists leave out the
// canonically equivalent pair.
const FEW = [
  "Tirol",
  "Tyrol",
  "Z\u00fcrich",
  "Zu\u0308rich",
  "Vaud",
  "",
  "a",
  "A",
];
const CONSISTENT = [
  "Tirol",
  "Tyrol",
  "Z\u00fcrich",
  "Zurich",
  "Vaud",
  "",
  "a",
  "A",
];
for (let n = 0; n < 50; n++) {
  const long = n >= 40;
  const names = long ? CONSISTENT : FEW;
  const places = Array.from(
    { length: long ? 64 + int(60) : 25 + int(38) },
    () => ({
      iso3166_1Alpha2: pick(CODES),
      iso3166_2: pick(REGION_CODES),
      localized: {
        en: {
          country: pick(names.slice(0, 3)),
          region: chance(0.5) ? pick(names.slice(2, 5)) : null,
          locality: chance(0.5) ? pick(names.slice(4)) : null,
        },
      },
    }),
  );
  cases.push({
    places,
    sorted: sortPlaces(structuredClone(places)),
    unique: uniquePlaces(structuredClone(places)),
  });
}

// Many shorter lists of the same kind: how a sort finds its first run only shows when the
// comparison is inconsistent and the list is arranged just so.
for (let n = 0; n < 700; n++) {
  const places = Array.from({ length: 4 + int(14) }, () => ({
    iso3166_1Alpha2: pick(CODES),
    iso3166_2: pick(REGION_CODES),
    localized: {
      en: {
        country: pick(FEW.slice(0, 4)),
        region: chance(0.5) ? pick(FEW.slice(2, 5)) : null,
        locality: chance(0.6) ? pick(FEW.slice(2, 6)) : null,
      },
    },
  }));
  cases.push({
    places,
    sorted: sortPlaces(structuredClone(places)),
    unique: uniquePlaces(structuredClone(places)),
  });
}

const generated =
  '{"cases":[\n' + cases.map((c) => JSON.stringify(c)).join(",\n") + "\n]}\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-places-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("places_vectors.json is up to date");
} else {
  writeFileSync(outPath, generated);
  console.log(`Wrote ${cases.length} cases`);
}
