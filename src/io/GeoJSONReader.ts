import { createReadStream } from "fs";
import { Readable } from "stream";
import { chain } from "stream-chain";
import { parser } from "stream-json";
import { pick } from "stream-json/filters/pick.js";
import { streamArray } from "stream-json/streamers/stream-array.js";

/**
 * Streams the features out of a GeoJSON FeatureCollection file without loading
 * the whole document into memory.
 */
export function readGeoJSONFeatures(path: string): Readable {
  return chain([
    createReadStream(path, { encoding: "utf8" }),
    parser(),
    pick({ filter: "features" }),
    streamArray(),
    // streamArray emits {key, value} envelopes; downstream wants the feature.
    (entry: { key: number; value: unknown }) => entry.value,
  ]);
}
