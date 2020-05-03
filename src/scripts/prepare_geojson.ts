import { configFromEnvironment } from "../Config";
import {
  GeoJSONInputPaths,
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
} from "../io/GeoJSONFiles";
import prepare from "../PrepareGeoJSON";

prepare(
  {
    input: new GeoJSONInputPaths("data"),
    intermediate: new GeoJSONIntermediatePaths("data"),
    output: new GeoJSONOutputPaths("data"),
  },
  configFromEnvironment()
).catch((reason: any) => {
  console.log("Failed preparing", reason);
  process.exit(1);
});
