import { configFromEnvironment } from "../Config.js";
import downloadAndConvertToGeoJSON from "../io/GeoJSONDownloader.js";

const config = configFromEnvironment();

downloadAndConvertToGeoJSON(
  config.workingDir,
  config.bbox,
  config.skiPasses?.csvURL ?? null,
).catch((reason: any) => {
  console.log("Failed downloading", reason);
  process.exit(1);
});
