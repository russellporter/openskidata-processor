import { aql, AqlQuery } from "arangojs/aql";

export function isArangoInvalidGeometryError(error: any): boolean {
  let invalidGeometryMessages = [
    "Polygon is not valid",
    "Invalid loop in polygon",
    "Subsequent loop not a hole in polygon",
    "Loop not closed",
    "Invalid GeoJSON Geometry Object",
  ];
  let errorMessage = error.response?.parsedBody?.errorMessage;
  if (!errorMessage) {
    return false;
  }
  return invalidGeometryMessages.some((invalidMessage) =>
    errorMessage.includes(invalidMessage),
  );
}

export function arangoGeometry(
  object: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): AqlQuery {
  switch (object.type) {
    case "Polygon":
      return aql`GEO_POLYGON(${object.coordinates})`;
    case "MultiPolygon":
      return aql`GEO_MULTIPOLYGON(${object.coordinates})`;
  }
}
