import _ from "lodash";
import { RunProperties } from "openskidata-format";
import * as TopoJSON from "topojson-specification";
import { mergedProperties } from "./RunJoining";

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
  const lines = _.remove(
    data.objects.runs.geometries,
    function (geometry: TopoJSON.GeometryObject) {
      return (
        geometry.type === "LineString" || geometry.type === "MultiLineString"
      );
    },
  ) as RunLine[];

  // store mapping of arc ID to merged properties for that arc
  const arcProperties: { [key: number]: ArcData } = {};

  _.forEach(lines, (line) => {
    const properties = line.properties;
    if (properties === undefined) {
      throw "Missing properties";
    }

    _.forEach(getArcsList(line), (arcs) => {
      forEachArc(arcs, (arc, isReversed) => {
        const arcData = arcProperties[arc] || { runs: [] };
        arcData.runs.push({
          isReversed: isReversed,
          properties: properties,
        });
        arcProperties[arc] = arcData;
      });
    });
  });

  _.forEach(lines, (line) => {
    _.forEach(getArcsList(line), (arcs) => {
      let lastArcProperties: ArcData | null = null;
      let accumulatedArcs: number[] = [];

      function addLineIfCompleted(
        properties: ArcData | null,
        forceSplit?: boolean,
      ) {
        if (
          lastArcProperties !== null &&
          (!_.isEqual(properties, lastArcProperties) || forceSplit) &&
          accumulatedArcs.length > 0
        ) {
          data.objects.runs.geometries.push({
            type: "LineString",
            properties: propertiesForArcData(lastArcProperties),
            arcs: accumulatedArcs,
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
  callback: (arc: number, isReversed: boolean) => void,
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
    .map<DirectionData>((run) => {
      return { isReversed: run.isReversed, oneway: run.properties.oneway };
    })
    .reduce((previous: DirectionData, current: DirectionData) => {
      if (
        previous.oneway === true &&
        current.oneway === true &&
        previous.isReversed != current.isReversed
      ) {
        return { oneway: false, isReversed: previous.isReversed };
      } else if (previous.oneway === false) {
        return { oneway: false, isReversed: current.isReversed };
      } else if (current.oneway === false) {
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
  const properties = mergedProperties(data.runs.map((run) => run.properties));
  properties.oneway = getDirectionData(data.runs).oneway;
  return properties;
}

function getArcsList(geometry: RunLine) {
  if (geometry.type !== "MultiLineString") {
    return [geometry.arcs];
  } else {
    return geometry.arcs;
  }
}
