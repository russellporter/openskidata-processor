import { createReadStream } from "fs";
import { parser } from "stream-json";
import { pick } from "stream-json/filters/Pick";
import { streamArray } from "stream-json/streamers/StreamArray";
import { chain } from "stream-chain";
import { Transform } from "stream";

export function readGeoJSONFeatures(path: string): NodeJS.ReadableStream {
  return chain([
    createReadStream(path, { encoding: "utf8" }),
    parser(),
    pick({ filter: "features" }),
    streamArray(),
    // StreamArray outputs {key, value}, extract just the value
    new Transform({
      objectMode: true,
      transform(chunk, encoding, callback) {
        callback(null, chunk.value);
      },
    }),
  ]);
}
