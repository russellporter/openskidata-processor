import GeoJSON from "geojson";
import {
  Activity,
  FeatureType,
  getLiftNameAndType,
  LiftFeature,
  RunFeature,
  SkiAreaFeature
} from "openskidata-format";
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
      name: properties.name,
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
      name_and_type: getLiftNameAndType(properties),
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

  function formatSkiArea(feature: SkiAreaFeature): MapboxGLSkiAreaFeature {
    const properties = feature.properties;
    const mapboxGLProperties: MapboxGLSkiAreaProperties = {
      // TODO: Find a better approach to multi-use runs
      id: properties.id,
      name: shortenedName(properties.name),
      status: properties.status
    };

    if (properties.activities.includes(Activity.Downhill)) {
      mapboxGLProperties.has_downhill = true;
    }

    if (properties.activities.includes(Activity.Nordic)) {
      mapboxGLProperties.has_nordic = true;
    }

    return {
      type: feature.type,
      geometry: feature.geometry,
      properties: mapboxGLProperties
    };
  }
}

function shortenedName(name: string | null): string | null {
  return name && name.length > 20 ? name.split("(")[0].trim() : name;
}
