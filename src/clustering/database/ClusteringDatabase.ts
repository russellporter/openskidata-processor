import { FeatureType, SkiAreaActivity, SourceType } from "openskidata-format";
import { SnowCoverConfig } from "../../Config";
import Geocoder from "../../transforms/Geocoder";
import { MapObject, MapObjectType, RunObject, SkiAreaObject } from "../MapObject";

export interface ClusteringDatabase {
  /**
   * Initialize the database connection and create necessary collections/tables
   */
  initialize(): Promise<void>;

  /**
   * Clean up and close database connection
   */
  close(): Promise<void>;

  /**
   * Save a map object to the database
   */
  saveObject(object: MapObject): Promise<void>;

  /**
   * Save multiple map objects in batch
   */
  saveObjects(objects: MapObject[]): Promise<void>;

  /**
   * Create necessary indexes for efficient querying
   */
  createIndexes(): Promise<void>;

  /**
   * Update an object in the database
   */
  updateObject(key: string, updates: Partial<MapObject>): Promise<void>;

  /**
   * Update multiple objects in batch
   */
  updateObjects(updates: Array<{ key: string; updates: Partial<MapObject> }>): Promise<void>;

  /**
   * Remove an object from the database
   */
  removeObject(key: string): Promise<void>;

  /**
   * Get ski areas based on filtering criteria
   */
  getSkiAreas(options: GetSkiAreasOptions): Promise<SkiAreasCursor>;

  /**
   * Get ski areas by their IDs
   */
  getSkiAreasByIds(ids: string[]): Promise<SkiAreasCursor>;

  /**
   * Find objects near a given geometry
   * @param geometry - Source geometry to search around
   * @param context - Search context with filtering options (including optional bufferDistanceKm)
   */
  findNearbyObjects(
    geometry: GeoJSON.Geometry,
    context: SearchContext,
  ): Promise<MapObject[]>;

  /**
   * Get all objects associated with a ski area
   */
  getObjectsForSkiArea(skiAreaId: string): Promise<MapObject[]>;

  /**
   * Mark objects as belonging to a ski area
   */
  markObjectsAsPartOfSkiArea(
    skiAreaId: string,
    objectKeys: string[],
    isInSkiAreaPolygon: boolean,
  ): Promise<void>;

  /**
   * Find the next unassigned run that can be used to generate a new ski area
   */
  getNextUnassignedRun(): Promise<MapObject | null>;

  /**
   * Stream all ski areas for export
   */
  streamSkiAreas(): Promise<AsyncIterable<SkiAreaObject>>;

  /**
   * Get ski areas associated with a specific object ID
   */
  getSkiAreasForObject(objectId: string): Promise<SkiAreaObject[]>;

  /**
   * Get a run object by ID
   */
  getRunObjectById(runId: string): Promise<RunObject | null>;
}

export interface GetSkiAreasOptions {
  onlySource?: SourceType;
  onlyPolygons?: boolean;
  onlyInPolygon?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export interface SearchContext {
  id: string;
  activities: SkiAreaActivity[];
  excludeObjectsAlreadyInSkiArea?: boolean;
  searchPolygon?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  searchType: "contains" | "intersects";
  isFixedSearchArea: boolean;
  alreadyVisited: string[];
  bufferDistanceKm?: number;
}

export interface SkiAreasCursor {
  next(): Promise<SkiAreaObject | null>;
  all(): Promise<SkiAreaObject[]>;
  batches?: {
    next(): Promise<SkiAreaObject[] | null>;
  };
}

export interface ClusteringBusinessLogic {
  /**
   * Main clustering function that orchestrates the entire process
   */
  clusterSkiAreas(
    skiAreasPath: string,
    liftsPath: string,
    runsPath: string,
    outputSkiAreasPath: string,
    outputLiftsPath: string,
    outputRunsPath: string,
    geocoder: Geocoder | null,
    snowCoverConfig: SnowCoverConfig | null,
  ): Promise<void>;
}