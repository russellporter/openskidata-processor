import { GeoPackageWriter } from "./GeoPackageWriter";
import {
  FeatureType,
  LiftFeature,
  RunFeature,
  SkiAreaFeature,
} from "openskidata-format";
import { promises as fs } from "fs";
import { GeoPackageAPI } from "@ngageoint/geopackage";
import tmp from "tmp";

describe("GeoPackageWriter", () => {
  let testGeoPackagePath: string;
  let writer: GeoPackageWriter;

  beforeEach(async () => {
    writer = new GeoPackageWriter();
    // Generate unique test file path for each test
    testGeoPackagePath = tmp.tmpNameSync({ postfix: ".gpkg" });
  });

  afterEach(async () => {
    await writer.close();
    // Clean up test file
    try {
      await fs.unlink(testGeoPackagePath);
    } catch (error) {
      // File doesn't exist, that's fine
    }
  });

  it("should create a GeoPackage file", async () => {
    await writer.initialize(testGeoPackagePath);

    const stats = await fs.stat(testGeoPackagePath);
    expect(stats.isFile()).toBe(true);
  });

  it("should add lift features to a layer", async () => {
    await writer.initialize(testGeoPackagePath);

    const features: LiftFeature[] = [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [10.0, 20.0],
            [11.0, 21.0],
          ],
        },
        properties: {
          type: FeatureType.Lift,
          id: "test-lift-1",
          liftType: "chair_lift" as any,
          status: "operating" as any,
          name: "Test Point",
          ref: null,
          description: null,
          oneway: null,
          occupancy: null,
          capacity: null,
          duration: null,
          detachable: null,
          bubble: null,
          heating: null,
          skiAreas: [],
          sources: [],
          websites: [],
          wikidata_id: null,
        },
      },
    ];

    await writer.addFeatureLayer("test_lifts", features, FeatureType.Lift);
    await writer.close();

    // Verify the layer was created with geometry type suffix
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const tables = geoPackage.getFeatureTables();
    expect(tables).toContain("test_lifts_linestring");

    const featureDao = geoPackage.getFeatureDao("test_lifts_linestring");
    const count = featureDao.count();
    expect(count).toBe(1);

    await geoPackage.close();
  });

  it("should add line features to a layer", async () => {
    await writer.initialize(testGeoPackagePath);

    const features: RunFeature[] = [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [10, 10],
            [20, 20],
          ],
        },
        properties: {
          type: FeatureType.Run,
          uses: ["downhill" as any],
          id: "test-run-1",
          name: "Test Run",
          ref: null,
          status: "operating" as any,
          description: null,
          difficulty: "intermediate" as any,
          difficultyConvention: "europe" as any,
          oneway: null,
          lit: null,
          gladed: null,
          patrolled: null,
          grooming: null,
          skiAreas: [],
          elevationProfile: null,
          sources: [],
          websites: [],
          wikidata_id: null,
        },
      },
    ];

    await writer.addFeatureLayer("test_runs", features, FeatureType.Run);
    await writer.close();

    // Verify the layer was created with geometry type suffix
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const tables = geoPackage.getFeatureTables();
    expect(tables).toContain("test_runs_linestring");

    await geoPackage.close();
  });

  it("should output ski areas to both point and multipolygon layers", async () => {
    await writer.initialize(testGeoPackagePath);

    const features: SkiAreaFeature[] = [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
              [0, 0],
            ],
          ],
        },
        properties: {
          type: FeatureType.SkiArea,
          id: "test-area-1",
          name: "Test Ski Area",
          activities: ["downhill" as any],
          status: "operating" as any,
          location: null,
          sources: [],
          statistics: undefined,
          runConvention: "europe" as any,
          websites: ["https://example.com"],
          wikidata_id: null,
        },
      },
    ];

    await writer.addFeatureLayer("test_areas", features, FeatureType.SkiArea);
    await writer.close();

    // Verify both point and multipolygon layers were created
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const tables = geoPackage.getFeatureTables();
    expect(tables).toContain("test_areas_point");
    expect(tables).toContain("test_areas_multipolygon");
    expect(tables).not.toContain("test_areas_polygon");

    // Verify the point layer has the centroid
    const pointDao = geoPackage.getFeatureDao("test_areas_point");
    const pointRows = pointDao.queryForAll();
    expect(pointRows.length).toBe(1);

    // Verify the multipolygon layer has the converted geometry
    const multipolygonDao = geoPackage.getFeatureDao("test_areas_multipolygon");
    const multipolygonRows = multipolygonDao.queryForAll();
    expect(multipolygonRows.length).toBe(1);

    await geoPackage.close();
  });

  it("should handle existing multipolygon ski area features", async () => {
    await writer.initialize(testGeoPackagePath);

    const features: SkiAreaFeature[] = [
      {
        type: "Feature",
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
              ],
            ],
            [
              [
                [20, 20],
                [30, 20],
                [30, 30],
                [20, 30],
                [20, 20],
              ],
            ],
          ],
        },
        properties: {
          type: FeatureType.SkiArea,
          id: "test-area-2",
          name: "Complex Ski Area",
          activities: ["downhill" as any],
          status: "operating" as any,
          location: null,
          sources: [],
          statistics: undefined,
          runConvention: "europe" as any,
          websites: [],
          wikidata_id: null,
        },
      },
    ];

    await writer.addFeatureLayer("test_areas", features, FeatureType.SkiArea);
    await writer.close();

    // Verify both point and multipolygon layers were created
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const tables = geoPackage.getFeatureTables();
    expect(tables).toContain("test_areas_point");
    expect(tables).toContain("test_areas_multipolygon");

    // Both layers should have one feature
    const pointDao = geoPackage.getFeatureDao("test_areas_point");
    expect(pointDao.count()).toBe(1);

    const multipolygonDao = geoPackage.getFeatureDao("test_areas_multipolygon");
    expect(multipolygonDao.count()).toBe(1);

    await geoPackage.close();
  });

  it("should only convert polygons to multipolygons for non-ski area features", async () => {
    await writer.initialize(testGeoPackagePath);

    const features: RunFeature[] = [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
              [0, 0],
            ],
          ],
        },
        properties: {
          type: FeatureType.Run,
          uses: ["downhill" as any],
          id: "test-run-2",
          name: "Test Run",
          ref: null,
          status: "operating" as any,
          description: null,
          difficulty: "easy" as any,
          difficultyConvention: "europe" as any,
          oneway: null,
          lit: null,
          gladed: null,
          patrolled: null,
          grooming: null,
          skiAreas: [],
          elevationProfile: null,
          sources: [],
          websites: [],
          wikidata_id: null,
        },
      },
    ];

    await writer.addFeatureLayer("test_runs", features, FeatureType.Run);
    await writer.close();

    // Verify only multipolygon layer was created (no point layer for runs)
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const tables = geoPackage.getFeatureTables();
    expect(tables).not.toContain("test_runs_point");
    expect(tables).toContain("test_runs_multipolygon");
    expect(tables).not.toContain("test_runs_polygon");

    await geoPackage.close();
  });

  it("should handle mixed property types", async () => {
    await writer.initialize(testGeoPackagePath);

    const features: LiftFeature[] = [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [10.0, 20.0],
            [11.0, 21.0],
          ],
        },
        properties: {
          type: FeatureType.Lift,
          id: "test-lift-2",
          liftType: "chair_lift" as any,
          status: "operating" as any,
          name: "Feature 1",
          ref: null,
          description: null,
          oneway: null,
          occupancy: null,
          capacity: null,
          duration: null,
          detachable: null,
          bubble: null,
          heating: null,
          skiAreas: [],
          sources: [],
          websites: [],
          wikidata_id: null,
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [20.0, 30.0],
            [21.0, 31.0],
          ],
        },
        properties: {
          type: FeatureType.Lift,
          id: "test-lift-3",
          liftType: "chair_lift" as any,
          status: "operating" as any,
          name: "Feature 2",
          ref: null,
          description: null,
          oneway: null,
          occupancy: null,
          capacity: null,
          duration: null,
          detachable: null,
          bubble: null,
          heating: null,
          skiAreas: [],
          sources: [],
          websites: [],
          wikidata_id: null,
        },
      },
    ];

    await writer.addFeatureLayer("mixed_types", features, FeatureType.Lift);
    await writer.close();

    // Verify the layer was created with correct number of features
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const featureDao = geoPackage.getFeatureDao("mixed_types_linestring");
    const count = featureDao.count();
    expect(count).toBe(2);

    await geoPackage.close();
  });

  it("should throw error when not initialized", async () => {
    const features: LiftFeature[] = [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [10.0, 20.0],
            [11.0, 21.0],
          ],
        },
        properties: {
          type: FeatureType.Lift,
          id: "test-lift-4",
          liftType: "chair_lift" as any,
          status: "operating" as any,
          name: null,
          ref: null,
          description: null,
          oneway: null,
          occupancy: null,
          capacity: null,
          duration: null,
          detachable: null,
          bubble: null,
          heating: null,
          skiAreas: [],
          sources: [],
          websites: [],
          wikidata_id: null,
        },
      },
    ];

    await expect(
      writer.addFeatureLayer("test", features, FeatureType.Lift),
    ).rejects.toThrow("GeoPackage not initialized");
  });

  it("should handle mixed geometry types by creating separate tables", async () => {
    await writer.initialize(testGeoPackagePath);

    const features: SkiAreaFeature[] = [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [10.0, 20.0],
        },
        properties: {
          type: FeatureType.SkiArea,
          id: "test-area-3",
          name: "Point Ski Area",
          activities: ["downhill" as any],
          status: "operating" as any,
          location: null,
          sources: [],
          statistics: undefined,
          runConvention: "europe" as any,
          websites: [],
          wikidata_id: null,
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
              [0, 0],
            ],
          ],
        },
        properties: {
          type: FeatureType.SkiArea,
          id: "test-area-4",
          name: "Polygon Ski Area",
          activities: ["downhill" as any],
          status: "operating" as any,
          location: null,
          sources: [],
          statistics: undefined,
          runConvention: "europe" as any,
          websites: [],
          wikidata_id: null,
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [15.0, 25.0],
        },
        properties: {
          type: FeatureType.SkiArea,
          id: "test-area-5",
          name: "Another Point Ski Area",
          activities: ["downhill" as any],
          status: "operating" as any,
          location: null,
          sources: [],
          statistics: undefined,
          runConvention: "europe" as any,
          websites: [],
          wikidata_id: null,
        },
      },
    ];

    await writer.addFeatureLayer("ski_areas", features, FeatureType.SkiArea);
    await writer.close();

    // Verify that point and multipolygon tables were created for ski areas
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const tables = geoPackage.getFeatureTables();
    expect(tables).toContain("ski_areas_point");
    expect(tables).toContain("ski_areas_multipolygon");
    expect(tables).not.toContain("ski_areas_polygon");

    // Verify the point table has all features (as centroids)
    const pointDao = geoPackage.getFeatureDao("ski_areas_point");
    expect(pointDao.count()).toBe(3); // All 3 features as points

    // Verify the multipolygon table has only the polygon feature
    const multiPolygonDao = geoPackage.getFeatureDao("ski_areas_multipolygon");
    expect(multiPolygonDao.count()).toBe(1);

    await geoPackage.close();
  });

  it("should convert skiAreas to ski_area_ids and ski_area_names columns", async () => {
    await writer.initialize(testGeoPackagePath);

    const features: LiftFeature[] = [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [10, 10],
          ],
        },
        properties: {
          type: FeatureType.Lift,
          id: "test-lift-5",
          liftType: "chair_lift" as any,
          status: "operating" as any,
          name: "Test Lift",
          ref: null,
          description: null,
          oneway: null,
          occupancy: null,
          capacity: null,
          duration: null,
          detachable: null,
          bubble: null,
          heating: null,
          skiAreas: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [0, 0] },
              properties: {
                type: FeatureType.SkiArea,
                id: "123",
                name: "Mountain Resort",
                activities: [],
                status: null,
                location: null,
              },
            },
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [1, 1] },
              properties: {
                type: FeatureType.SkiArea,
                id: "456",
                name: "Ski Valley",
                activities: [],
                status: null,
                location: null,
              },
            },
          ],
          sources: [],
          websites: [],
          wikidata_id: null,
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [20, 20],
            [30, 30],
          ],
        },
        properties: {
          type: FeatureType.Lift,
          id: "test-lift-6",
          liftType: "chair_lift" as any,
          status: "operating" as any,
          name: "Another Lift",
          ref: null,
          description: null,
          oneway: null,
          occupancy: null,
          capacity: null,
          duration: null,
          detachable: null,
          bubble: null,
          heating: null,
          skiAreas: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [2, 2] },
              properties: {
                type: FeatureType.SkiArea,
                id: "789",
                name: "Alpine Center",
                activities: [],
                status: null,
                location: null,
              },
            },
          ],
          sources: [],
          websites: [],
          wikidata_id: null,
        },
      },
    ];

    await writer.addFeatureLayer("lifts", features, FeatureType.Lift);
    await writer.close();

    // Verify the layer was created
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const featureDao = geoPackage.getFeatureDao("lifts_linestring");

    // Verify the data
    const rows = featureDao.queryForAll();
    const firstRow = featureDao.getRow(rows[0]);

    // Verify ski_area_ids and ski_area_names columns exist and have correct values
    expect(firstRow.getValueWithColumnName("ski_area_ids")).toBe("123,456");
    expect(firstRow.getValueWithColumnName("ski_area_names")).toBe(
      "Mountain Resort,Ski Valley",
    );

    // Verify that the original skiAreas column doesn't exist
    expect(() => firstRow.getValueWithColumnName("ski_areas")).toThrow();

    const secondRow = featureDao.getRow(rows[1]);
    expect(secondRow.getValueWithColumnName("ski_area_ids")).toBe("789");
    expect(secondRow.getValueWithColumnName("ski_area_names")).toBe(
      "Alpine Center",
    );

    await geoPackage.close();
  });

  it("should handle skiAreas with missing ids or names", async () => {
    await writer.initialize(testGeoPackagePath);

    const features: RunFeature[] = [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [10.0, 20.0],
            [11.0, 21.0],
          ],
        },
        properties: {
          type: FeatureType.Run,
          uses: ["downhill" as any],
          id: "test-run-3",
          name: "Test Run",
          ref: null,
          status: "operating" as any,
          description: null,
          difficulty: null,
          difficultyConvention: "europe" as any,
          oneway: null,
          lit: null,
          gladed: null,
          patrolled: null,
          grooming: null,
          skiAreas: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [0, 0] },
              properties: {
                type: FeatureType.SkiArea,
                id: "123",
                name: null,
                activities: [],
                status: null,
                location: null,
              },
            },
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [1, 1] },
              properties: {
                type: FeatureType.SkiArea,
                // id is completely missing from this object
                name: "Unnamed Resort",
                activities: [],
                status: null,
                location: null,
              } as any, // Need to cast since id is required in type
            },
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [2, 2] },
              properties: {
                type: FeatureType.SkiArea,
                id: "456",
                name: "Complete Resort",
                activities: [],
                status: null,
                location: null,
              },
            },
          ],
          elevationProfile: null,
          sources: [],
          websites: [],
          wikidata_id: null,
        },
      },
    ];

    await writer.addFeatureLayer("runs", features, FeatureType.Run);
    await writer.close();

    // Verify the data handles missing values correctly
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const featureDao = geoPackage.getFeatureDao("runs_linestring");

    const rows = featureDao.queryForAll();
    const row = featureDao.getRow(rows[0]);

    // IDs include empty strings for missing ids
    expect(row.getValueWithColumnName("ski_area_ids")).toBe("123,,456");
    // Names filter out empty values, but include non-empty names even if id is missing
    expect(row.getValueWithColumnName("ski_area_names")).toBe(
      "Unnamed Resort,Complete Resort",
    );

    await geoPackage.close();
  });

  it("should handle features without skiAreas", async () => {
    await writer.initialize(testGeoPackagePath);

    const features: LiftFeature[] = [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [10, 10],
          ],
        },
        properties: {
          type: FeatureType.Lift,
          id: "test-lift-7",
          liftType: "chair_lift" as any,
          status: "operating" as any,
          name: "Lift without ski areas",
          ref: null,
          description: null,
          oneway: null,
          occupancy: null,
          capacity: null,
          duration: null,
          detachable: null,
          bubble: null,
          heating: null,
          skiAreas: [],
          sources: [],
          websites: [],
          wikidata_id: null,
        },
      },
    ];

    await writer.addFeatureLayer("lifts", features, FeatureType.Lift);
    await writer.close();

    // Verify the layer was created with empty ski area columns
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const featureDao = geoPackage.getFeatureDao("lifts_linestring");

    // Verify ski area columns exist with empty values
    const rows = featureDao.queryForAll();
    const firstRow = featureDao.getRow(rows[0]);

    // These columns should exist but be empty
    expect(firstRow.getValueWithColumnName("ski_area_ids")).toBe("");
    expect(firstRow.getValueWithColumnName("ski_area_names")).toBe("");

    await geoPackage.close();
  });
});
