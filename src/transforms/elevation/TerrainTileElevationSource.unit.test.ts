import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import nock from "nock";
import sharp from "sharp";
import { TerrainTileElevationSource } from "./TerrainTileElevationSource";
import { lonLatToTilePixel } from "./TileCoordinates";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "terrain-tile-test-"));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Creates a synthetic 512x512 WebP terrain tile where every pixel
 * encodes the given elevation using Mapbox Terrain RGB encoding.
 *
 * elevation = -10000 + (r * 65536 + g * 256 + b) * 0.1
 * => encodedValue = (elevation + 10000) / 0.1
 */
async function createElevationTile(elevation: number): Promise<Buffer> {
  const encodedValue = Math.round((elevation + 10000) / 0.1);
  const r = (encodedValue >> 16) & 0xff;
  const g = (encodedValue >> 8) & 0xff;
  const b = encodedValue & 0xff;

  const width = 512;
  const height = 512;
  const channels = 3;
  const buf = Buffer.alloc(width * height * channels);
  for (let i = 0; i < width * height; i++) {
    buf[i * channels] = r;
    buf[i * channels + 1] = g;
    buf[i * channels + 2] = b;
  }

  return await sharp(buf, { raw: { width, height, channels } })
    .webp({ lossless: true })
    .toBuffer();
}

describe("TerrainTileElevationSource", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    nock.cleanAll();
  });

  afterEach(() => {
    cleanup(tmpDir);
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it("fetches and decodes elevation from a tile", async () => {
    const tileWebp = await createElevationTile(500);

    nock("https://tiles.example.com")
      .get("/terrain/12/1082/1563.webp")
      .reply(200, tileWebp, { "Content-Type": "image/webp" });

    const source = new TerrainTileElevationSource({
      urlTemplate: "https://tiles.example.com/terrain/{z}/{x}/{y}.webp",
      tileSize: 512,
      cacheDir: tmpDir,
      cacheMaxTiles: 100,
      tileConcurrency: 4,
    });
    await source.initialize();

    // lat=39.1453, lon=-84.8866 maps to tile 1082/1563 at zoom 12
    const results = await source.fetchElevations([[39.1453, -84.8866]], [12]);

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    if (results[0].ok) {
      expect(results[0].value).toBeCloseTo(500, 0);
    }

    await source.close();
  });

  it("handles 404 missing tiles", async () => {
    nock("https://tiles.example.com")
      .get("/terrain/12/1082/1563.webp")
      .reply(404);

    const source = new TerrainTileElevationSource({
      urlTemplate: "https://tiles.example.com/terrain/{z}/{x}/{y}.webp",
      tileSize: 512,
      cacheDir: tmpDir,
      cacheMaxTiles: 100,
      tileConcurrency: 4,
    });
    await source.initialize();

    const results = await source.fetchElevations([[39.1453, -84.8866]], [12]);

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    if (results[0].ok) {
      expect(results[0].value).toBeNull();
    }

    await source.close();
  });

  it("returns error for server errors", async () => {
    nock("https://tiles.example.com")
      .get("/terrain/12/1082/1563.webp")
      .reply(500);

    const source = new TerrainTileElevationSource({
      urlTemplate: "https://tiles.example.com/terrain/{z}/{x}/{y}.webp",
      tileSize: 512,
      cacheDir: tmpDir,
      cacheMaxTiles: 100,
      tileConcurrency: 4,
    });
    await source.initialize();

    const results = await source.fetchElevations([[39.1453, -84.8866]], [12]);

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);

    await source.close();
  });

  it("caches tiles on disk and reuses them", async () => {
    const tileWebp = await createElevationTile(1200);

    const scope = nock("https://tiles.example.com")
      .get("/terrain/12/1082/1563.webp")
      .once()
      .reply(200, tileWebp, { "Content-Type": "image/webp" });

    const source = new TerrainTileElevationSource({
      urlTemplate: "https://tiles.example.com/terrain/{z}/{x}/{y}.webp",
      tileSize: 512,
      cacheDir: tmpDir,
      cacheMaxTiles: 100,
      tileConcurrency: 4,
    });
    await source.initialize();

    // First fetch - hits network
    const results1 = await source.fetchElevations([[39.1453, -84.8866]], [12]);
    expect(results1[0].ok).toBe(true);
    if (results1[0].ok) {
      expect(results1[0].value).toBeCloseTo(1200, 0);
    }

    // Second fetch - should use cache (nock would throw if another request was made)
    const results2 = await source.fetchElevations([[39.1453, -84.8866]], [12]);
    expect(results2[0].ok).toBe(true);
    if (results2[0].ok) {
      expect(results2[0].value).toBeCloseTo(1200, 0);
    }

    expect(scope.isDone()).toBe(true);

    await source.close();
  });

  it("groups multiple coordinates in the same tile", async () => {
    const tileWebp = await createElevationTile(800);

    const scope = nock("https://tiles.example.com")
      .get("/terrain/12/1082/1563.webp")
      .once()
      .reply(200, tileWebp, { "Content-Type": "image/webp" });

    const source = new TerrainTileElevationSource({
      urlTemplate: "https://tiles.example.com/terrain/{z}/{x}/{y}.webp",
      tileSize: 512,
      cacheDir: tmpDir,
      cacheMaxTiles: 100,
      tileConcurrency: 4,
    });
    await source.initialize();

    // Two points that map to the same tile at zoom 12
    const results = await source.fetchElevations(
      [
        [39.1453, -84.8866],
        [39.145, -84.886],
      ],
      [12],
    );

    expect(results).toHaveLength(2);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(true);
    // Only one tile fetch should have been made
    expect(scope.isDone()).toBe(true);

    await source.close();
  });

  it("interpolates across tile boundaries", async () => {
    const zoom = 12;
    const tileSize = 512;

    // Find a longitude on the boundary between tiles 1082 and 1083 at zoom 12.
    // Tile boundary: xWorld * scale = tileX * tileSize
    // At the right edge of tile 1082: xWorld * 4096 = 1083 * 512
    // For pixelX ≈ 511.5 in tile 1082: xWorld * 4096 = 1082 * 512 + 511.5
    const scale = 1 << zoom;
    const targetPixelX = 511.5;
    const xWorld = (1082 * tileSize + targetPixelX) / scale;
    // lon = (xWorld / tileSize - 0.5) * 360
    const lon = (xWorld / tileSize - 0.5) * 360;
    // Use a latitude that gives an integer pixelY to simplify the test
    const lat = 39.1453;

    // Verify our point maps to tile 1082 with fractional pixelX near the edge
    const tp = lonLatToTilePixel(lon, lat, zoom, tileSize);
    expect(tp.tileX).toBe(1082);
    expect(tp.pixelX).toBeCloseTo(511.5, 0);

    // Left tile (1082): all pixels at 500m
    const leftTile = await createElevationTile(500);
    // Right tile (1083): all pixels at 1000m
    const rightTile = await createElevationTile(1000);

    nock("https://tiles.example.com")
      .get(`/terrain/${zoom}/1082/${tp.tileY}.webp`)
      .reply(200, leftTile, { "Content-Type": "image/webp" })
      .get(`/terrain/${zoom}/1083/${tp.tileY}.webp`)
      .reply(200, rightTile, { "Content-Type": "image/webp" });

    // Also mock the Y+1 tile row in case pixelY is fractional and bottom
    // corners cross into the next tile row
    const nextTileY = tp.tileY + 1;
    const pixelYFrac = tp.pixelY - Math.floor(tp.pixelY);
    if (pixelYFrac > 0) {
      const leftTileBelow = await createElevationTile(500);
      const rightTileBelow = await createElevationTile(1000);
      nock("https://tiles.example.com")
        .get(`/terrain/${zoom}/1082/${nextTileY}.webp`)
        .reply(200, leftTileBelow, { "Content-Type": "image/webp" })
        .get(`/terrain/${zoom}/1083/${nextTileY}.webp`)
        .reply(200, rightTileBelow, { "Content-Type": "image/webp" });
    }

    const source = new TerrainTileElevationSource({
      urlTemplate: "https://tiles.example.com/terrain/{z}/{x}/{y}.webp",
      tileSize,
      cacheDir: tmpDir,
      cacheMaxTiles: 100,
      tileConcurrency: 4,
    });
    await source.initialize();

    const results = await source.fetchElevations([[lat, lon]], [zoom]);

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    if (results[0].ok) {
      // With fx ≈ 0.5 between left (500) and right (1000), expect ~750
      expect(results[0].value).toBeCloseTo(750, 0);
    }

    await source.close();
  });

  it("skips to next zoom when adjacent tile is missing (404)", async () => {
    const zoom = 12;
    const tileSize = 512;

    const scale = 1 << zoom;
    const targetPixelX = 511.5;
    const xWorld = (1082 * tileSize + targetPixelX) / scale;
    const lon = (xWorld / tileSize - 0.5) * 360;
    const lat = 39.1453;

    const tp = lonLatToTilePixel(lon, lat, zoom, tileSize);

    // Left tile exists, right tile is 404
    const leftTile = await createElevationTile(500);
    nock("https://tiles.example.com")
      .get(`/terrain/${zoom}/1082/${tp.tileY}.webp`)
      .reply(200, leftTile, { "Content-Type": "image/webp" })
      .get(`/terrain/${zoom}/1083/${tp.tileY}.webp`)
      .reply(404);

    // Mock tiles needed for fractional pixelY
    const pixelYFrac = tp.pixelY - Math.floor(tp.pixelY);
    if (pixelYFrac > 0) {
      const nextTileY = tp.tileY + 1;
      nock("https://tiles.example.com")
        .get(`/terrain/${zoom}/1082/${nextTileY}.webp`)
        .reply(200, leftTile, { "Content-Type": "image/webp" })
        .get(`/terrain/${zoom}/1083/${nextTileY}.webp`)
        .reply(404);
    }

    const source = new TerrainTileElevationSource({
      urlTemplate: "https://tiles.example.com/terrain/{z}/{x}/{y}.webp",
      tileSize,
      cacheDir: tmpDir,
      cacheMaxTiles: 100,
      tileConcurrency: 4,
    });
    await source.initialize();

    // Only one zoom level, so result should be null (adjacent tile missing)
    const results = await source.fetchElevations([[lat, lon]], [zoom]);

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    if (results[0].ok) {
      expect(results[0].value).toBeNull();
    }

    await source.close();
  });
});
