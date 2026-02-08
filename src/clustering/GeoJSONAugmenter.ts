import { createWriteStream } from "fs";
import {
  FeatureType,
  LiftFeature,
  LiftStationSpotProperties,
  RunFeature,
  SkiAreaFeature,
  SpotFeature,
  SpotGeometry,
} from "openskidata-format";
import { pipeline } from "stream/promises";
import { PostgresConfig, SnowCoverConfig } from "../Config";
import { readGeoJSONFeatures } from "../io/GeoJSONReader";
import toFeatureCollection from "../transforms/FeatureCollection";
import { filter, mapAsync } from "../transforms/StreamTransforms";
import { toSkiAreaSummary } from "../transforms/toSkiAreaSummary";
import { getSnowCoverHistoryFromCache } from "../utils/snowCoverHistory";
import { LiftObject, RunObject } from "./MapObject";
import objectToFeature from "./ObjectToFeature";
import { ClusteringDatabase } from "./database/ClusteringDatabase";

// TODO: just dump the features from the database instead
export default async function augmentGeoJSONFeatures(
  inputPath: string,
  outputPath: string,
  database: ClusteringDatabase,
  snowCoverConfig: SnowCoverConfig | null,
  postgresConfig: PostgresConfig,
) {
  await pipeline(
    readGeoJSONFeatures(inputPath),
    mapAsync(
      async (
        feature: RunFeature | LiftFeature | SpotFeature | SkiAreaFeature,
      ) => {
        // Fetch the map object from the database
        const mapObject = await database.getObjectById(feature.properties.id);

        if (!mapObject) {
          // Object was removed from database (e.g., orphaned lift station)
          return null;
        }

        feature.geometry = mapObject.geometry;

        // Merge database properties with feature properties
        // Database properties take precedence as fields might be updated
        feature.properties = {
          ...feature.properties,
          ...mapObject.properties,
        };

        if (feature.properties.type !== mapObject.type) {
          // Type mismatch between feature and database object, skip this feature
          console.warn(
            `Type mismatch for object ID ${feature.properties.id}: feature type ${feature.properties.type} does not match database type ${mapObject.type}. Skipping augmentation for this feature.`,
          );
          return null;
        }

        if (feature.properties.type !== FeatureType.SkiArea) {
          const skiAreaIds = mapObject.skiAreas;
          const skiAreas =
            skiAreaIds.length > 0
              ? await database
                  .getSkiAreasByIds(skiAreaIds, false)
                  .then((cursor) => cursor.all())
              : [];
          feature.properties.skiAreas = skiAreas
            .map(objectToFeature)
            .map(toSkiAreaSummary);
        }

        // Add snow cover history for runs if snow cover config is provided
        if (
          snowCoverConfig &&
          feature.properties.type === FeatureType.Run &&
          mapObject.type === FeatureType.Run
        ) {
          const snowCoverHistory = await generateRunSnowCoverHistory(
            mapObject as RunObject,
            postgresConfig,
          );
          if (snowCoverHistory && snowCoverHistory.length > 0) {
            feature.properties.snowCoverHistory = snowCoverHistory;
          }
        }

        // Populate lift stations for lift features
        if (
          feature.properties.type === FeatureType.Lift &&
          mapObject.type === FeatureType.Lift
        ) {
          const liftObject = mapObject as LiftObject;
          const stationIds = liftObject.stationIds;

          const stations = (
            await Promise.all(
              stationIds.map((id: string) => database.getObjectById(id)),
            )
          )
            .filter((s) => s !== null)
            .map((station) => {
              return {
                type: "Feature" as const,
                geometry: station.geometry as SpotGeometry,
                properties: station.properties as LiftStationSpotProperties,
              };
            });

          feature.properties.stations = stations;
        }

        return feature;
      },
      10,
    ),
    filter((feature) => feature !== null),
    toFeatureCollection(),
    createWriteStream(outputPath),
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
