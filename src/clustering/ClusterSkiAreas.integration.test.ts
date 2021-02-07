import {
  Activity,
  LiftType,
  RunDifficulty,
  RunFeature,
  RunGrooming,
  RunUse,
  SkiAreaFeature,
  SourceType,
  Status,
} from "openskidata-format";
import { GenericContainer } from "testcontainers";
import { StartedTestContainer } from "testcontainers/dist/test-container";
import * as TestHelpers from "../TestHelpers";
import {
  simplifiedLiftFeature,
  simplifiedRunFeature,
  simplifiedSkiAreaFeature,
  simplifiedSkiAreaFeatureWithSources,
  simplifiedSkiAreaFeatureWithStatistics,
} from "../TestHelpers";
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
});

it("skips generating ski areas for runs with unsupported activity", async () => {
  const paths = TestHelpers.getFilePaths();
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
              [11.1164229, 47.558125],
            ],
          ],
        },
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(TestHelpers.fileContents(paths.output.skiAreas))
    .toMatchInlineSnapshot(`
      Object {
        "features": Array [],
        "type": "FeatureCollection",
      }
    `);
});

it("generates ski areas for runs without them", async () => {
  const paths = TestHelpers.getFilePaths();
  TestHelpers.mockFeatureFiles(
    [],
    [
      TestHelpers.mockLiftFeature({
        id: "1",
        name: "Lift",
        liftType: LiftType.ChairLift,
        geometry: {
          type: "LineString",
          coordinates: [
            [11.1164229, 47.558125],
            [11.1163655, 47.5579742],
          ],
        },
      }),
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
              [11.1164229, 47.558125],
            ],
          ],
        },
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
              [11.1164229, 47.558125],
            ],
          ],
        },
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.runs).features.map(
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
    TestHelpers.fileContents(paths.output.skiAreas).features.map(
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
});

it("does not generate ski area for lone downhill run without lift", async () => {
  const paths = TestHelpers.getFilePaths();
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
              [11.1164229, 47.558125],
            ],
          ],
        },
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
              [11.1164229, 47.558125],
            ],
          ],
        },
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.runs).features.map(
      simplifiedRunFeature
    )
  ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "3",
          "name": "Oberauer Skiabfahrt",
          "skiAreas": Array [],
        },
        Object {
          "id": "4",
          "name": "Another run nearby",
          "skiAreas": Array [],
        },
      ]
    `);
  expect(
    TestHelpers.fileContents(paths.output.skiAreas).features.map(
      simplifiedSkiAreaFeature
    )
  ).toMatchInlineSnapshot(`Array []`);
});

it("generates ski areas by activity", async () => {
  const paths = TestHelpers.getFilePaths();
  TestHelpers.mockFeatureFiles(
    [],
    [
      TestHelpers.mockLiftFeature({
        id: "1",
        name: "Lift",
        liftType: LiftType.ChairLift,
        geometry: {
          type: "LineString",
          coordinates: [
            [11.1164229, 47.558125],
            [11.1163655, 47.5579742],
          ],
        },
      }),
    ],
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
              [11.1164229, 47.558125],
            ],
          ],
        },
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
              [11.1164229, 47.558125],
            ],
          ],
        },
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  const runs: RunFeature[] = TestHelpers.fileContents(paths.output.runs)
    .features;
  expect(
    runs.map((feature) => {
      return {
        ...simplifiedRunFeature(feature),
        // Inline only the ski area activities to avoid flaky test failures due to mismatched ski area IDs
        //  when one ski area is generated before the other.
        skiAreas: feature.properties.skiAreas.map(
          (skiArea) => skiArea.properties.activities
        ),
      };
    })
  ).toMatchInlineSnapshot(`
      Array [
        Object {
          "id": "3",
          "name": "Downhill Run",
          "skiAreas": Array [
            Array [
              "downhill",
            ],
          ],
        },
        Object {
          "id": "4",
          "name": "Nordic run",
          "skiAreas": Array [
            Array [
              "nordic",
            ],
          ],
        },
      ]
    `);
});

it("clusters ski areas", async () => {
  const paths = TestHelpers.getFilePaths();
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
          coordinates: [11.122066084534, 47.557111836837],
        },
      }),
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
            [11.1164297, 47.5581563],
          ],
        },
      }),
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
              [11.1164229, 47.558125],
            ],
          ],
        },
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.lifts).features.map(
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
    TestHelpers.fileContents(paths.output.runs).features.map(
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
    TestHelpers.fileContents(paths.output.skiAreas).features.map(
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
});

it("clusters ski area activities independently", async () => {
  const paths = TestHelpers.getFilePaths();
  TestHelpers.mockFeatureFiles(
    [
      TestHelpers.mockSkiAreaFeature({
        id: "1",
        activities: [Activity.Downhill, Activity.Nordic],
        geometry: {
          type: "Point",
          coordinates: [0, 0],
        },
      }),
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
            [1, 1],
          ],
        },
      }),
      TestHelpers.mockRunFeature({
        id: "3",
        name: "Nordic run part of ski area",
        uses: [RunUse.Nordic],
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [-1, -1],
          ],
        },
      }),
      TestHelpers.mockRunFeature({
        id: "4",
        name: "Nordic run not part of ski area",
        uses: [RunUse.Nordic],
        geometry: {
          type: "LineString",
          coordinates: [
            [1, 1],
            [2, 2],
          ],
        },
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.runs).features.map(
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
});

it("generates a downhill ski area but does not include backcountry runs when clustering from a mixed use run", async () => {
  const paths = TestHelpers.getFilePaths();
  TestHelpers.mockFeatureFiles(
    [],
    [
      TestHelpers.mockLiftFeature({
        id: "1",
        name: "Lift",
        liftType: LiftType.ChairLift,
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 0],
          ],
        },
      }),
    ],
    [
      TestHelpers.mockRunFeature({
        id: "3",
        name: "Downhill Run & Backcountry Route",
        uses: [RunUse.Downhill, RunUse.Skitour],
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 0],
          ],
        },
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
            [0, 1],
          ],
        },
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.runs).features.map(
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
});

it("generates elevation statistics for run & lift based on lift served skiable vertical", async () => {
  const paths = TestHelpers.getFilePaths();
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
            [11.1164297, 47.5581563, 200],
          ],
        },
      }),
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
            [11.1160297, 47.5581563, 250],
          ],
        },
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.skiAreas).features.map(
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
});

it("allows point & multilinestring lifts to be processed", async () => {
  const paths = TestHelpers.getFilePaths();
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
              [25.4273675, 36.4188913, 18.190246582031193],
            ],
            [
              [25.427413799999993, 36.4188392, 15.1902456283569],
              [25.430537199999993, 36.4204801, 237.44396972656193],
            ],
          ],
        },
      }),
      TestHelpers.mockLiftFeature({
        id: "3",
        name: "Gondola",
        liftType: LiftType.Gondola,
        geometry: {
          type: "Point",
          coordinates: [12.2447153, 47.5270405, 719.0122680664059],
        },
      }),
    ],
    [],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.lifts).features.map(
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
});

it("does not generate ski area for lone snow park", async () => {
  const paths = TestHelpers.getFilePaths();
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
              [11.1164229, 47.558125],
            ],
          ],
        },
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(TestHelpers.fileContents(paths.output.skiAreas))
    .toMatchInlineSnapshot(`
      Object {
        "features": Array [],
        "type": "FeatureCollection",
      }
    `);
});

it("generates ski area which includes the snow park", async () => {
  const paths = TestHelpers.getFilePaths();
  TestHelpers.mockFeatureFiles(
    [],
    [
      TestHelpers.mockLiftFeature({
        id: "3",
        name: "Lift",
        liftType: LiftType.ChairLift,
        geometry: {
          type: "LineString",
          coordinates: [
            [11.1223444, 47.5572422],
            [11.1164297, 47.5581563],
          ],
        },
      }),
    ],
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
            [11.1164297, 47.5581563],
          ],
        },
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
              [11.1164229, 47.558125],
            ],
          ],
        },
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.runs).features.map(
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
});

it("generates ski area which includes the patrolled ungroomed run", async () => {
  const paths = TestHelpers.getFilePaths();
  TestHelpers.mockFeatureFiles(
    [],
    [
      TestHelpers.mockLiftFeature({
        id: "2",
        liftType: LiftType.ChairLift,
        name: "Chairlift",
        geometry: {
          type: "LineString",
          coordinates: [
            [11.1164229, 47.558125],
            [11.1163655, 47.5579742],
          ],
        },
      }),
    ],
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
              [11.1164229, 47.558125],
            ],
          ],
        },
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.runs).features.map(
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
});

it("does not generate ski area for ungroomed run", async () => {
  const paths = TestHelpers.getFilePaths();
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
              [11.1164229, 47.558125],
            ],
          ],
        },
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(TestHelpers.fileContents(paths.output.skiAreas))
    .toMatchInlineSnapshot(`
      Object {
        "features": Array [],
        "type": "FeatureCollection",
      }
    `);
});

it("associates lifts and runs with polygon openstreetmap ski area", async () => {
  const paths = TestHelpers.getFilePaths();
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
              [11, 47],
            ],
          ],
        },
      }),
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
            [11.1164297, 47.5581563],
          ],
        },
      }),
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
              [11.1164229, 47.558125],
            ],
          ],
        },
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.lifts).features.map(
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
    TestHelpers.fileContents(paths.output.runs).features.map(
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
});

it("associates lifts and runs adjacent to polygon openstreetmap ski area when no other polygon contains them", async () => {
  const paths = TestHelpers.getFilePaths();
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
              [0, 0.0001],
            ],
          ],
        },
      }),
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
            [1, 0],
          ],
        },
      }),
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
            [1, 1],
          ],
        },
      }),
      TestHelpers.mockRunFeature({
        id: "4",
        name: "Run",
        uses: [RunUse.Downhill],
        difficulty: RunDifficulty.EASY,
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0.0001],
            [0.0001, 0.0002],
          ],
        },
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.lifts).features.map(
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
    TestHelpers.fileContents(paths.output.runs).features.map(
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
        Object {
          "id": "4",
          "name": "Run",
          "skiAreas": Array [
            "1",
          ],
        },
      ]
    `);
});

it("associates lifts correctly to adjacent ski areas based on their polygons", async () => {
  const paths = TestHelpers.getFilePaths();
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
              [0, 0],
            ],
          ],
        },
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
              [0, 0],
            ],
          ],
        },
      }),
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
            [1, 0],
          ],
        },
      }),
      TestHelpers.mockLiftFeature({
        id: "4",
        name: "Ski Area 2: Lift",
        liftType: LiftType.TBar,
        geometry: {
          type: "LineString",
          coordinates: [
            [-0.0001, 0],
            [-1, 0],
          ],
        },
      }),
    ],
    [],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.lifts).features.map(
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
});

it("merges Skimap.org ski area with OpenStreetMap ski area", async () => {
  const paths = TestHelpers.getFilePaths();
  TestHelpers.mockFeatureFiles(
    [
      TestHelpers.mockSkiAreaFeature({
        id: "1",
        activities: [Activity.Downhill],
        sources: [{ type: SourceType.OPENSTREETMAP, id: "1" }],
        geometry: {
          type: "Point",
          coordinates: [0, 0],
        },
      }),
      TestHelpers.mockSkiAreaFeature({
        id: "2",
        activities: [Activity.Downhill],
        sources: [{ type: SourceType.SKIMAP_ORG, id: "2" }],
        geometry: {
          type: "Point",
          coordinates: [1, 0],
        },
      }),
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
            [1, 0],
          ],
        },
      }),
    ],
    [],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.skiAreas).features.map(
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
    TestHelpers.fileContents(paths.output.lifts).features.map(
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
});

it("removes OpenStreetMap ski areas that span across multiple Skimap.org ski areas", async () => {
  const paths = TestHelpers.getFilePaths();
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
              [0, 0],
            ],
          ],
        },
      }),
      TestHelpers.mockSkiAreaFeature({
        id: "2",
        activities: [Activity.Downhill],
        sources: [{ type: SourceType.SKIMAP_ORG, id: "2" }],
        geometry: {
          type: "Point",
          coordinates: [0.25, 0.25],
        },
      }),
      TestHelpers.mockSkiAreaFeature({
        id: "3",
        activities: [Activity.Downhill],
        sources: [{ type: SourceType.SKIMAP_ORG, id: "2" }],
        geometry: {
          type: "Point",
          coordinates: [0.75, 0.75],
        },
      }),
    ],
    [],
    [],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.skiAreas)
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
});

it("adds activities to OpenStreetMap ski areas based on the associated runs", async () => {
  const paths = TestHelpers.getFilePaths();
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
              [0, 0],
            ],
          ],
        },
      }),
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
            [1, 0],
          ],
        },
        uses: [RunUse.Nordic],
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.skiAreas).features.map(
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
});

it("removes OpenStreetMap ski area without nearby runs/lifts", async () => {
  const paths = TestHelpers.getFilePaths();
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
              [0, 0],
            ],
          ],
        },
      }),
    ],
    [],
    [],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.skiAreas).features.map(
      simplifiedSkiAreaFeature
    )
  ).toMatchInlineSnapshot(`Array []`);
});

it("uses runs fully contained in the ski area polygon to determine activities when they are not known", async () => {
  const paths = TestHelpers.getFilePaths();
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
              [0, 0],
            ],
          ],
        },
      }),
    ],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "2",
        geometry: {
          type: "LineString",
          coordinates: [
            [0.5, 0.5],
            [1.5, 1.5],
          ],
        },
        name: "Run extending beyond ski area",
        uses: [RunUse.Nordic],
      }),
      TestHelpers.mockRunFeature({
        id: "3",
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        name: "Run within ski area",
        uses: [RunUse.Downhill],
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.skiAreas)
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
});

it("removes an OpenStreetMap ski area that does not contain any runs/lifts as it might be representing something other than a ski area", async () => {
  const paths = TestHelpers.getFilePaths();
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
              [0, 0],
            ],
          ],
        },
      }),
    ],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "2",
        geometry: {
          type: "LineString",
          coordinates: [
            [1.0001, 1.0001],
            [1.5, 1.5],
          ],
        },
        name:
          "Run outside the ski area should be associated with a separate, generated ski area",
        uses: [RunUse.Nordic],
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  expect(
    TestHelpers.fileContents(paths.output.skiAreas).features.map(
      simplifiedSkiAreaFeature
    )
  ).toMatchInlineSnapshot(`
      Array [
        Object {
          "activities": Array [
            "nordic",
          ],
          "id": "mock-UUID-0",
          "name": null,
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
          "id": "2",
          "name": "Run outside the ski area should be associated with a separate, generated ski area",
          "skiAreas": Array [
            "mock-UUID-0",
          ],
        },
      ]
    `);
});

it("updates geometry, run convention, and activities for a site based ski area", async () => {
  const paths = TestHelpers.getFilePaths();
  const siteSkiArea = TestHelpers.mockSkiAreaFeature({
    id: "1",
    activities: [],
    sources: [{ type: SourceType.OPENSTREETMAP, id: "1" }],
    geometry: {
      type: "Point",
      coordinates: [360, 360, 1],
    },
  });
  TestHelpers.mockFeatureFiles(
    [siteSkiArea],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "2",
        geometry: {
          type: "LineString",
          coordinates: [
            [1.0001, 1.0001],
            [1.5, 1.5],
          ],
        },
        name: "Run",
        uses: [RunUse.Nordic],
        skiAreas: [siteSkiArea],
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  const skiAreaFeatures: [SkiAreaFeature] = TestHelpers.fileContents(
    paths.output.skiAreas
  ).features;

  expect(skiAreaFeatures.length).toBe(1);

  const skiAreaFeature = skiAreaFeatures[0];

  expect(skiAreaFeature.properties.activities).toMatchInlineSnapshot(`
    Array [
      "nordic",
    ]
  `);

  expect(skiAreaFeature.geometry).toMatchInlineSnapshot(`
    Object {
      "coordinates": Array [
        1.2500499999999999,
        1.2500499999999999,
      ],
      "type": "Point",
    }
  `);
  expect(skiAreaFeature.properties.runConvention).toMatchInlineSnapshot(
    `"europe"`
  );
  expect(skiAreaFeature.properties.sources).toMatchInlineSnapshot(`
    Array [
      Object {
        "id": "1",
        "type": "openstreetmap",
      },
    ]
  `);

  expect(
    TestHelpers.fileContents(paths.output.runs).features[0].properties.skiAreas
  ).toMatchObject([skiAreaFeature]);
});

it("removes landuse based ski area when there is a site with sufficient overlap", async () => {
  const paths = TestHelpers.getFilePaths();
  const siteSkiArea = TestHelpers.mockSkiAreaFeature({
    id: "1",
    activities: [],
    sources: [{ type: SourceType.OPENSTREETMAP, id: "1" }],
    geometry: {
      type: "Point",
      coordinates: [360, 360, 1],
    },
  });
  const landuseSkiArea = TestHelpers.mockSkiAreaFeature({
    sources: [{ type: SourceType.OPENSTREETMAP, id: "2" }],
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    },
  });
  TestHelpers.mockFeatureFiles(
    [siteSkiArea, landuseSkiArea],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "2",
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        name: "Run",
        skiAreas: [siteSkiArea],
      }),
      TestHelpers.mockRunFeature({
        id: "3",
        geometry: {
          type: "LineString",
          coordinates: [
            [1, 0],
            [1, 1],
          ],
        },
        name: "Run",
        skiAreas: [siteSkiArea],
      }),
      TestHelpers.mockRunFeature({
        id: "4",
        geometry: {
          type: "LineString",
          coordinates: [
            [1, 0],
            [1, 1],
          ],
        },
        name: "Run",
        // This run is not assigned to the site, but given there are enough nearby ski runs in the site,
        // the landuse based ski area should be removed.
        skiAreas: [],
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  const skiAreaFeatures: [SkiAreaFeature] = TestHelpers.fileContents(
    paths.output.skiAreas
  ).features;

  expect(skiAreaFeatures.length).toBe(1);

  const skiAreaFeature = skiAreaFeatures[0];
  expect(skiAreaFeature.geometry).toMatchInlineSnapshot(`
    Object {
      "coordinates": Array [
        0.75,
        0.5,
      ],
      "type": "Point",
    }
  `);
  expect(skiAreaFeature.properties.sources).toMatchInlineSnapshot(`
    Array [
      Object {
        "id": "1",
        "type": "openstreetmap",
      },
    ]
  `);

  expect(
    TestHelpers.fileContents(paths.output.runs).features[0].properties.skiAreas
  ).toMatchObject([skiAreaFeature]);
});

it("keeps landuse based ski area when there is a site with insufficient overlap", async () => {
  const paths = TestHelpers.getFilePaths();
  const siteSkiArea = TestHelpers.mockSkiAreaFeature({
    id: "1",
    activities: [],
    sources: [{ type: SourceType.OPENSTREETMAP, id: "1" }],
    geometry: {
      type: "Point",
      coordinates: [360, 360, 1],
    },
  });
  const landuseSkiArea = TestHelpers.mockSkiAreaFeature({
    sources: [{ type: SourceType.OPENSTREETMAP, id: "2" }],
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    },
  });
  TestHelpers.mockFeatureFiles(
    [siteSkiArea, landuseSkiArea],
    [],
    [
      TestHelpers.mockRunFeature({
        id: "2",
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        name: "Run",
        skiAreas: [siteSkiArea],
      }),
      TestHelpers.mockRunFeature({
        id: "3",
        geometry: {
          type: "LineString",
          coordinates: [
            [1, 0],
            [1, 1],
          ],
        },
        name: "Run",
        skiAreas: [siteSkiArea],
      }),
      TestHelpers.mockRunFeature({
        id: "4",
        geometry: {
          type: "LineString",
          coordinates: [
            [1, 0],
            [1, 1],
          ],
        },
        name: "Run",
        skiAreas: [],
      }),
      TestHelpers.mockRunFeature({
        id: "5",
        geometry: {
          type: "LineString",
          coordinates: [
            [1, 0],
            [1, 1],
          ],
        },
        name: "Run",
        skiAreas: [],
      }),
    ],
    paths.intermediate
  );

  await clusterSkiAreas(
    paths.intermediate,
    paths.output,
    "http://localhost:" + container.getMappedPort(8529),
    null
  );

  const skiAreaFeatures: [SkiAreaFeature] = TestHelpers.fileContents(
    paths.output.skiAreas
  ).features;

  expect(skiAreaFeatures.length).toBe(2);

  const runFeatures: [RunFeature] = TestHelpers.fileContents(
    paths.output.runs
  ).features.map(simplifiedRunFeature);

  expect(runFeatures).toMatchInlineSnapshot(`
    Array [
      Object {
        "id": "2",
        "name": "Run",
        "skiAreas": Array [
          "1",
          "ID",
        ],
      },
      Object {
        "id": "3",
        "name": "Run",
        "skiAreas": Array [
          "1",
          "ID",
        ],
      },
      Object {
        "id": "4",
        "name": "Run",
        "skiAreas": Array [
          "ID",
        ],
      },
      Object {
        "id": "5",
        "name": "Run",
        "skiAreas": Array [
          "ID",
        ],
      },
    ]
  `);
});

async function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function orderedByID(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
