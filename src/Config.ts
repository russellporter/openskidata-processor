import { assert } from "console";

export type GeocodingServerConfig = {
  url: string;
  // Used for the disk cache. In memory cache ignores ttl.
  diskTTL: number;
  cacheDir: string;
  inMemoryCacheSize: number;
};

export interface Config {
  arangoDBURLForClustering: string | null;
  elevationServerURL: string | null;
  // Geocoder in https://github.com/komoot/photon format, disk cache TTL in milliseconds
  geocodingServer: GeocodingServerConfig | null;
  // GeoJSON format (https://geojson.org/geojson-spec.html#bounding-boxes)
  bbox: GeoJSON.BBox | null;
  outputDir: string;
}

export function configFromEnvironment(): Config {
  let bbox = null;
  if (process.env.BBOX) {
    bbox = JSON.parse(process.env.BBOX);
    assert(
      Array.isArray(bbox) &&
        bbox.length === 4 &&
        bbox.every((value) => typeof value === "number")
    );
  }
  const geocodingCacheTTL = process.env.GEOCODING_SERVER_URL_TTL;
  return {
    arangoDBURLForClustering: process.env["CLUSTERING_ARANGODB_URL"] || null,
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
    outputDir: process.env["OUTPUT_DIR"] ?? "data",
  };
}
