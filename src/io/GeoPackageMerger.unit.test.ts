import { GeoPackageMerger } from "./GeoPackageMerger";
import { GeoPackageWriter } from "./GeoPackageWriter";
import { promises as fs } from "fs";
import { FeatureType, LiftType } from "openskidata-format";
import { GeoPackageAPI } from "@ngageoint/geopackage";
import { mockLiftFeature } from "../TestHelpers";
import tmp from "tmp";

describe("GeoPackageMerger", () => {
  let merger: GeoPackageMerger;
  let targetWriter: GeoPackageWriter;
  let sourceWriter: GeoPackageWriter;

  let testDir: string;
  let targetGpkgPath: string;
  let sourceGpkgPath: string;

  beforeEach(async () => {
    merger = new GeoPackageMerger();
    targetWriter = new GeoPackageWriter();
    sourceWriter = new GeoPackageWriter();

    // Generate unique test directory for each test
    testDir = tmp.dirSync().name;
    targetGpkgPath = `${testDir}/target.gpkg`;
    sourceGpkgPath = `${testDir}/source.gpkg`;
  });

  afterEach(async () => {
    await targetWriter.close();
    await sourceWriter.close();

    // Clean up test files
    await Promise.all([
      fs.unlink(targetGpkgPath).catch(() => {}),
      fs.unlink(sourceGpkgPath).catch(() => {}),
    ]);
  });

  async function getFeatureCount(
    path: string,
    tableName: string,
  ): Promise<number> {
    const geoPackage = await GeoPackageAPI.open(path);
    const featureDao = geoPackage.getFeatureDao(tableName);
    const count = featureDao.count();
    await geoPackage.close();
    return count;
  }

  it("should merge two real geopackages with lift features", async () => {
    // Create target geopackage with lift features
    await targetWriter.initialize(targetGpkgPath);

    const targetFeatures = [
      mockLiftFeature({
        id: "target-lift-1",
        name: "Target Lift 1",
        liftType: LiftType.ChairLift,
        geometry: {
          type: "LineString",
          coordinates: [
            [10.0, 20.0],
            [11.0, 21.0],
          ],
        },
      }),
      mockLiftFeature({
        id: "target-lift-2",
        name: "Target Lift 2",
        liftType: LiftType.ChairLift,
        geometry: {
          type: "LineString",
          coordinates: [
            [12.0, 22.0],
            [13.0, 23.0],
          ],
        },
      }),
    ];

    await targetWriter.addToFeatureLayer(
      "lifts",
      targetFeatures,
      FeatureType.Lift,
    );
    await targetWriter.close();

    // Create source geopackage with different lift features
    await sourceWriter.initialize(sourceGpkgPath);

    const sourceFeatures = [
      mockLiftFeature({
        id: "source-lift-1",
        name: "Source Lift 1",
        liftType: LiftType.ChairLift,
        geometry: {
          type: "LineString",
          coordinates: [
            [14.0, 24.0],
            [15.0, 25.0],
          ],
        },
      }),
    ];

    await sourceWriter.addToFeatureLayer(
      "lifts",
      sourceFeatures,
      FeatureType.Lift,
    );
    await sourceWriter.close();

    // Merge source into target
    const result = merger.mergeGeoPackages(targetGpkgPath, sourceGpkgPath);

    // Verify the merge was successful
    expect(result.tablesProcessed).toBeGreaterThan(0);
    expect(result.rowsInserted).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);

    // Verify the target now has features from both sources
    const finalCount = await getFeatureCount(
      targetGpkgPath,
      "lifts_linestring",
    );
    expect(finalCount).toBe(3); // 2 original + 1 merged
  });

  it("should handle geopackages with duplicate feature IDs", async () => {
    // Create target geopackage
    await targetWriter.initialize(targetGpkgPath);

    const targetFeatures = [
      mockLiftFeature({
        id: "lift-1", // Same ID as source
        name: "Target Lift",
        liftType: LiftType.ChairLift,
        geometry: {
          type: "LineString",
          coordinates: [
            [10.0, 20.0],
            [11.0, 21.0],
          ],
        },
      }),
    ];

    await targetWriter.addToFeatureLayer(
      "lifts",
      targetFeatures,
      FeatureType.Lift,
    );
    await targetWriter.close();

    // Create source geopackage with same feature ID
    await sourceWriter.initialize(sourceGpkgPath);

    const sourceFeatures = [
      mockLiftFeature({
        id: "lift-1", // Same ID as target
        name: "Source Lift",
        liftType: LiftType.ChairLift,
        geometry: {
          type: "LineString",
          coordinates: [
            [14.0, 24.0],
            [15.0, 25.0],
          ],
        },
      }),
    ];

    await sourceWriter.addToFeatureLayer(
      "lifts",
      sourceFeatures,
      FeatureType.Lift,
    );
    await sourceWriter.close();

    // Merge source into target
    const result = merger.mergeGeoPackages(targetGpkgPath, sourceGpkgPath);

    // Verify the merge handled duplicates gracefully
    expect(result.tablesProcessed).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);

    // The original feature should be preserved (no increase in count due to duplicate)
    const finalCount = await getFeatureCount(
      targetGpkgPath,
      "lifts_linestring",
    );
    expect(finalCount).toBe(1); // Only the original feature remains
  });

  it("should merge empty source geopackage without errors", async () => {
    // Create target geopackage with features
    await targetWriter.initialize(targetGpkgPath);

    const targetFeatures = [
      mockLiftFeature({
        id: "target-lift-1",
        name: "Target Lift",
        liftType: LiftType.ChairLift,
        geometry: {
          type: "LineString",
          coordinates: [
            [10.0, 20.0],
            [11.0, 21.0],
          ],
        },
      }),
    ];

    await targetWriter.addToFeatureLayer(
      "lifts",
      targetFeatures,
      FeatureType.Lift,
    );
    await targetWriter.close();

    // Create empty source geopackage
    await sourceWriter.initialize(sourceGpkgPath);
    await sourceWriter.close();

    // Merge source into target
    const result = merger.mergeGeoPackages(targetGpkgPath, sourceGpkgPath);

    // Verify no errors occurred
    expect(result.errors).toHaveLength(0);

    // Verify the target is unchanged
    const finalCount = await getFeatureCount(
      targetGpkgPath,
      "lifts_linestring",
    );
    expect(finalCount).toBe(1);
  });
});
