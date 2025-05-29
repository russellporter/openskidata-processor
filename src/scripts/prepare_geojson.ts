import { configFromEnvironment } from "../Config";
import {
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
  InputDataPaths,
} from "../io/GeoJSONFiles";
import prepare from "../PrepareGeoJSON";

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
