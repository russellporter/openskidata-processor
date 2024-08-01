import { aql, Database } from "arangojs";
import { ArrayCursor } from "arangojs/cursor";
import { createWriteStream } from "fs";
import { SkiAreaFeature } from "openskidata-format";
import { Readable } from "stream";
import streamToPromise from "stream-to-promise";
import toFeatureCollection from "../transforms/FeatureCollection";
import { map } from "../transforms/StreamTransforms";
import { MapObjectType, SkiAreaObject } from "./MapObject";
import objectToFeature from "./ObjectToFeature";

export default async function exportSkiAreasGeoJSON(
  path: string,
  client: Database,
) {
  const objectsCollection = client.collection("objects");
  const cursor = await client.query(
    aql`
  FOR object IN ${objectsCollection}
  FILTER object.type == ${MapObjectType.SkiArea}
  RETURN object`,
    { stream: true },
  );
  await streamToPromise(
    arangoQueryStream(cursor, client)
      .pipe(map<SkiAreaObject, SkiAreaFeature>(objectToFeature))
      .pipe(toFeatureCollection())
      .pipe(createWriteStream(path)),
  );
}

function arangoQueryStream(
  streamingCursor: ArrayCursor,
  client: Database,
): Readable {
  return new Readable({
    objectMode: true,
    read: function (this: Readable, _) {
      const readable = this;
      streamingCursor
        .next()
        .catch((_: any) => {
          console.log("Failed querying ArangoDB, stopping.");
          readable.push(null);
        })
        .then((value: any) => {
          readable.push(value || null);
        });
    },
  });
}
