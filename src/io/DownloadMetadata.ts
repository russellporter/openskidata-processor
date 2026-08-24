import { open, readFile, writeFile } from "node:fs/promises";
import { join } from "path";

/**
 * Provenance recorded by the download step so that the (separately invoked)
 * prepare step can report where its input data came from.
 *
 * `npm run download` and `npm run prepare-geojson` are separate processes, so
 * nothing is shared in memory between them. This is written to the working
 * directory at the end of the download phase and read back during output
 * generation.
 *
 * When the pipeline is run with `--skip-download`, the previous run's file is
 * reused as-is. That is intentional: it accurately describes the input data the
 * output was actually built from.
 */
export type DownloadMetadata = {
  // When the download phase began.
  startedAt: string;
  openStreetMap: {
    /**
     * The OpenStreetMap data cutoff, taken from `osm3s.timestamp_osm_base` in
     * the Overpass responses. Each query returns its own timestamp and they can
     * be minutes apart, so this is the earliest of them — the point in time the
     * whole extract is guaranteed to be current as of.
     */
    dataTimestamp: string | null;
  };
  skiMapOrg: {
    // Skimap.org serves a plain GeoJSON file with no embedded timestamp of its
    // own, so the download time is the only provenance available.
    downloadedAt: string;
  };
};

export function getDownloadMetadataPath(folder: string): string {
  return join(folder, "input_download_metadata.json");
}

export async function writeDownloadMetadata(
  folder: string,
  metadata: DownloadMetadata,
): Promise<void> {
  await writeFile(
    getDownloadMetadataPath(folder),
    JSON.stringify(metadata, null, 2) + "\n",
  );
}

/**
 * Reads the metadata written by the download phase.
 *
 * Returns null when it is missing or unreadable, which happens when
 * `--skip-download` is used against a working directory that predates this
 * file. Callers should degrade rather than fail: the provenance is nice to
 * have, not worth failing a multi-hour pipeline run over.
 */
export async function readDownloadMetadata(
  folder: string,
): Promise<DownloadMetadata | null> {
  try {
    const contents = await readFile(getDownloadMetadataPath(folder), "utf8");
    return JSON.parse(contents) as DownloadMetadata;
  } catch (error) {
    console.log("Could not read download metadata:", error);
    return null;
  }
}

/**
 * Extracts `osm3s.timestamp_osm_base` from an Overpass JSON file.
 *
 * The header is at the very start of the document, so only the first chunk is
 * read — these files are gigabytes in the worldwide case.
 */
export async function readOSMDataTimestamp(
  path: string,
): Promise<string | null> {
  let handle;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead).toString("utf8");
    const match = head.match(/"timestamp_osm_base"\s*:\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch (error) {
    console.log("Could not read OSM data timestamp from " + path + ":", error);
    return null;
  } finally {
    await handle?.close();
  }
}

/**
 * The earliest of the given timestamps, which is the point all of the extracts
 * are current as of. Ignores anything unparseable.
 */
export function earliestTimestamp(
  timestamps: (string | null)[],
): string | null {
  const dates = timestamps
    .filter((timestamp): timestamp is string => timestamp !== null)
    .map((timestamp) => new Date(timestamp))
    .filter((date) => !isNaN(date.getTime()));

  if (dates.length === 0) {
    return null;
  }

  return new Date(
    Math.min(...dates.map((date) => date.getTime())),
  ).toISOString();
}
