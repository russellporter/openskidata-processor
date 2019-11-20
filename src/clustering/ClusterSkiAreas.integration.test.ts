import mockFS from "mock-fs";
import {
  Activity,
  LiftType,
  RunDifficulty,
  RunUse,
  SourceType,
  Status
} from "openskidata-format";
import { GenericContainer } from "testcontainers";
import { StartedTestContainer } from "testcontainers/dist/test-container";
import * as TestHelpers from "../TestHelpers";
import clusterSkiAreas from "./ClusterSkiAreas";

let mockUuidCount = 0;
jest.mock(
  "uuid/v4",
  (): (() => string) => {
    return () => "mock-UUID-" + mockUuidCount++;
  }
);

// Increase timeout to give time to set up the container
jest.setTimeout(60 * 1000);

let container: StartedTestContainer;
beforeAll(async () => {
  container = await new GenericContainer("arangodb")
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
                "gladed": null,
                "grooming": null,
                "id": "3",
                "lit": null,
                "name": "Sledding run",
                "oneway": null,
                "patrolled": null,
                "ref": null,
                "skiAreas": Array [],
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
                  11.116658333333334,
                  47.557913500000005,
                ],
                "type": "Point",
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
                  11.116658333333334,
                  47.557913500000005,
                ],
                "type": "Point",
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
              },
              "type": "Feature",
            },
            Object {
              "geometry": Object {
                "coordinates": Array [
                  11.116658333333334,
                  47.557913500000005,
                ],
                "type": "Point",
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
          coordinates: [[11.1223444, 47.5572422], [11.1164297, 47.5581563]]
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
          coordinates: [[0, 0], [1, 0]]
        }
      }),
      TestHelpers.mockRunFeature({
        id: "4",
        name: "Backcountry Route",
        uses: [RunUse.Skitour],
        difficulty: RunDifficulty.EASY,
        geometry: {
          type: "LineString",
          coordinates: [[0, 0], [0, 1]]
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
                "gladed": null,
                "grooming": null,
                "id": "4",
                "lit": null,
                "name": "Backcountry Route",
                "oneway": null,
                "patrolled": null,
                "ref": null,
                "skiAreas": Array [],
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
                  0.5,
                  0,
                ],
                "type": "Point",
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
                      "backcountry": Object {
                        "byDifficulty": Object {
                          "other": Object {
                            "count": 1,
                            "lengthInKm": 111.1950802335329,
                          },
                        },
                      },
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
