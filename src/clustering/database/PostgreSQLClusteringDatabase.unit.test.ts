import { PostgreSQLClusteringDatabase } from "./PostgreSQLClusteringDatabase";
import { MapObjectType } from "../MapObject";
import { SkiAreaActivity } from "openskidata-format";
import { getPostgresTestConfig } from "../../Config";
import * as TestHelpers from "../../TestHelpers";

jest.setTimeout(60 * 1000);

describe("PostgreSQLClusteringDatabase", () => {
  let database: PostgreSQLClusteringDatabase;

  beforeEach(async () => {
    database = new PostgreSQLClusteringDatabase(getPostgresTestConfig());
    try {
      await database.initialize();
      // Clean up any existing test data
      await database["executeQuery"]("DELETE FROM objects WHERE source = $1", [
        "test",
      ]);
    } catch (error) {
      // Skip tests if PostgreSQL is not available
      console.warn("PostgreSQL not available, skipping tests:", error);
      pending("PostgreSQL not available");
    }
  });

  afterEach(async () => {
    if (database) {
      await database.close();
    }
  });

  it("should initialize with PostGIS", async () => {
    // Test is successful if no errors are thrown during initialization
    expect(database).toBeDefined();
  });

  it("should save and retrieve a ski area object", async () => {
    const skiArea = {
      _key: "test-ski-area-1",
      type: MapObjectType.SkiArea,
      geometry: {
        type: "Point" as const,
        coordinates: [-122.4194, 37.7749],
      },
      activities: [SkiAreaActivity.Downhill],
      skiAreas: [],
      source: "test",
      isPolygon: false,
      properties: { name: "Test Ski Area" },
      id: "test-ski-area-1",
    } as any;

    await database.saveObject(skiArea);

    const cursor = await database.getSkiAreas({ useBatching: true });
    const skiAreas = await cursor.all();

    expect(skiAreas).toHaveLength(1);
    expect(skiAreas[0]._key).toBe("test-ski-area-1");
    expect(skiAreas[0].activities).toContain(SkiAreaActivity.Downhill);
  });

  it("should create spatial indexes", async () => {
    await database.createIndexes();
    // Test is successful if no errors are thrown
  });

  it("should handle bulk object saves with transactions", async () => {
    const objects = [
      {
        _key: "test-1",
        type: MapObjectType.SkiArea,
        geometry: { type: "Point" as const, coordinates: [-122.4194, 37.7749] },
        activities: [SkiAreaActivity.Downhill],
        skiAreas: [],
        source: "test",
        isPolygon: false,
        properties: {},
        id: "test-1",
      },
      {
        _key: "test-2",
        type: MapObjectType.Run,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [-122.42, 37.77],
            [-122.41, 37.76],
          ],
        },
        activities: [SkiAreaActivity.Downhill],
        skiAreas: [],
        source: "test",
        isPolygon: false,
        properties: {},
      },
    ] as any[];

    await database.saveObjects(objects);

    const cursor = await database.getSkiAreas({ useBatching: true });
    const skiAreas = await cursor.all();

    expect(skiAreas).toHaveLength(1);
    expect(skiAreas[0]._key).toBe("test-1");
  });

  it("should correctly handle getNextUnassignedRun logic", async () => {
    // Create a run marked as basis for new ski area
    const unassignedRun = {
      _key: "unassigned-run-1",
      type: MapObjectType.Run,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [-122.42, 37.77],
          [-122.41, 37.76],
        ],
      },
      activities: [SkiAreaActivity.Downhill],
      skiAreas: [],
      source: "test",
      isPolygon: false,
      isBasisForNewSkiArea: true, // This should be found
      properties: {},
    } as any;

    // Create a run NOT marked as basis for new ski area
    const assignedRun = {
      _key: "assigned-run-1",
      type: MapObjectType.Run,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [-122.43, 37.78],
          [-122.42, 37.77],
        ],
      },
      activities: [SkiAreaActivity.Downhill],
      skiAreas: ["some-ski-area"],
      source: "test",
      isPolygon: false,
      isBasisForNewSkiArea: false, // This should NOT be found
      properties: {},
    } as any;

    await database.saveObjects([unassignedRun, assignedRun]);

    // Should return the unassigned run
    const nextRun = await database.getNextUnassignedRun();
    expect(nextRun).toBeTruthy();
    expect(nextRun!._key).toBe("unassigned-run-1");

    // Mark the run as processed (assign to ski area)
    await database.markObjectsAsPartOfSkiArea(
      "test-ski-area",
      ["unassigned-run-1"],
      false,
    );

    // Should return null now (no more unassigned runs)
    const noMoreRuns = await database.getNextUnassignedRun();
    expect(noMoreRuns).toBeNull();
  });
});
