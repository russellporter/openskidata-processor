import { parseSkiPassLocation } from "./SkiPassLocations";

describe("parseSkiPassLocation", () => {
  it("parses a U.S. state", () => {
    expect(parseSkiPassLocation("U.S. - Colorado")).toEqual([
      { country: "US", subdivision: "US-CO" },
    ]);
  });

  it("parses a Canadian province", () => {
    expect(parseSkiPassLocation("Canada - British Columbia")).toEqual([
      { country: "CA", subdivision: "CA-BC" },
    ]);
  });

  it("parses a Japanese prefecture to its numeric ISO code", () => {
    expect(parseSkiPassLocation("Japan (Nagano)")).toEqual([
      { country: "JP", subdivision: "JP-20" },
    ]);
  });

  it("parses a European country without a subdivision", () => {
    expect(parseSkiPassLocation("Europe - Austria")).toEqual([
      { country: "AT", subdivision: null },
    ]);
  });

  it("tolerates the chart's missing space after the separator", () => {
    expect(parseSkiPassLocation("Europe -Czech Republic")).toEqual([
      { country: "CZ", subdivision: null },
    ]);
  });

  it("parses a standalone country", () => {
    expect(parseSkiPassLocation("New Zealand")).toEqual([
      { country: "NZ", subdivision: null },
    ]);
  });

  it("parses a ski area that straddles a border into both countries", () => {
    expect(
      parseSkiPassLocation("Europe - Switzerland, Europe - France"),
    ).toEqual([
      { country: "CH", subdivision: null },
      { country: "FR", subdivision: null },
    ]);
  });

  it("throws on an unrecognized location rather than searching the whole world", () => {
    expect(() => parseSkiPassLocation("Mars - Olympus Mons")).toThrow(
      /Unrecognized ski pass chart location/,
    );
    expect(() => parseSkiPassLocation("U.S. - Atlantis")).toThrow(
      /Unknown U.S. state/,
    );
  });
});
