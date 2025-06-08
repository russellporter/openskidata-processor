import { aql, Database } from "arangojs";
import { createWriteStream } from "fs";
import { FeatureType } from "openskidata-format";
import streamToPromise from "stream-to-promise";
import { SnowCoverConfig } from "../Config";
import { readGeoJSONFeatures } from "../io/GeoJSONReader";
import toFeatureCollection from "../transforms/FeatureCollection";
import { mapAsync } from "../transforms/StreamTransforms";
import { toSkiAreaSummary } from "../transforms/toSkiAreaSummary";
import { getSnowCoverHistory } from "../utils/snowCoverHistory";
import {
  AugmentedMapFeature,
  MapFeature,
  MapObjectType,
  RunObject,
  SkiAreaObject,
} from "./MapObject";
import objectToFeature from "./ObjectToFeature";

export default async function augmentGeoJSONFeatures(
  inputPath: string,
  outputPath: string,
  client: Database,
  featureType: FeatureType,
  snowCoverConfig: SnowCoverConfig | null,
) {
  await streamToPromise(
    readGeoJSONFeatures(inputPath)
      .pipe(
        mapAsync(async (feature: AugmentedMapFeature) => {
          let skiAreas = await getSkiAreas(feature, client);

          feature.properties.skiAreas = skiAreas
            .map(objectToFeature)
            .map(toSkiAreaSummary);

          // Add snow cover history for runs if snow cover config is provided
          if (snowCoverConfig && featureType === FeatureType.Run) {
            const runObject = await getRunObject(feature, client);
            if (runObject) {
              const snowCoverHistory = generateRunSnowCoverHistory(
                runObject,
                snowCoverConfig,
              );
              if (snowCoverHistory && snowCoverHistory.length > 0) {
                feature.properties.snowCoverHistory = snowCoverHistory;
              }
            }
          }

          return feature;
        }, 10),
      )
      .pipe(toFeatureCollection())
      .pipe(createWriteStream(outputPath)),
  );
}

async function getSkiAreas(
  feature: MapFeature,
  client: Database,
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

async function getRunObject(
  feature: MapFeature,
  client: Database,
): Promise<RunObject | null> {
  const query = aql`
  FOR object in ${client.collection("objects")}
  FILTER object._key == ${feature.properties.id}
  FILTER object.type == ${MapObjectType.Run}
  RETURN object
`;

  const cursor = await client.query(query);
  const results = await cursor.all();
  return results.length > 0 ? results[0] : null;
}

function generateRunSnowCoverHistory(
  runObject: RunObject,
  snowCoverConfig: SnowCoverConfig,
) {
  try {
    return getSnowCoverHistory(snowCoverConfig, runObject.viirsPixels);
  } catch (error) {
    console.error(
      `Failed to generate snow cover history for run ${runObject._key}:`,
      error,
    );
    return null;
  }
}
