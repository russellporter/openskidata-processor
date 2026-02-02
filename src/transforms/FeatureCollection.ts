import { Transform } from "stream";

export default function toFeatureCollection() {
  let isFirst = true;
  let hasWrittenHeader = false;

  return new Transform({
    objectMode: true,

    transform(feature, encoding, callback) {
      if (!hasWrittenHeader) {
        this.push('{"type": "FeatureCollection", "features":[\n');
        hasWrittenHeader = true;
        isFirst = false;
      } else if (!isFirst) {
        this.push("\n,\n");
      } else {
        isFirst = false;
      }
      this.push(JSON.stringify(feature));
      callback();
    },

    flush(callback) {
      if (!hasWrittenHeader) {
        // No features were written, but we still need valid GeoJSON
        this.push('{"type": "FeatureCollection", "features":[\n');
      }
      this.push("\n]}\n");
      callback();
    },
  });
}
