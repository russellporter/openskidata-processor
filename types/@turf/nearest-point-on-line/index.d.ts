import {
  Coord,
  Feature,
  LineString,
  MultiLineString,
  Point,
  Units
} from "@turf/helpers";

export interface NearestPointOnLine extends Feature<Point> {
  properties: {
    index?: number;
    dist?: number;
    location?: number;
    [key: string]: any;
  };
}

export default function nearestPointOnLine<
  G extends LineString | MultiLineString
>(
  lines: Feature<G> | G,
  pt: Coord,
  options?: { units?: Units }
): NearestPointOnLine;
