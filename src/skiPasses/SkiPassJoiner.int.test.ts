import { readFileSync } from "fs";
import { join } from "path";
import { parseSkiPassChart } from "./SkiPassChartParser";
import SkiPassJoiner, { JoinableSkiArea } from "./SkiPassJoiner";
import { SkiPassOverrideIndex, SkiPassOverrides } from "./SkiPassOverrides";

/**
 * The real ski pass chart joined against a snapshot of the real ski areas, so that a change to
 * the matcher that quietly loses matches or invents wrong ones fails here.
 */
const chart = readFileSync(
  join(__dirname, "__fixtures__", "skiPassChart.csv"),
  "utf8",
);
const skiAreas = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "skiAreas.json"), "utf8"),
) as JoinableSkiArea[];
const overrides = JSON.parse(
  readFileSync(join(__dirname, "overrides.json"), "utf8"),
) as SkiPassOverrides;

/**
 * Roster entries that resolve against current data but not against this snapshot, which predates
 * the ski areas being added to OpenStreetMap. They are excluded here rather than in overrides.json
 * so that the shipped override file stays a description of current data.
 */
const missingFromSnapshot = [
  "Dolomiti Superski",
  "Skirama Dolomiti",
  "Valle d'Aosta",
  "Andermatt-Sedrun",
  "Portes du Soleil",
];

const entries = parseSkiPassChart(chart);
const overrideIndex = new SkiPassOverrideIndex({
  matches: overrides.matches,
  unmatchable: [
    ...overrides.unmatchable,
    ...entries
      .filter((entry) => missingFromSnapshot.includes(entry.mountain))
      .map((entry) => ({
        location: entry.location,
        mountain: entry.mountain,
        reason: "Added to OpenStreetMap after this fixture was captured",
      })),
  ],
});

const result = new SkiPassJoiner(entries, overrideIndex).join(skiAreas);

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
    // 515 roster rows covering 438 distinct ski areas. This is a floor, not a target: raise it
    // when the matcher improves so that a regression cannot slip past.
    expect(resolved.length).toBeGreaterThanOrEqual(508);
    expect(resolvedSkiAreas().size).toBeGreaterThanOrEqual(423);
  });

  it("matches most entries on the name alone", () => {
    const byTier = new Map<string, number>();
    for (const match of result.matches) {
      byTier.set(match.tier, (byTier.get(match.tier) ?? 0) + 1);
    }
    // Guards against a change that resolves entries by loosening the fuzzy tier rather than by
    // normalizing names better.
    expect(byTier.get("exact") ?? 0).toBeGreaterThanOrEqual(180);
    expect(byTier.get("fuzzy") ?? 0).toBeLessThanOrEqual(20);
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
      result.passes.map((pass) => [pass.id, pass.skiAreaCount]),
    );
    expect(counts).toMatchInlineSnapshot(`
{
  "epic": 69,
  "ikon": 104,
  "ikon-2-day": 9,
  "ikon-midwest": 10,
  "indy": 240,
  "mountain-collective": 39,
  "new-england": 11,
  "powder-alliance": 19,
  "power": 15,
  "snow-triple-play-east": 16,
}
`);
  });

  it("attaches the chart's figures to a ski area it matched on its own", () => {
    const stowe = skiAreas.find(
      (skiArea) =>
        skiArea.name === "Stowe Mountain Resort" &&
        skiArea.subdivisions.includes("US-VT"),
    );
    expect(stowe).toBeDefined();
    const data = result.skiAreaData.get(stowe!.id);
    expect([...new Set(data?.skiPasses.map((pass) => pass.passID))]).toEqual([
      "epic",
    ]);
    expect(data?.averageSnowfallInCm).toBeGreaterThan(0);
    expect(data?.skiableAreaInSqKm).toBeGreaterThan(0);
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
