import { lineString, multiLineString, multiPolygon, point, polygon } from "@turf/helpers";
import {
  centralPointsInFeature,
  extractPointsAlongGeometry,
  isValidGeometryInFeature,
} from "./GeoTransforms";

describe("GeoTransforms", () => {
  describe("centralPointsInFeatures", () => {
    it("should provide same output for point input", () => {
      expect(centralPointsInFeature(point([0, 0]).geometry))
        .toMatchInlineSnapshot(`
        {
          "coordinates": [
            0,
            0,
          ],
          "type": "Point",
        }
      `);
    });

    it("should provide point in polygon", () => {
      expect(
        centralPointsInFeature(
          polygon([
            [
              [0, 0],
              [0, 1],
              [1, 1],
              [1, 0],
              [0, 0],
            ],
          ]).geometry,
        ),
      ).toMatchInlineSnapshot(`
        {
          "coordinates": [
            0.5,
            0.5,
          ],
          "type": "Point",
        }
      `);
    });

    it("should provide point inside polygon that is not in the hole", () => {
      expect(
        centralPointsInFeature(
          polygon([
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],

            [
              [0.25, 0.25],
              [0.25, 0.75],
              [0.75, 0.75],
              [0.75, 0.25],
              [0.25, 0.25],
            ],
          ]).geometry,
        ),
      ).toMatchInlineSnapshot(`
{
  "coordinates": [
    0.2500000000000001,
    0.5000047594432947,
  ],
  "type": "Point",
}
`);
    });

    it("should provide multiple points in multipolygon", () => {
      const firstShape: GeoJSON.Polygon["coordinates"] = [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ];
      const secondShape: GeoJSON.Polygon["coordinates"] = [
        [
          [2, 2],
          [2, 3],
          [3, 3],
          [3, 2],
          [2, 2],
        ],
      ];

      expect(
        centralPointsInFeature(
          multiPolygon([firstShape, secondShape]).geometry,
        ),
      ).toMatchInlineSnapshot(`
        {
          "coordinates": [
            [
              0.5,
              0.5,
            ],
            [
              2.5,
              2.5,
            ],
          ],
          "type": "MultiPoint",
        }
      `);
    });
  });

  describe("isValidGeometryInFeature", () => {
    it("should return true for valid geometry", () => {
      const feature: any = {
        type: "Feature",
        properties: { id: 1 },
        geometry: {
          type: "Point",
          coordinates: [0, 0],
        },
      };
      expect(isValidGeometryInFeature(feature)).toBe(true);
    });

    it("should return false for invalid geometry", () => {
      const feature: any = {
        type: "Feature",
        properties: { id: 2 },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 1],
              [1, 0],
              [0, 1],
            ],
          ],
        },
      };
      expect(isValidGeometryInFeature(feature)).toBe(false);
    });
  });

  describe("extractPointsAlongGeometry", () => {
    it("should extract start and end points for short LineString", () => {
      // Short line, less than 1km
      const line = lineString([
        [0, 0],
        [0.001, 0.001],
      ]).geometry;

      const points = extractPointsAlongGeometry(line, 1);

      // Should have start and end points
      expect(points.length).toBe(2);
      expect(points[0]).toEqual([0, 0]);
      expect(points[1]).toEqual([0.001, 0.001]);
    });

    it("should extract points at 1km intervals for longer LineString", () => {
      // Create a longer line (roughly 2km at equator: 0.018 degrees ≈ 2km)
      const line = lineString([
        [0, 0],
        [0, 0.018],
      ]).geometry;

      const points = extractPointsAlongGeometry(line, 1);

      // Should have start, middle, and end points
      expect(points.length).toBeGreaterThan(2);
      expect(points[0]).toEqual([0, 0]);
      expect(points[points.length - 1]).toEqual([0, 0.018]);
    });

    it("should extract points from MultiLineString", () => {
      const multiLine = multiLineString([
        [
          [0, 0],
          [0, 0.018],
        ],
        [
          [1, 0],
          [1, 0.018],
        ],
      ]).geometry;

      const points = extractPointsAlongGeometry(multiLine, 1);

      // Should have points from both lines
      expect(points.length).toBeGreaterThan(4);
    });

    it("should extract points along polygon perimeter", () => {
      // Square polygon (roughly 2km per side)
      const poly = polygon([
        [
          [0, 0],
          [0, 0.018],
          [0.018, 0.018],
          [0.018, 0],
          [0, 0],
        ],
      ]).geometry;

      const points = extractPointsAlongGeometry(poly, 1);

      // Should have points along the perimeter
      expect(points.length).toBeGreaterThan(4);
      // First point should be the start of the outer ring
      expect(points[0]).toEqual([0, 0]);
    });

    it("should deduplicate identical points", () => {
      // Line that returns to the same point
      const line = lineString([
        [0, 0],
        [0.001, 0],
        [0, 0],
      ]).geometry;

      const points = extractPointsAlongGeometry(line, 1);

      // All points should be unique
      const uniquePoints = new Set(points.map((p) => JSON.stringify(p)));
      expect(uniquePoints.size).toBe(points.length);
    });
  });
});
