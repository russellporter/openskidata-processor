import merge from "merge2";
import { FeatureType, SourceType } from "openskidata-format";
import StreamToPromise from "stream-to-promise";
import clusterSkiAreas from "./clustering/ClusterSkiAreas";
import { Config } from "./Config";
import {
  GeoJSONInputPaths,
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
  getPath,
} from "./io/GeoJSONFiles";
import { readGeoJSONFeatures } from "./io/GeoJSONReader";
import { writeGeoJSONFeatures } from "./io/GeoJSONWriter";
import { RunNormalizerAccumulator } from "./transforms/accumulator/RunNormalizerAccumulator";
import addElevation from "./transforms/Elevation";
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

export default async function prepare(
  inputPaths: GeoJSONInputPaths,
  intermediatePaths: GeoJSONIntermediatePaths,
  outputPaths: GeoJSONOutputPaths,
  config: Config
) {
  await Promise.all(
    [
      merge([
        readGeoJSONFeatures(inputPaths.skiAreas).pipe(
          flatMap(formatSkiArea(SourceType.OPENSTREETMAP))
        ),
        readGeoJSONFeatures(inputPaths.skiMapSkiAreas).pipe(
          flatMap(formatSkiArea(SourceType.SKIMAP_ORG))
        ),
      ]).pipe(
        writeGeoJSONFeatures(
          config.arangoDBURLForClustering
            ? intermediatePaths.skiAreas
            : outputPaths.skiAreas
        )
      ),

      readGeoJSONFeatures(inputPaths.runs)
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
        .pipe(
          writeGeoJSONFeatures(
            config.arangoDBURLForClustering
              ? intermediatePaths.runs
              : outputPaths.runs
          )
        ),

      readGeoJSONFeatures(inputPaths.lifts)
        .pipe(flatMap(formatLift))
        .pipe(
          mapAsync(
            config.elevationServerURL
              ? addElevation(config.elevationServerURL)
              : null,
            10
          )
        )
        .pipe(
          writeGeoJSONFeatures(
            config.arangoDBURLForClustering
              ? intermediatePaths.lifts
              : outputPaths.lifts
          )
        ),
    ].map((stream) => {
      return StreamToPromise(stream);
    })
  );

  if (config.arangoDBURLForClustering) {
    await clusterSkiAreas(
      intermediatePaths.skiAreas,
      outputPaths.skiAreas,
      intermediatePaths.lifts,
      outputPaths.lifts,
      intermediatePaths.runs,
      outputPaths.runs,
      config.arangoDBURLForClustering
    );
  }

  await Promise.all(
    [FeatureType.SkiArea, FeatureType.Lift, FeatureType.Run].map((type) => {
      return StreamToPromise(
        readGeoJSONFeatures(getPath(outputPaths, type))
          .pipe(map(MapboxGLFormatter.formatter(type)))
          .pipe(writeGeoJSONFeatures(getPath(outputPaths.mapboxGL, type)))
      );
    })
  );
}
