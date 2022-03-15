import { multiPolygon, point, polygon } from "@turf/helpers";
import { centralPointsInFeature } from "./GeoTransforms";

describe("GeoTransforms", () => {
  describe("centralPointsInFeatures", () => {
    it("should provide same output for point input", () => {
      expect(centralPointsInFeature(point([0, 0]).geometry))
        .toMatchInlineSnapshot(`
        Object {
          "coordinates": Array [
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
          ]).geometry
        )
      ).toMatchInlineSnapshot(`
        Object {
          "coordinates": Array [
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
          ]).geometry
        )
      ).toMatchInlineSnapshot(`
        Object {
          "coordinates": Array [
            0.25,
            0.49999048070563396,
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
        centralPointsInFeature(multiPolygon([firstShape, secondShape]).geometry)
      ).toMatchInlineSnapshot(`
        Object {
          "coordinates": Array [
            Array [
              0.5,
              0.5,
            ],
            Array [
              2.5,
              2.5,
            ],
          ],
          "type": "MultiPoint",
        }
      `);
    });
  });
});
