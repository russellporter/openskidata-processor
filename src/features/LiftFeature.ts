import { LiftGeometry, Status } from "openskidata-format";
import OSMGeoJSONProperties from "./OSMGeoJSONProperties";

export type OSMLiftTags = {
  [key: string]: string | undefined;

  aerialway?: string;
  "disused:aerialway"?: string;
  "abandoned:aerialway"?: string;
  "proposed:aerialway"?: string;
  "planned:aerialway"?: string;
  "construction:aerialway"?: string;

  railway?: string;
  "disused:railway"?: string;
  "abandoned:railway"?: string;
  "proposed:railway"?: string;
  "planned:railway"?: string;
  "construction:railway"?: string;

  "railway:traffic_mode"?: string;

  name?: string;
  oneway?: string;
  ref?: string;
  description?: string;
  foot?: string;
  access?: string;
  note?: string;
  passenger?: string;
  usage?: string;
  "aerialway:occupancy"?: string;
  "aerialway:capacity"?: string;
  "aerialway:duration"?: string;
  "aerialway:bubble"?: string;
  "aerialway:heating"?: string;
  "aerialway:bicycle"?: string;
  "aerialway:access"?: string;
  "aerialway:winter:access"?: string;
  "aerialway:summer:access"?: string;

  website?: string;
};

export type MapboxGLLiftProperties = {
  id: string;
  name_and_type: string | null;
  color: string;
  status: Status;
  skiAreas: string[];
};

export type InputLiftFeature = GeoJSON.Feature<
  LiftGeometry,
  OSMGeoJSONProperties<OSMLiftTags>
>;
export type MapboxGLLiftFeature = GeoJSON.Feature<
  LiftGeometry,
  MapboxGLLiftProperties
>;
