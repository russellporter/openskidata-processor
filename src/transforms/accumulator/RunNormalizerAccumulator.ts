import * as turf from "@turf/helpers";
import { GeoJsonObject } from "geojson";
import { RunFeature, RunGeometry, RunProperties } from "openskidata-format";
import * as topojsonClient from "topojson-client";
import * as topojsonServer from "topojson-server";
import { performanceMonitor } from "../../clustering/database/PerformanceMonitor";
import buildFeature from "../FeatureBuilder";
import { FormattedInputRunFeature } from "../FormattedInputRunFeature";
import combineRunSegments from "../normalization/CombineRunSegments";
import {
  mergeOverlappingRuns,
  RunTopology,
} from "../normalization/MergeOverlappingRuns";
import Accumulator from "./Accumulator";

export class RunNormalizerAccumulator implements Accumulator<
  FormattedInputRunFeature,
  RunFeature
> {
  private features: FormattedInputRunFeature[];

  constructor() {
    this.features = [];
  }

  accumulate(input: FormattedInputRunFeature): void {
    this.features.push(input);
  }

  results(): RunFeature[] {
    const features = this.features;
    this.features = [];

    return performanceMonitor.withOperationSync(
      "Normalizing run topology",
      () => {
        const topology = mergeOverlappingRuns(
          topojsonServer.topology({
            runs: turf.featureCollection(features) as GeoJsonObject,
          }) as RunTopology,
        );

        return combineRunSegments(
          topojsonClient.feature(
            topology,
            topology.objects.runs,
          ) as GeoJSON.FeatureCollection<RunGeometry, RunProperties>,
        ).features.map((f) => {
          // Re-compute id hashes after normalizing
          return buildFeature(f.geometry, f.properties);
        });
      },
    );
  }
}
