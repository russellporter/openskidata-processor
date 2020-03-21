import * as fs from "fs";
import mockFS from "mock-fs";
import {
  Activity,
  ColorName,
  FeatureType,
  LiftFeature,
  LiftGeometry,
  LiftProperties,
  LiftType,
  RunConvention,
  RunDifficulty,
  RunFeature,
  RunGrooming,
  RunProperties,
  RunUse,
  SkiAreaFeature,
  SkiAreaProperties,
  SkiAreaStatistics,
  Status
} from "openskidata-format";
import Source, { SourceType } from "openskidata-format/dist/Source";
import { join } from "path";
import { SkiAreaGeometry } from "./clustering/MapObject";
import { InputLiftFeature } from "./features/LiftFeature";
import { InputRunFeature, InputRunGeometry } from "./features/RunFeature";
import {
  InputOpenStreetMapSkiAreaProperties,
  InputSkiMapOrgSkiAreaFeature
} from "./features/SkiAreaFeature";

export interface FolderContents extends Map<string, any | FolderContents> {}

export function mockInputFiles(input: {
  skiMapSkiAreas: InputSkiMapOrgSkiAreaFeature[];
  openStreetMapSkiAreas: InputOpenStreetMapSkiAreaProperties[];
  lifts: InputLiftFeature[];
  runs: InputRunFeature[];
}) {
  mockFS({
    "input_skimap_ski_areas.geojson": JSON.stringify({
      type: "FeatureCollection",
      features: input.skiMapSkiAreas
    }),
    "input_openstreetmap_ski_areas.geojson": JSON.stringify({
      type: "FeatureCollection",
      features: input.openStreetMapSkiAreas
    }),
    "input_lifts.geojson": JSON.stringify({
      type: "FeatureCollection",
      features: input.lifts
    }),
    "input_runs.geojson": JSON.stringify({
      type: "FeatureCollection",
      features: input.runs
    })
  });

  fs.mkdirSync("output");
  fs.mkdirSync("output/features");
}

export function mockFeatureFiles(
  skiAreas: SkiAreaFeature[],
  lifts: LiftFeature[],
  runs: RunFeature[]
) {
  mockFS({
    "intermediate_ski_areas.geojson": JSON.stringify({
      type: "FeatureCollection",
      features: skiAreas
    }),
    "intermediate_lifts.geojson": JSON.stringify({
      type: "FeatureCollection",
      features: lifts
    }),
    "intermediate_runs.geojson": JSON.stringify({
      type: "FeatureCollection",
      features: runs
    })
  });

  fs.mkdirSync("output");
  fs.mkdirSync("output/features");
}

export function folderContents(folder: string): FolderContents {
  return fs
    .readdirSync(folder)
    .map(path => {
      path = join(folder, path);
      const stat = fs.lstatSync(path);
      if (stat.isFile()) {
        const map = new Map();
        map.set(path, fileContents(path));
        return map as FolderContents;
      } else if (stat.isDirectory()) {
        return folderContents(path);
      }
      throw "Unexpected path type";
    })
    .reduce((previous, current) => {
      return new Map([...previous, ...current]);
    }, new Map());
}

export function fileContents(path: string): any {
  return JSON.parse(fs.readFileSync(path).toString());
}

export function mockRunFeature<G extends InputRunGeometry>(options: {
  id: string;
  name: string | null;
  oneway?: boolean | null;
  patrolled?: boolean | null;
  ref?: string | null;
  grooming?: RunGrooming | null;
  uses: RunUse[];
  difficulty?: RunDifficulty;
  geometry: G;
  status?: Status;
}): GeoJSON.Feature<G, RunProperties> {
  return {
    type: "Feature",
    properties: {
      type: FeatureType.Run,
      uses: options.uses,
      id: options.id,
      name: options.name,
      difficulty: options.difficulty || null,
      ref: options.ref || null,
      oneway: options.oneway !== undefined ? options.oneway : null,
      lit: null,
      description: null,
      gladed: null,
      patrolled: options.patrolled !== undefined ? options.patrolled : null,
      grooming: options.grooming || null,
      color: "",
      colorName: ColorName.GREEN,
      skiAreas: [],
      elevationProfile: null,
      status: options.status || Status.Operating
    },
    geometry: options.geometry
  };
}

export function mockLiftFeature<G extends LiftGeometry>(options: {
  id: string;
  name: string;
  liftType: LiftType;
  status?: Status;
  ref?: string | null;
  geometry: G;
}): GeoJSON.Feature<G, LiftProperties> {
  return {
    type: "Feature",
    properties: {
      type: FeatureType.Lift,
      id: options.id,
      name: options.name,
      liftType: options.liftType,
      status: options.status || Status.Operating,
      color: "",
      ref: options.ref || null,
      description: null,
      oneway: null,
      occupancy: null,
      capacity: null,
      duration: null,
      bubble: null,
      heating: null,
      skiAreas: []
    },
    geometry: options.geometry
  };
}

export function mockSkiAreaFeature<G extends SkiAreaGeometry>(options: {
  id?: string;
  name?: string;
  activities?: Activity[];
  status?: Status;
  sources?: Source[];
  statistics?: SkiAreaStatistics;
  geometry: G;
}): GeoJSON.Feature<G, SkiAreaProperties> {
  return {
    type: "Feature",
    properties: {
      type: FeatureType.SkiArea,
      id: options.id !== undefined ? options.id : "ID",
      name: options.name !== undefined ? options.name : "Name",
      activities:
        options.activities !== undefined
          ? options.activities
          : [Activity.Downhill],
      status: options.status !== undefined ? options.status : Status.Operating,
      generated: false,
      sources:
        options.sources !== undefined
          ? options.sources
          : [{ id: "1", type: SourceType.SKIMAP_ORG }],
      runConvention: RunConvention.EUROPE,
      statistics: options.statistics,
      website: null
    },
    geometry: options.geometry
  };
}
