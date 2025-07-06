import bboxPolygon from "@turf/bbox-polygon";
import booleanContains from "@turf/boolean-contains";
import { readFile, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { performanceMonitor } from "../clustering/database/PerformanceMonitor";
import { InputSkiMapOrgSkiAreaFeature } from "../features/SkiAreaFeature";
import {
  OSMDownloadConfig,
  liftsDownloadConfig,
  runsDownloadConfig,
  skiAreaSitesDownloadConfig,
  skiAreasDownloadConfig,
  skiMapSkiAreasURL,
} from "./DownloadURLs";
import { InputDataPaths } from "./GeoJSONFiles";
import convertOSMFileToGeoJSON from "./OSMToGeoJSONConverter";

export default async function downloadAndConvertToGeoJSON(
  folder: string,
  bbox: GeoJSON.BBox | null,
): Promise<InputDataPaths> {
  return await performanceMonitor.withPhase("Phase 1: Download", async () => {
    const paths = new InputDataPaths(folder);

    // Serialize downloads using the same endpoint so we don't get rate limited by the Overpass API
    await performanceMonitor.withOperation("OSM Data Download", async () => {
      await Promise.all([
        downloadOSMJSON(
          OSMEndpoint.Z,
          runsDownloadConfig,
          paths.osmJSON.runs,
          bbox,
        ),
        (async () => {
          await downloadOSMJSON(
            OSMEndpoint.LZ4,
            liftsDownloadConfig,
            paths.osmJSON.lifts,
            bbox,
          );
          await downloadOSMJSON(
            OSMEndpoint.LZ4,
            skiAreasDownloadConfig,
            paths.osmJSON.skiAreas,
            bbox,
          );
          await downloadOSMJSON(
            OSMEndpoint.LZ4,
            skiAreaSitesDownloadConfig,
            paths.osmJSON.skiAreaSites,
            bbox,
          );
        })(),
        downloadSkiMapOrgSkiAreas(paths.geoJSON.skiMapSkiAreas, bbox),
      ]);
    });

    // Conversions are done serially for lower memory pressure.
    await performanceMonitor.withOperation("JSON Conversion", async () => {
      await convertOSMFileToGeoJSON(paths.osmJSON.runs, paths.geoJSON.runs);
      await convertOSMFileToGeoJSON(paths.osmJSON.lifts, paths.geoJSON.lifts);
      await convertOSMFileToGeoJSON(
        paths.osmJSON.skiAreas,
        paths.geoJSON.skiAreas,
      );
    });

    performanceMonitor.logTimeline();

    return paths;
  });
}

enum OSMEndpoint {
  LZ4 = "https://lz4.overpass-api.de/api/interpreter",
  Z = "https://z.overpass-api.de/api/interpreter",
}

async function downloadOSMJSON(
  endpoint: OSMEndpoint,
  config: OSMDownloadConfig,
  targetPath: string,
  bbox: GeoJSON.BBox | null,
) {
  const query = config.query(bbox);
  console.log("Performing overpass query...");
  console.log(query);
  const url = overpassURLForQuery(endpoint, query);
  await downloadToFile(url, targetPath);
}

async function downloadSkiMapOrgSkiAreas(
  targetPath: string,
  bbox: GeoJSON.BBox | null,
) {
  await downloadToFile(skiMapSkiAreasURL, targetPath);

  if (!bbox) {
    return;
  }

  // For consistency with the OSM data (which has the bounding box applied on Overpass API), apply bbox filtering on the downloaded GeoJSON.
  const bboxGeometry = bboxPolygon(bbox);
  const contents = await readFile(targetPath);
  const json: GeoJSON.FeatureCollection = JSON.parse(contents.toString());
  json.features = (json.features as InputSkiMapOrgSkiAreaFeature[]).filter(
    (feature) => booleanContains(bboxGeometry, feature),
  );

  await writeFile(targetPath, JSON.stringify(json));
}

async function downloadToFile(
  sourceURL: string,
  targetPath: string,
  retries: number = 10,
): Promise<void> {
  try {
    await _downloadToFile(sourceURL, targetPath);
  } catch (e) {
    if (retries <= 0) {
      throw e;
    }

    console.log(
      "Download failed due to " + e + ". Will wait a minute and try again.",
    );

    // Wait a bit in case we are rate limited by the server.
    await sleep(60000);

    await downloadToFile(sourceURL, targetPath, retries - 1);
  }
}

async function _downloadToFile(
  sourceURL: string,
  targetPath: string,
): Promise<void> {
  const response = await fetch(sourceURL, {
    headers: { Referer: "https://openskimap.org" },
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });

  if (!response.ok) {
    throw (
      "Failed downloading file at URL (status: " +
      response.status +
      "): " +
      sourceURL
    );
  }

  const stream = Readable.fromWeb(response.body as any);
  await writeFile(targetPath, stream);
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function overpassURLForQuery(endpoint: OSMEndpoint, query: string) {
  return endpoint + "?data=" + encodeURIComponent(query);
}
