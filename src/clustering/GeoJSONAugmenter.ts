import { createWriteStream } from "fs";
import { FeatureType } from "openskidata-format";
import streamToPromise from "stream-to-promise";
import { PostgresConfig, SnowCoverConfig } from "../Config";
import { readGeoJSONFeatures } from "../io/GeoJSONReader";
import toFeatureCollection from "../transforms/FeatureCollection";
import { mapAsync } from "../transforms/StreamTransforms";
import { toSkiAreaSummary } from "../transforms/toSkiAreaSummary";
import { getSnowCoverHistoryFromCache } from "../utils/snowCoverHistory";
import { AugmentedMapFeature, RunObject } from "./MapObject";
import objectToFeature from "./ObjectToFeature";
import { ClusteringDatabase } from "./database/ClusteringDatabase";

export default async function augmentGeoJSONFeatures(
  inputPath: string,
  outputPath: string,
  database: ClusteringDatabase,
  featureType: FeatureType,
  snowCoverConfig: SnowCoverConfig | null,
  postgresConfig: PostgresConfig,
) {
  await streamToPromise(
    readGeoJSONFeatures(inputPath)
      .pipe(
        mapAsync(async (feature: AugmentedMapFeature) => {
          let skiAreas = await database.getSkiAreasForObject(
            feature.properties.id,
          );

          feature.properties.skiAreas = skiAreas
            .map(objectToFeature)
            .map(toSkiAreaSummary);

          // Add snow cover history for runs if snow cover config is provided
          if (snowCoverConfig && featureType === FeatureType.Run) {
            const runObject = await database.getRunObjectById(
              feature.properties.id,
            );
            if (runObject) {
              const snowCoverHistory = await generateRunSnowCoverHistory(
                runObject,
                postgresConfig,
              );
              if (snowCoverHistory && snowCoverHistory.length > 0) {
                feature.properties.snowCoverHistory = snowCoverHistory;
              }
            }
          }

          return feature;
        }, 10),
      )
      .pipe(toFeatureCollection())
      .pipe(createWriteStream(outputPath)),
  );
}

async function generateRunSnowCoverHistory(
  runObject: RunObject,
  postgresConfig: PostgresConfig,
) {
  try {
    return await getSnowCoverHistoryFromCache(
      runObject.viirsPixels,
      postgresConfig,
    );
  } catch (error) {
    console.error(
      `Failed to generate snow cover history for run ${runObject._key}:`,
      error,
    );
    return null;
  }
}
