import along from "@turf/along";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import booleanValid from "@turf/boolean-valid";
import centroid from "@turf/centroid";
import {
  featureCollection,
  lineString,
  multiPoint,
  point,
  polygon,
} from "@turf/helpers";
import length from "@turf/length";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import OSMGeoJSONProperties from "../features/OSMGeoJSONProperties";

export function centralPointsInFeature(
  geojson: GeoJSON.Point | GeoJSON.Polygon,
): GeoJSON.Point;

export function centralPointsInFeature(
  geojson: GeoJSON.MultiPolygon,
): GeoJSON.MultiPoint;

export function centralPointsInFeature(
  geojson: GeoJSON.Point | GeoJSON.Polygon | GeoJSON.MultiPolygon,
): GeoJSON.Point | GeoJSON.MultiPoint;

/**
 * Finds a central point that is guaranteed to be the given polygon.
 */
export function centralPointsInFeature(
  geojson: GeoJSON.Point | GeoJSON.Polygon | GeoJSON.MultiPolygon,
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
            nearestPointSoFar: GeoJSON.Feature<GeoJSON.Point> | null,
            line: GeoJSON.LineString,
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
          null,
        )!.geometry;
    case "MultiPolygon":
      return multiPoint(
        geojson.coordinates
          .map((coords) => polygon(coords))
          .map(
            (polygon) => centralPointsInFeature(polygon.geometry).coordinates,
          ),
      ).geometry;
  }
}

export function getPoints(
  positions: GeoJSON.Position[],
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
    | GeoJSON.MultiPolygon,
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

export function isValidGeometryInFeature(
  feature: GeoJSON.Feature<GeoJSON.Geometry, OSMGeoJSONProperties<{}>>,
): boolean {
  try {
    if (!booleanValid(feature.geometry)) {
      console.warn(
        `Invalid geometry found in feature: https://www.openstreetmap.org/${feature.properties.type}/${feature.properties.id}`,
      );
      return false;
    }
    return true;
  } catch (e) {
    console.warn(
      `Error thrown when validating feature: https://www.openstreetmap.org/${feature.properties.type}/${feature.properties.id} - ${e}`,
    );
    return false;
  }
}

/**
 * Extracts points along a line at regular intervals.
 * Always includes start and end points.
 */
function extractPointsFromLine(
  line: GeoJSON.LineString,
  intervalKm: number,
): GeoJSON.Position[] {
  const linePoints: GeoJSON.Position[] = [];
  const lineFeature = lineString(line.coordinates);
  const lineLength = length(lineFeature, { units: "kilometers" });

  // Always include start point
  linePoints.push(line.coordinates[0]);

  // Add points at intervals
  let distance = intervalKm;
  while (distance < lineLength) {
    const pt = along(lineFeature, distance, { units: "kilometers" });
    linePoints.push(pt.geometry.coordinates);
    distance += intervalKm;
  }

  // Always include end point (if not already added)
  const endPoint = line.coordinates[line.coordinates.length - 1];
  const lastPoint = linePoints[linePoints.length - 1];
  if (endPoint[0] !== lastPoint[0] || endPoint[1] !== lastPoint[1]) {
    linePoints.push(endPoint);
  }

  return linePoints;
}

/**
 * Extracts points along a geometry at regular intervals.
 * For LineString and MultiLineString: extracts points every intervalKm along the line, always including start and end points.
 * For Polygon: extracts points along the perimeter (outer ring) every intervalKm, always including the first point.
 * Returns deduplicated array of positions.
 */
export function extractPointsAlongGeometry(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString | GeoJSON.Polygon,
  intervalKm: number,
): GeoJSON.Position[] {
  const points: GeoJSON.Position[] = [];

  switch (geometry.type) {
    case "LineString":
      points.push(...extractPointsFromLine(geometry, intervalKm));
      break;
    case "MultiLineString":
      for (const coords of geometry.coordinates) {
        const line = lineString(coords).geometry;
        points.push(...extractPointsFromLine(line, intervalKm));
      }
      break;
    case "Polygon":
      // Extract points along the outer ring (perimeter)
      const outerRing = lineString(geometry.coordinates[0]).geometry;
      points.push(...extractPointsFromLine(outerRing, intervalKm));
      break;
  }

  // Deduplicate positions
  const uniquePoints = points.filter(
    (point, index, self) =>
      index === self.findIndex((p) => p[0] === point[0] && p[1] === point[1]),
  );

  return uniquePoints;
}
