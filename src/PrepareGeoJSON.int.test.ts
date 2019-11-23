import mockFS from "mock-fs";
import { Activity } from "openskidata-format";
import {
  GeoJSONInputPaths,
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths
} from "./io/GeoJSONFiles";
import prepare from "./PrepareGeoJSON";
import * as TestHelpers from "./TestHelpers";

const input = new GeoJSONInputPaths(".");
const intermediate = new GeoJSONIntermediatePaths(".");
const output = new GeoJSONOutputPaths("output");

afterEach(() => {
  mockFS.restore();
});

it("produces empty output for empty input", async () => {
  TestHelpers.mockOSMFiles([], [], []);

  await prepare(input, intermediate, output, false);

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
  TestHelpers.mockOSMFiles(
    [
      {
        type: "Feature",
        properties: {
          id: "13666",
          name: "Rabenkopflift Oberau",
          operating_status: "operating",
          activities: [Activity.Downhill]
        },
        geometry: {
          type: "Point",
          coordinates: [11.122066084534, 47.557111836837]
        }
      }
    ],
    [
      {
        type: "Feature",
        id: "way/227407273",
        properties: {
          aerialway: "t-bar",
          name: "Skilift Oberau",
          id: "way/227407273"
        },
        geometry: {
          type: "LineString",
          coordinates: [[11.1223444, 47.5572422], [11.1164297, 47.5581563]]
        }
      }
    ],
    [
      {
        type: "Feature",
        id: "way/227407268",
        properties: {
          name: "Oberauer Skiabfahrt",
          "piste:difficulty": "easy",
          "piste:type": "downhill",
          sport: "skiing",
          id: "way/227407268"
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [11.1164229, 47.558125],
              [11.1163655, 47.5579742],
              [11.1171866, 47.5576413]
            ]
          ]
        }
      }
    ]
  );

  await prepare(input, intermediate, output, false);

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
              "duration": null,
              "heating": null,
              "id": "b4b80de7783accc7d23964b0b305b4da9ff0cf9a",
              "liftType": "t-bar",
              "name": "Skilift Oberau",
              "occupancy": null,
              "oneway": null,
              "ref": null,
              "skiAreas": Array [],
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
              "id": "b4b80de7783accc7d23964b0b305b4da9ff0cf9a",
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
              "id": "004c8dca66788b2dd041f779718c9afe9d55c6bc",
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
              "has_downhill": true,
              "id": "dabe8dd3df97e01ce68199967c0c725476816389",
              "name": "Rabenkopflift Oberau",
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
              "description": null,
              "difficulty": "easy",
              "gladed": null,
              "grooming": null,
              "id": "004c8dca66788b2dd041f779718c9afe9d55c6bc",
              "lit": null,
              "name": "Oberauer Skiabfahrt",
              "oneway": null,
              "patrolled": null,
              "ref": null,
              "skiAreas": Array [],
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
              "id": "dabe8dd3df97e01ce68199967c0c725476816389",
              "name": "Rabenkopflift Oberau",
              "runConvention": "europe",
              "sources": Array [
                Object {
                  "id": "13666",
                  "type": "skimap.org",
                },
              ],
              "type": "skiArea",
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
  TestHelpers.mockOSMFiles(
    [
      {
        type: "Feature",
        properties: {
          id: "13666",
          name:
            "Ski Welt (Wilder Kaiser – Gosau, Scheffau, Ellmau - Going, Söll, Brixen, Westendorf, Hopfgarten - Itter - Kelchsau)",
          operating_status: "operating",
          activities: [Activity.Downhill]
        },
        geometry: {
          type: "Point",
          coordinates: [11.122066084534, 47.557111836837]
        }
      }
    ],
    [],
    []
  );

  await prepare(input, intermediate, output, false);

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
              "has_downhill": true,
              "id": "3b0290b969049e0b4193357ebcdcffc6ec21036a",
              "name": "Ski Welt",
            },
            "type": "Feature",
          },
        ],
        "type": "FeatureCollection",
      },
      "output/runs.geojson" => Object {
        "features": Array [],
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
              "id": "3b0290b969049e0b4193357ebcdcffc6ec21036a",
              "name": "Ski Welt (Wilder Kaiser – Gosau, Scheffau, Ellmau - Going, Söll, Brixen, Westendorf, Hopfgarten - Itter - Kelchsau)",
              "runConvention": "europe",
              "sources": Array [
                Object {
                  "id": "13666",
                  "type": "skimap.org",
                },
              ],
              "type": "skiArea",
            },
            "type": "Feature",
          },
        ],
        "type": "FeatureCollection",
      },
    }
  `);
});
