import clusterSkiAreas from "../clustering/ClusterSkiAreas";
import { configFromEnvironment } from "../Config";
import {
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
} from "../io/GeoJSONFiles";

const config = configFromEnvironment();

clusterSkiAreas(
  new GeoJSONIntermediatePaths(config.workingDir),
  new GeoJSONOutputPaths(config.outputDir),
  config,
);
