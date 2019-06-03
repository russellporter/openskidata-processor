import objectHash from "object-hash";

export default function buildFeature<G extends GeoJSON.Geometry, P>(
  geometry: G,
  propertiesExceptID: P
): GeoJSON.Feature<G, P & { id: string }> {
  const id = objectHash({
    type: "Feature",
    properties: propertiesExceptID,
    geometry: geometry
  });

  const properties: P & { id: string } = { ...propertiesExceptID, id: id };
  return {
    type: "Feature",
    properties: properties,
    geometry: geometry
  };
}
