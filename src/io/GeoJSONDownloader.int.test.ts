import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import downloadAndConvertToGeoJSON from "./GeoJSONDownloader.js";
import { readDownloadMetadata } from "./DownloadMetadata.js";
import { skiMapSkiAreasURL } from "./DownloadURLs.js";
import { InputDataPaths } from "./GeoJSONFiles.js";

let sourceDir: string;
let targetDir: string;
const timestamp = "2026-10-14T19:00:00Z";
const osmJSON = JSON.stringify({
  version: 0.6,
  osm3s: { timestamp_osm_base: timestamp },
  elements: [],
});
const skiMapJSON = JSON.stringify({ type: "FeatureCollection", features: [] });

beforeEach(async () => {
  sourceDir = await mkdtemp(join(tmpdir(), "osm-source-"));
  targetDir = await mkdtemp(join(tmpdir(), "osm-target-"));
  const paths = new InputDataPaths(sourceDir);
  await Promise.all(
    Object.values(paths.osmJSON).map((path) => writeFile(path, osmJSON)),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url !== skiMapSkiAreasURL) {
        throw new Error(`Unexpected network request: ${url}`);
      }
      return new Response(skiMapJSON);
    }),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all([
    rm(sourceDir, { recursive: true, force: true }),
    rm(targetDir, { recursive: true, force: true }),
  ]);
});

it("uses all five local OSM files, converts them, and preserves their timestamp", async () => {
  const paths = await downloadAndConvertToGeoJSON(targetDir, null, sourceDir);
  for (const path of Object.values(paths.osmJSON)) {
    expect(await readFile(path, "utf8")).toBe(osmJSON);
  }
  for (const path of Object.values(paths.geoJSON)) {
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  }
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    skiMapSkiAreasURL,
    expect.any(Object),
  );
  expect(
    (await readDownloadMetadata(targetDir))?.openStreetMap.dataTimestamp,
  ).toBe("2026-10-14T19:00:00.000Z");
});

it("fails for a missing local file without falling back to Overpass", async () => {
  await unlink(new InputDataPaths(sourceDir).osmJSON.runs);
  await expect(
    downloadAndConvertToGeoJSON(targetDir, null, sourceDir),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps using Overpass when no local input directory is supplied", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(url === skiMapSkiAreasURL ? skiMapJSON : osmJSON),
    ),
  );
  await downloadAndConvertToGeoJSON(targetDir, null);
  expect(fetch).toHaveBeenCalledTimes(6);
});
