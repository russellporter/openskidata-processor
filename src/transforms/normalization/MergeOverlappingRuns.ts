import _ from "lodash";
import {
  FeatureType,
  RunDifficulty,
  RunGrooming,
  RunProperties,
  Status
} from "openskidata-format";
import Source, { SourceType } from "openskidata-format/dist/Source";
import * as TopoJSON from "topojson-specification";

export type RunTopology = TopoJSON.Topology<{
  runs: TopoJSON.GeometryCollection<RunProperties>;
}>;

type RunLine =
  | TopoJSON.LineString<RunProperties>
  | TopoJSON.MultiLineString<RunProperties>;

interface ArcData {
  runs: RunArc[];
}

interface RunArc {
  isReversed: boolean;
  properties: RunProperties;
}

// Finds overlapping run segments and merges them
export function mergeOverlappingRuns(data: RunTopology) {
  const lines = _.remove(data.objects.runs.geometries, function (
    geometry: TopoJSON.GeometryObject
  ) {
    return (
      geometry.type === "LineString" || geometry.type === "MultiLineString"
    );
  }) as RunLine[];

  // store mapping of arc ID to merged properties for that arc
  const arcProperties: { [key: number]: ArcData } = {};

  _.forEach(lines, line => {
    const properties = line.properties;
    if (properties === undefined) {
      throw "Missing properties";
    }

    _.forEach(getArcsList(line), arcs => {
      forEachArc(arcs, (arc, isReversed) => {
        const arcData = arcProperties[arc] || { runs: [] };
        arcData.runs.push({
          isReversed: isReversed,
          properties: properties
        });
        arcProperties[arc] = arcData;
      });
    });
  });

  _.forEach(lines, line => {
    _.forEach(getArcsList(line), arcs => {
      let lastArcProperties: ArcData | null = null;
      let accumulatedArcs: number[] = [];

      function addLineIfCompleted(
        properties: ArcData | null,
        forceSplit?: boolean
      ) {
        if (
          lastArcProperties !== null &&
          (!_.isEqual(properties, lastArcProperties) || forceSplit) &&
          accumulatedArcs.length > 0
        ) {
          data.objects.runs.geometries.push({
            type: "LineString",
            properties: propertiesForArcData(lastArcProperties),
            arcs: accumulatedArcs
          });

          accumulatedArcs = [];
        }

        lastArcProperties = properties;
      }

      forEachArc(arcs, (arc, isReversed) => {
        const properties = arcProperties[arc];
        delete arcProperties[arc];
        if (!properties) {
          addLineIfCompleted(null);
          return;
        }

        const isRunReversed = getDirectionData(properties.runs).isReversed;
        if (isRunReversed) {
          arc = ~arc;
        }

        addLineIfCompleted(properties, isRunReversed != isReversed);
        accumulatedArcs.push(arc);
      });

      addLineIfCompleted(null);
    });
  });

  return data;
}

function forEachArc(
  arcs: number[],
  callback: (arc: number, isReversed: boolean) => void
) {
  _.forEach(arcs, function (arc) {
    arc = Number(arc);
    const isReversed = arc < 0;
    if (isReversed) {
      arc = ~arc;
    }
    callback(arc, isReversed);
  });
}

function getDirectionData(runs: RunArc[]) {
  if (runs.length === 0) {
    throw "Invalid input";
  }
  type DirectionData = { isReversed: boolean; oneway: boolean | null };
  const result = runs
    .map<DirectionData>(run => {
      return { isReversed: run.isReversed, oneway: run.properties.oneway };
    })
    .reduce((previous: DirectionData, current: DirectionData) => {
      if (
        previous.oneway === true &&
        current.oneway === true &&
        previous.isReversed != current.isReversed
      ) {
        return { oneway: false, isReversed: previous.isReversed };
      } else if (previous.oneway === false || current.oneway === false) {
        return { oneway: false, isReversed: previous.isReversed };
      } else if (previous.oneway === true) {
        return previous;
      } else if (current.oneway === true) {
        return current;
      } else {
        return previous;
      }
    });
  return result;
}

function propertiesForArcData(data: ArcData): RunProperties {
  const allProps = data.runs.map(run => run.properties);

  if (allProps.length === 0) {
    throw "No input properties";
  }

  const directionData = getDirectionData(data.runs);

  const difficultyAndColor = allProps
    .map(p => {
      return {
        difficulty: p.difficulty,
        color: p.color,
        colorName: p.colorName
      };
    })
    .reduce(difficultyReducer);

  return {
    type: FeatureType.Run,
    id: allProps[0].id,
    uses: Array.from(new Set(allProps.flatMap(p => p.uses))),
    name: sanitizeUniqueAndJoin(allProps.map(p => p.name)),
    ref: sanitizeUniqueAndJoin(allProps.map(p => p.ref)),
    description: sanitizeUniqueAndJoin(allProps.map(p => p.description)),
    difficulty: difficultyAndColor.difficulty,
    convention: allProps[0].convention,
    status: allProps.map(p => p.status).reduce(statusReducer),
    oneway: directionData.oneway,
    lit: allProps.map(p => p.lit).reduce(litReducer),
    gladed: allProps.map(p => p.gladed).reduce(gladedReducer),
    patrolled: allProps.map(p => p.patrolled).reduce(patrolledReducer),
    grooming: allProps.map(p => p.grooming).reduce(groomingReducer),
    color: difficultyAndColor.color,
    colorName: difficultyAndColor.colorName,
    skiAreas: Array.from(new Set(allProps.flatMap(p => p.skiAreas))),
    elevationProfile: allProps[0].elevationProfile,
    sources: uniquedSources(allProps.flatMap(properties => properties.sources))
  };
}

type Reducer<V> = (previousValue: V, currentValue: V) => V;

enum ComparisonResult {
  LEFT,
  RIGHT
}

function comparePriority<V>(
  left: V,
  right: V,
  priorityTable: Map<V, number>
): ComparisonResult {
  const leftPriority = priorityTable.get(left);
  const rightPriority = priorityTable.get(right);
  if (leftPriority === undefined) {
    throw "Missing priority for " + left;
  }
  if (rightPriority === undefined) {
    throw "Missing priority for " + right;
  }

  return leftPriority > rightPriority
    ? ComparisonResult.LEFT
    : ComparisonResult.RIGHT;
}

function pickReducer<V>(priorityTable: Map<V, number>): Reducer<V> {
  return (previousValue: V, currentValue: V) => {
    return comparePriority(previousValue, currentValue, priorityTable) ===
      ComparisonResult.LEFT
      ? previousValue
      : currentValue;
  };
}

function sanitizeUniqueAndJoin(values: (string | null)[]): string | null {
  let uniqueValues = new Set(
    values
      .filter((v): v is string => v !== null)
      .map(value => {
        return value.trim();
      })
      .filter(value => {
        return value.length > 0;
      })
  );

  return uniqueValues.size > 0 ? _.join(Array.from(uniqueValues), ", ") : null;
}
function sortPriority<T>(values: T[]): Map<T, number> {
  const map = new Map<T, number>();
  const length = values.length;
  values.forEach((value, index) => {
    map.set(value, length - index);
  });

  return map;
}

function priorityReducer<V>(values: V[]): Reducer<V> {
  return pickReducer(sortPriority(values));
}

function uniquedSources(sources: Source[]): Source[] {
  const map = new Map<SourceType, Set<string>>();
  return sources.reduce((uniquedSources: Source[], source) => {
    if (!map.has(source.type)) {
      map.set(source.type, new Set());
    }
    const sourceIDs = map.get(source.type)!;
    if (!sourceIDs.has(source.id)) {
      sourceIDs.add(source.id);
      uniquedSources.push(source);
    }

    return uniquedSources;
  }, []);
}

const difficultyPriority = sortPriority([
  RunDifficulty.NOVICE,
  RunDifficulty.EASY,
  RunDifficulty.INTERMEDIATE,
  RunDifficulty.ADVANCED,
  RunDifficulty.EXPERT,
  RunDifficulty.FREERIDE,
  RunDifficulty.EXTREME,
  null
]);

function difficultyReducer<V extends { difficulty: RunDifficulty | null }>(
  previousValue: V,
  currentValue: V
): V {
  return comparePriority(
    previousValue.difficulty,
    currentValue.difficulty,
    difficultyPriority
  ) == ComparisonResult.LEFT
    ? previousValue
    : currentValue;
}

const groomingReducer = priorityReducer([
  RunGrooming.ClassicAndSkating,
  RunGrooming.Skating,
  RunGrooming.Classic,
  RunGrooming.Mogul,
  RunGrooming.Scooter,
  RunGrooming.Backcountry,
  null
]);

const statusReducer = priorityReducer([
  Status.Operating,
  Status.Construction,
  Status.Planned,
  Status.Proposed,
  Status.Disused,
  Status.Abandoned
]);

const gladedReducer = priorityReducer([true, false, null]);

const patrolledReducer = priorityReducer([true, false, null]);

const litReducer = priorityReducer([true, false, null]);

function getArcsList(geometry: RunLine) {
  if (geometry.type !== "MultiLineString") {
    return [geometry.arcs];
  } else {
    return geometry.arcs;
  }
}
