import { assert } from "console";
import * as path from "path";

export type GeocodingServerType = "photon" | "geocode-api";

export type GeocodingServerConfig = {
  url: string;
  type?: GeocodingServerType;
  // How long to cache geocoding results in milliseconds
  cacheTTL: number;
};

export type SnowCoverFetchPolicy = "full" | "incremental" | "none";

export type SnowCoverConfig = {
  fetchPolicy: SnowCoverFetchPolicy;
};

export type RacemapElevationServerConfig = {
  type: "racemap";
  url: string;
  batchSize: number;
};

export type TileserverGLElevationServerConfig = {
  type: "tileserver-gl";
  url: string;
  zoom: number[];
  batchSize: number;
};

export type TileElevationServerConfig = {
  type: "tile";
  url: string;
  zoom: number[];
  tileSize: number;
  tileCacheDir: string;
  tileCacheMaxTiles: number;
  tileConcurrency: number;
  batchSize: number;
};

export type ElevationServerConfig =
  | RacemapElevationServerConfig
  | TileserverGLElevationServerConfig
  | TileElevationServerConfig;

export type TilesConfig = { mbTilesPath: string; tilesDir: string };

export type PostgresConfig = {
  host: string;
  port: number;
  cacheDatabase: string;
  user: string;
  password?: string;
  maxConnections: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  tablePrefix: string;
};

export interface Config {
  elevationServer: ElevationServerConfig | null;
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
  // Tiles generation configuration
  tiles: TilesConfig | null;
  // PostgreSQL cache configuration
  postgresCache: PostgresConfig;
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
  if (
    snowCoverFetchPolicy &&
    !["full", "incremental", "none"].includes(snowCoverFetchPolicy)
  ) {
    throw new Error(
      `Invalid SNOW_COVER_FETCH_POLICY: ${snowCoverFetchPolicy}. Must be one of: full, incremental, none`,
    );
  }

  const elevationServerURL = process.env["ELEVATION_SERVER_URL"] || null;
  const outputDir = process.env["OUTPUT_DIR"] ?? "data";

  return {
    elevationServer: elevationServerURL
      ? buildElevationServerConfig(elevationServerURL)
      : null,
    geocodingServer:
      process.env.GEOCODING_SERVER_URL !== undefined
        ? {
            url: process.env.GEOCODING_SERVER_URL,
            type:
              (process.env.GEOCODING_SERVER_TYPE as GeocodingServerType) ||
              "photon",
            cacheTTL:
              geocodingCacheTTL !== undefined
                ? Number.parseInt(geocodingCacheTTL)
                : 1000 * 60 * 60 * 24 * 365, // 1 year
          }
        : null,
    bbox: bbox as GeoJSON.BBox,
    workingDir: workingDir,
    outputDir: outputDir,
    snowCover:
      process.env.ENABLE_SNOW_COVER === "1"
        ? {
            fetchPolicy:
              (snowCoverFetchPolicy as SnowCoverFetchPolicy) ?? "full",
          }
        : null,
    tiles:
      process.env.GENERATE_TILES === "1"
        ? {
            mbTilesPath: path.join(outputDir, "openskimap.mbtiles"),
            tilesDir: path.join(outputDir, "openskimap"),
          }
        : null,
    postgresCache: getPostgresConfig(),
  };
}

const DEFAULT_ELEVATION_ZOOM = [12];
const DEFAULT_ELEVATION_BATCH_SIZE = 10000;

function parseZoom(): number[] {
  const raw = process.env["ELEVATION_SERVER_ZOOM"];
  if (!raw) return DEFAULT_ELEVATION_ZOOM;
  return raw.split(",").map((z) => parseInt(z.trim()));
}

function parseBatchSize(): number {
  const raw = process.env["ELEVATION_SERVER_BATCH_SIZE"];
  return raw ? parseInt(raw) : DEFAULT_ELEVATION_BATCH_SIZE;
}

function buildElevationServerConfig(url: string): ElevationServerConfig {
  const type = (process.env["ELEVATION_SERVER_TYPE"] ?? "racemap") as
    | "racemap"
    | "tileserver-gl"
    | "tile";

  const batchSize = parseBatchSize();

  switch (type) {
    case "racemap":
      return { type, url, batchSize };
    case "tileserver-gl":
      return { type, url, zoom: parseZoom(), batchSize };
    case "tile":
      return {
        type,
        url,
        zoom: parseZoom(),
        tileSize: process.env["ELEVATION_TILE_SIZE"]
          ? parseInt(process.env["ELEVATION_TILE_SIZE"])
          : 512,
        tileCacheDir:
          process.env["ELEVATION_TILE_CACHE_DIR"] ?? "data/tile-cache",
        tileCacheMaxTiles: process.env["ELEVATION_TILE_CACHE_MAX_TILES"]
          ? parseInt(process.env["ELEVATION_TILE_CACHE_MAX_TILES"])
          : 100000,
        tileConcurrency: process.env["ELEVATION_TILE_CONCURRENCY"]
          ? parseInt(process.env["ELEVATION_TILE_CONCURRENCY"])
          : 4,
        batchSize,
      };
    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unknown elevation server type: ${exhaustiveCheck}`);
    }
  }
}

function getPostgresConfig(): PostgresConfig {
  return {
    host: "localhost",
    port: 5432,
    cacheDatabase: "openskidata_cache",
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD,
    maxConnections: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    tablePrefix: "",
  };
}

export function getPostgresTestConfig(): PostgresConfig {
  const testId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  return {
    host: "localhost",
    port: 5432,
    cacheDatabase: "openskidata_test",
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD,
    maxConnections: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    tablePrefix: testId,
  };
}
