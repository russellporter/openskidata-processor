export interface OSMIdentifiable {
  type: string;
  // OpenStreetMap ID, note: only unique within the `type` of the object.
  id: number;
}

export default interface OSMGeoJSONProperties<Tags> extends OSMIdentifiable {
  tags: Tags;
}

export function osmID(properties: OSMIdentifiable) {
  return properties.type + "/" + properties.id;
}
