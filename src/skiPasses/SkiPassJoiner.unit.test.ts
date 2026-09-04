import { SourceType } from "openskidata-format";
import { SkiPassChart } from "./SkiPassChartParser";
import SkiPassJoiner, { JoinableSkiArea } from "./SkiPassJoiner";
import { SkiPassOverrideIndex } from "./SkiPassOverrides";
import { SkiPassRosterEntry } from "./SkiPassTypes";

const IKON_SOURCES = [{ type: SourceType.STORM_SKIING, id: "1!AH1" }];

/** The chart a set of roster entries would have come from, all on the Ikon roster. */
function chart(entries: SkiPassRosterEntry[]): SkiPassChart {
  return {
    entries,
    passes: [
      {
        id: "ikon-standard",
        name: "Ikon",
        brandID: "ikon",
        brandName: "Ikon Pass",
        chartBlockTitles: ["IKON PASS ROSTER"],
        accessColumn: "Ikon",
        yearJoinedColumn: "YEAR JOINED IKON",
      },
    ],
    brands: [
      {
        type: "skiPassBrand",
        id: "ikon",
        name: "Ikon Pass",
        sources: IKON_SOURCES,
      },
    ],
    sourcesByPassID: new Map([["ikon-standard", IKON_SOURCES]]),
  };
}

function skiArea(
  id: string,
  name: string,
  options: Partial<JoinableSkiArea> = {},
): JoinableSkiArea {
  return {
    id,
    name,
    countries: ["US"],
    subdivisions: ["US-VT"],
    minElevationInMeters: null,
    maxElevationInMeters: null,
    sources: [`skimap.org:${id}`],
    ...options,
  };
}

/** `cell` stands in for the chart cell the entry was read from. */
function rosterEntry(
  mountain: string,
  cell: string = "1!B2",
  options: Partial<SkiPassRosterEntry> = {},
): SkiPassRosterEntry {
  return {
    passID: "ikon-standard",
    passName: "Ikon",
    location: "U.S. - Vermont",
    mountain,
    memberships: [
      {
        passID: "ikon-standard",
        passName: "Ikon",
        brandID: "ikon",
        brandName: "Ikon Pass",
        access: "7",
        yearJoined: 2018,
        sources: [{ type: SourceType.STORM_SKIING, id: cell }],
      },
    ],
    baseElevationInMeters: null,
    summitElevationInMeters: null,
    ...options,
  };
}

const noOverrides = new SkiPassOverrideIndex({ matches: [], unmatchable: [] });

describe("SkiPassJoiner", () => {
  it("attaches memberships to a matched ski area", () => {
    const result = new SkiPassJoiner(
      chart([rosterEntry("Stowe")]),
      noOverrides,
    ).join([skiArea("1", "Stowe Mountain Resort")]);

    expect(result.skiAreaData.get("1")).toEqual({
      skiPasses: [
        {
          passID: "ikon-standard",
          passName: "Ikon",
          brandID: "ikon",
          brandName: "Ikon Pass",
          access: "7",
          yearJoined: 2018,
          sources: [{ type: SourceType.STORM_SKIING, id: "1!B2" }],
        },
      ],
    });
  });

  it("counts the ski areas an actual pass covers", () => {
    const result = new SkiPassJoiner(
      chart([rosterEntry("Stowe", "1!B2"), rosterEntry("Sugarbush", "1!B3")]),
      noOverrides,
    ).join([skiArea("1", "Stowe"), skiArea("2", "Sugarbush")]);

    expect(result.catalog.passes[0].skiAreaCount).toBe(2);
  });

  it("counts a ski area once however many roster entries name it", () => {
    const result = new SkiPassJoiner(
      chart([
        rosterEntry("Mountain High: East", "1!B2"),
        rosterEntry("Mountain High: West", "1!B3"),
      ]),
      new SkiPassOverrideIndex({
        matches: [
          {
            location: "U.S. - Vermont",
            mountain: "Mountain High: East",
            skiAreas: ["skimap.org:1"],
          },
          {
            location: "U.S. - Vermont",
            mountain: "Mountain High: West",
            skiAreas: ["skimap.org:1"],
          },
        ],
        unmatchable: [],
      }),
    ).join([skiArea("1", "Mountain High")]);

    expect(result.catalog.passes[0].skiAreaCount).toBe(1);
  });

  it("gives the pass the chart's sources for it", () => {
    const result = new SkiPassJoiner(
      chart([rosterEntry("Stowe")]),
      noOverrides,
    ).join([skiArea("1", "Stowe Mountain Resort")]);

    expect(result.catalog.passes[0].type).toBe("skiPass");
    expect(result.catalog.passes[0].sources).toEqual(IKON_SOURCES);
    expect(result.catalog.brands[0].type).toBe("skiPassBrand");
  });

  it("fans a network roster entry out to every ski area it covers", () => {
    const overrides = new SkiPassOverrideIndex({
      matches: [
        {
          location: "U.S. - Vermont",
          mountain: "Green Mountain Network",
          skiAreas: ["skimap.org:1", "skimap.org:2"],
        },
      ],
      unmatchable: [],
    });
    const result = new SkiPassJoiner(
      chart([rosterEntry("Green Mountain Network")]),
      overrides,
    ).join([skiArea("1", "Stowe"), skiArea("2", "Sugarbush")]);

    expect([...result.skiAreaData.keys()].sort()).toEqual(["1", "2"]);
    expect(result.catalog.passes[0].skiAreaCount).toBe(2);
  });

  it("does not duplicate a membership when two roster entries name one ski area", () => {
    const result = new SkiPassJoiner(
      chart([
        rosterEntry("Mountain High: East", "1!B2"),
        rosterEntry("Mountain High: West", "1!B3"),
      ]),
      noOverrides,
    ).join([skiArea("1", "Mountain High")]);

    const memberships = result.skiAreaData.get("1")?.skiPasses;
    expect(memberships).toHaveLength(1);
    // Both roster rows are kept as sources of the single membership.
    expect(memberships?.[0].sources).toEqual([
      { type: SourceType.STORM_SKIING, id: "1!B2" },
      { type: SourceType.STORM_SKIING, id: "1!B3" },
    ]);
    expect(result.catalog.passes[0].skiAreaCount).toBe(1);
  });

  it("fails on a roster entry it cannot resolve, naming it", () => {
    expect(() =>
      new SkiPassJoiner(chart([rosterEntry("Thrill Hills")]), noOverrides).join(
        [skiArea("1", "Stowe")],
      ),
    ).toThrow(/Thrill Hills/);
  });

  it("accepts a roster entry recorded as having no ski area to match", () => {
    const overrides = new SkiPassOverrideIndex({
      matches: [],
      unmatchable: [
        {
          location: "U.S. - Vermont",
          mountain: "Thrill Hills",
          reason: "Not in OpenStreetMap or Skimap.org",
        },
      ],
    });
    const result = new SkiPassJoiner(
      chart([rosterEntry("Thrill Hills")]),
      overrides,
    ).join([skiArea("1", "Stowe")]);

    expect(result.skiAreaData.size).toBe(0);
    expect(result.catalog.passes[0].unresolvedRosterEntries).toEqual([
      {
        name: "Thrill Hills",
        location: "U.S. - Vermont",
        reason: "Not in OpenStreetMap or Skimap.org",
      },
    ]);
  });

  it("fails when an override points at a ski area that is not in the data", () => {
    const overrides = new SkiPassOverrideIndex({
      matches: [
        {
          location: "U.S. - Vermont",
          mountain: "Thrill Hills",
          skiAreas: ["skimap.org:404"],
        },
      ],
      unmatchable: [],
    });
    expect(() =>
      new SkiPassJoiner(chart([rosterEntry("Thrill Hills")]), overrides).join([
        skiArea("1", "Stowe"),
      ]),
    ).toThrow(/skimap.org:404/);
  });

  it("rejects an override that is both matched and unmatchable", () => {
    expect(
      () =>
        new SkiPassOverrideIndex({
          matches: [
            {
              location: "U.S. - Vermont",
              mountain: "Stowe",
              skiAreas: ["skimap.org:1"],
            },
          ],
          unmatchable: [
            {
              location: "U.S. - Vermont",
              mountain: "Stowe",
              reason: "contradictory",
            },
          ],
        }),
    ).toThrow(/both matched and unmatchable/);
  });
});
