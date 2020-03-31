import mockFS from "mock-fs";
import {
  Activity,
  LiftFeature,
  LiftType,
  RunDifficulty,
  RunFeature,
  RunGrooming,
  RunUse,
  SkiAreaFeature,
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

    expect(
      TestHelpers.fileContents("output/runs.geojson").features.map(
        simplifiedRunFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "3",
          "name": "Oberauer Skiabfahrt",
          "skiAreas": Array [
            "mock-UUID-0",
          ],
        },
        Object {
          "id": "4",
          "name": "Another run nearby",
          "skiAreas": Array [
            "mock-UUID-0",
          ],
        },
      ]
    `);
    expect(
      TestHelpers.fileContents("output/ski_areas.geojson").features.map(
        simplifiedSkiAreaFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "activities": Array [
            "downhill",
          ],
          "id": "mock-UUID-0",
          "name": null,
        },
      ]
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

    expect(
      TestHelpers.fileContents("output/runs.geojson").features.map(
        simplifiedRunFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "3",
          "name": "Downhill Run",
          "skiAreas": Array [
            "mock-UUID-0",
          ],
        },
        Object {
          "id": "4",
          "name": "Nordic run",
          "skiAreas": Array [
            "mock-UUID-1",
          ],
        },
      ]
    `);

    let features: SkiAreaFeature[] = TestHelpers.fileContents(
      "output/ski_areas.geojson"
    ).features;
    let simplifiedFeatures = features
      .map(simplifiedSkiAreaFeature)
      // Ensure snapshots are consistent across test runs
      .sort(orderedByID);

    expect(simplifiedFeatures).toMatchInlineSnapshot(`
      Array [
        Object {
          "activities": Array [
            "downhill",
          ],
          "id": "mock-UUID-0",
          "name": null,
        },
        Object {
          "activities": Array [
            "nordic",
          ],
          "id": "mock-UUID-1",
          "name": null,
        },
      ]
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

    expect(
      TestHelpers.fileContents("output/lifts.geojson").features.map(
        simplifiedLiftFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "2",
          "name": "Skilift Oberau",
          "skiAreas": Array [
            "1",
          ],
        },
      ]
    `);

    expect(
      TestHelpers.fileContents("output/runs.geojson").features.map(
        simplifiedRunFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "3",
          "name": "Oberauer Skiabfahrt",
          "skiAreas": Array [
            "1",
          ],
        },
      ]
    `);

    expect(
      TestHelpers.fileContents("output/ski_areas.geojson").features.map(
        simplifiedSkiAreaFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "activities": Array [
            "downhill",
          ],
          "id": "1",
          "name": "Rabenkopflift Oberau",
        },
      ]
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

    expect(
      TestHelpers.fileContents("output/runs.geojson").features.map(
        simplifiedRunFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "2",
          "name": "Downhill run part of ski area",
          "skiAreas": Array [
            "1",
          ],
        },
        Object {
          "id": "3",
          "name": "Nordic run part of ski area",
          "skiAreas": Array [
            "1",
          ],
        },
        Object {
          "id": "4",
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

    expect(
      TestHelpers.fileContents("output/runs.geojson").features.map(
        simplifiedRunFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "3",
          "name": "Downhill Run & Backcountry Route",
          "skiAreas": Array [
            "mock-UUID-0",
          ],
        },
        Object {
          "id": "4",
          "name": "Backcountry Route",
          "skiAreas": Array [],
        },
      ]
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

    expect(
      TestHelpers.fileContents("output/ski_areas.geojson").features.map(
        simplifiedSkiAreaFeatureWithStatistics
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "activities": Array [
            "downhill",
          ],
          "id": "mock-UUID-0",
          "name": null,
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
        },
      ]
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

    expect(
      TestHelpers.fileContents("output/ski_areas.geojson").features.map(
        simplifiedSkiAreaFeatureWithStatistics
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "activities": Array [
            "downhill",
          ],
          "id": "mock-UUID-0",
          "name": null,
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
        },
      ]
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

    expect(
      TestHelpers.fileContents("output/lifts.geojson").features.map(
        simplifiedLiftFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "2",
          "name": "Skilift Oberau",
          "skiAreas": Array [],
        },
        Object {
          "id": "3",
          "name": "Gondola",
          "skiAreas": Array [],
        },
      ]
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
        simplifiedRunFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "1",
          "name": "Run",
          "skiAreas": Array [
            "mock-UUID-0",
          ],
        },
        Object {
          "id": "2",
          "name": "Terrain Park",
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
        simplifiedRunFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "1",
          "name": "Run",
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

it("associates lifts and runs with polygon openstreetmap ski area", async () => {
  TestHelpers.mockFeatureFiles(
    [
      TestHelpers.mockSkiAreaFeature({
        id: "1",
        name: "Rabenkopflift Oberau",
        activities: [Activity.Downhill],
        sources: [{ type: SourceType.OPENSTREETMAP, id: "13666" }],
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [11, 47],
              [12, 47],
              [12, 48],
              [11, 48],
              [11, 47]
            ]
          ]
        }
      })
    ],
    [
      TestHelpers.mockLiftFeature({
        id: "2",
        name: "Skilift Oberau",
        liftType: LiftType.TBar,
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

    expect(
      TestHelpers.fileContents("output/lifts.geojson").features.map(
        simplifiedLiftFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "2",
          "name": "Skilift Oberau",
          "skiAreas": Array [
            "1",
          ],
        },
      ]
    `);

    expect(
      TestHelpers.fileContents("output/runs.geojson").features.map(
        simplifiedRunFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "3",
          "name": "Oberauer Skiabfahrt",
          "skiAreas": Array [
            "1",
          ],
        },
      ]
    `);
  } finally {
    mockFS.restore();
  }
});

it("associates lifts and runs adjacent to polygon openstreetmap ski area when no other polygon contains them", async () => {
  TestHelpers.mockFeatureFiles(
    [
      TestHelpers.mockSkiAreaFeature({
        id: "1",
        name: "Ski Area",
        activities: [Activity.Downhill],
        sources: [{ type: SourceType.OPENSTREETMAP, id: "13666" }],
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0.0001],
              [0.0001, 0.0001],
              [0.0001, 0.0002],
              [0, 0.0002],
              [0, 0.0001]
            ]
          ]
        }
      })
    ],
    [
      TestHelpers.mockLiftFeature({
        id: "2",
        name: "Lift",
        liftType: LiftType.TBar,
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 0]
          ]
        }
      })
    ],
    [
      TestHelpers.mockRunFeature({
        id: "3",
        name: "Run",
        uses: [RunUse.Downhill],
        difficulty: RunDifficulty.EASY,
        geometry: {
          type: "LineString",
          coordinates: [
            [1, 0],
            [1, 1]
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
      TestHelpers.fileContents("output/lifts.geojson").features.map(
        simplifiedLiftFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "2",
          "name": "Lift",
          "skiAreas": Array [
            "1",
          ],
        },
      ]
      `);

    expect(
      TestHelpers.fileContents("output/runs.geojson").features.map(
        simplifiedRunFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "3",
          "name": "Run",
          "skiAreas": Array [
            "1",
          ],
        },
      ]
      `);
  } finally {
    mockFS.restore();
  }
});

it("associates lifts correctly to adjacent ski areas based on their polygons", async () => {
  TestHelpers.mockFeatureFiles(
    [
      TestHelpers.mockSkiAreaFeature({
        id: "1",
        activities: [Activity.Downhill],
        sources: [{ type: SourceType.OPENSTREETMAP, id: "1" }],
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0]
            ]
          ]
        }
      }),
      TestHelpers.mockSkiAreaFeature({
        id: "2",
        activities: [Activity.Downhill],
        sources: [{ type: SourceType.OPENSTREETMAP, id: "2" }],
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [-1, 0],
              [-1, -1],
              [0, -1],
              [0, 0]
            ]
          ]
        }
      })
    ],
    [
      TestHelpers.mockLiftFeature({
        id: "3",
        name: "Ski Area 1: Lift",
        liftType: LiftType.TBar,
        geometry: {
          type: "LineString",
          coordinates: [
            [0.0001, 0],
            [1, 0]
          ]
        }
      }),
      TestHelpers.mockLiftFeature({
        id: "4",
        name: "Ski Area 2: Lift",
        liftType: LiftType.TBar,
        geometry: {
          type: "LineString",
          coordinates: [
            [-0.0001, 0],
            [-1, 0]
          ]
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

    expect(
      TestHelpers.fileContents("output/lifts.geojson").features.map(
        simplifiedLiftFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "3",
          "name": "Ski Area 1: Lift",
          "skiAreas": Array [
            "1",
          ],
        },
        Object {
          "id": "4",
          "name": "Ski Area 2: Lift",
          "skiAreas": Array [
            "2",
          ],
        },
      ]
      `);
  } finally {
    mockFS.restore();
  }
});

it("merges Skimap.org ski area with OpenStreetMap ski area", async () => {
  TestHelpers.mockFeatureFiles(
    [
      TestHelpers.mockSkiAreaFeature({
        id: "1",
        activities: [Activity.Downhill],
        sources: [{ type: SourceType.OPENSTREETMAP, id: "1" }],
        geometry: {
          type: "Point",
          coordinates: [0, 0]
        }
      }),
      TestHelpers.mockSkiAreaFeature({
        id: "2",
        activities: [Activity.Downhill],
        sources: [{ type: SourceType.SKIMAP_ORG, id: "2" }],
        geometry: {
          type: "Point",
          coordinates: [1, 0]
        }
      })
    ],
    [
      TestHelpers.mockLiftFeature({
        id: "3",
        name: "Lift",
        liftType: LiftType.TBar,
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 0]
          ]
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

    expect(
      TestHelpers.fileContents("output/ski_areas.geojson").features.map(
        simplifiedSkiAreaFeatureWithSources
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "activities": Array [
            "downhill",
          ],
          "id": "2",
          "name": "Name",
          "sources": Array [
            Object {
              "id": "2",
              "type": "skimap.org",
            },
            Object {
              "id": "1",
              "type": "openstreetmap",
            },
          ],
        },
      ]
      `);

    expect(
      TestHelpers.fileContents("output/lifts.geojson").features.map(
        simplifiedLiftFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "3",
          "name": "Lift",
          "skiAreas": Array [
            "2",
          ],
        },
      ]
      `);
  } finally {
    mockFS.restore();
  }
});

it("removes OpenStreetMap ski areas that span across multiple Skimap.org ski areas", async () => {
  TestHelpers.mockFeatureFiles(
    [
      TestHelpers.mockSkiAreaFeature({
        id: "1",
        activities: [Activity.Downhill],
        sources: [{ type: SourceType.OPENSTREETMAP, id: "1" }],
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0]
            ]
          ]
        }
      }),
      TestHelpers.mockSkiAreaFeature({
        id: "2",
        activities: [Activity.Downhill],
        sources: [{ type: SourceType.SKIMAP_ORG, id: "2" }],
        geometry: {
          type: "Point",
          coordinates: [0.25, 0.25]
        }
      }),
      TestHelpers.mockSkiAreaFeature({
        id: "3",
        activities: [Activity.Downhill],
        sources: [{ type: SourceType.SKIMAP_ORG, id: "2" }],
        geometry: {
          type: "Point",
          coordinates: [0.75, 0.75]
        }
      })
    ],
    [],
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

    expect(
      TestHelpers.fileContents("output/ski_areas.geojson")
        .features.map(simplifiedSkiAreaFeature)
        .sort(orderedByID)
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "activities": Array [
            "downhill",
          ],
          "id": "2",
          "name": "Name",
        },
        Object {
          "activities": Array [
            "downhill",
          ],
          "id": "3",
          "name": "Name",
        },
      ]
      `);
  } finally {
    mockFS.restore();
  }
});

it("adds activities to OpenStreetMap ski areas based on the associated runs", async () => {
  TestHelpers.mockFeatureFiles(
    [
      TestHelpers.mockSkiAreaFeature({
        id: "1",
        activities: [],
        sources: [{ type: SourceType.OPENSTREETMAP, id: "1" }],
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0]
            ]
          ]
        }
      })
    ],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "2",
        name: "Nordic trail",
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 0]
          ]
        },
        uses: [RunUse.Nordic]
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
      TestHelpers.fileContents("output/ski_areas.geojson").features.map(
        simplifiedSkiAreaFeature
      )
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "activities": Array [
            "nordic",
          ],
          "id": "1",
          "name": "Name",
        },
      ]
    `);
  } finally {
    mockFS.restore();
  }
});

it("removes OpenStreetMap ski area without nearby runs/lifts", async () => {
  TestHelpers.mockFeatureFiles(
    [
      TestHelpers.mockSkiAreaFeature({
        id: "1",
        activities: [],
        sources: [{ type: SourceType.OPENSTREETMAP, id: "1" }],
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0]
            ]
          ]
        }
      })
    ],
    [],
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

    expect(
      TestHelpers.fileContents("output/ski_areas.geojson").features.map(
        simplifiedSkiAreaFeature
      )
    ).toMatchInlineSnapshot(`Array []`);
  } finally {
    mockFS.restore();
  }
});

it("uses runs fully contained in the ski area polygon to determine activities when they are not known", async () => {
  TestHelpers.mockFeatureFiles(
    [
      TestHelpers.mockSkiAreaFeature({
        id: "1",
        activities: [],
        sources: [{ type: SourceType.OPENSTREETMAP, id: "1" }],
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0]
            ]
          ]
        }
      })
    ],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "2",
        geometry: {
          type: "LineString",
          coordinates: [
            [0.5, 0.5],
            [1.5, 1.5]
          ]
        },
        name: "Run extending beyond ski area",
        uses: [RunUse.Nordic]
      }),
      TestHelpers.mockRunFeature({
        id: "3",
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 1]
          ]
        },
        name: "Run within ski area",
        uses: [RunUse.Downhill]
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
      TestHelpers.fileContents("output/ski_areas.geojson")
        .features.map(simplifiedSkiAreaFeature)
        .sort(orderedByID)
    ).toMatchInlineSnapshot(`
      Array [
        Object {
          "activities": Array [
            "downhill",
          ],
          "id": "1",
          "name": "Name",
        },
        Object {
          "activities": Array [
            "nordic",
          ],
          "id": "mock-UUID-0",
          "name": null,
        },
      ]
    `);
  } finally {
    mockFS.restore();
  }
});

function simplifiedLiftFeature(feature: LiftFeature) {
  return {
    id: feature.properties.id,
    name: feature.properties.name,
    skiAreas: feature.properties.skiAreas
  };
}

function simplifiedRunFeature(feature: RunFeature) {
  return {
    id: feature.properties.id,
    name: feature.properties.name,
    skiAreas: feature.properties.skiAreas
  };
}

function simplifiedSkiAreaFeature(feature: SkiAreaFeature) {
  return {
    id: feature.properties.id,
    name: feature.properties.name,
    activities: feature.properties.activities
  };
}

function simplifiedSkiAreaFeatureWithStatistics(feature: SkiAreaFeature) {
  return {
    ...simplifiedSkiAreaFeature(feature),
    statistics: feature.properties.statistics
  };
}

function simplifiedSkiAreaFeatureWithSources(feature: SkiAreaFeature) {
  return {
    ...simplifiedSkiAreaFeature(feature),
    sources: feature.properties.sources
  };
}

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

function orderedByID(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
