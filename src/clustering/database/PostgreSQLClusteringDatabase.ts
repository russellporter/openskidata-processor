import { FeatureType } from "openskidata-format";
import { Pool, PoolClient } from "pg";
import { PostgresConfig } from "../../Config";
import { getPostgresPoolConfig } from "../../utils/getPostgresPoolConfig";
import {
  LiftObject,
  MapObject,
  RunObject,
  SkiAreaObject,
  SpotObject,
} from "../MapObject";
import {
  ClusteringDatabase,
  Cursor,
  GetSkiAreasOptions,
  SearchContext,
} from "./ClusteringDatabase";
import { performanceMonitor } from "./PerformanceMonitor";

/**
 * PostgreSQL implementation of ClusteringDatabase using PostGIS for spatial queries.
 *
 * This implementation provides better concurrency and more advanced spatial operations
 * compared to SQLite + SpatialLite.
 */
export class PostgreSQLClusteringDatabase implements ClusteringDatabase {
  private pool: Pool | null = null;
  private databaseName: string;
  private postgresConfig: PostgresConfig;

  constructor(postgresConfig: PostgresConfig) {
    this.postgresConfig = postgresConfig;
    // Generate unique database name for parallel operations
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const randomString = Math.random().toString(36).substring(2, 8);
    this.databaseName = `clustering-${timestamp}-${randomString}`;
  }

  // Optimized batch sizes for PostgreSQL
  private static readonly DEFAULT_BATCH_SIZE = 1000;
  private static readonly BULK_OPERATION_BATCH_SIZE = 5000;

  // SQL statements
  private static readonly INSERT_OBJECT_SQL = `
    INSERT INTO objects
    (key, type, source, geometry, geom, is_polygon, activities, ski_areas,
     is_basis_for_new_ski_area, is_in_ski_area_polygon, is_in_ski_area_site,
     lift_type, station_ids, difficulty, viirs_pixels, spot_type, properties)
    VALUES ($1, $2, $3, $4, ST_MakeValid(ST_Force2D(ST_GeomFromGeoJSON($5)), 'method=structure'), $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    ON CONFLICT (key) DO UPDATE SET
      type = EXCLUDED.type,
      source = EXCLUDED.source,
      geometry = EXCLUDED.geometry,
      geom = EXCLUDED.geom,
      is_polygon = EXCLUDED.is_polygon,
      activities = EXCLUDED.activities,
      ski_areas = EXCLUDED.ski_areas,
      is_basis_for_new_ski_area = EXCLUDED.is_basis_for_new_ski_area,
      is_in_ski_area_polygon = EXCLUDED.is_in_ski_area_polygon,
      is_in_ski_area_site = EXCLUDED.is_in_ski_area_site,
      lift_type = EXCLUDED.lift_type,
      station_ids = EXCLUDED.station_ids,
      difficulty = EXCLUDED.difficulty,
      viirs_pixels = EXCLUDED.viirs_pixels,
      spot_type = EXCLUDED.spot_type,
      properties = EXCLUDED.properties
  `;

  async initialize(): Promise<void> {
    // First connect to postgres database to create our temporary database
    const adminPoolConfig = getPostgresPoolConfig(
      "postgres",
      this.postgresConfig,
    );
    adminPoolConfig.connectionTimeoutMillis = 2000;

    const adminPool = new Pool(adminPoolConfig);

    try {
      // Create temporary database
      const adminClient = await adminPool.connect();
      try {
        await adminClient.query(`CREATE DATABASE "${this.databaseName}"`);
        console.log(`✅ Created temporary database: ${this.databaseName}`);
      } finally {
        adminClient.release();
      }
    } catch (error) {
      throw new Error(
        `Failed to create temporary database ${this.databaseName}: ${error}`,
      );
    } finally {
      await adminPool.end();
    }

    // Now create connection pool to our temporary database
    const poolConfig = getPostgresPoolConfig(
      this.databaseName,
      this.postgresConfig,
    );
    poolConfig.max = 10;
    poolConfig.idleTimeoutMillis = 120000;
    poolConfig.connectionTimeoutMillis = 60000;

    this.pool = new Pool(poolConfig);

    // Test connection
    try {
      const client = await this.pool.connect();
      await client.query("SELECT 1");
      client.release();
      console.log(
        `✅ PostgreSQL connection established to ${this.databaseName}`,
      );
    } catch (error) {
      throw new Error(
        `Failed to connect to PostgreSQL database ${this.databaseName}: ${error}`,
      );
    }

    // Enable PostGIS extension
    await this.enablePostGIS();

    // Create tables and indexes
    await this.createTables();
    await this.createIndexes();

    console.log(
      `✅ PostgreSQL clustering database initialized: ${this.databaseName}`,
    );
  }

  async close(): Promise<void> {
    // Gracefully close the main connection pool
    if (this.pool) {
      try {
        // Wait a bit for any pending operations to complete
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Check if there are any active connections
        const activeConnections = this.pool.totalCount - this.pool.idleCount;
        if (activeConnections > 0) {
          console.warn(
            `Warning: ${activeConnections} active connections during close, waiting for completion...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        await this.pool.end();
        this.pool = null;
      } catch (error) {
        console.warn(`Warning during pool cleanup: ${error}`);
        this.pool = null;
      }
    }

    // Wait a bit more to ensure all connections are properly closed
    await new Promise((resolve) => setTimeout(resolve, 200));

    console.log(
      `✅ Closed connections to clustering database: ${this.databaseName}`,
    );
    console.log(
      `   Database will be cleaned up automatically after 1 day if not in use`,
    );
  }

  private ensureInitialized(): Pool {
    if (!this.pool) {
      throw new Error("Database not initialized");
    }
    return this.pool;
  }

  private async executeQuery<T>(query: string, params: any[] = []): Promise<T> {
    const pool = this.ensureInitialized();

    const client = await pool.connect();
    try {
      const result = await client.query(query, params);
      return result.rows as T;
    } catch (error) {
      console.error(`Query failed:`);
      console.error(`Query: ${query}`);
      console.error(`Parameters: ${JSON.stringify(params, null, 2)}`);
      console.error(`Error:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async executeTransaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      const pool = this.ensureInitialized();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
      } catch (error: any) {
        await client.query("ROLLBACK");

        // Check if this is a deadlock error
        if (error.code === "40P01" && attempt < maxRetries - 1) {
          attempt++;
          console.warn(
            `Deadlock detected, retrying (attempt ${attempt}/${maxRetries})`,
          );
          // Wait a random amount of time before retrying to reduce collision probability
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 100 + 50),
          );
          continue;
        }

        throw error;
      } finally {
        client.release();
      }
    }

    throw new Error("Transaction failed after maximum retries");
  }

  private async processBatches<T>(
    items: T[],
    batchSize: number,
    processor: (batch: T[], client: PoolClient) => Promise<void>,
  ): Promise<void> {
    await this.executeTransaction(async (client) => {
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        await processor(batch, client);
      }
    });
  }

  /**
   * Converts a MapObject to SQL parameters for insertion/update
   */
  private mapObjectToSQLParams(object: MapObject): any[] {
    const geometryGeoJSON = JSON.stringify(object.geometry);
    const spotType = (object as any).properties?.spotType || null;

    return [
      object._key,
      object.type,
      (object as any).source || "unknown",
      JSON.stringify(object.geometry),
      geometryGeoJSON,
      (object as any).isPolygon ? true : false,
      JSON.stringify(object.activities || []),
      JSON.stringify(object.skiAreas || []),
      (object as any).isBasisForNewSkiArea ? true : false,
      (object as any).isInSkiAreaPolygon ? true : false,
      (object as any).isInSkiAreaSite ? true : false,
      (object as any).liftType || null,
      JSON.stringify((object as any).stationIds || []),
      (object as any).difficulty || null,
      JSON.stringify((object as any).viirsPixels || []),
      spotType,
      JSON.stringify((object as any).properties || {}),
    ];
  }

  /**
   * Builds update SQL clauses for object field updates
   */
  private buildUpdateClauses(updates: Partial<MapObject>): {
    setParts: string[];
    values: any[];
  } {
    const setParts: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([field, value]) => {
      switch (field) {
        case "geometry":
          const geometryGeoJSON = JSON.stringify(value);
          setParts.push(
            `geometry = $${paramIndex++}`,
            `geom = ST_MakeValid(ST_Force2D(ST_GeomFromGeoJSON($${paramIndex++})), 'method=structure')`,
          );
          values.push(JSON.stringify(value), geometryGeoJSON);
          break;
        case "skiAreas":
          setParts.push(`ski_areas = $${paramIndex++}`);
          values.push(JSON.stringify(value));
          break;
        case "isBasisForNewSkiArea":
          setParts.push(`is_basis_for_new_ski_area = $${paramIndex++}`);
          values.push(value ? true : false);
          break;
        case "isInSkiAreaPolygon":
          setParts.push(`is_in_ski_area_polygon = $${paramIndex++}`);
          values.push(value ? true : false);
          break;
        case "isPolygon":
          setParts.push(`is_polygon = $${paramIndex++}`);
          values.push(value ? true : false);
          break;
        case "activities":
          setParts.push(`activities = $${paramIndex++}`);
          values.push(JSON.stringify(value));
          break;
        case "stationIds":
          setParts.push(`station_ids = $${paramIndex++}`);
          values.push(JSON.stringify(value));
          break;
        case "properties":
          setParts.push(`properties = $${paramIndex++}`);
          values.push(JSON.stringify(value));
          break;
      }
    });

    return { setParts, values };
  }

  private async enablePostGIS(): Promise<void> {
    const pool = this.ensureInitialized();

    // Enable PostGIS extension for spatial geometry types
    await pool.query("CREATE EXTENSION IF NOT EXISTS postgis");
    console.log("✅ PostGIS extension enabled");
  }

  private async createTables(): Promise<void> {
    const pool = this.ensureInitialized();

    // Create main objects table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS objects (
        key TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        geometry JSONB NOT NULL,
        is_polygon BOOLEAN NOT NULL,
        activities JSONB,
        ski_areas JSONB,
        is_basis_for_new_ski_area BOOLEAN DEFAULT FALSE,
        is_in_ski_area_polygon BOOLEAN DEFAULT FALSE,
        is_in_ski_area_site BOOLEAN DEFAULT FALSE,
        lift_type TEXT,
        station_ids JSONB,
        difficulty TEXT,
        viirs_pixels JSONB,
        spot_type TEXT,
        properties JSONB NOT NULL,
        geom GEOMETRY(Geometry, 4326)
      )
    `);

    console.log("✅ Created objects table");
  }

  async createIndexes(): Promise<void> {
    const pool = this.ensureInitialized();

    // Create spatial index using GIST
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_objects_geom ON objects USING GIST (geom)
    `);
    console.log("✅ Created spatial index on geometry column");

    // Create functional index on geography cast for distance queries
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_objects_geog ON objects USING GIST (geography(geom))
    `);
    console.log("✅ Created spatial index on geography cast");

    // Create optimized composite indexes for common query patterns
    await pool.query(`
      -- Core filtering indexes
      CREATE INDEX IF NOT EXISTS idx_type_source ON objects(type, source);
      CREATE INDEX IF NOT EXISTS idx_type_polygon ON objects(type, is_polygon);

      -- Ski area assignment queries
      CREATE INDEX IF NOT EXISTS idx_ski_areas_gin ON objects USING GIN (ski_areas);
      CREATE INDEX IF NOT EXISTS idx_type_ski_areas ON objects(type) WHERE ski_areas = '[]'::jsonb;

      -- Unassigned object queries (critical for clustering performance)
      CREATE INDEX IF NOT EXISTS idx_unassigned_runs ON objects(type, is_basis_for_new_ski_area)
        WHERE type = '${FeatureType.Run}' AND is_basis_for_new_ski_area = true;

      -- Source-specific queries with polygon filtering
      CREATE INDEX IF NOT EXISTS idx_source_polygon ON objects(source, is_polygon)
        WHERE is_polygon = true;
      CREATE INDEX IF NOT EXISTS idx_source_type_polygon ON objects(source, type, is_polygon);

      -- Activity-based filtering (using GIN for JSONB)
      CREATE INDEX IF NOT EXISTS idx_activities_gin ON objects USING GIN (activities);

      -- Polygon containment queries
      CREATE INDEX IF NOT EXISTS idx_polygon_filter ON objects(is_polygon, is_in_ski_area_polygon);

      -- Spot-specific queries
      CREATE INDEX IF NOT EXISTS idx_spots ON objects(type, spot_type)
        WHERE type = '${FeatureType.Spot}';
    `);
    console.log("✅ Created optimized composite indexes");
  }

  async saveObject(object: MapObject): Promise<void> {
    this.ensureInitialized();

    const params = this.mapObjectToSQLParams(object);

    await this.executeQuery(
      PostgreSQLClusteringDatabase.INSERT_OBJECT_SQL,
      params,
    );
  }

  async saveObjects(objects: MapObject[]): Promise<void> {
    this.ensureInitialized();

    // Process in optimized batches for very large datasets
    await this.processBatches(
      objects,
      PostgreSQLClusteringDatabase.BULK_OPERATION_BATCH_SIZE,
      async (batch, client) => {
        for (const object of batch) {
          const params = this.mapObjectToSQLParams(object);
          await client.query(
            PostgreSQLClusteringDatabase.INSERT_OBJECT_SQL,
            params,
          );
        }
      },
    );
  }

  async updateObject(key: string, updates: Partial<MapObject>): Promise<void> {
    this.ensureInitialized();

    const { setParts, values } = this.buildUpdateClauses(updates);

    if (setParts.length > 0) {
      values.push(key);
      const query = `UPDATE objects SET ${setParts.join(", ")} WHERE key = $${values.length}`;
      await this.executeQuery(query, values);
    }
  }

  async updateObjects(
    updates: Array<{ key: string; updates: Partial<MapObject> }>,
  ): Promise<void> {
    this.ensureInitialized();

    // Process in optimized batches for very large update sets
    await this.processBatches(
      updates,
      PostgreSQLClusteringDatabase.BULK_OPERATION_BATCH_SIZE,
      async (batch, client) => {
        for (const { key, updates: objectUpdates } of batch) {
          const { setParts, values } = this.buildUpdateClauses(objectUpdates);

          if (setParts.length > 0) {
            values.push(key);
            const query = `UPDATE objects SET ${setParts.join(", ")} WHERE key = $${values.length}`;
            await client.query(query, values);
          }
        }
      },
    );
  }

  async removeObject(key: string): Promise<void> {
    this.ensureInitialized();

    // First check if this is a ski area that needs association cleanup
    const objectType = (await this.executeQuery<any[]>(
      "SELECT type FROM objects WHERE key = $1",
      [key],
    )) as { type: FeatureType }[];

    if (objectType.length > 0 && objectType[0].type === FeatureType.SkiArea) {
      // Clean up all associations to this ski area
      await this.cleanUpSkiAreaAssociations(key);
    }

    await this.executeQuery("DELETE FROM objects WHERE key = $1", [key]);
  }

  private async cleanUpSkiAreaAssociations(skiAreaId: string): Promise<void> {
    this.ensureInitialized();

    // Find all objects that reference this ski area using JSONB operators
    const query = `SELECT key, ski_areas FROM objects 
       WHERE ski_areas @> $1::jsonb`;
    const affectedObjects = await this.executeQuery<any[]>(query, [
      `["${skiAreaId}"]`,
    ]);

    await this.executeTransaction(async (client) => {
      for (const obj of affectedObjects) {
        try {
          const currentSkiAreas = obj.ski_areas || [];
          const updatedSkiAreas = currentSkiAreas.filter(
            (id: string) => id !== skiAreaId,
          );
          await client.query(
            "UPDATE objects SET ski_areas = $1 WHERE key = $2",
            [JSON.stringify(updatedSkiAreas), obj.key],
          );
        } catch (error) {
          console.warn(
            `Failed to clean up ski area association for object ${obj.key}:`,
            error,
          );
        }
      }
    });
  }

  async getSkiAreas(
    options: GetSkiAreasOptions,
  ): Promise<Cursor<SkiAreaObject>> {
    const pool = this.ensureInitialized();

    let query = `SELECT * FROM objects WHERE type = '${FeatureType.SkiArea}'`;
    const params: any[] = [];
    let paramIndex = 1;

    if (options.onlySource) {
      query += ` AND source = $${paramIndex++}`;
      params.push(options.onlySource);
    }

    if (options.onlyPolygons) {
      query += " AND is_polygon = true";
    }

    if (options.onlyInPolygon) {
      const polygonGeoJSON = JSON.stringify(options.onlyInPolygon);
      query += ` AND ST_CoveredBy(geom, ST_MakeValid(ST_Force2D(ST_GeomFromGeoJSON($${paramIndex++})), 'method=structure'))`;
      params.push(polygonGeoJSON);
    }

    // Add ORDER BY for deterministic pagination
    query += " ORDER BY key";

    // Use large batch size for non-batching mode to load everything upfront
    const batchSize = options.useBatching
      ? PostgreSQLClusteringDatabase.DEFAULT_BATCH_SIZE
      : Number.MAX_SAFE_INTEGER;

    return new PostgreSQLCursor<SkiAreaObject>(
      pool,
      query,
      params,
      (row) => this.rowToMapObject(row) as SkiAreaObject,
      batchSize,
    );
  }

  async getSkiAreasByIds(
    ids: string[],
    useBatching: boolean,
  ): Promise<Cursor<SkiAreaObject>> {
    const pool = this.ensureInitialized();

    if (ids.length === 0) {
      return new EmptyCursor<SkiAreaObject>();
    }

    const placeholders = ids
      .map((_: string, i: number) => `$${i + 1}`)
      .join(",");
    const query = `SELECT * FROM objects WHERE type = '${FeatureType.SkiArea}' AND key IN (${placeholders}) ORDER BY key`;

    const batchSize = useBatching
      ? PostgreSQLClusteringDatabase.DEFAULT_BATCH_SIZE
      : Number.MAX_SAFE_INTEGER;

    return new PostgreSQLCursor<SkiAreaObject>(
      pool,
      query,
      ids,
      (row) => this.rowToMapObject(row) as SkiAreaObject,
      batchSize,
    );
  }

  async getAllRuns(useBatching: boolean): Promise<Cursor<RunObject>> {
    const pool = this.ensureInitialized();

    const query = `SELECT * FROM objects WHERE type = '${FeatureType.Run}' ORDER BY key`;
    const batchSize = useBatching
      ? PostgreSQLClusteringDatabase.DEFAULT_BATCH_SIZE
      : Number.MAX_SAFE_INTEGER;

    return new PostgreSQLCursor<RunObject>(
      pool,
      query,
      [],
      (row) => this.rowToMapObject(row) as RunObject,
      batchSize,
    );
  }

  async getAllLifts(useBatching: boolean): Promise<Cursor<LiftObject>> {
    const pool = this.ensureInitialized();

    const query = `SELECT * FROM objects WHERE type = '${FeatureType.Lift}' ORDER BY key`;
    const batchSize = useBatching
      ? PostgreSQLClusteringDatabase.DEFAULT_BATCH_SIZE
      : Number.MAX_SAFE_INTEGER;

    return new PostgreSQLCursor<LiftObject>(
      pool,
      query,
      [],
      (row) => this.rowToMapObject(row) as LiftObject,
      batchSize,
    );
  }

  async getAllSpots(useBatching: boolean): Promise<Cursor<SpotObject>> {
    const pool = this.ensureInitialized();

    const query = `SELECT * FROM objects WHERE type = '${FeatureType.Spot}' ORDER BY key`;
    const batchSize = useBatching
      ? PostgreSQLClusteringDatabase.DEFAULT_BATCH_SIZE
      : Number.MAX_SAFE_INTEGER;

    return new PostgreSQLCursor<SpotObject>(
      pool,
      query,
      [],
      (row) => this.rowToMapObject(row) as SpotObject,
      batchSize,
    );
  }

  async getAllLiftStations(useBatching: boolean): Promise<Cursor<SpotObject>> {
    const pool = this.ensureInitialized();

    const query = `SELECT * FROM objects WHERE type = '${FeatureType.Spot}' AND spot_type = 'lift_station' ORDER BY key`;
    const batchSize = useBatching
      ? PostgreSQLClusteringDatabase.DEFAULT_BATCH_SIZE
      : Number.MAX_SAFE_INTEGER;

    return new PostgreSQLCursor<SpotObject>(
      pool,
      query,
      [],
      (row) => this.rowToMapObject(row) as SpotObject,
      batchSize,
    );
  }

  async findNearbyObjects(
    geometry: GeoJSON.Geometry,
    context: SearchContext,
  ): Promise<MapObject[]> {
    this.ensureInitialized();

    let query: string;
    let paramIndex = 1;
    let params: any[];

    const geometryGeoJSON = JSON.stringify(geometry);

    if (context.bufferDistanceKm !== undefined) {
      // Use geography functional index for optimal performance
      const bufferMeters = context.bufferDistanceKm * 1000; // Convert km to meters

      if (context.searchType === "contains") {
        query = `
          SELECT * FROM objects
          WHERE ST_CoveredBy(geom, ST_Buffer(geography(ST_MakeValid(ST_Force2D(ST_GeomFromGeoJSON($${paramIndex++})), 'method=structure')), $${paramIndex++})::geometry)
            AND type != '${FeatureType.SkiArea}'
        `;
        params = [geometryGeoJSON, bufferMeters];
      } else {
        // For intersects, use ST_DWithin with geography index
        query = `
          SELECT * FROM objects
          WHERE ST_DWithin(geography(geom), geography(ST_Force2D(ST_GeomFromGeoJSON($${paramIndex++}))), $${paramIndex++})
            AND type != '${FeatureType.SkiArea}'
        `;
        params = [geometryGeoJSON, bufferMeters];
      }
      paramIndex = 3; // Reset to 3 since we used parameters 1-2
    } else {
      // Use direct geometry (no buffering)
      if (context.searchType === "contains") {
        query = `
          SELECT * FROM objects
          WHERE ST_CoveredBy(geom, ST_MakeValid(ST_Force2D(ST_GeomFromGeoJSON($${paramIndex++})), 'method=structure'))
            AND type != '${FeatureType.SkiArea}'
        `;
      } else {
        query = `
          SELECT * FROM objects
          WHERE ST_Intersects(geom, ST_MakeValid(ST_Force2D(ST_GeomFromGeoJSON($${paramIndex++})), 'method=structure'))
            AND type != '${FeatureType.SkiArea}'
        `;
      }
      params = [geometryGeoJSON];
      paramIndex = 2; // Reset to 2 since we used parameter 1
    }

    if (context.activities.length > 0) {
      // Use JSONB operators for activity filtering
      const activityConditions = context.activities
        .map(() => `activities @> $${paramIndex++}::jsonb`)
        .join(" OR ");
      query += ` AND (${activityConditions})`;
      context.activities.forEach((activity) => {
        params.push(JSON.stringify([activity]));
      });
    }

    // Filter out objects that already belong to this ski area
    query += ` AND NOT (ski_areas @> $${paramIndex++}::jsonb)`;
    params.push(JSON.stringify([context.id]));

    if (context.excludeObjectsAlreadyInSkiArea) {
      // Exclude objects that are already assigned to any ski area
      query += " AND (ski_areas = '[]'::jsonb OR ski_areas IS NULL)";
    }

    if (context.alreadyVisited.length > 0) {
      const placeholders = context.alreadyVisited
        .map((_: string, i: number) => `$${paramIndex + i}`)
        .join(",");
      query += ` AND key NOT IN (${placeholders})`;
      params.push(...context.alreadyVisited);
      paramIndex += context.alreadyVisited.length;
    }

    return performanceMonitor.measure(
      "Find nearby objects",
      async () => {
        const rows = await this.executeQuery<any[]>(query, params);
        const allFound = rows.map(this.rowToMapObject);
        allFound.forEach((object) => context.alreadyVisited.push(object._key));
        return allFound;
      },
      () => ({
        poolStats: { idle: this.pool?.idleCount, total: this.pool?.totalCount },
      }),
    );
  }

  async getObjectsForSkiArea(skiAreaId: string): Promise<MapObject[]> {
    this.ensureInitialized();

    const query = `SELECT * FROM objects 
       WHERE ski_areas @> $1::jsonb AND type != '${FeatureType.SkiArea}'`;
    const rows = await this.executeQuery<any[]>(query, [
      JSON.stringify([skiAreaId]),
    ]);

    return rows.map(this.rowToMapObject);
  }

  async markObjectsAsPartOfSkiArea(
    skiAreaId: string,
    objectKeys: string[],
    isInSkiAreaPolygon: boolean,
  ): Promise<void> {
    this.ensureInitialized();

    if (objectKeys.length === 0) {
      return;
    }

    // Sort object keys to ensure consistent ordering and prevent deadlocks
    const sortedKeys = [...objectKeys].sort();

    await this.executeTransaction(async (client) => {
      // Atomic update using JSONB operators - adds ski area ID only if not already present
      const skiAreaIdJson = JSON.stringify([skiAreaId]);

      await client.query(
        `UPDATE objects 
         SET ski_areas = CASE 
           WHEN ski_areas @> $1::jsonb THEN ski_areas
           ELSE COALESCE(ski_areas, '[]'::jsonb) || $1::jsonb
         END,
         is_in_ski_area_polygon = is_in_ski_area_polygon OR $2,
         is_basis_for_new_ski_area = false
         WHERE key = ANY($3::text[])`,
        [skiAreaIdJson, isInSkiAreaPolygon, sortedKeys],
      );
    });
  }

  async getNextUnassignedRun(): Promise<MapObject | null> {
    this.ensureInitialized();

    const query = `
      SELECT * FROM objects 
      WHERE type = '${FeatureType.Run}' 
        AND is_basis_for_new_ski_area = true
      LIMIT 1
    `;

    const rows = await this.executeQuery<any[]>(query, []);
    const run = rows.length > 0 ? this.rowToMapObject(rows[0]) : null;

    if (run && run.activities.length === 0) {
      throw new Error("No activities for run");
    }
    return run;
  }

  async streamSkiAreas(): Promise<AsyncIterable<SkiAreaObject>> {
    this.ensureInitialized();

    const query = `SELECT * FROM objects WHERE type = '${FeatureType.SkiArea}'`;
    const rows = await this.executeQuery<any[]>(query, []);

    const self = this;
    return {
      async *[Symbol.asyncIterator]() {
        for (const row of rows) {
          yield self.rowToMapObject(row) as SkiAreaObject;
        }
      },
    };
  }

  async getObjectById(objectId: string): Promise<MapObject | null> {
    this.ensureInitialized();

    const query = "SELECT * FROM objects WHERE key = $1";
    const rows = await this.executeQuery<any[]>(query, [objectId]);

    return rows.length > 0 ? this.rowToMapObject(rows[0]) : null;
  }

  private rowToMapObject(row: any): MapObject {
    const baseObject: any = {
      _key: row.key,
      type: row.type as FeatureType,
      geometry: row.geometry,
      activities: row.activities || [],
      skiAreas: row.ski_areas || [],
      source: row.source,
      isPolygon: Boolean(row.is_polygon),
      isBasisForNewSkiArea: Boolean(row.is_basis_for_new_ski_area),
      isInSkiAreaPolygon: Boolean(row.is_in_ski_area_polygon),
      properties: row.properties || {},
    };

    // Add type-specific fields
    if (row.type === FeatureType.SkiArea) {
      baseObject.id = row.key;
    } else if (row.type === FeatureType.Lift) {
      baseObject.liftType = row.lift_type;
      baseObject.stationIds = row.station_ids || [];
      baseObject.isInSkiAreaSite = Boolean(row.is_in_ski_area_site);
      baseObject.properties = row.properties || { places: [] };
    } else if (row.type === FeatureType.Run) {
      baseObject.difficulty = row.difficulty;
      baseObject.viirsPixels = row.viirs_pixels || [];
      baseObject.isInSkiAreaSite = Boolean(row.is_in_ski_area_site);
      baseObject.properties = row.properties || { places: [] };
    } else if (row.type === FeatureType.Spot) {
      baseObject.isInSkiAreaSite = Boolean(row.is_in_ski_area_site);
      baseObject.properties = row.properties || { places: [] };
    }

    return baseObject as MapObject;
  }

  async getObjectDerivedSkiAreaGeometry(
    skiAreaId: string,
  ): Promise<GeoJSON.Geometry> {
    this.ensureInitialized();

    try {
      // Single query to get union of member geometries or fall back to ski area geometry
      const query = `
        WITH member_geometries AS (
          SELECT geom FROM objects 
          WHERE ski_areas @> $1::jsonb AND type != '${FeatureType.SkiArea}'
        ),
        ski_area_geometry AS (
          SELECT geom FROM objects 
          WHERE key = $2 AND type = '${FeatureType.SkiArea}'
        ),
        union_result AS (
          SELECT
            CASE
              WHEN COUNT(*) > 0 THEN ST_AsGeoJSON(ST_Union(ST_MakeValid(geom, 'method=structure')))::jsonb
              ELSE NULL
            END as union_geometry
          FROM member_geometries
        )
        SELECT 
          COALESCE(
            union_result.union_geometry,
            ST_AsGeoJSON(ski_area_geometry.geom)::jsonb
          ) as geometry
        FROM union_result 
        CROSS JOIN ski_area_geometry
      `;

      const rows = await this.executeQuery<any[]>(query, [
        JSON.stringify([skiAreaId]),
        skiAreaId,
      ]);

      if (rows.length === 0 || !rows[0].geometry) {
        throw new Error(`No geometry found for ski area ${skiAreaId}`);
      }

      return rows[0].geometry as GeoJSON.Geometry;
    } catch (error) {
      console.warn(
        `Failed to get derived geometry for ski area ${skiAreaId}, querying ski area geometry directly:`,
        error,
      );

      // Fallback: just get the ski area's own geometry
      const fallbackQuery = `SELECT geometry FROM objects WHERE key = $1 AND type = '${FeatureType.SkiArea}'`;
      const rows = await this.executeQuery<any[]>(fallbackQuery, [skiAreaId]);

      if (rows.length === 0) {
        throw new Error(`Ski area ${skiAreaId} not found`);
      }

      return rows[0].geometry as GeoJSON.Geometry;
    }
  }
}

/**
 * Empty cursor that returns no results
 */
class EmptyCursor<T> implements Cursor<T> {
  async nextBatch(): Promise<T[] | null> {
    return null;
  }

  async all(): Promise<T[]> {
    return [];
  }
}

/**
 * Generic cursor that fetches data from PostgreSQL in batches to minimize memory usage.
 * Instead of loading all results upfront, this cursor fetches data on-demand using LIMIT/OFFSET.
 */
export class PostgreSQLCursor<T extends MapObject> implements Cursor<T> {
  private offset = 0;
  private readonly batchSize: number;
  private isExhausted = false;

  constructor(
    private pool: Pool,
    private query: string,
    private params: any[],
    private rowMapper: (row: any) => T,
    batchSize = 1000,
  ) {
    this.batchSize = batchSize;

    // Validate that queries using batching have ORDER BY for deterministic results
    if (batchSize < Number.MAX_SAFE_INTEGER && !this.hasOrderBy(query)) {
      throw new Error(
        "Query must include ORDER BY clause for deterministic pagination. " +
          "Without ORDER BY, OFFSET-based batching can skip or duplicate rows.\n" +
          `Query: ${query.substring(0, 100)}...`,
      );
    }
  }

  /**
   * Checks if the query contains an ORDER BY clause.
   */
  private hasOrderBy(query: string): boolean {
    const normalizedQuery = query.trim().replace(/\s+/g, " ").toUpperCase();
    return normalizedQuery.includes(" ORDER BY ");
  }

  async nextBatch(): Promise<T[] | null> {
    if (this.isExhausted) {
      return null;
    }

    const client = await this.pool.connect();
    try {
      const paginatedQuery = `${this.query} LIMIT $${this.params.length + 1} OFFSET $${this.params.length + 2}`;
      const paginatedParams = [...this.params, this.batchSize, this.offset];

      const result = await client.query(paginatedQuery, paginatedParams);

      // Update offset BEFORE mapping to prevent corruption if rowMapper throws
      this.offset += result.rows.length;

      if (result.rows.length < this.batchSize) {
        this.isExhausted = true;
      }

      const batch = result.rows.map(this.rowMapper);
      return batch.length > 0 ? batch : null;
    } finally {
      client.release();
    }
  }

  async all(): Promise<T[]> {
    const results: T[] = [];
    let batch: T[] | null;
    while ((batch = await this.nextBatch()) !== null) {
      results.push(...batch);
    }
    return results;
  }
}
