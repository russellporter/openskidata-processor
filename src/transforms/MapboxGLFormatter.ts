import * as GeoJSON from "geojson";
import {
  FeatureType,
  getLiftColor,
  getLiftNameAndType,
  getRunColorName,
  LiftFeature,
  runColorNameToValue,
  RunDifficulty,
  RunFeature,
  RunStatisticsByDifficulty,
  RunUse,
  SkiAreaActivity,
  SkiAreaFeature,
} from "openskidata-format";
import {
  MapboxGLLiftFeature,
  MapboxGLLiftProperties,
} from "../features/LiftFeature";
import {
  MapboxGLRunFeature,
  MapboxGLRunProperties,
  MapboxGLRunUse,
} from "../features/RunFeature";
import {
  MapboxGLSkiAreaFeature,
  MapboxGLSkiAreaProperties,
} from "../features/SkiAreaFeature";
import unique from "../utils/unique";
import { centralPointsInFeature } from "./GeoTransforms";

export function formatter(
  type: FeatureType.SkiArea,
): (feature: SkiAreaFeature) => MapboxGLSkiAreaFeature | null;
export function formatter(
  type: FeatureType.Lift,
): (feature: LiftFeature) => MapboxGLLiftFeature | null;
export function formatter(
  type: FeatureType.Run,
): (feature: RunFeature) => MapboxGLRunFeature | null;

export function formatter(
  type: FeatureType,
): (
  feature: SkiAreaFeature | LiftFeature | RunFeature,
) => MapboxGLSkiAreaFeature | MapboxGLLiftFeature | MapboxGLRunFeature | null;

export function formatter(
  type: FeatureType,
): (feature: GeoJSON.Feature<any, any>) => GeoJSON.Feature | null {
  switch (type) {
    case FeatureType.Lift:
      return formatLift;
    case FeatureType.Run:
      return formatRun;
    case FeatureType.SkiArea:
      return formatSkiArea;
  }

  function formatRun(feature: RunFeature): MapboxGLRunFeature | null {
    if (feature.properties.uses.every((use) => use === RunUse.Connection)) {
      return null;
    }
    const properties = feature.properties;
    const colorName = getRunColorName(
      properties.difficultyConvention,
      properties.difficulty,
    );
    const mapboxGLProperties: MapboxGLRunProperties = {
      id: properties.id,
      name: getNameIncludingRef(properties.name, properties.ref),
      difficulty: properties.difficulty,
      oneway: properties.oneway,
      lit: properties.lit,
      gladed: properties.gladed,
      patrolled: properties.patrolled,
      color: runColorNameToValue(colorName),
      colorName: colorName,
      grooming: properties.grooming,
      skiAreas: properties.skiAreas.map((skiArea) => skiArea.properties.id),
    };

    const uses = unique(properties.uses.map(mapboxGLRunUse)).sort();
    uses.forEach((use, index) => {
      const offset = index - (uses.length - 1) / 2;
      switch (use) {
        case MapboxGLRunUse.Downhill:
          mapboxGLProperties.downhill = offset;
          break;
        case MapboxGLRunUse.Nordic:
          mapboxGLProperties.nordic = offset;
          break;
        case MapboxGLRunUse.Skitour:
          mapboxGLProperties.skitour = offset;
          break;
        case MapboxGLRunUse.Other:
          mapboxGLProperties.other = offset;
          break;
      }
    });

    return {
      type: feature.type,
      geometry: feature.geometry,
      properties: mapboxGLProperties,
    };
  }

  function formatLift(feature: LiftFeature): MapboxGLLiftFeature {
    const properties = feature.properties;
    const mapboxGLProperties: MapboxGLLiftProperties = {
      id: properties.id,
      name_and_type: getNameIncludingRef(
        getLiftNameAndType(properties),
        properties.ref,
      ),
      color: getLiftColor(properties.status),
      status: properties.status,
      skiAreas: properties.skiAreas.map((skiArea) => skiArea.properties.id),
    };

    return {
      type: feature.type,
      geometry: feature.geometry,
      properties: mapboxGLProperties,
    };
  }

  function getDistance(statistics: RunStatisticsByDifficulty) {
    return Object.keys(statistics).reduce((distance, key) => {
      return distance + statistics[key as RunDifficulty | "other"]!.lengthInKm;
    }, 0);
  }

  function formatSkiArea(feature: SkiAreaFeature): MapboxGLSkiAreaFeature {
    const properties = feature.properties;
    const statistics = properties.statistics;
    const mapboxGLProperties: MapboxGLSkiAreaProperties = {
      id: properties.id,
      name: shortenedName(properties.name),
      status: properties.status,
      downhillDistance:
        statistics && statistics.runs.byActivity.downhill
          ? Math.round(
              getDistance(statistics.runs.byActivity.downhill.byDifficulty),
            )
          : null,
      nordicDistance:
        statistics && statistics.runs.byActivity.nordic
          ? Math.round(
              getDistance(statistics.runs.byActivity.nordic.byDifficulty),
            )
          : null,
      maxElevation:
        statistics && statistics.maxElevation
          ? Math.round(statistics.maxElevation)
          : null,
      vertical:
        statistics && statistics.maxElevation && statistics.minElevation
          ? Math.round(statistics.maxElevation - statistics.minElevation)
          : null,
    };

    if (properties.activities.includes(SkiAreaActivity.Downhill)) {
      mapboxGLProperties.has_downhill = true;
    }

    if (properties.activities.includes(SkiAreaActivity.Nordic)) {
      mapboxGLProperties.has_nordic = true;
    }

    return {
      type: feature.type,
      geometry: centralPointsInFeature(feature.geometry),
      properties: mapboxGLProperties,
    };
  }
}

function shortenedName(name: string | null): string | null {
  return name && name.length > 20 ? name.split("(")[0].trim() : name;
}

function getNameIncludingRef(name: string | null, ref: string | null) {
  if (ref === null) {
    return name;
  }

  if (name === null) {
    return ref;
  }

  return ref + " - " + name;
}

function mapboxGLRunUse(runUse: RunUse): MapboxGLRunUse {
  switch (runUse) {
    case RunUse.Downhill:
      return MapboxGLRunUse.Downhill;
    case RunUse.Nordic:
      return MapboxGLRunUse.Nordic;
    case RunUse.Skitour:
      return MapboxGLRunUse.Skitour;
    default:
      return MapboxGLRunUse.Other;
  }
}
