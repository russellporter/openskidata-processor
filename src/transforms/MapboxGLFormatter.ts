import GeoJSON from "geojson";
import {
  Activity,
  FeatureType,
  getLiftNameAndType,
  LiftFeature,
  RunDifficulty,
  RunFeature,
  RunStatisticsByDifficulty,
  SkiAreaFeature
} from "openskidata-format";
import { centralPointInObjects as centralPointInGeometry } from "../clustering/GeoTransforms";
import {
  MapboxGLLiftFeature,
  MapboxGLLiftProperties
} from "../features/LiftFeature";
import {
  MapboxGLRunFeature,
  MapboxGLRunProperties
} from "../features/RunFeature";
import {
  MapboxGLSkiAreaFeature,
  MapboxGLSkiAreaProperties
} from "../features/SkiAreaFeature";

export function formatter(
  type: FeatureType,
  skiAreaAttributes: boolean = true
): (feature: GeoJSON.Feature) => GeoJSON.Feature {
  switch (type) {
    case FeatureType.Lift:
      return formatLift as any;
    case FeatureType.Run:
      return formatRun as any;
    case FeatureType.SkiArea:
      return formatSkiArea as any;
  }
  throw "Unhandled type " + type;

  function formatRun(feature: RunFeature): MapboxGLRunFeature {
    const properties = feature.properties;
    const mapboxGLProperties: MapboxGLRunProperties = {
      // TODO: Find a better approach to multi-use runs
      use: properties.uses[0],
      id: properties.id,
      name: getNameIncludingRef(properties.name, properties.ref),
      difficulty: properties.difficulty,
      oneway: properties.oneway,
      lit: properties.lit,
      gladed: properties.gladed,
      color: properties.color,
      colorName: properties.colorName,
      grooming: properties.grooming
    };

    if (skiAreaAttributes) {
      for (let skiAreaID of properties.skiAreas) {
        mapboxGLProperties["skiArea-" + skiAreaID] = true;
      }
    }

    return {
      type: feature.type,
      geometry: feature.geometry,
      properties: mapboxGLProperties
    };
  }

  function formatLift(feature: LiftFeature): MapboxGLLiftFeature {
    const properties = feature.properties;
    const mapboxGLProperties: MapboxGLLiftProperties = {
      // TODO: Find a better approach to multi-use runs
      id: properties.id,
      name_and_type: getNameIncludingRef(
        getLiftNameAndType(properties),
        properties.ref
      ),
      color: properties.color,
      status: properties.status
    };

    if (skiAreaAttributes) {
      for (let skiAreaID of properties.skiAreas) {
        mapboxGLProperties["skiArea-" + skiAreaID] = true;
      }
    }

    return {
      type: feature.type,
      geometry: feature.geometry,
      properties: mapboxGLProperties
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
      // TODO: Find a better approach to multi-use runs
      id: properties.id,
      name: shortenedName(properties.name),
      status: properties.status,
      downhillDistance:
        statistics && statistics.runs.byActivity.downhill
          ? Math.round(
              getDistance(statistics.runs.byActivity.downhill.byDifficulty)
            )
          : null,
      nordicDistance:
        statistics && statistics.runs.byActivity.nordic
          ? Math.round(
              getDistance(statistics.runs.byActivity.nordic.byDifficulty)
            )
          : null,
      maxElevation:
        statistics && statistics.maxElevation
          ? Math.round(statistics.maxElevation)
          : null,
      vertical:
        statistics && statistics.maxElevation && statistics.minElevation
          ? Math.round(statistics.maxElevation - statistics.minElevation)
          : null
    };

    if (properties.activities.includes(Activity.Downhill)) {
      mapboxGLProperties.has_downhill = true;
    }

    if (properties.activities.includes(Activity.Nordic)) {
      mapboxGLProperties.has_nordic = true;
    }

    return {
      type: feature.type,
      geometry: centralPointInGeometry(feature.geometry),
      properties: mapboxGLProperties
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
