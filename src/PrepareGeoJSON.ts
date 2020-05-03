import centroid from "@turf/centroid";
import { createWriteStream } from "fs";
import merge from "merge2";
import { FeatureType, SkiAreaFeature, SourceType } from "openskidata-format";
import StreamToPromise from "stream-to-promise";
import clusterSkiAreas from "./clustering/ClusterSkiAreas";
import { Config } from "./Config";
import { GeoJSONPaths, getPath } from "./io/GeoJSONFiles";
import { readGeoJSONFeatures } from "./io/GeoJSONReader";
import { RunNormalizerAccumulator } from "./transforms/accumulator/RunNormalizerAccumulator";
import addElevation from "./transforms/Elevation";
import toFeatureCollection from "./transforms/FeatureCollection";
import Geocoder from "./transforms/Geocoder";
import { formatLift } from "./transforms/LiftFormatter";
import * as MapboxGLFormatter from "./transforms/MapboxGLFormatter";
import { formatRun } from "./transforms/RunFormatter";
import { formatSkiArea } from "./transforms/SkiAreaFormatter";
import {
  accumulate,
  flatMap,
  map,
  mapAsync,
} from "./transforms/StreamTransforms";

export default async function prepare(paths: GeoJSONPaths, config: Config) {
  const geocoder =
    config.geocodingServer !== null
      ? new Geocoder(config.geocodingServer)
      : null;
  await Promise.all(
    [
      merge([
        readGeoJSONFeatures(paths.input.skiAreas).pipe(
          flatMap(formatSkiArea(SourceType.OPENSTREETMAP))
        ),
        readGeoJSONFeatures(paths.input.skiMapSkiAreas).pipe(
          flatMap(formatSkiArea(SourceType.SKIMAP_ORG))
        ),
      ])
        .pipe(
          mapAsync(async (feature: SkiAreaFeature) => {
            const result = await geocoder?.geocode(
              centroid(feature).geometry.coordinates
            );
            console.log(result);
            return feature;
          })
        )
        .pipe(toFeatureCollection())
        .pipe(
          createWriteStream(
            config.arangoDBURLForClustering
              ? paths.intermediate.skiAreas
              : paths.output.skiAreas
          )
        ),

      readGeoJSONFeatures(paths.input.runs)
        .pipe(flatMap(formatRun))
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

      readGeoJSONFeatures(paths.input.lifts)
        .pipe(flatMap(formatLift))
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
      config.arangoDBURLForClustering
    );
  }

  await Promise.all(
    [FeatureType.SkiArea, FeatureType.Lift, FeatureType.Run].map((type) => {
      return StreamToPromise(
        readGeoJSONFeatures(getPath(paths.output, type))
          .pipe(map(MapboxGLFormatter.formatter(type)))
          .pipe(toFeatureCollection())
          .pipe(createWriteStream(getPath(paths.output.mapboxGL, type)))
      );
    })
  );
}
