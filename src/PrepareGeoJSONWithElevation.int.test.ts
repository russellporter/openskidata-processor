import nock from "nock";
import { RunFeature } from "openskidata-format";
import tmp from "tmp";
import { Config, getPostgresCacheConfig, PostgresCacheConfig } from "./Config";
import prepare from "./PrepareGeoJSON";
import * as TestHelpers from "./TestHelpers";
import { Pool } from "pg";

jest.setTimeout(60 * 1000);

// Create unique database name for each test run to avoid conflicts
const uniqueDbName = `openskidata_cache_test_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

const testCacheConfig: PostgresCacheConfig = {
  host: "localhost",
  port: 5432,
  database: uniqueDbName,
  user: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD,
  maxConnections: 5,
};

// Mock getPostgresCacheConfig to return our unique config
jest.mock("./Config", () => {
  const originalModule = jest.requireActual("./Config");
  return {
    ...originalModule,
    getPostgresCacheConfig: () => testCacheConfig,
  };
});

const config: Config = {
  elevationServer: {
    url: "http://elevation.example.com",
  },
  bbox: null,
  geocodingServer: null,
  workingDir: TestHelpers.getTempWorkingDir(),
  outputDir: TestHelpers.getTempWorkingDir(),
  snowCover: null,
  tiles: null,
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

beforeEach(async () => {
  // Drop elevation cache table before each test to ensure test isolation
  // This is needed because the cache type needs to match between test runs
  const pool = new Pool({
    host: testCacheConfig.host,
    port: testCacheConfig.port,
    database: testCacheConfig.database,
    user: testCacheConfig.user,
    max: 2,
  });
  
  try {
    await pool.query("DROP TABLE IF EXISTS elevation_cache");
  } catch (error) {
    // Ignore errors if table doesn't exist
  } finally {
    await pool.end();
  }
});

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
            47.558156300000014,
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
    0,
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
    2,
  ],
  "resolution": 25,
}
`);
  expect(feature.geometry).toMatchInlineSnapshot(`
{
  "coordinates": [
    [
      11.1164229,
      47.55812500000001,
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
            47.558156300000014,
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

  expect(TestHelpers.fileContents(paths.output.runs).features[0].geometry).
toMatchInlineSnapshot(`
{
  "coordinates": [
    [
      [
        6.544500899999996,
        45.3230511,
        0,
      ],
      [
        6.5434094000000025,
        45.32317370000001,
        1,
      ],
      [
        6.544500899999996,
        45.3230511,
        0,
      ],
      [
        6.544500899999996,
        45.3230511,
        0,
      ],
    ],
    [
      [
        6.5502579,
        45.3224134,
        2,
      ],
      [
        6.550612,
        45.3222571,
        3,
      ],
      [
        6.5502579,
        45.3224134,
        2,
      ],
      [
        6.5502579,
        45.3224134,
        2,
      ],
    ],
  ],
  "type": "Polygon",
}
`);
});
