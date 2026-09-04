import { readFileSync } from "fs";
import { SourceType } from "openskidata-format";
import { join } from "path";
import { parseSkiPassChart } from "./SkiPassChartParser.js";
import { SkiPassRosterEntry } from "./SkiPassTypes.js";

const CHART_SHEET_ID = "677843907";

const csv = readFileSync(
  join(import.meta.dirname, "__fixtures__", "skiPassChart.csv"),
  "utf8",
);

function find(
  entries: SkiPassRosterEntry[],
  passID: string,
  mountain: string,
): SkiPassRosterEntry {
  const entry = entries.find(
    (candidate) =>
      candidate.passID === passID && candidate.mountain === mountain,
  );
  if (entry === undefined) {
    throw new Error(`No ${passID} entry for ${mountain}`);
  }
  return entry;
}

describe("parseSkiPassChart", () => {
  const { entries, sourcesByPassID, brands } = parseSkiPassChart(
    csv,
    CHART_SHEET_ID,
  );

  it("finds every roster in the chart", () => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      counts.set(entry.passID, (counts.get(entry.passID) ?? 0) + 1);
    }
    expect(Object.fromEntries([...counts].sort())).toEqual({
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
      "ikon-base": 80,
      "ikon-midwest": 10,
      "ikon-session": 53,
      "ikon-standard": 98,
      "indy-learn-to-turn": 40,
      "indy-plus": 232,
      "indy-standard": 232,
      "mountain-collective": 31,
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
      "powder-alliance": 20,
      "power-core": 10,
      "power-select": 13,
      "power-standard": 15,
      "snow-pass": 14,
      "snow-triple-play-east": 23,
    });
  });

  it("records the roster block title cell as each pass's source", () => {
    expect(
      sourcesByPassID.get("ikon-base")?.map((source) => source.id),
    ).toEqual(["677843907!AH1"]);
    // Two roster blocks: the main one and the "partners not on Ikon" annex.
    expect(
      sourcesByPassID.get("mountain-collective")?.map((source) => source.id),
    ).toEqual(["677843907!FP1", "677843907!GY1"]);
    // The chart has a roster of each pass alone and a combined roster of both.
    expect(
      sourcesByPassID.get("snow-pass")?.map((source) => source.id),
    ).toEqual(["677843907!JK1", "677843907!KR1"]);
    expect([...sourcesByPassID.keys()]).toHaveLength(38);
  });

  it("sources each membership at the ski area's cell in the roster", () => {
    expect(
      find(entries, "ikon-standard", "Winter Park").memberships[0].sources,
    ).toEqual([{ type: SourceType.STORM_SKIING, id: "677843907!AI64" }]);
  });

  it("fills the location down the rows of a group", () => {
    // Only the first ski area of each location group carries the location in the chart.
    expect(find(entries, "indy-standard", "Castle Mountain").location).toBe(
      "Canada - Alberta",
    );
    expect(find(entries, "indy-standard", "Pass Powderkeg").location).toBe(
      "Canada - Alberta",
    );
  });

  it("turns each populated product column into its own pass membership", () => {
    expect(find(entries, "ikon-standard", "Mt. Buller").memberships).toEqual([
      {
        passID: "ikon-standard",
        passName: "Ikon",
        brandID: "ikon",
        brandName: "Ikon Pass",
        access: "7, 26, 27",
        yearJoined: 2018,
        sources: [{ type: SourceType.STORM_SKIING, id: "677843907!AI8" }],
      },
    ]);
    expect(find(entries, "ikon-base", "Mt. Buller").memberships).toEqual([
      {
        passID: "ikon-base",
        passName: "Ikon Base",
        brandID: "ikon",
        brandName: "Ikon Pass",
        access: "5, 26, 27",
        yearJoined: 2018,
        sources: [{ type: SourceType.STORM_SKIING, id: "677843907!AI8" }],
      },
    ]);
  });

  it("records a membership for a roster with no access column", () => {
    expect(find(entries, "ikon-midwest", "Boyne Mountain").memberships).toEqual(
      [
        {
          passID: "ikon-midwest",
          passName: "Ikon Pass Midwest",
          brandID: "ikon",
          brandName: "Ikon Pass",
          access: null,
          yearJoined: null,
          sources: [{ type: SourceType.STORM_SKIING, id: "677843907!CV8" }],
        },
      ],
    );
  });

  it("does not invent a pass when every product column is blank", () => {
    // Cypress is on New England Gold, but the other nine product columns are blank.
    expect(
      entries
        .filter((entry) => entry.mountain === "Cypress")
        .map((entry) => entry.passID)
        .sort(),
    ).toEqual([
      "ikon-base",
      "ikon-session",
      "ikon-standard",
      "new-england-gold",
    ]);
  });

  it("merges a ski area listed in two rosters of the same pass", () => {
    // Marmot Basin is in both the Mountain Collective roster and its "partners not on Ikon" annex.
    const marmot = entries.filter(
      (entry) =>
        entry.mountain === "Marmot Basin" &&
        entry.passID === "mountain-collective",
    );
    expect(marmot).toHaveLength(1);
    expect(marmot[0].memberships).toHaveLength(1);
    // Both listings are kept as sources of the one membership.
    expect(marmot[0].memberships[0].sources).toEqual([
      { type: SourceType.STORM_SKIING, id: "677843907!FQ11" },
      { type: SourceType.STORM_SKIING, id: "677843907!GX8" },
    ]);
  });

  it("reads a roster block that lists two passes at once", () => {
    // The combined roster covers the ski areas on both the Snow Pass and Snow Triple Play East.
    const snowPassMountains = new Set(
      entries
        .filter((entry) => entry.passID === "snow-pass")
        .map((entry) => entry.mountain),
    );
    const triplePlay = entries.find(
      (entry) =>
        entry.passID === "snow-triple-play-east" &&
        snowPassMountains.has(entry.mountain),
    )!;
    const snowPass = find(entries, "snow-pass", triplePlay.mountain);
    expect(snowPass.memberships.map((m) => m.passID)).toEqual(["snow-pass"]);
    expect(triplePlay.memberships.map((m) => m.passID)).toEqual([
      "snow-triple-play-east",
    ]);
  });

  it("converts the chart's imperial elevations to metric", () => {
    const castle = find(entries, "indy-standard", "Castle Mountain");
    // 4,675 ft base, 7,529 ft summit.
    expect(castle.baseElevationInMeters).toBeCloseTo(1424.9, 1);
    expect(castle.summitElevationInMeters).toBeCloseTo(2294.8, 1);
  });

  it("throws when the chart layout has changed beyond recognition", () => {
    expect(() => parseSkiPassChart("a,b,c\n1,2,3\n", CHART_SHEET_ID)).toThrow(
      /Could not find the ski pass chart header row/,
    );
  });

  it("throws on a roster it does not know about", () => {
    const renamed = csv.replace("INDY PASS ROSTER", "SOME NEW PASS ROSTER");
    expect(() => parseSkiPassChart(renamed, CHART_SHEET_ID)).toThrow(
      /Unknown ski pass roster block/,
    );
  });

  it("publishes only the configured natural pass brands", () => {
    expect(brands.map((brand) => [brand.id, brand.name])).toEqual([
      ["indy", "Indy Pass"],
      ["ikon", "Ikon Pass"],
      ["epic", "Epic Pass"],
      ["power", "Power Pass"],
      ["new-england", "New England Pass"],
    ]);
  });
});
