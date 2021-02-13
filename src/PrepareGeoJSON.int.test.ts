import { Activity } from "openskidata-format";
import { Config } from "./Config";
import prepare from "./PrepareGeoJSON";
import * as TestHelpers from "./TestHelpers";
import {
  simplifiedLiftFeature,
  simplifiedRunFeature,
  simplifiedSkiAreaFeature,
} from "./TestHelpers";

const config: Config = {
  arangoDBURLForClustering: null,
  elevationServerURL: null,
  bbox: null,
  geocodingServer: null,
};

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
    paths.input
  );

  await prepare(paths, config);

  // await new Promise((resolve) => setTimeout(resolve, 1000));

  expect(TestHelpers.contents(paths.output)).toMatchInlineSnapshot(`
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
              ],
            ],
          },
        },
      ],
    },
    paths.input
  );

  await prepare(paths, config);

  expect(TestHelpers.contents(paths.output)).toMatchInlineSnapshot(`
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
              "websites": Array [],
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
              "skiAreas": Array [],
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
              "downhill": 0,
              "gladed": null,
              "grooming": null,
              "id": "6e08a9b5ca97fc7d1fff89f008c987280b3b6b20",
              "lit": null,
              "name": "Oberauer Skiabfahrt",
              "oneway": true,
              "skiAreas": Array [],
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
              "location": null,
              "name": "Oberauer Skiabfahrt",
              "oneway": true,
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
              "websites": Array [],
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
              "location": null,
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
              "websites": Array [],
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
      openStreetMapSkiAreaSites: [],
      lifts: [],
      runs: [],
    },
    paths.input
  );

  await prepare(paths, config);

  expect(
    TestHelpers.fileContents(paths.output.mapboxGL.skiAreas).features[0]
      .properties.name
  ).toBe("Ski Welt");
  expect(
    TestHelpers.fileContents(paths.output.skiAreas).features[0].properties.name
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
    paths.input
  );

  await prepare(paths, config);

  expect(TestHelpers.fileContents(paths.output.skiAreas))
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
            "location": null,
            "name": null,
            "runConvention": "europe",
            "sources": Array [
              Object {
                "id": "way/13666",
                "type": "openstreetmap",
              },
            ],
            "status": "operating",
            "type": "skiArea",
            "websites": Array [],
          },
          "type": "Feature",
        },
      ],
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
    paths.input
  );

  await prepare(paths, config);

  expect(
    TestHelpers.fileContents(paths.output.skiAreas).features.map(
      simplifiedSkiAreaFeature
    )
  ).toMatchInlineSnapshot(`
    Array [
      Object {
        "activities": Array [],
        "id": "2033ab9be8698fcd4794c24e42782bf33c124e8d",
        "name": "Wendelstein",
      },
    ]
  `);

  expect(
    TestHelpers.fileContents(paths.output.lifts).features.map(
      simplifiedLiftFeature
    )
  ).toMatchInlineSnapshot(`
    Array [
      Object {
        "id": "fa8b7321d15e0f111786a467e69c7b8e1d4f9431",
        "name": "Wendelsteinbahn",
        "skiAreas": Array [
          "2033ab9be8698fcd4794c24e42782bf33c124e8d",
        ],
      },
    ]
  `);

  expect(
    TestHelpers.fileContents(paths.output.runs).features.map(
      simplifiedRunFeature
    )
  ).toMatchInlineSnapshot(`
    Array [
      Object {
        "id": "ab2c973773eabc9757213f2e917575286f7e6c7e",
        "name": "Westabfahrt",
        "skiAreas": Array [
          "2033ab9be8698fcd4794c24e42782bf33c124e8d",
        ],
      },
    ]
  `);
});
