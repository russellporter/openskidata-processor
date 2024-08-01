import overpassBBoxQuery from "./overpassBBoxQuery";

describe("overpassBBoxQuery", () => {
  it("produces valid query for normal bbox", () => {
    expect(overpassBBoxQuery([-13, -90, 65, 90])).toMatchInlineSnapshot(
      `"[bbox:-90,-13,90,65]"`,
    );
  });

  it("produces valid query for bbox crossing the antimeridian", () => {
    expect(overpassBBoxQuery([65, -90, 191.5, 90])).toMatchInlineSnapshot(
      `"[bbox:-90,65,90,-168.5]"`,
    );
  });
});
