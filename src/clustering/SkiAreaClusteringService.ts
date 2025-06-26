import along from "@turf/along";
import centroid from "@turf/centroid";
import * as turf from "@turf/helpers";
import length from "@turf/length";
import nearestPoint from "@turf/nearest-point";
import { AssertionError } from "assert";
import * as GeoJSON from "geojson";
import {
  FeatureType,
  LiftFeature,
  LiftGeometry,
  RunFeature,
  RunGeometry,
  RunGrooming,
  RunUse,
  SkiAreaActivity,
  SkiAreaFeature,
  SourceType,
  Status,
} from "openskidata-format";
import StreamToPromise from "stream-to-promise";
import { v4 as uuid } from "uuid";
import { GeocodingServerConfig, SnowCoverConfig } from "../Config";
import { readGeoJSONFeatures } from "../io/GeoJSONReader";
import { skiAreaStatistics } from "../statistics/SkiAreaStatistics";
import Geocoder from "../transforms/Geocoder";
import {
  bufferGeometry,
  getPoints,
  getPositions,
} from "../transforms/GeoTransforms";
import { getRunDifficultyConvention } from "../transforms/RunFormatter";
import { mapAsync } from "../transforms/StreamTransforms";
import { isPlaceholderGeometry } from "../utils/PlaceholderSiteGeometry";
import { VIIRSCacheData } from "../utils/snowCoverHistory";
import { SQLiteCache } from "../utils/SQLiteCache";
import { VIIRSPixelExtractor } from "../utils/VIIRSPixelExtractor";
import {
  ClusteringDatabase,
  SearchContext,
} from "./database/ClusteringDatabase";
import augmentGeoJSONFeatures from "./GeoJSONAugmenter";
import {
  DraftLift,
  DraftMapObject,
  DraftRun,
  DraftSkiArea,
  LiftObject,
  MapObject,
  MapObjectType,
  RunObject,
  SkiAreaObject,
} from "./MapObject";
import mergeSkiAreaObjects from "./MergeSkiAreaObjects";
import exportSkiAreasGeoJSON from "./SkiAreasExporter";

const maxDistanceInKilometers = 0.5;

export const allSkiAreaActivities = new Set([
  SkiAreaActivity.Downhill,
  SkiAreaActivity.Nordic,
]);

export class SkiAreaClusteringService {
  constructor(private database: ClusteringDatabase) {}

  async clusterSkiAreas(
    skiAreasPath: string,
    liftsPath: string,
    runsPath: string,
    outputSkiAreasPath: string,
    outputLiftsPath: string,
    outputRunsPath: string,
    geocoderConfig: GeocodingServerConfig | null,
    snowCoverConfig: SnowCoverConfig | null,
  ): Promise<void> {
    console.log("Loading graph into database");
    await this.loadGraphData(skiAreasPath, liftsPath, runsPath);

    console.log("Clustering ski areas");
    await this.performClustering(geocoderConfig, snowCoverConfig);

    console.log("Augmenting runs");
    await this.augmentGeoJSONFeatures(
      runsPath,
      outputRunsPath,
      FeatureType.Run,
      snowCoverConfig,
    );

    console.log("Augmenting lifts");
    await this.augmentGeoJSONFeatures(
      liftsPath,
      outputLiftsPath,
      FeatureType.Lift,
      null,
    );

    console.log("Exporting ski areas");
    await this.exportSkiAreasGeoJSON(outputSkiAreasPath);
  }

  private async loadGraphData(
    skiAreasPath: string,
    liftsPath: string,
    runsPath: string,
  ): Promise<void> {
    const viirsExtractor = new VIIRSPixelExtractor();

    await Promise.all(
      [
        this.loadFeatures(skiAreasPath, (feature) =>
          this.prepareSkiArea(feature),
        ),
        this.loadFeatures(liftsPath, (feature) => this.prepareLift(feature)),
        this.loadFeatures(runsPath, (feature) =>
          this.prepareRun(feature, viirsExtractor),
        ),
      ].map<Promise<Buffer>>(StreamToPromise),
    );

    // Create indices after loading all features for better insert performance
    await this.database.createIndexes();
  }

  private loadFeatures(
    path: string,
    prepare: (feature: any) => DraftMapObject,
  ): NodeJS.ReadableStream {
    return readGeoJSONFeatures(path).pipe(
      mapAsync(async (feature: any) => {
        try {
          await this.database.saveObject(prepare(feature) as MapObject);
        } catch (e) {
          console.log("Failed loading feature " + JSON.stringify(feature), e);
        }
      }, 10),
    );
  }

  private prepareSkiArea(feature: SkiAreaFeature): DraftSkiArea {
    const sources = feature.properties.sources;

    if (sources.length !== 1) {
      throw new AssertionError({
        message:
          "Only ski areas with a single source are supported for clustering.",
      });
    }

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
    };
  }

  private prepareLift(feature: LiftFeature): DraftLift {
    const properties = feature.properties;
    return {
      _key: properties.id,
      type: MapObjectType.Lift,
      geometry: this.geometryWithoutElevations(
        feature.geometry,
      ) as LiftGeometry,
      geometryWithElevations: feature.geometry,
      activities:
        properties["status"] === Status.Operating
          ? [SkiAreaActivity.Downhill]
          : [],
      skiAreas: feature.properties.skiAreas.map(
        (skiArea) => skiArea.properties.id,
      ),
      isInSkiAreaPolygon: false,
      isInSkiAreaSite: feature.properties.skiAreas.length > 0,
      liftType: properties.liftType,
    };
  }

  private prepareRun(
    feature: RunFeature,
    viirsExtractor: VIIRSPixelExtractor,
  ): DraftRun {
    const properties = feature.properties;
    const isInSkiAreaSite = feature.properties.skiAreas.length > 0;

    const activities = (() => {
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

    const viirsPixels = viirsExtractor.getGeometryPixelCoordinates(
      feature.geometry,
    );

    return {
      _key: properties.id,
      type: MapObjectType.Run,
      geometry: this.geometryWithoutElevations(feature.geometry) as RunGeometry,
      geometryWithElevations: feature.geometry,
      isBasisForNewSkiArea:
        (properties.uses.includes(RunUse.Downhill) ||
          properties.uses.includes(RunUse.Nordic)) &&
        activities.some((activity) => allSkiAreaActivities.has(activity)) &&
        feature.properties.skiAreas.length === 0,
      skiAreas: feature.properties.skiAreas.map(
        (skiArea) => skiArea.properties.id,
      ),
      isInSkiAreaPolygon: false,
      isInSkiAreaSite: isInSkiAreaSite,
      activities: activities,
      difficulty: feature.properties.difficulty,
      viirsPixels: viirsPixels,
    };
  }

  private geometryWithoutElevations(
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
        throw new Error("Unsupported geometry type " + (geometry as any).type);
    }
  }

  private async performClustering(
    geocoderConfig: GeocodingServerConfig | null,
    snowCoverConfig: SnowCoverConfig | null,
  ): Promise<void> {
    console.log(
      "Assign ski area activities and geometry based on member objects",
    );
    await this.assignSkiAreaActivitiesAndGeometryBasedOnMemberObjects();

    console.log("Remove ambiguous duplicate ski areas");
    await this.removeAmbiguousDuplicateSkiAreas();

    console.log("Assign objects in OSM polygon ski areas");
    await this.assignObjectsToSkiAreas({
      skiArea: {
        onlySource: SourceType.OPENSTREETMAP,
        removeIfNoObjectsFound: true,
        removeIfSubstantialNumberOfObjectsInSkiAreaSite: true,
      },
      objects: { onlyInPolygon: true },
    });

    console.log("Assign nearby objects to OSM ski areas");
    await this.assignObjectsToSkiAreas({
      skiArea: { onlySource: SourceType.OPENSTREETMAP },
      objects: { onlyIfNotAlreadyAssigned: true },
    });

    console.log("Merge skimap.org and OpenStreetMap ski areas");
    await this.mergeSkimapOrgWithOpenStreetMapSkiAreas();

    console.log("assign nearby objects to Skimap.org ski areas");
    await this.assignObjectsToSkiAreas({
      skiArea: { onlySource: SourceType.SKIMAP_ORG },
      objects: { onlyIfNotAlreadyAssigned: true },
    });

    console.log("Generate ski areas for unassigned objects");
    await this.generateSkiAreasForUnassignedObjects();

    console.log("Augment ski areas based on assigned lifts and runs");
    await this.augmentSkiAreasBasedOnAssignedLiftsAndRuns(
      geocoderConfig,
      snowCoverConfig,
    );

    console.log("Remove ski areas without a geometry");
    await this.removeSkiAreasWithoutGeometry();
  }

  private async assignSkiAreaActivitiesAndGeometryBasedOnMemberObjects(): Promise<void> {
    const skiAreasCursor = await this.database.getSkiAreas({});

    let skiAreas: SkiAreaObject[] | null | undefined;
    while ((skiAreas = await skiAreasCursor.batches?.next())) {
      if (!skiAreas) break;
      await Promise.all(
        skiAreas.map(async (skiArea) => {
          if (skiArea.activities.length > 0) {
            return;
          }

          const memberObjects = await this.database.getObjectsForSkiArea(
            skiArea.id,
          );
          const activities =
            this.getActivitiesBasedOnRunsAndLifts(memberObjects);

          if (memberObjects.length === 0) {
            return;
          }

          await this.database.updateObject(skiArea._key, {
            activities: [...activities],
            geometry: this.skiAreaGeometry(memberObjects),
            isPolygon: false,
            properties: { ...skiArea.properties, activities: [...activities] },
          });
        }),
      );
    }
  }

  private async removeAmbiguousDuplicateSkiAreas(): Promise<void> {
    const cursor = await this.database.getSkiAreas({
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

          const otherSkiAreasCursor = await this.database.getSkiAreas({
            onlySource: SourceType.SKIMAP_ORG,
            onlyInPolygon: skiArea.geometry,
          });

          const otherSkiAreas = await otherSkiAreasCursor.all();
          if (otherSkiAreas.length > 1) {
            console.log(
              "Removing OpenStreetMap ski area as it contains multiple Skimap.org ski areas and can't be merged correctly.",
            );
            console.log(JSON.stringify(skiArea));

            await this.database.removeObject(skiArea._key);
          }
        }),
      );
    }
  }

  private async assignObjectsToSkiAreas(options: {
    skiArea: {
      onlySource: SourceType;
      removeIfNoObjectsFound?: boolean;
      removeIfSubstantialNumberOfObjectsInSkiAreaSite?: boolean;
    };
    objects: { onlyIfNotAlreadyAssigned?: boolean; onlyInPolygon?: boolean };
  }): Promise<void> {
    const skiAreasCursor = await this.database.getSkiAreas({
      onlyPolygons: options.objects.onlyInPolygon || false,
      onlySource: options.skiArea.onlySource,
    });

    let skiAreas: SkiAreaObject[];
    while (
      (skiAreas = (await skiAreasCursor.batches?.next()) as SkiAreaObject[])
    ) {
      // Process ski areas sequentially when onlyIfNotAlreadyAssigned is true
      // to prevent race conditions where multiple ski areas claim the same objects
      if (options.objects.onlyIfNotAlreadyAssigned) {
        for (const skiArea of skiAreas) {
          const memberObjects = await this.processSkiAreaForObjectAssignment(
            skiArea,
            options,
          );

          if (memberObjects === null) {
            continue;
          }

          await this.database.markObjectsAsPartOfSkiArea(
            skiArea.id,
            memberObjects.map((obj) => obj._key),
            options.objects.onlyInPolygon || false,
          );

          const hasKnownSkiAreaActivities = skiArea.activities.length > 0;
          if (!hasKnownSkiAreaActivities) {
            const activities =
              this.getActivitiesBasedOnRunsAndLifts(memberObjects);
            await this.database.updateObject(skiArea._key, {
              activities: [...activities],
              properties: {
                ...skiArea.properties,
                activities: [...activities],
              },
            });
          }
        }
      } else {
        // Process concurrently when not checking for already assigned objects
        await Promise.all(
          skiAreas.map(async (skiArea) => {
            const memberObjects = await this.processSkiAreaForObjectAssignment(
              skiArea,
              options,
            );

            if (memberObjects === null) {
              return;
            }

            await this.database.markObjectsAsPartOfSkiArea(
              skiArea.id,
              memberObjects.map((obj) => obj._key),
              options.objects.onlyInPolygon || false,
            );

            const hasKnownSkiAreaActivities = skiArea.activities.length > 0;
            if (!hasKnownSkiAreaActivities) {
              const activities =
                this.getActivitiesBasedOnRunsAndLifts(memberObjects);
              await this.database.updateObject(skiArea._key, {
                activities: [...activities],
                properties: {
                  ...skiArea.properties,
                  activities: [...activities],
                },
              });
            }
          }),
        );
      }
    }
  }

  private async processSkiAreaForObjectAssignment(
    skiArea: SkiAreaObject,
    options: {
      skiArea: {
        onlySource: SourceType;
        removeIfNoObjectsFound?: boolean;
        removeIfSubstantialNumberOfObjectsInSkiAreaSite?: boolean;
      };
      objects: { onlyIfNotAlreadyAssigned?: boolean; onlyInPolygon?: boolean };
    },
  ): Promise<MapObject[] | null> {
    const id = skiArea.properties.id;
    const hasKnownSkiAreaActivities = skiArea.activities.length > 0;
    const activitiesForClustering = hasKnownSkiAreaActivities
      ? skiArea.activities
      : [...allSkiAreaActivities];

    let searchContext: SearchContext;

    if (options.objects.onlyInPolygon) {
      if (
        skiArea.geometry.type === "Polygon" ||
        skiArea.geometry.type === "MultiPolygon"
      ) {
        searchContext = {
          id,
          activities: activitiesForClustering,
          searchType: "contains",
          isFixedSearchArea: true,
          alreadyVisited: [skiArea._key],
          excludeObjectsAlreadyInSkiArea:
            options.objects.onlyIfNotAlreadyAssigned || false,
        };
      } else {
        throw new AssertionError({
          message: "Ski area geometry must be a polygon.",
        });
      }
    } else {
      searchContext = {
        id,
        activities: activitiesForClustering,
        searchType: "intersects",
        isFixedSearchArea: false,
        alreadyVisited: [skiArea._key],
        excludeObjectsAlreadyInSkiArea:
          options.objects.onlyIfNotAlreadyAssigned || false,
      };
    }

    const memberObjects = await this.visitObject(searchContext, skiArea);

    const removeDueToNoObjects =
      options.skiArea.removeIfNoObjectsFound &&
      !memberObjects.some((object) => object.type !== MapObjectType.SkiArea);

    if (removeDueToNoObjects) {
      console.log(
        `Removing ski area (${JSON.stringify(
          skiArea.properties.sources,
        )}) as no objects were found.`,
      );
      await this.database.removeObject(skiArea._key);
      return null;
    }

    const liftsAndRuns = memberObjects.filter(
      (object): object is LiftObject | RunObject =>
        object.type === MapObjectType.Lift || object.type === MapObjectType.Run,
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
      await this.database.removeObject(skiArea._key);
      return null;
    }

    return memberObjects;
  }

  private async visitObject(
    context: SearchContext,
    object: MapObject,
  ): Promise<MapObject[]> {
    let searchArea =
      context.searchPolygon ||
      bufferGeometry(object.geometry, maxDistanceInKilometers);

    let foundObjects: MapObject[] = [object];
    if (searchArea === null) {
      return foundObjects;
    }

    const filteredActivities = context.activities.filter((activity) =>
      object.activities.includes(activity),
    );

    const objectContext: SearchContext = {
      ...context,
      searchPolygon: context.isFixedSearchArea ? context.searchPolygon : null,
      activities:
        filteredActivities.length > 0 ? filteredActivities : context.activities,
    };

    switch (searchArea.type) {
      case "Polygon":
        return foundObjects.concat(
          await this.visitPolygon(objectContext, searchArea),
        );
      case "MultiPolygon":
        for (let i = 0; i < searchArea.coordinates.length; i++) {
          foundObjects = foundObjects.concat(
            await this.visitPolygon(
              objectContext,
              turf.polygon(searchArea.coordinates[i]).geometry,
            ),
          );
        }
        return foundObjects;
      default:
        throw new Error(
          "Unexpected visit area geometry type " + (searchArea as any).type,
        );
    }
  }

  private async visitPolygon(
    context: SearchContext,
    geometry: GeoJSON.Polygon,
  ): Promise<MapObject[]> {
    const objects = await this.database.findNearbyObjects(geometry, context);

    // Skip further traversal if we are searching a fixed polygon.
    if (context.isFixedSearchArea) {
      return objects;
    } else {
      let foundObjects: MapObject[] = [];
      for (let i = 0; i < objects.length; i++) {
        foundObjects = foundObjects.concat(
          await this.visitObject(context, objects[i]),
        );
      }
      return foundObjects;
    }
  }

  private async mergeSkimapOrgWithOpenStreetMapSkiAreas(): Promise<void> {
    const skiAreasCursor = await this.database.getSkiAreas({
      onlySource: SourceType.SKIMAP_ORG,
    });

    const processedSkimapOrgIds = new Set<string>();
    let skiArea: SkiAreaObject | null;

    while ((skiArea = await skiAreasCursor.next())) {
      if (!skiArea) break;

      // Skip if this Skimap.org ski area has already been processed (merged)
      if (processedSkimapOrgIds.has(skiArea.id)) {
        continue;
      }

      const hasKnownSkiAreaActivities = skiArea.activities.length > 0;
      const activitiesForClustering = hasKnownSkiAreaActivities
        ? skiArea.activities
        : [...allSkiAreaActivities];

      const skiAreasToMerge = await this.getSkiAreasToMergeInto({
        ...skiArea,
        activities: activitiesForClustering,
      });

      if (skiAreasToMerge.length > 0) {
        // Before merging, check if any of the target ski areas already contain
        // sources from other Skimap.org ski areas. If so, we need to merge
        // all related Skimap.org areas together.
        const allRelatedSkimapOrgIds = await this.findAllRelatedSkimapOrgIds(
          skiArea,
          skiAreasToMerge,
        );

        // Mark all related Skimap.org IDs as processed
        allRelatedSkimapOrgIds.forEach((id) => processedSkimapOrgIds.add(id));

        await this.mergeIntoSkiAreas(skiArea, skiAreasToMerge);
      }
    }
  }

  private async getSkiAreasToMergeInto(
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

    const context: SearchContext = {
      id: skiArea.id,
      activities: skiArea.activities,
      alreadyVisited: [],
      searchType: "intersects",
      isFixedSearchArea: true,
    };

    const nearbyObjects = await this.database.findNearbyObjects(
      buffer,
      context,
    );
    const otherSkiAreaIDs = new Set(
      nearbyObjects.flatMap((object) => object.skiAreas),
    );

    const otherSkiAreasCursor = await this.database.getSkiAreasByIds(
      Array.from(otherSkiAreaIDs),
    );
    const otherSkiAreas: SkiAreaObject[] = await otherSkiAreasCursor.all();

    return otherSkiAreas.filter(
      (otherSkiArea) => otherSkiArea.source !== skiArea.source,
    );
  }

  private async findAllRelatedSkimapOrgIds(
    currentSkimapOrgSkiArea: SkiAreaObject,
    targetSkiAreas: SkiAreaObject[],
  ): Promise<string[]> {
    const relatedIds = new Set<string>([currentSkimapOrgSkiArea.id]);

    // Check if any target ski areas already have sources from other Skimap.org ski areas
    for (const targetSkiArea of targetSkiAreas) {
      const skimapOrgSources = targetSkiArea.properties.sources.filter(
        (source) => source.type === SourceType.SKIMAP_ORG,
      );

      for (const source of skimapOrgSources) {
        relatedIds.add(source.id.toString());
      }
    }

    return Array.from(relatedIds);
  }

  private async mergeIntoSkiAreas(
    skimapOrgSkiArea: SkiAreaObject,
    skiAreas: SkiAreaObject[],
  ): Promise<void> {
    console.log(
      `Merging ${JSON.stringify(skimapOrgSkiArea.properties)} into: ${skiAreas
        .map((object) => JSON.stringify(object.properties))
        .join(", ")}`,
    );

    const updates = skiAreas.map((skiArea) => ({
      key: skiArea._key,
      updates: mergeSkiAreaObjects(skiArea, [skimapOrgSkiArea]),
    }));

    await Promise.all([
      this.database.updateObjects(updates),
      this.database.removeObject(skimapOrgSkiArea._key),
    ]);
  }

  private lastProcessedRunKey: string | null = null;

  private async generateSkiAreasForUnassignedObjects(): Promise<void> {
    let unassignedRun: MapObject | null;
    while ((unassignedRun = await this.database.getNextUnassignedRun())) {
      // Detect repeated processing attempts
      if (this.lastProcessedRunKey === unassignedRun._key) {
        console.log(
          `WARNING: Run ${unassignedRun._key} selected again - marking as processed to prevent infinite loop`,
        );
        try {
          await this.database.updateObject(unassignedRun._key, {
            isBasisForNewSkiArea: false,
          });
        } catch (updateException) {
          console.log(
            "Failed to mark repeated run as processed:",
            updateException,
          );
        }
        continue;
      }

      this.lastProcessedRunKey = unassignedRun._key;
      console.log(`Processing run ${unassignedRun._key}`);

      try {
        await this.generateSkiAreaForRun(unassignedRun as RunObject);
      } catch (exception) {
        console.log("Processing unassigned run failed.", exception);
        // Mark run as processed to prevent infinite loop
        try {
          await this.database.updateObject(unassignedRun._key, {
            isBasisForNewSkiArea: false,
          });
        } catch (updateException) {
          console.log(
            "Failed to mark run as processed after error:",
            updateException,
          );
        }
      }
    }
  }

  private async generateSkiAreaForRun(unassignedRun: RunObject): Promise<void> {
    const newSkiAreaID = uuid();
    let activities = unassignedRun.activities.filter((activity) =>
      allSkiAreaActivities.has(activity),
    );

    const context: SearchContext = {
      id: newSkiAreaID,
      activities,
      alreadyVisited: [unassignedRun._key],
      searchType: "intersects",
      isFixedSearchArea: false,
    };

    let memberObjects = await this.visitObject(context, unassignedRun);

    if (
      activities.includes(SkiAreaActivity.Downhill) &&
      !memberObjects.some((object) => object.type === MapObjectType.Lift)
    ) {
      activities = activities.filter(
        (activity) => activity !== SkiAreaActivity.Downhill,
      );
      memberObjects = memberObjects.filter((object) => {
        const hasAnotherSkiAreaActivity = object.activities.some(
          (activity) =>
            activity !== SkiAreaActivity.Downhill &&
            allSkiAreaActivities.has(activity),
        );
        return hasAnotherSkiAreaActivity;
      });
    }

    if (activities.length === 0 || memberObjects.length === 0) {
      await this.database.updateObject(unassignedRun._key, {
        isBasisForNewSkiArea: false,
      });
      return;
    }

    await this.createGeneratedSkiArea(newSkiAreaID, activities, memberObjects);
  }

  private async createGeneratedSkiArea(
    id: string,
    activities: SkiAreaActivity[],
    memberObjects: MapObject[],
  ): Promise<void> {
    const geometry = this.skiAreaGeometry(memberObjects);

    const draftSkiArea: DraftSkiArea = {
      _key: id,
      id: id,
      type: MapObjectType.SkiArea,
      skiAreas: [id],
      activities: activities,
      geometry: geometry,
      isPolygon: false,
      source: SourceType.OPENSTREETMAP,
      properties: {
        type: FeatureType.SkiArea,
        id: id,
        name: null,
        activities: activities,
        status: Status.Operating,
        sources: [],
        runConvention: getRunDifficultyConvention(geometry),
        websites: [],
        wikidata_id: null,
        location: null,
      },
    };

    try {
      await this.database.saveObject(draftSkiArea as MapObject);
    } catch (exception) {
      console.log("Failed saving ski area", exception);
      throw exception;
    }

    await this.database.markObjectsAsPartOfSkiArea(
      id,
      memberObjects.map((obj) => obj._key),
      false,
    );
  }

  private async augmentSkiAreasBasedOnAssignedLiftsAndRuns(
    geocoderConfig: GeocodingServerConfig | null,
    snowCoverConfig: SnowCoverConfig | null,
  ): Promise<void> {
    let geocoder: Geocoder | null = null;
    let snowCoverArchive: SQLiteCache<VIIRSCacheData[]> | undefined;

    // Initialize geocoder once for all geocoding operations
    if (geocoderConfig) {
      geocoder = new Geocoder(geocoderConfig);
      await geocoder.initialize();
    }

    // Initialize snow cover archive once for all snow cover operations
    if (snowCoverConfig) {
      snowCoverArchive = new SQLiteCache<VIIRSCacheData[]>(
        snowCoverConfig.databasePath,
        0,
      );
      await snowCoverArchive.initialize();
    }

    try {
      const skiAreasCursor = await this.database.getSkiAreas({});
      let skiAreas: SkiAreaObject[];
      while (
        (skiAreas = (await skiAreasCursor.batches?.next()) as SkiAreaObject[])
      ) {
        await Promise.all(
          skiAreas.map(async (skiArea) => {
            const mapObjects = await this.database.getObjectsForSkiArea(
              skiArea.id,
            );
            await this.augmentSkiAreaBasedOnAssignedLiftsAndRuns(
              skiArea,
              mapObjects,
              geocoder,
              snowCoverConfig,
              snowCoverArchive,
            );
          }),
        );
      }
    } finally {
      // Clean up geocoder
      if (geocoder) {
        await geocoder.close();
      }

      // Clean up snow cover archive
      if (snowCoverArchive) {
        await snowCoverArchive.close();
      }
    }
  }

  private async augmentSkiAreaBasedOnAssignedLiftsAndRuns(
    skiArea: SkiAreaObject,
    memberObjects: MapObject[],
    geocoder: Geocoder | null,
    snowCoverConfig: SnowCoverConfig | null,
    snowCoverArchive: SQLiteCache<VIIRSCacheData[]> | undefined,
  ): Promise<void> {
    const noSkimapOrgSource = !skiArea.properties.sources.some(
      (source) => source.type === SourceType.SKIMAP_ORG,
    );

    if (memberObjects.length === 0 && noSkimapOrgSource) {
      console.log(
        "Removing OpenStreetMap ski area without associated runs/lifts.",
      );
      await this.database.removeObject(skiArea._key);
      return;
    }

    const statistics = await skiAreaStatistics(
      memberObjects,
      snowCoverConfig,
      snowCoverArchive,
    );
    const updatedProperties = {
      ...skiArea.properties,
      statistics,
      runConvention: getRunDifficultyConvention(skiArea.geometry),
    };

    if (geocoder) {
      const coordinates = centroid(skiArea.geometry).geometry.coordinates;
      try {
        updatedProperties.location = await geocoder.geocode(coordinates);
      } catch (error) {
        console.log(`Failed geocoding ${JSON.stringify(coordinates)}`);
        console.log(error);
      }
    }

    await this.database.updateObject(skiArea._key, {
      properties: updatedProperties,
    });
  }

  private async removeSkiAreasWithoutGeometry(): Promise<void> {
    const cursor = await this.database.getSkiAreas({
      onlySource: SourceType.OPENSTREETMAP,
    });

    let skiAreas: SkiAreaObject[];
    let removeCount = 0;
    let totalCount = 0;

    while ((skiAreas = (await cursor.batches?.next()) as SkiAreaObject[])) {
      await Promise.all(
        skiAreas.map(async (skiArea) => {
          totalCount++;
          if (
            skiArea.geometry.type === "Point" &&
            isPlaceholderGeometry(skiArea.geometry)
          ) {
            console.log(
              "Removing OpenStreetMap ski area as it doesn't have a geometry.",
            );
            await this.database.removeObject(skiArea._key);
            removeCount++;
          }
        }),
      );
    }
  }

  private skiAreaGeometry(memberObjects: MapObject[]): GeoJSON.Point {
    if (memberObjects.length === 0) {
      throw new Error("No member objects to compute geometry from");
    }

    const centroidPoint = centroid({
      type: "GeometryCollection",
      geometries: memberObjects.map((object) => object.geometry),
    }).geometry;

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
      return along(line, 0.1).geometry;
    } else {
      return centroidPoint;
    }
  }

  private getActivitiesBasedOnRunsAndLifts(
    mapObjects: MapObject[],
  ): SkiAreaActivity[] {
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
        }, new Set<SkiAreaActivity>()),
    );
  }

  private async augmentGeoJSONFeatures(
    inputPath: string,
    outputPath: string,
    featureType: FeatureType,
    snowCoverConfig: SnowCoverConfig | null,
  ): Promise<void> {
    console.log(
      `Augmenting ${featureType} features from ${inputPath} to ${outputPath}`,
    );

    let snowCoverArchive: SQLiteCache<VIIRSCacheData[]> | undefined;

    // Initialize snow cover archive if needed for runs
    if (snowCoverConfig && featureType === FeatureType.Run) {
      snowCoverArchive = new SQLiteCache<VIIRSCacheData[]>(
        snowCoverConfig.databasePath,
        0,
      );
      await snowCoverArchive.initialize();
    }

    try {
      await augmentGeoJSONFeatures(
        inputPath,
        outputPath,
        this.database,
        featureType,
        snowCoverConfig,
        snowCoverArchive,
      );
    } finally {
      // Clean up snow cover archive
      if (snowCoverArchive) {
        await snowCoverArchive.close();
      }
    }
  }

  private async exportSkiAreasGeoJSON(outputPath: string): Promise<void> {
    console.log(`Exporting ski areas to ${outputPath}`);
    await exportSkiAreasGeoJSON(outputPath, this.database);
  }
}
