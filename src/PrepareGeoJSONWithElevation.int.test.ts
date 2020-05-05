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

it("adds elevations to lift geometry", async () => {
  const paths = TestHelpers.getFilePaths();
  mockElevationServer(200);
  TestHelpers.mockInputFiles(
    {
      skiMapSkiAreas: [],
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
      runs: [],
    },
    paths.input
  );

  await prepare(paths, config);

  expect(TestHelpers.fileContents(paths.output.lifts)).toMatchInlineSnapshot(`
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
            "description": null,
            "duration": null,
            "heating": null,
            "id": "4d07b91974c5a5b3a0ad9e1928c0a6d433c5093b",
            "liftType": "t-bar",
            "location": null,
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
      lifts: [],
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
    paths.input
  );

  await prepare(paths, config);

  const feature: RunFeature = TestHelpers.fileContents(paths.output.runs)
    .features[0];

  expect(feature.properties.elevationProfile).toMatchInlineSnapshot(`
    Object {
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
        13,
        14,
        15,
      ],
      "resolution": 25,
    }
  `);
  expect(feature.geometry).toMatchInlineSnapshot(`
    Object {
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
      runs: [],
    },
    paths.input
  );

  await prepare(paths, config);

  expect(TestHelpers.fileContents(paths.output.lifts)).toMatchInlineSnapshot(`
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
            "description": null,
            "duration": null,
            "heating": null,
            "id": "4d07b91974c5a5b3a0ad9e1928c0a6d433c5093b",
            "liftType": "t-bar",
            "location": null,
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
      lifts: [],
      runs: [
        {
          type: "Feature",
          id: "way/227407273",
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
    paths.input
  );

  await prepare(paths, config);

  expect(TestHelpers.fileContents(paths.output.runs).features[0].geometry)
    .toMatchInlineSnapshot(`
    Object {
      "coordinates": Array [
        Array [
          Array [
            6.544500899999997,
            45.3230511,
            0,
          ],
          Array [
            6.543409400000002,
            45.32317370000001,
            1,
          ],
          Array [
            6.544500899999997,
            45.3230511,
            2,
          ],
          Array [
            6.544500899999997,
            45.3230511,
            0,
          ],
        ],
        Array [
          Array [
            6.5502579,
            45.3224134,
            4,
          ],
          Array [
            6.550612,
            45.3222571,
            5,
          ],
          Array [
            6.5502579,
            45.3224134,
            6,
          ],
          Array [
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
