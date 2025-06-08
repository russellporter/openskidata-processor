import * as arangojs from "arangojs";
import { FeatureType } from "openskidata-format";
import { GeocodingServerConfig, SnowCoverConfig } from "../Config";
import {
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
} from "../io/GeoJSONFiles";
import Geocoder from "../transforms/Geocoder";
import clusterArangoGraph from "./ArangoGraphClusterer";
import loadArangoGraph from "./ArangoGraphLoader";
import augmentGeoJSONFeatures from "./ArangoGraphSkiAreaAugmenter";
import exportSkiAreasGeoJSON from "./ArangoSkiAreasExporter";

export default async function clusterSkiAreas(
  intermediatePaths: GeoJSONIntermediatePaths,
  outputPaths: GeoJSONOutputPaths,
  arangoDBURL: string,
  geocoderConfig: GeocodingServerConfig | null,
  snowCoverConfig: SnowCoverConfig | null,
): Promise<void> {
  let client = new arangojs.Database(arangoDBURL);

  try {
    await client.dropDatabase("cluster");
  } catch (_) {}

  client = await client.createDatabase("cluster");

  console.log("Loading graph into ArangoDB");
  await loadArangoGraph(
    intermediatePaths.skiAreas,
    intermediatePaths.lifts,
    intermediatePaths.runs,
    client,
  );

  console.log("Clustering ski areas");
  await clusterArangoGraph(
    client,
    geocoderConfig ? new Geocoder(geocoderConfig) : null,
    snowCoverConfig,
  );

  console.log("Augmenting runs");
  await augmentGeoJSONFeatures(
    intermediatePaths.runs,
    outputPaths.runs,
    client,
    FeatureType.Run,
    snowCoverConfig,
  );

  console.log("Augmenting lifts");
  await augmentGeoJSONFeatures(
    intermediatePaths.lifts,
    outputPaths.lifts,
    client,
    FeatureType.Lift,
    null,
  );

  console.log("Exporting ski areas");
  await exportSkiAreasGeoJSON(outputPaths.skiAreas, client);
}
