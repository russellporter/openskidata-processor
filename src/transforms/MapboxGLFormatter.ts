import * as GeoJSON from "geojson";
import {
  DismountRequirement,
  FeatureType,
  getLiftColor,
  getLiftNameAndType,
  getRunColorName,
  LiftFeature,
  LiftStationPosition,
  runColorNameToValue,
  RunDifficulty,
  RunFeature,
  RunStatisticsByDifficulty,
  RunUse,
  SkiAreaActivity,
  SkiAreaFeature,
  SpotFeature,
  SpotType,
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
import {
  MapboxGLSpotFeature,
  MapboxGLSpotProperties,
} from "../features/SpotFeature";
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
  type: FeatureType.Spot,
): (feature: SpotFeature) => MapboxGLSpotFeature | null;

export function formatter(
  type: FeatureType,
): (
  feature: SkiAreaFeature | LiftFeature | RunFeature | SpotFeature,
) =>
  | MapboxGLSkiAreaFeature
  | MapboxGLLiftFeature
  | MapboxGLRunFeature
  | MapboxGLSpotFeature
  | null;

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
    case FeatureType.Spot:
      return formatSpot;
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
      snowmaking: properties.snowmaking,
      snowfarming: properties.snowfarming,
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

  function formatSpot(feature: SpotFeature): MapboxGLSpotFeature {
    const properties = feature.properties;

    const baseProperties: MapboxGLSpotProperties = {
      id: properties.id,
      spotType: properties.spotType,
      skiAreas: properties.skiAreas.map((skiArea) => skiArea.properties.id),
    };

    // Add type-specific properties
    switch (properties.spotType) {
      case SpotType.LiftStation:
        return {
          type: feature.type,
          geometry: feature.geometry,
          properties: {
            ...baseProperties,
            name: properties.name,
            position: properties.position,
            entry: properties.entry,
            exit: properties.exit,
          },
        };

      case SpotType.Crossing:
        return {
          type: feature.type,
          geometry: feature.geometry,
          properties: {
            ...baseProperties,
            dismount: properties.dismount,
          },
        };

      default:
        // AvalancheTransceiverTraining, AvalancheTransceiverCheckpoint, Halfpipe
        return {
          type: feature.type,
          geometry: feature.geometry,
          properties: baseProperties,
        };
    }
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
