import * as arangojs from "arangojs";
import { GeocodingServerConfig } from "../Config";
import {
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
} from "../io/GeoJSONFiles";
import Geocoder from "../transforms/Geocoder";
import clusterArangoGraph from "./ArangoGraphClusterer";
import loadArangoGraph from "./ArangoGraphLoader";
import augmentGeoJSONWithSkiAreas from "./ArangoGraphSkiAreaAugmenter";
import exportSkiAreasGeoJSON from "./ArangoSkiAreasExporter";

export default async function clusterSkiAreas(
  intermediatePaths: GeoJSONIntermediatePaths,
  outputPaths: GeoJSONOutputPaths,
  arangoDBURL: string,
  geocoderConfig: GeocodingServerConfig | null,
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
  );

  console.log("Augmenting runs");
  await augmentGeoJSONWithSkiAreas(
    intermediatePaths.runs,
    outputPaths.runs,
    client,
  );

  console.log("Augmenting lifts");
  await augmentGeoJSONWithSkiAreas(
    intermediatePaths.lifts,
    outputPaths.lifts,
    client,
  );

  console.log("Exporting ski areas");
  await exportSkiAreasGeoJSON(outputPaths.skiAreas, client);
}
