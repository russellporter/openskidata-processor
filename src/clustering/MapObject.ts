import {
  FeatureType,
  LiftGeometry,
  LiftProperties,
  LiftType,
  RunDifficulty,
  RunProperties,
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
  // IDs of the site=piste relations this object is a member of. Unlike `skiAreas`,
  // this is set once when the object is loaded and is never appended to during clustering.
  siteSkiAreas: string[];
  difficulty: RunDifficulty | null;
  snowmaking: boolean | null;
  snowfarming: boolean | null;
  viirsPixels: VIIRSPixel[];
  properties: RunProperties;
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
  siteSkiAreas: string[];
  stationIds: string[];
  properties: LiftProperties;
}

export interface DraftSpot extends BaseDraftMapObject {
  type: FeatureType.Spot;
  geometry: SpotGeometry;
  isInSkiAreaPolygon: boolean;
  isInSkiAreaSite: boolean;
  siteSkiAreas: string[];
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
