import { Activity, Status } from "openskidata-format";

export interface InputSkiAreaProperties {
  id: string;
  name?: string;
  scalerank: number;
  status: Status | null;
  activities: Activity[];
  official_website: string | null;
}

export interface MapboxGLSkiAreaProperties {
  id: string;
  name: string | null;
  has_downhill?: true;
  has_nordic?: true;
  status: Status | null;
  maxElevation: number | null;
  vertical: number | null;
  downhillDistance: number | null;
  nordicDistance: number | null;
}

export type InputSkiAreaFeature = GeoJSON.Feature<
  GeoJSON.Point,
  InputSkiAreaProperties
>;

export type MapboxGLSkiAreaFeature = GeoJSON.Feature<
  GeoJSON.Point,
  MapboxGLSkiAreaProperties
>;
