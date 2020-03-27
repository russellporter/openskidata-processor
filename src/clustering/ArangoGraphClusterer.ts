import centroid from "@turf/centroid";
import * as turf from "@turf/helpers";
import { aql, Database } from "arangojs";
import { ArrayCursor } from "arangojs/lib/cjs/cursor";
import { AssertionError } from "assert";
import * as GeoJSON from "geojson";
import { Activity, FeatureType, SourceType, Status } from "openskidata-format";
import uuid from "uuid/v4";
import { skiAreaStatistics } from "../statistics/SkiAreaStatistics";
import { bufferGeometry, polygonEnclosing } from "../transforms/GeoTransforms";
import { getRunConvention } from "../transforms/RunFormatter";
import {
  DraftSkiArea,
  MapObject,
  MapObjectType,
  RunObject,
  SkiAreaObject
} from "./MapObject";
import mergeSkiAreaObjects from "./MergeSkiAreaObjects";

interface VisitContext {
  id: string;
  activities: Activity[];
  excludeObjectsAlreadyInSkiAreaPolygon?: boolean;
  searchPolygon?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
}

const maxDistanceInKilometers = 0.5;

export const skiAreaActivities = new Set([Activity.Downhill, Activity.Nordic]);

/**
 * - Associate runs & lifts with ski areas.
 * - Combine ski areas from different sources (Skimap.org and OpenStreetMap)
 * - Generate statistics for each ski area
 *
 * Because the relationships between objects are only implied based on their relative positions,
 * this is not perfect. There are a number of stages to handle some well known edge cases, like adjacent ski areas.
 */
export default async function clusterArangoGraph(
  database: Database
): Promise<void> {
  const objectsCollection = database.collection("objects");

  // For all ski area polygons, associate runs & lifts within that polygon.
  await assignObjectsToSkiAreas({
    skiArea: { onlySource: SourceType.OPENSTREETMAP },
    objects: { onlyInPolygon: true }
  });

  // For all OpenStreetMap ski areas, associate nearby runs & lifts that are not already assigned to a ski area area polygon.
  await assignObjectsToSkiAreas({
    skiArea: { onlySource: SourceType.OPENSTREETMAP },
    objects: { onlyIfNotAlreadyAssignedToPolygon: true }
  });

  // For all Skimap.org ski areas, associate nearby runs & lifts that are not already assigned to a ski area area polygon.
  // Merge ski areas from different sources: For all Skimap.org ski areas,
  // if an OpenStreetMap ski area is nearby or its geometry encloses the Skimap.org ski area, merge them.
  await assignObjectsToSkiAreas({
    skiArea: {
      onlySource: SourceType.SKIMAP_ORG,
      mergeWithOtherSourceIfNearby: true
    },
    objects: { onlyIfNotAlreadyAssignedToPolygon: true }
  });

  // For each remaining unclaimed run, generate a ski area for it, associating nearby unclaimed runs & lifts.
  await generateSkiAreasForUnassignedObjects();

  await augmentSkiAreasWithStatistics();

  async function assignObjectsToSkiAreas(options: {
    skiArea: {
      onlySource: SourceType;
      mergeWithOtherSourceIfNearby?: boolean;
    };
    objects: {
      onlyIfNotAlreadyAssignedToPolygon?: boolean;
      onlyInPolygon?: boolean;
    };
  }): Promise<void> {
    const skiAreasCursor = await getSkiAreas({
      onlyPolygons: options.objects.onlyInPolygon || false,
      onlySource: options.skiArea.onlySource
    });

    let skiAreas: SkiAreaObject[];
    while ((skiAreas = (await skiAreasCursor.nextBatch()) as SkiAreaObject[])) {
      await Promise.all(
        skiAreas.map(async skiArea => {
          const id = skiArea.properties.id;
          if (!id) {
            throw "No ID for ski area starting object";
          }

          if (options.skiArea.mergeWithOtherSourceIfNearby) {
            const skiAreasToMerge = await getSkiAreasToMerge(skiArea);
            if (skiAreasToMerge.length > 0) {
              await mergeSkiAreas([skiArea, ...skiAreasToMerge]);
              return;
            }
          }

          let searchPolygon:
            | GeoJSON.Polygon
            | GeoJSON.MultiPolygon
            | null = null;
          if (options.objects.onlyInPolygon) {
            if (
              skiArea.geometry.type === "Polygon" ||
              skiArea.geometry.type === "MultiPolygon"
            ) {
              searchPolygon = skiArea.geometry;
            } else {
              throw new AssertionError({
                message: "Ski area geometry must be a polygon."
              });
            }
          }

          await visitObject(
            {
              id: id,
              activities: skiArea.activities,
              searchPolygon: searchPolygon,
              excludeObjectsAlreadyInSkiAreaPolygon:
                options.objects.onlyIfNotAlreadyAssignedToPolygon || false
            },
            skiArea
          );
        })
      );
    }
  }

  async function generateSkiAreasForUnassignedObjects(): Promise<void> {
    let unassignedRun: MapObject;
    while ((unassignedRun = await nextUnassignedRun())) {
      try {
        const newSkiAreaID = uuid();
        // Workaround for ArangoDB intersect bug
        await markSkiArea(newSkiAreaID, false, [unassignedRun]);
        const activities = unassignedRun.activities.filter(activity =>
          skiAreaActivities.has(activity)
        );
        const memberObjects = await visitObject(
          { id: newSkiAreaID, activities: activities },
          unassignedRun
        );

        await createGeneratedSkiArea(newSkiAreaID, activities, memberObjects);
      } catch (exception) {
        console.log("Processing unassigned run failed.", exception);
      }
    }
  }

  async function visitPolygon(
    context: VisitContext,
    geometry: GeoJSON.Polygon
  ): Promise<MapObject[]> {
    let foundObjects: MapObject[] = [];
    const objects = await findNearbyObjects(geometry, context);
    await markSkiArea(
      context.id,
      context.searchPolygon ? true : false,
      objects
    );
    for (let i = 0; i < objects.length; i++) {
      foundObjects = foundObjects.concat(
        await visitObject(context, objects[i])
      );
    }
    return foundObjects;
  }

  async function visitObject(
    context: VisitContext,
    object: MapObject
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
      activities: context.activities.filter(activity =>
        object.activities.includes(activity)
      )
    };
    switch (searchArea.type) {
      case "Polygon":
        return foundObjects.concat(
          await visitPolygon(objectContext, searchArea)
        );
      case "MultiPolygon":
        for (let i = 0; i < searchArea.coordinates.length; i++) {
          foundObjects = foundObjects.concat(
            await visitPolygon(
              objectContext,
              turf.polygon(searchArea.coordinates[i]).geometry
            )
          );
        }
        return foundObjects;
      default:
        throw "Unexpected visit area geometry type " + searchArea;
    }
  }

  async function getSkiAreasToMerge(
    skiArea: SkiAreaObject
  ): Promise<SkiAreaObject[]> {
    const maxMergeDistanceInKilometers = 0.25;
    const buffer = bufferGeometry(
      skiArea.geometry,
      maxMergeDistanceInKilometers
    );
    if (!buffer) {
      return [];
    }

    const nearbyObjects = await findNearbyObjects(buffer, {
      id: skiArea.id,
      activities: skiArea.activities
    });

    const otherSkiAreaIDs = new Set(
      nearbyObjects.flatMap(object => object.skiAreas)
    );
    const otherSkiAreasCursor = await getSkiAreasByID(
      Array.from(otherSkiAreaIDs)
    );
    const otherSkiAreas: SkiAreaObject[] = await otherSkiAreasCursor.all();

    return otherSkiAreas.filter(
      otherSkiArea => otherSkiArea.source != skiArea.source
    );
  }

  async function mergeSkiAreas(skiAreas: SkiAreaObject[]): Promise<void> {
    const ids = new Set(skiAreas.map(skiArea => skiArea._key));
    const skiArea = mergeSkiAreaObjects(skiAreas);
    if (skiArea === null) {
      return;
    }

    // Update merged ski area
    await objectsCollection.update(skiArea._id, skiArea);

    ids.delete(skiArea._key);

    // Update references to merged ski areas
    await database.query(aql`
    FOR object in ${objectsCollection}
    FILTER ${[...ids]} ANY IN object.skiAreas
    UPDATE {
      _key: object._key,
      skiAreas: APPEND(
        REMOVE_VALUES(object.skiAreas, ${[...ids]}),
        [${skiArea._key}],
        true)
    } IN ${objectsCollection}
    OPTIONS { exclusive: true }
    `);

    // Remove other ski areas
    await objectsCollection.removeByKeys([...ids], {});
  }

  async function findNearbyObjects(
    area: GeoJSON.Polygon | GeoJSON.MultiPolygon,
    context: VisitContext
  ): Promise<MapObject[]> {
    const query = aql`
            FOR object in ${objectsCollection}
            FILTER GEO_INTERSECTS(${
              area.type === "Polygon" ? aql`GEO_POLYGON` : aql`GEO_MULTIPOLYGON`
            }(${area.coordinates}), object.geometry)
            FILTER ${context.id} NOT IN object.skiAreas
            ${
              context.excludeObjectsAlreadyInSkiAreaPolygon
                ? aql`FILTER object.isInSkiAreaPolygon != true`
                : aql``
            }
            FILTER object.activities ANY IN ${context.activities}
            RETURN object
        `;

    const cursor = await database.query(query);
    return await cursor.all();
  }

  async function markSkiArea(
    id: string,
    isInSkiAreaPolygon: boolean,
    objects: MapObject[]
  ): Promise<void> {
    const query = aql`
            FOR object in ${objectsCollection}
            FILTER object._key IN ${objects.map(object => object._key)}
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

    await database.query(query);
  }

  async function getSkiAreasByID(ids: string[]): Promise<ArrayCursor> {
    return await database.query(
      aql`
            FOR object IN ${objectsCollection}
            FILTER object.id IN ${ids}
            RETURN object`
    );
  }

  async function getSkiAreas(options: {
    onlySource?: SourceType | null;
    onlyPolygons?: boolean;
  }): Promise<ArrayCursor> {
    const batchSize = 10;
    return await database.query(
      aql`
            FOR object IN ${objectsCollection}
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
      { batchSize: batchSize }
    );
  }

  // Find a run that isn't part of a ski area.
  async function nextUnassignedRun(): Promise<RunObject> {
    const array = await database.query(aql`
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
    memberObjects: MapObject[]
  ): Promise<void> {
    const features = memberObjects.map<GeoJSON.Feature>(object => {
      return { type: "Feature", geometry: object.geometry, properties: {} };
    });
    const objects = turf.featureCollection(features);
    const geometry = centroid(objects as turf.FeatureCollection<any, any>)
      .geometry;
    if (!geometry) {
      throw "No centroid point could be found.";
    }

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
        website: null
      }
    };

    try {
      await objectsCollection.save(draftSkiArea);
    } catch (exception) {
      console.log("Failed saving ski area", exception);
      throw exception;
    }
  }

  async function getObjects(skiAreaID: string): Promise<MapObject[]> {
    const query = aql`
            FOR object in ${objectsCollection}
            FILTER ${skiAreaID} IN object.skiAreas
            RETURN object
        `;

    const cursor = await database.query(query);
    return await cursor.all();
  }

  // TODO: Also augment ski ara geometry based on runs & lifts
  async function augmentSkiAreasWithStatistics(): Promise<void> {
    const skiAreasCursor = await getSkiAreas({});
    let skiAreas: SkiAreaObject[];
    while ((skiAreas = (await skiAreasCursor.nextBatch()) as SkiAreaObject[])) {
      await Promise.all(
        skiAreas.map(async skiArea => {
          const mapObjects = await getObjects(skiArea.id);
          await augmentSkiAreaWithStatistics(skiArea.id, mapObjects);
        })
      );
    }
  }

  async function augmentSkiAreaWithStatistics(
    id: string,
    memberObjects: MapObject[]
  ): Promise<void> {
    await objectsCollection.update(id, {
      properties: { statistics: skiAreaStatistics(memberObjects) }
    });
  }
}
