import { FeatureCollection, Feature } from "geojson";
import {
  extractVIIRSPixelsFromGeoJSON,
  extractVIIRSPixelsFromFeature,
} from "./extractVIIRSPixels";

describe("extractVIIRSPixels utilities", () => {
  describe("extractVIIRSPixelsFromGeoJSON", () => {
    it("should extract pixels from a feature collection", () => {
      const featureCollection: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-74.0, 40.7],
                  [-74.0, 40.8],
                  [-73.9, 40.8],
                  [-73.9, 40.7],
                  [-74.0, 40.7],
                ],
              ],
            },
            properties: { name: "Test Area 1" },
          },
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-73.8, 40.7],
                  [-73.8, 40.8],
                  [-73.7, 40.8],
                  [-73.7, 40.7],
                  [-73.8, 40.7],
                ],
              ],
            },
            properties: { name: "Test Area 2" },
          },
        ],
      };

      const pixelsByTile = extractVIIRSPixelsFromGeoJSON(featureCollection);

      expect(Object.keys(pixelsByTile).length).toBeGreaterThan(0);

      // Check that each tile has valid pixel arrays
      Object.values(pixelsByTile).forEach((pixels) => {
        expect(pixels.length).toBeGreaterThan(0);
        pixels.forEach(([row, col]) => {
          expect(typeof row).toBe("number");
          expect(typeof col).toBe("number");
          expect(row).toBeGreaterThanOrEqual(0);
          expect(col).toBeGreaterThanOrEqual(0);
        });
      });
    });

    it("should handle empty feature collection", () => {
      const emptyCollection: FeatureCollection = {
        type: "FeatureCollection",
        features: [],
      };

      const pixelsByTile = extractVIIRSPixelsFromGeoJSON(emptyCollection);

      expect(Object.keys(pixelsByTile)).toHaveLength(0);
    });
  });

  describe("extractVIIRSPixelsFromFeature", () => {
    it("should extract pixels from a single feature", () => {
      const feature: Feature = {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [-74.0, 40.7],
            [-73.9, 40.8],
          ],
        },
        properties: { name: "Test Line" },
      };

      const pixels = extractVIIRSPixelsFromFeature(feature);

      expect(pixels.length).toBeGreaterThan(0);

      // Verify tuple format: [hTile, vTile, column, row]
      const [hTile, vTile, col, row] = pixels[0];
      expect(typeof hTile).toBe("number");
      expect(typeof vTile).toBe("number");
      expect(typeof col).toBe("number");
      expect(typeof row).toBe("number");
    });

    it("should handle feature with no geometry", () => {
      const feature: Feature = {
        type: "Feature",
        geometry: null as any,
        properties: { name: "No Geometry" },
      };

      const pixels = extractVIIRSPixelsFromFeature(feature);

      expect(pixels).toHaveLength(0);
    });
  });
});
