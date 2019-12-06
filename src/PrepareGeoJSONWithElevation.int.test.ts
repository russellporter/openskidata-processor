import mockFS from "mock-fs";
import nock from "nock";
import { Config } from "./Config";
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
const config: Config = {
  arangoDBURLForClustering: null,
  elevationServerURL: "http://elevation.example.com"
};
// Work around https://github.com/tschaub/mock-fs/issues/234
let logs: any[] = [];
let logMock: jest.SpyInstance;

beforeEach(() => {
  logMock = jest.spyOn(console, "log").mockImplementation((...args) => {
    logs.push(args);
  });
});

afterEach(() => {
  logMock.mockRestore();
  mockFS.restore();
  logs.map(el => console.log(...el));
  logs = [];
});

function mockElevationServer(code: number) {
  nock("http://elevation.example.com")
    .post("/")
    .reply(code, (_, requestBody) => {
      if (code === 200) {
        const coordinates = requestBody as number[][];
        return coordinates.map((_, index) => index);
      } else {
        return "";
      }
    });
}

it("adds elevations to lift geometry", async () => {
  mockElevationServer(200);
  TestHelpers.mockOSMFiles(
    [],
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
    []
  );

  await prepare(input, intermediate, output, config);

  expect(TestHelpers.fileContents("output/lifts.geojson"))
    .toMatchInlineSnapshot(`
    Object {
      "features": Array [
        Object {
          "geometry": Object {
            "coordinates": Array [
              Array [
                11.1223444,
                47.5572422,
                0,
              ],
              Array [
                11.1164297,
                47.55815630000001,
                1,
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
    }
  `);
});

it("adds elevations to run geometry & elevation profile", async () => {
  mockElevationServer(200);

  TestHelpers.mockOSMFiles(
    [],
    [],
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
          type: "LineString",
          coordinates: [
            [11.1164229, 47.558125],
            [11.1163655, 47.5579742],
            [11.1171866, 47.5556413]
          ]
        }
      }
    ]
  );

  await prepare(input, intermediate, output, config);

  expect(TestHelpers.fileContents("output/runs.geojson"))
    .toMatchInlineSnapshot(`
    Object {
      "features": Array [
        Object {
          "geometry": Object {
            "coordinates": Array [
              Array [
                11.1164229,
                47.558125000000004,
                0,
              ],
              Array [
                11.116365499999999,
                47.5579742,
                1,
              ],
              Array [
                11.1171866,
                47.5556413,
                2,
              ],
            ],
            "type": "LineString",
          },
          "properties": Object {
            "color": "hsl(208, 100%, 33%)",
            "colorName": "blue",
            "description": null,
            "difficulty": "easy",
            "elevationProfile": Object {
              "heights": Array [
                3,
                4,
                5,
                6,
                7,
                8,
                9,
                10,
                11,
                12,
              ],
              "resolution": 25,
            },
            "gladed": null,
            "grooming": null,
            "id": "00d389fca66d862c003032fb7583717261188b9c",
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
    }
  `);
});

it("completes without adding elevations when elevation server fails", async () => {
  mockElevationServer(500);
  TestHelpers.mockOSMFiles(
    [],
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
    []
  );

  await prepare(input, intermediate, output, config);

  expect(TestHelpers.fileContents("output/lifts.geojson"))
    .toMatchInlineSnapshot(`
    Object {
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
    }
  `);
});
