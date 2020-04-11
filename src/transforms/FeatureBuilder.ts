import objectHash from "object-hash";
import {
  LiftProperties,
  RunProperties,
  SkiAreaProperties
} from "openskidata-format";

export default function buildFeature<
  G extends GeoJSON.Geometry,
  P extends SkiAreaProperties | LiftProperties | RunProperties
>(geometry: G, properties: P): GeoJSON.Feature<G, P & { id: string }> {
  const id = objectHash({
    type: "Feature",
    properties: {
      type: properties.type
    },
    geometry: geometry
  });

  return {
    type: "Feature",
    properties: { ...properties, id: id },
    geometry: geometry
  };
}
