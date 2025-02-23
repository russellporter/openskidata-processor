import { feature } from "@turf/helpers";
import turfLength from "@turf/length";
import {
  LiftStatistics,
  RunStatistics,
  SkiAreaStatistics,
} from "openskidata-format";
import { allSkiAreaActivities } from "../clustering/ArangoGraphClusterer";
import {
  LiftObject,
  MapObject,
  MapObjectType,
  RunObject,
} from "../clustering/MapObject";

function isRun(object: MapObject): object is RunObject {
  return object.type === MapObjectType.Run;
}

function isLift(object: MapObject): object is LiftObject {
  return object.type === MapObjectType.Lift;
}

type MapObjectStatistics = {
  count: number;
  lengthInKm: number;
  minElevation?: number;
  maxElevation?: number;
  combinedElevationChange?: number;
};

export function skiAreaStatistics(mapObjects: MapObject[]): SkiAreaStatistics {
  const runStats = runStatistics(mapObjects.filter(isRun));
  const liftStats = liftStatistics(mapObjects.filter(isLift));
  const statistics: SkiAreaStatistics = {
    runs: runStats,
    lifts: liftStats,
  };
  const max = maxElevation(runStats.maxElevation, liftStats.maxElevation);
  if (max) {
    statistics.maxElevation = max;
  }
  const min = minElevation(runStats.minElevation, liftStats.minElevation);
  if (min) {
    statistics.minElevation = min;
  }

  return statistics;
}

function maxElevation(runMax: number | undefined, liftMax: number | undefined) {
  if (!runMax) {
    return liftMax;
  } else if (!liftMax) {
    return runMax;
  } else {
    // Take the highest "lift serviced" elevation that also has runs.
    return Math.min(runMax, liftMax);
  }
}

function minElevation(runMin: number | undefined, liftMin: number | undefined) {
  if (!runMin) {
    return liftMin;
  } else if (!liftMin) {
    return runMin;
  } else {
    // Take the lowest "lift serviced" elevation that also has runs.
    return Math.max(runMin, liftMin);
  }
}

function elevationStatistics(geometry: GeoJSON.Geometry) {
  if (geometry.type !== "LineString" || geometry.coordinates[0].length < 3) {
    return {};
  }

  const coordinates = geometry.coordinates;
  return {
    elevationChange: coordinates[coordinates.length - 1][2] - coordinates[0][2],
    maxElevation: coordinates.reduce((previous, coordinate) => {
      return Math.max(coordinate[2], previous);
    }, -Number.MAX_VALUE),
    minElevation: coordinates.reduce((previous, coordinate) => {
      return Math.min(coordinate[2], previous);
    }, Number.MAX_VALUE),
  };
}

function runStatistics(runs: RunObject[]): RunStatistics {
  return runs
    .filter((run) => {
      // Exclude polygons from statistics as these are typically redundant with LineString based runs
      return run.geometry.type !== "Polygon";
    })
    .map((run) => {
      return {
        ...elevationStatistics(run.geometryWithElevations),
        difficulty: run.difficulty,
        activities: run.activities.filter((activity) =>
          allSkiAreaActivities.has(activity),
        ),
        distance: turfLength(feature(run.geometry)),
      };
    })
    .reduce(
      (statistics, run) => {
        run.activities.forEach((activity) => {
          const activityStatistics = statistics.byActivity[activity] || {
            byDifficulty: {},
          };
          statistics.byActivity[activity] = activityStatistics;

          const difficulty = run.difficulty || "other";
          const runStats = activityStatistics.byDifficulty[difficulty] || {
            count: 0,
            lengthInKm: 0,
          };
          activityStatistics.byDifficulty[difficulty] = runStats;

          augmentRunOrLiftStatistics(runStats, run);
          augmentElevationStatistics(statistics, run);
        });

        return statistics;
      },
      {
        byActivity: {},
      } as RunStatistics,
    );
}

function liftStatistics(lifts: LiftObject[]): LiftStatistics {
  return lifts
    .map((lift) => {
      return {
        ...elevationStatistics(lift.geometryWithElevations),
        distance: turfLength(feature(lift.geometryWithElevations)),
        type: lift.liftType,
      };
    })
    .reduce(
      (statistics: LiftStatistics, lift) => {
        const liftType = lift.type || "other";
        const liftTypeStatistics = statistics.byType[liftType] || {
          count: 0,
          lengthInKm: 0,
        };
        statistics.byType[liftType] = liftTypeStatistics;

        augmentRunOrLiftStatistics(liftTypeStatistics, lift);
        augmentElevationStatistics(statistics, lift);
        return statistics;
      },
      { byType: {} } as LiftStatistics,
    );
}

function augmentRunOrLiftStatistics(
  statistics: MapObjectStatistics,
  object: ObjectStatistics,
) {
  statistics.count++;
  statistics.lengthInKm += object.distance;
  augmentElevationStatistics(statistics, object);
  if (object.elevationChange) {
    if (!statistics.combinedElevationChange) {
      statistics.combinedElevationChange = 0;
    }
    statistics.combinedElevationChange += Math.abs(object.elevationChange);
  }
}

function augmentElevationStatistics(
  statistics: { minElevation?: number; maxElevation?: number },
  object: ObjectStatistics,
) {
  if (
    object.minElevation &&
    (!statistics.minElevation || object.minElevation < statistics.minElevation)
  ) {
    statistics.minElevation = object.minElevation;
  }
  if (
    object.maxElevation &&
    (!statistics.maxElevation || object.maxElevation > statistics.maxElevation)
  ) {
    statistics.maxElevation = object.maxElevation;
  }
}

interface ObjectElevationStatistics {
  elevationChange?: number;
  maxElevation?: number;
  minElevation?: number;
}

interface ObjectStatistics extends ObjectElevationStatistics {
  distance: number;
}
