import { configFromEnvironment } from "../Config.js";
import {
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
  InputDataPaths,
} from "../io/GeoJSONFiles.js";
import prepare from "../PrepareGeoJSON.js";

const config = configFromEnvironment();

prepare(
  {
    input: new InputDataPaths(config.workingDir),
    intermediate: new GeoJSONIntermediatePaths(config.workingDir),
    output: new GeoJSONOutputPaths(config.outputDir),
  },
  config,
).catch((reason: any) => {
  console.log("Failed preparing", reason);
  process.exit(1);
});
