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

  it("should add polygon features to a layer", async () => {
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

    // Verify the layer was created with geometry type suffix
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const tables = geoPackage.getFeatureTables();
    expect(tables).toContain("test_areas_polygon");
    
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

    // Verify that two tables were created
    const geoPackage = await GeoPackageAPI.open(testGeoPackagePath);
    const tables = geoPackage.getFeatureTables();
    expect(tables).toContain("ski_areas_point");
    expect(tables).toContain("ski_areas_polygon");
    
    // Verify each table has the correct number of features
    const pointDao = geoPackage.getFeatureDao("ski_areas_point");
    expect(pointDao.count()).toBe(2);
    
    const polygonDao = geoPackage.getFeatureDao("ski_areas_polygon");
    expect(polygonDao.count()).toBe(1);
    
    await geoPackage.close();
  });
});