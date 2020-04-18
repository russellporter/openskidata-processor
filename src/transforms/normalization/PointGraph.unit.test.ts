import assert from "assert";
import { SourceType } from "openskidata-format";
import * as TestHelpers from "../../TestHelpers";
import PointGraph from "./PointGraph";

describe("PointGraph", () => {
  describe("#merge()", () => {
    it("should merge forward, oneway", () => {
      const graph = new PointGraph();
      const head = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [0, 0],
          [1, 1]
        ]),
        oneway: true
      });
      const tail = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [1, 1],
          [2, 2]
        ]),
        oneway: true
      });
      graph.addFeature(head);
      graph.addFeature(tail);
      assert.deepStrictEqual(
        graph.merge(head),
        TestHelpers.mockRunFeature({
          id: "1",
          geometry: lineString([
            [0, 0],
            [1, 1],
            [2, 2]
          ]),
          oneway: true
        })
      );
      assert.equal(graph.merge(tail), null);
    });

    it("should merge backward, oneway", () => {
      const graph = new PointGraph();
      const head = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [0, 0],
          [1, 1]
        ]),
        oneway: true
      });
      const tail = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [1, 1],
          [2, 2]
        ]),
        oneway: true
      });
      graph.addFeature(head);
      graph.addFeature(tail);
      assert.deepStrictEqual(
        graph.merge(tail),
        TestHelpers.mockRunFeature({
          id: "1",
          geometry: lineString([
            [0, 0],
            [1, 1],
            [2, 2]
          ]),
          oneway: true
        })
      );
      assert.equal(graph.merge(head), null);
    });

    it("should not merge, oneway", () => {
      const graph = new PointGraph();
      const head = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [0, 0],
          [1, 1]
        ]),
        oneway: true
      });
      const tail = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [2, 2],
          [1, 1]
        ]),
        oneway: true
      });
      graph.addFeature(head);
      graph.addFeature(tail);
      assert.deepStrictEqual(
        graph.merge(tail),
        TestHelpers.mockRunFeature({
          id: "1",
          geometry: lineString([
            [2, 2],
            [1, 1]
          ]),
          oneway: true
        })
      );

      assert.deepStrictEqual(
        graph.merge(head),
        TestHelpers.mockRunFeature({
          id: "1",
          geometry: lineString([
            [0, 0],
            [1, 1]
          ]),
          oneway: true
        })
      );
    });

    it("should merge multi, head", () => {
      const head = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [0, 0],
          [1, 1]
        ])
      });
      const mid = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [2, 2],
          [1, 1]
        ])
      });
      const tail = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [2, 2],
          [3, 3]
        ])
      });

      const graph = new PointGraph();
      graph.addFeature(head);
      graph.addFeature(mid);
      graph.addFeature(tail);
      assert.deepStrictEqual(
        graph.merge(head),
        TestHelpers.mockRunFeature({
          id: "1",
          geometry: lineString([
            [0, 0],
            [1, 1],
            [2, 2],
            [3, 3]
          ])
        })
      );

      assert.equal(graph.merge(mid), null);
      assert.equal(graph.merge(tail), null);
    });

    it("should merge multi, mid", () => {
      const head = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [0, 0],
          [1, 1]
        ])
      });
      const mid = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [2, 2],
          [1, 1]
        ])
      });
      const tail = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [2, 2],
          [3, 3]
        ])
      });

      const graph = new PointGraph();
      graph.addFeature(head);
      graph.addFeature(mid);
      graph.addFeature(tail);
      assert.deepStrictEqual(
        graph.merge(mid),
        TestHelpers.mockRunFeature({
          id: "1",
          geometry: lineString([
            [3, 3],
            [2, 2],
            [1, 1],
            [0, 0]
          ])
        })
      );

      assert.equal(graph.merge(head), null);
      assert.equal(graph.merge(tail), null);
    });

    it("should merge multi, tail", () => {
      const head = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [0, 0],
          [1, 1]
        ])
      });
      const mid = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [2, 2],
          [1, 1]
        ])
      });
      const tail = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [2, 2],
          [3, 3]
        ])
      });

      const graph = new PointGraph();
      graph.addFeature(head);
      graph.addFeature(mid);
      graph.addFeature(tail);
      assert.deepStrictEqual(
        graph.merge(tail),
        TestHelpers.mockRunFeature({
          id: "1",
          geometry: lineString([
            [0, 0],
            [1, 1],
            [2, 2],
            [3, 3]
          ])
        })
      );

      assert.equal(graph.merge(head), null);
      assert.equal(graph.merge(mid), null);
    });

    it("should merge graph", () => {
      const head = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [0, 0],
          [1, 1]
        ])
      });
      const mid = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [2, 2],
          [1, 1]
        ])
      });
      const tail = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [2, 2],
          [3, 3]
        ])
      });
      const other = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [2, 2],
          [3, 3]
        ])
      });

      const graph = new PointGraph();
      graph.addFeature(head);
      graph.addFeature(mid);
      graph.addFeature(tail);
      graph.addFeature(other);
      assert.deepStrictEqual(
        graph.merge(tail),
        TestHelpers.mockRunFeature({
          id: "1",
          geometry: lineString([
            [0, 0],
            [1, 1],
            [2, 2],
            [3, 3],
            [2, 2]
          ])
        })
      );
      assert.equal(graph.merge(other), null);
      assert.equal(graph.merge(head), null);
      assert.equal(graph.merge(mid), null);
    });

    it("should merge oneway graph", () => {
      const head = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [0, 0],
          [1, 1]
        ]),
        oneway: true
      });
      const mid = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [1, 1],
          [2, 2]
        ]),
        oneway: true
      });
      const tail = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [2, 2],
          [3, 3]
        ]),
        oneway: true
      });
      const other = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [2, 2],
          [3, 3]
        ]),
        oneway: true
      });

      const graph = new PointGraph();
      graph.addFeature(head);
      graph.addFeature(mid);
      graph.addFeature(tail);
      graph.addFeature(other);
      assert.deepStrictEqual(
        graph.merge(mid),
        TestHelpers.mockRunFeature({
          id: "1",
          geometry: lineString([
            [0, 0],
            [1, 1],
            [2, 2],
            [3, 3]
          ]),
          oneway: true
        })
      );
      assert.deepStrictEqual(
        graph.merge(other),
        TestHelpers.mockRunFeature({
          id: "1",
          geometry: lineString([
            [2, 2],
            [3, 3]
          ]),
          oneway: true
        })
      );
      assert.equal(graph.merge(head), null);
      assert.equal(graph.merge(tail), null);
    });

    it("should merge cycle", () => {
      const cycle = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [0, 0],
          [1, 1],
          [0, 0]
        ])
      });
      const mid = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [2, 2],
          [0, 0]
        ])
      });
      const outward = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [2, 2],
          [3, 3]
        ])
      });
      const inward = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [4, 4],
          [2, 2]
        ])
      });
      const tests = [
        {
          f: cycle,
          e: [
            [4, 4],
            [2, 2],
            [0, 0],
            [1, 1],
            [0, 0]
          ]
        },
        {
          f: mid,
          e: [
            [4, 4],
            [2, 2],
            [0, 0],
            [1, 1],
            [0, 0]
          ]
        },
        {
          f: outward,
          e: [
            [4, 4],
            [2, 2],
            [3, 3]
          ]
        },
        {
          f: inward,
          e: [
            [4, 4],
            [2, 2],
            [0, 0],
            [1, 1],
            [0, 0]
          ]
        }
      ];
      for (let test of tests) {
        const graph = new PointGraph();
        graph.addFeature(cycle);
        graph.addFeature(mid);
        graph.addFeature(outward);
        graph.addFeature(inward);
        assert.deepStrictEqual(
          graph.merge(test.f),
          TestHelpers.mockRunFeature({
            id: "1",
            geometry: lineString(test.e)
          })
        );
      }
    });

    it("should merge oneway circle", () => {
      const out = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [0, 0],
          [1, 1]
        ]),
        oneway: true
      });
      const back = TestHelpers.mockRunFeature({
        id: "1",
        geometry: lineString([
          [1, 1],
          [2, 2],
          [0, 0]
        ]),
        oneway: true
      });
      const graph = new PointGraph();
      graph.addFeature(out);
      graph.addFeature(back);
      assert.deepStrictEqual(
        graph.merge(out),
        TestHelpers.mockRunFeature({
          id: "1",
          geometry: lineString([
            [1, 1],
            [2, 2],
            [0, 0],
            [1, 1]
          ]),
          oneway: true
        })
      );
    });
  });

  it("should merge runs with different ids and sources", () => {
    const out = TestHelpers.mockRunFeature({
      id: "1",
      geometry: lineString([
        [0, 0],
        [1, 1]
      ]),
      oneway: true,
      sources: [{ type: SourceType.OPENSTREETMAP, id: "1" }]
    });
    const back = TestHelpers.mockRunFeature({
      id: "2",
      geometry: lineString([
        [1, 1],
        [2, 2],
        [0, 0]
      ]),
      oneway: true,
      sources: [{ type: SourceType.SKIMAP_ORG, id: "1" }]
    });
    const graph = new PointGraph();
    graph.addFeature(out);
    graph.addFeature(back);
    assert.deepStrictEqual(
      graph.merge(out),
      TestHelpers.mockRunFeature({
        id: "2",
        geometry: lineString([
          [1, 1],
          [2, 2],
          [0, 0],
          [1, 1]
        ]),
        oneway: true,
        sources: [
          { type: SourceType.SKIMAP_ORG, id: "1" },
          { type: SourceType.OPENSTREETMAP, id: "1" }
        ]
      })
    );
  });
});

function lineString(coordinates: number[][]): GeoJSON.LineString {
  return {
    type: "LineString",
    coordinates: coordinates
  };
}
