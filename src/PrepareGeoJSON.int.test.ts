import { SkiAreaActivity, SpotType } from "openskidata-format";
import { Config, getPostgresTestConfig } from "./Config";
import prepare from "./PrepareGeoJSON";
import * as TestHelpers from "./TestHelpers";
import {
  simplifiedLiftFeature,
  simplifiedRunFeature,
  simplifiedSkiAreaFeature,
  simplifiedSpotFeature,
} from "./TestHelpers";

function createTestConfig(): Config {
  return {
    elevationServer: null,
    bbox: null,
    geocodingServer: null,
    workingDir: TestHelpers.getTempWorkingDir(),
    outputDir: TestHelpers.getTempWorkingDir(),
    snowCover: null,
    tiles: null,
    postgresCache: getPostgresTestConfig(),
  };
}

it("produces empty output for empty input", async () => {
  const paths = TestHelpers.getFilePaths();
  TestHelpers.mockInputFiles(
    {
      skiMapSkiAreas: [],
      openStreetMapSkiAreas: [],
      openStreetMapSkiAreaSites: [],
      lifts: [],
      runs: [],
    },
    paths.input,
  );

  await prepare(paths, createTestConfig());

  // await new Promise((resolve) => setTimeout(resolve, 1000));

  expect(TestHelpers.contents(paths.output)).toMatchInlineSnapshot(`
    Map {
      "output/lifts.geojson" => {
        "features": [],
        "type": "FeatureCollection",
      },
      "output/mapboxgl_lifts.geojson" => {
        "features": [],
        "type": "FeatureCollection",
      },
      "output/mapboxgl_runs.geojson" => {
        "features": [],
        "type": "FeatureCollection",
      },
      "output/mapboxgl_ski_areas.geojson" => {
        "features": [],
        "type": "FeatureCollection",
      },
      "output/mapboxgl_spots.geojson" => {
        "features": [],
        "type": "FeatureCollection",
      },
      "output/runs.geojson" => {
        "features": [],
        "type": "FeatureCollection",
      },
      "output/ski_areas.geojson" => {
        "features": [],
        "type": "FeatureCollection",
      },
      "output/spots.geojson" => {
        "features": [],
        "type": "FeatureCollection",
      },
    }
  `);
});

it("produces output for simple input", async () => {
  const paths = TestHelpers.getFilePaths();
  TestHelpers.mockInputFiles(
    {
      skiMapSkiAreas: [
        {
          type: "Feature",
          properties: {
            id: "13666",
            name: "Rabenkopflift Oberau",
            status: null,
            activities: [SkiAreaActivity.Downhill],
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
            type: "Polygon",
            coordinates: [
              [
                [11.1164229, 47.558125],
                [11.1163655, 47.5579742],
                [11.1171866, 47.5576413],
                [11.1164229, 47.558125],
              ],
            ],
          },
        },
      ],
    },
    paths.input,
  );

  await prepare(paths, createTestConfig());

  expect(TestHelpers.contents(paths.output)).toMatchInlineSnapshot(`
Map {
  "output/lifts.geojson" => {
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
              47.5581563,
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
          "id": "e8e4058e82dd25aa12b4673471dd754a8b319f5c",
          "liftType": "t-bar",
          "name": "Skilift Oberau",
          "occupancy": null,
          "oneway": null,
          "places": [],
          "ref": null,
          "refFRCAIRN": null,
          "skiAreas": [
            {
              "geometry": {
                "coordinates": [
                  11.122066084534,
                  47.557111836837,
                ],
                "type": "Point",
              },
              "properties": {
                "activities": [
                  "downhill",
                ],
                "id": "02911313f405ef0415188ceb357b415f02af5d64",
                "name": "Rabenkopflift Oberau",
                "status": null,
                "type": "skiArea",
              },
              "type": "Feature",
            },
          ],
          "sources": [
            {
              "id": "way/227407273",
              "type": "openstreetmap",
            },
          ],
          "status": "operating",
          "type": "lift",
          "websites": [],
          "wikidataID": null,
        },
        "type": "Feature",
      },
    ],
    "type": "FeatureCollection",
  },
  "output/mapboxgl_lifts.geojson" => {
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
              47.5581563,
            ],
          ],
          "type": "LineString",
        },
        "properties": {
          "color": "hsl(0, 82%, 42%)",
          "id": "e8e4058e82dd25aa12b4673471dd754a8b319f5c",
          "name_and_type": "Skilift Oberau (T-bar)",
          "skiAreas": [
            "02911313f405ef0415188ceb357b415f02af5d64",
          ],
          "status": "operating",
        },
        "type": "Feature",
      },
    ],
    "type": "FeatureCollection",
  },
  "output/mapboxgl_runs.geojson" => {
    "features": [
      {
        "geometry": {
          "coordinates": [
            [
              [
                11.1164229,
                47.558125,
              ],
              [
                11.1163655,
                47.5579742,
              ],
              [
                11.1171866,
                47.5576413,
              ],
              [
                11.1164229,
                47.558125,
              ],
            ],
          ],
          "type": "Polygon",
        },
        "properties": {
          "color": "hsl(208, 100%, 33%)",
          "colorName": "blue",
          "difficulty": "easy",
          "downhill": 0,
          "gladed": null,
          "grooming": null,
          "id": "72587edf07dd3862f9086084698d82783cb1b16e",
          "lit": null,
          "name": "Oberauer Skiabfahrt",
          "oneway": true,
          "patrolled": null,
          "skiAreas": [
            "02911313f405ef0415188ceb357b415f02af5d64",
          ],
          "snowfarming": null,
          "snowmaking": null,
        },
        "type": "Feature",
      },
    ],
    "type": "FeatureCollection",
  },
  "output/mapboxgl_ski_areas.geojson" => {
    "features": [
      {
        "geometry": {
          "coordinates": [
            11.122066084534,
            47.557111836837,
          ],
          "type": "Point",
        },
        "properties": {
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
  "output/mapboxgl_spots.geojson" => {
    "features": [],
    "type": "FeatureCollection",
  },
  "output/runs.geojson" => {
    "features": [
      {
        "geometry": {
          "coordinates": [
            [
              [
                11.1164229,
                47.558125,
              ],
              [
                11.1163655,
                47.5579742,
              ],
              [
                11.1171866,
                47.5576413,
              ],
              [
                11.1164229,
                47.558125,
              ],
            ],
          ],
          "type": "Polygon",
        },
        "properties": {
          "description": null,
          "difficulty": "easy",
          "difficultyConvention": "europe",
          "elevationProfile": null,
          "gladed": null,
          "grooming": null,
          "id": "72587edf07dd3862f9086084698d82783cb1b16e",
          "lit": null,
          "name": "Oberauer Skiabfahrt",
          "oneway": true,
          "patrolled": null,
          "places": [],
          "ref": null,
          "skiAreas": [
            {
              "geometry": {
                "coordinates": [
                  11.122066084534,
                  47.557111836837,
                ],
                "type": "Point",
              },
              "properties": {
                "activities": [
                  "downhill",
                ],
                "id": "02911313f405ef0415188ceb357b415f02af5d64",
                "name": "Rabenkopflift Oberau",
                "status": null,
                "type": "skiArea",
              },
              "type": "Feature",
            },
          ],
          "snowfarming": null,
          "snowmaking": null,
          "sources": [
            {
              "id": "way/227407268",
              "type": "openstreetmap",
            },
          ],
          "status": "operating",
          "type": "run",
          "uses": [
            "downhill",
          ],
          "websites": [],
          "wikidataID": null,
        },
        "type": "Feature",
      },
    ],
    "type": "FeatureCollection",
  },
  "output/ski_areas.geojson" => {
    "features": [
      {
        "geometry": {
          "coordinates": [
            11.122066084534,
            47.557111836837,
          ],
          "type": "Point",
        },
        "properties": {
          "activities": [
            "downhill",
          ],
          "id": "02911313f405ef0415188ceb357b415f02af5d64",
          "name": "Rabenkopflift Oberau",
          "places": [],
          "runConvention": "europe",
          "sources": [
            {
              "id": "13666",
              "type": "skimap.org",
            },
          ],
          "statistics": {
            "lifts": {
              "byType": {
                "t-bar": {
                  "count": 1,
                  "lengthInKm": 0.4553273553617682,
                },
              },
            },
            "runs": {
              "byActivity": {},
            },
          },
          "status": null,
          "type": "skiArea",
          "websites": [],
          "wikidataID": null,
        },
        "type": "Feature",
      },
    ],
    "type": "FeatureCollection",
  },
  "output/spots.geojson" => {
    "features": [],
    "type": "FeatureCollection",
  },
}
`);
});

it("shortens ski area names for Mapbox GL output", async () => {
  const paths = TestHelpers.getFilePaths();
  const longName =
    "Ski Welt (Wilder Kaiser – Gosau, Scheffau, Ellmau - Going, Söll, Brixen, Westendorf, Hopfgarten - Itter - Kelchsau)";
  TestHelpers.mockInputFiles(
    {
      skiMapSkiAreas: [
        {
          type: "Feature",
          properties: {
            id: "13666",
            name: longName,
            status: null,
            activities: [SkiAreaActivity.Downhill],
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
      openStreetMapSkiAreaSites: [],
      lifts: [],
      runs: [],
    },
    paths.input,
  );

  await prepare(paths, createTestConfig());

  expect(
    TestHelpers.fileContents(paths.output.mapboxGL.skiAreas).features[0]
      .properties.name,
  ).toBe("Ski Welt");
  expect(
    TestHelpers.fileContents(paths.output.skiAreas).features[0].properties.name,
  ).toBe(longName);
});

it("processes OpenStreetMap ski areas", async () => {
  const paths = TestHelpers.getFilePaths();
  TestHelpers.mockInputFiles(
    {
      skiMapSkiAreas: [],
      openStreetMapSkiAreas: [
        {
          type: "Feature",
          properties: {
            type: "way",
            id: 13666,
            tags: {
              landuse: "winter_sports",
            },
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
      openStreetMapSkiAreaSites: [],
      lifts: [],
      runs: [],
    },
    paths.input,
  );

  await prepare(paths, createTestConfig());

  expect(TestHelpers.fileContents(paths.output.skiAreas))
    .toMatchInlineSnapshot(`
{
  "features": [],
  "type": "FeatureCollection",
}
`);
});

it("processes OpenStreetMap ski area sites", async () => {
  const paths = TestHelpers.getFilePaths();
  TestHelpers.mockInputFiles(
    {
      skiMapSkiAreas: [],
      openStreetMapSkiAreas: [],
      openStreetMapSkiAreaSites: [
        {
          id: 1,
          type: "relation",
          tags: {
            name: "Wendelstein",
          },
          members: [
            { type: "way", ref: 1, role: "" },
            { type: "way", ref: 2, role: "" },
          ],
        },
      ],
      lifts: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          properties: {
            id: 1,
            type: "way",
            tags: { name: "Wendelsteinbahn", aerialway: "cable_car" },
          },
        },
      ],
      runs: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [0, 0],
            ],
          },
          properties: {
            id: 2,
            type: "way",
            tags: { name: "Westabfahrt", "piste:type": "downhill" },
          },
        },
      ],
    },
    paths.input,
  );

  await prepare(paths, createTestConfig());

  expect(
    TestHelpers.fileContents(paths.output.skiAreas).features.map(
      simplifiedSkiAreaFeature,
    ),
  ).toMatchInlineSnapshot(`
[
  {
    "activities": [
      "downhill",
    ],
    "id": "2033ab9be8698fcd4794c24e42782bf33c124e8d",
    "name": "Wendelstein",
  },
]
`);

  expect(
    TestHelpers.fileContents(paths.output.lifts).features.map(
      simplifiedLiftFeature,
    ),
  ).toMatchInlineSnapshot(`
[
  {
    "id": "fa8b7321d15e0f111786a467e69c7b8e1d4f9431",
    "name": "Wendelsteinbahn",
    "skiAreas": [
      "2033ab9be8698fcd4794c24e42782bf33c124e8d",
    ],
  },
]
`);

  expect(
    TestHelpers.fileContents(paths.output.runs).features.map(
      simplifiedRunFeature,
    ),
  ).toMatchInlineSnapshot(`
[
  {
    "id": "ab2c973773eabc9757213f2e917575286f7e6c7e",
    "name": "Westabfahrt",
    "skiAreas": [
      "2033ab9be8698fcd4794c24e42782bf33c124e8d",
    ],
  },
]
`);
});

it("processes spot entities", async () => {
  const paths = TestHelpers.getFilePaths();
  TestHelpers.mockInputFiles(
    {
      skiMapSkiAreas: [
        {
          type: "Feature",
          properties: {
            id: "13666",
            name: "Test Ski Area",
            status: null,
            activities: [SkiAreaActivity.Downhill],
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
      openStreetMapSkiAreaSites: [],
      lifts: [],
      runs: [],
      spots: [
        {
          type: "Feature",
          id: "node/123456",
          properties: {
            type: "node",
            id: 123456,
            tags: {
              aerialway: "station",
              "aerialway:access": "both",
              name: "Base Station",
            },
          },
          geometry: {
            type: "Point",
            coordinates: [11.122, 47.557],
          },
        },
        {
          type: "Feature",
          id: "node/123457",
          properties: {
            type: "node",
            id: 123457,
            tags: {
              amenity: "avalanche_transceiver",
              avalanche_transceiver: "checkpoint",
            },
          },
          geometry: {
            type: "Point",
            coordinates: [11.123, 47.558],
          },
        },
        {
          type: "Feature",
          id: "node/123458",
          properties: {
            type: "node",
            id: 123458,
            tags: {
              man_made: "piste:halfpipe",
            },
          },
          geometry: {
            type: "Point",
            coordinates: [11.124, 47.559],
          },
        },
        {
          type: "Feature",
          id: "node/123459",
          properties: {
            type: "node",
            id: 123459,
            tags: {
              "piste:dismount": "yes",
            },
          },
          geometry: {
            type: "Point",
            coordinates: [11.125, 47.56],
          },
        },
      ],
    },
    paths.input,
  );

  await prepare(paths, createTestConfig());

  expect(
  TestHelpers.fileContents(paths.output.spots).features.map(
    simplifiedSpotFeature
  )
).toMatchInlineSnapshot(`
[
  {
    "id": "0a918e17a43efba3745d4525f37ae4348f223158",
    "skiAreas": [
      "02911313f405ef0415188ceb357b415f02af5d64",
    ],
    "spotType": "lift_station",
  },
  {
    "id": "f600d71632dca9be0db9329fb195db78b05a5925",
    "skiAreas": [
      "02911313f405ef0415188ceb357b415f02af5d64",
    ],
    "spotType": "avalanche_transceiver_checkpoint",
  },
  {
    "id": "0ff4dd19e5a6247b6b4d18e9feae2fc3ba491bf1",
    "skiAreas": [
      "02911313f405ef0415188ceb357b415f02af5d64",
    ],
    "spotType": "halfpipe",
  },
  {
    "id": "4f5a803958dbab90d2aac06681d5a5d7ef1bcf5a",
    "skiAreas": [
      "02911313f405ef0415188ceb357b415f02af5d64",
    ],
    "spotType": "crossing",
  },
]
`);
});
