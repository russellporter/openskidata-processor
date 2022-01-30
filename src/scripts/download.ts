import { configFromEnvironment } from "../Config";
import downloadAndConvertToGeoJSON from "../io/GeoJSONDownloader";

const config = configFromEnvironment();

downloadAndConvertToGeoJSON("data", config.bbox).catch((reason: any) => {
  console.log("Failed downloading", reason);
  process.exit(1);
});
