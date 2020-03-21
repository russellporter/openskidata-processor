import * as turf from "@turf/helpers";
import assert from "assert";
import { RunLineFeature } from "../../features/RunFeature";
import PointGraph from "./PointGraph";

describe("PointGraph", () => {
  describe("#merge()", () => {
    it("should merge forward, oneway", () => {
      const graph = new PointGraph();
      const head = turf.lineString(
        [
          [0, 0],
          [1, 1]
        ],
        {
          oneway: true
        }
      ) as RunLineFeature;
      const tail = turf.lineString(
        [
          [1, 1],
          [2, 2]
        ],
        {
          oneway: true
        }
      ) as RunLineFeature;
      graph.addFeature(head);
      graph.addFeature(tail);
      assert.deepStrictEqual(
        graph.merge(head),
        turf.lineString(
          [
            [0, 0],
            [1, 1],
            [2, 2]
          ],
          { oneway: true }
        )
      );
      assert.equal(graph.merge(tail), null);
    });

    it("should merge backward, oneway", () => {
      const graph = new PointGraph();
      const head = turf.lineString(
        [
          [0, 0],
          [1, 1]
        ],
        {
          oneway: true
        }
      ) as RunLineFeature;
      const tail = turf.lineString(
        [
          [1, 1],
          [2, 2]
        ],
        {
          oneway: true
        }
      ) as RunLineFeature;
      graph.addFeature(head);
      graph.addFeature(tail);
      assert.deepStrictEqual(
        graph.merge(tail),
        turf.lineString(
          [
            [0, 0],
            [1, 1],
            [2, 2]
          ],
          { oneway: true }
        )
      );
      assert.equal(graph.merge(head), null);
    });

    it("should not merge, oneway", () => {
      const graph = new PointGraph();
      const head = turf.lineString(
        [
          [0, 0],
          [1, 1]
        ],
        {
          oneway: true
        }
      ) as RunLineFeature;
      const tail = turf.lineString(
        [
          [2, 2],
          [1, 1]
        ],
        {
          oneway: true
        }
      ) as RunLineFeature;
      graph.addFeature(head);
      graph.addFeature(tail);
      assert.deepStrictEqual(
        graph.merge(tail),
        turf.lineString(
          [
            [2, 2],
            [1, 1]
          ],
          { oneway: true }
        )
      );

      assert.deepStrictEqual(
        graph.merge(head),
        turf.lineString(
          [
            [0, 0],
            [1, 1]
          ],
          { oneway: true }
        )
      );
    });

    it("should merge multi, head", () => {
      const head = turf.lineString([
        [0, 0],
        [1, 1]
      ]) as RunLineFeature;
      const mid = turf.lineString([
        [2, 2],
        [1, 1]
      ]) as RunLineFeature;
      const tail = turf.lineString([
        [2, 2],
        [3, 3]
      ]) as RunLineFeature;

      const graph = new PointGraph();
      graph.addFeature(head);
      graph.addFeature(mid);
      graph.addFeature(tail);
      assert.deepStrictEqual(
        graph.merge(head),
        turf.lineString([
          [0, 0],
          [1, 1],
          [2, 2],
          [3, 3]
        ])
      );

      assert.equal(graph.merge(mid), null);
      assert.equal(graph.merge(tail), null);
    });

    it("should merge multi, mid", () => {
      const head = turf.lineString([
        [0, 0],
        [1, 1]
      ]) as RunLineFeature;
      const mid = turf.lineString([
        [2, 2],
        [1, 1]
      ]) as RunLineFeature;
      const tail = turf.lineString([
        [2, 2],
        [3, 3]
      ]) as RunLineFeature;

      const graph = new PointGraph();
      graph.addFeature(head);
      graph.addFeature(mid);
      graph.addFeature(tail);
      assert.deepStrictEqual(
        graph.merge(mid),
        turf.lineString([
          [3, 3],
          [2, 2],
          [1, 1],
          [0, 0]
        ])
      );

      assert.equal(graph.merge(head), null);
      assert.equal(graph.merge(tail), null);
    });

    it("should merge multi, tail", () => {
      const head = turf.lineString([
        [0, 0],
        [1, 1]
      ]) as RunLineFeature;
      const mid = turf.lineString([
        [2, 2],
        [1, 1]
      ]) as RunLineFeature;
      const tail = turf.lineString([
        [2, 2],
        [3, 3]
      ]) as RunLineFeature;

      const graph = new PointGraph();
      graph.addFeature(head);
      graph.addFeature(mid);
      graph.addFeature(tail);
      assert.deepStrictEqual(
        graph.merge(tail),
        turf.lineString([
          [0, 0],
          [1, 1],
          [2, 2],
          [3, 3]
        ])
      );

      assert.equal(graph.merge(head), null);
      assert.equal(graph.merge(mid), null);
    });

    it("should merge graph", () => {
      const head = turf.lineString([
        [0, 0],
        [1, 1]
      ]) as RunLineFeature;
      const mid = turf.lineString([
        [2, 2],
        [1, 1]
      ]) as RunLineFeature;
      const tail = turf.lineString([
        [2, 2],
        [3, 3]
      ]) as RunLineFeature;
      const other = turf.lineString([
        [2, 2],
        [3, 3]
      ]) as RunLineFeature;

      const graph = new PointGraph();
      graph.addFeature(head);
      graph.addFeature(mid);
      graph.addFeature(tail);
      graph.addFeature(other);
      assert.deepStrictEqual(
        graph.merge(tail),
        turf.lineString([
          [0, 0],
          [1, 1],
          [2, 2],
          [3, 3],
          [2, 2]
        ])
      );
      assert.equal(graph.merge(other), null);
      assert.equal(graph.merge(head), null);
      assert.equal(graph.merge(mid), null);
    });

    it("should merge oneway graph", () => {
      const head = turf.lineString(
        [
          [0, 0],
          [1, 1]
        ],
        {
          oneway: true
        }
      ) as RunLineFeature;
      const mid = turf.lineString(
        [
          [1, 1],
          [2, 2]
        ],
        {
          oneway: true
        }
      ) as RunLineFeature;
      const tail = turf.lineString(
        [
          [2, 2],
          [3, 3]
        ],
        {
          oneway: true
        }
      ) as RunLineFeature;
      const other = turf.lineString(
        [
          [2, 2],
          [3, 3]
        ],
        {
          oneway: true
        }
      ) as RunLineFeature;

      const graph = new PointGraph();
      graph.addFeature(head);
      graph.addFeature(mid);
      graph.addFeature(tail);
      graph.addFeature(other);
      assert.deepStrictEqual(
        graph.merge(mid),
        turf.lineString(
          [
            [0, 0],
            [1, 1],
            [2, 2],
            [3, 3]
          ],
          { oneway: true }
        )
      );
      assert.deepStrictEqual(
        graph.merge(other),
        turf.lineString(
          [
            [2, 2],
            [3, 3]
          ],
          { oneway: true }
        )
      );
      assert.equal(graph.merge(head), null);
      assert.equal(graph.merge(tail), null);
    });

    it("should merge cycle", () => {
      const cycle = turf.lineString([
        [0, 0],
        [1, 1],
        [0, 0]
      ]) as RunLineFeature;
      const mid = turf.lineString([
        [2, 2],
        [0, 0]
      ]) as RunLineFeature;
      const outward = turf.lineString([
        [2, 2],
        [3, 3]
      ]) as RunLineFeature;
      const inward = turf.lineString([
        [4, 4],
        [2, 2]
      ]) as RunLineFeature;
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
        assert.deepStrictEqual(graph.merge(test.f), turf.lineString(test.e));
      }
    });

    it("should merge oneway circle", () => {
      const out = turf.lineString(
        [
          [0, 0],
          [1, 1]
        ],
        {
          oneway: true
        }
      ) as RunLineFeature;
      const back = turf.lineString(
        [
          [1, 1],
          [2, 2],
          [0, 0]
        ],
        {
          oneway: true
        }
      ) as RunLineFeature;
      const graph = new PointGraph();
      graph.addFeature(out);
      graph.addFeature(back);
      assert.deepStrictEqual(
        graph.merge(out),
        turf.lineString(
          [
            [1, 1],
            [2, 2],
            [0, 0],
            [1, 1]
          ],
          { oneway: true }
        )
      );
    });
  });
});
