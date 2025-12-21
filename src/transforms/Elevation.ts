import DataLoader from "dataloader";
import * as geohash from "ngeohash";
import {
  extractPointsForElevationProfile,
  FeatureType,
  LiftFeature,
  RunFeature,
} from "openskidata-format";
import { ElevationServerConfig, ElevationServerType, PostgresConfig } from "../Config";
import { PostgresCache } from "../utils/PostgresCache";

const elevationProfileResolution = 25;
const ELEVATION_CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
const DEFAULT_TILESERVER_ZOOM = [12];
const ERROR_LOG_THROTTLE_MS = 60000; // Log unique errors at most once per minute

type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

class ThrottledLogger {
  private lastLoggedErrors: Map<string, number> = new Map();

  log(errorKey: string, logFn: () => void): void {
    const now = Date.now();
    const lastLogged = this.lastLoggedErrors.get(errorKey);

    if (!lastLogged || now - lastLogged > ERROR_LOG_THROTTLE_MS) {
      logFn();
      this.lastLoggedErrors.set(errorKey, now);
    }
  }
}

const throttledLogger = new ThrottledLogger();

export interface ElevationProcessor {
  processFeature: (
    feature: RunFeature | LiftFeature,
  ) => Promise<RunFeature | LiftFeature>;
  close: () => Promise<void>;
}

export async function createElevationProcessor(
  elevationServerConfig: ElevationServerConfig,
  postgresConfig: PostgresConfig,
): Promise<ElevationProcessor> {
  const cache = new PostgresCache<number | null>(
    "elevation",
    postgresConfig,
    ELEVATION_CACHE_TTL_MS,
    { valueType: "REAL" },
  );
  await cache.initialize();

  const elevationLoader = new DataLoader<string, number | null>(
    async (geohashes: readonly string[]) => {
      return await batchLoadElevations(
        Array.from(geohashes),
        elevationServerConfig,
        cache,
      );
    },
    {
      batch: true,
      // Note: a 10k batch size causes some 413 errors with Tileserver GL
      maxBatchSize: 1000,
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
      const allCoordinates = Array.from(coordinates).concat(
        elevationProfileCoordinates,
      );
      const geohashes = allCoordinates.map(([lng, lat]) =>
        geohash.encode(lat, lng, 10), // 10: +-1m accuracy
      );

      // Load elevations using DataLoader
      const elevationResults = await Promise.all(
        geohashes.map((hash) => elevationLoader.load(hash)),
      )

      // Round elevations, and fail if any are nulls
      elevations = elevationResults.map((elevation) => {
        if (elevation === null) {
          throw new Error("No elevation data available");
        }
        return roundElevation(elevation);
      }) as number[];
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
  elevationServerConfig: ElevationServerConfig,
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
  const fetchedElevations: Result<number | null, string>[] = await fetchElevationsFromServer(
    uncachedCoordinates,
    elevationServerConfig,
  );

  if (uncachedCoordinates.length !== fetchedElevations.length) {
    throw new Error(
      "Number of uncached coordinates (" +
        uncachedCoordinates.length +
        ") is different than number of fetched elevations (" +
        fetchedElevations.length +
        ")",
    );
  }

  // Cache only successful results
  const cacheEntries: Array<{ key: string; value: number | null }> = [];
  let errorCount = 0;

  for (let i = 0; i < uncachedIndices.length; i++) {
    const originalIndex = uncachedIndices[i];
    const result = fetchedElevations[i];
    const geohash = geohashes[originalIndex];

    if (result.ok) {
      // Cache successful results (including null for "no data available")
      cacheEntries.push({ key: geohash, value: result.value });
      results[originalIndex] = result.value;
    } else {
      // Don't cache errors, return null for this request
      errorCount++;
      throttledLogger.log(result.error, () => {
        console.warn(`Elevation fetch error: ${result.error}`);
      });
      results[originalIndex] = null;
    }
  }

  // Log summary if there were errors
  if (errorCount > 0) {
    throttledLogger.log('elevation-error-summary', () => {
      console.warn(`Failed to fetch elevation for ${errorCount} of ${fetchedElevations.length} coordinates`);
    });
  }

  // Batch cache new elevations
  if (cacheEntries.length > 0) {
    await cache.setMany(cacheEntries);
  }

  return results;
}

async function fetchElevationsFromServer(
  coordinates: number[][],
  elevationServerConfig: ElevationServerConfig,
): Promise<Result<number | null, string>[]> {
  switch (elevationServerConfig.type) {
    case 'racemap':
      const racemapResults = await fetchElevationsFromRacemap(coordinates, elevationServerConfig.url);
      return racemapResults.map(elevation => ({ ok: true, value: elevation }));
    case 'tileserver-gl':
      return await fetchElevationsFromTileserverGL(coordinates, elevationServerConfig.url, elevationServerConfig.zoom ?? DEFAULT_TILESERVER_ZOOM);
    default:
      const exhaustiveCheck: never = elevationServerConfig.type;
      throw new Error(`Unknown elevation server type: ${exhaustiveCheck}`);
  }
}

async function fetchElevationsFromRacemap(
  coordinates: number[][],
  elevationServerURL: string,
): Promise<(number | null)[]> {
  const response = await fetch(elevationServerURL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(coordinates),
  });

  if (!response.ok) {
    throw new Error("Failed status code: " + response.status);
  }

  return await response.json();
}

async function fetchElevationsBatchFromTileserverGLAtZoom(
  coordinates: number[][],
  batchEndpointUrl: string,
  zoom: number,
): Promise<Result<(number | null)[], string>> {
  // Batch endpoint URL format: https://example.com/data/{id}/elevation
  try {
    // Convert coordinates from [lat, lng] to {lon, lat, z} format
    const points = coordinates.map(([lat, lng]) => ({
      lon: lng,
      lat: lat,
      z: zoom,
    }));

    const response = await fetch(batchEndpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'openskidata-processor/1.0.0 (+https://github.com/russellporter/openskidata-processor)',
      },
      body: JSON.stringify({ points }),
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} at zoom ${zoom}` };
    }

    const elevations = await response.json();

    // Response should be an array of elevations (or null) in the same order
    if (!Array.isArray(elevations) || elevations.length !== coordinates.length) {
      return { ok: false, error: `Invalid batch response: expected array of ${coordinates.length} elevations` };
    }

    return { ok: true, value: elevations };
  } catch (error) {
    return { ok: false, error: `Fetch error at zoom ${zoom}: ${error}` };
  }
}

async function fetchElevationsFromTileserverGL(
  coordinates: number[][],
  batchEndpointUrl: string,
  zooms: number[],
): Promise<Result<number | null, string>[]> {
  // Initialize results array with nulls
  const results: Result<number | null, string>[] = coordinates.map(() => ({
    ok: true,
    value: null,
  }));

  // Track which coordinates still need data
  let coordinatesNeedingData: Array<{ index: number; coords: number[] }> =
    coordinates.map((coords, index) => ({ index, coords }));

  // Try each zoom level in order, one request at a time
  for (const zoom of zooms) {
    if (coordinatesNeedingData.length === 0) {
      break; // All coordinates have data
    }

    // Batch fetch for all coordinates that still need data
    const coordsToFetch = coordinatesNeedingData.map((item) => item.coords);
    const batchResult = await fetchElevationsBatchFromTileserverGLAtZoom(
      coordsToFetch,
      batchEndpointUrl,
      zoom,
    );

    // If the batch request failed, mark all remaining coordinates as errors
    if (!batchResult.ok) {
      for (const { index } of coordinatesNeedingData) {
        results[index] = { ok: false, error: batchResult.error };
      }
      return results;
    }

    // Process batch results
    const newCoordinatesNeedingData: Array<{ index: number; coords: number[] }> = [];

    for (let i = 0; i < coordinatesNeedingData.length; i++) {
      const { index } = coordinatesNeedingData[i];
      const elevation = batchResult.value[i];

      if (elevation !== null) {
        // Found data for this coordinate
        results[index] = { ok: true, value: elevation };
      } else {
        // No data at this zoom level, will try next zoom
        newCoordinatesNeedingData.push(coordinatesNeedingData[i]);
      }
    }

    coordinatesNeedingData = newCoordinatesNeedingData;
  }

  // Any remaining coordinates without data stay as null (ok: true, value: null)
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

function roundElevation(elevation: number): number {
  return Math.round(elevation * 10) / 10;
}

function addElevationToCoords(coords: number[], elevation: number) {
  if (coords.length === 3) {
    // The elevation was already added to this point (this can happen with polygons where the first and last coordinates are the same object in memory)
    return;
  }

  coords.push(elevation);
}
