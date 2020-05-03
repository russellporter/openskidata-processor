import * as arangojs from "arangojs";
import {
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
} from "../io/GeoJSONFiles";
import clusterArangoGraph from "./ArangoGraphClusterer";
import loadArangoGraph from "./ArangoGraphLoader";
import augmentGeoJSONWithSkiAreas from "./ArangoGraphSkiAreaAugmenter";
import exportSkiAreasGeoJSON from "./ArangoSkiAreasExporter";

export default async function clusterSkiAreas(
  intermediatePaths: GeoJSONIntermediatePaths,
  outputPaths: GeoJSONOutputPaths,
  arangoDBURL: string
): Promise<void> {
  const client = new arangojs.Database(arangoDBURL);

  try {
    await client.dropDatabase("cluster");
  } catch (_) {}

  await client.createDatabase("cluster");
  client.useDatabase("cluster");

  console.log("Loading graph into ArangoDB");
  await loadArangoGraph(
    intermediatePaths.skiAreas,
    intermediatePaths.lifts,
    intermediatePaths.runs,
    client
  );

  console.log("Clustering ski areas");
  await clusterArangoGraph(client);

  console.log("Augmenting runs");
  await augmentGeoJSONWithSkiAreas(
    intermediatePaths.runs,
    outputPaths.runs,
    client
  );

  console.log("Augmenting lifts");
  await augmentGeoJSONWithSkiAreas(
    intermediatePaths.lifts,
    outputPaths.lifts,
    client
  );

  console.log("Exporting ski areas");
  await exportSkiAreasGeoJSON(outputPaths.skiAreas, client);
}
