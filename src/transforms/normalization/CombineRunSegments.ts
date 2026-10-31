import { isDeepStrictEqual } from "util";
import { RunGeometry, RunProperties } from "openskidata-format";
import { RunLineFeature } from "../../features/RunFeature.js";
import notEmpty from "../../utils/notEmpty.js";
import PointGraph from "./PointGraph.js";

// Some runs have a degenerate geometry: fewer than two coordinates, or every coordinate
// identical. OpenStreetMap contains ways like this, and splitting a run at shared
// vertices can also leave a zero-length segment behind. They must be filtered out before
// segment combining, otherwise downstream processing (e.g. elevation profile extraction)
// divides by the zero length and throws.
//
// Note: this is not caused by quantization, as this comment previously claimed.
// RunNormalizerAccumulator calls topojsonServer.topology() with no quantization argument,
// and topojson-server only prequantizes when one is given, so arcs here hold the original
// absolute coordinates and arc identity is exact float equality. That matters beyond this
// comment: it is what makes building the topology per spatially-connected component
// equivalent to building it globally.
function isDegenerateLineString(coords: number[][]): boolean {
  return (
    coords.length < 2 || coords.every((c) => isDeepStrictEqual(c, coords[0]))
  );
}

export default function combineRunSegments(
  geojson: GeoJSON.FeatureCollection<RunGeometry, RunProperties>,
) {
  const graph = new PointGraph();
  let runs = geojson.features.filter(
    (run) =>
      run.geometry.type !== "LineString" ||
      !isDegenerateLineString(run.geometry.coordinates),
  );

  for (let run of runs) {
    if (run.geometry.type === "LineString") {
      graph.addFeature(run as RunLineFeature);
    }
  }

  runs = runs
    .map((run) => {
      if (run.geometry.type === "LineString") {
        return graph.merge(run as RunLineFeature);
      } else {
        return run;
      }
    })
    .filter(notEmpty);

  geojson.features = runs;
  return geojson;
}
