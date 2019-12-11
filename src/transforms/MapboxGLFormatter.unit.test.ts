import { FeatureType } from "openskidata-format";
import { MapboxGLSkiAreaFeature } from "../features/SkiAreaFeature";
import * as TestHelpers from "../TestHelpers";
import { formatter } from "./MapboxGLFormatter";
describe("MapboxGLFormatter", () => {
  it("should export basic ski area", () => {
    const feature = TestHelpers.mockSkiAreaFeature({
      geometry: { type: "Point", coordinates: [1, 1] }
    });

    const mapboxGLFeature = formatter(FeatureType.SkiArea)(
      feature
    ) as MapboxGLSkiAreaFeature;

    expect(mapboxGLFeature).toMatchInlineSnapshot(`
      Object {
        "geometry": Object {
          "coordinates": Array [
            1,
            1,
          ],
          "type": "Point",
        },
        "properties": Object {
          "downhillDistance": null,
          "has_downhill": true,
          "id": "ID",
          "maxElevation": null,
          "name": "Name",
          "nordicDistance": null,
          "status": "operating",
          "vertical": null,
        },
        "type": "Feature",
      }
    `);
  });

  it("should export ski area with run distances", () => {
    const feature = TestHelpers.mockSkiAreaFeature({
      geometry: { type: "Point", coordinates: [1, 1] },
      statistics: {
        lifts: { byType: {} },
        runs: {
          byActivity: {
            downhill: {
              byDifficulty: {
                advanced: { lengthInKm: 10.12312, count: 1 },
                other: { lengthInKm: 5.7, count: 1 }
              }
            },
            nordic: { byDifficulty: { easy: { lengthInKm: 1, count: 1 } } }
          }
        }
      }
    });
    const mapboxGLFeature = formatter(FeatureType.SkiArea)(
      feature
    ) as MapboxGLSkiAreaFeature;
    expect(mapboxGLFeature.properties.downhillDistance).toBe(16);
    expect(mapboxGLFeature.properties.nordicDistance).toBe(1);
  });

  it("should export ski area with elevation data", () => {
    const feature = TestHelpers.mockSkiAreaFeature({
      geometry: { type: "Point", coordinates: [1, 1] },
      statistics: {
        lifts: { byType: {} },
        runs: {
          byActivity: {}
        },
        maxElevation: 1023.2323,
        minElevation: 100.82
      }
    });
    const mapboxGLFeature = formatter(FeatureType.SkiArea)(
      feature
    ) as MapboxGLSkiAreaFeature;

    expect(mapboxGLFeature.properties.vertical).toBe(922);
    expect(mapboxGLFeature.properties.maxElevation).toBe(1023);
  });
});
