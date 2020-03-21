import { Feature, MultiPolygon, Polygon, Properties } from "@turf/helpers";

export default function union<P = Properties>(
  polygon1: Feature<Polygon | MultiPolygon> | Polygon | MultiPolygon,
  polygon2: Feature<Polygon | MultiPolygon> | Polygon | MultiPolygon,
  options?: { properties?: P }
): Feature<Polygon | MultiPolygon, P>;
