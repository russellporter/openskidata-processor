import clusterSkiAreas from "../clustering/ClusterSkiAreas";
import { configFromEnvironment } from "../Config";

const arangoDBURL = configFromEnvironment().arangoDBURLForClustering;
if (!arangoDBURL) {
  throw "Need an ArangoDB endpoint to perform clustering";
}

clusterSkiAreas(
  "data/intermediate_ski_areas.geojson",
  "data/ski_areas.geojson",
  "data/intermediate_lifts.geojson",
  "data/lifts.geojson",
  "data/intermediate_runs.geojson",
  "data/runs.geojson",
  arangoDBURL
);
