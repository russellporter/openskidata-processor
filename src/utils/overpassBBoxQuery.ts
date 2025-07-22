import { strict as assert } from "assert";

export default function overpassBBoxQuery(bbox: GeoJSON.BBox | null) {
  if (bbox === null) {
    return "";
  }
  assert(bbox.length == 4, "Only 2d boxes are supported");
  // south,west,north,east
  return `[bbox:${bbox[1]},${normalizeLongitude(bbox[0])},${
    bbox[3]
  },${normalizeLongitude(bbox[2])}]`;
}

function normalizeLongitude(longitude: number) {
  return ((longitude + 180) % 360) - 180;
}
