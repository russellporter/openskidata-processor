import {
  ElevationProfile,
  FeatureType,
  LiftFeature,
  LiftType,
  RunDifficulty,
  RunDifficultyConvention,
  RunFeature,
  RunUse,
  SkiAreaActivity,
  SkiAreaFeature,
  SourceType,
  SpotFeature,
  SpotType,
  Status,
} from "openskidata-format";
import { mockViewportHint } from "../testUtils";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  collectFileSizes,
  MetadataCollector,
  METADATA_VERSION,
} from "./DatasetMetadata";

// A two point line with a matching two point profile, borrowed from the CSV
// formatter tests where it is known to yield an inclined length of 289 m.
const lineCoordinates: [number, number, number][] = [
  [11.177452968770694, 47.312650638218656, 2000],
  [11.175409464719593, 47.31138883724759, 1800],
];
const elevationProfile: ElevationProfile = {
  heights: [2000, 1800],
  resolution: 208.37647096918965,
  targetResolution: 1000,
};

function skiArea(options: {
  id: string;
  activities?: SkiAreaActivity[];
  status?: Status | null;
  countries?: string[];
}): SkiAreaFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [10.0, 20.0] },
    properties: {
      type: FeatureType.SkiArea,
      id: options.id,
      name: options.id,
      activities: options.activities ?? [SkiAreaActivity.Downhill],
      status: options.status !== undefined ? options.status : Status.Operating,
      sources: [{ type: SourceType.SKIMAP_ORG, id: "1" }],
      runConvention: RunDifficultyConvention.EUROPE,
      skiPasses: [],
      websites: [],
      wikidataID: null,
      places: (options.countries ?? []).map((country) => ({
        iso3166_1Alpha2: country,
        iso3166_2: null,
        localized: { en: { country, region: null, locality: null } },
      })),
      viewportHint: mockViewportHint(),
    },
  };
}

function run(options: { id: string; withElevation: boolean }): RunFeature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: lineCoordinates },
    properties: {
      type: FeatureType.Run,
      id: options.id,
      name: null,
      ref: null,
      status: Status.Operating,
      uses: [RunUse.Downhill],
      difficulty: RunDifficulty.INTERMEDIATE,
      difficultyConvention: RunDifficultyConvention.EUROPE,
      oneway: null,
      lit: null,
      gladed: null,
      patrolled: null,
      snowmaking: null,
      snowfarming: null,
      tunnel: null,
      grooming: null,
      description: null,
      skiAreas: [],
      elevationProfile: options.withElevation ? elevationProfile : null,
      sources: [],
      websites: [],
      wikidataID: null,
      places: [],
      viewportHint: mockViewportHint(),
    },
  };
}

function lift(options: { id: string }): LiftFeature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: lineCoordinates },
    properties: {
      type: FeatureType.Lift,
      id: options.id,
      name: null,
      ref: null,
      refFRCAIRN: null,
      liftType: LiftType.ChairLift,
      status: Status.Operating,
      access: null,
      description: null,
      oneway: null,
      occupancy: null,
      capacity: null,
      duration: null,
      detachable: null,
      bubble: null,
      heating: null,
      tunnel: null,
      // Lifts derive their elevation data straight from the 3D geometry rather
      // than from a separate profile.
      stations: [],
      skiAreas: [],
      sources: [],
      websites: [],
      wikidataID: null,
      places: [],
      viewportHint: mockViewportHint(),
    },
  };
}

function spot(options: { id: string }): SpotFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [10.0, 20.0] },
    properties: {
      type: FeatureType.Spot,
      spotType: SpotType.Halfpipe,
      id: options.id,
      skiAreas: [],
      sources: [],
      places: [],
      viewportHint: mockViewportHint(),
    },
  };
}

const options = {
  formatVersion: "13.0.0",
  bbox: null,
  startedAt: "2026-08-22T20:04:58.000Z",
  openStreetMapDataTimestamp: "2026-08-22T19:36:10Z",
  skiMapOrgDownloadedAt: "2026-08-22T20:05:31.000Z",
  files: { geojson: {}, csv: {}, geoPackage: null },
};

describe("MetadataCollector", () => {
  it("counts features by type", () => {
    const collector = new MetadataCollector();

    [skiArea({ id: "a" }), skiArea({ id: "b" })].forEach(
      collector.collector(FeatureType.SkiArea),
    );
    [run({ id: "r1", withElevation: true })].forEach(
      collector.collector(FeatureType.Run),
    );
    [lift({ id: "l1" }), lift({ id: "l2" })].forEach(
      collector.collector(FeatureType.Lift),
    );
    [spot({ id: "s1" }), spot({ id: "s2" }), spot({ id: "s3" })].forEach(
      collector.collector(FeatureType.Spot),
    );

    const metadata = collector.metadata(options);

    expect(metadata.counts.skiAreas.total).toBe(2);
    expect(metadata.counts.runs).toBe(1);
    expect(metadata.counts.lifts).toBe(2);
    expect(metadata.counts.spots).toBe(3);
  });

  it("counts ski area activities without partitioning the total", () => {
    const collector = new MetadataCollector();
    const add = collector.collector(FeatureType.SkiArea);

    add(
      skiArea({
        id: "both",
        activities: [SkiAreaActivity.Downhill, SkiAreaActivity.Nordic],
      }),
    );
    add(skiArea({ id: "downhill", activities: [SkiAreaActivity.Downhill] }));
    add(skiArea({ id: "neither", activities: [] }));

    const counts = collector.metadata(options).counts.skiAreas;

    expect(counts.total).toBe(3);
    // A ski area may offer both activities or neither, so these deliberately
    // do not sum to the total.
    expect(counts.downhill).toBe(2);
    expect(counts.nordic).toBe(1);
  });

  it("counts only operating ski areas as operating", () => {
    const collector = new MetadataCollector();
    const add = collector.collector(FeatureType.SkiArea);

    add(skiArea({ id: "operating", status: Status.Operating }));
    add(skiArea({ id: "abandoned", status: Status.Abandoned }));
    add(skiArea({ id: "unknown", status: null }));

    const counts = collector.metadata(options).counts.skiAreas;

    expect(counts.total).toBe(3);
    expect(counts.operating).toBe(1);
  });

  it("counts distinct countries across ski areas", () => {
    const collector = new MetadataCollector();
    const add = collector.collector(FeatureType.SkiArea);

    add(skiArea({ id: "a", countries: ["AT"] }));
    add(skiArea({ id: "b", countries: ["AT", "DE"] }));
    add(skiArea({ id: "c", countries: [] }));

    expect(collector.metadata(options).totals.countries).toBe(2);
  });

  it("sums inclined length, skipping features without an elevation profile", () => {
    const collector = new MetadataCollector();

    [
      run({ id: "with", withElevation: true }),
      run({ id: "without", withElevation: false }),
    ].forEach(collector.collector(FeatureType.Run));
    [lift({ id: "l1" })].forEach(collector.collector(FeatureType.Lift));

    const totals = collector.metadata(options).totals;

    // One 289 m run contributes and the run with no profile contributes
    // nothing, so the total is 0.289 km rounded to 0.1 km precision. Had both
    // runs been counted this would be 0.6.
    expect(totals.runLengthKm).toBe(0.3);
    expect(totals.liftLengthKm).toBe(0.3);
  });

  it("reports an empty dataset as zeroes rather than omitting fields", () => {
    const metadata = new MetadataCollector().metadata(options);

    expect(metadata.counts).toEqual({
      skiAreas: { total: 0, operating: 0, downhill: 0, nordic: 0 },
      runs: 0,
      lifts: 0,
      spots: 0,
    });
    expect(metadata.totals).toEqual({
      runLengthKm: 0,
      liftLengthKm: 0,
      countries: 0,
    });
  });

  it("passes provenance through and derives the run duration", () => {
    const metadata = new MetadataCollector().metadata(options);

    expect(metadata.version).toBe(METADATA_VERSION);
    expect(metadata.formatVersion).toBe("13.0.0");
    expect(metadata.bbox).toBeNull();
    expect(metadata.source).toEqual({
      openStreetMap: { dataTimestamp: "2026-08-22T19:36:10Z" },
      skiMapOrg: { downloadedAt: "2026-08-22T20:05:31.000Z" },
    });
    expect(metadata.run.startedAt).toBe("2026-08-22T20:04:58.000Z");
    expect(metadata.run.durationSeconds).toBeGreaterThan(0);
  });

  it("degrades to nulls when the download metadata is missing", () => {
    const metadata = new MetadataCollector().metadata({
      ...options,
      startedAt: null,
      openStreetMapDataTimestamp: null,
      skiMapOrgDownloadedAt: null,
    });

    expect(metadata.source.openStreetMap.dataTimestamp).toBeNull();
    expect(metadata.source.skiMapOrg.downloadedAt).toBeNull();
    expect(metadata.run.startedAt).toBeNull();
    expect(metadata.run.durationSeconds).toBeNull();
    // The run still reports when it finished, and the counts are still valid.
    expect(metadata.run.finishedAt).not.toBeNull();
  });

  it("passes published file sizes through", () => {
    const files = {
      geojson: { runs: 1234 },
      csv: { runs: 567 },
      geoPackage: 8910,
    };

    expect(
      new MetadataCollector().metadata({ ...options, files }).files,
    ).toEqual(files);
  });

  it("records the bounding box so a partial extract is identifiable", () => {
    const metadata = new MetadataCollector().metadata({
      ...options,
      bbox: [-13, -90, 65, 90],
    });

    expect(metadata.bbox).toEqual([-13, -90, 65, 90]);
  });
});

describe("collectFileSizes", () => {
  it("groups uncompressed sizes by format and dataset", async () => {
    const folder = mkdtempSync(join(tmpdir(), "file-sizes-"));
    mkdirSync(join(folder, "csv"));
    writeFileSync(join(folder, "runs.geojson"), "x".repeat(500));
    writeFileSync(join(folder, "lifts.geojson"), "x".repeat(300));
    writeFileSync(join(folder, "csv", "runs.csv"), "x".repeat(120));
    writeFileSync(join(folder, "openskidata.gpkg"), "x".repeat(999));

    const sizes = await collectFileSizes({
      geojson: {
        runs: join(folder, "runs.geojson"),
        lifts: join(folder, "lifts.geojson"),
      },
      csv: { runs: join(folder, "csv", "runs.csv") },
      geoPackage: join(folder, "openskidata.gpkg"),
    });

    expect(sizes).toEqual({
      geojson: { runs: 500, lifts: 300 },
      csv: { runs: 120 },
      geoPackage: 999,
    });
  });

  it("omits files it cannot read rather than reporting them as empty", async () => {
    const folder = mkdtempSync(join(tmpdir(), "file-sizes-"));
    writeFileSync(join(folder, "runs.geojson"), "x".repeat(10));

    const sizes = await collectFileSizes({
      geojson: {
        runs: join(folder, "runs.geojson"),
        lifts: join(folder, "absent.geojson"),
      },
      csv: {},
      geoPackage: join(folder, "absent.gpkg"),
    });

    // "lifts" is left out and geoPackage is null, so a consumer can tell
    // unknown from empty.
    expect(sizes).toEqual({
      geojson: { runs: 10 },
      csv: {},
      geoPackage: null,
    });
  });
});
