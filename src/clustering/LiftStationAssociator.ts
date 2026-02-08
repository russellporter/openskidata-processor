import nearestPointOnLine from "@turf/nearest-point-on-line";
import {
  FeatureType,
  LiftGeometry,
  LiftStationPosition,
} from "openskidata-format";
import { ElevationProcessor } from "../transforms/Elevation";
import { LiftObject, SpotObject } from "./MapObject";
import { ClusteringDatabase } from "./database/ClusteringDatabase";

export class LiftStationAssociator {
  private static readonly THRESHOLD_KM = 0.03; // 30 meters

  constructor(
    private database: ClusteringDatabase,
    private elevationProcessor?: ElevationProcessor,
  ) {}

  async associateStationsWithLifts(): Promise<void> {
    const stations = await this.getAllLiftStations();
    const liftStationMap = new Map<string, string[]>(); // liftKey -> stationKeys
    const orphanedStations: string[] = [];

    for (const station of stations) {
      const result = await this.findBestLift(station);

      if (!result) {
        orphanedStations.push(station._key);
        continue;
      }

      const { lift, closestPoint, distance } = result;

      // Get the raw properties from the station (includes spot-specific fields)
      const rawProperties = (station as any).properties || {};

      // Infer position if not set, using original station elevation
      const currentPosition = rawProperties.position || null;
      const stationElevation = station.geometry.coordinates[2]; // Original elevation before snapping
      const inferredPosition =
        currentPosition ||
        this.inferStationPosition(
          stationElevation,
          lift.geometryWithElevations,
        );

      if (this.elevationProcessor) {
        await this.elevationProcessor.enhanceGeometry(closestPoint);
      }

      // Update station geometry and properties (merge with existing JSONB properties)
      await this.database.updateObject(station._key, {
        geometry: closestPoint,
        properties: {
          ...rawProperties,
          liftId: lift._key,
          position: inferredPosition,
        },
      } as Partial<SpotObject>);

      // Track lift-station associations
      if (!liftStationMap.has(lift._key)) {
        liftStationMap.set(lift._key, []);
      }
      liftStationMap.get(lift._key)!.push(station._key);
    }

    // Store station IDs on lifts for later augmentation
    const liftUpdates: Array<{ key: string; updates: Partial<LiftObject> }> =
      [];

    for (const [liftKey, stationIds] of liftStationMap.entries()) {
      const lift = (await this.database.getObjectById(liftKey)) as LiftObject;
      if (lift) {
        liftUpdates.push({
          key: liftKey,
          updates: {
            stationIds: stationIds,
            properties: {
              ...lift.properties,
            } as any,
          },
        });
      }
    }

    if (liftUpdates.length > 0) {
      await this.database.updateObjects(liftUpdates);
    }

    // Remove orphaned stations
    if (orphanedStations.length > 0) {
      console.log(`Removing ${orphanedStations.length} orphaned lift stations`);
      for (const key of orphanedStations) {
        await this.database.removeObject(key);
      }
    }
  }

  private async findBestLift(station: SpotObject): Promise<{
    lift: LiftObject;
    closestPoint: GeoJSON.Point;
    distance: number;
  } | null> {
    const candidateLifts = await this.database.findNearbyObjects(
      station.geometry,
      {
        id: station._key,
        activities: station.activities,
        searchType: "intersects",
        isFixedSearchArea: true,
        alreadyVisited: [],
        bufferDistanceKm: LiftStationAssociator.THRESHOLD_KM,
      },
    );

    const lifts = candidateLifts.filter(
      (obj) => obj.type === FeatureType.Lift,
    ) as LiftObject[];

    let bestMatch: {
      lift: LiftObject;
      closestPoint: GeoJSON.Point;
      distance: number;
    } | null = null;

    for (const lift of lifts) {
      const { point, distance } = this.findClosestPointOnLift(
        lift.geometryWithElevations,
        station.geometry,
      );

      if (distance > LiftStationAssociator.THRESHOLD_KM) {
        continue;
      }

      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = { lift, closestPoint: point, distance };
      } else if (distance === bestMatch.distance) {
        // Tie-breaker: prefer lift in same ski area
        const stationSkiAreas = new Set(station.skiAreas);
        const thisLiftShared = lift.skiAreas.some((sa) =>
          stationSkiAreas.has(sa),
        );
        const bestLiftShared = bestMatch.lift.skiAreas.some((sa) =>
          stationSkiAreas.has(sa),
        );

        if (thisLiftShared && !bestLiftShared) {
          bestMatch = { lift, closestPoint: point, distance };
        }
      }
    }

    return bestMatch;
  }

  private findClosestPointOnLift(
    liftGeometry: LiftGeometry,
    stationPoint: GeoJSON.Point,
  ): { point: GeoJSON.Point; distance: number } {
    if (liftGeometry.type === "LineString") {
      const result = nearestPointOnLine(liftGeometry, stationPoint);
      return {
        point: result.geometry,
        distance: result.properties.dist! / 1000, // Convert meters to km
      };
    } else {
      // MultiLineString: find closest point across all segments
      let closestOverall = { point: null as any, distance: Infinity };

      for (const lineCoords of liftGeometry.coordinates) {
        const lineString: GeoJSON.LineString = {
          type: "LineString",
          coordinates: lineCoords,
        };
        const result = nearestPointOnLine(lineString, stationPoint);
        const distanceKm = result.properties.dist! / 1000;

        if (distanceKm < closestOverall.distance) {
          closestOverall = { point: result.geometry, distance: distanceKm };
        }
      }

      return closestOverall;
    }
  }

  private inferStationPosition(
    stationElevation: number | undefined,
    liftGeometry: LiftGeometry,
  ): LiftStationPosition | null {
    if (!stationElevation) {
      return null;
    }

    const elevations = this.extractElevations(liftGeometry);
    if (elevations.length < 2) {
      return null;
    }

    const minElevation = Math.min(...elevations);
    const maxElevation = Math.max(...elevations);
    const range = maxElevation - minElevation;

    // Define thresholds: bottom 25%, top 25%, mid in between
    const bottomThreshold = minElevation + range * 0.25;
    const topThreshold = maxElevation - range * 0.25;

    if (stationElevation <= bottomThreshold) {
      return LiftStationPosition.Bottom;
    } else if (stationElevation >= topThreshold) {
      return LiftStationPosition.Top;
    } else {
      return LiftStationPosition.Mid;
    }
  }

  private extractElevations(geometry: LiftGeometry): number[] {
    const elevations: number[] = [];

    if (geometry.type === "LineString") {
      for (const coord of geometry.coordinates) {
        if (coord.length >= 3 && coord[2] !== undefined) {
          elevations.push(coord[2]);
        }
      }
    } else {
      // MultiLineString
      for (const line of geometry.coordinates) {
        for (const coord of line) {
          if (coord.length >= 3 && coord[2] !== undefined) {
            elevations.push(coord[2]);
          }
        }
      }
    }

    return elevations;
  }

  private async getAllLiftStations(): Promise<SpotObject[]> {
    const cursor = await this.database.getAllLiftStations(true);
    const stations: SpotObject[] = [];

    let batch: SpotObject[] | null;
    while ((batch = await cursor.nextBatch())) {
      stations.push(...batch);
    }

    return stations;
  }
}
