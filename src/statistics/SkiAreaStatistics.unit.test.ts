import {
  FeatureType,
  LiftType,
  RunDifficulty,
  SkiAreaActivity,
} from "openskidata-format";
import { LiftObject, RunObject } from "../clustering/MapObject";
import { getPostgresTestConfig } from "../Config";
import { skiAreaStatistics } from "./SkiAreaStatistics";

describe("SkiAreaStatistics", () => {
  it("should count a run", async () => {
    const run: RunObject = {
      _id: "1",
      _key: "1",
      type: FeatureType.Run,
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
      snowmaking: null,
      snowfarming: null,
      viirsPixels: [],
      properties: {
        places: [],
      },
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
            "snowfarmingLengthInKm": 0,
            "snowmakingLengthInKm": 0,
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
      type: FeatureType.Lift,
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
      stationIds: [],
      isInSkiAreaPolygon: false,
      isInSkiAreaSite: false,
      properties: {
        places: [],
      },
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
      type: FeatureType.Run,
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
      snowmaking: null,
      snowfarming: null,
      viirsPixels: [],
      properties: {
        places: [],
      },
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

  it("should count snowmaking length for runs with snowmaking=true", async () => {
    const run: RunObject = {
      _id: "1",
      _key: "1",
      type: FeatureType.Run,
      activities: [SkiAreaActivity.Downhill],
      difficulty: RunDifficulty.INTERMEDIATE,
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
      snowmaking: true,
      snowfarming: null,
      viirsPixels: [],
      properties: {
        places: [],
      },
    };

    const statistics = await skiAreaStatistics(
      [run],
      getPostgresTestConfig(),
      null,
    );

    expect(
      statistics.runs.byActivity.downhill?.byDifficulty.intermediate
        ?.snowmakingLengthInKm,
    ).toBeGreaterThan(0);
    expect(
      statistics.runs.byActivity.downhill?.byDifficulty.intermediate
        ?.snowfarmingLengthInKm,
    ).toBe(0);
  });

  it("should count snowfarming length for runs with snowfarming=true", async () => {
    const run: RunObject = {
      _id: "1",
      _key: "1",
      type: FeatureType.Run,
      activities: [SkiAreaActivity.Downhill],
      difficulty: RunDifficulty.ADVANCED,
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
      snowmaking: null,
      snowfarming: true,
      viirsPixels: [],
      properties: {
        places: [],
      },
    };

    const statistics = await skiAreaStatistics(
      [run],
      getPostgresTestConfig(),
      null,
    );

    expect(
      statistics.runs.byActivity.downhill?.byDifficulty.advanced
        ?.snowfarmingLengthInKm,
    ).toBeGreaterThan(0);
    expect(
      statistics.runs.byActivity.downhill?.byDifficulty.advanced
        ?.snowmakingLengthInKm,
    ).toBe(0);
  });

  it("should not count snowmaking/snowfarming for runs without those properties", async () => {
    const run: RunObject = {
      _id: "1",
      _key: "1",
      type: FeatureType.Run,
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
      snowmaking: null,
      snowfarming: null,
      viirsPixels: [],
      properties: {
        places: [],
      },
    };

    const statistics = await skiAreaStatistics(
      [run],
      getPostgresTestConfig(),
      null,
    );

    expect(
      statistics.runs.byActivity.downhill?.byDifficulty.easy
        ?.snowmakingLengthInKm,
    ).toBe(0);
    expect(
      statistics.runs.byActivity.downhill?.byDifficulty.easy
        ?.snowfarmingLengthInKm,
    ).toBe(0);
  });

  it("should accumulate snowmaking/snowfarming lengths across multiple runs", async () => {
    const run1: RunObject = {
      _id: "1",
      _key: "1",
      type: FeatureType.Run,
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
      snowmaking: true,
      snowfarming: null,
      viirsPixels: [],
      properties: {
        places: [],
      },
    };

    const run2: RunObject = {
      _id: "2",
      _key: "2",
      type: FeatureType.Run,
      activities: [SkiAreaActivity.Downhill],
      difficulty: RunDifficulty.EASY,
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [0, 0.5],
        ],
      },
      geometryWithElevations: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [0, 0.5],
        ],
      },
      skiAreas: [],
      isBasisForNewSkiArea: true,
      isInSkiAreaPolygon: false,
      isInSkiAreaSite: false,
      snowmaking: true,
      snowfarming: null,
      viirsPixels: [],
      properties: {
        places: [],
      },
    };

    const statistics = await skiAreaStatistics(
      [run1, run2],
      getPostgresTestConfig(),
      null,
    );

    const snowmakingLength =
      statistics.runs.byActivity.downhill?.byDifficulty.easy
        ?.snowmakingLengthInKm || 0;

    // Should be approximately 111km + 55.5km = 166.5km
    expect(snowmakingLength).toBeGreaterThan(150);
  });
});
