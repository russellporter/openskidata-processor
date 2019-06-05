import downloadAndPrepare from "../DownloadAndPrepareGeoJSON";

const arangoDBURL = process.argv[2];

if (!arangoDBURL) {
  throw "Missing argument: ArangoDB URL";
}

downloadAndPrepare("data", arangoDBURL).catch((reason: any) => {
  console.error("Failed downloading & preparing", reason);
  process.exit(1);
});
