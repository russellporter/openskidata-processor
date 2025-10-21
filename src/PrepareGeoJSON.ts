import { createWriteStream, existsSync, unlinkSync } from "fs";
import merge from "merge2";
import { FeatureType } from "openskidata-format";
import * as path from "path";
import { join } from "path";
import { Readable } from "stream";
import StreamToPromise from "stream-to-promise";
import { Config, ElevationServerConfig, PostgresConfig } from "./Config";
import clusterSkiAreas from "./clustering/ClusterSkiAreas";
import { DataPaths, getPath } from "./io/GeoJSONFiles";
import { readGeoJSONFeatures } from "./io/GeoJSONReader";
import { convertGeoJSONToGeoPackage } from "./io/GeoPackageWriter";
import * as CSVFormatter from "./transforms/CSVFormatter";
import { createElevationProcessor } from "./transforms/Elevation";
import toFeatureCollection from "./transforms/FeatureCollection";
import { formatLift } from "./transforms/LiftFormatter";
import * as MapboxGLFormatter from "./transforms/MapboxGLFormatter";
import { formatRun } from "./transforms/RunFormatter";
import { InputSkiAreaType, formatSkiArea } from "./transforms/SkiAreaFormatter";
import { generateTiles } from "./transforms/TilesGenerator";
import { runCommand } from "./utils/ProcessRunner";

import { performanceMonitor } from "./clustering/database/PerformanceMonitor";
import { isValidGeometryInFeature } from "./transforms/GeoTransforms";
import {
  SkiAreaSiteProvider,
  addSkiAreaSites,
} from "./transforms/SkiAreaSiteProvider";
import {
  accumulate,
  filter,
  flatMap,
  flatMapArray,
  map,
  mapAsync,
} from "./transforms/StreamTransforms";
import { RunNormalizerAccumulator } from "./transforms/accumulator/RunNormalizerAccumulator";

async function createElevationTransform(
  elevationServerConfig: ElevationServerConfig | null,
  postgresConfig: PostgresConfig,
) {
  if (!elevationServerConfig) {
    return null;
  }

  const processor = await createElevationProcessor(
    elevationServerConfig,
    postgresConfig,
  );
  return { processor, transform: processor.processFeature };
}

async function fetchSnowCoverIfEnabled(
  config: Config,
  runsPath: string,
): Promise<void> {
  const snowCoverConfig = config.snowCover;
  if (!snowCoverConfig || snowCoverConfig.fetchPolicy === "none") {
    return;
  }

  await performanceMonitor.withOperation("Processing snow cover", async () => {
    const args = ["snow-cover/src/fetch_snow_data.py"];

    if (snowCoverConfig.fetchPolicy === "incremental") {
      args.push("--fill-cache");
    } else {
      // 'full' policy - pass the runs geojson path
      args.push(runsPath);
    }

    // Determine which Python executable to use
    let pythonExecutable = "python3"; // Default fallback

    // Check if virtual environment exists and use it
    const venvPython = path.join("snow-cover", "venv", "bin", "python");
    if (existsSync(venvPython)) {
      pythonExecutable = "snow-cover/venv/bin/python";
    }

    try {
      await runCommand(pythonExecutable, args);
    } catch (error) {
      throw new Error(`Snow cover processing failed: ${error}`);
    }
  });
}

export default async function prepare(paths: DataPaths, config: Config) {
  await performanceMonitor.withPhase(
    "Phase 2: GeoJSON Preparation",
    async () => {
      const siteProvider = new SkiAreaSiteProvider();
      await performanceMonitor.withOperation(
        "Processing ski areas",
        async () => {
          siteProvider.loadSites(paths.input.osmJSON.skiAreaSites);

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
              .pipe(createWriteStream(paths.intermediate.skiAreas)),
          );
        },
      );

      // Create shared elevation processor for both runs and lifts
      const elevationTransform = await createElevationTransform(
        config.elevationServer,
        config.postgresCache,
      );

      try {
        await performanceMonitor.withOperation("Processing runs", async () => {
          await StreamToPromise(
            readGeoJSONFeatures(paths.input.geoJSON.runs)
              .pipe(flatMapArray(formatRun))
              .pipe(map(addSkiAreaSites(siteProvider)))
              .pipe(filter(isValidGeometryInFeature))
              .pipe(accumulate(new RunNormalizerAccumulator()))
              .pipe(mapAsync(elevationTransform?.transform || null, 10))
              .pipe(toFeatureCollection())
              .pipe(createWriteStream(paths.intermediate.runs)),
          );
        });

        // Process snow cover data after runs are written
        await fetchSnowCoverIfEnabled(config, paths.intermediate.runs);

        await performanceMonitor.withOperation("Processing lifts", async () => {
          await StreamToPromise(
            readGeoJSONFeatures(paths.input.geoJSON.lifts)
              .pipe(flatMap(formatLift))
              .pipe(map(addSkiAreaSites(siteProvider)))
              .pipe(mapAsync(elevationTransform?.transform || null, 10))
              .pipe(toFeatureCollection())
              .pipe(createWriteStream(paths.intermediate.lifts)),
          );
        });
      } finally {
        if (elevationTransform) {
          await elevationTransform.processor.close();
        }
      }
    },
  );

  await performanceMonitor.withPhase("Phase 3: Clustering", async () => {
    await clusterSkiAreas(paths.intermediate, paths.output, config);
  });

  await performanceMonitor.withPhase("Phase 4: Output Generation", async () => {
    await performanceMonitor.withOperation(
      "Exporting to Mapbox GeoJSON",
      async () => {
        await Promise.all(
          [FeatureType.SkiArea, FeatureType.Lift, FeatureType.Run].map(
            (type) => {
              return StreamToPromise(
                readGeoJSONFeatures(getPath(paths.output, type))
                  .pipe(flatMap(MapboxGLFormatter.formatter(type)))
                  .pipe(toFeatureCollection())
                  .pipe(
                    createWriteStream(getPath(paths.output.mapboxGL, type)),
                  ),
              );
            },
          ),
        );
      },
    );

    await performanceMonitor.withOperation("Exporting to CSV", async () => {
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
    });

    await performanceMonitor.withOperation("Creating GeoPackage", async () => {
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

      for (const type of [
        FeatureType.SkiArea,
        FeatureType.Lift,
        FeatureType.Run,
      ]) {
        await convertGeoJSONToGeoPackage(
          getPath(paths.output, type),
          paths.output.geoPackage,
          layerMap[type],
          type,
        );
      }
    });

    // Generate tiles if enabled
    const tilesConfig = config.tiles;
    if (tilesConfig) {
      await performanceMonitor.withOperation("Generating tiles", async () => {
        await generateTiles(
          paths.output.mapboxGL,
          config.workingDir,
          tilesConfig,
        );
      });
    }
  });

  console.log("Done preparing");

  performanceMonitor.logTimeline();
}
