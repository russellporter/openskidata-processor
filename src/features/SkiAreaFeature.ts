import { SkiAreaActivity, Status } from "openskidata-format";
import OSMGeoJSONProperties from "./OSMGeoJSONProperties";

// A ski area from Skimap.org
export interface InputSkiMapOrgSkiAreaProperties {
  id: string;
  name?: string;
  scalerank: number;
  status: Status | null;
  activities: SkiAreaActivity[];
  official_website: string | null;
}

// A ski area from OpenStreetMap
export interface OSMSkiAreaTags {
  [key: string]: string | undefined;

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
  /**
   * Ski pass membership, for filtering. Holds each pass the ski area is on ("epic") and each
   * tier of it the ski area is covered by ("epic:local", or "epic:" for the pass's standard
   * tier).
   *
   * The pass and its standard tier are kept distinct because they filter differently: a ski area
   * covered only by Epic Local is on the Epic Pass, but not on the unrestricted Epic tier.
   *
   * Semicolon separated, and also delimited at both ends, so that a whole entry can be matched
   * with a substring test: ";ikon;" matches only the Ikon Pass, where "ikon" would also match
   * "ikon-2-day" and "ikon-midwest". Absent when the ski area is on no pass.
   */
  ski_passes?: string;
}

export type InputSkiMapOrgSkiAreaFeature = GeoJSON.Feature<
  GeoJSON.Point,
  InputSkiMapOrgSkiAreaProperties
>;

export type InputOpenStreetMapSkiAreaFeature = GeoJSON.Feature<
  GeoJSON.Point | GeoJSON.Polygon | GeoJSON.MultiPolygon,
  OSMGeoJSONProperties<OSMSkiAreaTags>
>;

export type MapboxGLSkiAreaFeature = GeoJSON.Feature<
  GeoJSON.Point | GeoJSON.MultiPoint,
  MapboxGLSkiAreaProperties
>;

export type OSMRelationMember = {
  type: string;
  ref: number;
  role: string;
};

export type OSMSkiAreaSite = {
  type: string;
  id: number;
  members: OSMRelationMember[];
  tags: OSMSkiAreaSiteTags;
};

export type OSMSkiAreaSiteTags = OSMSkiAreaTags;
