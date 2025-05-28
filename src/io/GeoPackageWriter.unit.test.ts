import { GeoPackageWriter } from "./GeoPackageWriter";
import { FeatureType } from "openskidata-format";
import { Feature, Point, LineString, Polygon } from "geojson";
import { promises as fs } from "fs";
import { GeoPackageAPI } from "@ngageoint/geopackage";

describe("GeoPackageWriter", () => {
  const testGeoPackagePath = "/tmp/test.gpkg";
  let writer: GeoPackageWriter;

  beforeEach(async () => {
    writer = new GeoPackageWriter();
    // Clean up any existing test file
    try {
      await fs.unlink(testGeoPackagePath);
    } catch (error) {
      // File doesn't exist, that's fine
    }
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

  it("should add point features to a layer", async () => {
    await writer.initialize(testGeoPackagePath);
    
    const features: Feature<Point>[] = [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [10.0, 20.0]
        },
        properties: {
          name: "Test Point",
          elevation: 1500.5,
          active: true
        }
      }
    ];

    await writer.addFeatureLayer("test_points", features, FeatureType.Lift);
    await writer.close();

    // Verify the layer was created with geometry type suffix
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const tables = geoPackage.getFeatureTables();
    expect(tables).toContain("test_points_point");
    
    const featureDao = geoPackage.getFeatureDao("test_points_point");
    const count = featureDao.count();
    expect(count).toBe(1);
    
    await geoPackage.close();
  });

  it("should add line features to a layer", async () => {
    await writer.initialize(testGeoPackagePath);
    
    const features: Feature<LineString>[] = [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [[0, 0], [10, 10], [20, 20]]
        },
        properties: {
          name: "Test Run",
          difficulty: "intermediate",
          length: 2500
        }
      }
    ];

    await writer.addFeatureLayer("test_runs", features, FeatureType.Run);
    await writer.close();

    // Verify the layer was created with geometry type suffix
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const tables = geoPackage.getFeatureTables();
    expect(tables).toContain("test_runs_linestring");
    
    await geoPackage.close();
  });

  it("should convert polygon features to multipolygon", async () => {
    await writer.initialize(testGeoPackagePath);
    
    const features: Feature<Polygon>[] = [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
        },
        properties: {
          name: "Test Ski Area",
          area: 50000,
          website: "https://example.com"
        }
      }
    ];

    await writer.addFeatureLayer("test_areas", features, FeatureType.SkiArea);
    await writer.close();

    // Verify the layer was created with multipolygon geometry type suffix
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const tables = geoPackage.getFeatureTables();
    expect(tables).toContain("test_areas_multipolygon");
    expect(tables).not.toContain("test_areas_polygon");
    
    // Verify the geometry was converted to MultiPolygon
    const featureDao = geoPackage.getFeatureDao("test_areas_multipolygon");
    const rows = featureDao.queryForAll();
    expect(rows.length).toBe(1);
    
    await geoPackage.close();
  });

  it("should handle existing multipolygon features", async () => {
    await writer.initialize(testGeoPackagePath);
    
    const features: Feature<any>[] = [
      {
        type: "Feature",
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
            [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]
          ]
        },
        properties: {
          name: "Complex Ski Area",
          area: 100000
        }
      }
    ];

    await writer.addFeatureLayer("test_areas", features, FeatureType.SkiArea);
    await writer.close();

    // Verify the layer was created with multipolygon geometry type suffix
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const tables = geoPackage.getFeatureTables();
    expect(tables).toContain("test_areas_multipolygon");
    
    const featureDao = geoPackage.getFeatureDao("test_areas_multipolygon");
    const rows = featureDao.queryForAll();
    expect(rows.length).toBe(1);
    
    await geoPackage.close();
  });

  it("should handle mixed property types", async () => {
    await writer.initialize(testGeoPackagePath);
    
    const features: Feature<Point>[] = [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [10.0, 20.0]
        },
        properties: {
          name: "Feature 1",
          value: 123,
          optional: "yes"
        }
      },
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [20.0, 30.0]
        },
        properties: {
          name: "Feature 2",
          value: "456", // Different type for same property
          optional: null
        }
      }
    ];

    await writer.addFeatureLayer("mixed_types", features, FeatureType.Lift);
    await writer.close();

    // Verify the layer was created with correct number of features
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const featureDao = geoPackage.getFeatureDao("mixed_types_point");
    const count = featureDao.count();
    expect(count).toBe(2);
    
    await geoPackage.close();
  });

  it("should throw error when not initialized", async () => {
    const features: Feature<Point>[] = [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [10.0, 20.0]
        },
        properties: {}
      }
    ];

    await expect(
      writer.addFeatureLayer("test", features, FeatureType.Lift)
    ).rejects.toThrow("GeoPackage not initialized");
  });

  it("should handle mixed geometry types by creating separate tables", async () => {
    await writer.initialize(testGeoPackagePath);
    
    const features: Feature<any>[] = [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [10.0, 20.0]
        },
        properties: {
          name: "Point Ski Area",
          type: "skiArea"
        }
      },
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
        },
        properties: {
          name: "Polygon Ski Area",
          type: "skiArea"
        }
      },
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [15.0, 25.0]
        },
        properties: {
          name: "Another Point Ski Area",
          type: "skiArea"
        }
      }
    ];

    await writer.addFeatureLayer("ski_areas", features, FeatureType.SkiArea);
    await writer.close();

    // Verify that two tables were created (Polygon should be converted to MultiPolygon)
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const tables = geoPackage.getFeatureTables();
    expect(tables).toContain("ski_areas_point");
    expect(tables).toContain("ski_areas_multipolygon");
    expect(tables).not.toContain("ski_areas_polygon");
    
    // Verify each table has the correct number of features
    const pointDao = geoPackage.getFeatureDao("ski_areas_point");
    expect(pointDao.count()).toBe(2);
    
    const multiPolygonDao = geoPackage.getFeatureDao("ski_areas_multipolygon");
    expect(multiPolygonDao.count()).toBe(1);
    
    await geoPackage.close();
  });

  it("should convert skiAreas to ski_area_ids and ski_area_names columns", async () => {
    await writer.initialize(testGeoPackagePath);
    
    const features: Feature<LineString>[] = [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [[0, 0], [10, 10]]
        },
        properties: {
          name: "Test Lift",
          skiAreas: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [0, 0] },
              properties: {
                id: "123",
                name: "Mountain Resort"
              }
            },
            {
              type: "Feature", 
              geometry: { type: "Point", coordinates: [1, 1] },
              properties: {
                id: "456",
                name: "Ski Valley"
              }
            }
          ]
        }
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [[20, 20], [30, 30]]
        },
        properties: {
          name: "Another Lift",
          skiAreas: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [2, 2] },
              properties: {
                id: "789",
                name: "Alpine Center"
              }
            }
          ]
        }
      }
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
    expect(firstRow.getValueWithColumnName("ski_area_names")).toBe("Mountain Resort,Ski Valley");
    
    // Verify that the original skiAreas column doesn't exist
    expect(() => firstRow.getValueWithColumnName("ski_areas")).toThrow();
    
    const secondRow = featureDao.getRow(rows[1]);
    expect(secondRow.getValueWithColumnName("ski_area_ids")).toBe("789");
    expect(secondRow.getValueWithColumnName("ski_area_names")).toBe("Alpine Center");
    
    await geoPackage.close();
  });

  it("should handle skiAreas with missing ids or names", async () => {
    await writer.initialize(testGeoPackagePath);
    
    const features: Feature<Point>[] = [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [10.0, 20.0]
        },
        properties: {
          name: "Test Run",
          skiAreas: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [0, 0] },
              properties: {
                id: "123",
                // Missing name
              }
            },
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [1, 1] },
              properties: {
                // Missing id
                name: "Unnamed Resort"
              }
            },
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [2, 2] },
              properties: {
                id: "456",
                name: "Complete Resort"
              }
            }
          ]
        }
      }
    ];

    await writer.addFeatureLayer("runs", features, FeatureType.Run);
    await writer.close();

    // Verify the data handles missing values correctly
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const featureDao = geoPackage.getFeatureDao("runs_point");
    
    const rows = featureDao.queryForAll();
    const row = featureDao.getRow(rows[0]);
    
    // Should skip entries with missing IDs
    expect(row.getValueWithColumnName("ski_area_ids")).toBe("123,456");
    // Should skip entries with missing names
    expect(row.getValueWithColumnName("ski_area_names")).toBe("Unnamed Resort,Complete Resort");
    
    await geoPackage.close();
  });

  it("should handle features without skiAreas", async () => {
    await writer.initialize(testGeoPackagePath);
    
    const features: Feature<LineString>[] = [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [[0, 0], [10, 10]]
        },
        properties: {
          name: "Lift without ski areas",
          liftType: "chairlift"
        }
      }
    ];

    await writer.addFeatureLayer("lifts", features, FeatureType.Lift);
    await writer.close();

    // Verify the layer was created without ski area columns
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const featureDao = geoPackage.getFeatureDao("lifts_linestring");
    
    // Verify no ski area columns were created
    const rows = featureDao.queryForAll();
    const firstRow = featureDao.getRow(rows[0]);
    
    // These columns should not exist
    expect(() => firstRow.getValueWithColumnName("ski_area_ids")).toThrow();
    expect(() => firstRow.getValueWithColumnName("ski_area_names")).toThrow();
    
    await geoPackage.close();
  });
});