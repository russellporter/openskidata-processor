import SkiAreaNameMatcher, { MatchableSkiArea } from "./SkiAreaNameMatcher.js";
import { SkiPassRosterEntry } from "./SkiPassTypes.js";

function skiArea(
  id: string,
  name: string,
  options: Partial<MatchableSkiArea> = {},
): MatchableSkiArea {
  return {
    id,
    name,
    countries: ["US"],
    subdivisions: ["US-VT"],
    minElevationInMeters: null,
    maxElevationInMeters: null,
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
    memberships: [],
    baseElevationInMeters: null,
    summitElevationInMeters: null,
    ...options,
  };
}

describe("SkiAreaNameMatcher", () => {
  it("matches identical names", () => {
    const matcher = new SkiAreaNameMatcher([skiArea("a", "Stowe")]);
    const result = matcher.match(rosterEntry("Stowe"));
    expect(result.tier).toBe("exact");
    expect(result.skiArea?.id).toBe("a");
  });

  it("matches once words that describe any ski area are dropped", () => {
    const matcher = new SkiAreaNameMatcher([
      skiArea("a", "Stowe Mountain Resort"),
    ]);
    expect(matcher.match(rosterEntry("Stowe")).tier).toBe("core");
  });

  it("matches names that differ only in spacing", () => {
    const matcher = new SkiAreaNameMatcher([skiArea("a", "Big Rock Mountain")]);
    expect(matcher.match(rosterEntry("Bigrock")).tier).toBe("squash");
  });

  it("matches a name contained in a longer one", () => {
    const matcher = new SkiAreaNameMatcher([
      skiArea("a", "Swain Ski & Snowboard Resort"),
      skiArea("b", "Bromley Mountain"),
    ]);
    const result = matcher.match(rosterEntry("Swain"));
    expect(result.tier).toBe("subset");
    expect(result.skiArea?.id).toBe("a");
  });

  it("matches a misspelling", () => {
    const matcher = new SkiAreaNameMatcher([
      skiArea("a", "Howelson Hill Ski Area"),
      skiArea("b", "Bromley Mountain"),
    ]);
    const result = matcher.match(rosterEntry("Howelsen Hill"));
    expect(result.tier).toBe("fuzzy");
    expect(result.skiArea?.id).toBe("a");
  });

  it("matches on the romanized half of a localized name", () => {
    const matcher = new SkiAreaNameMatcher([
      skiArea("a", "白馬さのさか, Hakuba Sanosaka Snow Resort", {
        countries: ["JP"],
        subdivisions: ["JP-20"],
      }),
    ]);
    expect(
      matcher.match(
        rosterEntry("Hakuba Sanosaka", { location: "Japan (Nagano)" }),
      ).skiArea?.id,
    ).toBe("a");
  });

  it("does not match a ski area in another region", () => {
    const matcher = new SkiAreaNameMatcher([
      skiArea("a", "Stowe", { countries: ["CA"], subdivisions: ["CA-QC"] }),
    ]);
    expect(matcher.match(rosterEntry("Stowe")).skiArea).toBeNull();
  });

  it("does not match on a single word shared with several ski areas", () => {
    // "Chamonix Mont-Blanc Valley" names a valley holding several ski areas, and matching it to
    // whichever one happens to sort first would be wrong.
    const matcher = new SkiAreaNameMatcher([
      skiArea("a", "Les Planards (Chamonix)", {
        countries: ["FR"],
        subdivisions: [],
      }),
      skiArea("b", "Aiguille du Midi (Chamonix)", {
        countries: ["FR"],
        subdivisions: [],
      }),
    ]);
    expect(
      matcher.match(
        rosterEntry("Chamonix Mont-Blanc Valley", {
          location: "Europe - France",
        }),
      ).skiArea,
    ).toBeNull();
  });

  it("does not match on a word left over from dropping a generic one", () => {
    // "Ski Welt" reduces to "welt", which is not a name the ski area is known by.
    const matcher = new SkiAreaNameMatcher([
      skiArea("a", "Puchis Welt in Puchberg", {
        countries: ["AT"],
        subdivisions: [],
      }),
    ]);
    expect(
      matcher.match(rosterEntry("Ski Welt", { location: "Europe - Austria" }))
        .skiArea,
    ).toBeNull();
  });

  it("reports several equally good candidates rather than picking one", () => {
    const matcher = new SkiAreaNameMatcher([
      skiArea("a", "Canaan Valley Ski Resort"),
      skiArea("b", "Canaan Valley Resort"),
    ]);
    const result = matcher.match(rosterEntry("Canaan Valley"));
    expect(result.tier).toBe("ambiguous");
    expect(result.skiArea).toBeNull();
    expect(result.candidates.map((candidate) => candidate.id).sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("breaks a tie on elevation when the names are equally close", () => {
    const matcher = new SkiAreaNameMatcher([
      skiArea("high", "Bear Mountain Resort", {
        minElevationInMeters: 2000,
        maxElevationInMeters: 2500,
      }),
      skiArea("low", "Bear Mountain Ski Area", {
        minElevationInMeters: 200,
        maxElevationInMeters: 400,
      }),
    ]);
    const result = matcher.match(
      rosterEntry("Bear Mountain", {
        baseElevationInMeters: 2010,
        summitElevationInMeters: 2490,
      }),
    );
    expect(result.skiArea?.id).toBe("high");
  });

  it("ignores a trailing region qualifier", () => {
    const matcher = new SkiAreaNameMatcher([
      skiArea("a", "Blue Mountain Resort", {
        countries: ["US"],
        subdivisions: ["US-PA"],
      }),
    ]);
    expect(
      matcher.match(
        rosterEntry("Blue Mountain PA", { location: "U.S. - Pennsylvania" }),
      ).skiArea?.id,
    ).toBe("a");
  });
});
