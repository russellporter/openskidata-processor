#!/usr/bin/env node
/**
 * Generates `rust/crates/osd-enrich/tests/tile_vectors.json`: the terrain-tile elevation source
 * as the real TypeScript behaves, for the Rust port to reproduce.
 *
 * - `pixels` / `setups`: `lonLatToTilePixel` and `getInterpolationSetup` on random and edge
 *   inputs (poles, the antimeridian, tile borders);
 * - `decode` / `bilinear`: the two terrain encodings and the interpolation;
 * - `images`: what sharp's `.raw()` gives for lossless and lossy WebP and PNG tiles;
 * - `scenarios`: the real `TerrainTileElevationSource` run against a local tile server (tiles
 *   present, absent, failing and corrupt), with a fresh cache directory: the results of each call,
 *   every URL requested, and the cache directory afterwards (files, LRU index, missing tiles),
 *   across a close and a reopen. Tiles are 16 pixels wide and loaded one at a time so the order
 *   of cache updates is deterministic.
 *
 * Usage: node rust/codegen/generate-tile-vectors.mjs [--check]
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { repoRoot } from "./tooling.mjs";
import { chance, int, pick, reseed } from "./osm-worlds.mjs";

const outPath = join(
  repoRoot,
  "rust/crates/osd-enrich/tests/tile_vectors.json",
);
const dist = (p) => import(join(repoRoot, "dist", p));
const coords = await dist("transforms/elevation/TileCoordinates.js");
const decoder = await dist("transforms/elevation/ElevationDecoder.js");
const { TerrainTileElevationSource } = await dist(
  "transforms/elevation/TerrainTileElevationSource.js",
);
const { default: sharp } = await import("sharp");

reseed(20261105);
const TILE = 16;

// ---------------------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------------------

const randomLon = () => (int(3600001) - 1800000) / 10000;
const randomLat = () => (int(1700001) - 850000) / 10000;
const pixelInputs = [];
for (let i = 0; i < 300; i++) {
  pixelInputs.push({
    lon: randomLon(),
    lat: randomLat(),
    zoom: int(15),
    tileSize: pick([16, 256, 512]),
  });
}
for (const lat of [90, -90, 89.5, -89.5, 85.0511, 0, 1e-9, -1e-9]) {
  for (const lon of [180, -180, 179.99999, -179.99999, 0]) {
    pixelInputs.push({ lon, lat, zoom: pick([0, 1, 12]), tileSize: 512 });
  }
}
const pixels = pixelInputs.map((input) => ({
  ...input,
  result: coords.lonLatToTilePixel(
    input.lon,
    input.lat,
    input.zoom,
    input.tileSize,
  ),
}));

const setups = [];
for (let i = 0; i < 400; i++) {
  const zoom = int(5);
  const n = 1 << zoom;
  const tileSize = pick([16, 512]);
  const edge = () => pick([0, 0, tileSize - 1, tileSize - 1, int(tileSize)]);
  const input = {
    tileX: chance(0.3) ? pick([0, n - 1]) : int(n),
    tileY: chance(0.3) ? pick([0, n - 1]) : int(n),
    // Mostly inside the tile; sometimes just outside it, where the corners wrap.
    pixelX: chance(0.15)
      ? -int(3) - int(100) / 100
      : edge() + (chance(0.3) ? 0 : int(100) / 100),
    pixelY: chance(0.15)
      ? -int(3) - int(100) / 100
      : edge() + (chance(0.3) ? 0 : int(100) / 100),
    zoom,
    tileSize,
  };
  setups.push({
    ...input,
    result: coords.getInterpolationSetup(
      input.tileX,
      input.tileY,
      input.pixelX,
      input.pixelY,
      input.zoom,
      input.tileSize,
    ),
  });
}

const decode = [];
for (let i = 0; i < 300; i++) {
  const [r, g, b] = [int(256), int(256), int(256)];
  decode.push({
    rgb: [r, g, b],
    mapbox: decoder.decodeMapboxElevation(r, g, b),
    terrarium: decoder.decodeTerrariumElevation(r, g, b),
  });
}
const bilinear = [];
for (let i = 0; i < 300; i++) {
  const e = Array.from({ length: 4 }, () => (int(60000) - 10000) / 10);
  const fx = chance(0.2) ? pick([0, 1]) : int(1000) / 1000;
  const fy = chance(0.2) ? pick([0, 1]) : int(100000) / 100000;
  bilinear.push({
    e,
    fx,
    fy,
    result: decoder.bilinearInterpolate(e[0], e[1], e[2], e[3], fx, fy),
  });
}

// ---------------------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------------------

function noise(width, height, channels) {
  const data = Buffer.alloc(width * height * channels);
  // Smooth with some detail, so lossy encoding has something to approximate.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        data[(y * width + x) * channels + c] =
          (128 +
            100 * Math.sin((x + 3 * c) / 5) * Math.cos((y + c) / 7) +
            int(20)) &
          255;
      }
    }
  }
  return data;
}

const images = [];
for (const [format, options, channels] of [
  ["webp-lossless", { lossless: true }, 3],
  ["webp-lossy", { quality: 80 }, 3],
  ["webp-lossy-low", { quality: 20 }, 3],
  ["png", {}, 3],
  ["webp-lossless-alpha", { lossless: true }, 4],
  ["png-alpha", {}, 4],
]) {
  for (const [width, height] of [
    [16, 16],
    [24, 8],
    [17, 33],
  ]) {
    const raw = noise(width, height, channels);
    let image = sharp(raw, { raw: { width, height, channels } });
    image = format.startsWith("png") ? image.png() : image.webp(options);
    const encoded = await image.toBuffer();
    const decoded = await sharp(encoded)
      .raw()
      .toBuffer({ resolveWithObject: true });
    images.push({
      format,
      encoded: encoded.toString("base64"),
      width: decoded.info.width,
      height: decoded.info.height,
      channels: decoded.info.channels,
      raw: decoded.data.toString("base64"),
    });
  }
}

// ---------------------------------------------------------------------------------------
// Scenarios against a local tile server
// ---------------------------------------------------------------------------------------

function hash(z, x, y, salt) {
  let h =
    (z * 73856093) ^ (x * 19349663) ^ (y * 83492791) ^ (salt * 2654435761);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A smooth surface over the whole world's pixels at this zoom. */
function elevationAt(z, gx, gy) {
  return (
    900 + 700 * Math.sin(gx / 41) * Math.cos(gy / 29) + 3 * Math.sin(gx / 3)
  );
}

function tilePixels(z, x, y, encoding) {
  const raw = Buffer.alloc(TILE * TILE * 3);
  for (let py = 0; py < TILE; py++) {
    for (let px = 0; px < TILE; px++) {
      const e = elevationAt(z, x * TILE + px, y * TILE + py);
      let r, g, b;
      if (encoding === "mapbox") {
        const v = Math.round((e + 10000) * 10);
        [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
      } else {
        const v = Math.round((e + 32768) * 256);
        [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
      }
      raw.set([r, g, b], (py * TILE + px) * 3);
    }
  }
  return raw;
}

async function tileResponse(z, x, y, encoding, behaviour) {
  const h = hash(z, x, y, behaviour.salt) % 100;
  if (h < behaviour.missing) return { status: 404, body: Buffer.alloc(0) };
  if (h < behaviour.missing + behaviour.failing)
    return { status: 500, body: Buffer.from("boom") };
  if (h < behaviour.missing + behaviour.failing + behaviour.corrupt)
    return { status: 200, body: Buffer.from("not an image at all") };
  const body = await sharp(tilePixels(z, x, y, encoding), {
    raw: { width: TILE, height: TILE, channels: 3 },
  })
    .webp({ lossless: true })
    .toBuffer();
  return { status: 200, body };
}

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}

function cacheState(dir) {
  return {
    files: listFiles(dir)
      .map((file) => relative(dir, file))
      .filter((file) => file.endsWith(".webp")),
    index: JSON.parse(readFileSync(join(dir, "cache-index.json"), "utf8")).keys,
    missing: JSON.parse(readFileSync(join(dir, "missing-tiles.json"), "utf8")),
  };
}

const AREAS = [
  [11.4, 47.2], // Alps
  [-121.7, 49.7], // Whistler-ish
  [179.9995, 0.0005], // across the antimeridian
  [-179.9995, 60],
  [10, 84.9], // near the Mercator limit
  [10, -89.9], // beyond it
];

function randomPoint(areas) {
  const [lon, lat] = pick(areas);
  const spread = pick([0.002, 0.02, 0.2]);
  return [
    Math.max(-90, Math.min(90, lat + ((int(2001) - 1000) * spread) / 1000)),
    lon + ((int(2001) - 1000) * spread) / 1000,
  ];
}

const scenarios = [];
for (let s = 0; s < 14; s++) {
  const encoding = pick(["mapbox", "terrarium"]);
  const zooms = pick([[12], [12, 10], [11, 9, 5], [14, 12, 8]]);
  const behaviour = {
    salt: int(1000),
    missing: pick([0, 15, 40]),
    failing: pick([0, 3, 10]),
    corrupt: pick([0, 0, 4]),
  };
  const maxTiles = pick([3, 8, 100000]);
  const areas = chance(0.5) ? AREAS.slice(0, 2) : AREAS;
  const calls = [];
  for (let c = 0; c < 3; c++) {
    const n = 1 + int(25);
    const points = [];
    for (let i = 0; i < n; i++) points.push(randomPoint(areas));
    // A repeat of an earlier point, and one landing exactly on a pixel.
    if (c > 0 && calls[0].points.length > 0) points.push(calls[0].points[0]);
    calls.push({ points, reopen: c === 1 });
  }

  const responses = {};
  const requests = [];
  const server = createServer(async (req, res) => {
    const [, z, x, y] = req.url.match(/^\/(-?\d+)\/(-?\d+)\/(-?\d+)\.webp$/);
    requests.push(req.url);
    if (!responses[req.url]) {
      const r = await tileResponse(+z, +x, +y, encoding, behaviour);
      responses[req.url] = {
        status: r.status,
        body: r.body.toString("base64"),
      };
    }
    const r = responses[req.url];
    res.statusCode = r.status;
    res.end(Buffer.from(r.body, "base64"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const urlTemplate = `http://127.0.0.1:${server.address().port}/{z}/{x}/{y}.webp`;
  const cacheDir = mkdtempSync(join(tmpdir(), "tile-vectors-"));
  const config = {
    urlTemplate,
    encoding,
    tileSize: TILE,
    cacheDir,
    cacheMaxTiles: maxTiles,
    tileConcurrency: 1,
  };

  const recorded = [];
  let source = new TerrainTileElevationSource(config);
  await source.initialize();
  for (const call of calls) {
    const before = requests.length;
    const results = await source.fetchElevations(call.points, zooms);
    recorded.push({
      points: call.points,
      results: results.map((r) =>
        r.ok ? { value: r.value } : { error: r.error },
      ),
      requests: requests
        .slice(before)
        .map((u) => new URL(u, "http://x").pathname),
    });
    if (call.reopen) {
      await source.close();
      recorded[recorded.length - 1].state = cacheState(cacheDir);
      source = new TerrainTileElevationSource(config);
      await source.initialize();
    }
  }
  await source.close();
  server.close();
  scenarios.push({
    encoding,
    zooms,
    maxTiles,
    calls: recorded,
    state: cacheState(cacheDir),
    responses: Object.fromEntries(
      Object.entries(responses).map(([url, r]) => [
        new URL(url, "http://x").pathname,
        r,
      ]),
    ),
  });
}

const generated =
  JSON.stringify({
    tile: TILE,
    pixels,
    setups,
    decode,
    bilinear,
    images,
    scenarios,
  }) + "\n";

if (process.argv.includes("--check")) {
  const existing = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (existing !== generated) {
    console.error(
      `${outPath} is out of date.\nRun: node rust/codegen/generate-tile-vectors.mjs`,
    );
    process.exit(1);
  }
  console.log("tile_vectors.json is up to date");
} else {
  writeFileSync(outPath, generated);
  const points = scenarios.reduce(
    (a, s) => a + s.calls.reduce((b, c) => b + c.points.length, 0),
    0,
  );
  const ok = scenarios.reduce(
    (a, s) =>
      a +
      s.calls.reduce(
        (b, c) =>
          b + c.results.filter((r) => typeof r.value === "number").length,
        0,
      ),
    0,
  );
  console.log(
    `Wrote ${scenarios.length} scenarios, ${points} points (${ok} with a height), ${images.length} images`,
  );
}
