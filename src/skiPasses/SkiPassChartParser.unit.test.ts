import { readFileSync } from "fs";
import { join } from "path";
import { parseSkiPassChart } from "./SkiPassChartParser";
import { SkiPassRosterEntry } from "./SkiPassTypes";

const chart = readFileSync(
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
  const entries = parseSkiPassChart(chart);

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
      "snow-triple-play-east": 16,
    });
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
      },
      {
        passID: "ikon",
        passName: "Ikon Pass",
        tier: "base",
        access: "5, 26, 27",
        yearJoined: 2018,
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
  });

  it("converts the chart's imperial figures to metric", () => {
    const castle = find(entries, "indy", "Castle Mountain");
    // 335 inches of snow, 3,592 acres, 4,675 ft base, 7,529 ft summit.
    expect(castle.statistics.averageSnowfallInCm).toBeCloseTo(850.9, 1);
    expect(castle.statistics.skiableAreaInSqKm).toBeCloseTo(14.54, 2);
    expect(castle.baseElevationInMeters).toBeCloseTo(1424.9, 1);
    expect(castle.summitElevationInMeters).toBeCloseTo(2294.8, 1);
  });

  it("throws when the chart layout has changed beyond recognition", () => {
    expect(() => parseSkiPassChart("a,b,c\n1,2,3\n")).toThrow(
      /Could not find the ski pass chart header row/,
    );
  });

  it("throws on a roster it does not know about", () => {
    const renamed = chart.replace("INDY PASS ROSTER", "SOME NEW PASS ROSTER");
    expect(() => parseSkiPassChart(renamed)).toThrow(
      /Unknown ski pass roster block/,
    );
  });
});
