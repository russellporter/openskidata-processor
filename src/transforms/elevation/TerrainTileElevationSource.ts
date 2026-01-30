import sharp from "sharp";
import {
  lonLatToTilePixel,
  getInterpolationSetup,
  InterpolationSetup,
} from "./TileCoordinates";
import { elevationAtPixel, bilinearInterpolate } from "./ElevationDecoder";
import { TileDiskCache } from "./TileDiskCache";

type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

const USER_AGENT =
  "openskidata-processor/1.0.0 (+https://github.com/russellporter/openskidata-processor)";
const CHANNELS = 3; // RGB

export interface TerrainTileConfig {
  urlTemplate: string;
  tileSize: number;
  cacheDir: string;
  cacheMaxTiles: number;
  tileConcurrency: number;
}

interface DecodedTile {
  buffer: Buffer;
  width: number;
}

interface PointSetup {
  index: number;
  setup: InterpolationSetup;
}

export class TerrainTileElevationSource {
  private readonly config: TerrainTileConfig;
  private readonly cache: TileDiskCache;

  constructor(config: TerrainTileConfig) {
    this.config = config;
    this.cache = new TileDiskCache(config.cacheDir, config.cacheMaxTiles);
  }

  async initialize(): Promise<void> {
    await this.cache.initialize();
  }

  async close(): Promise<void> {
    await this.cache.close();
  }

  /**
   * Fetches elevations for an array of [lat, lon] coordinates.
   * Tries each zoom level in order. Returns results in input order.
   */
  async fetchElevations(
    coordinates: number[][],
    zooms: number[],
  ): Promise<Result<number | null>[]> {
    const results: Result<number | null>[] = coordinates.map(() => ({
      ok: true,
      value: null,
    }));

    // Track which coordinates still need data
    let remaining: Array<{ index: number; lat: number; lon: number }> =
      coordinates.map(([lat, lon], index) => ({ index, lat, lon }));

    for (const zoom of zooms) {
      if (remaining.length === 0) break;

      // 1. Compute interpolation setup for each remaining point
      const pointSetups: PointSetup[] = [];
      const tileKeys = new Map<string, { z: number; x: number; y: number }>();

      for (const { index, lat, lon } of remaining) {
        const { tileX, tileY, pixelX, pixelY } = lonLatToTilePixel(
          lon,
          lat,
          zoom,
          this.config.tileSize,
        );

        const setup = getInterpolationSetup(
          tileX,
          tileY,
          pixelX,
          pixelY,
          zoom,
          this.config.tileSize,
        );

        if (setup === null) {
          // At world boundary — skip, stays null for next zoom
          continue;
        }

        pointSetups.push({ index, setup });

        // 2. Collect all unique tiles from all corners
        for (const corner of setup.corners) {
          const key = `${zoom}/${corner.tileX}/${corner.tileY}`;
          if (!tileKeys.has(key)) {
            tileKeys.set(key, { z: zoom, x: corner.tileX, y: corner.tileY });
          }
        }
      }

      // 3. Fetch all unique tiles with bounded concurrency
      const decodedTiles = new Map<string, DecodedTile | null>();
      const tileErrors = new Map<string, string>();
      const allTileKeys = Array.from(tileKeys.keys());

      for (
        let i = 0;
        i < allTileKeys.length;
        i += this.config.tileConcurrency
      ) {
        const batch = allTileKeys.slice(i, i + this.config.tileConcurrency);
        await Promise.all(
          batch.map(async (key) => {
            const { z, x, y } = tileKeys.get(key)!;
            const tileResult = await this.fetchAndDecodeTile(z, x, y);

            if (!tileResult.ok) {
              tileErrors.set(key, tileResult.error);
              return;
            }

            if (tileResult.value === null) {
              decodedTiles.set(key, null);
            } else {
              decodedTiles.set(key, {
                buffer: tileResult.value.buffer,
                width: tileResult.value.width,
              });
            }
          }),
        );
      }

      // 4. Process each point using decoded tiles
      for (const { index, setup } of pointSetups) {
        const { corners, fx, fy } = setup;

        // Check if any corner's tile had an error
        let hasError = false;
        for (const corner of corners) {
          const key = `${zoom}/${corner.tileX}/${corner.tileY}`;
          if (tileErrors.has(key)) {
            results[index] = { ok: false, error: tileErrors.get(key)! };
            hasError = true;
            break;
          }
        }
        if (hasError) continue;

        // Check if any corner's tile is missing (404)
        let hasMissing = false;
        for (const corner of corners) {
          const key = `${zoom}/${corner.tileX}/${corner.tileY}`;
          if (decodedTiles.get(key) === null || !decodedTiles.has(key)) {
            hasMissing = true;
            break;
          }
        }
        if (hasMissing) {
          // Skip — stays null, tries next zoom
          continue;
        }

        // Read elevation at each corner
        const elevations: number[] = [];
        for (const corner of corners) {
          const key = `${zoom}/${corner.tileX}/${corner.tileY}`;
          const tile = decodedTiles.get(key)!;
          elevations.push(
            elevationAtPixel(
              tile.buffer,
              corner.pixelX,
              corner.pixelY,
              tile.width,
              CHANNELS,
            ),
          );
        }

        // Short-circuit for integer coordinates
        if (fx === 0 && fy === 0) {
          results[index] = { ok: true, value: elevations[0] };
        } else {
          results[index] = {
            ok: true,
            value: bilinearInterpolate(
              elevations[0],
              elevations[1],
              elevations[2],
              elevations[3],
              fx,
              fy,
            ),
          };
        }
      }

      // Filter to coordinates still needing data
      remaining = remaining.filter((item) => {
        const result = results[item.index];
        return result.ok && result.value === null;
      });
    }

    return results;
  }

  private async fetchAndDecodeTile(
    z: number,
    x: number,
    y: number,
  ): Promise<Result<{ buffer: Buffer; width: number; height: number } | null>> {
    // Check if known missing
    if (this.cache.isMissing(z, x, y)) {
      return { ok: true, value: null };
    }

    // Check disk cache
    let tileData = this.cache.get(z, x, y);

    if (tileData === null) {
      // Fetch from network
      const fetchResult = await this.fetchTileFromNetwork(z, x, y);
      if (!fetchResult.ok) {
        return { ok: false, error: fetchResult.error };
      }
      if (fetchResult.value === null) {
        // 404 - tile doesn't exist
        this.cache.markMissing(z, x, y);
        return { ok: true, value: null };
      }
      tileData = fetchResult.value;
      await this.cache.set(z, x, y, tileData);
    }

    // Decode WebP to raw RGB buffer
    try {
      const { data, info } = await sharp(tileData)
        .raw()
        .toBuffer({ resolveWithObject: true });
      return {
        ok: true,
        value: { buffer: data, width: info.width, height: info.height },
      };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to decode tile ${z}/${x}/${y}: ${error}`,
      };
    }
  }

  private async fetchTileFromNetwork(
    z: number,
    x: number,
    y: number,
  ): Promise<Result<Buffer | null>> {
    const url = this.config.urlTemplate
      .replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y));

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
        },
      });

      if (response.status === 404) {
        return { ok: true, value: null };
      }

      if (!response.ok) {
        return {
          ok: false,
          error: `HTTP ${response.status} fetching tile ${z}/${x}/${y}`,
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      return { ok: true, value: Buffer.from(arrayBuffer) };
    } catch (error) {
      return {
        ok: false,
        error: `Network error fetching tile ${z}/${x}/${y}: ${error}`,
      };
    }
  }
}
