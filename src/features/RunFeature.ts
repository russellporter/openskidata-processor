import {
  ColorName,
  RunDifficulty,
  RunGeometry,
  RunGrooming,
  RunProperties,
} from "openskidata-format";
import OSMGeoJSONProperties from "./OSMGeoJSONProperties";

export type OSMRunTags = {
  [key: string]: string | undefined;

  "piste:type"?: string;
  "piste:difficulty"?: string;
  "piste:grooming"?: string;
  "piste:grooming:priority"?: string;
  "piste:status"?: string;
  "piste:abandoned"?: string;
  gladed?: string;
  patrolled?: string;
  route?: string;

  name?: string;
  "piste:name"?: string;

  description?: string;
  "piste:description"?: string;

  lit?: string;
  "piste:lit"?: string;

  ref?: string;
  "piste:ref"?: string;

  oneway?: string;
  "piste:oneway"?: string;
};

export type InputRunGeometry =
  | GeoJSON.Point
  | GeoJSON.LineString
  | GeoJSON.Polygon
  | GeoJSON.MultiLineString
  | GeoJSON.MultiPolygon;

export type InputRunFeature = GeoJSON.Feature<
  InputRunGeometry,
  OSMGeoJSONProperties<OSMRunTags>
>;

export type MapboxGLRunProperties = {
  id: string;
  name: string | null;
  difficulty: RunDifficulty | null;
  skiAreas: string[];
  oneway: boolean | null;
  lit: boolean | null;
  gladed: boolean | null;
  color: string;
  colorName: ColorName | null;
  grooming: RunGrooming | null;
  // Run uses. Multiple uses are supported by rendering parallel lines for each use.
  // The value is the offset of the line from the baseline. The average of all offsets is always 0.
  downhill?: number;
  nordic?: number;
  skitour?: number;
  other?: number;
};

export type MapboxGLRunFeature = GeoJSON.Feature<
  RunGeometry,
  MapboxGLRunProperties
>;

export type RunLineFeature = GeoJSON.Feature<GeoJSON.LineString, RunProperties>;

export enum MapboxGLRunUse {
  Downhill = "downhill",
  Nordic = "nordic",
  Skitour = "skitour",
  Other = "other",
}
