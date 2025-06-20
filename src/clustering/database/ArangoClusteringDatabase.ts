import { aql, Database } from "arangojs";
import { ArrayCursor } from "arangojs/cursor";
import { QueryOptions } from "arangojs/database";
import { backOff } from "exponential-backoff";
import { Readable } from "stream";
import { SourceType, FeatureType } from "openskidata-format";
import { SnowCoverConfig } from "../../Config";
import { isArangoInvalidGeometryError, arangoGeometry } from "../ArangoHelpers";
import augmentGeoJSONFeatures from "../ArangoGraphSkiAreaAugmenter";
import exportSkiAreasGeoJSON from "../ArangoSkiAreasExporter";
import { MapObject, MapObjectType, SkiAreaObject } from "../MapObject";
import {
  ClusteringDatabase,
  GetSkiAreasOptions,
  SearchContext,
  SkiAreasCursor,
} from "./ClusteringDatabase";

export class ArangoClusteringDatabase implements ClusteringDatabase {
  private database: Database | null = null;
  private objectsCollection: any = null;

  async initialize(connectionString: string): Promise<void> {
    let client = new Database(connectionString);

    try {
      await client.dropDatabase("cluster");
    } catch (_) {
      // Database might not exist, ignore error
    }

    this.database = await client.createDatabase("cluster");
    this.objectsCollection = this.database.collection("objects");
    await this.objectsCollection.create();
  }

  async close(): Promise<void> {
    if (this.database) {
      await this.database.close();
      this.database = null;
      this.objectsCollection = null;
    }
  }

  async saveObject(object: MapObject): Promise<void> {
    if (!this.objectsCollection) {
      throw new Error("Database not initialized");
    }
    await this.objectsCollection.save(object);
  }

  async saveObjects(objects: MapObject[]): Promise<void> {
    if (!this.objectsCollection) {
      throw new Error("Database not initialized");
    }
    await Promise.all(objects.map(obj => this.objectsCollection.save(obj)));
  }

  async createIndexes(): Promise<void> {
    if (!this.objectsCollection) {
      throw new Error("Database not initialized");
    }

    await this.objectsCollection.ensureIndex({
      type: "geo",
      geoJson: true,
      fields: ["geometry"],
    });
    await this.objectsCollection.ensureIndex({
      type: "persistent",
      fields: ["type", "source", "isPolygon"],
    });
    await this.objectsCollection.ensureIndex({
      type: "persistent",
      fields: ["skiAreas"],
    });
    await this.objectsCollection.ensureIndex({
      type: "persistent",
      fields: ["isBasisForNewSkiArea"],
      sparse: true,
    });
  }

  async updateObject(key: string, updates: Partial<MapObject>): Promise<void> {
    if (!this.objectsCollection) {
      throw new Error("Database not initialized");
    }
    await this.objectsCollection.update({ _key: key }, updates);
  }

  async updateObjects(updates: Array<{ key: string; updates: Partial<MapObject> }>): Promise<void> {
    if (!this.objectsCollection) {
      throw new Error("Database not initialized");
    }
    await this.objectsCollection.updateAll(
      updates.map(({ key, updates: updateData }) => ({
        _key: key,
        ...updateData,
      }))
    );
  }

  async removeObject(key: string): Promise<void> {
    if (!this.objectsCollection) {
      throw new Error("Database not initialized");
    }
    await this.objectsCollection.remove({ _key: key });
  }

  async getSkiAreas(options: GetSkiAreasOptions): Promise<SkiAreasCursor> {
    if (!this.database || !this.objectsCollection) {
      throw new Error("Database not initialized");
    }

    const batchSize = 10;
    try {
      const cursor = await this.performQuery(
        aql`
          FOR object IN ${this.objectsCollection}
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
        { batchSize: batchSize, ttl: 7200, stream: true }
      );

      return new ArangoSkiAreasCursor(cursor);
    } catch (error) {
      if (isArangoInvalidGeometryError(error)) {
        console.log("Failed getting ski areas (invalid geometry)");
        console.log(error);
        console.log("Options: " + JSON.stringify(options));
        return new EmptySkiAreasCursor();
      }
      throw error;
    }
  }

  async getSkiAreasByIds(ids: string[]): Promise<SkiAreasCursor> {
    if (!this.database || !this.objectsCollection) {
      throw new Error("Database not initialized");
    }

    const cursor = await this.performQuery(
      aql`
        FOR object IN ${this.objectsCollection}
        FILTER object.id IN ${ids}
        RETURN object`
    );

    return new ArangoSkiAreasCursor(cursor);
  }

  async findNearbyObjects(
    area: GeoJSON.Polygon | GeoJSON.MultiPolygon,
    context: SearchContext,
  ): Promise<MapObject[]> {
    if (!this.objectsCollection) {
      throw new Error("Database not initialized");
    }

    const query = aql`
      FOR object in ${this.objectsCollection}
      FILTER ${
        context.searchType === "intersects"
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
      const cursor = await this.performQuery(query, { ttl: 360 });
      const allFound: MapObject[] = await cursor.all();
      allFound.forEach((object) => context.alreadyVisited.push(object._key));
      return allFound;
    } catch (error) {
      if (isArangoInvalidGeometryError(error)) {
        console.log("Failed finding nearby objects (invalid polygon)");
        console.log(error);
        console.log("Area: " + JSON.stringify(area));
        return [];
      }
      throw error;
    }
  }

  async getObjectsForSkiArea(skiAreaId: string): Promise<MapObject[]> {
    if (!this.objectsCollection) {
      throw new Error("Database not initialized");
    }

    const query = aql`
      FOR object in ${this.objectsCollection}
      FILTER ${skiAreaId} IN object.skiAreas
      FILTER object.type != ${MapObjectType.SkiArea}
      RETURN object
    `;

    try {
      const cursor = await this.performQuery(query, { ttl: 360 });
      return await cursor.all();
    } catch (exception) {
      console.log("Failed getting objects");
      throw exception;
    }
  }

  async markObjectsAsPartOfSkiArea(
    skiAreaId: string,
    objectKeys: string[],
    isInSkiAreaPolygon: boolean,
  ): Promise<void> {
    if (!this.objectsCollection) {
      throw new Error("Database not initialized");
    }

    const query = aql`
      FOR object in ${this.objectsCollection}
      FILTER object._key IN ${objectKeys}
      UPDATE {
        _key: object._key,
        isBasisForNewSkiArea: false,
        isInSkiAreaPolygon: object.isInSkiAreaPolygon || ${isInSkiAreaPolygon},
        skiAreas: APPEND(
          object.skiAreas,
          ${[skiAreaId]},
          true
        )
      } IN ${this.objectsCollection}
      OPTIONS { exclusive: true }
    `;

    await this.performQuery(query);
  }

  async getNextUnassignedRun(): Promise<MapObject | null> {
    if (!this.objectsCollection) {
      throw new Error("Database not initialized");
    }

    const cursor = await this.performQuery(
      aql`
        FOR object IN ${this.objectsCollection}
        FILTER object.isBasisForNewSkiArea == true
        LIMIT 1
        RETURN object`
    );

    const run = await cursor.next();
    if (run && run.activities.length === 0) {
      throw new Error("No activities for run");
    }
    return run;
  }

  async streamSkiAreas(): Promise<AsyncIterable<SkiAreaObject>> {
    if (!this.database || !this.objectsCollection) {
      throw new Error("Database not initialized");
    }

    const cursor = await this.database.query(
      aql`
        FOR object IN ${this.objectsCollection}
        FILTER object.type == ${MapObjectType.SkiArea}
        RETURN object`,
      { stream: true }
    );

    return this.createAsyncIterable(cursor);
  }

  async augmentGeoJSONFeatures(
    inputPath: string,
    outputPath: string,
    featureType: FeatureType,
    snowCoverConfig: SnowCoverConfig | null,
  ): Promise<void> {
    if (!this.database) {
      throw new Error("Database not initialized");
    }

    await augmentGeoJSONFeatures(
      inputPath,
      outputPath,
      this.database,
      featureType,
      snowCoverConfig,
    );
  }

  async exportSkiAreasGeoJSON(outputPath: string): Promise<void> {
    if (!this.database) {
      throw new Error("Database not initialized");
    }

    await exportSkiAreasGeoJSON(outputPath, this.database);
  }

  private async performQuery<T = any>(
    query: any,
    options?: QueryOptions,
  ): Promise<ArrayCursor<T>> {
    if (!this.database) {
      throw new Error("Database not initialized");
    }

    try {
      return await backOff(() => this.database!.query(query, options));
    } catch (exception) {
      console.error(`Error performing query: ${query.query}: ${exception}`);
      throw exception;
    }
  }

  private createAsyncIterable(cursor: ArrayCursor): AsyncIterable<SkiAreaObject> {
    return {
      async *[Symbol.asyncIterator]() {
        try {
          let item;
          while ((item = await cursor.next()) !== undefined) {
            yield item;
          }
        } finally {
          // Cursor cleanup is handled by ArangoDB
        }
      },
    };
  }
}

class ArangoSkiAreasCursor implements SkiAreasCursor {
  constructor(private cursor: ArrayCursor) {}

  async next(): Promise<SkiAreaObject | null> {
    const result = await this.cursor.next();
    return result || null;
  }

  async all(): Promise<SkiAreaObject[]> {
    return await this.cursor.all();
  }

  get batches() {
    if (!this.cursor.batches) {
      return undefined;
    }
    return {
      next: async () => {
        const batch = await this.cursor.batches!.next();
        return batch || null;
      },
    };
  }
}

class EmptySkiAreasCursor implements SkiAreasCursor {
  async next(): Promise<SkiAreaObject | null> {
    return null;
  }

  async all(): Promise<SkiAreaObject[]> {
    return [];
  }

  get batches() {
    return {
      next: async () => null,
    };
  }
}