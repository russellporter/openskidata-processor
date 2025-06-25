import * as geohash from "ngeohash";
import {
  extractPointsForElevationProfile,
  FeatureType,
  LiftFeature,
  RunFeature,
} from "openskidata-format";
import { ElevationServerConfig } from "../Config";
import { SQLiteCache } from "../utils/SQLiteCache";

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
  const cache = new SQLiteCache<number>(
    elevationServerConfig.databasePath,
    ELEVATION_CACHE_TTL_MS,
  );
  await cache.initialize();

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
      elevations = await loadElevations(
        // Elevation service expects lat,lng order instead of lng,lat of GeoJSON
        Array.from(coordinates)
          .concat(elevationProfileCoordinates)
          .map(([lng, lat]) => [lat, lng]),
        elevationServerConfig.url,
        cache,
      );
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

async function loadElevations(
  coordinates: number[][],
  elevationServerURL: string,
  cache: SQLiteCache<number>,
): Promise<number[]> {
  const results: number[] = new Array(coordinates.length);
  const uncachedIndices: number[] = [];
  const uncachedCoordinates: number[][] = [];

  // Check cache for each coordinate using geohash precision 9
  for (let i = 0; i < coordinates.length; i++) {
    const [lat, lng] = coordinates[i];
    const cacheKey = geohash.encode(lat, lng, 9);
    const cachedElevation = await cache.get(cacheKey);

    if (cachedElevation !== null) {
      results[i] = cachedElevation;
    } else {
      uncachedIndices.push(i);
      uncachedCoordinates.push(coordinates[i]);
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

  // Check for nulls in fetched data
  if (
    fetchedElevations.some((elevation) => {
      return elevation === null;
    })
  ) {
    throw new Error("Elevation data contains nulls");
  }

  // Cache and assign fetched elevations
  for (let i = 0; i < uncachedIndices.length; i++) {
    const originalIndex = uncachedIndices[i];
    const elevation = fetchedElevations[i] as number;
    const [lat, lng] = coordinates[originalIndex];
    const cacheKey = geohash.encode(lat, lng, 9);

    // Cache the elevation for this coordinate
    await cache.set(cacheKey, elevation);
    results[originalIndex] = elevation;
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
