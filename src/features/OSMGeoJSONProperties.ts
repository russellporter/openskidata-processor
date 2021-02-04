export type OSMRelation = {
  role: string;
  rel: string;
  reltags: { [key: string]: string | undefined };
  tainted: boolean;
};

export interface OSMIdentifiable {
  type: string;
  // OpenStreetMap ID, note: only unique within the `type` of the object.
  id: number;
}

export default interface OSMGeoJSONProperties<Tags> extends OSMIdentifiable {
  tags: Tags;
  relations?: [OSMRelation];
}

export function osmID(properties: OSMIdentifiable) {
  return properties.type + "/" + properties.id;
}
