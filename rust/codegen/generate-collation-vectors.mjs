#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-enrich/tests/collation_vectors.json`: what `String.prototype
 * .localeCompare` says about pairs of place-like strings, for the Rust `locale_compare`.
 *
 * `sortPlaces` orders places by `localeCompare`, i.e. by V8's ICU collation for the default
 * locale, so the order of `places` in every output file depends on it. The strings are real
 * place names in many scripts, the variations that distinguish collators (case, accents,
 * hyphens, apostrophes, spaces, digits, ligatures, composed against decomposed), and random
 * strings over those characters.
 *
 * Usage: node rust/codegen/generate-collation-vectors.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./tooling.mjs";
import { chance, int, pick, reseed } from "./osm-worlds.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-enrich/tests/collation_vectors.json",
);
reseed(20261106);

const NAMES =
  `Zürich|Zurich|München|Muenchen|Munich|Åre|Are|Ålesund|Alesund|Östersund|Oslo|Ørsta|Innsbruck|Chamonix-Mont-Blanc|Chamonix
Saint-Gervais-les-Bains|St. Anton am Arlberg|Sankt Anton|L'Alpe d'Huez|Alpe d'Huez|Val d'Isère|Val-d'Isère|Cortina d'Ampezzo
Garmisch-Partenkirchen|Zermatt|札幌市|長野県|ニセコ町|白馬村|新潟県|北海道|Niseko|Hakuba|Sapporo|Nagano|Aspen|Whistler|Banff|Bariloche
San Carlos de Bariloche|Queenstown|Hřebenka|Špindlerův Mlýn|Spindleruv Mlyn|Łódź|Lodz|Kraków|Krakow|Zakopane|Москва|Moskva|Київ|Kyiv|Kiev
Ελλάδα|Αθήνα|תל אביב|القاهرة|กรุงเทพมหานคร|서울|ソウル|北京市|臺北|Çanakkale|Canakkale|İstanbul|Istanbul|Ísafjörður|Reykjavík|Þingvellir
Ljubljana|Kranjska Gora|Bohinj|Cervinia|Breuil-Cervinia|Courmayeur|Sestriere|Livigno|Bormio|Sölden|Obergurgl|Ischgl|Kitzbühel|Saalbach-Hinterglemm
Mayrhofen|Zell am See|Schladming|Bad Gastein|Engelberg|Davos|Klosters|St. Moritz|Sankt Moritz|Saint-Moritz|Verbier|Crans-Montana|Les Arcs|La Plagne|Tignes
Méribel|Courchevel|Les Deux Alpes|Les 2 Alpes|Serre Chevalier|Isola 2000|Auron|Val Thorens|Les Menuires|Morzine|Avoriaz|Flaine|Megève|La Clusaz
Åsgårdstrand|Aalborg|Århus|Aarhus|Æbeltoft|Ærø|Œuvres|Oeuvres|Straße|Strasse|Großglockner|Grossglockner|ß|ss|Œ|Oe|Æ|Ae
Colorado|California|British Columbia|Alberta|Québec|Quebec|Nouveau-Brunswick|New Brunswick|Nova Scotia|Newfoundland and Labrador
Österreich|Austria|Schweiz|Suisse|Svizzera|Switzerland|Deutschland|Germany|Italia|Italy|France|Japan|日本|Norge|Norway|Sverige|Sweden|Suomi|Finland
United States|United Kingdom|Côte d'Ivoire|Cote d'Ivoire|São Paulo|Sao Paulo|São Tomé|Ñuñoa|Nunoa|Ñandú|Zaragoza|Ávila|Avila|Ñ|N|n|ñ`
    .split(/[|\n]/)
    .filter(Boolean);

const CHARS = [
  ..."abcxyzABCXYZ019 -'’.,_/",
  ..."äöüÄÖÜéèêëÉÈáàâãåÅøØæÆœŒßçÇñÑłŁšŠžŽčČřŘěĚůŮıİðÐþÞ",
  ..."αβγΑΒΓабвАБВ日本語한국어العربيةעברית",
  "́",
  "̈",
  "é",
  "é",
  "ẞ",
  "ﬁ",
  "Ⅰ",
  "½",
  "☃",
  "\u{1F3D4}",
];

const pool = new Set(NAMES);
// Case and accent variants of every name.
for (const name of NAMES) {
  pool.add(name.toLowerCase());
  pool.add(name.toUpperCase());
  pool.add(name.normalize("NFD"));
  pool.add(name.normalize("NFD").replace(/\p{M}/gu, ""));
  pool.add(" " + name);
  pool.add(name + " ");
  pool.add(name.replace(/[- ]/g, ""));
  pool.add(name.replace(/-/g, " "));
  pool.add(name + "-2");
  // Characters that collate as nothing: equal to the plain name at every level but "identical".
  pool.add(name.slice(0, 1) + "\u00ad" + name.slice(1));
  pool.add(name + "\u200b");
  pool.add(name + " 10");
  pool.add(name + " 9");
}
for (let i = 0; i < 700; i++) {
  pool.add(Array.from({ length: 1 + int(7) }, () => pick(CHARS)).join(""));
}
const strings = [...pool];

// A hundred tricky strings are compared with each other in full; the rest at random.
const pairs = [];
const tricky = strings.slice(0, 110);
for (const a of tricky.keys()) {
  for (const b of tricky.keys()) pairs.push([a, b]);
}
for (let n = 0; n < 24000; n++) {
  pairs.push([int(strings.length), int(strings.length)]);
}
const cases = pairs.map(([a, b]) => [
  a,
  b,
  Math.sign(strings[a].localeCompare(strings[b])),
]);

const generated = JSON.stringify({ strings, pairs: cases }) + "\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-collation-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("collation_vectors.json is up to date");
} else {
  writeFileSync(outPath, generated);
  const tally = { "-1": 0, 0: 0, 1: 0 };
  for (const c of cases) tally[c[2]]++;
  console.log(`Wrote ${strings.length} strings, ${cases.length} pairs`, tally);
}
