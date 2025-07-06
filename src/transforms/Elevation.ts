import * as geohash from "ngeohash";
import DataLoader from "dataloader";
import {
  extractPointsForElevationProfile,
  FeatureType,
  LiftFeature,
  RunFeature,
} from "openskidata-format";
import { ElevationServerConfig } from "../Config";
import { PostgresCache } from "../utils/PostgresCache";

const elevationProfileResolution = 25;
const ELEVATION_CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

export interface ElevationProcessor {
  processFeature: (
    feature: RunFeature | LiftFeature,
  ) => Promise<RunFeature | LiftFeature>;
  close: () => Promise<void>;
}

export async function createElevationProcessor(
  elevationServerConfig: ElevationServerConfig,
): Promise<ElevationProcessor> {
  const cache = new PostgresCache<number | null>(
    "elevation",
    undefined,
    ELEVATION_CACHE_TTL_MS,
    { valueType: "REAL" },
  );
  await cache.initialize();

  const elevationLoader = new DataLoader<string, number | null>(
    async (geohashes: readonly string[]) => {
      return await batchLoadElevations(Array.from(geohashes), elevationServerConfig.url, cache);
    },
    {
      batch: true,
      maxBatchSize: 10000,
    },
  );

  const processFeature = async (
    feature: RunFeature | LiftFeature,
  ): Promise<RunFeature | LiftFeature> => {
    const coordinates: number[][] = getCoordinates(feature);
    const geometry = feature.geometry;
    const elevationProfileCoordinates: number[][] =
      geometry.type === "LineString"
        ? extractPointsForElevationProfile(geometry, elevationProfileResolution)
            .coordinates
        : [];

    let elevations: number[];
    try {
      // Generate geohash keys for all coordinates
      const allCoordinates = Array.from(coordinates).concat(elevationProfileCoordinates);
      const geohashes = allCoordinates.map(([lng, lat]) => geohash.encode(lat, lng, 9));
      
      // Load elevations using DataLoader
      const elevationResults = await Promise.all(geohashes.map(hash => elevationLoader.load(hash)));
      
      // Filter out nulls
      if (elevationResults.some(elevation => elevation === null)) {
        throw new Error("Elevation data contains nulls");
      }
      
      elevations = elevationResults as number[];
    } catch (error) {
      console.log("Failed to load elevations", error);
      return feature;
    }

    const coordinateElevations = elevations.slice(0, coordinates.length);
    const profileElevations = elevations.slice(
      coordinates.length,
      elevations.length,
    );

    if (feature.properties.type === FeatureType.Run) {
      feature.properties.elevationProfile =
        profileElevations.length > 0
          ? {
              heights: profileElevations,
              resolution: elevationProfileResolution,
            }
          : null;
    }

    addElevations(feature, coordinateElevations);
    return feature;
  };

  const close = async (): Promise<void> => {
    await cache.close();
  };

  return {
    processFeature,
    close,
  };
}

async function batchLoadElevations(
  geohashes: string[],
  elevationServerURL: string,
  cache: PostgresCache<number | null>,
): Promise<(number | null)[]> {
  const results: (number | null)[] = new Array(geohashes.length);
  const uncachedIndices: number[] = [];
  const uncachedCoordinates: number[][] = [];

  // Batch fetch from cache
  const cachedElevations = await cache.getMany(geohashes);

  // Identify uncached coordinates
  for (let i = 0; i < geohashes.length; i++) {
    const cachedElevation = cachedElevations[i];
    if (cachedElevation !== undefined) {
      results[i] = cachedElevation;
    } else {
      uncachedIndices.push(i);
      const decoded = geohash.decode(geohashes[i]);
      uncachedCoordinates.push([decoded.latitude, decoded.longitude]);
    }
  }

  // If all coordinates were cached, return results
  if (uncachedCoordinates.length === 0) {
    return results;
  }

  // Fetch elevations for uncached coordinates
  const response = await fetch(elevationServerURL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(uncachedCoordinates),
  });

  if (!response.ok) {
    throw new Error("Failed status code: " + response.status);
  }

  const fetchedElevations: (number | null)[] = await response.json();

  if (uncachedCoordinates.length !== fetchedElevations.length) {
    throw new Error(
      "Number of uncached coordinates (" +
        uncachedCoordinates.length +
        ") is different than number of fetched elevations (" +
        fetchedElevations.length +
        ")",
    );
  }

  // Cache fetched elevations
  const cacheEntries: Array<{ key: string; value: number | null }> = [];

  for (let i = 0; i < uncachedIndices.length; i++) {
    const originalIndex = uncachedIndices[i];
    const elevation = fetchedElevations[i];
    const geohash = geohashes[originalIndex];

    cacheEntries.push({ key: geohash, value: elevation });
    results[originalIndex] = elevation;
  }

  // Batch cache new elevations
  if (cacheEntries.length > 0) {
    await cache.setMany(cacheEntries);
  }

  return results;
}

function getCoordinates(feature: RunFeature | LiftFeature) {
  let coordinates: number[][];
  const geometryType = feature.geometry.type;
  switch (geometryType) {
    case "LineString":
      coordinates = feature.geometry.coordinates;
      break;
    case "MultiLineString":
      coordinates = feature.geometry.coordinates.flat();
      break;
    case "Polygon":
      coordinates = feature.geometry.coordinates.flat();
      break;
    default:
      const exhaustiveCheck: never = geometryType;
      throw "Geometry type " + exhaustiveCheck + " not implemented";
  }

  // Remove elevation in case it was already added to this point
  return coordinates.map((coordinate) => [coordinate[0], coordinate[1]]);
}

function addElevations(
  feature: RunFeature | LiftFeature,
  elevations: number[],
) {
  let i = 0;
  const geometryType = feature.geometry.type;
  switch (geometryType) {
    case "LineString":
      return feature.geometry.coordinates.forEach((coords) => {
        addElevationToCoords(coords, elevations[i]);
        i++;
      });
    case "MultiLineString":
      return feature.geometry.coordinates.forEach((coordsSet) => {
        coordsSet.forEach((coords) => {
          addElevationToCoords(coords, elevations[i]);
          i++;
        });
      });
    case "Polygon":
      return feature.geometry.coordinates.forEach((coordsSet) => {
        coordsSet.forEach((coords) => {
          addElevationToCoords(coords, elevations[i]);
          i++;
        });
      });
    default:
      const exhaustiveCheck: never = geometryType;
      throw "Geometry type " + exhaustiveCheck + " not implemented";
  }
}

function addElevationToCoords(coords: number[], elevation: number) {
  if (coords.length === 3) {
    // The elevation was already added to this point (this can happen with polygons where the first and last coordinates are the same object in memory)
    return;
  }

  coords.push(elevation);
}
