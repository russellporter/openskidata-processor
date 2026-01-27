import { existsSync, mkdirSync } from "fs";
import { FeatureType } from "openskidata-format";
import { join } from "path";

export interface CommonGeoJSONPaths {
  readonly skiAreas: string;
  readonly runs: string;
  readonly lifts: string;
  readonly spots: string;
}

export class InputDataPaths {
  readonly osmJSON: OSMJSONInputPaths;
  readonly geoJSON: GeoJSONInputPaths;

  constructor(folder: string) {
    this.osmJSON = new OSMJSONInputPaths(folder);
    this.geoJSON = new GeoJSONInputPaths(folder);
  }
}

export class OSMJSONInputPaths {
  readonly skiAreas: string;
  readonly skiAreaSites: string; // note: sites are represented with OSM JSON.
  readonly runs: string;
  readonly lifts: string;
  readonly spots: string;

  constructor(folder: string) {
    if (!existsSync(folder)) {
      mkdirSync(folder);
    }
    this.skiAreas = join(folder, "input_ski_areas.osmjson");
    this.skiAreaSites = join(folder, "input_ski_area_sites.osmjson");
    this.runs = join(folder, "input_runs.osmjson");
    this.lifts = join(folder, "input_lifts.osmjson");
    this.spots = join(folder, "input_spots.osmjson");
  }
}

export class GeoJSONInputPaths {
  readonly skiMapSkiAreas: string;
  readonly skiAreas: string;
  readonly runs: string;
  readonly lifts: string;
  readonly spots: string;

  constructor(folder: string) {
    if (!existsSync(folder)) {
      mkdirSync(folder);
    }
    this.skiMapSkiAreas = join(folder, "input_skimap_ski_areas.geojson");
    this.skiAreas = join(folder, "input_openstreetmap_ski_areas.geojson");
    this.runs = join(folder, "input_runs.geojson");
    this.lifts = join(folder, "input_lifts.geojson");
    this.spots = join(folder, "input_spots.geojson");
  }
}

export class GeoJSONIntermediatePaths {
  readonly skiAreas: string;
  readonly runs: string;
  readonly lifts: string;
  readonly spots: string;

  constructor(folder: string) {
    if (!existsSync(folder)) {
      mkdirSync(folder);
    }
    this.skiAreas = join(folder, "intermediate_ski_areas.geojson");
    this.runs = join(folder, "intermediate_runs.geojson");
    this.lifts = join(folder, "intermediate_lifts.geojson");
    this.spots = join(folder, "intermediate_spots.geojson");
  }
}

export class GeoJSONOutputPaths implements CommonGeoJSONPaths {
  readonly skiAreas: string;
  readonly runs: string;
  readonly lifts: string;
  readonly spots: string;

  readonly mapboxGL: CommonGeoJSONPaths;
  readonly csv: string;
  readonly geoPackage: string;

  constructor(folder: string) {
    if (!existsSync(folder)) {
      mkdirSync(folder);
    }

    this.skiAreas = join(folder, "ski_areas.geojson");
    this.runs = join(folder, "runs.geojson");
    this.lifts = join(folder, "lifts.geojson");
    this.spots = join(folder, "spots.geojson");
    this.mapboxGL = {
      skiAreas: join(folder, "mapboxgl_ski_areas.geojson"),
      runs: join(folder, "mapboxgl_runs.geojson"),
      lifts: join(folder, "mapboxgl_lifts.geojson"),
      spots: join(folder, "mapboxgl_spots.geojson"),
    };
    this.csv = join(folder, "csv");
    if (!existsSync(this.csv)) {
      mkdirSync(this.csv);
    }
    this.geoPackage = join(folder, "openskidata.gpkg");
  }
}
export interface DataPaths {
  input: InputDataPaths;
  intermediate: GeoJSONIntermediatePaths;
  output: GeoJSONOutputPaths;
}

export function getPath(paths: CommonGeoJSONPaths, featureType: FeatureType) {
  switch (featureType) {
    case FeatureType.SkiArea:
      return paths.skiAreas;
    case FeatureType.Run:
      return paths.runs;
    case FeatureType.Lift:
      return paths.lifts;
    case FeatureType.Spot:
      return paths.spots;
  }

  throw "Unhandled feature type";
}
