import { readFileSync } from "fs";
import { SourceType } from "openskidata-format";
import { join } from "path";
import { parseSkiPassChart } from "./SkiPassChartParser.js";
import SkiPassJoiner, { JoinableSkiArea } from "./SkiPassJoiner.js";
import { SkiPassOverrideIndex, SkiPassOverrides } from "./SkiPassOverrides.js";

/**
 * The real ski pass chart joined against a snapshot of the real ski areas, so that a change to
 * the matcher that quietly loses matches or invents wrong ones fails here.
 *
 * Regenerate `__fixtures__/skiPassChart.csv` from the chart's CSV export (`getStormSkiingChartCSVURL`),
 * and `__fixtures__/skiAreas.json` from a production `ski_areas.geojson` reduced to the
 * `JoinableSkiArea` shape that `SkiPassEnrichment.toJoinableSkiArea` produces:
 *
 *   curl -sSL https://tiles.openskimap.org/geojson/ski_areas.geojson | \
 *     node src/skiPasses/__fixtures__/generateSkiAreas.js > src/skiPasses/__fixtures__/skiAreas.json
 *
 * Because the fixture is real data, every roster entry it cannot resolve is a gap in the shipped
 * `overrides.json` that would fail a real run too.
 */
const CHART_SHEET_ID = "677843907";

const RESOLVED_ENTRIES_FLOOR = 545;
const RESOLVED_SKI_AREAS_FLOOR = 435;

const csv = readFileSync(
  join(import.meta.dirname, "__fixtures__", "skiPassChart.csv"),
  "utf8",
);
const skiAreas = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "__fixtures__", "skiAreas.json"),
    "utf8",
  ),
) as JoinableSkiArea[];
const overrides = JSON.parse(
  readFileSync(join(import.meta.dirname, "overrides.json"), "utf8"),
) as SkiPassOverrides;

const chart = parseSkiPassChart(csv, CHART_SHEET_ID);
const result = new SkiPassJoiner(
  chart,
  new SkiPassOverrideIndex(overrides),
).join(skiAreas);

/** Roster entries name the same ski area once per pass it is on. */
function resolvedSkiAreas(): Set<string> {
  return new Set(
    result.matches
      .filter((match) => match.skiAreaIDs.length > 0)
      .map((match) => `${match.entry.location}|${match.entry.mountain}`),
  );
}

describe("joining the ski pass chart to real ski areas", () => {
  it("resolves nearly every roster entry", () => {
    const resolved = result.matches.filter(
      (match) => match.skiAreaIDs.length > 0,
    );
    // A floor, not a target: raise it when the matcher improves so that a regression cannot
    // slip past.
    expect(resolved.length).toBeGreaterThanOrEqual(RESOLVED_ENTRIES_FLOOR);
    expect(resolvedSkiAreas().size).toBeGreaterThanOrEqual(
      RESOLVED_SKI_AREAS_FLOOR,
    );
  });

  it("matches most entries on the name alone", () => {
    const byTier = new Map<string, number>();
    for (const match of result.matches) {
      byTier.set(match.tier, (byTier.get(match.tier) ?? 0) + 1);
    }
    // Guards against a change that resolves entries by loosening the fuzzy tier rather than by
    // normalizing names better.
    expect(byTier.get("exact") ?? 0).toBeGreaterThanOrEqual(180);
    expect(byTier.get("fuzzy") ?? 0).toBeLessThanOrEqual(25);
    expect(byTier.get("ambiguous") ?? 0).toBeLessThanOrEqual(2);
  });

  it("puts every ski area it matches in the region the chart gives", () => {
    const byID = new Map(skiAreas.map((skiArea) => [skiArea.id, skiArea]));
    for (const match of result.matches) {
      for (const id of match.skiAreaIDs) {
        expect(byID.get(id)).toBeDefined();
      }
    }
  });

  it("covers each pass's roster", () => {
    const counts = Object.fromEntries(
      result.catalog.passes.map((pass) => [pass.id, pass.skiAreaCount]),
    );
    expect(counts).toMatchInlineSnapshot(`
{
  "epic-day-22": 22,
  "epic-day-32": 32,
  "epic-day-all": 47,
  "epic-keystone-plus": 3,
  "epic-local": 52,
  "epic-military": 43,
  "epic-northeast-midweek": 21,
  "epic-northeast-value": 21,
  "epic-ohio": 4,
  "epic-standard": 71,
  "epic-summit-value": 2,
  "epic-tahoe-local": 9,
  "epic-tahoe-value": 3,
  "ikon-2-day": 9,
  "ikon-base": 92,
  "ikon-midwest": 10,
  "ikon-session": 53,
  "ikon-standard": 110,
  "indy-learn-to-turn": 40,
  "indy-plus": 240,
  "indy-standard": 240,
  "mountain-collective": 38,
  "new-england-afternoon": 3,
  "new-england-bronze": 3,
  "new-england-college": 4,
  "new-england-college-limited": 3,
  "new-england-day": 4,
  "new-england-gold": 11,
  "new-england-nitro-limited": 3,
  "new-england-nitro-unlimited": 3,
  "new-england-silver": 3,
  "new-england-super-senior-child": 4,
  "powder-alliance": 19,
  "power-core": 10,
  "power-select": 13,
  "power-standard": 15,
  "snow-pass": 14,
  "snow-triple-play-east": 23,
}
`);
  });

  it("attaches a ski area's memberships to it", () => {
    const stowe = skiAreas.find(
      (skiArea) =>
        skiArea.name === "Stowe Mountain Resort" &&
        skiArea.subdivisions.includes("US-VT"),
    );
    expect(stowe).toBeDefined();
    const data = result.skiAreaData.get(stowe!.id);
    expect([...new Set(data?.skiPasses.map((pass) => pass.passID))]).toEqual([
      "epic-day-32",
      "epic-day-all",
      "epic-local",
      "epic-military",
      "epic-northeast-midweek",
      "epic-northeast-value",
      "epic-standard",
    ]);
    for (const membership of data!.skiPasses) {
      expect(membership.sources).toHaveLength(1);
      expect(membership.sources[0].type).toBe(SourceType.STORM_SKIING);
    }
  });

  it("covers the ski areas the pass names for a regional destination", () => {
    // https://www.ikonpass.com/en/destinations/valle-daosta names five: Courmayeur Mont Blanc,
    // Cervino, Espace San Bernardo (La Thuile and La Rosière), Monterosa Ski and Pila.
    const valleDAosta = result.matches.find(
      (match) => match.entry.mountain === "Valle d'Aosta",
    );
    expect(valleDAosta?.tier).toBe("override");
    expect(valleDAosta?.skiAreaNames.sort()).toEqual([
      "Courmayeur",
      "La Rosière",
      "La Thuile ski",
      "Monterosa Ski",
      "Pila ski",
      "Zermatt - Breuil-Cervinia, Breuil-Cervinia Ski Paradise",
    ]);
  });

  it("spreads a network roster entry over the ski areas it covers", () => {
    const innsbruck = result.matches.find(
      (match) => match.entry.mountain === "Innsbruck Ski & City Network",
    );
    expect(innsbruck?.tier).toBe("override");
    expect(innsbruck?.skiAreaNames.sort()).toEqual([
      "Axamer Lizum - Muttereralm",
      "Glungezer",
      "Kühtai",
      "Nordkette",
      "Patscherkofel Ski",
      "Rangger Köpfl",
      "Schlick 2000",
      "Stubaier Gletscher",
    ]);
  });
});
