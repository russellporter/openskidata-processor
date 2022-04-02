import { isArangoInvalidGeometryError } from "./ArangoHelpers";

describe("isArangoInvalidGeometryError", () => {
  it("is true for matching error", () => {
    expect(
      isArangoInvalidGeometryError({
        response: {
          body: { errorMessage: "AQL: Polygon is not valid (while executing)" },
        },
      })
    ).toBe(true);
  });
  it("is false for other error", () => {
    expect(
      isArangoInvalidGeometryError({
        response: {
          body: { errorMessage: "AQL: Connection error" },
        },
      })
    ).toBe(false);
  });
});
