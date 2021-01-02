import { aql, Database } from "arangojs";
import { createWriteStream } from "fs";
import streamToPromise from "stream-to-promise";
import { readGeoJSONFeatures } from "../io/GeoJSONReader";
import toFeatureCollection from "../transforms/FeatureCollection";
import { mapAsync } from "../transforms/StreamTransforms";
import { AugmentedMapFeature, MapFeature, SkiAreaObject } from "./MapObject";
import objectToFeature from "./ObjectToFeature";

export default async function augmentGeoJSONWithSkiAreas(
  inputPath: string,
  outputPath: string,
  client: Database
) {
  await streamToPromise(
    readGeoJSONFeatures(inputPath)
      .pipe(
        mapAsync(async (feature: AugmentedMapFeature) => {
          let skiAreas = await getSkiAreas(feature, client);

          feature.properties.skiAreas = skiAreas.map(objectToFeature);
          return feature;
        }, 10)
      )
      .pipe(toFeatureCollection())
      .pipe(createWriteStream(outputPath))
  );
}

async function getSkiAreas(
  feature: MapFeature,
  client: Database
): Promise<SkiAreaObject[]> {
  const query = aql`
  FOR object in ${client.collection("objects")}
  FILTER object._key == ${feature.properties.id}
  FOR skiAreaID in object.skiAreas
  FOR skiAreaObject in ${client.collection("objects")}
  FILTER skiAreaObject._key == skiAreaID
  RETURN skiAreaObject
`;

  const cursor = await client.query(query);
  return await cursor.all();
}
