import {
  FeatureType,
  SkiAreaFeature,
  SkiAreaProperties,
  SourceType
} from "openskidata-format";
import {
  InputSkiAreaFeature,
  InputSkiAreaProperties
} from "../features/SkiAreaFeature";
import buildFeature from "./FeatureBuilder";
import { Omit } from "./Omit";
import { getRunConvention } from "./RunFormatter";

export function formatSkiArea(feature: InputSkiAreaFeature): SkiAreaFeature {
  const inputProperties = feature.properties || {};

  const activities = inputProperties.activities;
  const properties: Omit<SkiAreaProperties, "id"> = {
    type: FeatureType.SkiArea,
    name: getName(inputProperties),
    sources: getSources(inputProperties),
    activities: activities,
    generated: false,
    status: inputProperties.status,
    runConvention: getRunConvention(feature.geometry.coordinates)
  };

  return buildFeature(feature.geometry, properties);
}

function getSources(properties: InputSkiAreaProperties) {
  return [
    {
      type: SourceType.SKIMAP_ORG,
      id: properties.id
    }
  ];
}

function getName(properties: InputSkiAreaProperties): string | null {
  const name = properties.name;
  if (name === undefined) {
    return null;
  }
  return name.length > 20 ? name.split("(")[0].trim() : name;
}
