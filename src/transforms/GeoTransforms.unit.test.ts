import { multiPolygon, point, polygon } from "@turf/helpers";
import {
  centralPointsInFeature,
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
});
