import { existsSync, mkdirSync } from "fs";
import { FeatureType } from "openskidata-format";
import { join } from "path";

interface CommonGeoJSONPaths {
  readonly skiAreas: string;
  readonly runs: string;
  readonly lifts: string;
}

export class GeoJSONInputPaths implements CommonGeoJSONPaths {
  readonly skiAreas: string;
  readonly runs: string;
  readonly lifts: string;

  constructor(folder: string) {
    this.skiAreas = join(folder, "input_ski_areas.geojson");
    this.runs = join(folder, "input_runs.geojson");
    this.lifts = join(folder, "input_lifts.geojson");
  }
}

export class GeoJSONIntermediatePaths {
  readonly skiAreas: string;
  readonly runs: string;
  readonly lifts: string;

  constructor(folder: string) {
    this.skiAreas = join(folder, "intermediate_ski_areas.geojson");
    this.runs = join(folder, "intermediate_runs.geojson");
    this.lifts = join(folder, "intermediate_lifts.geojson");
  }
}

export class GeoJSONOutputPaths implements CommonGeoJSONPaths {
  readonly skiAreas: string;
  readonly runs: string;
  readonly lifts: string;

  readonly mapboxGL: CommonGeoJSONPaths;

  constructor(folder: string) {
    if (!existsSync(folder)) {
      mkdirSync(folder);
    }

    this.skiAreas = join(folder, "ski_areas.geojson");
    this.runs = join(folder, "runs.geojson");
    this.lifts = join(folder, "lifts.geojson");
    this.mapboxGL = {
      skiAreas: join(folder, "mapboxgl_ski_areas.geojson"),
      runs: join(folder, "mapboxgl_runs.geojson"),
      lifts: join(folder, "mapboxgl_lifts.geojson")
    };
  }
}

export function getPath(paths: CommonGeoJSONPaths, featureType: FeatureType) {
  switch (featureType) {
    case FeatureType.SkiArea:
      return paths.skiAreas;
    case FeatureType.Run:
      return paths.runs;
    case FeatureType.Lift:
      return paths.lifts;
  }

  throw "Unhandled feature type";
}
