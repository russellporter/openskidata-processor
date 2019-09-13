import { featureCollection, GeometryObject } from "@turf/helpers";
import { buffer, centroid, geometry } from "@turf/turf";
import { aql, Database } from "arangojs";
import * as GeoJSON from "geojson";
import { Activity, FeatureType, Status } from "openskidata-format";
import uuid from "uuid/v4";
import { getRunConvention } from "../transforms/RunFormatter";
import { skiAreaStatistics } from "./ArangoGraphSkiAreaStatisticsAugmenter";
import {
  DraftSkiArea,
  MapObject,
  MapObjectType,
  RunObject,
  SkiAreaObject
} from "./MapObject";

interface VisitContext {
  id: string;
  activities: Activity[];
}

const maxDistanceInKilometers = 0.5;

export default async function clusterArangoGraph(
  database: Database
): Promise<void> {
  const objectsCollection = database.collection("objects");

  let skiAreas: SkiAreaObject[];
  while ((skiAreas = await nextSkiAreas())) {
    if (skiAreas.length === 0) {
      break;
    }
    await Promise.all(
      skiAreas.map(async skiArea => {
        const id = skiArea.properties.id;
        if (!id) {
          throw "No ID for ski area starting object";
        }
        const memberObjects = await visitObject(
          { id: id, activities: skiArea.activities },
          skiArea
        );
        await augmentSkiAreaWithStatistics(skiArea._key, memberObjects);
      })
    );
  }

  let unassignedRun: MapObject;
  while ((unassignedRun = await nextUnassignedRun())) {
    try {
      const newSkiAreaID = uuid();
      // Workaround for ArangoDB intersect bug
      await markSkiArea(newSkiAreaID, [unassignedRun]);
      const memberObjects = await visitObject(
        { id: newSkiAreaID, activities: unassignedRun.activities },
        unassignedRun
      );

      await createGeneratedSkiArea(
        newSkiAreaID,
        unassignedRun.activities,
        memberObjects
      );
    } catch (exception) {
      console.error("Processing unassigned run failed.", exception);
    }
  }

  async function visitPolygon(
    context: VisitContext,
    geometry: GeoJSON.Polygon
  ): Promise<MapObject[]> {
    let foundObjects: MapObject[] = [];
    const objects = await findNearbyObjects(geometry, context);
    await markSkiArea(context.id, objects);
    for (let i = 0; i < objects.length; i++) {
      foundObjects = foundObjects.concat(
        await visitObject(context, objects[i])
      );
    }
    return foundObjects;
  }

  function safeBuffer(geometry: GeometryObject) {
    try {
      const bufferArea = buffer(geometry, maxDistanceInKilometers, {
        steps: 16
      }).geometry;
      if (!bufferArea) {
        console.error(
          "Failed buffering geometry. This can happen if the geometry is invalid."
        );
        return null;
      }

      return bufferArea;
    } catch (exception) {
      console.error(
        "Failed buffering geometry. This can happen if the geometry is invalid.",
        exception
      );
      return null;
    }
  }

  async function visitObject(
    context: VisitContext,
    object: MapObject
  ): Promise<MapObject[]> {
    let bufferArea = safeBuffer(object.geometry as GeometryObject);
    let foundObjects: MapObject[] = [object];
    if (bufferArea === null) {
      return foundObjects;
    }
    switch (bufferArea.type) {
      case "Polygon":
        return foundObjects.concat(await visitPolygon(context, bufferArea));
      case "MultiPolygon":
        for (let i = 0; i < bufferArea.coordinates.length; i++) {
          foundObjects = foundObjects.concat(
            await visitPolygon(
              context,
              geometry("Polygon", bufferArea.coordinates[i])
            )
          );
        }
        return foundObjects;
      default:
        throw "Unexpected visit area geometry type " + bufferArea;
    }
  }

  async function findNearbyObjects(
    area: GeoJSON.Polygon,
    context: VisitContext
  ): Promise<MapObject[]> {
    const query = aql`
            FOR object in ${objectsCollection}
            FILTER GEO_INTERSECTS(GEO_POLYGON(${
              area.coordinates
            }), object.geometry)
            FILTER ${context.id} NOT IN object.skiAreas
            FILTER object.activities ANY IN ${context.activities}
            RETURN object
        `;

    const cursor = await database.query(query);
    return await cursor.all();
  }

  async function markSkiArea(id: string, objects: MapObject[]): Promise<void> {
    const query = aql`
            FOR object in ${objectsCollection}
            FILTER object._key IN ${objects.map(object => {
              return object._key;
            })}
            UPDATE { _key: object._key, runAssignableToSkiArea: false, skiAreas: APPEND(object.skiAreas, ${[
              id
            ]})} IN ${objectsCollection}
            OPTIONS { exclusive: true }
        `;

    await database.query(query);
  }

  async function nextSkiAreas(): Promise<SkiAreaObject[]> {
    const batchSize = 10;
    const array = await database.query(aql`
            FOR object IN ${objectsCollection}
            FILTER object.type == ${MapObjectType.SkiArea}
            FILTER object.id NOT IN object.skiAreas
            LIMIT ${batchSize}
            RETURN object`);

    return await array.all();
  }

  // Find a run that isn't part of a ski area.
  async function nextUnassignedRun(): Promise<RunObject> {
    const array = await database.query(aql`
            FOR object IN ${objectsCollection}
            FILTER object.runAssignableToSkiArea == true
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
    const objects = featureCollection(features);
    const geometry = centroid(objects).geometry;
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
      properties: {
        type: FeatureType.SkiArea,
        id: id,
        name: null,
        generated: true,
        activities: activities,
        status: Status.Operating,
        sources: [],
        runConvention: getRunConvention(geometry.coordinates)
      }
    };

    try {
      await objectsCollection.save(draftSkiArea);
    } catch (exception) {
      console.error("Failed saving ski area", exception);
      throw exception;
    }

    await augmentSkiAreaWithStatistics(id, memberObjects);
  }

  async function augmentSkiAreaWithStatistics(
    id: string,
    memberObjects: MapObject[]
  ) {
    await objectsCollection.update(id, {
      properties: { statistics: skiAreaStatistics(memberObjects) }
    });
  }
}
