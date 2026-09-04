import {
  LiftType,
  RunDifficulty,
  RunFeature,
  RunUse,
  SkiAreaActivity,
  SourceType,
  Status,
} from "openskidata-format";
import * as TestHelpers from "../TestHelpers.js";
import {
  simplifiedLiftFeature,
  simplifiedRunFeature,
  simplifiedSkiAreaFeature,
} from "../TestHelpers.js";
import clusterSkiAreas from "./ClusterSkiAreas.js";
import { Config, getPostgresTestConfig } from "../Config.js";

vi.setConfig({ testTimeout: 60 * 1000 });

// vi.mock factories are hoisted above module-level declarations, so the counter
// has to be hoisted with them. Keeping it in a holder (rather than inside the
// factory) preserves the per-test reset that beforeEach relies on.
const uuidMock = vi.hoisted(() => {
  let count = 0;
  return {
    reset: () => {
      count = 0;
    },
    uuid: () => "mock-UUID-" + count++,
  };
});
vi.mock("../utils/uuid", () => {
  return { uuid: uuidMock.uuid };
});

beforeEach(() => {
  uuidMock.reset();
});

/**
 * Integration test that verifies the SQLite clustering correctly
 * associates lifts and runs with ski areas.
 *
 * This test creates a scenario with:
 * - A Skimap.org ski area (point geometry)
 * - A lift and run nearby that should be associated
 *
 * The expected behavior is that the lift and run should have
 * the ski area ID in their skiAreas property after clustering.
 *
 * This test was originally written to reproduce a bug where SQLite
 * clustering resulted in empty skiAreas arrays, but that has been fixed.
 */
it("correctly associates lifts and runs with ski areas", async () => {
  const paths = TestHelpers.getFilePaths();

  TestHelpers.mockFeatureFiles(
    [
      TestHelpers.mockSkiAreaFeature({
        id: "test-ski-area-1",
        name: "Test Ski Area",
        status: Status.Operating,
        activities: [SkiAreaActivity.Downhill],
        sources: [{ type: SourceType.SKIMAP_ORG, id: "12345" }],
        geometry: {
          type: "Point",
          coordinates: [11.122066, 47.557111],
        },
      }),
    ],
    [
      TestHelpers.mockLiftFeature({
        id: "test-lift-1",
        name: "Test Lift",
        liftType: LiftType.TBar,
        status: Status.Operating,
        geometry: {
          type: "LineString",
          coordinates: [
            [11.1223444, 47.5572422],
            [11.1164297, 47.5581563],
          ],
        },
      }),
    ],
    [
      TestHelpers.mockRunFeature({
        id: "test-run-1",
        name: "Test Run",
        uses: [RunUse.Downhill],
        difficulty: RunDifficulty.EASY,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [11.1164229, 47.558125],
              [11.1163655, 47.5579742],
              [11.1171866, 47.5576413],
              [11.1164229, 47.558125],
            ],
          ],
        },
      }),
    ],
    paths.intermediate,
  );

  // Create test config
  const testConfig: Config = {
    workingDir: TestHelpers.getTempWorkingDir(),
    outputDir: TestHelpers.getTempWorkingDir(),
    bbox: null,
    elevationServer: null,
    geocodingServer: null,
    snowCover: null,
    skiPasses: null,
    tiles: null,
    postgresCache: getPostgresTestConfig(),
  };

  // Use SQLite database
  await clusterSkiAreas(paths.intermediate, paths.output, testConfig);

  const lifts = TestHelpers.fileContents(paths.output.lifts).features.map(
    simplifiedLiftFeature,
  );

  const runs = TestHelpers.fileContents(paths.output.runs).features.map(
    simplifiedRunFeature,
  );

  const skiAreas = TestHelpers.fileContents(paths.output.skiAreas).features.map(
    simplifiedSkiAreaFeature,
  );

  // Verify that ski area associations are correctly populated
  expect(lifts).toEqual([
    {
      id: "test-lift-1",
      name: "Test Lift",
      skiAreas: ["test-ski-area-1"],
    },
  ]);

  expect(runs).toEqual([
    {
      id: "test-run-1",
      name: "Test Run",
      skiAreas: ["test-ski-area-1"],
    },
  ]);

  expect(skiAreas).toEqual([
    {
      activities: ["downhill"],
      id: "test-ski-area-1",
      name: "Test Ski Area",
    },
  ]);
});

/**
 * Test that verifies ski area associations persist through the entire
 * clustering and augmentation pipeline.
 */
it("verifies ski area associations persist through clustering and augmentation", async () => {
  const paths = TestHelpers.getFilePaths();

  TestHelpers.mockFeatureFiles(
    [
      TestHelpers.mockSkiAreaFeature({
        id: "ski-area-simple",
        name: "Simple Ski Area",
        activities: [SkiAreaActivity.Downhill],
        sources: [{ type: SourceType.SKIMAP_ORG, id: "54321" }],
        geometry: {
          type: "Point",
          coordinates: [0, 0],
        },
      }),
    ],
    [
      TestHelpers.mockLiftFeature({
        id: "lift-simple",
        name: "Simple Lift",
        liftType: LiftType.ChairLift,
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [0.001, 0.001],
          ],
        },
      }),
    ],
    [
      TestHelpers.mockRunFeature({
        id: "run-simple",
        name: "Simple Run",
        uses: [RunUse.Downhill],
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [0.001, 0.001],
          ],
        },
      }),
    ],
    paths.intermediate,
  );

  // Create test config
  const testConfig: Config = {
    workingDir: TestHelpers.getTempWorkingDir(),
    outputDir: TestHelpers.getTempWorkingDir(),
    bbox: null,
    elevationServer: null,
    geocodingServer: null,
    snowCover: null,
    skiPasses: null,
    tiles: null,
    postgresCache: getPostgresTestConfig(),
  };

  // Use SQLite database
  await clusterSkiAreas(paths.intermediate, paths.output, testConfig);

  const outputRuns = TestHelpers.fileContents(paths.output.runs).features;
  const outputLifts = TestHelpers.fileContents(paths.output.lifts).features;

  // Verify that ski area associations are correctly populated
  expect(outputRuns[0]?.properties?.skiAreas).not.toEqual([]);
  expect(outputLifts[0]?.properties?.skiAreas).not.toEqual([]);
});
