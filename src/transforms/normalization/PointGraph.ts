import { isDeepStrictEqual } from "util";
import { computeViewportHint } from "openskidata-format";
import { RunLineFeature } from "../../features/RunFeature.js";
import PointMultiMap from "./PointMultiMap.js";
import { isPartOfSameRun, mergedProperties } from "./RunJoining.js";

enum Direction {
  FORWARD,
  BACKWARD,
  BOTH,
}

export default class PointGraph {
  private readonly inbound: PointMultiMap;
  private readonly processed: Set<any>;
  private readonly outbound: PointMultiMap;

  constructor() {
    // lines coming into a point
    this.inbound = new PointMultiMap();
    // lines going out of a point
    this.outbound = new PointMultiMap();
    this.processed = new Set();
  }

  addFeature(feature: RunLineFeature) {
    const head = headPoint(feature);
    const tail = tailPoint(feature);

    this.outbound.addFeature(head, feature);
    this.inbound.addFeature(tail, feature);
  }

  merge(feature: RunLineFeature) {
    const features = this._expand(feature, Direction.BOTH);
    if (!features || features.length === 0) {
      return null;
    }

    feature = structuredClone(feature);

    feature.properties = mergedProperties(
      features.map((f) => f.feature.properties),
    );

    // Accumulated with push rather than concat. `concat` allocated a fresh array holding
    // every coordinate so far once per link in the chain, copying the growing prefix k
    // times and making a long chain quadratic in its total coordinate count.
    //
    // Each coordinate pair is still copied, so the merged geometry shares no array with
    // the features it was built from. That isolation is load-bearing: the elevation stage
    // appends a third element to coordinate pairs in place, so a shared pair would get
    // elevated twice.
    const mergedCoordinates: number[][] = [];
    for (const featureInfo of features) {
      const featureCoords = featureInfo.feature.geometry.coordinates;
      // Iterated in reverse instead of materializing a reversed copy.
      const count = featureCoords.length;
      for (let i = 0; i < count; i++) {
        const coordinate = featureInfo.reversed
          ? featureCoords[count - 1 - i]
          : featureCoords[i];
        if (i === 0 && mergedCoordinates.length > 0) {
          if (
            !isDeepStrictEqual(
              coordinate,
              mergedCoordinates[mergedCoordinates.length - 1],
            )
          ) {
            throw "mismatched coords in PointGraph";
          }
          // The shared endpoint is already present from the previous link.
          continue;
        }
        mergedCoordinates.push([...coordinate]);
      }
    }
    feature.geometry.coordinates = mergedCoordinates;

    feature.properties.viewportHint = computeViewportHint([feature.geometry]);

    return feature;
  }

  _expandInReverse(feature: RunLineFeature | null, direction: Direction) {
    if (!feature || hasDirection(feature) || this.processed.has(feature)) {
      return [];
    }

    return this._expand(feature, direction, true);
  }

  _expand(
    feature: RunLineFeature | null,
    direction: Direction,
    reversed?: boolean,
  ): { feature: RunLineFeature; reversed: boolean }[] {
    if (!feature || this.processed.has(feature)) {
      return [];
    }
    this.processed.add(feature);

    const head = reversed ? tailPoint(feature) : headPoint(feature);
    const tail = reversed ? headPoint(feature) : tailPoint(feature);
    const features = [];
    const featureMatcher = (otherFeature: RunLineFeature) =>
      feature !== otherFeature && isPartOfSameRun(feature, otherFeature);

    if (direction !== Direction.FORWARD) {
      const inbound = this._expand(
        this.inbound.getFeatures(head).find(featureMatcher) || null,
        Direction.BACKWARD,
      );
      features.push(...inbound);
      if (inbound.length === 0) {
        features.push(
          ...this._expandInReverse(
            this.outbound.getFeatures(head).find(featureMatcher) || null,
            Direction.BACKWARD,
          ),
        );
      }
    }

    features.push({ feature: feature, reversed: reversed === true });

    if (direction !== Direction.BACKWARD) {
      const outbound = this._expand(
        this.outbound.getFeatures(tail).find(featureMatcher) || null,
        Direction.FORWARD,
      );
      features.push(...outbound);
      if (outbound.length === 0) {
        features.push(
          ...this._expandInReverse(
            this.inbound.getFeatures(tail).find(featureMatcher) || null,
            Direction.FORWARD,
          ),
        );
      }
    }

    return features;
  }
}

function hasDirection(feature: RunLineFeature) {
  return feature.properties.oneway === true;
}

function headPoint(feature: RunLineFeature) {
  return feature.geometry.coordinates[0];
}

function tailPoint(feature: RunLineFeature) {
  const coords = feature.geometry.coordinates;
  return coords[coords.length - 1];
}
