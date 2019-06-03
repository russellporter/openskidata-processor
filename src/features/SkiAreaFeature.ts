import { Activity, Status } from "openskidata-format";

export interface InputSkiAreaProperties {
  id: string;
  name?: string;
  scalerank: number;
  status: Status | null;
  activities: Activity[];
}

export interface MapboxGLSkiAreaProperties {
  id: string;
  name: string | null;
  has_downhill?: true;
  has_nordic?: true;
  status: Status | null;
}

export type InputSkiAreaFeature = GeoJSON.Feature<
  GeoJSON.Point,
  InputSkiAreaProperties
>;

export type MapboxGLSkiAreaFeature = GeoJSON.Feature<
  GeoJSON.Point,
  MapboxGLSkiAreaProperties
>;
