import * as path from "path";
import { performanceMonitor } from "../clustering/database/PerformanceMonitor.js";
import { TilesConfig } from "../Config.js";
import { CommonGeoJSONPaths } from "../io/GeoJSONFiles.js";
import { runCommand } from "../utils/ProcessRunner.js";

/**
 * One tippecanoe invocation per output layer.
 *
 * The flags are a contract with the rendered map, not incidental: `-Z`/`-z` set the zoom
 * range each layer is built for, `-B` controls the zoom at which features start being
 * included, and `--drop-densest-as-needed` decides what survives at low zoom. Changing
 * any of them changes which features appear on the map.
 */
const TILE_LAYERS: readonly {
  readonly name: string;
  readonly operation: string;
  readonly outputFile: string;
  readonly source: (paths: CommonGeoJSONPaths) => string;
  readonly args: readonly string[];
}[] = [
  {
    name: "lifts",
    operation: "Generating lift tiles",
    outputFile: "lifts.mbtiles",
    source: (paths) => paths.lifts,
    args: [
      "-z",
      "15",
      "-Z",
      "5",
      "--simplify-only-low-zooms",
      "--drop-densest-as-needed",
    ],
  },
  {
    name: "runs",
    operation: "Generating run tiles",
    outputFile: "runs.mbtiles",
    source: (paths) => paths.runs,
    args: [
      "-z",
      "15",
      "-Z",
      "9",
      "--simplify-only-low-zooms",
      "--drop-densest-as-needed",
    ],
  },
  {
    name: "skiareas",
    operation: "Generating ski area tiles",
    outputFile: "ski_areas.mbtiles",
    source: (paths) => paths.skiAreas,
    args: ["-z", "15", "-Z", "0", "-B", "0", "--drop-densest-as-needed"],
  },
  {
    name: "spots",
    operation: "Generating spot tiles",
    outputFile: "spots.mbtiles",
    source: (paths) => paths.spots,
    args: [
      "-z",
      "15",
      "-Z",
      "9",
      "-B",
      "10",
      "--simplify-only-low-zooms",
      "--drop-densest-as-needed",
    ],
  },
];

export async function generateTiles(
  geoJSONPaths: CommonGeoJSONPaths,
  workingDir: string,
  tilesConfig: TilesConfig,
): Promise<void> {
  console.log("Generating tiles...");

  // The four layer builds are independent — they read different files and write
  // different files — and were previously awaited one after another, so the step cost
  // the sum of all four. tippecanoe is itself multithreaded, so this is bounded rather
  // than unlimited: TILE_CONCURRENCY caps how many run at once, because four
  // simultaneous planet-scale builds can exhaust memory on a smaller machine.
  const concurrency = Math.max(
    1,
    Math.min(
      TILE_LAYERS.length,
      process.env.TILE_CONCURRENCY
        ? parseInt(process.env.TILE_CONCURRENCY, 10)
        : 2,
    ),
  );

  const queue = [...TILE_LAYERS];
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const layer = queue.shift();
      if (!layer) {
        return;
      }
      await performanceMonitor.withOperation(layer.operation, async () => {
        await runCommand("tippecanoe", [
          "-Q",
          "-o",
          path.join(workingDir, layer.outputFile),
          "-f",
          ...layer.args,
          `--named-layer=${layer.name}:${layer.source(geoJSONPaths)}`,
        ]);
      });
    }
  });

  await Promise.all(workers);

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
