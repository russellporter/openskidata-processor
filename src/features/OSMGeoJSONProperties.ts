type OSMRelation = {
  role: string;
  rel: string;
  reltags: { [key: string]: string | undefined };
  tainted: boolean;
};

interface OSMGeoJSONProperties<Tags> {
  type: string;
  // OpenStreetMap ID, note: only unique within the `type` of the object.
  id: number;

  tags: Tags;
  relations?: [OSMRelation];
}

export function osmID(properties: OSMGeoJSONProperties<any>) {
  return properties.type + "/" + properties.id;
}
