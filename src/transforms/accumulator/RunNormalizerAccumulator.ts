import * as turf from "@turf/turf";
import { GeoJsonObject } from "geojson";
import { RunFeature, RunGeometry, RunProperties } from "openskidata-format";
import * as topojsonClient from "topojson-client";
import * as topojsonServer from "topojson-server";
import { InputRunGeometry } from "../../features/RunFeature";
import buildFeature from "../FeatureBuilder";
import combineRunSegments from "../normalization/CombineRunSegments";
import {
  mergeOverlappingRuns,
  RunTopology
} from "../normalization/MergeOverlappingRuns";
import Accumulator from "./Accumulator";

export class RunNormalizerAccumulator
  implements
    Accumulator<GeoJSON.Feature<InputRunGeometry, RunProperties>, RunFeature> {
  private features: GeoJSON.Feature<InputRunGeometry, RunProperties>[];

  constructor() {
    this.features = [];
  }

  accumulate(input: GeoJSON.Feature<InputRunGeometry, RunProperties>): void {
    this.features.push(input);
  }

  results(): RunFeature[] {
    const features = this.features;
    this.features = [];

    const topology = mergeOverlappingRuns(topojsonServer.topology({
      runs: turf.featureCollection(features) as GeoJsonObject
    }) as RunTopology);

    return combineRunSegments(topojsonClient.feature(
      topology,
      topology.objects.runs
    ) as GeoJSON.FeatureCollection<RunGeometry, RunProperties>).features.map(
      f => {
        // Re-compute id hashes after normalizing
        return buildFeature(
          f.geometry,
          (() => {
            delete f.properties.id;
            return f.properties;
          })()
        );
      }
    );
  }
}
