import * as fs from "fs";
import {
  FeatureType,
  LiftFeature,
  LiftGeometry,
  LiftProperties,
  LiftType,
  Place,
  RunDifficulty,
  RunDifficultyConvention,
  RunFeature,
  RunGrooming,
  RunProperties,
  RunUse,
  SkiAreaActivity,
  SkiAreaFeature,
  SkiAreaProperties,
  SkiAreaStatistics,
  Source,
  SourceType,
  SpotFeature,
  SpotGeometry,
  SpotProperties,
  SpotType,
  Status,
} from "openskidata-format";
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
import { InputSpotFeature } from "./features/SpotFeature";
import {
  DataPaths,
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
  InputDataPaths,
} from "./io/GeoJSONFiles";
import placeholderSiteGeometry from "./utils/PlaceholderSiteGeometry";

export interface FolderContents extends Map<string, any> {}

export function getFilePaths(): DataPaths {
  const dir = tmp.dirSync().name;
  return {
    input: new InputDataPaths(path.join(dir, "input")),
    intermediate: new GeoJSONIntermediatePaths(path.join(dir, "intermediate")),
    output: new GeoJSONOutputPaths(path.join(dir, "output")),
  };
}

/**
 * Creates a unique temporary working directory for tests.
 * Each call returns a new, isolated directory to prevent test interference.
 */
export function getTempWorkingDir(): string {
  return tmp.dirSync().name;
}

export function mockInputFiles(
  input: {
    skiMapSkiAreas: InputSkiMapOrgSkiAreaFeature[];
    openStreetMapSkiAreas: InputOpenStreetMapSkiAreaFeature[];
    openStreetMapSkiAreaSites: OSMSkiAreaSite[];
    lifts: InputLiftFeature[];
    runs: InputRunFeature[];
    spots?: InputSpotFeature[];
  },
  inputPaths: InputDataPaths,
) {
  fs.writeFileSync(
    inputPaths.geoJSON.skiMapSkiAreas,
    JSON.stringify({
      type: "FeatureCollection",
      features: input.skiMapSkiAreas,
    }),
  );
  fs.writeFileSync(
    inputPaths.geoJSON.skiAreas,
    JSON.stringify({
      type: "FeatureCollection",
      features: input.openStreetMapSkiAreas,
    }),
  );
  fs.writeFileSync(
    inputPaths.osmJSON.skiAreaSites,
    JSON.stringify({
      elements: input.openStreetMapSkiAreaSites,
    }),
  );
  fs.writeFileSync(
    inputPaths.geoJSON.lifts,
    JSON.stringify({
      type: "FeatureCollection",
      features: input.lifts,
    }),
  );
  fs.writeFileSync(
    inputPaths.geoJSON.runs,
    JSON.stringify({
      type: "FeatureCollection",
      features: input.runs,
    }),
  );
  fs.writeFileSync(
    inputPaths.geoJSON.spots,
    JSON.stringify({
      type: "FeatureCollection",
      features: input.spots || [],
    }),
  );
}

export function mockFeatureFiles(
  skiAreas: SkiAreaFeature[],
  lifts: LiftFeature[],
  runs: RunFeature[],
  intermedatePaths: GeoJSONIntermediatePaths,
  spots?: SpotFeature[],
) {
  fs.writeFileSync(
    intermedatePaths.skiAreas,
    JSON.stringify({
      type: "FeatureCollection",
      features: skiAreas,
    }),
  );
  fs.writeFileSync(
    intermedatePaths.lifts,
    JSON.stringify({
      type: "FeatureCollection",
      features: lifts,
    }),
  );
  fs.writeFileSync(
    intermedatePaths.runs,
    JSON.stringify({
      type: "FeatureCollection",
      features: runs,
    }),
  );
  fs.writeFileSync(
    intermedatePaths.spots,
    JSON.stringify({
      type: "FeatureCollection",
      features: spots || [],
    }),
  );
}

export function contents(paths: GeoJSONOutputPaths): FolderContents {
  return [
    paths.lifts,
    paths.mapboxGL.lifts,
    paths.mapboxGL.runs,
    paths.mapboxGL.skiAreas,
    paths.mapboxGL.spots,
    paths.runs,
    paths.skiAreas,
    paths.spots,
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
  difficultyConvention?: RunDifficultyConvention;
  websites?: string[];
  wikidataID?: string | null;
  geometry: G;
  skiAreas?: SkiAreaFeature[];
  status?: Status;
  sources?: Source[];
  places?: Place[];
}): GeoJSON.Feature<G, RunProperties> {
  return {
    type: "Feature",
    properties: {
      type: FeatureType.Run,
      uses: options.uses || [RunUse.Downhill],
      id: options.id,
      name: options.name || null,
      difficulty: options.difficulty || null,
      difficultyConvention:
        options.difficultyConvention || RunDifficultyConvention.EUROPE,
      ref: options.ref || null,
      oneway: options.oneway !== undefined ? options.oneway : null,
      lit: null,
      description: null,
      gladed: null,
      patrolled: options.patrolled !== undefined ? options.patrolled : null,
      snowmaking: null,
      snowfarming: null,
      grooming: options.grooming || null,
      skiAreas: options.skiAreas || [],
      elevationProfile: null,
      status: options.status || Status.Operating,
      sources: options.sources || [],
      websites: options.websites || [],
      wikidataID: options.wikidataID || null,
      places: options.places || [],
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
  refFRCAIRN?: string | null;
  websites?: string[];
  wikidataID?: string | null;
  geometry: G;
  skiAreas?: SkiAreaFeature[];
  sources?: Source[];
  places?: Place[];
}): GeoJSON.Feature<G, LiftProperties> {
  return {
    type: "Feature",
    properties: {
      type: FeatureType.Lift,
      id: options.id,
      name: options.name,
      liftType: options.liftType,
      status: options.status || Status.Operating,
      ref: options.ref || null,
      refFRCAIRN: options.refFRCAIRN || null,
      description: null,
      oneway: null,
      occupancy: null,
      capacity: null,
      duration: null,
      bubble: null,
      heating: null,
      detachable: null,
      access: null,
      stations: [],
      skiAreas: options.skiAreas || [],
      sources: options.sources || [],
      websites: options.websites || [],
      wikidataID: options.wikidataID || null,
      places: options.places || [],
    },
    geometry: options.geometry,
  };
}

export function mockSpotFeature<G extends SpotGeometry>(
  options: {
    id: string;
    spotType: SpotType;
    geometry: G;
    skiAreas?: SkiAreaFeature[];
    sources?: Source[];
    places?: Place[];
  } & (
    | { spotType: SpotType.LiftStation; name?: string | null }
    | { spotType: Exclude<SpotType, SpotType.LiftStation> }
  ),
): GeoJSON.Feature<G, SpotProperties> {
  const baseProperties = {
    type: FeatureType.Spot as const,
    id: options.id,
    skiAreas: options.skiAreas || [],
    sources: options.sources || [],
    places: options.places || [],
  };

  let properties: SpotProperties;
  if (options.spotType === SpotType.LiftStation) {
    properties = {
      ...baseProperties,
      spotType: SpotType.LiftStation,
      name: "name" in options ? options.name || null : null,
      liftId: "",
      position: null,
      entry: null,
      exit: null,
    };
  } else if (options.spotType === SpotType.Crossing) {
    properties = {
      ...baseProperties,
      spotType: SpotType.Crossing,
      dismount: null,
    } as any;
  } else if (options.spotType === SpotType.AvalancheTransceiverTraining) {
    properties = {
      ...baseProperties,
      spotType: SpotType.AvalancheTransceiverTraining,
    };
  } else if (options.spotType === SpotType.AvalancheTransceiverCheckpoint) {
    properties = {
      ...baseProperties,
      spotType: SpotType.AvalancheTransceiverCheckpoint,
    };
  } else if (options.spotType === SpotType.Halfpipe) {
    properties = {
      ...baseProperties,
      spotType: SpotType.Halfpipe,
    };
  } else {
    throw new Error(`Unknown spot type: ${options.spotType}`);
  }

  return {
    type: "Feature",
    properties,
    geometry: options.geometry,
  };
}

type MockSkiAreaPropertyOptions = {
  id?: string;
  name?: string;
  activities?: SkiAreaActivity[];
  status?: Status;
  sources?: Source[];
  statistics?: SkiAreaStatistics;
  websites?: string[];
  wikidataID?: string | null;
};

type MockSkiAreaGeometryOptions<G extends SkiAreaGeometry> = {
  geometry: G;
};

export function mockSkiAreaFeature<G extends SkiAreaGeometry>(
  options: MockSkiAreaPropertyOptions & MockSkiAreaGeometryOptions<G>,
): GeoJSON.Feature<G, SkiAreaProperties> {
  return {
    type: "Feature",
    properties: {
      type: FeatureType.SkiArea,
      id: options.id !== undefined ? options.id : "ID",
      name: options.name !== undefined ? options.name : "Name",
      activities:
        options.activities !== undefined
          ? options.activities
          : [SkiAreaActivity.Downhill],
      status: options.status !== undefined ? options.status : Status.Operating,
      sources:
        options.sources !== undefined
          ? options.sources
          : [{ id: "1", type: SourceType.SKIMAP_ORG }],
      runConvention: RunDifficultyConvention.EUROPE,
      statistics: options.statistics,
      websites: options.websites || [],
      wikidataID: options.wikidataID || null,
      places: [],
    },
    geometry: options.geometry,
  };
}

export function mockSkiAreaSiteFeature(
  options: MockSkiAreaPropertyOptions & { osmID: number },
) {
  return mockSkiAreaFeature({
    geometry: placeholderSiteGeometry(options.osmID),
    ...options,
  });
}

export function simplifiedLiftFeature(feature: LiftFeature) {
  return {
    id: feature.properties.id,
    name: feature.properties.name,
    skiAreas: feature.properties.skiAreas.map(
      (skiArea) => skiArea.properties.id,
    ),
  };
}

export function simplifiedRunFeature(feature: RunFeature) {
  return {
    id: feature.properties.id,
    name: feature.properties.name,
    skiAreas: feature.properties.skiAreas.map(
      (skiArea) => skiArea.properties.id,
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
  feature: SkiAreaFeature,
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

export function simplifiedSpotFeature(feature: SpotFeature) {
  return {
    id: feature.properties.id,
    spotType: feature.properties.spotType,
    skiAreas: feature.properties.skiAreas.map(
      (skiArea) => skiArea.properties.id,
    ),
  };
}
