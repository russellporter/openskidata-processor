import {
  GeoJSONInputPaths,
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths
} from "../io/GeoJSONFiles";
import prepare from "../PrepareGeoJSON";

const arangoDBURL = process.argv[2];

if (!arangoDBURL) {
  throw "Missing argument: ArangoDB URL";
}

prepare(
  new GeoJSONInputPaths("data"),
  new GeoJSONIntermediatePaths("data"),
  new GeoJSONOutputPaths("data"),
  true,
  arangoDBURL
).catch((reason: any) => {
  console.error("Failed preparing", reason);
  process.exit(1);
});
