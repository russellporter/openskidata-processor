import nock from "nock";
import { RunFeature } from "openskidata-format";
import { Config } from "./Config";
import prepare from "./PrepareGeoJSON";
import * as TestHelpers from "./TestHelpers";

const config: Config = {
  arangoDBURLForClustering: null,
  elevationServerURL: "http://elevation.example.com",
  bbox: null,
  geocodingServer: null,
  workingDir: "data",
  outputDir: "data",
};

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

afterEach(() => {
  nock.cleanAll();
});

it("adds elevations to lift geometry", async () => {
  const paths = TestHelpers.getFilePaths();
  mockElevationServer(200);
  TestHelpers.mockInputFiles(
    {
      skiMapSkiAreas: [],
      openStreetMapSkiAreas: [],
      openStreetMapSkiAreaSites: [],
      lifts: [
        {
          type: "Feature",
          id: "way/227407273",
          properties: {
            type: "way",
            id: 227407273,
            tags: {
              aerialway: "t-bar",
              name: "Skilift Oberau",
            },
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
      runs: [],
    },
    paths.input,
  );

  await prepare(paths, config);

  expect(TestHelpers.fileContents(paths.output.lifts)).toMatchInlineSnapshot(`
{
  "features": [
    {
      "geometry": {
        "coordinates": [
          [
            11.1223444,
            47.5572422,
            0,
          ],
          [
            11.1164297,
            47.55815630000001,
            1,
          ],
        ],
        "type": "LineString",
      },
      "properties": {
        "bubble": null,
        "capacity": null,
        "description": null,
        "detachable": null,
        "duration": null,
        "heating": null,
        "id": "4d07b91974c5a5b3a0ad9e1928c0a6d433c5093b",
        "liftType": "t-bar",
        "name": "Skilift Oberau",
        "occupancy": null,
        "oneway": null,
        "ref": null,
        "skiAreas": [],
        "sources": [
          {
            "id": "way/227407273",
            "type": "openstreetmap",
          },
        ],
        "status": "operating",
        "type": "lift",
        "websites": [],
        "wikidata_id": null,
      },
      "type": "Feature",
    },
  ],
  "type": "FeatureCollection",
}
`);
});

it("adds elevations to run geometry & elevation profile", async () => {
  const paths = TestHelpers.getFilePaths();
  mockElevationServer(200);

  TestHelpers.mockInputFiles(
    {
      skiMapSkiAreas: [],
      openStreetMapSkiAreas: [],
      openStreetMapSkiAreaSites: [],
      lifts: [],
      runs: [
        {
          type: "Feature",
          id: "way/227407268",
          properties: {
            type: "way",
            id: 227407268,
            tags: {
              name: "Oberauer Skiabfahrt",
              "piste:difficulty": "easy",
              "piste:type": "downhill",
              sport: "skiing",
            },
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [11.1164229, 47.558125],
              [11.1163655, 47.5579742],
              [11.1171866, 47.5556413],
            ],
          },
        },
      ],
    },
    paths.input,
  );

  await prepare(paths, config);

  const feature: RunFeature = TestHelpers.fileContents(paths.output.runs)
    .features[0];

  expect(feature.properties.elevationProfile).toMatchInlineSnapshot(`
{
  "heights": [
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
    13,
    14,
    15,
  ],
  "resolution": 25,
}
`);
  expect(feature.geometry).toMatchInlineSnapshot(`
{
  "coordinates": [
    [
      11.1164229,
      47.558125000000004,
      0,
    ],
    [
      11.116365499999999,
      47.5579742,
      1,
    ],
    [
      11.1171866,
      47.5556413,
      2,
    ],
  ],
  "type": "LineString",
}
`);
});

it("completes without adding elevations when elevation server fails", async () => {
  const paths = TestHelpers.getFilePaths();
  mockElevationServer(500);
  TestHelpers.mockInputFiles(
    {
      skiMapSkiAreas: [],
      openStreetMapSkiAreas: [],
      openStreetMapSkiAreaSites: [],
      lifts: [
        {
          type: "Feature",
          id: "way/227407273",
          properties: {
            type: "way",
            id: 227407273,
            tags: {
              aerialway: "t-bar",
              name: "Skilift Oberau",
            },
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
      runs: [],
    },
    paths.input,
  );

  await prepare(paths, config);

  expect(TestHelpers.fileContents(paths.output.lifts)).toMatchInlineSnapshot(`
{
  "features": [
    {
      "geometry": {
        "coordinates": [
          [
            11.1223444,
            47.5572422,
          ],
          [
            11.1164297,
            47.55815630000001,
          ],
        ],
        "type": "LineString",
      },
      "properties": {
        "bubble": null,
        "capacity": null,
        "description": null,
        "detachable": null,
        "duration": null,
        "heating": null,
        "id": "4d07b91974c5a5b3a0ad9e1928c0a6d433c5093b",
        "liftType": "t-bar",
        "name": "Skilift Oberau",
        "occupancy": null,
        "oneway": null,
        "ref": null,
        "skiAreas": [],
        "sources": [
          {
            "id": "way/227407273",
            "type": "openstreetmap",
          },
        ],
        "status": "operating",
        "type": "lift",
        "websites": [],
        "wikidata_id": null,
      },
      "type": "Feature",
    },
  ],
  "type": "FeatureCollection",
}
`);
});

it("adds elevations to run polygons", async () => {
  const paths = TestHelpers.getFilePaths();
  mockElevationServer(200);

  TestHelpers.mockInputFiles(
    {
      skiMapSkiAreas: [],
      openStreetMapSkiAreas: [],
      openStreetMapSkiAreaSites: [],
      lifts: [],
      runs: [
        {
          type: "Feature",
          id: "way/227407273",
          properties: {
            type: "way",
            id: 227407268,
            tags: {
              name: "Oberauer Skiabfahrt",
              "piste:difficulty": "easy",
              "piste:type": "downhill",
              sport: "skiing",
            },
          },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [6.544500899999999, 45.3230511],
                [6.543409400000001, 45.323173700000005],
                [6.544500899999999, 45.3230511],
              ],
              [
                [6.5502579, 45.3224134],
                [6.550612, 45.3222571],
                [6.5502579, 45.3224134],
              ],
            ],
          },
        },
      ],
    },
    paths.input,
  );

  await prepare(paths, config);

  expect(TestHelpers.fileContents(paths.output.runs).features[0].geometry)
    .toMatchInlineSnapshot(`
{
  "coordinates": [
    [
      [
        6.544500899999997,
        45.3230511,
        0,
      ],
      [
        6.543409400000002,
        45.32317370000001,
        1,
      ],
      [
        6.544500899999997,
        45.3230511,
        2,
      ],
      [
        6.544500899999997,
        45.3230511,
        0,
      ],
    ],
    [
      [
        6.5502579,
        45.3224134,
        4,
      ],
      [
        6.550612,
        45.3222571,
        5,
      ],
      [
        6.5502579,
        45.3224134,
        6,
      ],
      [
        6.5502579,
        45.3224134,
        4,
      ],
    ],
  ],
  "type": "Polygon",
}
`);
});
