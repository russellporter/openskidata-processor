import _ from "lodash";
import { RunLineFeature } from "../../features/RunFeature";

export default class PointMultiMap {
  private readonly _internal: Map<string, Set<RunLineFeature>>;

  constructor() {
    this._internal = new Map();
  }

  addFeature(point: number[], feature: RunLineFeature) {
    this._get(point).add(feature);
  }

  getMatchingFeature(point: number[], feature: RunLineFeature) {
    const set: Set<RunLineFeature> = this._get(point);
    for (let adjacentFeature of set) {
      if (
        feature !== adjacentFeature &&
        _.isEqual(adjacentFeature.properties, feature.properties)
      ) {
        return adjacentFeature;
      }
    }
    return null;
  }

  _get(point: number[]) {
    const key = point[0].toFixed(7) + "-" + point[1].toFixed(7);
    if (!this._internal.has(key)) {
      this._internal.set(key, new Set());
    }

    return this._internal.get(key) as Set<RunLineFeature>;
  }
}
