import { configFromEnvironment } from "../Config";
import downloadAndPrepare from "../DownloadAndPrepareGeoJSON";

downloadAndPrepare("data", configFromEnvironment()).catch((reason: any) => {
  console.error("Failed downloading & preparing", reason);
  process.exit(1);
});
