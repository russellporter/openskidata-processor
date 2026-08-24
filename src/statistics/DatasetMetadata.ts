import { stat } from "node:fs/promises";
import {
  FeatureType,
  getLiftElevationData,
  getRunElevationData,
  LiftFeature,
  RunFeature,
  SkiAreaActivity,
  SkiAreaFeature,
  SpotFeature,
  Status,
} from "openskidata-format";

/**
 * Current schema version of `metadata.json`.
 *
 * Bump on any breaking change so consumers can refuse to render a shape they
 * do not understand rather than silently showing blanks.
 */
export const METADATA_VERSION = 1;

export type FileSizes = {
  geojson: Record<string, number>;
  csv: Record<string, number>;
  geoPackage: number | null;
};

export type DatasetMetadata = {
  version: number;
  // Version of the openskidata-format package the output conforms to.
  formatVersion: string;
  /**
   * Bounding box the pipeline was restricted to, or null for a worldwide run.
   * Without this a partial extract is indistinguishable from a global build
   * that lost most of its features.
   */
  bbox: GeoJSON.BBox | null;
  source: {
    openStreetMap: { dataTimestamp: string | null };
    skiMapOrg: { downloadedAt: string | null };
  };
  run: {
    startedAt: string | null;
    finishedAt: string;
    durationSeconds: number | null;
  };
  counts: {
    skiAreas: {
      total: number;
      operating: number;
      /**
       * Ski areas offering each activity. These do not partition `total`: a ski
       * area may offer both activities, or neither.
       */
      downhill: number;
      nordic: number;
    };
    runs: number;
    lifts: number;
    spots: number;
  };
  /**
   * Uncompressed size in bytes of each published file.
   *
   * A client cannot get this from the download host: GeoJSON is served gzipped,
   * so the `Content-Length` a browser sees is the transfer size — `spots.geojson`
   * is 36 MB over the wire and 126 MB on disk. Both numbers are worth knowing,
   * one predicting the download and the other what it costs to keep.
   *
   * Grouped by format and dataset rather than keyed by URL, because the
   * published directory layout is decided at deploy time and is not something
   * the pipeline knows about. A file that could not be read is omitted rather
   * than reported as zero, so consumers can tell unknown from empty.
   */
  files: FileSizes;
  totals: {
    /**
     * Combined inclined length of all runs, in kilometres.
     *
     * This is the sum of the same `inclined_length_m` value the CSV export
     * reports, so it covers runs with an elevation profile (LineString runs
     * when the elevation server is enabled) and excludes runs without one.
     */
    runLengthKm: number;
    // Combined inclined length of all lifts, in kilometres. Same caveat.
    liftLengthKm: number;
    // Distinct ISO 3166-1 alpha-2 countries containing at least one ski area.
    countries: number;
  };
};

/**
 * Tallies dataset-wide figures as features stream past.
 *
 * Wired into the existing CSV export pipeline, so counting costs no additional
 * pass over the output files.
 */
export class MetadataCollector {
  private skiAreas = 0;
  private operatingSkiAreas = 0;
  private downhillSkiAreas = 0;
  private nordicSkiAreas = 0;
  private runs = 0;
  private lifts = 0;
  private spots = 0;
  private runLengthInMeters = 0;
  private liftLengthInMeters = 0;
  private countries = new Set<string>();

  /**
   * Returns a side-effecting callback for the given feature type, suitable for
   * the `get` stream transform.
   */
  collector(type: FeatureType): (feature: GeoJSON.Feature<any, any>) => void {
    switch (type) {
      case FeatureType.SkiArea:
        return (feature) => this.addSkiArea(feature as SkiAreaFeature);
      case FeatureType.Run:
        return (feature) => this.addRun(feature as RunFeature);
      case FeatureType.Lift:
        return (feature) => this.addLift(feature as LiftFeature);
      case FeatureType.Spot:
        return (feature) => this.addSpot(feature as SpotFeature);
    }
  }

  private addSkiArea(feature: SkiAreaFeature): void {
    const properties = feature.properties;
    this.skiAreas++;
    if (properties.status === Status.Operating) {
      this.operatingSkiAreas++;
    }
    if (properties.activities.includes(SkiAreaActivity.Downhill)) {
      this.downhillSkiAreas++;
    }
    if (properties.activities.includes(SkiAreaActivity.Nordic)) {
      this.nordicSkiAreas++;
    }
    properties.places.forEach((place) => {
      this.countries.add(place.iso3166_1Alpha2);
    });
  }

  private addRun(feature: RunFeature): void {
    this.runs++;
    this.runLengthInMeters +=
      getRunElevationData(feature)?.inclinedLengthInMeters ?? 0;
  }

  private addLift(feature: LiftFeature): void {
    this.lifts++;
    this.liftLengthInMeters +=
      getLiftElevationData(feature)?.inclinedLengthInMeters ?? 0;
  }

  private addSpot(_feature: SpotFeature): void {
    this.spots++;
  }

  metadata(options: {
    formatVersion: string;
    bbox: GeoJSON.BBox | null;
    startedAt: string | null;
    openStreetMapDataTimestamp: string | null;
    skiMapOrgDownloadedAt: string | null;
    files: FileSizes;
  }): DatasetMetadata {
    const finishedAt = new Date();
    const startedAt = options.startedAt ? new Date(options.startedAt) : null;
    const durationSeconds =
      startedAt && !isNaN(startedAt.getTime())
        ? Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)
        : null;

    return {
      version: METADATA_VERSION,
      formatVersion: options.formatVersion,
      bbox: options.bbox,
      source: {
        openStreetMap: { dataTimestamp: options.openStreetMapDataTimestamp },
        skiMapOrg: { downloadedAt: options.skiMapOrgDownloadedAt },
      },
      run: {
        startedAt: options.startedAt,
        finishedAt: finishedAt.toISOString(),
        durationSeconds,
      },
      counts: {
        skiAreas: {
          total: this.skiAreas,
          operating: this.operatingSkiAreas,
          downhill: this.downhillSkiAreas,
          nordic: this.nordicSkiAreas,
        },
        runs: this.runs,
        lifts: this.lifts,
        spots: this.spots,
      },
      files: options.files,
      totals: {
        runLengthKm: round(this.runLengthInMeters / 1000, 1),
        liftLengthKm: round(this.liftLengthInMeters / 1000, 1),
        countries: this.countries.size,
      },
    };
  }
}

/**
 * Uncompressed sizes of the published files, grouped by format and dataset.
 *
 * Never throws: a file that cannot be read is logged and omitted, since a
 * missing size is not worth failing a multi-hour pipeline run over.
 */
export async function collectFileSizes(files: {
  geojson: Record<string, string>;
  csv: Record<string, string>;
  geoPackage: string;
}): Promise<FileSizes> {
  const [geojson, csv, geoPackage] = await Promise.all([
    sizesOf(files.geojson),
    sizesOf(files.csv),
    sizeOf(files.geoPackage),
  ]);

  return { geojson, csv, geoPackage };
}

async function sizesOf(
  paths: Record<string, string>,
): Promise<Record<string, number>> {
  const entries = await Promise.all(
    Object.entries(paths).map(async ([key, path]) => {
      const size = await sizeOf(path);
      return size === null ? null : ([key, size] as const);
    }),
  );

  return Object.fromEntries(
    entries.filter((entry): entry is [string, number] => entry !== null),
  );
}

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    console.log("Could not read size of " + path + ":", error);
    return null;
  }
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
