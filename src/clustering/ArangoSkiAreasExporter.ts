import { aql, Database } from "arangojs";
import { ArrayCursor } from "arangojs/lib/cjs/cursor";
import { SkiAreaFeature } from "openskidata-format";
import { Readable } from "stream";
import streamToPromise from "stream-to-promise";
import { writeGeoJSONFeatures } from "../io/GeoJSONWriter";
import { map } from "../transforms/StreamTransforms";
import { MapObjectType, SkiAreaObject } from "./MapObject";

export default async function exportSkiAreasGeoJSON(
  path: string,
  client: Database
) {
  const objectsCollection = client.collection("objects");
  const cursor = await client.query(
    aql`
  FOR object IN ${objectsCollection}
  FILTER object.type == ${MapObjectType.SkiArea}
  RETURN object`,
    { options: { stream: true } }
  );
  await streamToPromise(
    arangoQueryStream(cursor, client)
      .pipe(
        map<SkiAreaObject, SkiAreaFeature>(skiArea => {
          return {
            properties: skiArea.properties,
            type: "Feature",
            geometry: skiArea.geometry
          };
        })
      )
      .pipe(writeGeoJSONFeatures(path))
  );
}

function arangoQueryStream(
  streamingCursor: ArrayCursor,
  client: Database
): Readable {
  return new Readable({
    objectMode: true,
    read: function(this: Readable, _) {
      const readable = this;
      streamingCursor
        .next()
        .catch(_ => {
          console.log("Failed querying ArangoDB, stopping.");
          readable.push(null);
        })
        .then(value => {
          readable.push(value || null);
        });
    }
  });
}
