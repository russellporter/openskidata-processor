import * as arangojs from "arangojs";
import clusterArangoGraph from "./ArangoGraphClusterer";
import loadArangoGraph from "./ArangoGraphLoader";
import augmentGeoJSONWithSkiAreas from "./ArangoGraphSkiAreaAugmenter";
import exportSkiAreasGeoJSON from "./ArangoSkiAreasExporter";

export default async function clusterSkiAreas(
  skiAreasPath: string,
  outputSkiAreasPath: string,
  liftsPath: string,
  outputLiftsPath: string,
  runsPath: string,
  outputRunsPath: string,
  arangoDBURL: string
): Promise<void> {
  const client = new arangojs.Database(arangoDBURL);

  try {
    await client.dropDatabase("cluster");
  } catch (_) {}

  await client.createDatabase("cluster");
  client.useDatabase("cluster");

  console.log("Loading graph into ArangoDB");
  await loadArangoGraph(skiAreasPath, liftsPath, runsPath, client);

  console.log("Clustering ski areas");
  await clusterArangoGraph(client);

  console.log("Augmenting runs");
  await augmentGeoJSONWithSkiAreas(runsPath, outputRunsPath, client);

  console.log("Augmenting lifts");
  await augmentGeoJSONWithSkiAreas(liftsPath, outputLiftsPath, client);

  console.log("Exporting ski areas");
  await exportSkiAreasGeoJSON(outputSkiAreasPath, client);
}
