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
          // Fetch the map object from the database
          const mapObject = await database.getObjectById(
            feature.properties.id,
          );

          if (!mapObject) {
            return feature;
          }

          // Get ski areas from the map object
          const skiAreaIds = mapObject.skiAreas;
          const skiAreas = skiAreaIds.length > 0
            ? await database.getSkiAreasByIds(skiAreaIds, false).then(cursor => cursor.all())
            : [];

          feature.properties.skiAreas = skiAreas
            .map(objectToFeature)
            .map(toSkiAreaSummary);

          // Set places from the map object
          if ('properties' in mapObject && 'places' in mapObject.properties) {
            feature.properties.places = mapObject.properties.places;
          }

          // Add snow cover history for runs if snow cover config is provided
          if (snowCoverConfig && featureType === FeatureType.Run && mapObject.type === 'RUN') {
            const snowCoverHistory = await generateRunSnowCoverHistory(
              mapObject as RunObject,
              postgresConfig,
            );
            if (snowCoverHistory && snowCoverHistory.length > 0) {
              feature.properties.snowCoverHistory = snowCoverHistory;
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
