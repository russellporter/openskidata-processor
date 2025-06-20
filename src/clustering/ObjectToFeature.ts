import { SkiAreaFeature } from "openskidata-format";
import { SkiAreaObject } from "./MapObject";

export default function objectToFeature(
  skiAreaObject: SkiAreaObject,
): SkiAreaFeature {
  return {
    properties: skiAreaObject.properties,
    type: "Feature",
    geometry: skiAreaObject.geometry,
  };
}
