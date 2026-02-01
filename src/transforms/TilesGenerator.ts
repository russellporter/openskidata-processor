import * as path from "path";
import { performanceMonitor } from "../clustering/database/PerformanceMonitor";
import { TilesConfig } from "../Config";
import { CommonGeoJSONPaths } from "../io/GeoJSONFiles";
import { runCommand } from "../utils/ProcessRunner";

export async function generateTiles(
  geoJSONPaths: CommonGeoJSONPaths,
  workingDir: string,
  tilesConfig: TilesConfig,
): Promise<void> {
  console.log("Generating tiles...");

  // Generate individual layer MBTiles
  await performanceMonitor.withOperation("Generating lift tiles", async () => {
    await runCommand("tippecanoe", [
      "-Q",
      "-o",
      path.join(workingDir, "lifts.mbtiles"),
      "-f",
      "-z",
      "15",
      "-Z",
      "5",
      "--simplify-only-low-zooms",
      "--drop-densest-as-needed",
      "--named-layer=lifts:" + geoJSONPaths.lifts,
    ]);
  });

  await performanceMonitor.withOperation("Generating run tiles", async () => {
    await runCommand("tippecanoe", [
      "-Q",
      "-o",
      path.join(workingDir, "runs.mbtiles"),
      "-f",
      "-z",
      "15",
      "-Z",
      "9",
      "--simplify-only-low-zooms",
      "--drop-densest-as-needed",
      "--named-layer=runs:" + geoJSONPaths.runs,
    ]);
  });

  await performanceMonitor.withOperation(
    "Generating ski area tiles",
    async () => {
      await runCommand("tippecanoe", [
        "-Q",
        "-o",
        path.join(workingDir, "ski_areas.mbtiles"),
        "-f",
        "-z",
        "15",
        "-Z",
        "0",
        "-B",
        "0",
        "--drop-densest-as-needed",
        "--named-layer=skiareas:" + geoJSONPaths.skiAreas,
      ]);
    },
  );

  await performanceMonitor.withOperation("Generating spot tiles", async () => {
    await runCommand("tippecanoe", [
      "-Q",
      "-o",
      path.join(workingDir, "spots.mbtiles"),
      "-f",
      "-z",
      "15",
      "-Z",
      "9",
      "-B",
      "10",
      "--simplify-only-low-zooms",
      "--drop-densest-as-needed",
      "--named-layer=spots:" + geoJSONPaths.spots,
    ]);
  });

  // Combine all layers into single MBTiles file
  await performanceMonitor.withOperation("Combining tiles", async () => {
    await runCommand("tile-join", [
      "-f",
      "--no-tile-size-limit",
      "-o",
      tilesConfig.mbTilesPath,
      path.join(workingDir, "ski_areas.mbtiles"),
      path.join(workingDir, "runs.mbtiles"),
      path.join(workingDir, "lifts.mbtiles"),
      path.join(workingDir, "spots.mbtiles"),
    ]);
  });

  console.log("Tiles generation complete");
}
