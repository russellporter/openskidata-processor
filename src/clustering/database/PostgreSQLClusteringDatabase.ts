import { Pool, PoolClient } from "pg";
import {
  MapObject,
  MapObjectType,
  RunObject,
  SkiAreaObject,
} from "../MapObject";
import {
  ClusteringDatabase,
  GetSkiAreasOptions,
  SearchContext,
  SkiAreasCursor,
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
  private initialized = false;
  private databaseName: string;

  constructor(private workingDir: string) {
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
    (key, type, source, geometry, geometry_with_elevations, geom, is_polygon, activities, ski_areas, 
     is_basis_for_new_ski_area, is_in_ski_area_polygon, is_in_ski_area_site, 
     lift_type, difficulty, viirs_pixels, properties) 
    VALUES ($1, $2, $3, $4, $5, ST_GeomFromText($6, 4326), $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    ON CONFLICT (key) DO UPDATE SET
      type = EXCLUDED.type,
      source = EXCLUDED.source,
      geometry = EXCLUDED.geometry,
      geometry_with_elevations = EXCLUDED.geometry_with_elevations,
      geom = EXCLUDED.geom,
      is_polygon = EXCLUDED.is_polygon,
      activities = EXCLUDED.activities,
      ski_areas = EXCLUDED.ski_areas,
      is_basis_for_new_ski_area = EXCLUDED.is_basis_for_new_ski_area,
      is_in_ski_area_polygon = EXCLUDED.is_in_ski_area_polygon,
      is_in_ski_area_site = EXCLUDED.is_in_ski_area_site,
      lift_type = EXCLUDED.lift_type,
      difficulty = EXCLUDED.difficulty,
      viirs_pixels = EXCLUDED.viirs_pixels,
      properties = EXCLUDED.properties
  `;

  async initialize(): Promise<void> {
    // First connect to postgres database to create our temporary database
    const adminPool = new Pool({
      host: "localhost",
      port: 5432,
      database: "postgres", // Connect to default postgres database
      user: "postgres",
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

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
    this.pool = new Pool({
      host: "localhost",
      port: 5432,
      database: this.databaseName,
      user: "postgres",
      max: 10, // Reasonable pool size for clustering workload
      idleTimeoutMillis: 120000, // Close idle clients after 60 seconds
      connectionTimeoutMillis: 60000, // Return an error after 60 seconds if connection could not be established
      allowExitOnIdle: true, // Allow process to exit even if pool has idle connections
    });

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

    this.initialized = true;
    console.log(
      `✅ PostgreSQL clustering database initialized: ${this.databaseName}`,
    );
  }

  async close(): Promise<void> {
    // Log performance summary before closing
    performanceMonitor.logSummary();

    // Gracefully close the main connection pool
    if (this.pool) {
      try {
        // Wait a bit for any pending operations to complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Check if there are any active connections
        const activeConnections = this.pool.totalCount - this.pool.idleCount;
        if (activeConnections > 0) {
          console.warn(`Warning: ${activeConnections} active connections during close, waiting for completion...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        await this.pool.end();
        this.pool = null;
      } catch (error) {
        console.warn(`Warning during pool cleanup: ${error}`);
        this.pool = null;
      }
    }
    this.initialized = false;

    // Wait a bit more to ensure all connections are properly closed
    await new Promise(resolve => setTimeout(resolve, 200));

    // Delete the temporary database
    const adminPool = new Pool({
      host: "localhost",
      port: 5432,
      database: "postgres", // Connect to default postgres database
      user: "postgres",
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    try {
      const adminClient = await adminPool.connect();
      try {
        // Terminate any existing connections to the database before dropping it
        // Wrap in try-catch to handle connection termination errors gracefully
        try {
          await adminClient.query(`
            SELECT pg_terminate_backend(pg_stat_activity.pid)
            FROM pg_stat_activity
            WHERE pg_stat_activity.datname = '${this.databaseName}'
              AND pid <> pg_backend_pid()
          `);
        } catch (terminateError) {
          // Connection termination errors are expected during shutdown
          console.debug(`Connection termination completed: ${terminateError}`);
        }

        await adminClient.query(
          `DROP DATABASE IF EXISTS "${this.databaseName}"`,
        );
        console.log(`✅ Deleted temporary database: ${this.databaseName}`);
      } finally {
        adminClient.release();
      }
    } catch (error) {
      console.warn(
        `Failed to delete temporary database ${this.databaseName}: ${error}`,
      );
    } finally {
      try {
        await adminPool.end();
      } catch (poolError) {
        // Ignore pool cleanup errors during shutdown
        console.debug(`Admin pool cleanup: ${poolError}`);
      }
    }
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
      console.error(`Query failed: ${query.substring(0, 100)}...`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async executeTransaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const maxRetries = 3;
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
    const geometryWKT = this.geoJSONToWKT(object.geometry);

    return [
      object._key,
      object.type,
      (object as any).source || "unknown",
      JSON.stringify(object.geometry),
      JSON.stringify((object as any).geometryWithElevations || object.geometry),
      geometryWKT,
      (object as any).isPolygon ? true : false,
      JSON.stringify(object.activities || []),
      JSON.stringify(object.skiAreas || []),
      (object as any).isBasisForNewSkiArea ? true : false,
      (object as any).isInSkiAreaPolygon ? true : false,
      (object as any).isInSkiAreaSite ? true : false,
      (object as any).liftType || null,
      (object as any).difficulty || null,
      JSON.stringify((object as any).viirsPixels || []),
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
          const geometryWKT = this.geoJSONToWKT(value as GeoJSON.Geometry);
          setParts.push(
            `geometry = $${paramIndex++}`,
            `geom = ST_GeomFromText($${paramIndex++}, 4326)`,
          );
          values.push(JSON.stringify(value), geometryWKT);
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
        geometry_with_elevations JSONB,
        is_polygon BOOLEAN NOT NULL,
        activities JSONB,
        ski_areas JSONB,
        is_basis_for_new_ski_area BOOLEAN DEFAULT FALSE,
        is_in_ski_area_polygon BOOLEAN DEFAULT FALSE,
        is_in_ski_area_site BOOLEAN DEFAULT FALSE,
        lift_type TEXT,
        difficulty TEXT,
        viirs_pixels JSONB,
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
        WHERE type = 'RUN' AND is_basis_for_new_ski_area = true;
      
      -- Source-specific queries with polygon filtering
      CREATE INDEX IF NOT EXISTS idx_source_polygon ON objects(source, is_polygon) 
        WHERE is_polygon = true;
      CREATE INDEX IF NOT EXISTS idx_source_type_polygon ON objects(source, type, is_polygon);
      
      -- Activity-based filtering (using GIN for JSONB)
      CREATE INDEX IF NOT EXISTS idx_activities_gin ON objects USING GIN (activities);
      
      -- Polygon containment queries
      CREATE INDEX IF NOT EXISTS idx_polygon_filter ON objects(is_polygon, is_in_ski_area_polygon);
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
    const objectType = await this.executeQuery<any[]>(
      "SELECT type FROM objects WHERE key = $1",
      [key],
    );

    if (objectType.length > 0 && objectType[0].type === "SKI_AREA") {
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

  async getSkiAreas(options: GetSkiAreasOptions): Promise<SkiAreasCursor> {
    this.ensureInitialized();

    let query = "SELECT * FROM objects WHERE type = 'SKI_AREA'";
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
      const polygonWKT = this.geoJSONToWKT(options.onlyInPolygon);
      query += ` AND ST_Within(geom, ST_GeomFromText($${paramIndex++}, 4326))`;
      params.push(polygonWKT);
    }

    try {
      const rows = await this.executeQuery<any[]>(query, params);
      const skiAreas = rows.map(this.rowToMapObject) as SkiAreaObject[];

      return new PostgreSQLSkiAreasCursor(
        skiAreas,
        PostgreSQLClusteringDatabase.DEFAULT_BATCH_SIZE,
      );
    } catch (error: any) {
      // Check if this is a geometry/topology error
      if (
        error.message?.includes("TopologyException") ||
        error.message?.includes("side location conflict") ||
        error.message?.includes("invalid geometry") ||
        error.code === "42804" // PostGIS geometry error code
      ) {
        console.warn(
          `Geometry error in getSkiAreas query, returning empty result:`,
          error.message,
        );
        return new PostgreSQLSkiAreasCursor(
          [],
          PostgreSQLClusteringDatabase.DEFAULT_BATCH_SIZE,
        );
      }
      // Re-throw all other errors
      throw error;
    }
  }

  async getSkiAreasByIds(ids: string[]): Promise<SkiAreasCursor> {
    this.ensureInitialized();

    // Handle empty array case to avoid SQL syntax error
    if (ids.length === 0) {
      return new PostgreSQLSkiAreasCursor(
        [],
        PostgreSQLClusteringDatabase.DEFAULT_BATCH_SIZE,
      );
    }

    const placeholders = ids
      .map((_: string, i: number) => `$${i + 1}`)
      .join(",");
    const query = `SELECT * FROM objects WHERE type = 'SKI_AREA' AND key IN (${placeholders})`;

    const rows = await this.executeQuery<any[]>(query, ids);
    const skiAreas = rows.map(this.rowToMapObject) as SkiAreaObject[];

    return new PostgreSQLSkiAreasCursor(
      skiAreas,
      PostgreSQLClusteringDatabase.DEFAULT_BATCH_SIZE,
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

    const geometryWKT = this.geoJSONToWKT(geometry);
    
    if (context.bufferDistanceKm !== undefined) {
      // Use geography functional index for optimal performance
      const bufferMeters = context.bufferDistanceKm * 1000; // Convert km to meters

      if (context.searchType === "contains") {
        // For contains, use ST_Within with geometry buffer (more precise than distance)
        query = `
          SELECT * FROM objects 
          WHERE ST_Within(geom, ST_Buffer(geography(ST_GeomFromText($${paramIndex++}, 4326)), $${paramIndex++})::geometry)
            AND type != 'SKI_AREA'
        `;
        params = [geometryWKT, bufferMeters];
      } else {
        // For intersects, use ST_DWithin with geography index
        query = `
          SELECT * FROM objects 
          WHERE ST_DWithin(geography(geom), geography(ST_GeomFromText($${paramIndex++}, 4326)), $${paramIndex++})
            AND type != 'SKI_AREA'
        `;
        params = [geometryWKT, bufferMeters];
      }
      paramIndex = 3; // Reset to 3 since we used parameters 1-2
    } else {
      // Use direct geometry (no buffering)
      if (context.searchType === "contains") {
        query = `
          SELECT * FROM objects 
          WHERE ST_Within(geom, ST_GeomFromText($${paramIndex++}, 4326))
            AND type != 'SKI_AREA'
        `;
      } else {
        query = `
          SELECT * FROM objects 
          WHERE ST_Intersects(geom, ST_GeomFromText($${paramIndex++}, 4326))
            AND type != 'SKI_AREA'
        `;
      }
      params = [geometryWKT];
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
      "findNearbyObjects_spatial",
      async () => {
        try {
          const rows = await this.executeQuery<any[]>(query, params);
          const allFound = rows.map(this.rowToMapObject);
          allFound.forEach((object) =>
            context.alreadyVisited.push(object._key),
          );
          return allFound;
        } catch (error: any) {
          // Check if this is a geometry/topology error
          if (
            error.message?.includes("TopologyException") ||
            error.message?.includes("side location conflict") ||
            error.message?.includes("invalid geometry") ||
            error.code === "42804" // PostGIS geometry error code
          ) {
            console.warn(
              `Geometry error in spatial query for area ${context.id}, skipping:`,
              error.message,
            );
            return [];
          }
          // Re-throw all other errors
          throw error;
        }
      },
      () => ({
        poolStats: { idle: this.pool?.idleCount, total: this.pool?.totalCount },
      }),
    );
  }

  async getObjectsForSkiArea(skiAreaId: string): Promise<MapObject[]> {
    this.ensureInitialized();

    const query = `SELECT * FROM objects 
       WHERE ski_areas @> $1::jsonb AND type != 'SKI_AREA'`;
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
      WHERE type = 'RUN' 
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

    const query = "SELECT * FROM objects WHERE type = 'SKI_AREA'";
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

  async getSkiAreasForObject(objectId: string): Promise<SkiAreaObject[]> {
    this.ensureInitialized();

    const objectQuery = "SELECT ski_areas FROM objects WHERE key = $1";
    const objectRows = await this.executeQuery<any[]>(objectQuery, [objectId]);

    if (objectRows.length === 0 || !objectRows[0].ski_areas) {
      return [];
    }

    const skiAreaIds = (objectRows[0].ski_areas || []).filter(
      (id: any) => id != null,
    );
    if (skiAreaIds.length === 0) {
      return [];
    }

    const placeholders = skiAreaIds
      .map((_: string, i: number) => `$${i + 1}`)
      .join(",");
    const query = `SELECT * FROM objects WHERE type = 'SKI_AREA' AND key IN (${placeholders})`;

    const rows = await this.executeQuery<any[]>(query, skiAreaIds);
    return rows.map(this.rowToMapObject) as SkiAreaObject[];
  }

  async getRunObjectById(runId: string): Promise<RunObject | null> {
    this.ensureInitialized();

    const query = "SELECT * FROM objects WHERE key = $1 AND type = 'RUN'";
    const rows = await this.executeQuery<any[]>(query, [runId]);

    return rows.length > 0 ? (this.rowToMapObject(rows[0]) as RunObject) : null;
  }

  private rowToMapObject(row: any): MapObject {
    const baseObject: any = {
      _key: row.key,
      type: row.type as MapObjectType,
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
    if (row.type === MapObjectType.SkiArea) {
      baseObject.id = row.key;
    } else if (row.type === MapObjectType.Lift) {
      baseObject.geometryWithElevations =
        row.geometry_with_elevations || row.geometry;
      baseObject.liftType = row.lift_type;
      baseObject.isInSkiAreaSite = Boolean(row.is_in_ski_area_site);
    } else if (row.type === MapObjectType.Run) {
      baseObject.geometryWithElevations =
        row.geometry_with_elevations || row.geometry;
      baseObject.difficulty = row.difficulty;
      baseObject.viirsPixels = row.viirs_pixels || [];
      baseObject.isInSkiAreaSite = Boolean(row.is_in_ski_area_site);
    }

    return baseObject as MapObject;
  }

  private geoJSONToWKT(geometry: GeoJSON.Geometry): string {
    switch (geometry.type) {
      case "Point":
        return `POINT(${geometry.coordinates[0]} ${geometry.coordinates[1]})`;

      case "LineString":
        const lineCoords = geometry.coordinates
          .map((coord) => `${coord[0]} ${coord[1]}`)
          .join(", ");
        return `LINESTRING(${lineCoords})`;

      case "Polygon":
        const ringStrings = geometry.coordinates
          .map((ring) => {
            const ringCoords = ring
              .map((coord) => `${coord[0]} ${coord[1]}`)
              .join(", ");
            return `(${ringCoords})`;
          })
          .join(", ");
        return `POLYGON(${ringStrings})`;

      case "MultiPolygon":
        const polygonStrings = geometry.coordinates
          .map((polygon) => {
            const ringStrings = polygon
              .map((ring) => {
                const ringCoords = ring
                  .map((coord) => `${coord[0]} ${coord[1]}`)
                  .join(", ");
                return `(${ringCoords})`;
              })
              .join(", ");
            return `(${ringStrings})`;
          })
          .join(", ");
        return `MULTIPOLYGON(${polygonStrings})`;

      default:
        throw new Error(`Unsupported geometry type: ${geometry.type}`);
    }
  }
}

class PostgreSQLSkiAreasCursor implements SkiAreasCursor {
  private index = 0;
  private readonly batchSize: number;

  constructor(
    private skiAreas: SkiAreaObject[],
    batchSize = 1000,
  ) {
    this.batchSize = batchSize;
  }

  async next(): Promise<SkiAreaObject | null> {
    if (this.index >= this.skiAreas.length) {
      return null;
    }
    return this.skiAreas[this.index++];
  }

  async all(): Promise<SkiAreaObject[]> {
    return this.skiAreas;
  }

  batches = {
    next: async (): Promise<SkiAreaObject[] | null> => {
      if (this.index >= this.skiAreas.length) {
        return null;
      }
      const batch = this.skiAreas.slice(
        this.index,
        this.index + this.batchSize,
      );
      this.index += batch.length;
      return batch;
    },
  };
}
