import { copyFileSync, existsSync, writeFileSync } from "fs";
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

    // TODO: extend clustering to spots
    // Copy spots directly from intermediate to output (spots don't need clustering)
    if (existsSync(intermediatePaths.spots)) {
      copyFileSync(intermediatePaths.spots, outputPaths.spots);
    } else {
      // Create empty spots file if it doesn't exist
      writeFileSync(
        outputPaths.spots,
        JSON.stringify({
          type: "FeatureCollection",
          features: [],
        }),
      );
    }
  } finally {
    await database.close();
  }
}
