import * as _ from "lodash";
import { RunLineFeature } from "../../features/RunFeature";
import PointMultiMap from "./PointMultiMap";
import { isPartOfSameRun, mergedProperties } from "./RunJoining";

enum Direction {
  FORWARD,
  BACKWARD,
  BOTH
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

    feature = _.cloneDeep(feature);

    feature.properties = mergedProperties(
      features.map(f => f.feature.properties)
    );

    feature.geometry.coordinates = features.reduce(
      (coordinates: number[][], featureInfo) => {
        const feature = featureInfo.feature;
        const coordsLength = coordinates.length;
        let featureCoords = _.cloneDeep(feature.geometry.coordinates);
        if (featureInfo.reversed) {
          featureCoords.reverse();
        }
        if (coordsLength > 0) {
          if (!_.isEqual(featureCoords[0], coordinates[coordsLength - 1])) {
            throw "mismatched coords in PointGraph";
          }
          featureCoords = featureCoords.slice(1);
        }
        return coordinates.concat(featureCoords);
      },
      []
    );

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
    reversed?: boolean
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
        Direction.BACKWARD
      );
      features.push(...inbound);
      if (inbound.length === 0) {
        features.push(
          ...this._expandInReverse(
            this.outbound.getFeatures(head).find(featureMatcher) || null,
            Direction.BACKWARD
          )
        );
      }
    }

    features.push({ feature: feature, reversed: reversed === true });

    if (direction !== Direction.BACKWARD) {
      const outbound = this._expand(
        this.outbound.getFeatures(tail).find(featureMatcher) || null,
        Direction.FORWARD
      );
      features.push(...outbound);
      if (outbound.length === 0) {
        features.push(
          ...this._expandInReverse(
            this.inbound.getFeatures(tail).find(featureMatcher) || null,
            Direction.FORWARD
          )
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

module.exports = PointGraph;
