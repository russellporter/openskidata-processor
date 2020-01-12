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
import getStatusAndValue from "./Status";

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

  const { status, liftType } = getStatusAndLiftType(inputProperties);

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
    description: inputProperties.description || null,
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

function getStatusAndLiftType(properties: InputLiftProperties) {
  let { status, value } = getStatusAndValue("aerialway", properties as {
    [key: string]: string;
  });

  if (value === null) {
    ({ status, value } = getStatusAndValue("railway", properties as {
      [key: string]: string;
    }));
  }

  const liftType = Object.values(LiftType).includes(value as LiftType)
    ? (value as LiftType)
    : null;
  return { status, liftType };
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
