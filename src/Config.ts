import { assert } from "console";

export type GeocodingServerConfig = {
  url: string;
  // Used for the disk cache. In memory cache ignores ttl.
  diskTTL: number;
  cacheDir: string;
  inMemoryCacheSize: number;
};

export type SnowCoverFetchPolicy = 'full' | 'incremental' | 'none';

export type SnowCoverConfig = {
  cacheDir: string;
  fetchPolicy: SnowCoverFetchPolicy;
};

export interface Config {
  elevationServerURL: string | null;
  // Geocoder in https://github.com/komoot/photon format, disk cache TTL in milliseconds
  geocodingServer: GeocodingServerConfig | null;
  // GeoJSON format (https://geojson.org/geojson-spec.html#bounding-boxes)
  bbox: GeoJSON.BBox | null;
  // Directory used for downloads and storage of intermediate results
  workingDir: string;
  // Directory where the output files are written to
  outputDir: string;
  // Snow cover data integration
  snowCover: SnowCoverConfig | null;
}

export function configFromEnvironment(): Config {
  let bbox = null;
  if (process.env.BBOX) {
    bbox = JSON.parse(process.env.BBOX);
    assert(
      Array.isArray(bbox) &&
        bbox.length === 4 &&
        bbox.every((value) => typeof value === "number"),
    );
  }
  const geocodingCacheTTL = process.env.GEOCODING_SERVER_URL_TTL;
  const workingDir = process.env["WORKING_DIR"] ?? "data";
  
  // Validate snow cover fetch policy
  const snowCoverFetchPolicy = process.env.SNOW_COVER_FETCH_POLICY;
  if (snowCoverFetchPolicy && !['full', 'incremental', 'none'].includes(snowCoverFetchPolicy)) {
    throw new Error(`Invalid SNOW_COVER_FETCH_POLICY: ${snowCoverFetchPolicy}. Must be one of: full, incremental, none`);
  }
  
  return {
    elevationServerURL: process.env["ELEVATION_SERVER_URL"] || null,
    geocodingServer:
      process.env.GEOCODING_SERVER_URL !== undefined
        ? {
            url: process.env.GEOCODING_SERVER_URL,
            diskTTL:
              geocodingCacheTTL !== undefined
                ? Number.parseInt(geocodingCacheTTL)
                : 1000 * 60 * 60 * 24 * 365, // 1 year
            cacheDir: "cache",
            inMemoryCacheSize: 1000,
          }
        : null,
    bbox: bbox as GeoJSON.BBox,
    workingDir: workingDir,
    outputDir: process.env["OUTPUT_DIR"] ?? "data",
    snowCover:
      process.env.ENABLE_SNOW_COVER === '1'
        ? {
            cacheDir: process.env.SNOW_COVER_CACHE_DIR ?? `${workingDir}/snow-cover`,
            fetchPolicy: (snowCoverFetchPolicy as SnowCoverFetchPolicy) ?? 'full',
          }
        : null,
  };
}
