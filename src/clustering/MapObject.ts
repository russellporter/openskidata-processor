import {
  FeatureType,
  LiftGeometry,
  LiftType,
  Place,
  RunDifficulty,
  SkiAreaActivity,
  SkiAreaProperties,
  SourceType,
  SpotGeometry,
  SpotProperties,
} from "openskidata-format";
import { VIIRSPixel } from "../utils/VIIRSPixelExtractor";

export type MapObject = RunObject | LiftObject | SkiAreaObject | SpotObject;
export type RunObject = DraftRun & { _id: string };
export type LiftObject = DraftLift & { _id: string };
export type SkiAreaObject = DraftSkiArea & { _id: string };
export type SpotObject = DraftSpot & { _id: string };

export type DraftMapObject = DraftRun | DraftLift | DraftSkiArea | DraftSpot;

export interface DraftRun extends BaseDraftMapObject {
  type: FeatureType.Run;
  geometry: RunGeometry;
  isBasisForNewSkiArea: boolean;
  isInSkiAreaPolygon: boolean;
  isInSkiAreaSite: boolean;
  difficulty: RunDifficulty | null;
  snowmaking: boolean | null;
  snowfarming: boolean | null;
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
  type: FeatureType.Lift;
  geometry: LiftGeometry;
  liftType: LiftType;
  isInSkiAreaPolygon: boolean;
  isInSkiAreaSite: boolean;
  stationIds: string[];
  properties: {
    places: Place[];
  };
}

export interface DraftSpot extends BaseDraftMapObject {
  type: FeatureType.Spot;
  geometry: SpotGeometry;
  isInSkiAreaPolygon: boolean;
  isInSkiAreaSite: boolean;
  properties: SpotProperties;
}

export interface DraftSkiArea extends BaseDraftMapObject {
  id: string;
  type: FeatureType.SkiArea;
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
