import { assert } from "console";

export interface Config {
  arangoDBURLForClustering: string | null;
  elevationServerURL: string | null;
  // GeoJSON format (https://geojson.org/geojson-spec.html#bounding-boxes)
  bbox: GeoJSON.BBox | null;
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
  return {
    arangoDBURLForClustering: process.env["CLUSTERING_ARANGODB_URL"] || null,
    elevationServerURL: process.env["ELEVATION_SERVER_URL"] || null,
    bbox: bbox as GeoJSON.BBox,
  };
}
