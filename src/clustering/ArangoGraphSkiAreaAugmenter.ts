import { aql, Database } from "arangojs";
import streamToPromise from "stream-to-promise";
import { readGeoJSONFeatures } from "../io/GeoJSONReader";
import { writeGeoJSONFeatures } from "../io/GeoJSONWriter";
import { mapAsync } from "../transforms/StreamTransforms";
import { AugmentedMapFeature, MapFeature } from "./MapObject";

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

          feature.properties.skiAreas = skiAreas;
          return feature;
        })
      )
      .pipe(writeGeoJSONFeatures(outputPath))
  );
}

async function getSkiAreas(
  feature: MapFeature,
  client: Database
): Promise<string[]> {
  const query = aql`
  FOR object in ${client.collection("objects")}
  FILTER object._key == ${feature.properties.id}
  RETURN object.skiAreas
`;

  const cursor = await client.query(query);
  return await cursor.next();
}
