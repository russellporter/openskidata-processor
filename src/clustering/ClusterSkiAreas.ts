import { GeocodingServerConfig, SnowCoverConfig } from "../Config";
import {
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
} from "../io/GeoJSONFiles";
import Geocoder from "../transforms/Geocoder";
import { ArangoClusteringDatabase } from "./database/ArangoClusteringDatabase";
import { SkiAreaClusteringService } from "./SkiAreaClusteringService";

export default async function clusterSkiAreas(
  intermediatePaths: GeoJSONIntermediatePaths,
  outputPaths: GeoJSONOutputPaths,
  arangoDBURL: string,
  geocoderConfig: GeocodingServerConfig | null,
  snowCoverConfig: SnowCoverConfig | null,
): Promise<void> {
  const database = new ArangoClusteringDatabase();
  const clusteringService = new SkiAreaClusteringService(database);

  try {
    await database.initialize(arangoDBURL);

    await clusteringService.clusterSkiAreas(
      intermediatePaths.skiAreas,
      intermediatePaths.lifts,
      intermediatePaths.runs,
      outputPaths.skiAreas,
      outputPaths.lifts,
      outputPaths.runs,
      geocoderConfig ? new Geocoder(geocoderConfig) : null,
      snowCoverConfig,
    );
  } finally {
    await database.close();
  }
}
