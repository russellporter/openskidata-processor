import { GeocodingServerConfig, SnowCoverConfig } from "../Config";
import {
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
} from "../io/GeoJSONFiles";
import { SQLiteClusteringDatabase } from "./database/SQLiteClusteringDatabase";
import { SkiAreaClusteringService } from "./SkiAreaClusteringService";

export default async function clusterSkiAreas(
  intermediatePaths: GeoJSONIntermediatePaths,
  outputPaths: GeoJSONOutputPaths,
  geocoderConfig: GeocodingServerConfig | null,
  snowCoverConfig: SnowCoverConfig | null,
): Promise<void> {
  const database = new SQLiteClusteringDatabase();
  const clusteringService = new SkiAreaClusteringService(database);

  try {
    await database.initialize();
    await database.createIndexes();

    await clusteringService.clusterSkiAreas(
      intermediatePaths.skiAreas,
      intermediatePaths.lifts,
      intermediatePaths.runs,
      outputPaths.skiAreas,
      outputPaths.lifts,
      outputPaths.runs,
      geocoderConfig,
      snowCoverConfig,
    );
  } finally {
    await database.close();
  }
}
