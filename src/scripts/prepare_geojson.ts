import { configFromEnvironment } from "../Config";
import {
  GeoJSONInputPaths,
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths
} from "../io/GeoJSONFiles";
import prepare from "../PrepareGeoJSON";

prepare(
  new GeoJSONInputPaths("data"),
  new GeoJSONIntermediatePaths("data"),
  new GeoJSONOutputPaths("data"),
  configFromEnvironment()
).catch((reason: any) => {
  console.log("Failed preparing", reason);
  process.exit(1);
});
