import { Activity, Status } from "openskidata-format";

// A ski area from Skimap.org
export interface InputSkiMapOrgSkiAreaProperties {
  id: string;
  name?: string;
  scalerank: number;
  status: Status | null;
  activities: Activity[];
  official_website: string | null;
}

// A ski area from OpenStreetMap
export interface InputOpenStreetMapSkiAreaProperties {
  [key: string]: string | undefined;

  id: string;

  name?: string;
  website?: string;

  landuse?: string;
  "disused:landuse"?: string;
  "abandoned:landuse"?: string;
  "proposed:landuse"?: string;
  "planned:landuse"?: string;
  "construction:landuse"?: string;

  sport?: string;
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

export type InputSkiMapOrgSkiAreaFeature = GeoJSON.Feature<
  GeoJSON.Point,
  InputSkiMapOrgSkiAreaProperties
>;

export type InputOpenStreetMapSkiAreaFeature = GeoJSON.Feature<
  GeoJSON.Point | GeoJSON.Polygon | GeoJSON.MultiPolygon,
  InputOpenStreetMapSkiAreaProperties
>;

export type MapboxGLSkiAreaFeature = GeoJSON.Feature<
  GeoJSON.Point | GeoJSON.MultiPoint,
  MapboxGLSkiAreaProperties
>;
