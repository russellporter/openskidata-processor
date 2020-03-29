import * as Fs from "fs";
import request from "request";
import streamToPromise from "stream-to-promise";
import * as tmp from "tmp";
import {
  liftsURL,
  runsURL,
  skiAreasURL,
  skiMapSkiAreasURL
} from "./DownloadURLs";
import { GeoJSONInputPaths } from "./GeoJSONFiles";
import convertOSMToGeoJSON from "./OSMToGeoJSONConverter";

export default async function downloadAndConvertToGeoJSON(
  folder: string
): Promise<GeoJSONInputPaths> {
  const paths = new GeoJSONInputPaths(folder);

  await Promise.all([
    (async () => {
      // Serialize downloads so we don't get rate limited by the Overpass API
      await downloadAndConvertOSMToGeoJSON(runsURL, paths.runs);
      await downloadAndConvertOSMToGeoJSON(liftsURL, paths.lifts);
      await downloadAndConvertOSMToGeoJSON(skiAreasURL, paths.skiAreas);
    })(),
    downloadToFile(skiMapSkiAreasURL, paths.skiMapSkiAreas)
  ]);

  return paths;
}

async function downloadAndConvertOSMToGeoJSON(
  sourceURL: string,
  targetGeoJSONPath: string
): Promise<void> {
  const tempOSMPath = tmp.fileSync().name;
  await downloadToFile(sourceURL, tempOSMPath);

  convertOSMToGeoJSON(tempOSMPath, targetGeoJSONPath);
}

async function downloadToFile(
  sourceURL: string,
  targetPath: string
): Promise<void> {
  const outputStream = Fs.createWriteStream(targetPath);
  let statusCode: number | null = null;
  request(sourceURL, {
    timeout: 30 * 60 * 1000,
    headers: { Referer: "https://openskimap.org" }
  })
    .on("response", function(response) {
      statusCode = response.statusCode;
    })
    .pipe(outputStream);
  await streamToPromise(outputStream);

  if (statusCode === null || statusCode < 200 || statusCode >= 300) {
    throw "Failed downloading file at URL (status: " +
      statusCode +
      "): " +
      sourceURL;
  }
}
