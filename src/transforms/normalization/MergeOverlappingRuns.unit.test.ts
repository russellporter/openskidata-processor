import * as TurfHelper from "@turf/helpers";
import * as assert from "assert";
import { GeoJsonObject } from "geojson";
import { RunProperties, Source, SourceType } from "openskidata-format";
import * as TopoJSONClient from "topojson-client";
import * as TopoJSONServer from "topojson-server";
import { InputRunGeometry } from "../../features/RunFeature";
import * as TestHelpers from "../../TestHelpers";
import { mergeOverlappingRuns, RunTopology } from "./MergeOverlappingRuns";

function merge(features: GeoJSON.Feature<InputRunGeometry, RunProperties>[]) {
  const inputTopology = TopoJSONServer.topology({
    runs: TurfHelper.featureCollection(features) as GeoJsonObject,
  }) as RunTopology;
  const resultTopology = mergeOverlappingRuns(inputTopology);
  return TopoJSONClient.feature(resultTopology, resultTopology.objects.runs)
    .features;
}

function mockRun<G extends InputRunGeometry>(options: {
  name?: string | null;
  oneway?: boolean | null;
  geometry?: G;
  sources?: Source[] | undefined;
}) {
  return TestHelpers.mockRunFeature({
    id: "1",
    name: options.name !== undefined ? options.name : null,
    oneway: options.oneway !== undefined ? options.oneway : null,
    uses: [],
    sources: options.sources,
    geometry:
      options.geometry !== undefined
        ? options.geometry
        : {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
  });
}

describe("MergeOverlappingRuns", () => {
  it("should leave single path untouched", () => {
    assert.deepStrictEqual(merge([mockRun({})]), [mockRun({})]);
  });

  it("should merge two overlapping paths", () => {
    assert.deepStrictEqual(
      merge([mockRun({ name: "A" }), mockRun({ name: "B" })]),
      [mockRun({ name: "A, B" })],
    );
  });

  it("should unique sources when merging features with some duplicated sources", () => {
    assert.deepStrictEqual(
      merge([
        mockRun({
          name: "A",
          sources: [
            { type: SourceType.OPENSTREETMAP, id: "way/1" },
            { type: SourceType.OPENSTREETMAP, id: "relation/1" },
          ],
        }),
        mockRun({
          name: "B",
          sources: [
            { type: SourceType.OPENSTREETMAP, id: "way/1" },
            { type: SourceType.OPENSTREETMAP, id: "relation/2" },
          ],
        }),
      ]),
      [
        mockRun({
          name: "A, B",
          sources: [
            { type: SourceType.OPENSTREETMAP, id: "way/1" },
            { type: SourceType.OPENSTREETMAP, id: "relation/1" },
            { type: SourceType.OPENSTREETMAP, id: "relation/2" },
          ],
        }),
      ],
    );
  });

  it("should merge two overlapping same direction paths", () => {
    assert.deepStrictEqual(
      merge([
        mockRun({ name: "A", oneway: true }),
        mockRun({ name: "B", oneway: true }),
      ]),
      [mockRun({ name: "A, B", oneway: true })],
    );
  });

  it("should merge overlapping directional and undefined-directional paths", () => {
    assert.deepStrictEqual(
      merge([
        mockRun({
          name: "A",
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        }),
        mockRun({
          name: "B",
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [0, 0],
            ],
          },
        }),
      ]),
      [
        mockRun({
          name: "A, B",
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        }),
      ],
    );
  });

  it("should merge overlapping directional and non-directional paths", () => {
    assert.deepStrictEqual(
      merge([
        mockRun({ name: "A", oneway: true }),
        mockRun({ name: "B", oneway: false }),
      ]),
      [mockRun({ name: "A, B", oneway: false })],
    );
  });

  it("should preserve the direction of the oneway path when the other path is not oneway", () => {
    assert.deepStrictEqual(
      merge([
        mockRun({
          name: "B",
          oneway: false,
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        }),
        mockRun({
          name: "A",
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [0, 0],
            ],
          },
        }),
      ]),
      [
        mockRun({
          name: "B, A",
          oneway: false,
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [0, 0],
            ],
          },
        }),
      ],
    );
  });

  it("should merge different direction overlapping paths", () => {
    assert.deepStrictEqual(
      merge([
        mockRun({
          name: "A",
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        }),
        mockRun({
          name: "B",
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [0, 0],
            ],
          },
        }),
      ]),
      [
        mockRun({
          name: "A, B",
          oneway: false,
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        }),
      ],
    );
  });

  it("should not merge input lines", () => {
    assert.deepStrictEqual(
      merge([
        mockRun({
          name: "A",
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        }),
        mockRun({
          name: "A",
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [2, 2],
              [0, 0],
            ],
          },
        }),
      ]),
      [
        mockRun({
          name: "A",
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        }),
        mockRun({
          name: "A",
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [2, 2],
              [0, 0],
            ],
          },
        }),
      ],
    );
  });

  it("should merge relation and lines", () => {
    assert.deepStrictEqual(
      merge([
        mockRun({
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        }),
        mockRun({
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [2, 2],
              [0, 0],
            ],
          },
        }),
        mockRun({
          name: "Relation",
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [
                [0, 0],
                [1, 1],
              ],
              [
                [0, 0],
                [3, 3],
              ],
              [
                [0, 0],
                [2, 2],
                [1, 1],
              ],
            ],
          },
        }),
      ]),
      [
        mockRun({
          name: "Relation",
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        }),
        mockRun({
          name: "Relation",
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [2, 2],
              [0, 0],
            ],
          },
        }),
        mockRun({
          name: "Relation",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [3, 3],
            ],
          },
        }),
      ],
    );
  });

  it("should merge relation and lines when relation is first", () => {
    assert.deepStrictEqual(
      merge([
        mockRun({
          name: "Relation",
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [
                [0, 0],
                [1, 1],
              ],
              [
                [0, 0],
                [3, 3],
              ],
              [
                [0, 0],
                [2, 2],
                [1, 1],
              ],
            ],
          },
        }),
        mockRun({
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        }),
        mockRun({
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [2, 2],
              [0, 0],
            ],
          },
        }),
      ]),
      [
        mockRun({
          name: "Relation",
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        }),
        mockRun({
          name: "Relation",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [3, 3],
            ],
          },
        }),
        mockRun({
          name: "Relation",
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [2, 2],
              [0, 0],
            ],
          },
        }),
      ],
    );
  });

  it("should not re-combine multi-line ways in opposing directions", () => {
    assert.deepStrictEqual(
      merge([
        mockRun({
          name: "Line",
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
              [2, 2],
              [3, 3],
            ],
          },
        }),
        mockRun({
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [0, 0],
            ],
          },
        }),
        mockRun({
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [2, 2],
              [1, 1],
            ],
          },
        }),
        mockRun({
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [2, 2],
              [3, 3],
            ],
          },
        }),
      ]),
      [
        mockRun({
          name: "Line",
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [0, 0],
            ],
          },
        }),
        mockRun({
          name: "Line",
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [2, 2],
              [1, 1],
            ],
          },
        }),
        mockRun({
          name: "Line",
          oneway: true,
          geometry: {
            type: "LineString",
            coordinates: [
              [2, 2],
              [3, 3],
            ],
          },
        }),
      ],
    );
  });
});
