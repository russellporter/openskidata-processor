import { createWriteStream } from "fs";
import merge from "merge2";
import { FeatureType } from "openskidata-format";
import { Readable } from "stream";
import StreamToPromise from "stream-to-promise";
import clusterSkiAreas from "./clustering/ClusterSkiAreas";
import { Config } from "./Config";
import { DataPaths, getPath } from "./io/GeoJSONFiles";
import { readGeoJSONFeatures } from "./io/GeoJSONReader";
import { RunNormalizerAccumulator } from "./transforms/accumulator/RunNormalizerAccumulator";
import addElevation from "./transforms/Elevation";
import toFeatureCollection from "./transforms/FeatureCollection";
import { formatLift } from "./transforms/LiftFormatter";
import * as MapboxGLFormatter from "./transforms/MapboxGLFormatter";
import { formatRun } from "./transforms/RunFormatter";
import { formatSkiArea, InputSkiAreaType } from "./transforms/SkiAreaFormatter";
import {
  addSkiAreaSites,
  SkiAreaSiteProvider,
} from "./transforms/SkiAreaSiteProvider";
import {
  accumulate,
  flatMap,
  map,
  mapAsync,
} from "./transforms/StreamTransforms";

export default async function prepare(paths: DataPaths, config: Config) {
  const siteProvider = new SkiAreaSiteProvider();
  siteProvider.loadSites(paths.input.osmJSON.skiAreaSites);

  await Promise.all(
    [
      merge([
        readGeoJSONFeatures(paths.input.geoJSON.skiAreas).pipe(
          flatMap(formatSkiArea(InputSkiAreaType.OPENSTREETMAP_LANDUSE))
        ),
        Readable.from(siteProvider.getGeoJSONSites()),
        readGeoJSONFeatures(paths.input.geoJSON.skiMapSkiAreas).pipe(
          flatMap(formatSkiArea(InputSkiAreaType.SKIMAP_ORG))
        ),
      ])
        .pipe(toFeatureCollection())
        .pipe(
          createWriteStream(
            config.arangoDBURLForClustering
              ? paths.intermediate.skiAreas
              : paths.output.skiAreas
          )
        ),

      readGeoJSONFeatures(paths.input.geoJSON.runs)
        .pipe(flatMap(formatRun))
        .pipe(map(addSkiAreaSites(siteProvider)))
        .pipe(accumulate(new RunNormalizerAccumulator()))
        .pipe(
          mapAsync(
            config.elevationServerURL
              ? addElevation(config.elevationServerURL)
              : null,
            10
          )
        )
        .pipe(toFeatureCollection())
        .pipe(
          createWriteStream(
            config.arangoDBURLForClustering
              ? paths.intermediate.runs
              : paths.output.runs
          )
        ),

      readGeoJSONFeatures(paths.input.geoJSON.lifts)
        .pipe(flatMap(formatLift))
        .pipe(map(addSkiAreaSites(siteProvider)))
        .pipe(
          mapAsync(
            config.elevationServerURL
              ? addElevation(config.elevationServerURL)
              : null,
            10
          )
        )
        .pipe(toFeatureCollection())
        .pipe(
          createWriteStream(
            config.arangoDBURLForClustering
              ? paths.intermediate.lifts
              : paths.output.lifts
          )
        ),
    ].map((stream) => {
      return StreamToPromise(stream);
    })
  );

  if (config.arangoDBURLForClustering) {
    await clusterSkiAreas(
      paths.intermediate,
      paths.output,
      config.arangoDBURLForClustering,
      config.geocodingServer
    );
  }

  await Promise.all(
    [FeatureType.SkiArea, FeatureType.Lift, FeatureType.Run].map((type) => {
      return StreamToPromise(
        readGeoJSONFeatures(getPath(paths.output, type))
          .pipe(flatMap(MapboxGLFormatter.formatter(type)))
          .pipe(toFeatureCollection())
          .pipe(createWriteStream(getPath(paths.output.mapboxGL, type)))
      );
    })
  );
}
