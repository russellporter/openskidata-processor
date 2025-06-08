import clusterSkiAreas from "../clustering/ClusterSkiAreas";
import { configFromEnvironment } from "../Config";
import {
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
} from "../io/GeoJSONFiles";

const config = configFromEnvironment();
const arangoDBURL = config.arangoDBURLForClustering;
if (!arangoDBURL) {
  throw "Need an ArangoDB endpoint to perform clustering";
}

clusterSkiAreas(
  new GeoJSONIntermediatePaths(config.workingDir),
  new GeoJSONOutputPaths(config.outputDir),
  arangoDBURL,
  config.geocodingServer,
  config.snowCover,
);
