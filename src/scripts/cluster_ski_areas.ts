import clusterSkiAreas from "../clustering/ClusterSkiAreas.js";
import { configFromEnvironment } from "../Config.js";
import {
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
} from "../io/GeoJSONFiles.js";

const config = configFromEnvironment();

clusterSkiAreas(
  new GeoJSONIntermediatePaths(config.workingDir),
  new GeoJSONOutputPaths(config.outputDir),
  config,
);
