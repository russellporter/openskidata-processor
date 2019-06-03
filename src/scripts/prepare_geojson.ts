import {
  GeoJSONInputPaths,
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths
} from "../io/GeoJSONFiles";
import prepare from "../PrepareGeoJSON";

prepare(
  new GeoJSONInputPaths("data"),
  new GeoJSONIntermediatePaths("data"),
  new GeoJSONOutputPaths("data")
).catch((reason: any) => {
  console.error("Failed preparing", reason);
  process.exit(1);
});
