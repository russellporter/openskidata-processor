import _ from "lodash";
import {
  FeatureType,
  Place,
  RunDifficulty,
  RunFeature,
  RunGrooming,
  RunProperties,
  Status,
} from "openskidata-format";
import mergedAndUniqued from "../../utils/mergedAndUniqued";
import uniquedSources from "../UniqueSources";

const ignoredPropertiesForComparison: Set<string> = new Set<
  keyof RunProperties
>(["id", "sources", "skiAreas", "elevationProfile", "places"]);

export function isPartOfSameRun(
  leftFeature: RunFeature,
  rightFeature: RunFeature,
): boolean {
  return _.isEqualWith(
    leftFeature.properties,
    rightFeature.properties,
    (
      left: any,
      right: any,
      indexOrKey: _.PropertyName | undefined,
      leftParent: any,
      rightParent: any,
      stack: any,
    ) => {
      if (
        leftParent === leftFeature.properties &&
        typeof indexOrKey === "string" &&
        ignoredPropertiesForComparison.has(indexOrKey)
      ) {
        return true;
      }

      return undefined;
    },
  );
}

export function mergedProperties(
  allProperties: RunProperties[],
): RunProperties {
  if (allProperties.length === 0) {
    throw "No input properties";
  }

  return {
    type: FeatureType.Run,
    id: allProperties[0].id,
    uses: Array.from(new Set(allProperties.flatMap((p) => p.uses))),
    name: sanitizeUniqueAndJoin(allProperties.map((p) => p.name)),
    ref: sanitizeUniqueAndJoin(allProperties.map((p) => p.ref)),
    description: sanitizeUniqueAndJoin(allProperties.map((p) => p.description)),
    difficulty: allProperties
      .map((p) => p.difficulty)
      .reduce(difficultyReducer),
    difficultyConvention: allProperties[0].difficultyConvention,
    status: allProperties.map((p) => p.status).reduce(statusReducer),
    oneway: allProperties.reduce(
      (accumulated, properties) => {
        if (accumulated === null) {
          return properties.oneway;
        }
        if (properties.oneway === null) {
          return accumulated;
        }
        return accumulated && properties.oneway;
      },
      null as boolean | null,
    ),
    lit: allProperties.map((p) => p.lit).reduce(litReducer),
    gladed: allProperties.map((p) => p.gladed).reduce(gladedReducer),
    patrolled: allProperties.map((p) => p.patrolled).reduce(patrolledReducer),
    grooming: allProperties.map((p) => p.grooming).reduce(groomingReducer),
    skiAreas: uniquedByID(allProperties.flatMap((p) => p.skiAreas)),
    elevationProfile: allProperties[0].elevationProfile,
    sources: uniquedSources(
      allProperties.flatMap((properties) => properties.sources),
    ),
    websites: mergedAndUniqued(
      ...allProperties.map((properties) => properties.websites),
    ),
    wikidataID:
      allProperties
        .map((properties) => properties.wikidataID)
        .find((id) => id !== null) || null,
    places: uniquePlaces(allProperties.flatMap((p) => p.places)),
  };
}

type Reducer<V> = (previousValue: V, currentValue: V) => V;

enum ComparisonResult {
  LEFT,
  RIGHT,
}

function comparePriority<V>(
  left: V,
  right: V,
  priorityTable: Map<V, number>,
): ComparisonResult {
  const leftPriority = priorityTable.get(left);
  const rightPriority = priorityTable.get(right);
  if (leftPriority === undefined) {
    throw "Missing priority for " + left;
  }
  if (rightPriority === undefined) {
    throw "Missing priority for " + right;
  }

  return leftPriority > rightPriority
    ? ComparisonResult.LEFT
    : ComparisonResult.RIGHT;
}

function pickReducer<V>(priorityTable: Map<V, number>): Reducer<V> {
  return (previousValue: V, currentValue: V) => {
    return comparePriority(previousValue, currentValue, priorityTable) ===
      ComparisonResult.LEFT
      ? previousValue
      : currentValue;
  };
}

function sanitizeUniqueAndJoin(values: (string | null)[]): string | null {
  let uniqueValues = new Set(
    values
      .filter((v): v is string => v !== null)
      .map((value) => {
        return value.trim();
      })
      .filter((value) => {
        return value.length > 0;
      }),
  );

  return uniqueValues.size > 0 ? _.join(Array.from(uniqueValues), ", ") : null;
}
function sortPriority<T>(values: T[]): Map<T, number> {
  const map = new Map<T, number>();
  const length = values.length;
  values.forEach((value, index) => {
    map.set(value, length - index);
  });

  return map;
}

function priorityReducer<V>(values: V[]): Reducer<V> {
  return pickReducer(sortPriority(values));
}

const difficultyReducer = priorityReducer([
  RunDifficulty.NOVICE,
  RunDifficulty.EASY,
  RunDifficulty.INTERMEDIATE,
  RunDifficulty.ADVANCED,
  RunDifficulty.EXPERT,
  RunDifficulty.FREERIDE,
  RunDifficulty.EXTREME,
  null,
]);

const groomingReducer = priorityReducer([
  RunGrooming.ClassicAndSkating,
  RunGrooming.Skating,
  RunGrooming.Classic,
  RunGrooming.Mogul,
  RunGrooming.Scooter,
  RunGrooming.Backcountry,
  null,
]);

const statusReducer = priorityReducer([
  Status.Operating,
  Status.Construction,
  Status.Planned,
  Status.Proposed,
  Status.Disused,
  Status.Abandoned,
]);

const gladedReducer = priorityReducer([true, false, null]);

const patrolledReducer = priorityReducer([true, false, null]);

const litReducer = priorityReducer([true, false, null]);

function uniquedByID<Feature extends { properties: { id: string } }>(
  features: Feature[],
): Feature[] {
  let ids = new Set();

  return features.filter((feature) => {
    if (ids.has(feature.properties.id)) {
      return false;
    }

    ids.add(feature.properties.id);

    return true;
  });
}

function uniquePlaces(places: Place[]): Place[] {
  const seen = new Set<string>();

  return places.filter((place) => {
    // Create a unique key from the place's identifying properties
    const key = JSON.stringify({
      iso3166_1Alpha2: place.iso3166_1Alpha2,
      iso3166_2: place.iso3166_2,
      locality: place.localized.en.locality,
    });

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
