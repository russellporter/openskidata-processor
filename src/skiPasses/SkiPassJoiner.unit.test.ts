import SkiPassJoiner, { JoinableSkiArea } from "./SkiPassJoiner";
import { SkiPassOverrideIndex } from "./SkiPassOverrides";
import { SkiPassRosterEntry } from "./SkiPassTypes";

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

function rosterEntry(
  mountain: string,
  options: Partial<SkiPassRosterEntry> = {},
): SkiPassRosterEntry {
  return {
    passID: "ikon",
    passName: "Ikon Pass",
    location: "U.S. - Vermont",
    mountain,
    memberships: [
      {
        passID: "ikon",
        passName: "Ikon Pass",
        tier: null,
        access: "7",
        yearJoined: 2018,
      },
    ],
    statistics: { averageSnowfallInCm: 500, skiableAreaInSqKm: 10 },
    baseElevationInMeters: null,
    summitElevationInMeters: null,
    ...options,
  };
}

const noOverrides = new SkiPassOverrideIndex({ matches: [], unmatchable: [] });

describe("SkiPassJoiner", () => {
  it("attaches memberships and the chart's figures to a matched ski area", () => {
    const result = new SkiPassJoiner([rosterEntry("Stowe")], noOverrides).join([
      skiArea("1", "Stowe Mountain Resort"),
    ]);

    expect(result.skiAreaData.get("1")).toEqual({
      skiPasses: [
        {
          passID: "ikon",
          passName: "Ikon Pass",
          tier: null,
          access: "7",
          yearJoined: 2018,
        },
      ],
      averageSnowfallInCm: 500,
      skiableAreaInSqKm: 10,
    });
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
      [rosterEntry("Green Mountain Network")],
      overrides,
    ).join([skiArea("1", "Stowe"), skiArea("2", "Sugarbush")]);

    expect([...result.skiAreaData.keys()].sort()).toEqual(["1", "2"]);
    expect(result.passes[0].skiAreaCount).toBe(2);
    // The chart's figures describe the network, not either ski area within it.
    expect(result.skiAreaData.get("1")?.averageSnowfallInCm).toBeNull();
    expect(result.skiAreaData.get("1")?.skiableAreaInSqKm).toBeNull();
  });

  it("does not duplicate a membership when two roster entries name one ski area", () => {
    const result = new SkiPassJoiner(
      [rosterEntry("Mountain High: East"), rosterEntry("Mountain High: West")],
      noOverrides,
    ).join([skiArea("1", "Mountain High")]);

    expect(result.skiAreaData.get("1")?.skiPasses).toHaveLength(1);
    expect(result.passes[0].skiAreaCount).toBe(1);
  });

  it("fails on a roster entry it cannot resolve, naming it", () => {
    expect(() =>
      new SkiPassJoiner([rosterEntry("Thrill Hills")], noOverrides).join([
        skiArea("1", "Stowe"),
      ]),
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
      [rosterEntry("Thrill Hills")],
      overrides,
    ).join([skiArea("1", "Stowe")]);

    expect(result.skiAreaData.size).toBe(0);
    expect(result.passes[0].unresolvedRosterEntries).toEqual([
      {
        mountain: "Thrill Hills",
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
      new SkiPassJoiner([rosterEntry("Thrill Hills")], overrides).join([
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
