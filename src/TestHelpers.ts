import * as fs from "fs";
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
  Status,
} from "openskidata-format";
import Source, { SourceType } from "openskidata-format/dist/Source";
import * as path from "path";
import * as tmp from "tmp";
import { SkiAreaGeometry } from "./clustering/MapObject";
import { InputLiftFeature } from "./features/LiftFeature";
import { InputRunFeature, InputRunGeometry } from "./features/RunFeature";
import {
  InputOpenStreetMapSkiAreaFeature,
  InputSkiMapOrgSkiAreaFeature,
  OSMSkiAreaSite,
} from "./features/SkiAreaFeature";
import {
  GeoJSONInputPaths,
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
  GeoJSONPaths,
} from "./io/GeoJSONFiles";

export interface FolderContents extends Map<string, any> {}

export function getFilePaths(): GeoJSONPaths {
  const dir = tmp.dirSync().name;
  return {
    input: new GeoJSONInputPaths(path.join(dir, "input")),
    intermediate: new GeoJSONIntermediatePaths(path.join(dir, "intermediate")),
    output: new GeoJSONOutputPaths(path.join(dir, "output")),
  };
}

export function mockInputFiles(
  input: {
    skiMapSkiAreas: InputSkiMapOrgSkiAreaFeature[];
    openStreetMapSkiAreas: InputOpenStreetMapSkiAreaFeature[];
    openStreetMapSkiAreaSites: OSMSkiAreaSite[];
    lifts: InputLiftFeature[];
    runs: InputRunFeature[];
  },
  inputPaths: GeoJSONInputPaths
) {
  fs.writeFileSync(
    inputPaths.skiMapSkiAreas,
    JSON.stringify({
      type: "FeatureCollection",
      features: input.skiMapSkiAreas,
    })
  );
  fs.writeFileSync(
    inputPaths.skiAreas,
    JSON.stringify({
      type: "FeatureCollection",
      features: input.openStreetMapSkiAreas,
    })
  );
  fs.writeFileSync(
    inputPaths.skiAreaSites,
    JSON.stringify({
      elements: input.openStreetMapSkiAreaSites,
    })
  );
  fs.writeFileSync(
    inputPaths.lifts,
    JSON.stringify({
      type: "FeatureCollection",
      features: input.lifts,
    })
  );
  fs.writeFileSync(
    inputPaths.runs,
    JSON.stringify({
      type: "FeatureCollection",
      features: input.runs,
    })
  );
}

export function mockFeatureFiles(
  skiAreas: SkiAreaFeature[],
  lifts: LiftFeature[],
  runs: RunFeature[],
  intermedatePaths: GeoJSONIntermediatePaths
) {
  fs.writeFileSync(
    intermedatePaths.skiAreas,
    JSON.stringify({
      type: "FeatureCollection",
      features: skiAreas,
    })
  );
  fs.writeFileSync(
    intermedatePaths.lifts,
    JSON.stringify({
      type: "FeatureCollection",
      features: lifts,
    })
  );
  fs.writeFileSync(
    intermedatePaths.runs,
    JSON.stringify({
      type: "FeatureCollection",
      features: runs,
    })
  );
}

export function contents(paths: GeoJSONOutputPaths): FolderContents {
  return [
    paths.lifts,
    paths.mapboxGL.lifts,
    paths.mapboxGL.runs,
    paths.mapboxGL.skiAreas,
    paths.runs,
    paths.skiAreas,
  ]
    .filter((path) => fs.existsSync(path))
    .reduce((contents: FolderContents, filePath: string) => {
      contents.set("output/" + path.basename(filePath), fileContents(filePath));
      return contents;
    }, new Map());
}

export function fileContents(path: string): any {
  return JSON.parse(fs.readFileSync(path).toString());
}

export function mockRunFeature<G extends InputRunGeometry>(options: {
  id: string;
  name?: string | null;
  oneway?: boolean | null;
  patrolled?: boolean | null;
  ref?: string | null;
  grooming?: RunGrooming | null;
  uses?: RunUse[];
  difficulty?: RunDifficulty;
  convention?: RunConvention;
  geometry: G;
  skiAreas?: SkiAreaFeature[];
  status?: Status;
  sources?: Source[];
}): GeoJSON.Feature<G, RunProperties> {
  return {
    type: "Feature",
    properties: {
      type: FeatureType.Run,
      uses: options.uses || [RunUse.Downhill],
      id: options.id,
      name: options.name || null,
      difficulty: options.difficulty || null,
      convention: options.convention || RunConvention.EUROPE,
      ref: options.ref || null,
      oneway: options.oneway !== undefined ? options.oneway : null,
      lit: null,
      description: null,
      gladed: null,
      patrolled: options.patrolled !== undefined ? options.patrolled : null,
      grooming: options.grooming || null,
      color: "",
      colorName: ColorName.GREEN,
      skiAreas: options.skiAreas || [],
      elevationProfile: null,
      status: options.status || Status.Operating,
      sources: options.sources || [],
      location: null,
    },
    geometry: options.geometry,
  };
}

export function mockLiftFeature<G extends LiftGeometry>(options: {
  id: string;
  name: string;
  liftType: LiftType;
  status?: Status;
  ref?: string | null;
  geometry: G;
  skiAreas?: SkiAreaFeature[];
  sources?: Source[];
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
      skiAreas: options.skiAreas || [],
      sources: options.sources || [],
      location: null,
    },
    geometry: options.geometry,
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
      website: null,
      location: null,
    },
    geometry: options.geometry,
  };
}

export function simplifiedLiftFeature(feature: LiftFeature) {
  return {
    id: feature.properties.id,
    name: feature.properties.name,
    skiAreas: feature.properties.skiAreas.map(
      (skiArea) => skiArea.properties.id
    ),
  };
}

export function simplifiedRunFeature(feature: RunFeature) {
  return {
    id: feature.properties.id,
    name: feature.properties.name,
    skiAreas: feature.properties.skiAreas.map(
      (skiArea) => skiArea.properties.id
    ),
  };
}

export function simplifiedSkiAreaFeature(feature: SkiAreaFeature) {
  return {
    id: feature.properties.id,
    name: feature.properties.name,
    activities: feature.properties.activities,
  };
}

export function simplifiedSkiAreaFeatureWithStatistics(
  feature: SkiAreaFeature
) {
  return {
    ...simplifiedSkiAreaFeature(feature),
    statistics: feature.properties.statistics,
  };
}

export function simplifiedSkiAreaFeatureWithSources(feature: SkiAreaFeature) {
  return {
    ...simplifiedSkiAreaFeature(feature),
    sources: feature.properties.sources,
  };
}
