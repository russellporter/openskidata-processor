import { SkiAreaFeature, SkiAreaSummaryFeature } from "openskidata-format";

export function toSkiAreaSummary(
  skiArea: SkiAreaFeature,
): SkiAreaSummaryFeature {
  const properties = skiArea.properties;
  return {
    type: "Feature",
    properties: {
      id: properties.id,
      name: properties.name,
      activities: properties.activities,
      type: properties.type,
      status: properties.status,
      places: properties.places,
    },
    geometry: skiArea.geometry,
  };
}
