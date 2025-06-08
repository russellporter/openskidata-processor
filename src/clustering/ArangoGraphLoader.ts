import { Database } from "arangojs";
import assert from "assert";
import {
  LiftFeature,
  LiftGeometry,
  RunFeature,
  RunGeometry,
  RunGrooming,
  RunUse,
  SkiAreaActivity,
  SkiAreaFeature,
  Status,
} from "openskidata-format";
import StreamToPromise from "stream-to-promise";
import { readGeoJSONFeatures } from "../io/GeoJSONReader";
import { mapAsync } from "../transforms/StreamTransforms";
import { VIIRSPixelExtractor } from "../utils/VIIRSPixelExtractor";
import { allSkiAreaActivities } from "./ArangoGraphClusterer";
import {
  DraftLift,
  DraftMapObject,
  DraftRun,
  DraftSkiArea,
  MapObjectType,
} from "./MapObject";

export default async function loadArangoGraph(
  skiAreasPath: string,
  liftsPath: string,
  runsPath: string,
  database: Database,
): Promise<void> {
  const objectsCollection = database.collection("objects");
  await objectsCollection.create();

  const viirsExtractor = new VIIRSPixelExtractor();

  await Promise.all(
    [
      load(skiAreasPath, prepareSkiArea),
      load(liftsPath, prepareLift),
      load(runsPath, (feature) => prepareRun(feature, viirsExtractor)),
    ].map<Promise<Buffer>>(StreamToPromise),
  );

  await objectsCollection.ensureIndex({
    type: "geo",
    geoJson: true,
    fields: ["geometry"],
  });
  await objectsCollection.ensureIndex({
    type: "persistent",
    fields: ["type", "source", "isPolygon"],
  });
  await objectsCollection.ensureIndex({
    type: "persistent",
    fields: ["skiAreas"],
  });
  await objectsCollection.ensureIndex({
    type: "persistent",
    fields: ["isBasisForNewSkiArea"],
    sparse: true,
  });

  function load(
    path: string,
    prepare: (feature: any) => DraftMapObject,
  ): NodeJS.ReadableStream {
    return readGeoJSONFeatures(path).pipe(
      mapAsync(async (feature: any) => {
        try {
          await objectsCollection.save(prepare(feature));
        } catch (e) {
          console.log("Failed loading feature " + JSON.stringify(feature), e);
        }
      }, 10),
    );
  }

  function prepareSkiArea(feature: SkiAreaFeature): DraftSkiArea {
    const sources = feature.properties.sources;

    assert(
      sources.length === 1,
      "Only ski areas with a single source are supported for clustering.",
    );
    const properties = feature.properties;
    return {
      _key: properties.id,
      id: properties.id,
      source: sources[0].type,
      isPolygon:
        feature.geometry.type === "Polygon" ||
        feature.geometry.type === "MultiPolygon",
      type: MapObjectType.SkiArea,
      geometry: feature.geometry,
      skiAreas: [],
      activities: properties.activities,
      properties: properties,
      viirsPixels: [],
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
        properties["status"] === Status.Operating
          ? [SkiAreaActivity.Downhill]
          : [],
      skiAreas: feature.properties.skiAreas.map(
        (skiArea) => skiArea.properties.id,
      ),
      isInSkiAreaPolygon: false,
      // all ski areas associated with the feature at this point are site=piste relations.
      isInSkiAreaSite: feature.properties.skiAreas.length > 0,
      liftType: properties.liftType,
    };
  }

  function prepareRun(feature: RunFeature, viirsExtractor: VIIRSPixelExtractor): DraftRun {
    const properties = feature.properties;
    const isInSkiAreaSite = feature.properties.skiAreas.length > 0;
    const activities = (() => {
      // This tagging is ambiguous, but for safety, avoid marking runs as having a ski area activity. As a result they will not be linked to a ski area.
      if (
        !isInSkiAreaSite &&
        properties.grooming === RunGrooming.Backcountry &&
        properties.patrolled !== true
      ) {
        return [];
      }

      return properties.uses.flatMap((use) => {
        switch (use) {
          case RunUse.Downhill:
          case RunUse.SnowPark:
            return [SkiAreaActivity.Downhill];
          case RunUse.Nordic:
            return [SkiAreaActivity.Nordic];
          case RunUse.Skitour:
            return [];
          default:
            return [];
        }
      });
    })();

    const viirsPixels = viirsExtractor.getGeometryPixelCoordinates(feature.geometry);

    return {
      _key: properties.id,
      type: MapObjectType.Run,
      geometry: geometryWithoutElevations(feature.geometry) as RunGeometry,
      geometryWithElevations: feature.geometry,
      isBasisForNewSkiArea:
        // SnowPark's sometimes are used for purposes other than downhill ski areas (for example: skate parks, nordic skiing jumps)
        // So only start generating a new ski area from a run if the use was explicitly downhill or nordic.
        (properties.uses.includes(RunUse.Downhill) ||
          properties.uses.includes(RunUse.Nordic)) &&
        activities.some((activity) => allSkiAreaActivities.has(activity)) &&
        feature.properties.skiAreas.length == 0,
      skiAreas: feature.properties.skiAreas.map(
        (skiArea) => skiArea.properties.id,
      ),
      isInSkiAreaPolygon: false,
      // all ski areas associated with the feature at this point are site=piste relations.
      isInSkiAreaSite: isInSkiAreaSite,
      activities: activities,
      difficulty: feature.properties.difficulty,
      viirsPixels: viirsPixels,
    };
  }
}

function geometryWithoutElevations(
  geometry: GeoJSON.Geometry,
): GeoJSON.Geometry {
  switch (geometry.type) {
    case "Point":
      return {
        type: "Point",
        coordinates: [geometry.coordinates[0], geometry.coordinates[1]],
      };
    case "LineString":
      return {
        type: "LineString",
        coordinates: geometry.coordinates.map((coordinate) => [
          coordinate[0],
          coordinate[1],
        ]),
      };
    case "MultiLineString":
    case "Polygon":
      return {
        type: geometry.type,
        coordinates: geometry.coordinates.map((coordinates) =>
          coordinates.map((coordinate) => [coordinate[0], coordinate[1]]),
        ),
      };
    case "MultiPolygon":
      return {
        type: "MultiPolygon",
        coordinates: geometry.coordinates.map((coordinates) =>
          coordinates.map((coordinatess) =>
            coordinatess.map((coordinatesss) => [
              coordinatesss[0],
              coordinatesss[1],
            ]),
          ),
        ),
      };
    default:
      throw "Unsupported geometry type " + geometry.type;
  }
}
