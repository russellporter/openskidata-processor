import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { TileDiskCache } from "./TileDiskCache";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tile-cache-test-"));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("TileDiskCache", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it("returns null for uncached tile", async () => {
    const cache = new TileDiskCache(tmpDir, 100);
    await cache.initialize();

    expect(cache.get(12, 1094, 1576)).toBeNull();

    await cache.close();
  });

  it("stores and retrieves a tile", async () => {
    const cache = new TileDiskCache(tmpDir, 100);
    await cache.initialize();

    const data = Buffer.from("fake-tile-data");
    await cache.set(12, 1094, 1576, data);

    const result = cache.get(12, 1094, 1576);
    expect(result).not.toBeNull();
    expect(result!.toString()).toBe("fake-tile-data");

    await cache.close();
  });

  it("evicts least-recently-accessed tiles when full", async () => {
    const cache = new TileDiskCache(tmpDir, 2);
    await cache.initialize();

    await cache.set(12, 0, 0, Buffer.from("tile-0"));
    await cache.set(12, 0, 1, Buffer.from("tile-1"));

    // Access tile 0 to make it most-recently-accessed
    cache.get(12, 0, 0);

    // Add a third tile, which should evict tile 1 (least recently accessed)
    await cache.set(12, 0, 2, Buffer.from("tile-2"));

    expect(cache.get(12, 0, 0)).not.toBeNull();
    expect(cache.get(12, 0, 1)).toBeNull();
    expect(cache.get(12, 0, 2)).not.toBeNull();

    await cache.close();
  });

  it("tracks missing tiles", async () => {
    const cache = new TileDiskCache(tmpDir, 100);
    await cache.initialize();

    expect(cache.isMissing(12, 0, 0)).toBe(false);
    cache.markMissing(12, 0, 0);
    expect(cache.isMissing(12, 0, 0)).toBe(true);

    await cache.close();
  });

  it("persists and restores state across instances", async () => {
    const cache1 = new TileDiskCache(tmpDir, 100);
    await cache1.initialize();

    await cache1.set(12, 1, 2, Buffer.from("persisted-tile"));
    cache1.markMissing(12, 3, 4);
    await cache1.close();

    const cache2 = new TileDiskCache(tmpDir, 100);
    await cache2.initialize();

    const result = cache2.get(12, 1, 2);
    expect(result).not.toBeNull();
    expect(result!.toString()).toBe("persisted-tile");
    expect(cache2.isMissing(12, 3, 4)).toBe(true);

    await cache2.close();
  });

  it("handles externally deleted files gracefully", async () => {
    const cache = new TileDiskCache(tmpDir, 100);
    await cache.initialize();

    await cache.set(12, 0, 0, Buffer.from("data"));

    // Delete the file externally
    const filePath = path.join(tmpDir, "12", "0", "0.webp");
    fs.unlinkSync(filePath);

    // Should return null and clean up index
    expect(cache.get(12, 0, 0)).toBeNull();

    await cache.close();
  });
});
