import { Config } from "../Config";
import {
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
} from "../io/GeoJSONFiles";
import { PostgreSQLClusteringDatabase } from "./database/PostgreSQLClusteringDatabase";
import { SkiAreaClusteringService } from "./SkiAreaClusteringService";
import { performanceMonitor } from "./database/PerformanceMonitor";

export default async function clusterSkiAreas(
  intermediatePaths: GeoJSONIntermediatePaths,
  outputPaths: GeoJSONOutputPaths,
  config: Config,
): Promise<void> {
  performanceMonitor.startOperation("cluster_ski_areas_total");
  
  const database = new PostgreSQLClusteringDatabase(config.workingDir);
  const clusteringService = new SkiAreaClusteringService(database);

  try {
    performanceMonitor.startOperation("database_initialization");
    await database.initialize();
    performanceMonitor.endOperation("database_initialization");

    performanceMonitor.startOperation("clustering_service_execution");
    await clusteringService.clusterSkiAreas(
      intermediatePaths.skiAreas,
      intermediatePaths.lifts,
      intermediatePaths.runs,
      outputPaths.skiAreas,
      outputPaths.lifts,
      outputPaths.runs,
      config.geocodingServer,
      config.snowCover,
    );
    performanceMonitor.endOperation("clustering_service_execution");
  } finally {
    performanceMonitor.startOperation("database_cleanup");
    await database.close();
    performanceMonitor.endOperation("database_cleanup");
    
    performanceMonitor.endOperation("cluster_ski_areas_total");
  }
}
