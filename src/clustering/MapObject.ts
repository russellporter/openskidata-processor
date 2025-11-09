import {
  LiftGeometry,
  LiftType,
  Place,
  RunDifficulty,
  SkiAreaActivity,
  SkiAreaProperties,
  SkiAreaSummaryFeature,
  SnowCoverHistory,
  SourceType,
} from "openskidata-format";
import { VIIRSPixel } from "../utils/VIIRSPixelExtractor";

export type MapObject = RunObject | LiftObject | SkiAreaObject;
export type RunObject = DraftRun & { _id: string };
export type LiftObject = DraftLift & { _id: string };
export type SkiAreaObject = DraftSkiArea & { _id: string };

export type DraftMapObject = DraftRun | DraftLift | DraftSkiArea;

export interface DraftRun extends BaseDraftMapObject {
  type: MapObjectType.Run;
  geometry: RunGeometry;
  geometryWithElevations: RunGeometry;
  isBasisForNewSkiArea: boolean;
  isInSkiAreaPolygon: boolean;
  isInSkiAreaSite: boolean;
  difficulty: RunDifficulty | null;
  viirsPixels: VIIRSPixel[];
  properties: {
    places: Place[];
  };
}

export type RunGeometry =
  | GeoJSON.LineString
  | GeoJSON.Polygon
  | GeoJSON.MultiLineString;

export interface DraftLift extends BaseDraftMapObject {
  type: MapObjectType.Lift;
  geometry: LiftGeometry;
  geometryWithElevations: LiftGeometry;
  liftType: LiftType;
  isInSkiAreaPolygon: boolean;
  isInSkiAreaSite: boolean;
  properties: {
    places: Place[];
  };
}

export interface DraftSkiArea extends BaseDraftMapObject {
  id: string;
  type: MapObjectType.SkiArea;
  geometry: SkiAreaGeometry;
  source: SourceType;
  isPolygon: boolean;
  properties: SkiAreaProperties;
}

export type SkiAreaGeometry =
  | GeoJSON.Point
  | GeoJSON.Polygon
  | GeoJSON.MultiPolygon;

interface BaseDraftMapObject {
  _key: string;
  skiAreas: string[];
  activities: SkiAreaActivity[];
}

export enum MapObjectType {
  SkiArea = "SKI_AREA",
  Lift = "LIFT",
  Run = "RUN",
}

export interface MapFeatureProperties {
  id: string;
  // Run
  "piste:type"?:
    | "downhill"
    | "nordic"
    | "hike"
    | "skitour"
    | "sled"
    | "sleigh"
    | "snow_park"
    | string;
  "piste:grooming"?: string;
}

export type MapObjectGeometry =
  | GeoJSON.LineString
  | GeoJSON.Polygon
  | GeoJSON.MultiLineString
  | GeoJSON.Point;

export type MapFeature<Geometry extends GeoJSON.Geometry = MapObjectGeometry> =
  GeoJSON.Feature<Geometry, MapFeatureProperties>;

interface AugmentedMapFeatureProperties extends MapFeatureProperties {
  skiAreas: SkiAreaSummaryFeature[];
  places?: Place[];
  snowCoverHistory?: SnowCoverHistory;
}

export type AugmentedMapFeature = GeoJSON.Feature<
  MapObjectGeometry,
  AugmentedMapFeatureProperties
>;
