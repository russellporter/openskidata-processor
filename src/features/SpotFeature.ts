import {
  SpotType,
  LiftStationPosition,
  DismountRequirement,
} from "openskidata-format";
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

export type MapboxGLSpotProperties = {
  id: string;
  spotType: SpotType;
  skiAreas: string[];

  // LiftStation properties
  name?: string | null;
  liftId?: string;
  position?: LiftStationPosition | null;
  entry?: boolean | null;
  exit?: boolean | null;

  // Crossing properties
  dismount?: DismountRequirement;
};

export type MapboxGLSpotFeature = GeoJSON.Feature<
  GeoJSON.Point,
  MapboxGLSpotProperties
>;
