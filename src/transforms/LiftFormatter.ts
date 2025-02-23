import {
  FeatureType,
  LiftFeature,
  LiftProperties,
  LiftType,
  SourceType,
} from "openskidata-format";
import { InputLiftFeature, OSMLiftTags } from "../features/LiftFeature";
import { osmID } from "../features/OSMGeoJSONProperties";
import notEmpty from "../utils/notEmpty";
import buildFeature from "./FeatureBuilder";
import {
  getOSMFirstValue,
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

  if (status === null || liftType === null) {
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
    detachable: mapOSMBoolean(tags["aerialway:detachable"]),
    skiAreas: [],
    sources: [
      { type: SourceType.OPENSTREETMAP, id: osmID(feature.properties) },
    ],
    websites: [tags.website].filter(notEmpty),
    wikidata_id: getOSMFirstValue(tags, "wikidata"),
  };

  return buildFeature(feature.geometry, properties);
}

function getStatusAndLiftType(tags: OSMLiftTags) {
  let { status, value } = getStatusAndValue(
    "aerialway",
    tags as {
      [key: string]: string;
    },
  );

  if (value === null) {
    ({ status, value } = getStatusAndValue(
      "railway",
      tags as {
        [key: string]: string;
      },
    ));

    if (value !== null && value !== "funicular") {
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
