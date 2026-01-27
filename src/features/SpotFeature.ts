import OSMGeoJSONProperties from "./OSMGeoJSONProperties";

export type OSMSpotTags = {
  [key: string]: string | undefined;
  "piste:dismount"?: string;
  aerialway?: string;
  "aerialway:station"?: string;
  "aerialway:access"?: string;
  name?: string;
  amenity?: string;
  avalanche_transceiver?: string;
  man_made?: string;
};

export type InputSpotGeometry =
  | GeoJSON.Point
  | GeoJSON.Polygon
  | GeoJSON.MultiPolygon
  | GeoJSON.LineString;

export type InputSpotFeature = GeoJSON.Feature<
  InputSpotGeometry,
  OSMGeoJSONProperties<OSMSpotTags>
>;
