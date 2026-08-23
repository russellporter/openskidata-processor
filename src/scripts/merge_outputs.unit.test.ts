import { SkiPass, SourceType } from "openskidata-format";
import { mergeSkiPasses } from "./merge_outputs";

function pass(options: Partial<SkiPass> = {}): SkiPass {
  return {
    type: "skiPass",
    id: "ikon",
    name: "Ikon Pass",
    sources: [{ type: SourceType.STORM_SKIING, id: "1!AH1" }],
    skiAreaCount: 0,
    skiAreaIDs: [],
    unresolvedRosterEntries: [],
    ...options,
  };
}

const stowe = {
  name: "Stowe",
  location: "U.S. - Vermont",
  reason: "no matching ski area",
};
const buller = {
  name: "Mt. Buller",
  location: "Australia",
  reason: "no matching ski area",
};

describe("mergeSkiPasses", () => {
  it("unions the ski areas each region resolved", () => {
    expect(
      mergeSkiPasses([
        [pass({ skiAreaIDs: ["a", "b"], skiAreaCount: 2 })],
        [pass({ skiAreaIDs: ["b", "c"], skiAreaCount: 2 })],
      ]),
    ).toEqual([pass({ skiAreaIDs: ["a", "b", "c"], skiAreaCount: 3 })]);
  });

  it("keeps a roster entry unresolved only when no region resolved it", () => {
    // Vermont resolved Stowe but not Mt. Buller; Australia the other way around.
    const merged = mergeSkiPasses([
      [pass({ skiAreaIDs: ["stowe"], unresolvedRosterEntries: [buller] })],
      [pass({ skiAreaIDs: ["buller"], unresolvedRosterEntries: [stowe] })],
    ]);

    expect(merged[0].unresolvedRosterEntries).toEqual([]);
    expect(merged[0].skiAreaIDs).toEqual(["buller", "stowe"]);
  });

  it("keeps an entry no region could resolve", () => {
    const merged = mergeSkiPasses([
      [pass({ unresolvedRosterEntries: [stowe, buller] })],
      [pass({ unresolvedRosterEntries: [buller] })],
    ]);

    expect(merged[0].unresolvedRosterEntries).toEqual([buller]);
  });

  it("unions the passes' own sources", () => {
    const merged = mergeSkiPasses([
      [
        pass({
          id: "snow-pass",
          sources: [{ type: SourceType.STORM_SKIING, id: "1!JK1" }],
        }),
      ],
      [
        pass({
          id: "snow-pass",
          sources: [{ type: SourceType.STORM_SKIING, id: "1!KR1" }],
        }),
      ],
    ]);

    expect(merged[0].sources).toEqual([
      { type: SourceType.STORM_SKIING, id: "1!JK1" },
      { type: SourceType.STORM_SKIING, id: "1!KR1" },
    ]);
  });

  it("carries through a pass only one region produced", () => {
    const merged = mergeSkiPasses([
      [pass({ id: "epic", name: "Epic Pass" })],
      [pass({ id: "ikon" })],
    ]);

    expect(merged.map((p) => p.id)).toEqual(["epic", "ikon"]);
  });
});
