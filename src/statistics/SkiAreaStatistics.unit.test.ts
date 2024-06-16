import { Activity, LiftType, RunDifficulty } from "openskidata-format";
import { LiftObject, MapObjectType, RunObject } from "../clustering/MapObject";
import { skiAreaStatistics } from "./SkiAreaStatistics";

describe("SkiAreaStatistics", () => {
  it("should count a run", () => {
    const run: RunObject = {
      _id: "1",
      _key: "1",
      type: MapObjectType.Run,
      activities: [Activity.Downhill],
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
    };

    const statistics = skiAreaStatistics([run]);

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

  it("should count a lift", () => {
    const lift: LiftObject = {
      _id: "1",
      _key: "1",
      type: MapObjectType.Lift,
      liftType: LiftType.Gondola,
      activities: [Activity.Downhill],
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

    const statistics = skiAreaStatistics([lift]);

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

  it("should not count run polygons in length calculation", () => {
    const run: RunObject = {
      _id: "1",
      _key: "1",
      type: MapObjectType.Run,
      activities: [Activity.Downhill],
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
    };

    const statistics = skiAreaStatistics([run]);

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

it("should not count backcountry activity in mixed use runs", () => {
  const run: RunObject = {
    _id: "1",
    _key: "1",
    type: MapObjectType.Run,
    activities: [Activity.Downhill, Activity.Backcountry],
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
  };

  const statistics = skiAreaStatistics([run]);

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
