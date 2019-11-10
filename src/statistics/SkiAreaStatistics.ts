import turfLength from "@turf/length";
import { LiftStatistics, RunStatistics, Statistics } from "openskidata-format";
import {
  LiftObject,
  MapObject,
  MapObjectType,
  RunObject
} from "../clustering/MapObject";

function isRun(object: MapObject): object is RunObject {
  return object.type === MapObjectType.Run;
}

function isLift(object: MapObject): object is LiftObject {
  return object.type === MapObjectType.Lift;
}

export function skiAreaStatistics(mapObjects: MapObject[]): Statistics {
  return {
    runs: runStatistics(mapObjects.filter(isRun)),
    lifts: liftStatistics(mapObjects.filter(isLift))
  };
}

function runStatistics(runs: RunObject[]): RunStatistics {
  return runs
    .filter(run => {
      // Exclude polygons from statistics as these are typically redundant with LineString based runs
      return run.geometry.type !== "Polygon";
    })
    .map(run => {
      return {
        difficulty: run.difficulty,
        activities: run.activities,
        distance: turfLength(run.geometry)
      };
    })
    .reduce(
      (statistics, run) => {
        run.activities.forEach(activity => {
          const activityStatistics = statistics.byActivity[activity] || {
            byDifficulty: {}
          };
          statistics.byActivity[activity] = activityStatistics;

          const difficulty = run.difficulty || "other";
          const runStats = activityStatistics.byDifficulty[difficulty] || {
            count: 0,
            lengthInKm: 0
          };
          activityStatistics.byDifficulty[difficulty] = runStats;

          runStats.count++;
          runStats.lengthInKm += run.distance;
        });

        return statistics;
      },
      {
        byActivity: {}
      } as RunStatistics
    );
}

function liftStatistics(lifts: LiftObject[]): LiftStatistics {
  return lifts
    .map(lift => {
      return { distance: turfLength(lift.geometry), type: lift.liftType };
    })
    .reduce(
      (statistics: LiftStatistics, lift) => {
        const liftType = lift.type || "other";
        const liftTypeStatistics = statistics.byType[liftType] || {
          count: 0,
          lengthInKm: 0
        };
        statistics.byType[liftType] = liftTypeStatistics;
        liftTypeStatistics.count += 1;
        liftTypeStatistics.lengthInKm += lift.distance;
        return statistics;
      },
      { byType: {} } as LiftStatistics
    );
}
