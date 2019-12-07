import { configFromEnvironment } from "../Config";
import downloadAndPrepare from "../DownloadAndPrepareGeoJSON";

downloadAndPrepare("data", configFromEnvironment()).catch((reason: any) => {
  console.log("Failed downloading & preparing", reason);
  process.exit(1);
});
