import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import turfCenter from "@turf/center";
import * as turf from "@turf/helpers";
import { AllGeoJSON } from "@turf/helpers";
import {
  FeatureType,
  getColorName,
  getRunColor,
  RunConvention,
  RunDifficulty,
  RunGrooming,
  RunUse,
  SourceType,
  Status
} from "openskidata-format";
import { InputRunFeature, InputRunProperties } from "../features/RunFeature";
import buildFeature from "./FeatureBuilder";
import {
  FormattedInputRunFeature,
  FormattedInputRunProperties
} from "./FormattedInputRunFeature";
import { Omit } from "./Omit";
import { getOSMName, mapOSMBoolean, mapOSMString } from "./OSMTransforms";
import getStatusAndValue from "./Status";

export function formatRun(
  feature: InputRunFeature
): FormattedInputRunFeature | null {
  if (feature.geometry.type === "Point") {
    return null;
  }

  const inputProperties = feature.properties;

  const { status, uses } = getStatusAndUses(inputProperties);
  if (uses.length === 0) {
    return null;
  }

  // TODO: support runs that are not operational: https://github.com/russellporter/openskimap.org/issues/15
  if (status !== Status.Operating) {
    return null;
  }

  const difficulty = getDifficulty(inputProperties);
  const convention = getRunConvention(feature);
  const color = getRunColor(convention, difficulty);

  const properties: Omit<FormattedInputRunProperties, "id"> = {
    type: FeatureType.Run,
    uses: uses,
    name: getOSMName(inputProperties, "piste:name", "name"),
    ref: mapOSMString(getOrElse(inputProperties, "piste:ref", "ref")),
    description: mapOSMString(
      getOrElse(inputProperties, "piste:description", "description")
    ),
    difficulty: difficulty,
    convention: convention,
    oneway: getOneway(inputProperties, uses),
    gladed: mapOSMBoolean(getOrElse(inputProperties, "piste:gladed", "gladed")),
    patrolled: mapOSMBoolean(
      getOrElse(inputProperties, "piste:patrolled", "patrolled")
    ),
    lit: mapOSMBoolean(getOrElse(inputProperties, "piste:lit", "lit")),
    color: color,
    colorName: getColorName(color),
    grooming: getGrooming(inputProperties),
    skiAreas: [],
    status: status,
    sources: [{ type: SourceType.OPENSTREETMAP, id: inputProperties["id"] }]
  };

  return buildFeature(feature.geometry, properties);
}

function getStatusAndUses(properties: InputRunProperties) {
  let { status, value: pisteType } = getStatusAndValue(
    "piste:type",
    properties as { [key: string]: string }
  );

  // Special case status check for runs: https://wiki.openstreetmap.org/wiki/Piste_Maps
  if (properties["piste:abandoned"] === "yes") {
    status = Status.Abandoned;
  }

  const uses = pisteType !== null ? getUses(pisteType) : [];
  return { status, uses };
}

function getUses(type: string): RunUse[] {
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

export function getRunConvention(geojson: AllGeoJSON): RunConvention {
  const point = turfCenter(geojson).geometry;
  if (!point) {
    throw "Cannot determine center of geometry";
  }

  if (booleanPointInPolygon(point, euPoly)) {
    return RunConvention.EUROPE;
  } else if (booleanPointInPolygon(point, jpPoly)) {
    return RunConvention.JAPAN;
  } else {
    return RunConvention.NORTH_AMERICA;
  }
}
