import { stringify } from "JSONStream";

export default function toFeatureCollection() {
  return stringify(
    '{"type": "FeatureCollection", "features":[\n',
    "\n,\n",
    "\n]}\n",
  );
}
