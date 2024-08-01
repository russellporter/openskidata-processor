import { RunGeometry, RunProperties } from "openskidata-format";
import { RunLineFeature } from "../../features/RunFeature";
import notEmpty from "../../utils/notEmpty";
import PointGraph from "./PointGraph";

export default function combineRunSegments(
  geojson: GeoJSON.FeatureCollection<RunGeometry, RunProperties>,
) {
  const graph = new PointGraph();
  let runs = geojson.features;

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
