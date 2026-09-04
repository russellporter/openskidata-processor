import { Config } from "../Config.js";
import {
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
} from "../io/GeoJSONFiles.js";
import { closeSnowCoverCaches } from "../utils/snowCoverHistory.js";
import { PostgreSQLClusteringDatabase } from "./database/PostgreSQLClusteringDatabase.js";
import { SkiAreaClusteringService } from "./SkiAreaClusteringService.js";

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
      intermediatePaths.spots,
      outputPaths.skiAreas,
      outputPaths.lifts,
      outputPaths.runs,
      outputPaths.spots,
      config.geocodingServer,
      config.snowCover,
      config.postgresCache,
      config.elevationServer,
    );
  } finally {
    await closeSnowCoverCaches();
    await database.close();
  }
}
