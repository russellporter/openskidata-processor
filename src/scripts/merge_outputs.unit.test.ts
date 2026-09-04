import { SkiPass, SkiPassCatalog, SourceType } from "openskidata-format";
import { mergeSkiPasses } from "./merge_outputs.js";

function pass(options: Partial<SkiPass> = {}): SkiPass {
  return {
    type: "skiPass",
    id: "ikon-standard",
    name: "Ikon",
    brandID: "ikon",
    brandName: "Ikon Pass",
    sources: [{ type: SourceType.STORM_SKIING, id: "1!AH1" }],
    skiAreaCount: 0,
    skiAreaIDs: [],
    unresolvedRosterEntries: [],
    ...options,
  };
}

function catalog(passes: SkiPass[]): SkiPassCatalog {
  return {
    brands: [
      {
        type: "skiPassBrand",
        id: "ikon",
        name: "Ikon Pass",
        sources: [{ type: SourceType.STORM_SKIING, id: "1!AH1" }],
      },
    ],
    passes,
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
        catalog([pass({ skiAreaIDs: ["a", "b"], skiAreaCount: 2 })]),
        catalog([pass({ skiAreaIDs: ["b", "c"], skiAreaCount: 2 })]),
      ]),
    ).toEqual(
      catalog([pass({ skiAreaIDs: ["a", "b", "c"], skiAreaCount: 3 })]),
    );
  });

  it("keeps a roster entry unresolved only when no region resolved it", () => {
    // Vermont resolved Stowe but not Mt. Buller; Australia the other way around.
    const merged = mergeSkiPasses([
      catalog([
        pass({ skiAreaIDs: ["stowe"], unresolvedRosterEntries: [buller] }),
      ]),
      catalog([
        pass({ skiAreaIDs: ["buller"], unresolvedRosterEntries: [stowe] }),
      ]),
    ]);

    expect(merged.passes[0].unresolvedRosterEntries).toEqual([]);
    expect(merged.passes[0].skiAreaIDs).toEqual(["buller", "stowe"]);
  });

  it("keeps an entry no region could resolve", () => {
    const merged = mergeSkiPasses([
      catalog([pass({ unresolvedRosterEntries: [stowe, buller] })]),
      catalog([pass({ unresolvedRosterEntries: [buller] })]),
    ]);

    expect(merged.passes[0].unresolvedRosterEntries).toEqual([buller]);
  });

  it("unions the passes' own sources", () => {
    const merged = mergeSkiPasses([
      catalog([
        pass({
          id: "snow-pass",
          sources: [{ type: SourceType.STORM_SKIING, id: "1!JK1" }],
        }),
      ]),
      catalog([
        pass({
          id: "snow-pass",
          sources: [{ type: SourceType.STORM_SKIING, id: "1!KR1" }],
        }),
      ]),
    ]);

    expect(merged.passes[0].sources).toEqual([
      { type: SourceType.STORM_SKIING, id: "1!JK1" },
      { type: SourceType.STORM_SKIING, id: "1!KR1" },
    ]);
  });

  it("carries through a pass only one region produced", () => {
    const merged = mergeSkiPasses([
      catalog([pass({ id: "epic-standard", name: "Epic" })]),
      catalog([pass({ id: "ikon-standard" })]),
    ]);

    expect(merged.passes.map((p) => p.id)).toEqual([
      "epic-standard",
      "ikon-standard",
    ]);
  });
});
