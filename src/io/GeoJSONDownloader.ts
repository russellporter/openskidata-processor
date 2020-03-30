import * as Fs from "fs";
import request from "request";
import streamToPromise from "stream-to-promise";
import * as tmp from "tmp";
import {
  liftsDownloadConfig,
  OSMDownloadConfig,
  runsDownloadConfig,
  skiAreasDownloadConfig,
  skiMapSkiAreasURL
} from "./DownloadURLs";
import { GeoJSONInputPaths } from "./GeoJSONFiles";
import convertOSMFileToGeoJSON from "./OSMToGeoJSONConverter";

export default async function downloadAndConvertToGeoJSON(
  folder: string
): Promise<GeoJSONInputPaths> {
  const paths = new GeoJSONInputPaths(folder);

  await Promise.all([
    (async () => {
      // Serialize downloads so we don't get rate limited by the Overpass API
      await downloadAndConvertOSMToGeoJSON(runsDownloadConfig, paths.runs);
      await downloadAndConvertOSMToGeoJSON(liftsDownloadConfig, paths.lifts);
      await downloadAndConvertOSMToGeoJSON(
        skiAreasDownloadConfig,
        paths.skiAreas
      );
    })(),
    downloadToFile(skiMapSkiAreasURL, paths.skiMapSkiAreas)
  ]);

  return paths;
}

async function downloadAndConvertOSMToGeoJSON(
  config: OSMDownloadConfig,
  targetGeoJSONPath: string
): Promise<void> {
  const tempOSMPath = tmp.fileSync().name;
  await downloadToFile(config.url, tempOSMPath);

  convertOSMFileToGeoJSON(
    tempOSMPath,
    targetGeoJSONPath,
    config.shouldIncludeFeature
  );
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
