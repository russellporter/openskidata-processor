import objectHash from "object-hash";
import { FeatureType } from "openskidata-format";

/**
 * Marks a feature whose ID has not been computed yet.
 *
 * Only runs use this, and only between the formatter and the normalizer. It is a visible
 * sentinel rather than an empty string so that if one ever reaches an output file the
 * cause is obvious instead of looking like missing data.
 */
export const DEFERRED_FEATURE_ID = "__deferred_feature_id__";

export function featureID<G extends GeoJSON.Geometry>(
  geometry: G,
  type: FeatureType,
): string {
  return objectHash({
    type: "Feature",
    properties: {
      type: type,
    },
    geometry: geometry,
  });
}

export default function buildFeature<
  G extends GeoJSON.Geometry,
  P extends { type: FeatureType },
>(geometry: G, properties: P): GeoJSON.Feature<G, P & { id: string }> {
  return {
    type: "Feature",
    properties: { ...properties, id: featureID(geometry, properties.type) },
    geometry: geometry,
  };
}

/**
 * Builds a feature without computing its ID.
 *
 * The ID is a hash over every coordinate of the geometry, so computing it is proportional
 * to the size of the feature. For runs that work was being done twice: once here, and
 * again in `RunNormalizerAccumulator` after normalization, which must re-hash anyway
 * because splitting and merging changes the geometry the ID is derived from. The first
 * hash was always discarded — `id` is in `ignoredPropertiesForComparison`, so run joining
 * does not look at it, and nothing between the formatter and the normalizer reads it.
 *
 * Callers must pass the result through something that assigns a real ID. Everything other
 * than runs should use `buildFeature`, since those features keep the ID they are built
 * with.
 */
export function buildFeatureWithDeferredID<
  G extends GeoJSON.Geometry,
  P extends { type: FeatureType },
>(geometry: G, properties: P): GeoJSON.Feature<G, P & { id: string }> {
  return {
    type: "Feature",
    properties: { ...properties, id: DEFERRED_FEATURE_ID },
    geometry: geometry,
  };
}
