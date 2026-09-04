import * as turf from "@turf/helpers";
import { GeoJsonObject } from "geojson";
import { RunFeature, RunGeometry, RunProperties } from "openskidata-format";
import * as topojsonClient from "topojson-client";
import * as topojsonServer from "topojson-server";
import { performanceMonitor } from "../../clustering/database/PerformanceMonitor.js";
import buildFeature from "../FeatureBuilder.js";
import { FormattedInputRunFeature } from "../FormattedInputRunFeature.js";
import combineRunSegments from "../normalization/CombineRunSegments.js";
import {
  mergeOverlappingRuns,
  RunTopology,
} from "../normalization/MergeOverlappingRuns.js";
import Accumulator from "./Accumulator.js";

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
