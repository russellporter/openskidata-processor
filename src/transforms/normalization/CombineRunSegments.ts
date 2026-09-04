import { isDeepStrictEqual } from "util";
import { RunGeometry, RunProperties } from "openskidata-format";
import { RunLineFeature } from "../../features/RunFeature.js";
import notEmpty from "../../utils/notEmpty.js";
import PointGraph from "./PointGraph.js";

// TopoJSON quantizes coordinates to a fixed grid during topology construction.
// Very short run segments can have all their coordinates snap to the same grid
// point, producing a degenerate arc. When converted back to GeoJSON, this
// yields a zero-length LineString (e.g. two identical coordinates). Such
// geometries must be filtered out before segment combining, otherwise
// downstream processing (e.g. elevation profile extraction) throws when it
// tries to divide by the zero-length.
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
