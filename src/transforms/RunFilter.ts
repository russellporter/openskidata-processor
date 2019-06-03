import * as _ from "lodash";

export function filterRun(feature: GeoJSON.Feature): boolean {
  return (
    feature.geometry.type !== "Point" && _.has(feature.properties, "piste:type")
  );
}
