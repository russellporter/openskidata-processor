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
    downloadAndConvertOSMToGeoJSON(
      OSMEndpoint.Z,
      runsDownloadConfig,
      paths.runs
    ),
    (async () => {
      // Serialize downloads using the same endpoint so we don't get rate limited by the Overpass API
      await downloadAndConvertOSMToGeoJSON(
        OSMEndpoint.LZ4,
        liftsDownloadConfig,
        paths.lifts
      );
      await downloadAndConvertOSMToGeoJSON(
        OSMEndpoint.LZ4,
        skiAreasDownloadConfig,
        paths.skiAreas
      );
    })(),
    downloadToFile(skiMapSkiAreasURL, paths.skiMapSkiAreas)
  ]);

  return paths;
}

enum OSMEndpoint {
  LZ4 = "https://lz4.overpass-api.de/api/interpreter",
  Z = "https://z.overpass-api.de/api/interpreter"
}

async function downloadAndConvertOSMToGeoJSON(
  endpoint: OSMEndpoint,
  config: OSMDownloadConfig,
  targetGeoJSONPath: string
): Promise<void> {
  const tempOSMPath = tmp.fileSync().name;
  const url = overpassURLForQuery(endpoint, config.query);
  try {
    await downloadToFile(url, tempOSMPath);
  } catch (error) {
    console.log(
      "Download failed due to " + error + ". Will wait a minute and try again."
    );
    // Wait a bit in case we are rate limited by the server.
    await sleep(60000);

    await downloadToFile(url, tempOSMPath);
  }

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

function sleep(ms: number) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function overpassURLForQuery(endpoint: OSMEndpoint, query: string) {
  return endpoint + "?data=" + encodeURIComponent(query);
}
