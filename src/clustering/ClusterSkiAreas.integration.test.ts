import mockFS from "mock-fs";
import {
  Activity,
  LiftType,
  RunDifficulty,
  RunFeature,
  RunGrooming,
  RunUse,
  SourceType,
  Status
} from "openskidata-format";
import { GenericContainer } from "testcontainers";
import { StartedTestContainer } from "testcontainers/dist/test-container";
import * as TestHelpers from "../TestHelpers";
import clusterSkiAreas from "./ClusterSkiAreas";

let mockUuidCount = 0;
jest.mock("uuid/v4", (): (() => string) => {
  return () => "mock-UUID-" + mockUuidCount++;
});

// Increase timeout to give time to set up the container
jest.setTimeout(60 * 1000);

let container: StartedTestContainer;
beforeAll(async () => {
  container = await new GenericContainer("arangodb", "3.5.3")
    .withExposedPorts(8529)
    .withEnv("ARANGO_NO_AUTH", "1d")
    .start();

  // Delay a bit or the DB won't be ready.
  await sleep(5000);
});

afterAll(async () => {
  await container.stop();
});

beforeEach(() => {
  mockUuidCount = 0;

  mockConsoleLog();
});

afterEach(async () => {
  restoreConsoleLog();
});

it("skips generating ski areas for runs with unsupported activity", async () => {
  TestHelpers.mockFeatureFiles(
    [],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "3",
        name: "Sledding run",
        uses: [RunUse.Sled],
        difficulty: RunDifficulty.EASY,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [11.1164229, 47.558125],
              [11.1163655, 47.5579742],
              [11.1171866, 47.5576413],
              [11.1164229, 47.558125]
            ]
          ]
        }
      })
    ]
  );

  try {
    await clusterSkiAreas(
      "intermediate_ski_areas.geojson",
      "output/ski_areas.geojson",
      "intermediate_lifts.geojson",
      "output/lifts.geojson",
      "intermediate_runs.geojson",
      "output/runs.geojson",
      "http://localhost:" + container.getMappedPort(8529)
    );

    expect(TestHelpers.folderContents("output")).toMatchInlineSnapshot(`
      Map {
        "output/lifts.geojson" => Object {
          "features": Array [],
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
                "color": "",
                "colorName": "green",
                "description": null,
                "difficulty": "easy",
                "elevationProfile": null,
                "gladed": null,
                "grooming": null,
                "id": "3",
                "lit": null,
                "name": "Sledding run",
                "oneway": null,
                "patrolled": null,
                "ref": null,
                "skiAreas": Array [],
                "status": "operating",
                "type": "run",
                "uses": Array [
                  "sled",
                ],
              },
              "type": "Feature",
            },
          ],
          "type": "FeatureCollection",
        },
        "output/ski_areas.geojson" => Object {
          "features": Array [],
          "type": "FeatureCollection",
        },
      }
    `);
  } finally {
    mockFS.restore();
  }
});

it("generates ski areas for runs without them", async () => {
  TestHelpers.mockFeatureFiles(
    [],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "3",
        name: "Oberauer Skiabfahrt",
        uses: [RunUse.Downhill],
        difficulty: RunDifficulty.EASY,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [11.1164229, 47.558125],
              [11.1163655, 47.5579742],
              [11.1171866, 47.5576413],
              [11.1164229, 47.558125]
            ]
          ]
        }
      }),
      TestHelpers.mockRunFeature({
        id: "4",
        name: "Another run nearby",
        uses: [RunUse.Downhill],
        difficulty: RunDifficulty.EASY,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [11.1164229, 47.558125],
              [11.1163655, 47.5579742],
              [11.1171866, 47.5576413],
              [11.1164229, 47.558125]
            ]
          ]
        }
      })
    ]
  );

  try {
    await clusterSkiAreas(
      "intermediate_ski_areas.geojson",
      "output/ski_areas.geojson",
      "intermediate_lifts.geojson",
      "output/lifts.geojson",
      "intermediate_runs.geojson",
      "output/runs.geojson",
      "http://localhost:" + container.getMappedPort(8529)
    );

    expect(TestHelpers.folderContents("output")).toMatchInlineSnapshot(`
      Map {
        "output/lifts.geojson" => Object {
          "features": Array [],
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
                "color": "",
                "colorName": "green",
                "description": null,
                "difficulty": "easy",
                "elevationProfile": null,
                "gladed": null,
                "grooming": null,
                "id": "3",
                "lit": null,
                "name": "Oberauer Skiabfahrt",
                "oneway": null,
                "patrolled": null,
                "ref": null,
                "skiAreas": Array [
                  "mock-UUID-0",
                ],
                "status": "operating",
                "type": "run",
                "uses": Array [
                  "downhill",
                ],
              },
              "type": "Feature",
            },
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
                "color": "",
                "colorName": "green",
                "description": null,
                "difficulty": "easy",
                "elevationProfile": null,
                "gladed": null,
                "grooming": null,
                "id": "4",
                "lit": null,
                "name": "Another run nearby",
                "oneway": null,
                "patrolled": null,
                "ref": null,
                "skiAreas": Array [
                  "mock-UUID-0",
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
                  Array [
                    Array [
                      11.114124963217673,
                      47.55807778263157,
                    ],
                    Array [
                      11.114134451692337,
                      47.55780084477297,
                    ],
                    Array [
                      11.114218475291322,
                      47.5575296969623,
                    ],
                    Array [
                      11.11437422694435,
                      47.55727339789595,
                    ],
                    Array [
                      11.114596503281872,
                      47.55704051032089,
                    ],
                    Array [
                      11.114877878469857,
                      47.55683881493265,
                    ],
                    Array [
                      11.11520895229292,
                      47.556675050389146,
                    ],
                    Array [
                      11.11603005229292,
                      47.55634214213496,
                    ],
                    Array [
                      11.116425535990572,
                      47.55621539398219,
                    ],
                    Array [
                      11.116849943953222,
                      47.55614283797266,
                    ],
                    Array [
                      11.117287146541013,
                      47.55612723182803,
                    ],
                    Array [
                      11.117720527853905,
                      47.55616916871089,
                    ],
                    Array [
                      11.118133617219542,
                      47.556267054673974,
                    ],
                    Array [
                      11.11851071516175,
                      47.55641716925845,
                    ],
                    Array [
                      11.118837490059708,
                      47.55661380693517,
                    ],
                    Array [
                      11.119101522821675,
                      47.55684949400655,
                    ],
                    Array [
                      11.11929277887306,
                      47.55711527271637,
                    ],
                    Array [
                      11.119403989520766,
                      47.557401041759,
                    ],
                    Array [
                      11.119430928200133,
                      47.557695940236464,
                    ],
                    Array [
                      11.119372571105684,
                      47.55798876046274,
                    ],
                    Array [
                      11.119231136100888,
                      47.55826837392112,
                    ],
                    Array [
                      11.119011998428181,
                      47.5585241541848,
                    ],
                    Array [
                      11.118723486422681,
                      47.55874638073055,
                    ],
                    Array [
                      11.117959786422682,
                      47.55923007052874,
                    ],
                    Array [
                      11.117625786058003,
                      47.55940480738981,
                    ],
                    Array [
                      11.117249188767401,
                      47.5595342234683,
                    ],
                    Array [
                      11.116843330715835,
                      47.559613736195715,
                    ],
                    Array [
                      11.116422584258226,
                      47.55964053007677,
                    ],
                    Array [
                      11.116001848981746,
                      47.55961365635993,
                    ],
                    Array [
                      11.11559602407763,
                      47.559534066623634,
                    ],
                    Array [
                      11.115219480726969,
                      47.55940457909007,
                    ],
                    Array [
                      11.114885553184585,
                      47.55922977885794,
                    ],
                    Array [
                      11.114606066582775,
                      47.559015855582686,
                    ],
                    Array [
                      11.114390918176566,
                      47.55877038434541,
                    ],
                    Array [
                      11.11424772685941,
                      47.55850205746205,
                    ],
                    Array [
                      11.11419032685941,
                      47.558351258547255,
                    ],
                    Array [
                      11.114124963217673,
                      47.55807778263157,
                    ],
                  ],
                ],
                "type": "Polygon",
              },
              "properties": Object {
                "activities": Array [
                  "downhill",
                ],
                "generated": true,
                "id": "mock-UUID-0",
                "name": null,
                "runConvention": "europe",
                "sources": Array [],
                "statistics": Object {
                  "lifts": Object {
                    "byType": Object {},
                  },
                  "runs": Object {
                    "byActivity": Object {},
                  },
                },
                "status": "operating",
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
  } finally {
    mockFS.restore();
  }
});

it("generates ski areas by activity", async () => {
  TestHelpers.mockFeatureFiles(
    [],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "3",
        name: "Downhill Run",
        uses: [RunUse.Downhill],
        difficulty: RunDifficulty.EASY,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [11.1164229, 47.558125],
              [11.1163655, 47.5579742],
              [11.1171866, 47.5576413],
              [11.1164229, 47.558125]
            ]
          ]
        }
      }),
      TestHelpers.mockRunFeature({
        id: "4",
        name: "Nordic run",
        uses: [RunUse.Nordic],
        difficulty: RunDifficulty.EASY,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [11.1164229, 47.558125],
              [11.1163655, 47.5579742],
              [11.1171866, 47.5576413],
              [11.1164229, 47.558125]
            ]
          ]
        }
      })
    ]
  );

  try {
    await clusterSkiAreas(
      "intermediate_ski_areas.geojson",
      "output/ski_areas.geojson",
      "intermediate_lifts.geojson",
      "output/lifts.geojson",
      "intermediate_runs.geojson",
      "output/runs.geojson",
      "http://localhost:" + container.getMappedPort(8529)
    );

    expect(TestHelpers.folderContents("output")).toMatchInlineSnapshot(`
      Map {
        "output/lifts.geojson" => Object {
          "features": Array [],
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
                "color": "",
                "colorName": "green",
                "description": null,
                "difficulty": "easy",
                "elevationProfile": null,
                "gladed": null,
                "grooming": null,
                "id": "3",
                "lit": null,
                "name": "Downhill Run",
                "oneway": null,
                "patrolled": null,
                "ref": null,
                "skiAreas": Array [
                  "mock-UUID-0",
                ],
                "status": "operating",
                "type": "run",
                "uses": Array [
                  "downhill",
                ],
              },
              "type": "Feature",
            },
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
                "color": "",
                "colorName": "green",
                "description": null,
                "difficulty": "easy",
                "elevationProfile": null,
                "gladed": null,
                "grooming": null,
                "id": "4",
                "lit": null,
                "name": "Nordic run",
                "oneway": null,
                "patrolled": null,
                "ref": null,
                "skiAreas": Array [
                  "mock-UUID-1",
                ],
                "status": "operating",
                "type": "run",
                "uses": Array [
                  "nordic",
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
                  Array [
                    Array [
                      11.117959786422682,
                      47.55923007052874,
                    ],
                    Array [
                      11.118723486422681,
                      47.55874638073055,
                    ],
                    Array [
                      11.119011998428181,
                      47.5585241541848,
                    ],
                    Array [
                      11.119231136100888,
                      47.55826837392112,
                    ],
                    Array [
                      11.119372571105684,
                      47.55798876046274,
                    ],
                    Array [
                      11.119430928200133,
                      47.557695940236464,
                    ],
                    Array [
                      11.119403989520766,
                      47.557401041759,
                    ],
                    Array [
                      11.11929277887306,
                      47.55711527271637,
                    ],
                    Array [
                      11.119101522821675,
                      47.55684949400655,
                    ],
                    Array [
                      11.118837490059708,
                      47.55661380693517,
                    ],
                    Array [
                      11.11851071516175,
                      47.55641716925845,
                    ],
                    Array [
                      11.118133617219542,
                      47.556267054673974,
                    ],
                    Array [
                      11.117720527853905,
                      47.55616916871089,
                    ],
                    Array [
                      11.117287146541013,
                      47.55612723182803,
                    ],
                    Array [
                      11.116849943953222,
                      47.55614283797266,
                    ],
                    Array [
                      11.116425535990572,
                      47.55621539398219,
                    ],
                    Array [
                      11.11603005229292,
                      47.55634214213496,
                    ],
                    Array [
                      11.11520895229292,
                      47.556675050389146,
                    ],
                    Array [
                      11.114877878469857,
                      47.55683881493265,
                    ],
                    Array [
                      11.114596503281872,
                      47.55704051032089,
                    ],
                    Array [
                      11.11437422694435,
                      47.55727339789595,
                    ],
                    Array [
                      11.114218475291322,
                      47.5575296969623,
                    ],
                    Array [
                      11.114134451692337,
                      47.55780084477297,
                    ],
                    Array [
                      11.114124963217673,
                      47.55807778263157,
                    ],
                    Array [
                      11.11419032685941,
                      47.558351258547255,
                    ],
                    Array [
                      11.11424772685941,
                      47.55850205746205,
                    ],
                    Array [
                      11.114390918176566,
                      47.55877038434541,
                    ],
                    Array [
                      11.114606066582775,
                      47.559015855582686,
                    ],
                    Array [
                      11.114885553184585,
                      47.55922977885794,
                    ],
                    Array [
                      11.115219480726969,
                      47.55940457909007,
                    ],
                    Array [
                      11.11559602407763,
                      47.559534066623634,
                    ],
                    Array [
                      11.116001848981746,
                      47.55961365635993,
                    ],
                    Array [
                      11.116422584258226,
                      47.55964053007677,
                    ],
                    Array [
                      11.116843330715835,
                      47.559613736195715,
                    ],
                    Array [
                      11.117249188767401,
                      47.5595342234683,
                    ],
                    Array [
                      11.117625786058003,
                      47.55940480738981,
                    ],
                    Array [
                      11.117959786422682,
                      47.55923007052874,
                    ],
                  ],
                ],
                "type": "Polygon",
              },
              "properties": Object {
                "activities": Array [
                  "nordic",
                ],
                "generated": true,
                "id": "mock-UUID-1",
                "name": null,
                "runConvention": "europe",
                "sources": Array [],
                "statistics": Object {
                  "lifts": Object {
                    "byType": Object {},
                  },
                  "runs": Object {
                    "byActivity": Object {},
                  },
                },
                "status": "operating",
                "type": "skiArea",
                "website": null,
              },
              "type": "Feature",
            },
            Object {
              "geometry": Object {
                "coordinates": Array [
                  Array [
                    Array [
                      11.117959786422682,
                      47.55923007052874,
                    ],
                    Array [
                      11.118723486422681,
                      47.55874638073055,
                    ],
                    Array [
                      11.119011998428181,
                      47.5585241541848,
                    ],
                    Array [
                      11.119231136100888,
                      47.55826837392112,
                    ],
                    Array [
                      11.119372571105684,
                      47.55798876046274,
                    ],
                    Array [
                      11.119430928200133,
                      47.557695940236464,
                    ],
                    Array [
                      11.119403989520766,
                      47.557401041759,
                    ],
                    Array [
                      11.11929277887306,
                      47.55711527271637,
                    ],
                    Array [
                      11.119101522821675,
                      47.55684949400655,
                    ],
                    Array [
                      11.118837490059708,
                      47.55661380693517,
                    ],
                    Array [
                      11.11851071516175,
                      47.55641716925845,
                    ],
                    Array [
                      11.118133617219542,
                      47.556267054673974,
                    ],
                    Array [
                      11.117720527853905,
                      47.55616916871089,
                    ],
                    Array [
                      11.117287146541013,
                      47.55612723182803,
                    ],
                    Array [
                      11.116849943953222,
                      47.55614283797266,
                    ],
                    Array [
                      11.116425535990572,
                      47.55621539398219,
                    ],
                    Array [
                      11.11603005229292,
                      47.55634214213496,
                    ],
                    Array [
                      11.11520895229292,
                      47.556675050389146,
                    ],
                    Array [
                      11.114877878469857,
                      47.55683881493265,
                    ],
                    Array [
                      11.114596503281872,
                      47.55704051032089,
                    ],
                    Array [
                      11.11437422694435,
                      47.55727339789595,
                    ],
                    Array [
                      11.114218475291322,
                      47.5575296969623,
                    ],
                    Array [
                      11.114134451692337,
                      47.55780084477297,
                    ],
                    Array [
                      11.114124963217673,
                      47.55807778263157,
                    ],
                    Array [
                      11.11419032685941,
                      47.558351258547255,
                    ],
                    Array [
                      11.11424772685941,
                      47.55850205746205,
                    ],
                    Array [
                      11.114390918176566,
                      47.55877038434541,
                    ],
                    Array [
                      11.114606066582775,
                      47.559015855582686,
                    ],
                    Array [
                      11.114885553184585,
                      47.55922977885794,
                    ],
                    Array [
                      11.115219480726969,
                      47.55940457909007,
                    ],
                    Array [
                      11.11559602407763,
                      47.559534066623634,
                    ],
                    Array [
                      11.116001848981746,
                      47.55961365635993,
                    ],
                    Array [
                      11.116422584258226,
                      47.55964053007677,
                    ],
                    Array [
                      11.116843330715835,
                      47.559613736195715,
                    ],
                    Array [
                      11.117249188767401,
                      47.5595342234683,
                    ],
                    Array [
                      11.117625786058003,
                      47.55940480738981,
                    ],
                    Array [
                      11.117959786422682,
                      47.55923007052874,
                    ],
                  ],
                ],
                "type": "Polygon",
              },
              "properties": Object {
                "activities": Array [
                  "downhill",
                ],
                "generated": true,
                "id": "mock-UUID-0",
                "name": null,
                "runConvention": "europe",
                "sources": Array [],
                "statistics": Object {
                  "lifts": Object {
                    "byType": Object {},
                  },
                  "runs": Object {
                    "byActivity": Object {},
                  },
                },
                "status": "operating",
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
  } finally {
    mockFS.restore();
  }
});

it("clusters ski areas", async () => {
  TestHelpers.mockFeatureFiles(
    [
      TestHelpers.mockSkiAreaFeature({
        id: "1",
        name: "Rabenkopflift Oberau",
        status: Status.Operating,
        activities: [Activity.Downhill],
        sources: [{ type: SourceType.SKIMAP_ORG, id: "13666" }],
        geometry: {
          type: "Point",
          coordinates: [11.122066084534, 47.557111836837]
        }
      })
    ],
    [
      TestHelpers.mockLiftFeature({
        id: "2",
        name: "Skilift Oberau",
        liftType: LiftType.TBar,
        status: Status.Operating,
        geometry: {
          type: "LineString",
          coordinates: [
            [11.1223444, 47.5572422],
            [11.1164297, 47.5581563]
          ]
        }
      })
    ],
    [
      TestHelpers.mockRunFeature({
        id: "3",
        name: "Oberauer Skiabfahrt",
        uses: [RunUse.Downhill],
        difficulty: RunDifficulty.EASY,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [11.1164229, 47.558125],
              [11.1163655, 47.5579742],
              [11.1171866, 47.5576413],
              [11.1164229, 47.558125]
            ]
          ]
        }
      })
    ]
  );

  try {
    await clusterSkiAreas(
      "intermediate_ski_areas.geojson",
      "output/ski_areas.geojson",
      "intermediate_lifts.geojson",
      "output/lifts.geojson",
      "intermediate_runs.geojson",
      "output/runs.geojson",
      "http://localhost:" + container.getMappedPort(8529)
    );

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
                "color": "",
                "description": null,
                "duration": null,
                "heating": null,
                "id": "2",
                "liftType": "t-bar",
                "name": "Skilift Oberau",
                "occupancy": null,
                "oneway": null,
                "ref": null,
                "skiAreas": Array [
                  "1",
                ],
                "status": "operating",
                "type": "lift",
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
                "color": "",
                "colorName": "green",
                "description": null,
                "difficulty": "easy",
                "elevationProfile": null,
                "gladed": null,
                "grooming": null,
                "id": "3",
                "lit": null,
                "name": "Oberauer Skiabfahrt",
                "oneway": null,
                "patrolled": null,
                "ref": null,
                "skiAreas": Array [
                  "1",
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
                "id": "1",
                "name": "Rabenkopflift Oberau",
                "runConvention": "europe",
                "sources": Array [
                  Object {
                    "id": "13666",
                    "type": "skimap.org",
                  },
                ],
                "statistics": Object {
                  "lifts": Object {
                    "byType": Object {
                      "t-bar": Object {
                        "count": 1,
                        "lengthInKm": 0.4553273553619445,
                      },
                    },
                  },
                  "runs": Object {
                    "byActivity": Object {},
                  },
                },
                "status": "operating",
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
  } finally {
    mockFS.restore();
  }
});

it("clusters ski area activities independently", async () => {
  TestHelpers.mockFeatureFiles(
    [
      TestHelpers.mockSkiAreaFeature({
        id: "1",
        activities: [Activity.Downhill, Activity.Nordic],
        geometry: {
          type: "Point",
          coordinates: [0, 0]
        }
      })
    ],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "2",
        name: "Downhill run part of ski area",
        uses: [RunUse.Downhill],
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 1]
          ]
        }
      }),
      TestHelpers.mockRunFeature({
        id: "3",
        name: "Nordic run part of ski area",
        uses: [RunUse.Nordic],
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [-1, -1]
          ]
        }
      }),
      TestHelpers.mockRunFeature({
        id: "4",
        name: "Nordic run not part of ski area",
        uses: [RunUse.Nordic],
        geometry: {
          type: "LineString",
          coordinates: [
            [1, 1],
            [2, 2]
          ]
        }
      })
    ]
  );

  try {
    await clusterSkiAreas(
      "intermediate_ski_areas.geojson",
      "output/ski_areas.geojson",
      "intermediate_lifts.geojson",
      "output/lifts.geojson",
      "intermediate_runs.geojson",
      "output/runs.geojson",
      "http://localhost:" + container.getMappedPort(8529)
    );

    const runsResult = TestHelpers.fileContents(
      "output/runs.geojson"
    ).features.map((run: RunFeature) => {
      return { name: run.properties.name, skiAreas: run.properties.skiAreas };
    });

    expect(runsResult).toMatchInlineSnapshot(`
      Array [
        Object {
          "name": "Downhill run part of ski area",
          "skiAreas": Array [
            "1",
          ],
        },
        Object {
          "name": "Nordic run part of ski area",
          "skiAreas": Array [
            "1",
          ],
        },
        Object {
          "name": "Nordic run not part of ski area",
          "skiAreas": Array [
            "mock-UUID-0",
          ],
        },
      ]
    `);
  } finally {
    mockFS.restore();
  }
});

it("generates a downhill ski area but does not include backcountry runs when clustering from a mixed use run", async () => {
  TestHelpers.mockFeatureFiles(
    [],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "3",
        name: "Downhill Run & Backcountry Route",
        uses: [RunUse.Downhill, RunUse.Skitour],
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 0]
          ]
        }
      }),
      TestHelpers.mockRunFeature({
        id: "4",
        name: "Backcountry Route",
        uses: [RunUse.Skitour],
        difficulty: RunDifficulty.EASY,
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [0, 1]
          ]
        }
      })
    ]
  );

  try {
    await clusterSkiAreas(
      "intermediate_ski_areas.geojson",
      "output/ski_areas.geojson",
      "intermediate_lifts.geojson",
      "output/lifts.geojson",
      "intermediate_runs.geojson",
      "output/runs.geojson",
      "http://localhost:" + container.getMappedPort(8529)
    );

    expect(TestHelpers.folderContents("output")).toMatchInlineSnapshot(`
Map {
  "output/lifts.geojson" => Object {
    "features": Array [],
    "type": "FeatureCollection",
  },
  "output/runs.geojson" => Object {
    "features": Array [
      Object {
        "geometry": Object {
          "coordinates": Array [
            Array [
              0,
              0,
            ],
            Array [
              1,
              0,
            ],
          ],
          "type": "LineString",
        },
        "properties": Object {
          "color": "",
          "colorName": "green",
          "description": null,
          "difficulty": null,
          "elevationProfile": null,
          "gladed": null,
          "grooming": null,
          "id": "3",
          "lit": null,
          "name": "Downhill Run & Backcountry Route",
          "oneway": null,
          "patrolled": null,
          "ref": null,
          "skiAreas": Array [
            "mock-UUID-0",
          ],
          "status": "operating",
          "type": "run",
          "uses": Array [
            "downhill",
            "skitour",
          ],
        },
        "type": "Feature",
      },
      Object {
        "geometry": Object {
          "coordinates": Array [
            Array [
              0,
              0,
            ],
            Array [
              0,
              1,
            ],
          ],
          "type": "LineString",
        },
        "properties": Object {
          "color": "",
          "colorName": "green",
          "description": null,
          "difficulty": "easy",
          "elevationProfile": null,
          "gladed": null,
          "grooming": null,
          "id": "4",
          "lit": null,
          "name": "Backcountry Route",
          "oneway": null,
          "patrolled": null,
          "ref": null,
          "skiAreas": Array [],
          "status": "operating",
          "type": "run",
          "uses": Array [
            "skitour",
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
            Array [
              Array [
                1,
                0.0022457882097141214,
              ],
              Array [
                1.0004381315451272,
                0.002202636019010258,
              ],
              Array [
                1.0008594259406822,
                0.002074837761392924,
              ],
              Array [
                1.0012476930793084,
                0.001867304652194123,
              ],
              Array [
                1.001588012072611,
                0.0015880120724001414,
              ],
              Array [
                1.0018673046525308,
                0.001247693079206891,
              ],
              Array [
                1.0020748377618502,
                0.000859425940633209,
              ],
              Array [
                1.0022026360195642,
                0.0004381315451097578,
              ],
              Array [
                1.0022457882102989,
                0,
              ],
              Array [
                1.0022026360195642,
                -0.00043813154513520225,
              ],
              Array [
                1.0020748377618502,
                -0.0008594259406586534,
              ],
              Array [
                1.0018673046525308,
                -0.0012476930792196133,
              ],
              Array [
                1.001588012072611,
                -0.0015880120724128634,
              ],
              Array [
                1.0012476930793084,
                -0.0018673046522068451,
              ],
              Array [
                1.0008594259406822,
                -0.0020748377614056464,
              ],
              Array [
                1.0004381315451272,
                -0.0022026360190357023,
              ],
              Array [
                1,
                -0.002245788209739566,
              ],
              Array [
                0,
                -0.002245788209739566,
              ],
              Array [
                -0.00043813154512721883,
                -0.0022026360190357023,
              ],
              Array [
                -0.0008594259406821995,
                -0.0020748377614056464,
              ],
              Array [
                -0.0012476930793083817,
                -0.0018673046522068451,
              ],
              Array [
                -0.0015880120726110847,
                -0.0015880120724128634,
              ],
              Array [
                -0.0018673046525307737,
                -0.0012476930792196133,
              ],
              Array [
                -0.0020748377618502183,
                -0.0008594259406586534,
              ],
              Array [
                -0.0022026360195641814,
                -0.00043813154513520225,
              ],
              Array [
                -0.0022457882102988034,
                0,
              ],
              Array [
                -0.0022026360195641814,
                0.0004381315451097578,
              ],
              Array [
                -0.002074837761850218,
                0.000859425940633209,
              ],
              Array [
                -0.0018673046525307733,
                0.001247693079206891,
              ],
              Array [
                -0.0015880120726110842,
                0.0015880120724001414,
              ],
              Array [
                -0.001247693079308381,
                0.001867304652194123,
              ],
              Array [
                -0.0008594259406821972,
                0.002074837761392924,
              ],
              Array [
                -0.00043813154512721634,
                0.002202636019010258,
              ],
              Array [
                0,
                0.0022457882097141214,
              ],
              Array [
                1,
                0.0022457882097141214,
              ],
            ],
          ],
          "type": "Polygon",
        },
        "properties": Object {
          "activities": Array [
            "downhill",
          ],
          "generated": true,
          "id": "mock-UUID-0",
          "name": null,
          "runConvention": "europe",
          "sources": Array [],
          "statistics": Object {
            "lifts": Object {
              "byType": Object {},
            },
            "runs": Object {
              "byActivity": Object {
                "downhill": Object {
                  "byDifficulty": Object {
                    "other": Object {
                      "count": 1,
                      "lengthInKm": 111.1950802335329,
                    },
                  },
                },
              },
            },
          },
          "status": "operating",
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
  } finally {
    mockFS.restore();
  }
});

it("generates elevation statistics for run", async () => {
  TestHelpers.mockFeatureFiles(
    [],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "3",
        name: "Downhill Run",
        uses: [RunUse.Downhill],
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0, 100],
            [1, 0, 90]
          ]
        }
      })
    ]
  );

  try {
    await clusterSkiAreas(
      "intermediate_ski_areas.geojson",
      "output/ski_areas.geojson",
      "intermediate_lifts.geojson",
      "output/lifts.geojson",
      "intermediate_runs.geojson",
      "output/runs.geojson",
      "http://localhost:" + container.getMappedPort(8529)
    );

    expect(TestHelpers.fileContents("output/ski_areas.geojson"))
      .toMatchInlineSnapshot(`
Object {
  "features": Array [
    Object {
      "geometry": Object {
        "coordinates": Array [
          Array [
            Array [
              1,
              0.0022457882097141214,
            ],
            Array [
              1.0004381315451272,
              0.002202636019010258,
            ],
            Array [
              1.0008594259406822,
              0.002074837761392924,
            ],
            Array [
              1.0012476930793084,
              0.001867304652194123,
            ],
            Array [
              1.001588012072611,
              0.0015880120724001414,
            ],
            Array [
              1.0018673046525308,
              0.001247693079206891,
            ],
            Array [
              1.0020748377618502,
              0.000859425940633209,
            ],
            Array [
              1.0022026360195642,
              0.0004381315451097578,
            ],
            Array [
              1.0022457882102989,
              0,
            ],
            Array [
              1.0022026360195642,
              -0.00043813154513520225,
            ],
            Array [
              1.0020748377618502,
              -0.0008594259406586534,
            ],
            Array [
              1.0018673046525308,
              -0.0012476930792196133,
            ],
            Array [
              1.001588012072611,
              -0.0015880120724128634,
            ],
            Array [
              1.0012476930793084,
              -0.0018673046522068451,
            ],
            Array [
              1.0008594259406822,
              -0.0020748377614056464,
            ],
            Array [
              1.0004381315451272,
              -0.0022026360190357023,
            ],
            Array [
              1,
              -0.002245788209739566,
            ],
            Array [
              0,
              -0.002245788209739566,
            ],
            Array [
              -0.00043813154512721883,
              -0.0022026360190357023,
            ],
            Array [
              -0.0008594259406821995,
              -0.0020748377614056464,
            ],
            Array [
              -0.0012476930793083817,
              -0.0018673046522068451,
            ],
            Array [
              -0.0015880120726110847,
              -0.0015880120724128634,
            ],
            Array [
              -0.0018673046525307737,
              -0.0012476930792196133,
            ],
            Array [
              -0.0020748377618502183,
              -0.0008594259406586534,
            ],
            Array [
              -0.0022026360195641814,
              -0.00043813154513520225,
            ],
            Array [
              -0.0022457882102988034,
              0,
            ],
            Array [
              -0.0022026360195641814,
              0.0004381315451097578,
            ],
            Array [
              -0.002074837761850218,
              0.000859425940633209,
            ],
            Array [
              -0.0018673046525307733,
              0.001247693079206891,
            ],
            Array [
              -0.0015880120726110842,
              0.0015880120724001414,
            ],
            Array [
              -0.001247693079308381,
              0.001867304652194123,
            ],
            Array [
              -0.0008594259406821972,
              0.002074837761392924,
            ],
            Array [
              -0.00043813154512721634,
              0.002202636019010258,
            ],
            Array [
              0,
              0.0022457882097141214,
            ],
            Array [
              1,
              0.0022457882097141214,
            ],
          ],
        ],
        "type": "Polygon",
      },
      "properties": Object {
        "activities": Array [
          "downhill",
        ],
        "generated": true,
        "id": "mock-UUID-0",
        "name": null,
        "runConvention": "europe",
        "sources": Array [],
        "statistics": Object {
          "lifts": Object {
            "byType": Object {},
          },
          "maxElevation": 100,
          "minElevation": 90,
          "runs": Object {
            "byActivity": Object {
              "downhill": Object {
                "byDifficulty": Object {
                  "other": Object {
                    "combinedElevationChange": 10,
                    "count": 1,
                    "lengthInKm": 111.1950802335329,
                    "maxElevation": 100,
                    "minElevation": 90,
                  },
                },
              },
            },
            "maxElevation": 100,
            "minElevation": 90,
          },
        },
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
  } finally {
    mockFS.restore();
  }
});

it("generates elevation statistics for run & lift based on lift served skiable vertical", async () => {
  TestHelpers.mockFeatureFiles(
    [],
    [
      TestHelpers.mockLiftFeature({
        id: "2",
        name: "Skilift Oberau",
        liftType: LiftType.TBar,
        status: Status.Operating,
        geometry: {
          type: "LineString",
          coordinates: [
            [11.1223444, 47.5572422, 100],
            [11.1164297, 47.5581563, 200]
          ]
        }
      })
    ],
    [
      TestHelpers.mockRunFeature({
        id: "3",
        name: "Downhill Run",
        uses: [RunUse.Downhill],
        geometry: {
          type: "LineString",
          coordinates: [
            [11.1220444, 47.5572422, 150],
            [11.1160297, 47.5581563, 250]
          ]
        }
      })
    ]
  );

  try {
    await clusterSkiAreas(
      "intermediate_ski_areas.geojson",
      "output/ski_areas.geojson",
      "intermediate_lifts.geojson",
      "output/lifts.geojson",
      "intermediate_runs.geojson",
      "output/runs.geojson",
      "http://localhost:" + container.getMappedPort(8529)
    );

    expect(TestHelpers.fileContents("output/ski_areas.geojson"))
      .toMatchInlineSnapshot(`
Object {
  "features": Array [
    Object {
      "geometry": Object {
        "coordinates": Array [
          Array [
            Array [
              11.113784622465953,
              47.558194424360536,
            ],
            Array [
              11.113816739603811,
              47.557898115400064,
            ],
            Array [
              11.113933899568654,
              47.55761172673288,
            ],
            Array [
              11.11413159996873,
              47.557346264364554,
            ],
            Array [
              11.114402243288545,
              47.55711193025558,
            ],
            Array [
              11.114735428857093,
              47.55691773020628,
            ],
            Array [
              11.115118352539827,
              47.55677112769716,
            ],
            Array [
              11.115536298794366,
              47.55667775699817,
            ],
            Array [
              11.121550998794365,
              47.55576363120351,
            ],
            Array [
              11.121987906180534,
              47.55572708015098,
            ],
            Array [
              11.122174540823021,
              47.55573629331586,
            ],
            Array [
              11.12227977768121,
              47.55572722812798,
            ],
            Array [
              11.122718969503245,
              47.5557478300556,
            ],
            Array [
              11.12314376682933,
              47.555825860538896,
            ],
            Array [
              11.123537844936454,
              47.55595832066348,
            ],
            Array [
              11.123886059623961,
              47.55614011967264,
            ],
            Array [
              11.124175029196692,
              47.55636427066129,
            ],
            Array [
              11.124393648716024,
              47.55662215915066,
            ],
            Array [
              11.124533516756433,
              47.5569038742112,
            ],
            Array [
              11.12458925826756,
              47.55719858939787,
            ],
            Array [
              11.124558731134396,
              47.557494978849114,
            ],
            Array [
              11.12444310849755,
              47.55778165255184,
            ],
            Array [
              11.12424683367011,
              47.558047594043096,
            ],
            Array [
              11.123977449383625,
              47.55828258372895,
            ],
            Array [
              11.123645307925155,
              47.55847759155863,
            ],
            Array [
              11.123263173304675,
              47.55862512397262,
            ],
            Array [
              11.122845730741354,
              47.5587195118025,
            ],
            Array [
              11.116931030741355,
              47.55963358602921,
            ],
            Array [
              11.116494322318792,
              47.55967120164058,
            ],
            Array [
              11.116233954853362,
              47.55965898904971,
            ],
            Array [
              11.116086193819466,
              47.55967134960643,
            ],
            Array [
              11.115647115407498,
              47.5596496762509,
            ],
            Array [
              11.115222739506864,
              47.55957061403728,
            ],
            Array [
              11.114829374645431,
              47.55943720103244,
            ],
            Array [
              11.114482137614225,
              47.55925456383276,
            ],
            Array [
              11.114194372537622,
              47.559029720611484,
            ],
            Array [
              11.113977138066133,
              47.558771311485984,
            ],
            Array [
              11.113838782398675,
              47.558489266556315,
            ],
            Array [
              11.113784622465953,
              47.558194424360536,
            ],
          ],
        ],
        "type": "Polygon",
      },
      "properties": Object {
        "activities": Array [
          "downhill",
        ],
        "generated": true,
        "id": "mock-UUID-0",
        "name": null,
        "runConvention": "europe",
        "sources": Array [],
        "statistics": Object {
          "lifts": Object {
            "byType": Object {
              "t-bar": Object {
                "combinedElevationChange": 100,
                "count": 1,
                "lengthInKm": 0.4553273553619445,
                "maxElevation": 200,
                "minElevation": 100,
              },
            },
            "maxElevation": 200,
            "minElevation": 100,
          },
          "maxElevation": 200,
          "minElevation": 150,
          "runs": Object {
            "byActivity": Object {
              "downhill": Object {
                "byDifficulty": Object {
                  "other": Object {
                    "combinedElevationChange": 100,
                    "count": 1,
                    "lengthInKm": 0.46264499967438083,
                    "maxElevation": 250,
                    "minElevation": 150,
                  },
                },
              },
            },
            "maxElevation": 250,
            "minElevation": 150,
          },
        },
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
  } finally {
    mockFS.restore();
  }
});

it("allows point & multilinestring lifts to be processed", async () => {
  TestHelpers.mockFeatureFiles(
    [],
    [
      TestHelpers.mockLiftFeature({
        id: "2",
        name: "Skilift Oberau",
        liftType: LiftType.TBar,
        status: Status.Operating,
        geometry: {
          type: "MultiLineString",
          coordinates: [
            [
              [25.430488, 36.420539900000016, 238.44396972656193],
              [25.4273675, 36.4188913, 18.190246582031193]
            ],
            [
              [25.427413799999993, 36.4188392, 15.1902456283569],
              [25.430537199999993, 36.4204801, 237.44396972656193]
            ]
          ]
        }
      }),
      TestHelpers.mockLiftFeature({
        id: "3",
        name: "Gondola",
        liftType: LiftType.Gondola,
        geometry: {
          type: "Point",
          coordinates: [12.2447153, 47.5270405, 719.0122680664059]
        }
      })
    ],
    []
  );

  try {
    await clusterSkiAreas(
      "intermediate_ski_areas.geojson",
      "output/ski_areas.geojson",
      "intermediate_lifts.geojson",
      "output/lifts.geojson",
      "intermediate_runs.geojson",
      "output/runs.geojson",
      "http://localhost:" + container.getMappedPort(8529)
    );

    expect(TestHelpers.fileContents("output/lifts.geojson"))
      .toMatchInlineSnapshot(`
      Object {
        "features": Array [
          Object {
            "geometry": Object {
              "coordinates": Array [
                Array [
                  Array [
                    25.430488,
                    36.42053990000002,
                    238.44396972656187,
                  ],
                  Array [
                    25.4273675,
                    36.4188913,
                    18.190246582031186,
                  ],
                ],
                Array [
                  Array [
                    25.42741379999999,
                    36.4188392,
                    15.1902456283569,
                  ],
                  Array [
                    25.43053719999999,
                    36.4204801,
                    237.44396972656187,
                  ],
                ],
              ],
              "type": "MultiLineString",
            },
            "properties": Object {
              "bubble": null,
              "capacity": null,
              "color": "",
              "description": null,
              "duration": null,
              "heating": null,
              "id": "2",
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
          Object {
            "geometry": Object {
              "coordinates": Array [
                12.244715299999998,
                47.5270405,
                719.0122680664058,
              ],
              "type": "Point",
            },
            "properties": Object {
              "bubble": null,
              "capacity": null,
              "color": "",
              "description": null,
              "duration": null,
              "heating": null,
              "id": "3",
              "liftType": "gondola",
              "name": "Gondola",
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
  } finally {
    mockFS.restore();
  }
});

it("does not generate ski area for lone snow park", async () => {
  TestHelpers.mockFeatureFiles(
    [],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "1",
        name: "Terrain Park",
        uses: [RunUse.SnowPark],
        difficulty: RunDifficulty.EASY,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [11.1164229, 47.558125],
              [11.1163655, 47.5579742],
              [11.1171866, 47.5576413],
              [11.1164229, 47.558125]
            ]
          ]
        }
      })
    ]
  );

  try {
    await clusterSkiAreas(
      "intermediate_ski_areas.geojson",
      "output/ski_areas.geojson",
      "intermediate_lifts.geojson",
      "output/lifts.geojson",
      "intermediate_runs.geojson",
      "output/runs.geojson",
      "http://localhost:" + container.getMappedPort(8529)
    );

    expect(TestHelpers.fileContents("output/ski_areas.geojson"))
      .toMatchInlineSnapshot(`
      Object {
        "features": Array [],
        "type": "FeatureCollection",
      }
    `);
  } finally {
    mockFS.restore();
  }
});

it("generates ski area which includes the snow park", async () => {
  TestHelpers.mockFeatureFiles(
    [],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "1",
        name: "Run",
        uses: [RunUse.Downhill],
        difficulty: RunDifficulty.EASY,
        geometry: {
          type: "LineString",
          coordinates: [
            [11.1223444, 47.5572422],
            [11.1164297, 47.5581563]
          ]
        }
      }),
      TestHelpers.mockRunFeature({
        id: "2",
        name: "Terrain Park",
        uses: [RunUse.SnowPark],
        difficulty: RunDifficulty.EASY,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [11.1164229, 47.558125],
              [11.1163655, 47.5579742],
              [11.1171866, 47.5576413],
              [11.1164229, 47.558125]
            ]
          ]
        }
      })
    ]
  );

  try {
    await clusterSkiAreas(
      "intermediate_ski_areas.geojson",
      "output/ski_areas.geojson",
      "intermediate_lifts.geojson",
      "output/lifts.geojson",
      "intermediate_runs.geojson",
      "output/runs.geojson",
      "http://localhost:" + container.getMappedPort(8529)
    );

    expect(
      TestHelpers.fileContents("output/runs.geojson").features.map(
        (feature: any) => {
          return {
            id: feature.properties.id,
            skiAreas: feature.properties.skiAreas
          };
        }
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "1",
          "skiAreas": Array [
            "mock-UUID-0",
          ],
        },
        Object {
          "id": "2",
          "skiAreas": Array [
            "mock-UUID-0",
          ],
        },
      ]
    `);
  } finally {
    mockFS.restore();
  }
});

it("generates ski area which includes the patrolled ungroomed run", async () => {
  TestHelpers.mockFeatureFiles(
    [],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "1",
        name: "Run",
        uses: [RunUse.Downhill],
        patrolled: true,
        grooming: RunGrooming.Backcountry,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [11.1164229, 47.558125],
              [11.1163655, 47.5579742],
              [11.1171866, 47.5576413],
              [11.1164229, 47.558125]
            ]
          ]
        }
      })
    ]
  );

  try {
    await clusterSkiAreas(
      "intermediate_ski_areas.geojson",
      "output/ski_areas.geojson",
      "intermediate_lifts.geojson",
      "output/lifts.geojson",
      "intermediate_runs.geojson",
      "output/runs.geojson",
      "http://localhost:" + container.getMappedPort(8529)
    );

    expect(
      TestHelpers.fileContents("output/runs.geojson").features.map(
        (feature: any) => {
          return {
            id: feature.properties.id,
            skiAreas: feature.properties.skiAreas
          };
        }
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "1",
          "skiAreas": Array [
            "mock-UUID-0",
          ],
        },
      ]
    `);
  } finally {
    mockFS.restore();
  }
});

it("does not generate ski area for ungroomed run", async () => {
  TestHelpers.mockFeatureFiles(
    [],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "1",
        name: "Run",
        uses: [RunUse.Downhill],
        grooming: RunGrooming.Backcountry,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [11.1164229, 47.558125],
              [11.1163655, 47.5579742],
              [11.1171866, 47.5576413],
              [11.1164229, 47.558125]
            ]
          ]
        }
      })
    ]
  );

  try {
    await clusterSkiAreas(
      "intermediate_ski_areas.geojson",
      "output/ski_areas.geojson",
      "intermediate_lifts.geojson",
      "output/lifts.geojson",
      "intermediate_runs.geojson",
      "output/runs.geojson",
      "http://localhost:" + container.getMappedPort(8529)
    );

    expect(TestHelpers.fileContents("output/ski_areas.geojson"))
      .toMatchInlineSnapshot(`
      Object {
        "features": Array [],
        "type": "FeatureCollection",
      }
    `);
  } finally {
    mockFS.restore();
  }
});

async function sleep(ms: number) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

let accumulatedLogs: any[] = [];
let logMock: jest.SpyInstance;

function mockConsoleLog() {
  logMock = jest.spyOn(console, "log").mockImplementation((...args) => {
    accumulatedLogs.push(args);
  });
}

function restoreConsoleLog() {
  logMock.mockRestore();
  accumulatedLogs.map(el => console.log(...el));
  accumulatedLogs = [];
}
