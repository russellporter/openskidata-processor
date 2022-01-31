import { configFromEnvironment } from "../Config";
import {
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
  InputDataPaths,
} from "../io/GeoJSONFiles";
import prepare from "../PrepareGeoJSON";

prepare(
  {
    input: new InputDataPaths("data"),
    intermediate: new GeoJSONIntermediatePaths("data"),
    output: new GeoJSONOutputPaths("data"),
  },
  configFromEnvironment()
).catch((reason: any) => {
  console.log("Failed preparing", reason);
  process.exit(1);
});
