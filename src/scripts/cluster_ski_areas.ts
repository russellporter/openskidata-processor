import clusterSkiAreas from "../clustering/ClusterSkiAreas";
import { configFromEnvironment } from "../Config";
import {
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
} from "../io/GeoJSONFiles";

const arangoDBURL = configFromEnvironment().arangoDBURLForClustering;
if (!arangoDBURL) {
  throw "Need an ArangoDB endpoint to perform clustering";
}

clusterSkiAreas(
  new GeoJSONIntermediatePaths("data"),
  new GeoJSONOutputPaths("data"),
  arangoDBURL
);
