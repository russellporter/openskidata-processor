import { createWriteStream } from "fs";
import {
  FeatureType,
  LiftFeature,
  LiftStationSpotFeature,
  RunFeature,
  RunGeometry,
  SkiAreaFeature,
  SpotFeature,
  SpotGeometry,
} from "openskidata-format";
import { pipeline } from "stream/promises";
import { PostgresConfig, SnowCoverConfig } from "../Config";
import toFeatureCollection from "../transforms/FeatureCollection";
import { filter, map, mapAsync } from "../transforms/StreamTransforms";
import { toSkiAreaSummary } from "../transforms/toSkiAreaSummary";
import { getSnowCoverHistoryFromCache } from "../utils/snowCoverHistory";
import {
  LiftObject,
  MapObject,
  RunObject,
  SkiAreaObject,
  SpotObject,
} from "./MapObject";
import objectToFeature from "./ObjectToFeature";
import { asyncIterableToStream } from "./asyncIterableToStream";
import { ClusteringDatabase } from "./database/ClusteringDatabase";

export async function exportSkiAreasGeoJSON(
  path: string,
  database: ClusteringDatabase,
) {
  await pipeline(
    asyncIterableToStream(database.streamObjects(FeatureType.SkiArea)),
    map<SkiAreaObject, SkiAreaFeature>(objectToFeature),
    toFeatureCollection(),
    createWriteStream(path),
  );
}

export async function exportRunsGeoJSON(
  path: string,
  database: ClusteringDatabase,
  snowCoverConfig: SnowCoverConfig | null,
  postgresConfig: PostgresConfig,
) {
  await pipeline(
    asyncIterableToStream(database.streamObjects(FeatureType.Run)),
    mapAsync(async (run: RunObject): Promise<RunFeature | null> => {
      const skiAreas = await resolveSkiAreaSummaries(database, run.skiAreas);

      let snowCoverHistory = undefined;
      if (snowCoverConfig && run.viirsPixels.length > 0) {
        try {
          const history = await getSnowCoverHistoryFromCache(
            run.viirsPixels,
            postgresConfig,
          );
          if (history && history.length > 0) {
            snowCoverHistory = history;
          }
        } catch (error) {
          console.error(
            `Failed to generate snow cover history for run ${run._key}:`,
            error,
          );
        }
      }

      return {
        type: "Feature",
        geometry: run.geometry as RunGeometry,
        properties: {
          ...run.properties,
          skiAreas,
          snowCoverHistory,
        },
      };
    }, 10),
    filter((feature) => feature !== null),
    toFeatureCollection(),
    createWriteStream(path),
  );
}

export async function exportLiftsGeoJSON(
  path: string,
  database: ClusteringDatabase,
) {
  await pipeline(
    asyncIterableToStream(database.streamObjects(FeatureType.Lift)),
    mapAsync(async (lift: LiftObject): Promise<LiftFeature | null> => {
      const skiAreas = await resolveSkiAreaSummaries(database, lift.skiAreas);

      const stations: LiftStationSpotFeature[] = (
        await Promise.all(
          lift.stationIds.map((id: string) => database.getObjectById(id)),
        )
      )
        .filter((s): s is MapObject => s !== null)
        .map((station) => ({
          type: "Feature" as const,
          geometry: station.geometry as SpotGeometry,
          properties:
            station.properties as LiftStationSpotFeature["properties"],
        }));

      return {
        type: "Feature",
        geometry: lift.geometry,
        properties: {
          ...lift.properties,
          skiAreas,
          stations,
        },
      };
    }, 10),
    filter((feature) => feature !== null),
    toFeatureCollection(),
    createWriteStream(path),
  );
}

export async function exportSpotsGeoJSON(
  path: string,
  database: ClusteringDatabase,
) {
  await pipeline(
    asyncIterableToStream(database.streamObjects(FeatureType.Spot)),
    mapAsync(async (spot: SpotObject): Promise<SpotFeature | null> => {
      const skiAreas = await resolveSkiAreaSummaries(database, spot.skiAreas);

      return {
        type: "Feature",
        geometry: spot.geometry,
        properties: {
          ...spot.properties,
          skiAreas,
        },
      };
    }, 10),
    filter((feature) => feature !== null),
    toFeatureCollection(),
    createWriteStream(path),
  );
}

async function resolveSkiAreaSummaries(
  database: ClusteringDatabase,
  skiAreaIds: string[],
) {
  if (skiAreaIds.length === 0) {
    return [];
  }

  const skiAreaObjects = await database
    .getSkiAreasByIds(skiAreaIds, false)
    .then((cursor) => cursor.all());

  return skiAreaObjects.map(objectToFeature).map(toSkiAreaSummary);
}
