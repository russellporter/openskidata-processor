import { readFileSync } from "fs";
import { SourceType } from "openskidata-format";
import { join } from "path";
import { parseSkiPassChart } from "./SkiPassChartParser";
import { SkiPassRosterEntry } from "./SkiPassTypes";

const CHART_SHEET_ID = "677843907";

const csv = readFileSync(
  join(__dirname, "__fixtures__", "skiPassChart.csv"),
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
  const { entries, sourcesByPassID } = parseSkiPassChart(csv, CHART_SHEET_ID);

  it("finds every roster in the chart", () => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      counts.set(entry.passID, (counts.get(entry.passID) ?? 0) + 1);
    }
    expect(Object.fromEntries([...counts].sort())).toEqual({
      epic: 71,
      ikon: 98,
      "ikon-2-day": 9,
      "ikon-midwest": 10,
      indy: 233,
      "mountain-collective": 32,
      "new-england": 11,
      "powder-alliance": 20,
      power: 15,
      "snow-pass": 25,
      "snow-triple-play-east": 25,
    });
  });

  it("records the roster block title cell as each pass's source", () => {
    expect(
      Object.fromEntries(
        [...sourcesByPassID]
          .sort()
          .map(([passID, sources]) => [
            passID,
            sources.map((source) => source.id),
          ]),
      ),
    ).toEqual({
      epic: ["677843907!EA1"],
      ikon: ["677843907!AH1"],
      "ikon-2-day": ["677843907!BO1"],
      "ikon-midwest": ["677843907!CU1"],
      indy: ["677843907!A1"],
      // Two roster blocks: the main one and the "partners not on Ikon" annex.
      "mountain-collective": ["677843907!FP1", "677843907!GY1"],
      "new-england": ["677843907!OS1"],
      "powder-alliance": ["677843907!NJ1"],
      power: ["677843907!LZ1"],
      // The chart has a roster of each pass alone and a combined roster of both.
      "snow-pass": ["677843907!JK1", "677843907!KR1"],
      "snow-triple-play-east": ["677843907!ID1", "677843907!KR1"],
    });
  });

  it("sources each membership at the ski area's cell in the roster", () => {
    expect(find(entries, "ikon", "Winter Park").memberships[0].sources).toEqual(
      [{ type: SourceType.STORM_SKIING, id: "677843907!AI64" }],
    );
  });

  it("fills the location down the rows of a group", () => {
    // Only the first ski area of each location group carries the location in the chart.
    expect(find(entries, "indy", "Castle Mountain").location).toBe(
      "Canada - Alberta",
    );
    expect(find(entries, "indy", "Pass Powderkeg").location).toBe(
      "Canada - Alberta",
    );
  });

  it("reads one membership per populated tier column", () => {
    expect(find(entries, "ikon", "Mt. Buller").memberships).toEqual([
      {
        passID: "ikon",
        passName: "Ikon Pass",
        tier: null,
        access: "7, 26, 27",
        yearJoined: 2018,
        sources: [{ type: SourceType.STORM_SKIING, id: "677843907!AI8" }],
      },
      {
        passID: "ikon",
        passName: "Ikon Pass",
        tier: "base",
        access: "5, 26, 27",
        yearJoined: 2018,
        sources: [{ type: SourceType.STORM_SKIING, id: "677843907!AI8" }],
      },
    ]);
  });

  it("records a membership for a roster with no tier columns at all", () => {
    expect(find(entries, "ikon-midwest", "Boyne Mountain").memberships).toEqual(
      [
        {
          passID: "ikon-midwest",
          passName: "Ikon Pass Midwest",
          tier: null,
          access: null,
          yearJoined: null,
          sources: [{ type: SourceType.STORM_SKIING, id: "677843907!CV8" }],
        },
      ],
    );
  });

  it("ignores the cross-references a roster carries for other passes", () => {
    // Cypress's row in the New England roster also fills in its Ikon columns. Those describe the
    // Ikon pass, whose own roster already lists Cypress, so the New England entry must not pick
    // them up as memberships of its own.
    const newEngland = find(entries, "new-england", "Cypress");
    expect([...new Set(newEngland.memberships.map((m) => m.passID))]).toEqual([
      "new-england",
    ]);
    expect(
      entries
        .filter((entry) => entry.mountain === "Cypress")
        .map((entry) => entry.passID)
        .sort(),
    ).toEqual(["ikon", "new-england"]);
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
    const snowPass = find(entries, "snow-pass", "Bromont");
    const triplePlay = find(entries, "snow-triple-play-east", "Bromont");
    expect(snowPass.memberships.map((m) => m.passID)).toEqual(["snow-pass"]);
    expect(triplePlay.memberships.map((m) => m.passID)).toEqual([
      "snow-triple-play-east",
    ]);
  });

  it("converts the chart's imperial elevations to metric", () => {
    const castle = find(entries, "indy", "Castle Mountain");
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
});
