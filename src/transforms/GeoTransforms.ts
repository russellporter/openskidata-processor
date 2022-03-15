import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import buffer from "@turf/buffer";
import centroid from "@turf/centroid";
import {
  featureCollection,
  lineString,
  multiPoint,
  point,
  polygon,
} from "@turf/helpers";
import nearestPointOnLine, {
  NearestPointOnLine,
} from "@turf/nearest-point-on-line";

export function bufferGeometry(
  geometry:
    | GeoJSON.Point
    | GeoJSON.MultiPoint
    | GeoJSON.LineString
    | GeoJSON.MultiLineString
    | GeoJSON.Polygon
    | GeoJSON.MultiPolygon,
  radius: number
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  try {
    const bufferArea = buffer(geometry, radius, {
      steps: 16,
    }).geometry;
    if (!bufferArea) {
      console.log(
        "Failed buffering geometry. This can happen if the geometry is invalid."
      );
      return null;
    }

    return bufferArea;
  } catch (exception) {
    console.log(
      "Failed buffering geometry. This can happen if the geometry is invalid.",
      exception
    );
    return null;
  }
}

export function bufferFeatureCollection(
  featureCollection: GeoJSON.FeatureCollection,
  radius: number
) {
  try {
    const bufferArea = buffer(featureCollection, radius, {
      steps: 16,
    });
    if (!bufferArea) {
      console.log(
        "Failed buffering geometry. This can happen if the geometry is invalid."
      );
      return null;
    }

    return bufferArea;
  } catch (exception) {
    console.log(
      "Failed buffering geometry. This can happen if the geometry is invalid.",
      exception
    );
    return null;
  }
}

export function centralPointsInFeature(
  geojson: GeoJSON.Point | GeoJSON.Polygon
): GeoJSON.Point;

export function centralPointsInFeature(
  geojson: GeoJSON.MultiPolygon
): GeoJSON.MultiPoint;

export function centralPointsInFeature(
  geojson: GeoJSON.Point | GeoJSON.Polygon | GeoJSON.MultiPolygon
): GeoJSON.Point | GeoJSON.MultiPoint;

/**
 * Finds a central point that is guaranteed to be the given polygon.
 */
export function centralPointsInFeature(
  geojson: GeoJSON.Point | GeoJSON.Polygon | GeoJSON.MultiPolygon
): GeoJSON.Point | GeoJSON.MultiPoint {
  if (geojson.type === "Point") {
    return geojson;
  }

  switch (geojson.type) {
    case "Polygon":
      const center = centroid(geojson).geometry;

      if (booleanPointInPolygon(center, geojson)) {
        return center;
      }

      return geojson.coordinates
        .map<GeoJSON.LineString>((coords) => lineString(coords).geometry)
        .reduce(
          (
            nearestPointSoFar: NearestPointOnLine | null,
            line: GeoJSON.LineString
          ) => {
            const nearestPointOnThisLine = nearestPointOnLine(line, center);
            const distanceToNearestPointSoFar =
              nearestPointSoFar?.properties?.dist;
            const distanceToNearestPointOnThisLine =
              nearestPointOnThisLine.properties.dist;
            if (
              !nearestPointSoFar ||
              !distanceToNearestPointOnThisLine ||
              !distanceToNearestPointSoFar
            ) {
              return nearestPointOnThisLine;
            }

            return distanceToNearestPointSoFar <
              distanceToNearestPointOnThisLine
              ? nearestPointSoFar
              : nearestPointOnThisLine;
          },
          null
        )!.geometry;
    case "MultiPolygon":
      return multiPoint(
        geojson.coordinates
          .map((coords) => polygon(coords))
          .map(
            (polygon) => centralPointsInFeature(polygon.geometry).coordinates
          )
      ).geometry;
  }
}

export function getPoints(
  positions: GeoJSON.Position[]
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return featureCollection(positions.map((position) => point(position)));
}

export function getPositions(
  geojson:
    | GeoJSON.Point
    | GeoJSON.MultiPoint
    | GeoJSON.LineString
    | GeoJSON.MultiLineString
    | GeoJSON.Polygon
    | GeoJSON.MultiPolygon
): GeoJSON.Position[] {
  switch (geojson.type) {
    case "Point":
      return [geojson.coordinates];
    case "MultiPoint":
    case "LineString":
      return geojson.coordinates;
    case "MultiLineString":
    case "Polygon":
      return geojson.coordinates.flat();
    case "MultiPolygon":
      return geojson.coordinates.flat(2);
  }
}
