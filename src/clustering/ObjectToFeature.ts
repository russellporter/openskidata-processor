import { SkiAreaFeature } from "openskidata-format";
import { SkiAreaObject } from "./MapObject";

export default function objectToFeature(
  arangoDBObject: SkiAreaObject,
): SkiAreaFeature {
  return {
    properties: arangoDBObject.properties,
    type: "Feature",
    geometry: arangoDBObject.geometry,
  };
}
