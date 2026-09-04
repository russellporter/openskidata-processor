import { SkiPassRegion, parseSkiPassLocation } from "./SkiPassLocations.js";
import { SkiPassMatchTier, SkiPassRosterEntry } from "./SkiPassTypes.js";

/** A ski area the matcher can match a roster entry against. */
export interface MatchableSkiArea {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 codes of the ski area's places. */
  countries: string[];
  /** ISO 3166-2 codes of the ski area's places. */
  subdivisions: string[];
  minElevationInMeters: number | null;
  maxElevationInMeters: number | null;
}

export interface NameMatchResult {
  tier: SkiPassMatchTier;
  skiArea: MatchableSkiArea | null;
  /** Ski areas considered but not settled on, for the unresolved-entry report. */
  candidates: MatchableSkiArea[];
}

// Words that describe what a place is rather than which place it is. Dropping them lets
// "Stowe" match "Stowe Mountain Resort". Includes the equivalents in the languages the chart
// and OpenStreetMap use for the ski areas on these rosters.
const GENERIC_TOKENS = new Set([
  "and",
  "alpine",
  "arena",
  "area",
  "areas",
  "at",
  "bergbahn",
  "bergbahnen",
  "bowl",
  "center",
  "centre",
  "centrum",
  "club",
  "de",
  "desqui",
  "du",
  "esqui",
  "estacio",
  "field",
  "fields",
  "glacier",
  "gletscher",
  "gletscherbahn",
  "gletscherbahnen",
  "hill",
  "hills",
  "inc",
  "kayak",
  "merkezi",
  "montagne",
  "mountain",
  "mountains",
  "mtn",
  "of",
  "park",
  "recreation",
  "resort",
  "resorts",
  "scistica",
  "ski",
  "skiarena",
  "skiarea",
  "skicircus",
  "skigebiet",
  "skiing",
  "skiresort",
  "slope",
  "slopes",
  "snow",
  "snowpark",
  "sport",
  "sports",
  "station",
  "the",
  "touristique",
  "village",
  "winter",
]);

const ABBREVIATIONS = new Map([
  ["mt", "mount"],
  ["mtn", "mountain"],
  ["st", "saint"],
  ["ste", "sainte"],
  ["ft", "fort"],
]);

// Both the chart and OpenStreetMap disambiguate ski areas by appending the region they are in
// ("Blue Mountain PA", "Mt. Baldy ON", "Levi, Finland", "Big Powderhorn (UP)").
const REGION_SUFFIXES = new Set([
  ...[
    "ak",
    "az",
    "ca",
    "co",
    "ct",
    "ia",
    "id",
    "il",
    "in",
    "ma",
    "md",
    "me",
    "mi",
    "mn",
    "mo",
    "mt",
    "nc",
    "nd",
    "nh",
    "nj",
    "nm",
    "nv",
    "ny",
    "oh",
    "or",
    "pa",
    "sd",
    "tn",
    "ut",
    "va",
    "vt",
    "wa",
    "wi",
    "wv",
    "wy",
  ],
  ...["ab", "bc", "nl", "ns", "on", "qc"],
  ...[
    "andorra",
    "austria",
    "canada",
    "czechia",
    "finland",
    "france",
    "germany",
    "italy",
    "japan",
    "norway",
    "scotland",
    "slovenia",
    "spain",
    "sweden",
    "switzerland",
    "turkey",
    "usa",
  ],
  // The chart marks Michigan's Upper Peninsula.
  "up",
]);

const NAME_SEPARATORS = [":", "/", "–", "—", " - "];

// A fuzzy match needs both a high similarity and a clear lead over the runner up, so that a
// region with several similarly named ski areas produces no match rather than a wrong one.
const FUZZY_MINIMUM_SIMILARITY = 0.62;
const FUZZY_MINIMUM_LEAD = 0.05;
// Margins for choosing between several candidates that matched at the same tier.
const TIE_BREAK_MINIMUM_NAME_LEAD = 0.08;
const TIE_BREAK_MINIMUM_ELEVATION_LEAD_IN_METERS = 150;
// A single shared token is only enough to match on if it is distinctive.
const MINIMUM_DISTINCTIVE_TOKEN_LENGTH = 4;

function stripDiacritics(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "");
}

/** Lowercased, punctuation-free, with abbreviations expanded and region suffixes dropped. */
export function normalizeName(value: string): string {
  const cleaned = stripDiacritics(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ");
  const tokens = cleaned
    .split(" ")
    .filter((token) => token.length > 0)
    .map((token) => ABBREVIATIONS.get(token) ?? token);
  while (tokens.length > 1 && REGION_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

/** The normalized name with words that describe any ski area removed. */
export function coreName(value: string): string {
  const normalized = normalizeName(value);
  const tokens = normalized
    .split(" ")
    .filter((token) => token.length > 0 && !GENERIC_TOKENS.has(token));
  return tokens.length > 0 ? tokens.join(" ") : normalized;
}

/** Spaces removed, so that "Bigrock" and "Big Rock" compare equal. */
function squashedNames(value: string): string[] {
  return [
    normalizeName(value).replace(/ /g, ""),
    coreName(value).replace(/ /g, ""),
  ];
}

function splitOnSeparators(value: string): string[] {
  const results: string[] = [];
  for (const separator of NAME_SEPARATORS) {
    const index = value.indexOf(separator);
    if (index === -1) {
      continue;
    }
    const before = value.slice(0, index);
    const after = value.slice(index + separator.length);
    results.push(before, after, `${before} ${after}`);
  }
  return results;
}

function addAlias(aliases: string[], value: string): void {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length > 0 && !aliases.includes(collapsed)) {
    aliases.push(collapsed);
  }
}

/**
 * Names the chart may be referring to. The chart qualifies names in ways OpenStreetMap does not:
 * "Silver Creek (Snowshoe)", "Sun Valley: Bald", "Shanty Creek - Schuss".
 */
export function chartNameAliases(name: string): string[] {
  const aliases: string[] = [];
  addAlias(aliases, name);
  addAlias(aliases, name.replace(/\(.*?\)/g, ""));
  for (const parenthetical of name.match(/\((.*?)\)/g) ?? []) {
    addAlias(
      aliases,
      parenthetical.slice(1, -1).replace(/^(inc\.?|incl\.?)\s+/i, ""),
    );
  }
  for (const alias of [...aliases]) {
    for (const variant of splitOnSeparators(alias)) {
      addAlias(aliases, variant);
    }
  }
  return aliases;
}

/**
 * Names a ski area feature may be known by. Ski area names often hold several names at once:
 * localized pairs like "白馬さのさか, Hakuba Sanosaka Snow Resort", or alternates separated by
 * semicolons.
 */
export function skiAreaNameAliases(name: string): string[] {
  const aliases: string[] = [];
  addAlias(aliases, name);
  for (const part of name.split(/[;,]/)) {
    addAlias(aliases, part);
  }
  for (const alias of [...aliases]) {
    addAlias(aliases, alias.replace(/\(.*?\)/g, ""));
    for (const parenthetical of alias.match(/\((.*?)\)/g) ?? []) {
      addAlias(aliases, parenthetical.slice(1, -1));
    }
    for (const variant of splitOnSeparators(alias)) {
      addAlias(aliases, variant);
    }
  }
  return aliases.filter((alias) =>
    /[a-z]/.test(stripDiacritics(alias).toLowerCase()),
  );
}

function characterBigrams(value: string): Map<string, number> {
  const bigrams = new Map<string, number>();
  for (let index = 0; index < value.length - 1; index++) {
    const bigram = value.slice(index, index + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }
  return bigrams;
}

/**
 * Sørensen-Dice coefficient over character bigrams: 1 for identical strings, 0 for nothing in
 * common. Chosen over edit distance because the names that differ do so by whole added or
 * dropped words ("Tsugaike Kogen" vs "Tsugaike Mountain Resort"), which edit distance punishes
 * far more heavily than a reader would.
 */
export function nameSimilarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  if (a.length < 2 || b.length < 2) {
    return 0;
  }
  const left = characterBigrams(a);
  const right = characterBigrams(b);
  let shared = 0;
  let total = 0;
  for (const [bigram, count] of left) {
    total += count;
    shared += Math.min(count, right.get(bigram) ?? 0);
  }
  for (const count of right.values()) {
    total += count;
  }
  return (2 * shared) / total;
}

function bestSimilarity(a: string[], b: string[]): number {
  let best = 0;
  for (const left of a) {
    for (const right of b) {
      best = Math.max(best, nameSimilarity(left, right));
    }
  }
  return best;
}

/**
 * One name's tokens, for the subset tier. The full name's token count is kept alongside the core
 * tokens so that a name reduced to a single token only by dropping generic words is not treated
 * as if it were a genuine one-word name.
 */
interface NameTokens {
  core: Set<string>;
  wholeNameTokenCount: number;
}

function nameTokens(name: string): NameTokens {
  return {
    core: new Set(splitTokens(coreName(name))),
    wholeNameTokenCount: splitTokens(normalizeName(name)).length,
  };
}

function splitTokens(name: string): string[] {
  return name.split(" ").filter((token) => token.length > 0);
}

interface IndexedSkiArea {
  skiArea: MatchableSkiArea;
  normalized: Set<string>;
  cores: Set<string>;
  squashed: Set<string>;
  /** Core names with spaces removed, for fuzzy comparison. */
  squashedCores: string[];
  tokens: NameTokens[];
}

function indexSkiArea(skiArea: MatchableSkiArea): IndexedSkiArea {
  const aliases = skiAreaNameAliases(skiArea.name);
  return {
    skiArea,
    normalized: new Set(aliases.map(normalizeName)),
    cores: new Set(aliases.map(coreName)),
    squashed: new Set(aliases.flatMap(squashedNames)),
    squashedCores: [
      ...new Set(aliases.map((alias) => coreName(alias).replace(/ /g, ""))),
    ],
    tokens: aliases.map(nameTokens),
  };
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

/**
 * Matches ski pass roster entries to ski areas by name, within the region the chart places them
 * in. Deterministic: the same inputs always produce the same matches, and an entry that cannot be
 * resolved to exactly one ski area is reported rather than guessed at.
 */
export default class SkiAreaNameMatcher {
  private readonly byCountry = new Map<string, IndexedSkiArea[]>();

  constructor(skiAreas: MatchableSkiArea[]) {
    for (const skiArea of skiAreas) {
      const indexed = indexSkiArea(skiArea);
      for (const country of new Set(skiArea.countries)) {
        const existing = this.byCountry.get(country);
        if (existing === undefined) {
          this.byCountry.set(country, [indexed]);
        } else {
          existing.push(indexed);
        }
      }
    }
  }

  match(entry: SkiPassRosterEntry): NameMatchResult {
    const pool = this.candidatePool(parseSkiPassLocation(entry.location));
    const aliases = chartNameAliases(entry.mountain);
    const normalized = new Set(aliases.map(normalizeName));
    const cores = new Set(aliases.map(coreName));
    const squashed = new Set(aliases.flatMap(squashedNames));
    const tokens = aliases.map(nameTokens).filter((t) => t.core.size > 0);

    const tiers: [SkiPassMatchTier, (candidate: IndexedSkiArea) => boolean][] =
      [
        ["exact", (c) => intersects(c.normalized, normalized)],
        ["core", (c) => intersects(c.cores, cores)],
        ["squash", (c) => intersects(c.squashed, squashed)],
        [
          "subset",
          (candidate) =>
            candidate.tokens.some((candidateTokens) =>
              tokens.some(
                (entryTokens) =>
                  candidateTokens.core.size > 0 &&
                  (isSubset(entryTokens.core, candidateTokens.core) ||
                    isSubset(candidateTokens.core, entryTokens.core)) &&
                  this.isDistinctiveEnough(pool, entryTokens, candidateTokens),
              ),
            ),
        ],
      ];

    for (const [tier, predicate] of tiers) {
      const matches = pool.filter(predicate);
      if (matches.length > 0) {
        return this.settle(entry, tier, cores, matches);
      }
    }

    // Fuzzy matching compares whole names rather than the split aliases the earlier tiers use:
    // a qualifier like "(Hachimantai Resort)" is a strong enough signal to match a whole name
    // against, but on its own it names a region rather than a ski area.
    const wholeNameCores = new Set(
      [entry.mountain, entry.mountain.replace(/\(.*?\)/g, "")].map(coreName),
    );
    return this.fuzzyMatch(entry, wholeNameCores, cores, pool);
  }

  private candidatePool(regions: SkiPassRegion[]): IndexedSkiArea[] {
    const pool = new Map<string, IndexedSkiArea>();
    for (const region of regions) {
      for (const candidate of this.byCountry.get(region.country) ?? []) {
        // A ski area with no subdivision is still reachable: it is in the right country, and the
        // geocoder simply did not resolve a region for it.
        if (
          region.subdivision !== null &&
          candidate.skiArea.subdivisions.length > 0 &&
          !candidate.skiArea.subdivisions.includes(region.subdivision)
        ) {
          continue;
        }
        pool.set(candidate.skiArea.id, candidate);
      }
    }
    return [...pool.values()];
  }

  /**
   * Guards the subset tier: matching on a single shared token is only safe when that token is
   * distinctive and unique in the region. Without this, "Chamonix Mont-Blanc Valley" matches any
   * of the several ski areas whose name mentions Chamonix.
   */
  private isDistinctiveEnough(
    pool: IndexedSkiArea[],
    entryTokens: NameTokens,
    candidateTokens: NameTokens,
  ): boolean {
    const smaller =
      entryTokens.core.size <= candidateTokens.core.size
        ? entryTokens
        : candidateTokens;
    if (smaller.core.size >= 2) {
      return true;
    }
    // "Ski Welt" reduces to the single core token "welt", which is not a name anyone would
    // recognize the ski area by; "Ischgl" is. Only the latter is enough to match on.
    if (smaller.wholeNameTokenCount !== 1) {
      return false;
    }
    const [token] = smaller.core;
    if (
      token === undefined ||
      token.length < MINIMUM_DISTINCTIVE_TOKEN_LENGTH ||
      GENERIC_TOKENS.has(token)
    ) {
      return false;
    }
    const matchingSkiAreas = pool.filter((candidate) =>
      candidate.tokens.some((tokens) => tokens.core.has(token)),
    );
    return matchingSkiAreas.length === 1;
  }

  private fuzzyMatch(
    entry: SkiPassRosterEntry,
    wholeNameCores: Set<string>,
    cores: Set<string>,
    pool: IndexedSkiArea[],
  ): NameMatchResult {
    const squashedCores = [...wholeNameCores].map((core) =>
      core.replace(/ /g, ""),
    );
    const scored = pool
      .map((candidate) => ({
        candidate,
        similarity: Math.max(
          bestSimilarity([...wholeNameCores], [...candidate.cores]),
          bestSimilarity(squashedCores, candidate.squashedCores),
        ),
      }))
      .sort((a, b) => b.similarity - a.similarity);

    const best = scored[0];
    if (best === undefined || best.similarity < FUZZY_MINIMUM_SIMILARITY) {
      return {
        tier: "none",
        skiArea: null,
        candidates: scored.slice(0, 3).map((entry) => entry.candidate.skiArea),
      };
    }

    const bestCore = coreName(best.candidate.skiArea.name);
    const runnerUp = scored.find(
      (other) => coreName(other.candidate.skiArea.name) !== bestCore,
    );
    if (
      runnerUp !== undefined &&
      best.similarity - runnerUp.similarity < FUZZY_MINIMUM_LEAD
    ) {
      return {
        tier: "none",
        skiArea: null,
        candidates: scored.slice(0, 3).map((entry) => entry.candidate.skiArea),
      };
    }

    // Ski areas that share the best candidate's name are duplicates of each other rather than
    // alternatives, so they are settled between like any other tie.
    const tied = scored
      .filter((other) => coreName(other.candidate.skiArea.name) === bestCore)
      .map((other) => other.candidate);
    return this.settle(entry, "fuzzy", cores, tied);
  }

  /** Chooses between several candidates that matched at the same tier. */
  private settle(
    entry: SkiPassRosterEntry,
    tier: SkiPassMatchTier,
    cores: Set<string>,
    matches: IndexedSkiArea[],
  ): NameMatchResult {
    if (matches.length === 1) {
      return { tier, skiArea: matches[0].skiArea, candidates: [] };
    }

    const byName = [...matches].sort((a, b) => {
      const difference =
        bestSimilarity([...cores], [...b.cores]) -
        bestSimilarity([...cores], [...a.cores]);
      return difference !== 0
        ? difference
        : a.skiArea.id.localeCompare(b.skiArea.id);
    });
    const nameLead =
      bestSimilarity([...cores], [...byName[0].cores]) -
      bestSimilarity([...cores], [...byName[1].cores]);
    if (nameLead >= TIE_BREAK_MINIMUM_NAME_LEAD) {
      return { tier, skiArea: byName[0].skiArea, candidates: [] };
    }

    // The chart's claimed elevations disagree with surveyed data often enough that they can only
    // break a tie, never confirm or reject a match on their own.
    const byElevation = matches
      .map((candidate) => ({
        candidate,
        difference: elevationDifference(entry, candidate.skiArea),
      }))
      .filter(
        (scored): scored is { candidate: IndexedSkiArea; difference: number } =>
          scored.difference !== null,
      )
      .sort((a, b) => a.difference - b.difference);
    if (
      byElevation.length === 1 ||
      (byElevation.length > 1 &&
        byElevation[1].difference - byElevation[0].difference >
          TIE_BREAK_MINIMUM_ELEVATION_LEAD_IN_METERS)
    ) {
      return {
        tier,
        skiArea: byElevation[0].candidate.skiArea,
        candidates: [],
      };
    }

    return {
      tier: "ambiguous",
      skiArea: null,
      candidates: matches.map((candidate) => candidate.skiArea),
    };
  }
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) {
    if (b.has(value)) {
      return true;
    }
  }
  return false;
}

function elevationDifference(
  entry: SkiPassRosterEntry,
  skiArea: MatchableSkiArea,
): number | null {
  if (
    entry.summitElevationInMeters === null ||
    skiArea.maxElevationInMeters === null
  ) {
    return null;
  }
  let difference = Math.abs(
    skiArea.maxElevationInMeters - entry.summitElevationInMeters,
  );
  if (
    entry.baseElevationInMeters !== null &&
    skiArea.minElevationInMeters !== null
  ) {
    difference += Math.abs(
      skiArea.minElevationInMeters - entry.baseElevationInMeters,
    );
  }
  return difference;
}
