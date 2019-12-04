import * as turf from "@turf/turf";
import _ from "lodash";
import {
  FeatureType,
  getColorName,
  getRunColor,
  RunConvention,
  RunDifficulty,
  RunGrooming,
  RunUse
} from "openskidata-format";
import { InputRunFeature, InputRunProperties } from "../features/RunFeature";
import buildFeature from "./FeatureBuilder";
import {
  FormattedInputRunFeature,
  FormattedInputRunProperties
} from "./FormattedInputRunFeature";
import { Omit } from "./Omit";
import { mapOSMBoolean, mapOSMString } from "./OSMTransforms";

export function formatRun(feature: InputRunFeature): FormattedInputRunFeature {
  const inputProperties = feature.properties || {};

  const pointGeometry = turf.pointOnFeature(feature).geometry;
  const coords = (pointGeometry as GeoJSON.Point).coordinates;

  const uses = getUses(inputProperties["piste:type"]);
  const difficulty = getDifficulty(inputProperties);
  const color = getRunColor(getRunConvention(coords), difficulty);

  const properties: Omit<FormattedInputRunProperties, "id"> = {
    type: FeatureType.Run,
    uses: uses,
    name: getName(inputProperties),
    ref: mapOSMString(getOrElse(inputProperties, "piste:ref", "ref")),
    description: mapOSMString(
      getOrElse(inputProperties, "piste:description", "description")
    ),
    difficulty: difficulty,
    oneway: getOneway(inputProperties, uses),
    gladed: mapOSMBoolean(getOrElse(inputProperties, "piste:gladed", "gladed")),
    patrolled: mapOSMBoolean(
      getOrElse(inputProperties, "piste:patrolled", "patrolled")
    ),
    lit: mapOSMBoolean(getOrElse(inputProperties, "piste:lit", "lit")),
    color: color,
    colorName: getColorName(color),
    grooming: getGrooming(inputProperties),
    skiAreas: []
  };

  return buildFeature(feature.geometry, properties);
}

function getUses(type: string | undefined): RunUse[] {
  if (type === undefined) {
    return [];
  }

  return type
    .split(";")
    .map(t => t.trim().toLowerCase())
    .flatMap(t =>
      Object.values(RunUse).includes(t as RunUse) ? [t as RunUse] : []
    );
}

function getOneway(
  properties: InputRunProperties,
  uses: RunUse[]
): boolean | null {
  const value = mapOSMBoolean(getOrElse(properties, "piste:oneway", "oneway"));
  if (value !== undefined) {
    return value;
  }

  if (uses.includes(RunUse.Downhill)) {
    return true;
  }

  return null;
}

function getOrElse<P extends { [key: string]: string | undefined }>(
  properties: P,
  key: keyof P,
  fallbackKey: keyof P
): string | undefined {
  const value = properties[key];
  if (value !== undefined) {
    return value;
  }

  const fallback = properties[fallbackKey];
  if (fallback !== undefined) {
    return fallback;
  }

  return undefined;
}

function getGrooming(properties: InputRunProperties): RunGrooming | null {
  const value = properties["piste:grooming"];
  if (Object.values(RunGrooming).includes(value as RunGrooming)) {
    return value as RunGrooming;
  }

  // Default to piste:grooming = backcountry for the most difficult runs
  if (
    properties["piste:difficulty"] === "expert" ||
    properties["piste:difficulty"] === "freeride" ||
    properties["piste:difficulty"] === "extreme"
  ) {
    return RunGrooming.Backcountry;
  }

  return null;
}

function getDifficulty(properties: InputRunProperties): RunDifficulty | null {
  const value = properties["piste:difficulty"];
  return value && Object.values(RunDifficulty).includes(value as RunDifficulty)
    ? (value as RunDifficulty)
    : null;
}

function nameKeysForRootKey(rootKey: string, properties: InputRunProperties) {
  const names = _.pickBy(properties, function(_, key) {
    return key === rootKey || key.startsWith(rootKey + ":");
  });
  return Object.keys(names);
}

function sortedNameKeys(properties: InputRunProperties) {
  let keys = nameKeysForRootKey("piste:name", properties);
  if (keys.length == 0) {
    keys = nameKeysForRootKey("name", properties);
  }

  return keys.sort();
}

function getName(properties: InputRunProperties) {
  const keys = sortedNameKeys(properties);

  return keys
    .map(function(key) {
      return properties[key];
    })
    .join(", ");
}

const euPoly = turf.polygon([
  [
    [-20.8273687679, -38.4405631112],
    [104.0629035075, -38.4405631112],
    [104.0629035075, 79.5008734769],
    [-20.8273687679, 79.5008734769],
    [-20.8273687679, -38.4405631112]
  ]
]);
const jpPoly = turf.polygon([
  [
    [134.5454501506, 26.7303804756],
    [127.647873113, 31.9109304183],
    [141.4351555235, 45.50454598],
    [152.5506504114, 46.803648984],
    [134.5454501506, 26.7303804756]
  ]
]);

export function getRunConvention(coords: number[]): RunConvention {
  const point = turf.point(coords);

  if (turf.booleanPointInPolygon(point, euPoly)) {
    return RunConvention.EUROPE;
  } else if (turf.booleanPointInPolygon(point, jpPoly)) {
    return RunConvention.JAPAN;
  } else {
    return RunConvention.NORTH_AMERICA;
  }
}
