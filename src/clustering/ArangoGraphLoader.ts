import { Database } from "arangojs";
import {
  Activity,
  LiftFeature,
  LiftGeometry,
  RunFeature,
  RunGeometry,
  RunGrooming,
  RunUse,
  SkiAreaFeature,
  Status
} from "openskidata-format";
import StreamToPromise from "stream-to-promise";
import { readGeoJSONFeatures } from "../io/GeoJSONReader";
import { mapAsync } from "../transforms/StreamTransforms";
import { skiAreaActivities } from "./ArangoGraphClusterer";
import {
  DraftLift,
  DraftMapObject,
  DraftRun,
  DraftSkiArea,
  MapObjectType
} from "./MapObject";

export default async function loadArangoGraph(
  skiAreasPath: string,
  liftsPath: string,
  runsPath: string,
  database: Database
): Promise<void> {
  const objectsCollection = database.collection("objects");
  await objectsCollection.create();

  await Promise.all(
    [
      load(skiAreasPath, prepareSkiArea),
      load(liftsPath, prepareLift),
      load(runsPath, prepareRun)
    ].map<Promise<Buffer>>(StreamToPromise)
  );

  await objectsCollection.createGeoIndex("geometry", { geoJson: true });
  await objectsCollection.createSkipList("type");
  await objectsCollection.createSkipList("skiAreas");
  await objectsCollection.createSkipList("runAssignableToSkiArea", {
    sparse: true
  });

  function load(
    path: string,
    prepare: (feature: any) => DraftMapObject
  ): NodeJS.ReadableStream {
    return readGeoJSONFeatures(path).pipe(
      mapAsync(async (feature: any) => {
        try {
          await objectsCollection.save(prepare(feature));
        } catch (e) {
          console.log("Failed loading feature " + JSON.stringify(feature), e);
        }
      }, 10)
    );
  }

  function prepareSkiArea(feature: SkiAreaFeature): DraftSkiArea {
    const properties = feature.properties;
    properties.generated = false;
    return {
      _key: properties.id,
      id: properties.id,
      type: MapObjectType.SkiArea,
      geometry: feature.geometry,
      skiAreas: [],
      activities:
        properties.activities.length > 0
          ? properties.activities
          : // For clustering, cluster by all activities if we don't know what activities the ski area has.
            [Activity.Downhill, Activity.Nordic],
      properties: properties
    };
  }

  function prepareLift(feature: LiftFeature): DraftLift {
    const properties = feature.properties;
    return {
      _key: properties.id,
      type: MapObjectType.Lift,
      geometry: geometryWithoutElevations(feature.geometry) as LiftGeometry,
      geometryWithElevations: feature.geometry,
      activities:
        properties["status"] === Status.Operating ? [Activity.Downhill] : [],
      skiAreas: [],
      liftType: properties.liftType
    };
  }

  function prepareRun(feature: RunFeature): DraftRun {
    const properties = feature.properties;
    const activities = (() => {
      // This tagging is ambiguous, but for safety, lean towards marking runs as "backcountry skiing" instead of "resort skiing"
      if (properties.grooming === RunGrooming.Backcountry) {
        return [Activity.Backcountry];
      }

      return properties.uses.flatMap(use => {
        switch (use) {
          case RunUse.Downhill:
          case RunUse.SnowPark:
            return [Activity.Downhill];
          case RunUse.Nordic:
            return [Activity.Nordic];
          case RunUse.Skitour:
            return [Activity.Backcountry];
          default:
            return [];
        }
      });
    })();

    return {
      _key: properties.id,
      type: MapObjectType.Run,
      geometry: geometryWithoutElevations(feature.geometry) as RunGeometry,
      geometryWithElevations: feature.geometry,
      runAssignableToSkiArea: activities.some(activity =>
        skiAreaActivities.has(activity)
      ),
      skiAreas: [],
      activities: activities,
      difficulty: feature.properties.difficulty
    };
  }
}

function geometryWithoutElevations(
  geometry: GeoJSON.Geometry
): GeoJSON.Geometry {
  switch (geometry.type) {
    case "Point":
      return {
        type: "Point",
        coordinates: [geometry.coordinates[0], geometry.coordinates[1]]
      };
    case "LineString":
      return {
        type: "LineString",
        coordinates: geometry.coordinates.map(coordinate => [
          coordinate[0],
          coordinate[1]
        ])
      };
    case "Polygon":
      return {
        type: "Polygon",
        coordinates: geometry.coordinates.map(coordinates =>
          coordinates.map(coordinate => [coordinate[0], coordinate[1]])
        )
      };
    default:
      throw "Unsupported geometry type " + geometry.type;
  }
}
