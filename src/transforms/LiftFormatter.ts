import {
  FeatureType,
  LiftFeature,
  LiftProperties,
  LiftType,
  SourceType,
  Status,
} from "openskidata-format";
import { InputLiftFeature, OSMLiftTags } from "../features/LiftFeature";
import { osmID } from "../features/OSMGeoJSONProperties";
import buildFeature from "./FeatureBuilder";
import {
  getOSMName,
  mapOSMBoolean,
  mapOSMNumber,
  mapOSMString,
} from "./OSMTransforms";
import getStatusAndValue from "./Status";

type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

type LiftPropertiesWithoutID = Omit<LiftProperties, "id">;

export function formatLift(feature: InputLiftFeature): LiftFeature | null {
  const tags = feature.properties.tags || {};

  if (
    tags["passenger"] == "no" ||
    tags["access"] == "private" ||
    tags["access"] == "forestry" ||
    tags["access"] == "no" ||
    tags["foot"] == "no" ||
    tags["foot"] == "private" ||
    tags["usage"] == "freight" ||
    tags["usage"] == "industrial" ||
    tags["railway:traffic_mode"] == "freight"
  ) {
    return null;
  }

  const { status, liftType } = getStatusAndLiftType(tags);

  if (liftType === null) {
    return null;
  }

  const properties: LiftPropertiesWithoutID = {
    type: FeatureType.Lift,
    liftType: liftType,
    status: status,
    name: getOSMName(tags, "name"),
    oneway: mapOSMBoolean(tags.oneway),
    ref: mapOSMString(tags.ref),
    description: tags.description || null,
    occupancy: mapOSMNumber(tags["aerialway:occupancy"]),
    capacity: mapOSMNumber(tags["aerialway:capacity"]),
    duration: mapDuration(tags["aerialway:duration"]),
    bubble: mapOSMBoolean(tags["aerialway:bubble"]),
    heating: mapOSMBoolean(tags["aerialway:heating"]),
    color: getColor(status),
    skiAreas: [],
    sources: [
      { type: SourceType.OPENSTREETMAP, id: osmID(feature.properties) },
    ],
    location: null,
  };

  return buildFeature(feature.geometry, properties);
}

function getStatusAndLiftType(tags: OSMLiftTags) {
  let { status, value } = getStatusAndValue(
    "aerialway",
    tags as {
      [key: string]: string;
    }
  );

  if (value === null) {
    ({ status, value } = getStatusAndValue(
      "railway",
      tags as {
        [key: string]: string;
      }
    ));

    if (value !== "funicular") {
      value = LiftType.RackRailway;
    }
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
