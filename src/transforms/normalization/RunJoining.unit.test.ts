import { SourceType } from "openskidata-format";
import * as TestHelpers from "../../TestHelpers";
import { isPartOfSameRun } from "./RunJoining";

describe("RunJoining", () => {
  describe("isPartOfSameRun", () => {
    it("ignores different sources, IDs, and geometries", () => {
      expect(
        isPartOfSameRun(
          TestHelpers.mockRunFeature({
            id: "1",
            sources: [{ type: SourceType.OPENSTREETMAP, id: "1" }],
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
          }),
          TestHelpers.mockRunFeature({
            id: "2",
            sources: [{ type: SourceType.OPENSTREETMAP, id: "2" }],
            geometry: {
              type: "LineString",
              coordinates: [
                [2, 2],
                [3, 3],
              ],
            },
          })
        )
      ).toBe(true);
    });
  });
});
