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
    name: inputProperties.name || null,
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
