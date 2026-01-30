import * as fs from "fs";
import * as path from "path";

interface CacheIndex {
  // Ordered from least-recently-accessed to most-recently-accessed
  keys: string[];
}

export class TileDiskCache {
  private readonly cacheDir: string;
  private readonly maxTiles: number;
  // Map preserves insertion order; we maintain LRU order by re-inserting on access
  private lruIndex: Map<string, true> = new Map();
  private missingTiles: Set<string> = new Set();

  constructor(cacheDir: string, maxTiles: number) {
    this.cacheDir = cacheDir;
    this.maxTiles = maxTiles;
  }

  async initialize(): Promise<void> {
    fs.mkdirSync(this.cacheDir, { recursive: true });

    // Load persisted LRU index
    const indexPath = path.join(this.cacheDir, "cache-index.json");
    if (fs.existsSync(indexPath)) {
      try {
        const data = JSON.parse(
          fs.readFileSync(indexPath, "utf-8"),
        ) as CacheIndex;
        for (const key of data.keys) {
          this.lruIndex.set(key, true);
        }
      } catch (error) {
        console.warn(`Corrupted cache index at ${indexPath}, clearing:`, error);
        this.lruIndex.clear();
      }
    }

    // Load persisted missing tiles
    const missingPath = path.join(this.cacheDir, "missing-tiles.json");
    if (fs.existsSync(missingPath)) {
      try {
        const data = JSON.parse(
          fs.readFileSync(missingPath, "utf-8"),
        ) as string[];
        for (const key of data) {
          this.missingTiles.add(key);
        }
      } catch (error) {
        console.warn(
          `Corrupted missing-tiles index at ${missingPath}, clearing:`,
          error,
        );
        this.missingTiles.clear();
      }
    }
  }

  async close(): Promise<void> {
    // Persist LRU index
    const indexPath = path.join(this.cacheDir, "cache-index.json");
    const indexData: CacheIndex = { keys: Array.from(this.lruIndex.keys()) };
    await atomicWrite(indexPath, JSON.stringify(indexData));

    // Persist missing tiles
    const missingPath = path.join(this.cacheDir, "missing-tiles.json");
    await atomicWrite(
      missingPath,
      JSON.stringify(Array.from(this.missingTiles)),
    );
  }

  isMissing(z: number, x: number, y: number): boolean {
    return this.missingTiles.has(tileKey(z, x, y));
  }

  markMissing(z: number, x: number, y: number): void {
    this.missingTiles.add(tileKey(z, x, y));
  }

  /**
   * Returns the cached tile file as a Buffer, or null if not cached.
   */
  get(z: number, x: number, y: number): Buffer | null {
    const key = tileKey(z, x, y);
    if (!this.lruIndex.has(key)) {
      return null;
    }

    const filePath = this.tilePath(z, x, y);
    if (!fs.existsSync(filePath)) {
      // File was removed externally; clean up index
      this.lruIndex.delete(key);
      return null;
    }

    // Move to most-recently-accessed
    this.lruIndex.delete(key);
    this.lruIndex.set(key, true);

    return fs.readFileSync(filePath);
  }

  /**
   * Stores a tile file in the cache.
   */
  async set(z: number, x: number, y: number, data: Buffer): Promise<void> {
    const key = tileKey(z, x, y);

    // Evict if at capacity and this is a new entry
    if (!this.lruIndex.has(key)) {
      while (this.lruIndex.size >= this.maxTiles) {
        // Evict least-recently-accessed (first entry in Map)
        const oldest = this.lruIndex.keys().next().value!;
        this.lruIndex.delete(oldest);
        const [ez, ex, ey] = oldest.split("/").map(Number);
        const evictPath = this.tilePath(ez, ex, ey);
        try {
          fs.unlinkSync(evictPath);
        } catch {
          // File may already be gone
        }
      }
    }

    // Write tile to disk atomically
    const filePath = this.tilePath(z, x, y);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    await atomicWrite(filePath, data);

    // Update LRU (move to most-recently-accessed)
    this.lruIndex.delete(key);
    this.lruIndex.set(key, true);
  }

  private tilePath(z: number, x: number, y: number): string {
    return path.join(this.cacheDir, String(z), String(x), `${y}.webp`);
  }
}

function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

async function atomicWrite(
  filePath: string,
  data: string | Buffer,
): Promise<void> {
  const tmpPath = filePath + `.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, filePath);
}
