import path from "path";
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

  // Combine all layers into single MBTiles file
  await runCommand("tile-join", [
    "-f",
    "--no-tile-size-limit",
    "-o",
    tilesConfig.mbTilesPath,
    path.join(workingDir, "ski_areas.mbtiles"),
    path.join(workingDir, "runs.mbtiles"),
    path.join(workingDir, "lifts.mbtiles"),
  ]);

  console.log("Tiles generation complete");
}
