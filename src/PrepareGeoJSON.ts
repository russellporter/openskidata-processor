import { spawn } from "child_process";
import { createWriteStream, existsSync, unlinkSync } from "fs";
import merge from "merge2";
import { FeatureType } from "openskidata-format";
import * as path from "path";
import { join } from "path";
import { Readable } from "stream";
import StreamToPromise from "stream-to-promise";
import { Config } from "./Config";
import clusterSkiAreas from "./clustering/ClusterSkiAreas";
import { DataPaths, getPath } from "./io/GeoJSONFiles";
import { readGeoJSONFeatures } from "./io/GeoJSONReader";
import { convertGeoJSONToGeoPackage } from "./io/GeoPackageWriter";
import * as CSVFormatter from "./transforms/CSVFormatter";
import addElevation from "./transforms/Elevation";
import toFeatureCollection from "./transforms/FeatureCollection";
import { formatLift } from "./transforms/LiftFormatter";
import * as MapboxGLFormatter from "./transforms/MapboxGLFormatter";
import { formatRun } from "./transforms/RunFormatter";
import { InputSkiAreaType, formatSkiArea } from "./transforms/SkiAreaFormatter";

import {
  SkiAreaSiteProvider,
  addSkiAreaSites,
} from "./transforms/SkiAreaSiteProvider";
import {
  accumulate,
  flatMap,
  flatMapArray,
  map,
  mapAsync,
} from "./transforms/StreamTransforms";
import { RunNormalizerAccumulator } from "./transforms/accumulator/RunNormalizerAccumulator";

async function fetchSnowCoverIfEnabled(
  config: Config,
  runsPath: string,
): Promise<void> {
  if (!config.snowCover || config.snowCover.fetchPolicy === "none") {
    return;
  }

  console.log("Processing snow cover data...");

  const args = ["snow-cover/src/fetch_snow_data.py"];

  if (config.snowCover.fetchPolicy === "incremental") {
    args.push("--fill-cache");
  } else {
    // 'full' policy - pass the runs geojson path
    args.push(runsPath);
  }

  args.push("--cache-dir", config.snowCover.cacheDir);

  // Determine which Python executable to use
  let pythonExecutable = "python3"; // Default fallback

  // Check if virtual environment exists and use it
  const venvPython = path.join("snow-cover", "venv", "bin", "python");
  if (existsSync(venvPython)) {
    pythonExecutable = "snow-cover/venv/bin/python";
  }

  return new Promise((resolve, reject) => {
    const pythonProcess = spawn(pythonExecutable, args, {
      stdio: "inherit",
    });

    pythonProcess.on("close", (code) => {
      if (code === 0) {
        console.log("Snow cover processing completed successfully");
        resolve();
      } else {
        reject(
          new Error(`Snow cover processing failed with exit code ${code}`),
        );
      }
    });

    pythonProcess.on("error", (error) => {
      reject(
        new Error(`Failed to start snow cover processing: ${error.message}`),
      );
    });
  });
}

export default async function prepare(paths: DataPaths, config: Config) {
  const siteProvider = new SkiAreaSiteProvider();
  siteProvider.loadSites(paths.input.osmJSON.skiAreaSites);

  console.log("Processing ski areas...");

  await StreamToPromise(
    merge([
      readGeoJSONFeatures(paths.input.geoJSON.skiAreas).pipe(
        flatMap(formatSkiArea(InputSkiAreaType.OPENSTREETMAP_LANDUSE)),
      ),
      Readable.from(siteProvider.getGeoJSONSites()),
      readGeoJSONFeatures(paths.input.geoJSON.skiMapSkiAreas).pipe(
        flatMap(formatSkiArea(InputSkiAreaType.SKIMAP_ORG)),
      ),
    ])
      .pipe(toFeatureCollection())
      .pipe(
        createWriteStream(
          config.arangoDBURLForClustering
            ? paths.intermediate.skiAreas
            : paths.output.skiAreas,
        ),
      ),
  );

  console.log("Processing runs...");

  await StreamToPromise(
    readGeoJSONFeatures(paths.input.geoJSON.runs)
      .pipe(flatMapArray(formatRun))
      .pipe(map(addSkiAreaSites(siteProvider)))
      // write stream here
      // do topo conversion in a separate command
      // then open the topojson separately and normalize
      .pipe(accumulate(new RunNormalizerAccumulator()))
      .pipe(
        mapAsync(
          config.elevationServerURL
            ? addElevation(config.elevationServerURL)
            : null,
          10,
        ),
      )
      .pipe(toFeatureCollection())
      .pipe(
        createWriteStream(
          config.arangoDBURLForClustering
            ? paths.intermediate.runs
            : paths.output.runs,
        ),
      ),
  );

  // Process snow cover data after runs are written
  await fetchSnowCoverIfEnabled(
    config,
    config.arangoDBURLForClustering
      ? paths.intermediate.runs
      : paths.output.runs,
  );

  console.log("Processing lifts...");

  await StreamToPromise(
    readGeoJSONFeatures(paths.input.geoJSON.lifts)
      .pipe(flatMap(formatLift))
      .pipe(map(addSkiAreaSites(siteProvider)))
      .pipe(
        mapAsync(
          config.elevationServerURL
            ? addElevation(config.elevationServerURL)
            : null,
          10,
        ),
      )
      .pipe(toFeatureCollection())
      .pipe(
        createWriteStream(
          config.arangoDBURLForClustering
            ? paths.intermediate.lifts
            : paths.output.lifts,
        ),
      ),
  );

  if (config.arangoDBURLForClustering) {
    console.log("Clustering ski areas...");
    await clusterSkiAreas(
      paths.intermediate,
      paths.output,
      config.arangoDBURLForClustering,
      config.geocodingServer,
      config.snowCover,
    );
  }

  console.log("Formatting for maps...");

  await Promise.all(
    [FeatureType.SkiArea, FeatureType.Lift, FeatureType.Run].map((type) => {
      return StreamToPromise(
        readGeoJSONFeatures(getPath(paths.output, type))
          .pipe(flatMap(MapboxGLFormatter.formatter(type)))
          .pipe(toFeatureCollection())
          .pipe(createWriteStream(getPath(paths.output.mapboxGL, type))),
      );
    }),
  );

  console.log("Formatting for CSV export...");

  await Promise.all(
    [FeatureType.SkiArea, FeatureType.Lift, FeatureType.Run].map((type) => {
      return StreamToPromise(
        readGeoJSONFeatures(getPath(paths.output, type))
          .pipe(flatMap(CSVFormatter.formatter(type)))
          .pipe(CSVFormatter.createCSVWriteStream(type))
          .pipe(
            createWriteStream(
              join(paths.output.csv, CSVFormatter.getCSVFilename(type)),
            ),
          ),
      );
    }),
  );

  console.log("Creating GeoPackage...");

  // Delete existing GeoPackage if it exists
  if (existsSync(paths.output.geoPackage)) {
    unlinkSync(paths.output.geoPackage);
    console.log("Removed existing GeoPackage file");
  }

  // Create a single GeoPackage with all three layers
  const layerMap = {
    [FeatureType.SkiArea]: "ski_areas",
    [FeatureType.Lift]: "lifts",
    [FeatureType.Run]: "runs",
  };

  for (const type of [FeatureType.SkiArea, FeatureType.Lift, FeatureType.Run]) {
    await convertGeoJSONToGeoPackage(
      getPath(paths.output, type),
      paths.output.geoPackage,
      layerMap[type],
      type,
    );
  }

  console.log("Done preparing");
}
