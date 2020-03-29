import * as Fs from "fs";
import request from "request";
import streamToPromise from "stream-to-promise";
import * as tmp from "tmp";
import { GeoJSONInputPaths } from "./GeoJSONFiles";
import convertOSMToGeoJSON from "./OSMToGeoJSONConverter";

function overpassURLForQuery(query: string) {
  return (
    "http://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query)
  );
}

const runsURL = overpassURLForQuery(`
[out:json][timeout:1800];(
  way["piste:type"];
  rel["piste:type"];
);
(._; >;);
out;
`);

const liftsURL = overpassURLForQuery(`
[out:json][timeout:1800];(
  way[~"^([A-Za-z]+:)?aerialway$"~"^.*$"];
  rel[~"^([A-Za-z]+:)?aerialway$"~"^.*$"];
  way[~"^([A-Za-z]+:)?railway$"~"^funicular$"];
  rel[~"^([A-Za-z]+:)?railway$"~"^funicular$"];
);
(._; >;);
out;
`);

const skiAreasURL = overpassURLForQuery(`
[out:json][timeout:1800];(
  node[~"^([A-Za-z]+:)?landuse$"~"^winter_sports$"];
  way[~"^([A-Za-z]+:)?landuse$"~"^winter_sports$"];
  rel[~"^([A-Za-z]+:)?landuse$"~"^winter_sports$"];
);
(._; >;);
out;
`);

const skiMapSkiAreasURL = "https://skimap.org/SkiAreas/index.geojson";

export default async function downloadAndConvertToGeoJSON(
  folder: string
): Promise<GeoJSONInputPaths> {
  const paths = new GeoJSONInputPaths(folder);

  await Promise.all([
    downloadAndConvertOSMToGeoJSON(runsURL, paths.runs),
    downloadAndConvertOSMToGeoJSON(liftsURL, paths.lifts),
    downloadAndConvertOSMToGeoJSON(skiAreasURL, paths.skiAreas),
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
