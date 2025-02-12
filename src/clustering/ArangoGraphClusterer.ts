import along from "@turf/along";
import centroid from "@turf/centroid";
import * as turf from "@turf/helpers";
import length from "@turf/length";
import nearestPoint from "@turf/nearest-point";
import union from "@turf/union";
import { aql, Database } from "arangojs";
import { AqlQuery } from "arangojs/aql";
import { ArrayCursor } from "arangojs/cursor";
import { QueryOptions } from "arangojs/database";
import { AssertionError } from "assert";
import { backOff } from "exponential-backoff";
import * as GeoJSON from "geojson";
import { Activity, FeatureType, SourceType, Status } from "openskidata-format";
import { v4 as uuid } from "uuid";
import { skiAreaStatistics } from "../statistics/SkiAreaStatistics";
import Geocoder from "../transforms/Geocoder";
import {
  bufferGeometry,
  getPoints,
  getPositions,
} from "../transforms/GeoTransforms";
import { getRunConvention } from "../transforms/RunFormatter";
import notEmpty from "../utils/notEmpty";
import { isPlaceholderGeometry } from "../utils/PlaceholderSiteGeometry";
import { arangoGeometry, isArangoInvalidGeometryError } from "./ArangoHelpers";
import {
  DraftSkiArea,
  LiftObject,
  MapObject,
  MapObjectType,
  RunObject,
  SkiAreaObject,
} from "./MapObject";
import mergeSkiAreaObjects from "./MergeSkiAreaObjects";
import { emptySkiAreasCursor, SkiAreasCursor } from "./SkiAreasCursor";

type SearchType = "contains" | "intersects";
interface VisitContext {
  id: string;
  activities: Activity[];
  excludeObjectsAlreadyInSkiArea?: boolean;
  searchPolygon?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  searchType: SearchType;
  isFixedSearchArea: boolean;
  alreadyVisited: string[];
}

const maxDistanceInKilometers = 0.5;

export const allSkiAreaActivities = new Set([
  Activity.Downhill,
  Activity.Nordic,
]);

/**
 * - Associate runs & lifts with ski areas.
 * - Combine ski areas from different sources (Skimap.org and OpenStreetMap)
 * - Generate statistics for each ski area
 *
 * Because the relationships between objects are only implied based on their relative positions,
 * this is not perfect. There are a number of stages to handle some well known edge cases, like adjacent ski areas.
 */
export default async function clusterArangoGraph(
  database: Database,
  geocoder: Geocoder | null,
): Promise<void> {
  const objectsCollection = database.collection("objects");

  console.log(
    "Assign ski area activities and geometry based on member objects",
  );
  await assignSkiAreaActivitiesAndGeometryBasedOnMemberObjects();

  console.log("Remove ambiguous duplicate ski areas");
  await removeAmbiguousDuplicateSkiAreas();

  // For all OpenStreetMap ski areas (polygons), associate runs & lifts within that polygon.
  // Ski areas without any objects or with a significant number of objects assigned to a site=piste relation are removed.
  console.log("Assign objects in OSM polygon ski areas");
  await assignObjectsToSkiAreas({
    skiArea: {
      onlySource: SourceType.OPENSTREETMAP,
      removeIfNoObjectsFound: true,
      removeIfSubstantialNumberOfObjectsInSkiAreaSite: true,
    },
    objects: { onlyInPolygon: true },
  });

  // For all OpenStreetMap ski areas, in a second pass, associate nearby runs & lifts that are not already assigned to a ski area.
  console.log("Assign nearby objects to OSM ski areas");
  await assignObjectsToSkiAreas({
    skiArea: { onlySource: SourceType.OPENSTREETMAP },
    objects: { onlyIfNotAlreadyAssigned: true },
  });

  // Merge ski areas from different sources: For all Skimap.org ski areas, if an OpenStreetMap ski area is nearby, merge them
  console.log("Merge skimap.org and OpenStreetMap ski areas");
  await mergeSkimapOrgWithOpenStreetMapSkiAreas();

  // For all Skimap.org ski areas, associate nearby runs & lifts that are not already assigned to a ski area.
  console.log("assign nearby objects to Skimap.org ski areas");
  await assignObjectsToSkiAreas({
    skiArea: {
      onlySource: SourceType.SKIMAP_ORG,
    },
    objects: { onlyIfNotAlreadyAssigned: true },
  });

  // For each remaining unclaimed run, generate a ski area for it, associating nearby unclaimed runs & lifts.
  console.log("Generate ski areas for unassigned objects");
  await generateSkiAreasForUnassignedObjects();

  console.log("Augment ski areas based on assigned lifts and runs");
  await augmentSkiAreasBasedOnAssignedLiftsAndRuns(geocoder);

  console.log("Remove ski areas without a geometry");
  await removeSkiAreasWithoutGeometry();

  async function performQuery<T = any>(
    query: AqlQuery,
    options?: QueryOptions,
  ): Promise<ArrayCursor<T>> {
    try {
      return await backOff(() => database.query(query, options));
    } catch (exception) {
      console.error(`Error performing query: ${query.query}: ${exception}`);
      throw exception;
    }
  }

  /**
   * Remove OpenStreetMap ski areas that contain multiple Skimap.org ski areas in their geometry.
   * This step removes relations that span across a group of separate ski resorts that have a shared ticketing system,
   * for example: https://www.openstreetmap.org/relation/10728343
   */
  async function removeAmbiguousDuplicateSkiAreas(): Promise<void> {
    const cursor = await getSkiAreas({
      onlyPolygons: true,
      onlySource: SourceType.OPENSTREETMAP,
    });

    let skiAreas: SkiAreaObject[];
    while ((skiAreas = (await cursor.batches?.next()) as SkiAreaObject[])) {
      await Promise.all(
        skiAreas.map(async (skiArea) => {
          if (
            skiArea.geometry.type !== "Polygon" &&
            skiArea.geometry.type !== "MultiPolygon"
          ) {
            throw new AssertionError({
              message:
                "getSkiAreas query should have only returned ski areas with a Polygon geometry.",
            });
          }
          const otherSkiAreasCursor = await getSkiAreas({
            onlySource: SourceType.SKIMAP_ORG,
            onlyInPolygon: skiArea.geometry,
          });

          const otherSkiAreas = await otherSkiAreasCursor.all();
          if (otherSkiAreas.length > 1) {
            console.log(
              "Removing OpenStreetMap ski area as it contains multiple Skimap.org ski areas and can't be merged correctly.",
            );
            console.log(JSON.stringify(skiArea));

            await objectsCollection.remove({ _key: skiArea._key });
          }
        }),
      );
    }
  }

  async function removeSkiAreasWithoutGeometry() {
    const cursor = await getSkiAreas({
      onlySource: SourceType.OPENSTREETMAP,
    });

    let skiAreas: SkiAreaObject[];
    while ((skiAreas = (await cursor.batches?.next()) as SkiAreaObject[])) {
      await Promise.all(
        skiAreas.map(async (skiArea) => {
          if (
            skiArea.geometry.type === "Point" &&
            isPlaceholderGeometry(skiArea.geometry)
          ) {
            console.log(
              "Removing OpenStreetMap ski area as it doesn't have a geometry. This can happen if a site=piste relation doesn't contain any clustered lifts/runs inside it.",
            );

            await objectsCollection.remove({ _key: skiArea._key });
          }
        }),
      );
    }
  }

  // Determine ski area activities based on the associated map objects.
  // site=piste ski areas don't contain this information initially when they are loaded.
  async function assignSkiAreaActivitiesAndGeometryBasedOnMemberObjects() {
    const skiAreasCursor = await getSkiAreas({});

    let skiAreas: SkiAreaObject[] | undefined;
    while ((skiAreas = await skiAreasCursor.batches?.next())) {
      await Promise.all(
        skiAreas.map(async (skiArea) => {
          if (skiArea.activities.length > 0) {
            return;
          }

          const memberObjects = await getObjects(skiArea.id);
          const activities = getActivitiesBasedOnRunsAndLifts(memberObjects);

          if (activities.length == 0) {
            return;
          }

          await objectsCollection.update(
            { _key: skiArea._key },
            {
              activities: [...activities],
              geometry: skiAreaGeometry(memberObjects),
              properties: {
                activities: [...activities],
              },
            },
          );
        }),
      );
    }
  }

  async function assignObjectsToSkiAreas(options: {
    skiArea: {
      onlySource: SourceType;
      removeIfNoObjectsFound?: boolean;
      removeIfSubstantialNumberOfObjectsInSkiAreaSite?: boolean;
    };
    objects: {
      onlyIfNotAlreadyAssigned?: boolean;
      onlyInPolygon?: boolean;
    };
  }): Promise<void> {
    const skiAreasCursor = await getSkiAreas({
      onlyPolygons: options.objects.onlyInPolygon || false,
      onlySource: options.skiArea.onlySource,
    });

    let skiAreas: SkiAreaObject[];
    while (
      (skiAreas = (await skiAreasCursor.batches?.next()) as SkiAreaObject[])
    ) {
      await Promise.all(
        skiAreas.map(async (skiArea) => {
          const id = skiArea.properties.id;

          const hasKnownSkiAreaActivities = skiArea.activities.length > 0;
          const activitiesForClustering = hasKnownSkiAreaActivities
            ? skiArea.activities
            : [...allSkiAreaActivities];
          skiArea.activities = activitiesForClustering;

          let isFixedSearchArea: boolean;
          let searchType: SearchType;
          let searchPolygon: GeoJSON.Polygon | GeoJSON.MultiPolygon | null =
            null;
          if (options.objects.onlyInPolygon) {
            if (
              skiArea.geometry.type === "Polygon" ||
              skiArea.geometry.type === "MultiPolygon"
            ) {
              searchPolygon = skiArea.geometry;
              searchType = "contains";
              isFixedSearchArea = true;
            } else {
              throw new AssertionError({
                message: "Ski area geometry must be a polygon.",
              });
            }
          } else {
            searchType = "intersects";
            isFixedSearchArea = false;
            const liftAndRunObjects = await getObjects(skiArea.id);
            const bufferedObjectGeometries = [...liftAndRunObjects, skiArea]
              .map((object) =>
                bufferGeometry(object.geometry, maxDistanceInKilometers),
              )
              .filter(notEmpty);

            if (bufferedObjectGeometries.length > 0) {
              searchPolygon = bufferedObjectGeometries.reduce(
                (previous, current) => {
                  try {
                    return union(
                      turf.featureCollection([
                        turf.feature(previous),
                        turf.feature(current),
                      ]),
                    )!.geometry;
                  } catch (error) {
                    // https://github.com/mfogel/polygon-clipping/issues/115
                    console.log(`
                    Failed unioning polygons: ${error}
                    
                    Left: ${JSON.stringify(previous)}
                    Right: ${JSON.stringify(current)}
                    `);
                    return previous;
                  }
                },
              );
            }
          }

          const memberObjects = await visitObject(
            {
              id: id,
              activities: activitiesForClustering,
              searchPolygon: searchPolygon,
              searchType: searchType,
              isFixedSearchArea: isFixedSearchArea,
              alreadyVisited: [skiArea._key],
              excludeObjectsAlreadyInSkiArea:
                options.objects.onlyIfNotAlreadyAssigned || false,
            },
            skiArea,
          );
          const removeDueToNoObjects =
            options.skiArea.removeIfNoObjectsFound &&
            !memberObjects.some(
              (object) => object.type !== MapObjectType.SkiArea,
            );
          if (removeDueToNoObjects) {
            console.log(
              `Removing ski area (${JSON.stringify(
                skiArea.properties.sources,
              )}) as no objects were found.`,
            );
            await objectsCollection.remove({ _key: skiArea._key });
            return;
          }

          const liftsAndRuns = memberObjects.filter(
            (object): object is LiftObject | RunObject =>
              object.type === MapObjectType.Lift ||
              object.type === MapObjectType.Run,
          );
          const liftsAndRunsInSiteRelation = liftsAndRuns.filter(
            (object) => object.isInSkiAreaSite,
          );
          const removeDueToSignificantObjectsInSiteRelation =
            options.skiArea.removeIfSubstantialNumberOfObjectsInSkiAreaSite &&
            liftsAndRunsInSiteRelation.length / liftsAndRuns.length > 0.5;
          if (removeDueToSignificantObjectsInSiteRelation) {
            console.log(
              `Removing ski area (${JSON.stringify(
                skiArea.properties.sources,
              )}) as a substantial number of objects were in a site=piste relation (${
                liftsAndRunsInSiteRelation.length
              } / ${liftsAndRuns.length}).`,
            );
            await objectsCollection.remove({ _key: skiArea._key });
            return;
          }

          await markSkiArea(
            id,
            options.objects.onlyInPolygon || false,
            memberObjects,
          );

          // Update ski area activities based on the clustered objects.
          if (!hasKnownSkiAreaActivities) {
            const activities = getActivitiesBasedOnRunsAndLifts(memberObjects);

            await objectsCollection.update(
              { _key: skiArea._key },
              {
                activities: [...activities],
                properties: {
                  activities: [...activities],
                },
              },
            );
          }
        }),
      );
    }
  }

  async function mergeSkimapOrgWithOpenStreetMapSkiAreas(): Promise<void> {
    const skiAreasCursor = await getSkiAreas({
      onlySource: SourceType.SKIMAP_ORG,
    });

    let skiArea: SkiAreaObject | undefined;
    // Merging is not batching-safe, so only process one ski area at a time.
    while ((skiArea = await skiAreasCursor.next())) {
      const hasKnownSkiAreaActivities = skiArea.activities.length > 0;
      const activitiesForClustering = hasKnownSkiAreaActivities
        ? skiArea.activities
        : [...allSkiAreaActivities];
      skiArea.activities = activitiesForClustering;

      const skiAreasToMerge = await getSkiAreasToMergeInto(skiArea);
      if (skiAreasToMerge.length > 0) {
        await mergeIntoSkiAreas(skiArea, skiAreasToMerge);
      }
    }
  }

  async function generateSkiAreasForUnassignedObjects(): Promise<void> {
    let unassignedRun: MapObject;
    while ((unassignedRun = await nextUnassignedRun())) {
      try {
        await generateSkiAreaForRun(unassignedRun);
      } catch (exception) {
        console.log("Processing unassigned run failed.", exception);
      }
    }
  }

  async function generateSkiAreaForRun(unassignedRun: RunObject) {
    const newSkiAreaID = uuid();
    let activities = unassignedRun.activities.filter((activity) =>
      allSkiAreaActivities.has(activity),
    );
    let memberObjects = await visitObject(
      {
        id: newSkiAreaID,
        activities: activities,
        alreadyVisited: [unassignedRun._key],
        searchType: "intersects",
        isFixedSearchArea: false,
      },
      unassignedRun,
    );

    // Downhill ski areas must contain at least one lift.
    if (
      activities.includes(Activity.Downhill) &&
      !memberObjects.some((object) => object.type == MapObjectType.Lift)
    ) {
      activities = activities.filter(
        (activity) => activity !== Activity.Downhill,
      );
      memberObjects = memberObjects.filter((object) => {
        const hasAnotherActivity = object.activities.some(
          (activity) =>
            activity !== Activity.Downhill &&
            allSkiAreaActivities.has(activity),
        );
        return hasAnotherActivity;
      });
    }

    if (activities.length === 0 || memberObjects.length === 0) {
      await objectsCollection.update(
        { _key: unassignedRun._key },
        { isBasisForNewSkiArea: false },
      );
      return;
    }

    await createGeneratedSkiArea(newSkiAreaID, activities, memberObjects);
  }

  async function visitPolygon(
    context: VisitContext,
    geometry: GeoJSON.Polygon,
  ): Promise<MapObject[]> {
    const objects = await findNearbyObjects(geometry, context);

    // Skip further traversal if we are searching a fixed polygon.
    if (context.isFixedSearchArea) {
      return objects;
    } else {
      let foundObjects: MapObject[] = [];
      for (let i = 0; i < objects.length; i++) {
        foundObjects = foundObjects.concat(
          await visitObject(context, objects[i]),
        );
      }
      return foundObjects;
    }
  }

  async function visitObject(
    context: VisitContext,
    object: MapObject,
  ): Promise<MapObject[]> {
    let searchArea =
      context.searchPolygon ||
      bufferGeometry(object.geometry, maxDistanceInKilometers);
    let foundObjects: MapObject[] = [object];
    if (searchArea === null) {
      return foundObjects;
    }
    const objectContext = {
      ...context,
      searchPolygon: context.isFixedSearchArea ? context.searchPolygon : null,
      activities: context.activities.filter((activity) =>
        object.activities.includes(activity),
      ),
    };
    switch (searchArea.type) {
      case "Polygon":
        return foundObjects.concat(
          await visitPolygon(objectContext, searchArea),
        );
      case "MultiPolygon":
        for (let i = 0; i < searchArea.coordinates.length; i++) {
          foundObjects = foundObjects.concat(
            await visitPolygon(
              objectContext,
              turf.polygon(searchArea.coordinates[i]).geometry,
            ),
          );
        }
        return foundObjects;
      default:
        throw "Unexpected visit area geometry type " + searchArea;
    }
  }

  async function getSkiAreasToMergeInto(
    skiArea: SkiAreaObject,
  ): Promise<SkiAreaObject[]> {
    const maxMergeDistanceInKilometers = 0.25;
    const buffer = bufferGeometry(
      skiArea.geometry,
      maxMergeDistanceInKilometers,
    );
    if (!buffer) {
      return [];
    }

    const nearbyObjects = await findNearbyObjects(buffer, {
      id: skiArea.id,
      activities: skiArea.activities,
      alreadyVisited: [],
      searchType: "intersects",
      isFixedSearchArea: true,
    });

    const otherSkiAreaIDs = new Set(
      nearbyObjects.flatMap((object) => object.skiAreas),
    );

    const otherSkiAreasCursor = await getSkiAreasByID(
      Array.from(otherSkiAreaIDs),
    );
    const otherSkiAreas: SkiAreaObject[] = await otherSkiAreasCursor.all();

    return otherSkiAreas.filter(
      (otherSkiArea) => otherSkiArea.source != skiArea.source,
    );
  }

  async function mergeIntoSkiAreas(
    skimapOrgSkiArea: SkiAreaObject,
    skiAreas: SkiAreaObject[],
  ): Promise<void> {
    console.log(
      `Merging ${JSON.stringify(skimapOrgSkiArea.properties)} into: ${skiAreas
        .map((object) => JSON.stringify(object.properties))
        .join(", ")}`,
    );

    const skiAreasToUpdate = skiAreas.map((skiArea) =>
      mergeSkiAreaObjects(skiArea, [skimapOrgSkiArea]),
    );

    await Promise.all([
      // Update OpenStreetMap ski areas with skimap.org ski area data
      objectsCollection.updateAll(skiAreasToUpdate),
      // Remove skimap.org ski area, as it's now merged into each nearby OpenStreetMap ski area
      objectsCollection.remove(skimapOrgSkiArea._key),
    ]);
  }

  async function findNearbyObjects(
    area: GeoJSON.Polygon | GeoJSON.MultiPolygon,
    context: VisitContext,
  ): Promise<MapObject[]> {
    const query = aql`
            FOR object in ${objectsCollection}
            FILTER ${
              context.searchType == "intersects"
                ? aql`GEO_INTERSECTS`
                : aql`GEO_CONTAINS`
            }(${arangoGeometry(area)}, object.geometry)
            FILTER ${context.id} NOT IN object.skiAreas
            FILTER object._key NOT IN ${context.alreadyVisited}
            ${
              context.excludeObjectsAlreadyInSkiArea
                ? aql`FILTER object.skiAreas == []`
                : aql``
            }
            FILTER object.activities ANY IN ${context.activities}
            RETURN object
        `;

    try {
      const cursor = await performQuery(query, { ttl: 360 });
      const allFound: MapObject[] = await cursor.all();
      allFound.forEach((object) => context.alreadyVisited.push(object._key));
      return allFound;
    } catch (error) {
      if (isArangoInvalidGeometryError(error)) {
        // ArangoDB can fail with polygon not valid in rare cases.
        // Seems to happen when people abuse landuse=winter_sports and add all members of a ski area to a multipolygon relation.
        // For example https://www.openstreetmap.org/relation/6250272
        // In that case, we just log it and move on.
        console.log("Failed finding nearby objects (invalid polygon)");
        console.log(error);
        console.log("Area: " + JSON.stringify(area));
        return [];
      }

      console.log("Failed finding nearby objects");
      throw error;
    }
  }

  async function markSkiArea(
    id: string,
    isInSkiAreaPolygon: boolean,
    objects: MapObject[],
  ): Promise<void> {
    const query = aql`
            FOR object in ${objectsCollection}
            FILTER object._key IN ${objects.map((object) => object._key)}
            UPDATE {
              _key: object._key,
              isBasisForNewSkiArea: false,
              isInSkiAreaPolygon: object.isInSkiAreaPolygon || ${isInSkiAreaPolygon},
              skiAreas: APPEND(
                object.skiAreas,
                ${[id]},
                true
              )
            } IN ${objectsCollection}
            OPTIONS { exclusive: true }
        `;

    await performQuery(query);
  }

  async function getSkiAreasByID(ids: string[]): Promise<SkiAreasCursor> {
    return await performQuery(
      aql`
            FOR object IN ${objectsCollection}
            FILTER object.id IN ${ids}
            RETURN object`,
    );
  }

  async function getSkiAreas(options: {
    onlySource?: SourceType | null;
    onlyPolygons?: boolean;
    onlyInPolygon?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  }): Promise<SkiAreasCursor> {
    const batchSize = 10;
    try {
      return await performQuery(
        aql`
            FOR object IN ${objectsCollection}
            ${
              options.onlyInPolygon
                ? aql`FILTER GEO_INTERSECTS(${arangoGeometry(
                    options.onlyInPolygon,
                  )}, object.geometry)`
                : aql``
            }
            FILTER object.type == ${MapObjectType.SkiArea}
            ${
              options.onlySource
                ? aql`FILTER object.source == ${options.onlySource}`
                : aql``
            }
            ${
              options.onlyPolygons
                ? aql`FILTER object.isPolygon == true`
                : aql``
            }
            RETURN object`,
        { batchSize: batchSize, ttl: 7200, stream: true },
      );
    } catch (error) {
      if (isArangoInvalidGeometryError(error)) {
        console.log("Failed getting ski areas (invalid geometry)");
        console.log(error);
        console.log("Options: " + JSON.stringify(options));
        return emptySkiAreasCursor();
      }
      throw error;
    }
  }

  // Find a run that isn't part of a ski area.
  async function nextUnassignedRun(): Promise<RunObject> {
    const array = await performQuery(aql`
            FOR object IN ${objectsCollection}
            FILTER object.isBasisForNewSkiArea == true
            LIMIT ${1}
            RETURN object`);

    const run: RunObject = await array.next();
    if (run && run.activities.length == 0) {
      throw "No activities for run";
    }
    return run;
  }

  async function createGeneratedSkiArea(
    id: string,
    activities: Activity[],
    memberObjects: MapObject[],
  ): Promise<void> {
    const geometry = skiAreaGeometry(memberObjects);

    const draftSkiArea: DraftSkiArea = {
      _key: id,
      id: id,
      type: MapObjectType.SkiArea,
      skiAreas: [id],
      activities: activities,
      geometry: geometry,
      isPolygon: true,
      source: SourceType.OPENSTREETMAP,
      properties: {
        type: FeatureType.SkiArea,
        id: id,
        name: null,
        generated: true,
        activities: activities,
        status: Status.Operating,
        sources: [],
        runConvention: getRunConvention(geometry),
        websites: [],
        wikidata_id: null,
        location: null,
      },
    };

    try {
      await objectsCollection.save(draftSkiArea);
    } catch (exception) {
      console.log("Failed saving ski area", exception);
      throw exception;
    }

    await markSkiArea(id, false, memberObjects);
  }

  async function getObjects(skiAreaID: string): Promise<MapObject[]> {
    const query = aql`
            FOR object in ${objectsCollection}
            FILTER ${skiAreaID} IN object.skiAreas
            FILTER object.type != ${MapObjectType.SkiArea}
            RETURN object
        `;

    try {
      const cursor = await performQuery(query, { ttl: 360 });
      return await cursor.all();
    } catch (exception) {
      console.log("Failed getting objects");
      throw exception;
    }
  }

  async function augmentSkiAreasBasedOnAssignedLiftsAndRuns(
    geocoder: Geocoder | null,
  ): Promise<void> {
    const skiAreasCursor = await getSkiAreas({});
    let skiAreas: SkiAreaObject[];
    while (
      (skiAreas = (await skiAreasCursor.batches?.next()) as SkiAreaObject[])
    ) {
      await Promise.all(
        skiAreas.map(async (skiArea) => {
          const mapObjects = await getObjects(skiArea.id);
          await augmentSkiAreaBasedOnAssignedLiftsAndRuns(
            skiArea,
            mapObjects,
            geocoder,
          );
        }),
      );
    }
  }

  async function augmentSkiAreaBasedOnAssignedLiftsAndRuns(
    skiArea: SkiAreaObject,
    memberObjects: MapObject[],
    geocoder: Geocoder | null,
  ): Promise<void> {
    const noSkimapOrgSource = !skiArea.properties.sources.some(
      (source) => source.type == SourceType.SKIMAP_ORG,
    );
    if (memberObjects.length === 0 && noSkimapOrgSource) {
      // Remove OpenStreetMap ski areas with no associated runs or lifts.
      // These are likely not actually ski areas,
      // as the OpenStreetMap tagging semantics (landuse=winter_sports) are not ski area specific.
      console.log(
        "Removing OpenStreetMap ski area without associated runs/lifts.",
      );

      await objectsCollection.remove({ _key: skiArea._key });
      return;
    }

    skiArea.properties.statistics = skiAreaStatistics(memberObjects);
    skiArea.properties.runConvention = getRunConvention(skiArea.geometry);

    if (geocoder) {
      const coordinates = centroid(skiArea.geometry).geometry.coordinates;
      try {
        skiArea.properties.location = await geocoder.geocode(coordinates);
      } catch (error) {
        console.log(`Failed geocoding ${JSON.stringify(coordinates)}`);
        console.log(error);
      }
    }

    await await objectsCollection.update(skiArea.id, skiArea);
  }

  function skiAreaGeometry(memberObjects: MapObject[]): GeoJSON.Point {
    if (memberObjects.length === 0) {
      throw "No member objects to compute geometry from";
    }
    const centroidPoint = centroid({
      type: "GeometryCollection",
      geometries: memberObjects.map((object) => object.geometry),
    }).geometry;

    // The centroid of a ski area can sometimes be a ways from the actual runs/lifts depending on the ski areas shape.
    // So, we find the point in the ski area geometry closest to the centroid.
    const nearestPointToCentroid = nearestPoint(
      centroidPoint,
      getPoints(
        memberObjects.flatMap((object) => getPositions(object.geometry)),
      ),
    ).geometry;

    const line = turf.lineString([
      nearestPointToCentroid.coordinates,
      centroidPoint.coordinates,
    ]);

    if (length(line) > 0.1) {
      // Get a point close to the most central point in the member objects
      // but not exactly on top of it, so the central point is not exactly on top of a lift/run feature.
      return along(line, 0.1).geometry;
    } else {
      // Centroid point is < 100m from the nearest point in the member objects, so just use it.
      return centroidPoint;
    }
  }

  function getActivitiesBasedOnRunsAndLifts(
    mapObjects: MapObject[],
  ): Activity[] {
    return Array.from(
      mapObjects
        .filter((object) => object.type !== MapObjectType.SkiArea)
        .reduce((accumulatedActivities, object) => {
          object.activities.forEach((activity) => {
            if (allSkiAreaActivities.has(activity)) {
              accumulatedActivities.add(activity);
            }
          });
          return accumulatedActivities;
        }, new Set<Activity>()),
    );
  }
}
