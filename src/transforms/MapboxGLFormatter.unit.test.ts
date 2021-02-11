import { FeatureType, LiftType, RunUse } from "openskidata-format";
import * as TestHelpers from "../TestHelpers";
import { formatter } from "./MapboxGLFormatter";
describe("MapboxGLFormatter", () => {
  it("should export basic ski area", () => {
    const feature = TestHelpers.mockSkiAreaFeature({
      geometry: { type: "Point", coordinates: [1, 1] },
    });

    const mapboxGLFeature = formatter(FeatureType.SkiArea)(feature);

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
                other: { lengthInKm: 5.7, count: 1 },
              },
            },
            nordic: { byDifficulty: { easy: { lengthInKm: 1, count: 1 } } },
          },
        },
      },
    });
    const mapboxGLFeature = formatter(FeatureType.SkiArea)(feature);
    expect(mapboxGLFeature.properties.downhillDistance).toBe(16);
    expect(mapboxGLFeature.properties.nordicDistance).toBe(1);
  });

  it("should export ski area with elevation data", () => {
    const feature = TestHelpers.mockSkiAreaFeature({
      geometry: { type: "Point", coordinates: [1, 1] },
      statistics: {
        lifts: { byType: {} },
        runs: {
          byActivity: {},
        },
        maxElevation: 1023.2323,
        minElevation: 100.82,
      },
    });
    const mapboxGLFeature = formatter(FeatureType.SkiArea)(feature);

    expect(mapboxGLFeature.properties.vertical).toBe(922);
    expect(mapboxGLFeature.properties.maxElevation).toBe(1023);
  });

  it("should export run with ref", () => {
    const feature = TestHelpers.mockRunFeature({
      geometry: { type: "LineString", coordinates: [[1, 1]] },
      id: "1",
      ref: "99",
      name: "Run",
      uses: [RunUse.Downhill],
    });
    const mapboxGLFeature = formatter(FeatureType.Run)(feature);

    expect(mapboxGLFeature.properties.name).toBe("99 - Run");
  });

  it("should export run without ref", () => {
    const feature = TestHelpers.mockRunFeature({
      geometry: { type: "LineString", coordinates: [[1, 1]] },
      id: "1",
      ref: null,
      name: "Run",
      uses: [RunUse.Downhill],
    });
    const mapboxGLFeature = formatter(FeatureType.Run)(feature);

    expect(mapboxGLFeature.properties.name).toBe("Run");
  });

  it("should export lift with ref", () => {
    const feature = TestHelpers.mockLiftFeature({
      geometry: { type: "LineString", coordinates: [[1, 1]] },
      id: "1",
      ref: "99",
      name: "Lift",
      liftType: LiftType.ChairLift,
    });
    const mapboxGLFeature = formatter(FeatureType.Lift)(feature);

    expect(mapboxGLFeature.properties.name_and_type).toBe(
      "99 - Lift (Chairlift)"
    );
  });

  it("should export lift without ref", () => {
    const feature = TestHelpers.mockLiftFeature({
      geometry: { type: "LineString", coordinates: [[1, 1]] },
      id: "1",
      ref: null,
      name: "Lift",
      liftType: LiftType.ChairLift,
    });
    const mapboxGLFeature = formatter(FeatureType.Lift)(feature);

    expect(mapboxGLFeature.properties.name_and_type).toBe("Lift (Chairlift)");
  });

  it("should export lift with associated ski areas", () => {
    const feature = TestHelpers.mockLiftFeature({
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      id: "1",
      name: "Lift",
      liftType: LiftType.CableCar,
      skiAreas: [
        TestHelpers.mockSkiAreaFeature({
          id: "2",
          geometry: { type: "Point", coordinates: [0, 0] },
        }),
      ],
    });
    const mapboxGLFeature = formatter(FeatureType.Lift)(feature);

    expect(mapboxGLFeature.properties["skiArea-2"]).toBe(true);
    expect(mapboxGLFeature.properties.skiAreas).toMatchInlineSnapshot(`
      Array [
        "2",
      ]
    `);
  });

  it("should export polygon ski area as point geometry", () => {
    const feature = TestHelpers.mockSkiAreaFeature({
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [1, 1],
            [0, 0],
          ],
        ],
      },
      id: "1",
    });
    const mapboxGLFeature = formatter(FeatureType.SkiArea)(feature);

    expect(mapboxGLFeature.geometry.type).toBe("Point");
  });

  it("should export multipolygon ski area as multipoint geometry", () => {
    const feature = TestHelpers.mockSkiAreaFeature({
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [0, 0],
              [0, 1],
              [1, 1],
              [0, 0],
            ],
          ],
          [
            [
              [2, 2],
              [2, 3],
              [3, 3],
              [2, 2],
            ],
          ],
        ],
      },
      id: "1",
    });
    const mapboxGLFeature = formatter(FeatureType.SkiArea)(feature);

    expect(mapboxGLFeature.geometry.type).toBe("MultiPoint");
  });

  it("should export ski run with multiple uses", () => {
    const feature = TestHelpers.mockRunFeature({
      id: "1",
      name: "Run",
      uses: [RunUse.Downhill, RunUse.Hike, RunUse.Sled],
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    });
    const mapboxGLFeature = formatter(FeatureType.Run)(feature);

    expect(mapboxGLFeature.properties.downhill).toBe(-0.5);
    expect(mapboxGLFeature.properties.nordic).toBe(undefined);
    expect(mapboxGLFeature.properties.other).toBe(0.5);
  });

  it("should export ski run with associated ski areas", () => {
    const feature = TestHelpers.mockRunFeature({
      id: "1",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      skiAreas: [
        TestHelpers.mockSkiAreaFeature({
          id: "2",
          geometry: { type: "Point", coordinates: [0, 0] },
        }),
      ],
    });
    const mapboxGLFeature = formatter(FeatureType.Run)(feature);

    expect(mapboxGLFeature.properties["skiArea-2"]).toBe(true);
    expect(mapboxGLFeature.properties.skiAreas).toMatchInlineSnapshot(`
      Array [
        "2",
      ]
    `);
  });
});
