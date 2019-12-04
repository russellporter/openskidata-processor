import * as _ from "lodash";
import {
  FeatureType,
  LiftFeature,
  LiftProperties,
  LiftType,
  Status
} from "openskidata-format";
import { InputLiftFeature, InputLiftProperties } from "../features/LiftFeature";
import buildFeature from "./FeatureBuilder";
import { mapOSMBoolean, mapOSMNumber, mapOSMString } from "./OSMTransforms";

const lifecycleStates = [
  Status.Disused,
  Status.Abandoned,
  Status.Proposed,
  Status.Planned,
  Status.Construction
];
const lifecyclePrefixes = [
  "",
  "disused:",
  "abandoned:",
  "proposed:",
  "planned:",
  "construction:"
];

type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

type LiftPropertiesWithoutID = Omit<LiftProperties, "id">;

export function formatLift(feature: InputLiftFeature): LiftFeature | null {
  const inputProperties = feature.properties || {};

  if (
    inputProperties["passenger"] == "no" ||
    inputProperties["access"] == "private" ||
    inputProperties["access"] == "forestry" ||
    inputProperties["access"] == "no" ||
    inputProperties["foot"] == "no" ||
    inputProperties["foot"] == "private" ||
    inputProperties["usage"] == "freight" ||
    inputProperties["usage"] == "industrial"
  ) {
    return null;
  }

  // To simplify processing, treat funicular's also as "aerialway"'s.
  if (!_.has(inputProperties, "aerialway")) {
    _.forEach(lifecyclePrefixes, state => {
      if ((inputProperties as any)[state + "railway"] === "funicular") {
        (inputProperties as any)[state + "aerialway"] = "funicular";
      }
    });
  }

  const liftTypeAndStatus = getLiftTypeAndStatus(inputProperties);
  const liftType = liftTypeAndStatus[0];
  const status = liftTypeAndStatus[1];

  if (liftType === null) {
    return null;
  }

  const properties: LiftPropertiesWithoutID = {
    type: FeatureType.Lift,
    liftType: liftType,
    status: status,
    name: mapOSMString(inputProperties.name),
    oneway: mapOSMBoolean(inputProperties.oneway),
    ref: mapOSMString(inputProperties.ref),
    occupancy: mapOSMNumber(inputProperties["aerialway:occupancy"]),
    capacity: mapOSMNumber(inputProperties["aerialway:capacity"]),
    duration: mapDuration(inputProperties["aerialway:duration"]),
    bubble: mapOSMBoolean(inputProperties["aerialway:bubble"]),
    heating: mapOSMBoolean(inputProperties["aerialway:heating"]),
    color: getColor(status),
    skiAreas: []
  };

  return buildFeature(feature.geometry, properties);
}

function isNumeric(n: any) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}

function mapDuration(string: string | undefined): number | null {
  if (string === undefined) {
    return null;
  }
  if (isNumeric(string)) {
    return Math.round(parseFloat(string) * 60);
  }

  if (string.indexOf(":") !== -1) {
    const components = string.split(":");
    if (components.length !== 2) {
      return null;
    }

    return parseInt(components[0]) * 60 + parseInt(components[1]);
  }

  return null;
}

// Add a "status" property which can be one of "abandoned", "disused", "operating", "proposed", "planned", "construction"
// Supports several common tagging schemes:
// - disused:aerialway, abandoned:aerialway
// - proposed:aerialway, planned:aerialway, construction:aerialway
// - proposed/planned/construction/abandoned/disused = yes
// - aerialway = construction & construction = chair_lift
function getLiftTypeAndStatus(
  properties: InputLiftProperties
): [LiftType | null, Status] {
  let status = Status.Operating;
  let aerialway = properties.aerialway;

  _.forEach(lifecycleStates, state => {
    if (properties["aerialway"] === state) {
      status = state;
      if (_.has(properties, state)) {
        aerialway = (properties as any)[state];
      }
    }

    if ((properties as any)[state] === "yes") {
      status = state;
    }
  });

  if (!_.has(properties, "aerialway")) {
    _.forEach(lifecycleStates, state => {
      const aerialwayLifecycleKey = state + ":aerialway";
      if (_.has(properties, aerialwayLifecycleKey)) {
        aerialway = (properties as any)[aerialwayLifecycleKey];
        status = state;
      }
    });
  }

  return [
    aerialway && Object.values(LiftType).includes(aerialway as LiftType)
      ? (aerialway as LiftType)
      : null,
    status
  ];
}

function getColor(status: string): string {
  const BRIGHT_RED_COLOR = "hsl(0, 82%, 42%)";
  const DIM_RED_COLOR = "hsl(0, 53%, 42%)";

  switch (status) {
    case Status.Disused:
    case Status.Abandoned:
      return DIM_RED_COLOR;
    case Status.Proposed:
    case Status.Planned:
    case Status.Construction:
    case Status.Operating:
      return BRIGHT_RED_COLOR;
  }

  throw "Switch should be exhaustive";
}
