import * as turf from "@turf/turf";
import _ from "lodash";
import {
  ColorName,
  FeatureType,
  RunDifficulty,
  RunGrooming,
  RunProperties,
  RunUse
} from "openskidata-format";
import {
  InputRunFeature,
  InputRunGeometry,
  InputRunProperties
} from "../features/RunFeature";
import buildFeature from "./FeatureBuilder";
import { Omit } from "./Omit";
import { mapOSMBoolean, mapOSMString } from "./OSMTransforms";

export function formatRun(
  feature: InputRunFeature
): GeoJSON.Feature<InputRunGeometry, RunProperties> {
  const inputProperties = feature.properties || {};

  const pointGeometry = turf.pointOnFeature(feature).geometry;
  const coords = (pointGeometry as GeoJSON.Point).coordinates;

  const uses = getUses(inputProperties["piste:type"]);
  const difficulty = getDifficulty(inputProperties);
  const color = getRegionalRunColor(coords, difficulty);

  const properties: Omit<RunProperties, "id"> = {
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
    .flatMap(t => (Object.values(RunUse).includes(t) ? [t as RunUse] : []));
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
  if (Object.values(RunGrooming).includes(value)) {
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
  return Object.values(RunDifficulty).includes(value)
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

// When adding a new color, add a supplemental oneway icon on the map style
const GREEN_COLOR = "hsl(125, 100%, 33%)";
const BLUE_COLOR = "hsl(208, 100%, 33%)";
const RED_COLOR = "hsl(359, 94%, 53%)";
const BLACK_COLOR = "hsl(0, 0%, 0%)";
const ORANGE_COLOR = "hsl(34, 100%, 50%)";
const PURPLE_COLOR = "hsl(298, 87%, 43%)";

function getColorName(color: string): ColorName {
  switch (color) {
    case GREEN_COLOR:
      return ColorName.GREEN;
    case BLUE_COLOR:
      return ColorName.BLUE;
    case RED_COLOR:
      return ColorName.RED;
    case BLACK_COLOR:
      return ColorName.BLACK;
    case ORANGE_COLOR:
      return ColorName.ORANGE;
    case PURPLE_COLOR:
      return ColorName.PURPLE;
    default:
      throw "missing color";
  }
}

function getRegionalRunColor(
  coords: number[],
  difficulty: RunDifficulty | null
): string {
  switch (getRunConvention(coords)) {
    case RunConvention.EUROPE:
      switch (difficulty) {
        case RunDifficulty.NOVICE:
          return GREEN_COLOR;
        case RunDifficulty.EASY:
          return BLUE_COLOR;
        case RunDifficulty.INTERMEDIATE:
          return RED_COLOR;
        case RunDifficulty.ADVANCED:
        case RunDifficulty.EXPERT:
          return BLACK_COLOR;
        case RunDifficulty.FREERIDE:
        case RunDifficulty.EXTREME:
          return ORANGE_COLOR;
        default:
          return PURPLE_COLOR;
      }
    case RunConvention.JAPAN:
      switch (difficulty) {
        case RunDifficulty.NOVICE:
        case RunDifficulty.EASY:
          return GREEN_COLOR;
        case RunDifficulty.INTERMEDIATE:
          return RED_COLOR;
        case RunDifficulty.ADVANCED:
        case RunDifficulty.EXPERT:
          return BLACK_COLOR;
        case RunDifficulty.FREERIDE:
        case RunDifficulty.EXTREME:
          return ORANGE_COLOR;
        default:
          return PURPLE_COLOR;
      }
    default:
    case RunConvention.NORTH_AMERICA:
      switch (difficulty) {
        case RunDifficulty.NOVICE:
        case RunDifficulty.EASY:
          return GREEN_COLOR;
        case RunDifficulty.INTERMEDIATE:
          return BLUE_COLOR;
        case RunDifficulty.ADVANCED:
        case RunDifficulty.EXPERT:
          return BLACK_COLOR;
        case RunDifficulty.FREERIDE:
        case RunDifficulty.EXTREME:
          return ORANGE_COLOR;
        default:
          return PURPLE_COLOR;
      }
  }
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

enum RunConvention {
  EUROPE = "europe",
  JAPAN = "japan",
  NORTH_AMERICA = "north_america"
}

function getRunConvention(coords: number[]): RunConvention {
  const point = turf.point(coords);

  if (turf.booleanPointInPolygon(point, euPoly)) {
    return RunConvention.EUROPE;
  } else if (turf.booleanPointInPolygon(point, jpPoly)) {
    return RunConvention.JAPAN;
  } else {
    return RunConvention.NORTH_AMERICA;
  }
}
