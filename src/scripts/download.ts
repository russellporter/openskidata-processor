import { configFromEnvironment } from "../Config";
import downloadAndConvertToGeoJSON from "../io/GeoJSONDownloader";

const config = configFromEnvironment();

downloadAndConvertToGeoJSON(config.workingDir, config.bbox).catch(
  (reason: any) => {
    console.log("Failed downloading", reason);
    process.exit(1);
  },
);
