import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  earliestTimestamp,
  readDownloadMetadata,
  readOSMDataTimestamp,
  writeDownloadMetadata,
} from "./DownloadMetadata.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "download-metadata-"));
}

describe("earliestTimestamp", () => {
  it("returns the earliest of several timestamps", () => {
    expect(
      earliestTimestamp([
        "2026-08-22T20:52:00Z",
        "2026-08-22T19:36:10Z",
        "2026-08-22T21:04:00Z",
      ]),
    ).toBe("2026-08-22T19:36:10.000Z");
  });

  it("ignores nulls", () => {
    expect(earliestTimestamp([null, "2026-08-22T19:36:10Z", null])).toBe(
      "2026-08-22T19:36:10.000Z",
    );
  });

  it("ignores unparseable values rather than producing an invalid date", () => {
    expect(earliestTimestamp(["not a date", "2026-08-22T19:36:10Z"])).toBe(
      "2026-08-22T19:36:10.000Z",
    );
  });

  it("returns null when there is nothing usable", () => {
    expect(earliestTimestamp([])).toBeNull();
    expect(earliestTimestamp([null, "nonsense"])).toBeNull();
  });
});

describe("readOSMDataTimestamp", () => {
  it("extracts the Overpass data timestamp from the file header", async () => {
    const folder = tempDir();
    const path = join(folder, "input.osmjson");
    writeFileSync(
      path,
      `{
  "version": 0.6,
  "generator": "Overpass API 0.7.62.11 87bfad18",
  "osm3s": {
    "timestamp_osm_base": "2026-04-15T19:36:10Z",
    "copyright": "..."
  },
  "elements": [
`,
    );

    expect(await readOSMDataTimestamp(path)).toBe("2026-04-15T19:36:10Z");
  });

  it("reads only the header, not the whole document", async () => {
    const folder = tempDir();
    const path = join(folder, "large.osmjson");
    // Header followed by more than the 4 KB read window, as in the real
    // multi-gigabyte extracts.
    writeFileSync(
      path,
      `{"osm3s":{"timestamp_osm_base":"2026-04-15T19:36:10Z"},"elements":[` +
        "0".repeat(200000) +
        "]}",
    );

    expect(await readOSMDataTimestamp(path)).toBe("2026-04-15T19:36:10Z");
  });

  it("returns null when the header has no timestamp", async () => {
    const folder = tempDir();
    const path = join(folder, "no-timestamp.osmjson");
    writeFileSync(path, `{"version":0.6,"elements":[]}`);

    expect(await readOSMDataTimestamp(path)).toBeNull();
  });

  it("returns null for a missing file rather than throwing", async () => {
    expect(
      await readOSMDataTimestamp(join(tempDir(), "does-not-exist.osmjson")),
    ).toBeNull();
  });
});

describe("download metadata round trip", () => {
  it("writes and reads back the metadata", async () => {
    const folder = tempDir();
    const metadata = {
      startedAt: "2026-08-22T20:04:58.000Z",
      openStreetMap: { dataTimestamp: "2026-08-22T19:36:10Z" },
      skiMapOrg: { downloadedAt: "2026-08-22T20:05:31.000Z" },
    };

    await writeDownloadMetadata(folder, metadata);

    expect(await readDownloadMetadata(folder)).toEqual(metadata);
  });

  it("returns null when the file is absent, so prepare can still run", async () => {
    expect(await readDownloadMetadata(tempDir())).toBeNull();
  });

  it("returns null when the file is corrupt, so prepare can still run", async () => {
    const folder = tempDir();
    writeFileSync(join(folder, "input_download_metadata.json"), "{ not json");

    expect(await readDownloadMetadata(folder)).toBeNull();
  });
});
