import { Config } from "../Config";
import {
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
} from "../io/GeoJSONFiles";
import { PostgreSQLClusteringDatabase } from "./database/PostgreSQLClusteringDatabase";
import { SkiAreaClusteringService } from "./SkiAreaClusteringService";

export default async function clusterSkiAreas(
  intermediatePaths: GeoJSONIntermediatePaths,
  outputPaths: GeoJSONOutputPaths,
  config: Config,
): Promise<void> {
  const database = new PostgreSQLClusteringDatabase(config.postgresCache);
  const clusteringService = new SkiAreaClusteringService(database);

  try {
    await database.initialize();

    await clusteringService.clusterSkiAreas(
      intermediatePaths.skiAreas,
      intermediatePaths.lifts,
      intermediatePaths.runs,
      outputPaths.skiAreas,
      outputPaths.lifts,
      outputPaths.runs,
      config.geocodingServer,
      config.snowCover,
      config.postgresCache,
    );
  } finally {
    await database.close();
  }
}
