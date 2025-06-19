import { Feature, LineString, Polygon } from "geojson";
import { VIIRSPixelExtractor } from "./VIIRSPixelExtractor";

describe("VIIRSPixelExtractor", () => {
  let extractor: VIIRSPixelExtractor;

  beforeEach(() => {
    extractor = new VIIRSPixelExtractor();
  });

  describe("getGeometryPixelCoordinates", () => {
    it("should extract pixels from a simple polygon", () => {
      const polygon: Polygon = {
        type: "Polygon",
        coordinates: [
          [
            [-74.0, 40.7], // New York area
            [-74.0, 40.8],
            [-73.9, 40.8],
            [-73.9, 40.7],
            [-74.0, 40.7],
          ],
        ],
      };

      const pixels = extractor.getGeometryPixelCoordinates(polygon);

      expect(pixels.length).toBeGreaterThan(0);

      // Verify tuple format: [hTile, vTile, column, row]
      const [hTile, vTile, col, row] = pixels[0];
      expect(typeof hTile).toBe("number");
      expect(typeof vTile).toBe("number");
      expect(typeof col).toBe("number");
      expect(typeof row).toBe("number");
    });

    it("should extract pixels from a line string", () => {
      const lineString: LineString = {
        type: "LineString",
        coordinates: [
          [-74.0, 40.7],
          [-73.9, 40.8],
        ],
      };

      const pixels = extractor.getGeometryPixelCoordinates(lineString);

      expect(pixels.length).toBeGreaterThan(0);

      // Verify tuple format: [hTile, vTile, column, row]
      const [hTile, vTile, col, row] = pixels[0];
      expect(typeof hTile).toBe("number");
      expect(typeof vTile).toBe("number");
      expect(typeof col).toBe("number");
      expect(typeof row).toBe("number");
    });

    it("should handle very small geometries with centroid fallback", () => {
      const smallPolygon: Polygon = {
        type: "Polygon",
        coordinates: [
          [
            [0.0, 0.0],
            [0.00001, 0.0],
            [0.00001, 0.00001],
            [0.0, 0.00001],
            [0.0, 0.0],
          ],
        ],
      };

      const pixels = extractor.getGeometryPixelCoordinates(smallPolygon);

      // Should fall back to centroid and return at least one pixel
      expect(pixels.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("extractPixelsFromFeature", () => {
    it("should extract unique pixels from a polygon feature", () => {
      const feature: Feature = {
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
        properties: {
          name: "Test Area",
        },
      };

      const uniquePixels = extractor.extractPixelsFromFeature(feature);

      expect(uniquePixels.size).toBeGreaterThan(0);

      // Check pixel key format: "tile_row_col"
      const pixelKey = Array.from(uniquePixels)[0];
      expect(pixelKey).toMatch(/^h\d{2}v\d{2}_\d+_\d+$/);
    });
  });

  describe("groupPixelsByTile", () => {
    it("should group pixels by tile correctly", () => {
      const uniquePixels = new Set([
        "h12v04_100_200",
        "h12v04_101_200",
        "h13v04_50_150",
      ]);

      const pixelsByTile = extractor.groupPixelsByTile(uniquePixels);

      expect(Object.keys(pixelsByTile)).toHaveLength(2);
      expect(pixelsByTile["h12v04"]).toHaveLength(2);
      expect(pixelsByTile["h13v04"]).toHaveLength(1);

      expect(pixelsByTile["h12v04"]).toContainEqual([100, 200]);
      expect(pixelsByTile["h12v04"]).toContainEqual([101, 200]);
      expect(pixelsByTile["h13v04"]).toContainEqual([50, 150]);
    });
  });
});
