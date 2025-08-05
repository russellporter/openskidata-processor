import { createWriteStream } from "fs";
import { SkiAreaFeature } from "openskidata-format";
import { Readable } from "stream";
import streamToPromise from "stream-to-promise";
import toFeatureCollection from "../transforms/FeatureCollection";
import { map } from "../transforms/StreamTransforms";
import { SkiAreaObject } from "./MapObject";
import objectToFeature from "./ObjectToFeature";
import { ClusteringDatabase } from "./database/ClusteringDatabase";

export default async function exportSkiAreasGeoJSON(
  path: string,
  database: ClusteringDatabase,
) {
  const skiAreasIterable = await database.streamSkiAreas();

  await streamToPromise(
    asyncIterableToStream(skiAreasIterable)
      .pipe(map<SkiAreaObject, SkiAreaFeature>(objectToFeature))
      .pipe(toFeatureCollection())
      .pipe(createWriteStream(path)),
  );
}

function asyncIterableToStream(
  iterable: AsyncIterable<SkiAreaObject>,
): Readable {
  const iterator = iterable[Symbol.asyncIterator]();

  return new Readable({
    objectMode: true,
    read: function (this: Readable, _) {
      const readable = this;
      iterator
        .next()
        .catch((_: any) => {
          console.log("Failed reading from database, stopping.");
          readable.push(null);
          return undefined as any;
        })
        .then((result: IteratorResult<SkiAreaObject> | undefined) => {
          if (result) {
            readable.push(result.done ? null : result.value);
          }
        });
    },
  });
}
