import downloadAndPrepare from "../DownloadAndPrepareGeoJSON";

downloadAndPrepare("data").catch((reason: any) => {
  console.error("Failed downloading & preparing", reason);
  process.exit(1);
});
