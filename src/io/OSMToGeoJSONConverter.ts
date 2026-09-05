import { createReadStream, createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { chain } from "stream-chain";
import { parser } from "stream-json";
import { pick } from "stream-json/filters/pick.js";
import { streamArray } from "stream-json/streamers/stream-array.js";
import OSMGeoJSONProperties from "../features/OSMGeoJSONProperties.js";

/**
 * Converts Overpass API JSON (as produced by a plain `out;` statement) into
 * GeoJSON features.
 *
 * The conversion deliberately emits every element that carries geometry,
 * including ways that are members of a relation and untagged member ways.
 * Deduplicating an object that is tagged both on a relation and on its members
 * is left to the later merging of overlapping runs and ski areas, which can
 * combine the two sources into better data than either alone.
 *
 * Rules:
 * - Nodes become Points when they are tagged, are a relation member, or are not
 *   part of any way.
 * - Ways become LineStrings, or Polygons when closed and tagged as an area.
 * - `type=multipolygon` and `type=boundary` relations become Polygons or
 *   MultiPolygons assembled from their member ways.
 * - `type=route` and `type=waterway` relations become LineStrings or
 *   MultiLineStrings assembled from their member ways.
 * - Other relation types carry no geometry and are dropped.
 *
 * Features are emitted relation geometries first, then polygon ways, then line
 * ways, then points in ascending node ID order. Polygon rings follow the
 * right-hand rule of RFC 7946.
 */

export type OSMTags = { [key: string]: string };

export interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: OSMTags;
}

export interface OverpassWay {
  type: "way";
  id: number;
  nodes?: number[];
  tags?: OSMTags;
}

export interface OverpassRelationMember {
  type: string;
  ref: number;
  role?: string;
}

export interface OverpassRelation {
  type: "relation";
  id: number;
  members?: OverpassRelationMember[];
  tags?: OSMTags;
}

export type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;

export interface OverpassJSON {
  elements: OverpassElement[];
}

export type OSMGeoJSONFeature = GeoJSON.Feature<
  GeoJSON.Geometry,
  OSMGeoJSONProperties<OSMTags>
>;

// see https://wiki.openstreetmap.org/wiki/Overpass_turbo/Polygon_Features
// with the addition of downhill piste areas.
type PolygonRule =
  | true
  | { included_values: { [value: string]: true } }
  | { excluded_values: { [value: string]: true } };

const polygonFeatures: { [key: string]: PolygonRule } = {
  building: true,
  highway: {
    included_values: {
      services: true,
      rest_area: true,
      escape: true,
    },
  },
  natural: {
    excluded_values: {
      coastline: true,
      ridge: true,
      arete: true,
      tree_row: true,
    },
  },
  landuse: true,
  waterway: {
    included_values: {
      riverbank: true,
      dock: true,
      boatyard: true,
      dam: true,
    },
  },
  amenity: true,
  leisure: true,
  barrier: {
    included_values: {
      city_wall: true,
      ditch: true,
      hedge: true,
      retaining_wall: true,
      wall: true,
      spikes: true,
    },
  },
  railway: {
    included_values: {
      station: true,
      turntable: true,
      roundhouse: true,
      platform: true,
    },
  },
  area: true,
  boundary: true,
  man_made: {
    excluded_values: {
      cutline: true,
      embankment: true,
      pipeline: true,
    },
  },
  power: {
    included_values: {
      generator: true,
      station: true,
      sub_station: true,
      transformer: true,
    },
  },
  place: true,
  shop: true,
  aeroway: {
    excluded_values: {
      taxiway: true,
    },
  },
  tourism: true,
  historic: true,
  public_transport: true,
  office: true,
  "building:part": true,
  military: true,
  ruins: true,
  "area:highway": true,
  craft: true,
  "piste:type": {
    included_values: {
      downhill: true,
    },
  },
};

function isPolygonFeature(tags: OSMTags): boolean {
  // explicitly tagged non-areas
  if (tags["area"] === "no") {
    return false;
  }
  for (const key in tags) {
    const value = tags[key];
    const rule = polygonFeatures[key];
    if (rule === undefined) {
      continue;
    }
    // explicitly un-set ("building=no")
    if (value === "no") {
      continue;
    }
    if (rule === true) {
      return true;
    }
    if ("included_values" in rule && rule.included_values[value] === true) {
      return true;
    }
    if ("excluded_values" in rule && rule.excluded_values[value] !== true) {
      return true;
    }
  }
  return false;
}

export default async function convertOSMFileToGeoJSON(
  inputFile: string,
  outputFile: string,
): Promise<void> {
  const converter = new OverpassToGeoJSONConverter();
  const elements: AsyncIterable<OverpassElement> = chain([
    createReadStream(inputFile),
    parser(),
    pick({ filter: "elements" }),
    streamArray(),
    // streamArray emits {key, value} envelopes; only the element is wanted.
    (entry: { key: number; value: unknown }) => entry.value as OverpassElement,
  ]);
  for await (const element of elements) {
    converter.add(element);
  }

  await pipeline(
    Readable.from(serializeFeatureCollection(converter.features())),
    createWriteStream(outputFile),
  );
}

export function convertOSMToGeoJSON(
  json: OverpassJSON,
): GeoJSON.FeatureCollection<GeoJSON.Geometry, OSMGeoJSONProperties<OSMTags>> {
  const converter = new OverpassToGeoJSONConverter();
  for (const element of json.elements) {
    converter.add(element);
  }
  return { type: "FeatureCollection", features: [...converter.features()] };
}

/**
 * Serializes features one at a time, so the output starts right after the
 * conversion and the whole document never has to exist as a single string.
 */
function* serializeFeatureCollection(
  features: Iterable<OSMGeoJSONFeature>,
): Generator<string> {
  const chunkSize = 1 << 16;
  let chunk = '{\n"type": "FeatureCollection",\n"features": [\n';
  let first = true;
  for (const feature of features) {
    if (!first) {
      chunk += ",\n";
    }
    first = false;
    chunk += JSON.stringify(feature);
    if (chunk.length >= chunkSize) {
      yield chunk;
      chunk = "";
    }
  }
  yield chunk + "\n]\n}\n";
}

/**
 * Node coordinates in parallel arrays, sorted by ID and looked up by binary
 * search. Planet-scale extracts hold millions of nodes, and this is several
 * times more compact than a Map of objects.
 */
class NodeStore {
  private ids: number[] = [];
  private lons: number[] = [];
  private lats: number[] = [];
  private sorted = true;
  private finished = false;

  add(node: OverpassNode) {
    if (this.finished) {
      throw new Error("Cannot add nodes after lookups have started");
    }
    if (this.ids.length > 0 && node.id <= this.ids[this.ids.length - 1]) {
      this.sorted = false;
    }
    this.ids.push(node.id);
    // iron out some nasty floating point rounding errors
    this.lons.push(Math.round(node.lon * 1e12) / 1e12);
    this.lats.push(Math.round(node.lat * 1e12) / 1e12);
  }

  get size(): number {
    return this.ids.length;
  }

  /**
   * Sorts the store if needed. Overpass emits nodes in ascending ID order, so
   * this is normally a no-op.
   */
  finish() {
    this.finished = true;
    if (this.sorted) {
      return;
    }
    const order = this.ids
      .map((_, i) => i)
      .sort((a, b) => this.ids[a] - this.ids[b]);
    this.ids = order.map((i) => this.ids[i]);
    this.lons = order.map((i) => this.lons[i]);
    this.lats = order.map((i) => this.lats[i]);
    this.sorted = true;
  }

  indexOf(id: number): number {
    let low = 0;
    let high = this.ids.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const value = this.ids[mid];
      if (value < id) {
        low = mid + 1;
      } else if (value > id) {
        high = mid - 1;
      } else {
        return mid;
      }
    }
    return -1;
  }

  has(id: number): boolean {
    return this.indexOf(id) !== -1;
  }

  idAt(index: number): number {
    return this.ids[index];
  }

  positionAt(index: number): GeoJSON.Position {
    return [this.lons[index], this.lats[index]];
  }

  position(id: number): GeoJSON.Position {
    return this.positionAt(this.indexOf(id));
  }
}

type WayMember = {
  role: string | undefined;
  // Member way's node IDs, with nodes missing from the extract removed.
  nodes: number[];
};

export class OverpassToGeoJSONConverter {
  private nodes = new NodeStore();
  private nodeTags = new Map<number, OSMTags>();
  private ways: OverpassWay[] = [];
  private waysByID = new Map<number, OverpassWay>();
  private relations: OverpassRelation[] = [];

  add(element: OverpassElement) {
    switch (element.type) {
      case "node":
        if (element.lat === undefined || element.lon === undefined) {
          // lon and lat are required for showing a point
          return;
        }
        this.nodes.add(element);
        if (element.tags !== undefined) {
          this.nodeTags.set(element.id, element.tags);
        }
        break;
      case "way":
        this.ways.push(element);
        this.waysByID.set(element.id, element);
        break;
      case "relation":
        this.relations.push(element);
        break;
      default:
      // type=area (from coord-query) is an example for this case.
    }
  }

  *features(): Generator<OSMGeoJSONFeature> {
    this.nodes.finish();

    for (const relation of this.relations) {
      const feature = this.relationFeature(relation);
      if (feature !== null) {
        yield feature;
      }
    }

    for (const way of this.ways) {
      if (this.isPolygonWay(way)) {
        const feature = this.wayFeature(way, "Polygon");
        if (feature !== null) {
          yield feature;
        }
      }
    }

    for (const way of this.ways) {
      if (!this.isPolygonWay(way)) {
        const feature = this.wayFeature(way, "LineString");
        if (feature !== null) {
          yield feature;
        }
      }
    }

    yield* this.pointFeatures();
  }

  private *pointFeatures(): Generator<OSMGeoJSONFeature> {
    // A node is emitted as a point when it carries tags, is referenced by a
    // relation, or is not part of any way.
    const isPoint = new Uint8Array(this.nodes.size);
    for (const way of this.ways) {
      for (const id of way.nodes ?? []) {
        const index = this.nodes.indexOf(id);
        if (index !== -1) {
          isPoint[index] = 2;
        }
      }
    }
    for (let index = 0; index < isPoint.length; index++) {
      if (isPoint[index] === 0 || this.nodeTags.has(this.nodes.idAt(index))) {
        isPoint[index] = 1;
      }
    }
    for (const relation of this.relations) {
      for (const member of relation.members ?? []) {
        if (member.type === "node") {
          const index = this.nodes.indexOf(member.ref);
          if (index !== -1) {
            isPoint[index] = 1;
          }
        }
      }
    }

    for (let index = 0; index < isPoint.length; index++) {
      if (isPoint[index] !== 1) {
        continue;
      }
      const id = this.nodes.idAt(index);
      yield {
        type: "Feature",
        id: "node/" + id,
        properties: {
          type: "node",
          id: id,
          tags: this.nodeTags.get(id) ?? {},
        },
        geometry: {
          type: "Point",
          coordinates: this.nodes.positionAt(index),
        },
      };
    }
  }

  private isPolygonWay(way: OverpassWay): boolean {
    const nodes = way.nodes;
    if (nodes === undefined || nodes.length === 0 || way.tags === undefined) {
      return false;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    return (
      first === last &&
      this.nodes.has(first) &&
      this.nodes.has(last) &&
      isPolygonFeature(way.tags)
    );
  }

  private wayFeature(
    way: OverpassWay,
    geometryType: "Polygon" | "LineString",
  ): OSMGeoJSONFeature | null {
    if (way.nodes === undefined) {
      // ignore ways without nodes (e.g. returned by an ids_only query)
      return null;
    }
    const coordinates: GeoJSON.Position[] = [];
    for (const id of way.nodes) {
      const index = this.nodes.indexOf(id);
      if (index !== -1) {
        coordinates.push(this.nodes.positionAt(index));
      }
    }
    if (coordinates.length <= 1) {
      // invalid way geometry
      return null;
    }
    const geometry: GeoJSON.Polygon | GeoJSON.LineString =
      geometryType === "Polygon"
        ? { type: "Polygon", coordinates: [coordinates] }
        : { type: "LineString", coordinates: coordinates };
    return rewind({
      type: "Feature",
      id: "way/" + way.id,
      properties: { type: "way", id: way.id, tags: way.tags ?? {} },
      geometry: geometry,
    });
  }

  private relationFeature(
    relation: OverpassRelation,
  ): OSMGeoJSONFeature | null {
    const tags = relation.tags;
    if (tags === undefined || !Array.isArray(relation.members)) {
      // ignore relations without members (e.g. returned by an ids_only query)
      return null;
    }
    let geometry: GeoJSON.Geometry | null = null;
    if (tags["type"] === "route" || tags["type"] === "waterway") {
      geometry = this.routeGeometry(relation.members);
    } else if (tags["type"] === "multipolygon" || tags["type"] === "boundary") {
      geometry = this.multipolygonGeometry(relation.members);
    }
    if (geometry === null) {
      return null;
    }
    return rewind({
      type: "Feature",
      id: "relation/" + relation.id,
      properties: { type: "relation", id: relation.id, tags: tags },
      geometry: geometry,
    });
  }

  private wayMembers(members: OverpassRelationMember[]): WayMember[] {
    const result: WayMember[] = [];
    for (const member of members) {
      if (member.type !== "way") {
        continue;
      }
      const way = this.waysByID.get(member.ref);
      if (way === undefined || way.nodes === undefined) {
        // missing or incomplete way, the geometry is built from the rest
        continue;
      }
      result.push({
        role: member.role,
        nodes: way.nodes.filter((id) => this.nodes.has(id)),
      });
    }
    return result;
  }

  private routeGeometry(
    members: OverpassRelationMember[],
  ): GeoJSON.LineString | GeoJSON.MultiLineString | null {
    const lines = joinWays(this.wayMembers(members).map((m) => m.nodes)).map(
      (line) => line.map((id) => this.nodes.position(id)),
    );
    if (lines.length === 0) {
      return null;
    }
    return lines.length === 1
      ? { type: "LineString", coordinates: lines[0] }
      : { type: "MultiLineString", coordinates: lines };
  }

  private multipolygonGeometry(
    members: OverpassRelationMember[],
  ): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
    if (!members.some((member) => member.role === "outer")) {
      // ignore multipolygons without outer ways
      return null;
    }
    const wayMembers = this.wayMembers(members).map((member) => ({
      role: member.role || "outer",
      nodes: member.nodes,
    }));
    const outers = joinWays(
      wayMembers.filter((m) => m.role === "outer").map((m) => m.nodes),
    );
    const inners = joinWays(
      wayMembers.filter((m) => m.role === "inner").map((m) => m.nodes),
    );

    // Assign each inner ring to the first outer ring containing any of its points.
    // Inner rings in empty space are ignored.
    const outerPoints = outers.map((ring) =>
      ring.map((id) => this.nodes.position(id)),
    );
    const clusters: number[][][] = outers.map((outer) => [outer]);
    for (const inner of inners) {
      const outerIndex = outerPoints.findIndex((outer) =>
        inner.some((id) => pointInPolygon(this.nodes.position(id), outer)),
      );
      if (outerIndex !== -1) {
        clusters[outerIndex].push(inner);
      }
    }

    const coordinates: GeoJSON.Position[][][] = [];
    for (const cluster of clusters) {
      const rings: GeoJSON.Position[][] = [];
      for (const ring of cluster) {
        if (ring.length < 4) {
          continue;
        }
        rings.push(ring.map((id) => this.nodes.position(id)));
      }
      if (rings.length > 0) {
        coordinates.push(rings);
      }
    }
    if (coordinates.length === 0) {
      return null;
    }
    return coordinates.length === 1
      ? { type: "Polygon", coordinates: coordinates[0] }
      : { type: "MultiPolygon", coordinates: coordinates };
  }
}

/**
 * Joins ways sharing end nodes into linestrings or linear rings.
 * Ways that don't connect anywhere start their own linestring.
 */
function joinWays(ways: number[][]): number[][] {
  const remaining = ways.slice();
  const joined: number[][] = [];
  while (remaining.length > 0) {
    const current = remaining.pop()!.slice();
    joined.push(current);
    while (remaining.length > 0 && current[0] !== current[current.length - 1]) {
      const first = current[0];
      const last = current[current.length - 1];
      let i = 0;
      let found = false;
      for (; i < remaining.length; i++) {
        const way = remaining[i];
        if (way.length === 0) {
          continue;
        }
        if (last === way[0]) {
          current.push(...way.slice(1));
          found = true;
          break;
        } else if (last === way[way.length - 1]) {
          current.push(...way.slice(0, -1).reverse());
          found = true;
          break;
        } else if (first === way[way.length - 1]) {
          current.unshift(...way.slice(0, -1));
          found = true;
          break;
        } else if (first === way[0]) {
          current.unshift(...way.slice(1).reverse());
          found = true;
          break;
        }
      }
      if (!found) {
        // Invalid geometry (dangling way, unclosed ring)
        break;
      }
      remaining.splice(i, 1);
    }
  }
  return joined;
}

// ray-casting algorithm based on http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html
function pointInPolygon(
  point: GeoJSON.Position,
  polygon: GeoJSON.Position[],
): boolean {
  const x = point[0];
  const y = point[1];
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Enforces the RFC 7946 right-hand rule: outer rings counterclockwise, inner
 * rings clockwise.
 */
function rewind(feature: OSMGeoJSONFeature): OSMGeoJSONFeature {
  const geometry = feature.geometry;
  if (geometry.type === "Polygon") {
    rewindRings(geometry.coordinates);
  } else if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach(rewindRings);
  }
  return feature;
}

function rewindRings(rings: GeoJSON.Position[][]) {
  rings.forEach((ring, index) => rewindRing(ring, index !== 0));
}

function rewindRing(ring: GeoJSON.Position[], clockwise: boolean) {
  // Shoelace formula with compensated summation.
  let area = 0;
  let error = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const term = (ring[i][0] - ring[j][0]) * (ring[j][1] + ring[i][1]);
    const sum = area + term;
    error +=
      Math.abs(area) >= Math.abs(term) ? area - sum + term : term - sum + area;
    area = sum;
  }
  if (area + error >= 0 !== clockwise) {
    ring.reverse();
  }
}
