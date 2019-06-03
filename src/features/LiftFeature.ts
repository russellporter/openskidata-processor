import { LiftGeometry, Status } from "openskidata-format";

export type InputLiftProperties = {
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

  name?: string;
  oneway?: string;
  ref?: string;
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
};

export type MapboxGLLiftProperties = {
  // Contains a field per ski area - format: skiArea-{id}: true
  [key: string]: any;

  id: string;
  name_and_type: string | null;
  color: string;
  status: Status;
};

export type InputLiftFeature = GeoJSON.Feature<
  LiftGeometry,
  InputLiftProperties
>;
export type MapboxGLLiftFeature = GeoJSON.Feature<
  LiftGeometry,
  MapboxGLLiftProperties
>;
