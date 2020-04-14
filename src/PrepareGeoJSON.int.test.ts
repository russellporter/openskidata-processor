import mockFS from "mock-fs";
import { Activity } from "openskidata-format";
import { Config } from "./Config";
import {
  GeoJSONInputPaths,
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
} from "./io/GeoJSONFiles";
import prepare from "./PrepareGeoJSON";
import * as TestHelpers from "./TestHelpers";

const input = new GeoJSONInputPaths(".");
const intermediate = new GeoJSONIntermediatePaths(".");
const output = new GeoJSONOutputPaths("output");
const config: Config = {
  arangoDBURLForClustering: null,
  elevationServerURL: null,
};

afterEach(() => {
  mockFS.restore();
});

it("produces empty output for empty input", async () => {
  TestHelpers.mockInputFiles({
    skiMapSkiAreas: [],
    openStreetMapSkiAreas: [],
    lifts: [],
    runs: [],
  });

  await prepare(input, intermediate, output, config);

  expect(TestHelpers.folderContents("output")).toMatchInlineSnapshot(`
    Map {
      "output/lifts.geojson" => Object {
        "features": Array [],
        "type": "FeatureCollection",
      },
      "output/mapboxgl_lifts.geojson" => Object {
        "features": Array [],
        "type": "FeatureCollection",
      },
      "output/mapboxgl_runs.geojson" => Object {
        "features": Array [],
        "type": "FeatureCollection",
      },
      "output/mapboxgl_ski_areas.geojson" => Object {
        "features": Array [],
        "type": "FeatureCollection",
      },
      "output/runs.geojson" => Object {
        "features": Array [],
        "type": "FeatureCollection",
      },
      "output/ski_areas.geojson" => Object {
        "features": Array [],
        "type": "FeatureCollection",
      },
    }
  `);
});

it("produces output for simple input", async () => {
  TestHelpers.mockInputFiles({
    skiMapSkiAreas: [
      {
        type: "Feature",
        properties: {
          id: "13666",
          name: "Rabenkopflift Oberau",
          status: null,
          activities: [Activity.Downhill],
          scalerank: 1,
          official_website: null,
        },
        geometry: {
          type: "Point",
          coordinates: [11.122066084534, 47.557111836837],
        },
      },
    ],
    openStreetMapSkiAreas: [],
    lifts: [
      {
        type: "Feature",
        id: "way/227407273",
        properties: {
          aerialway: "t-bar",
          name: "Skilift Oberau",
          id: "way/227407273",
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [11.1223444, 47.5572422],
            [11.1164297, 47.5581563],
          ],
        },
      },
    ],
    runs: [
      {
        type: "Feature",
        id: "way/227407268",
        properties: {
          name: "Oberauer Skiabfahrt",
          "piste:difficulty": "easy",
          "piste:type": "downhill",
          sport: "skiing",
          id: "way/227407268",
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [11.1164229, 47.558125],
              [11.1163655, 47.5579742],
              [11.1171866, 47.5576413],
            ],
          ],
        },
      },
    ],
  });

  await prepare(input, intermediate, output, config);

  expect(TestHelpers.folderContents("output")).toMatchInlineSnapshot(`
    Map {
      "output/lifts.geojson" => Object {
        "features": Array [
          Object {
            "geometry": Object {
              "coordinates": Array [
                Array [
                  11.1223444,
                  47.5572422,
                ],
                Array [
                  11.1164297,
                  47.55815630000001,
                ],
              ],
              "type": "LineString",
            },
            "properties": Object {
              "bubble": null,
              "capacity": null,
              "color": "hsl(0, 82%, 42%)",
              "description": null,
              "duration": null,
              "heating": null,
              "id": "4d07b91974c5a5b3a0ad9e1928c0a6d433c5093b",
              "liftType": "t-bar",
              "name": "Skilift Oberau",
              "occupancy": null,
              "oneway": null,
              "ref": null,
              "skiAreas": Array [],
              "sources": Array [
                Object {
                  "id": "way/227407273",
                  "type": "openstreetmap",
                },
              ],
              "status": "operating",
              "type": "lift",
            },
            "type": "Feature",
          },
        ],
        "type": "FeatureCollection",
      },
      "output/mapboxgl_lifts.geojson" => Object {
        "features": Array [
          Object {
            "geometry": Object {
              "coordinates": Array [
                Array [
                  11.1223444,
                  47.5572422,
                ],
                Array [
                  11.1164297,
                  47.558156300000014,
                ],
              ],
              "type": "LineString",
            },
            "properties": Object {
              "color": "hsl(0, 82%, 42%)",
              "id": "4d07b91974c5a5b3a0ad9e1928c0a6d433c5093b",
              "name_and_type": "Skilift Oberau (T-bar)",
              "status": "operating",
            },
            "type": "Feature",
          },
        ],
        "type": "FeatureCollection",
      },
      "output/mapboxgl_runs.geojson" => Object {
        "features": Array [
          Object {
            "geometry": Object {
              "coordinates": Array [
                Array [
                  Array [
                    11.1164229,
                    47.55812500000001,
                  ],
                  Array [
                    11.116365499999999,
                    47.5579742,
                  ],
                  Array [
                    11.1171866,
                    47.557641299999986,
                  ],
                  Array [
                    11.1164229,
                    47.55812500000001,
                  ],
                ],
              ],
              "type": "Polygon",
            },
            "properties": Object {
              "color": "hsl(208, 100%, 33%)",
              "colorName": "blue",
              "difficulty": "easy",
              "gladed": null,
              "grooming": null,
              "id": "6e08a9b5ca97fc7d1fff89f008c987280b3b6b20",
              "lit": null,
              "name": "Oberauer Skiabfahrt",
              "oneway": null,
              "use": "downhill",
            },
            "type": "Feature",
          },
        ],
        "type": "FeatureCollection",
      },
      "output/mapboxgl_ski_areas.geojson" => Object {
        "features": Array [
          Object {
            "geometry": Object {
              "coordinates": Array [
                11.122066084534,
                47.557111836837,
              ],
              "type": "Point",
            },
            "properties": Object {
              "downhillDistance": null,
              "has_downhill": true,
              "id": "02911313f405ef0415188ceb357b415f02af5d64",
              "maxElevation": null,
              "name": "Rabenkopflift Oberau",
              "nordicDistance": null,
              "status": null,
              "vertical": null,
            },
            "type": "Feature",
          },
        ],
        "type": "FeatureCollection",
      },
      "output/runs.geojson" => Object {
        "features": Array [
          Object {
            "geometry": Object {
              "coordinates": Array [
                Array [
                  Array [
                    11.1164229,
                    47.558125000000004,
                  ],
                  Array [
                    11.116365499999999,
                    47.5579742,
                  ],
                  Array [
                    11.1171866,
                    47.55764129999999,
                  ],
                  Array [
                    11.1164229,
                    47.558125000000004,
                  ],
                ],
              ],
              "type": "Polygon",
            },
            "properties": Object {
              "color": "hsl(208, 100%, 33%)",
              "colorName": "blue",
              "convention": "europe",
              "description": null,
              "difficulty": "easy",
              "gladed": null,
              "grooming": null,
              "id": "6e08a9b5ca97fc7d1fff89f008c987280b3b6b20",
              "lit": null,
              "name": "Oberauer Skiabfahrt",
              "oneway": null,
              "patrolled": null,
              "ref": null,
              "skiAreas": Array [],
              "sources": Array [
                Object {
                  "id": "way/227407268",
                  "type": "openstreetmap",
                },
              ],
              "status": "operating",
              "type": "run",
              "uses": Array [
                "downhill",
              ],
            },
            "type": "Feature",
          },
        ],
        "type": "FeatureCollection",
      },
      "output/ski_areas.geojson" => Object {
        "features": Array [
          Object {
            "geometry": Object {
              "coordinates": Array [
                11.122066084534,
                47.557111836837,
              ],
              "type": "Point",
            },
            "properties": Object {
              "activities": Array [
                "downhill",
              ],
              "generated": false,
              "id": "02911313f405ef0415188ceb357b415f02af5d64",
              "name": "Rabenkopflift Oberau",
              "runConvention": "europe",
              "sources": Array [
                Object {
                  "id": "13666",
                  "type": "skimap.org",
                },
              ],
              "status": null,
              "type": "skiArea",
              "website": null,
            },
            "type": "Feature",
          },
        ],
        "type": "FeatureCollection",
      },
    }
  `);
});

it("shortens ski area names for Mapbox GL output", async () => {
  const longName =
    "Ski Welt (Wilder Kaiser – Gosau, Scheffau, Ellmau - Going, Söll, Brixen, Westendorf, Hopfgarten - Itter - Kelchsau)";
  TestHelpers.mockInputFiles({
    skiMapSkiAreas: [
      {
        type: "Feature",
        properties: {
          id: "13666",
          name: longName,
          status: null,
          activities: [Activity.Downhill],
          scalerank: 1,
          official_website: null,
        },
        geometry: {
          type: "Point",
          coordinates: [11.122066084534, 47.557111836837],
        },
      },
    ],
    openStreetMapSkiAreas: [],
    lifts: [],
    runs: [],
  });

  await prepare(input, intermediate, output, config);

  expect(
    TestHelpers.fileContents("output/mapboxgl_ski_areas.geojson").features[0]
      .properties.name
  ).toBe("Ski Welt");
  expect(
    TestHelpers.fileContents("output/ski_areas.geojson").features[0].properties
      .name
  ).toBe(longName);
});

it("processes OpenStreetMap ski areas", async () => {
  TestHelpers.mockInputFiles({
    skiMapSkiAreas: [],
    openStreetMapSkiAreas: [
      {
        type: "Feature",
        properties: {
          id: "13666",
          landuse: "winter_sports",
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [0, 1],
              [1, 0],
              [0, 0],
            ],
          ],
        },
      },
    ],
    lifts: [],
    runs: [],
  });

  await prepare(input, intermediate, output, config);

  expect(TestHelpers.fileContents("output/ski_areas.geojson"))
    .toMatchInlineSnapshot(`
    Object {
      "features": Array [
        Object {
          "geometry": Object {
            "coordinates": Array [
              Array [
                Array [
                  0,
                  0,
                ],
                Array [
                  0,
                  1,
                ],
                Array [
                  1,
                  0,
                ],
                Array [
                  0,
                  0,
                ],
              ],
            ],
            "type": "Polygon",
          },
          "properties": Object {
            "activities": Array [],
            "generated": false,
            "id": "c638251d70817a3d3ad227cce5d353d3abff6abb",
            "name": null,
            "runConvention": "europe",
            "sources": Array [
              Object {
                "id": "13666",
                "type": "openstreetmap",
              },
            ],
            "status": "operating",
            "type": "skiArea",
            "website": null,
          },
          "type": "Feature",
        },
      ],
      "type": "FeatureCollection",
    }
  `);
});
