import {
  Activity,
  LiftGeometry,
  LiftType,
  RunDifficulty,
  SkiAreaProperties
} from "openskidata-format";

export type MapObject = DraftMapObject & { _id: string };
export type RunObject = DraftRun & { _id: string };
export type LiftObject = DraftLift & { _id: string };
export type SkiAreaObject = DraftSkiArea & { _id: string };

export type DraftMapObject = DraftRun | DraftLift | DraftSkiArea;

export interface DraftRun extends BaseDraftMapObject {
  type: MapObjectType.Run;
  geometry: RunGeometry;
  name: string | null;
  runAssignableToSkiArea: boolean;
  difficulty: RunDifficulty | null;
}

export type RunGeometry =
  | GeoJSON.LineString
  | GeoJSON.Polygon
  | GeoJSON.MultiLineString;

export interface DraftLift extends BaseDraftMapObject {
  type: MapObjectType.Lift;
  geometry: LiftGeometry;
  liftType: LiftType;
}

export interface DraftSkiArea extends BaseDraftMapObject {
  id: string;
  type: MapObjectType.SkiArea;
  geometry: SkiAreaGeometry;
  properties: SkiAreaProperties;
}

export type SkiAreaGeometry = GeoJSON.Point;

interface BaseDraftMapObject {
  _key: string;
  skiAreas: string[];
  activities: Activity[];
}

export enum MapObjectType {
  SkiArea = "SKI_AREA",
  Lift = "LIFT",
  Run = "RUN"
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

export type MapFeature<
  Geometry extends GeoJSON.Geometry = MapObjectGeometry
> = GeoJSON.Feature<Geometry, MapFeatureProperties>;

interface AugmentedMapFeatureProperties extends MapFeatureProperties {
  skiAreas: string[];
}

export type AugmentedMapFeature = GeoJSON.Feature<
  MapObjectGeometry,
  AugmentedMapFeatureProperties
>;
