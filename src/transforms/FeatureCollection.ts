import { Transform } from "stream";

const OPEN = '{"type": "FeatureCollection", "features":[\n';
const SEPARATOR = "\n,\n";
const CLOSE = "\n]}\n";

/**
 * Serializes a stream of features into a GeoJSON FeatureCollection document,
 * without ever holding the whole collection in memory.
 *
 * This reproduces JSONStream.stringify(open, separator, close) exactly,
 * including the empty case, which emits the opening and closing text with no
 * features between them so the result is still a valid FeatureCollection.
 */
export default function toFeatureCollection(): Transform {
  let wroteAnyFeature = false;

  return new Transform({
    objectMode: true,
    transform(feature, _, done) {
      if (wroteAnyFeature) {
        done(null, SEPARATOR + JSON.stringify(feature));
      } else {
        wroteAnyFeature = true;
        done(null, OPEN + JSON.stringify(feature));
      }
    },
    flush(done) {
      done(null, (wroteAnyFeature ? "" : OPEN) + CLOSE);
    },
  });
}
