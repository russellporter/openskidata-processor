import { createWriteStream } from "fs";
import { stringify } from "JSONStream";

export function writeGeoJSONFeatures(path: string): NodeJS.WritableStream {
  const jsonTransform = stringify(
    '{"type": "FeatureCollection", "features":[\n',
    "\n,\n",
    "]}\n"
  );
  jsonTransform.pipe(createWriteStream(path));
  return jsonTransform;
}
