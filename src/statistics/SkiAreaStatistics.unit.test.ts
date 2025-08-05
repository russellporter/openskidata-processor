import { LiftType, RunDifficulty, SkiAreaActivity } from "openskidata-format";
import { LiftObject, MapObjectType, RunObject } from "../clustering/MapObject";
import { getPostgresTestConfig } from "../Config";
import { skiAreaStatistics } from "./SkiAreaStatistics";

describe("SkiAreaStatistics", () => {
  it("should count a run", async () => {
    const run: RunObject = {
      _id: "1",
      _key: "1",
      type: MapObjectType.Run,
      activities: [SkiAreaActivity.Downhill],
      difficulty: RunDifficulty.EASY,
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [0, 1],
        ],
      },
      geometryWithElevations: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [0, 1],
        ],
      },
      skiAreas: [],
      isBasisForNewSkiArea: true,
      isInSkiAreaPolygon: false,
      isInSkiAreaSite: false,
      viirsPixels: [],
    };

    const statistics = await skiAreaStatistics(
      [run],
      getPostgresTestConfig(),
      null,
    );

    expect(statistics).toMatchInlineSnapshot(`
{
  "lifts": {
    "byType": {},
  },
  "runs": {
    "byActivity": {
      "downhill": {
        "byDifficulty": {
          "easy": {
            "count": 1,
            "lengthInKm": 111.1950802335329,
          },
        },
      },
    },
  },
}
`);
  });

  it("should count a lift", async () => {
    const lift: LiftObject = {
      _id: "1",
      _key: "1",
      type: MapObjectType.Lift,
      liftType: LiftType.Gondola,
      activities: [SkiAreaActivity.Downhill],
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [0, 1],
        ],
      },
      geometryWithElevations: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [0, 1],
        ],
      },
      skiAreas: [],
      isInSkiAreaPolygon: false,
      isInSkiAreaSite: false,
    };

    const statistics = await skiAreaStatistics(
      [lift],
      getPostgresTestConfig(),
      null,
    );

    expect(statistics).toMatchInlineSnapshot(`
{
  "lifts": {
    "byType": {
      "gondola": {
        "count": 1,
        "lengthInKm": 111.1950802335329,
      },
    },
  },
  "runs": {
    "byActivity": {},
  },
}
`);
  });

  it("should not count run polygons in length calculation", async () => {
    const run: RunObject = {
      _id: "1",
      _key: "1",
      type: MapObjectType.Run,
      activities: [SkiAreaActivity.Downhill],
      difficulty: RunDifficulty.EASY,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [1, 0],
            [0, 0],
          ],
        ],
      },
      geometryWithElevations: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [1, 0],
            [0, 0],
          ],
        ],
      },
      skiAreas: [],
      isBasisForNewSkiArea: true,
      isInSkiAreaPolygon: false,
      isInSkiAreaSite: false,
      viirsPixels: [],
    };

    const statistics = await skiAreaStatistics(
      [run],
      getPostgresTestConfig(),
      null,
    );

    expect(statistics).toMatchInlineSnapshot(`
{
  "lifts": {
    "byType": {},
  },
  "runs": {
    "byActivity": {},
  },
}
`);
  });
});
