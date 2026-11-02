#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-enrich/src/iso3166.json`: the part of `iso3166-2-db` (with the
 * "osm" name provider, as `Geocoder.ts` selects it) that reverse geocoding reads -- for each
 * country its code and English name, for each region its name and code -- so that the Rust
 * port reads the same data rather than a hand-copied table.
 *
 * Usage: node rust/codegen/generate-iso3166-data.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { repoRoot } from "./tooling.mjs";

const require = createRequire(join(repoRoot, "package.json"));
const iso3166 = require("iso3166-2-db");
const version = require("iso3166-2-db/package.json").version;
iso3166.changeNameProvider("osm");

const outPath = join(repoRoot, "rust/crates/osd-enrich/src/iso3166.json");
const dataset = iso3166.getDataSet();
const countries = Object.fromEntries(
  Object.keys(dataset)
    .sort()
    .map((code) => {
      const country = dataset[code];
      return [
        code,
        {
          iso: country.iso,
          en: country.names.en,
          regions: country.regions.map((region) => [region.name, region.iso]),
        },
      ];
    }),
);
const generated =
  JSON.stringify({ source: `iso3166-2-db@${version}`, countries }) + "\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date with iso3166-2-db@${version}.\nRun: node rust/codegen/generate-iso3166-data.mjs`,
    );
    process.exit(1);
  }
  console.log(`iso3166.json is up to date with iso3166-2-db@${version}`);
} else {
  writeFileSync(outPath, generated);
  console.log(
    `Wrote ${Object.keys(countries).length} countries from iso3166-2-db@${version}`,
  );
}
