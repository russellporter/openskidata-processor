import Database from "better-sqlite3";
import fs from "fs";
import { SkiAreaActivity } from "openskidata-format";
import os from "os";
import path from "path";
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

/**
 * SQLite implementation of ClusteringDatabase using SpatialLite for spatial queries.
 *
 * Installation requirements:
 * npm install sqlite sqlite3 @types/sqlite3
 *
 * You may also need to install SpatialLite:
 * - On Ubuntu/Debian: sudo apt-get install libspatialite7 libspatialite-dev spatialite-bin
 * - On macOS: brew install libspatialite
 * - On Windows: Download from https://www.gaia-gis.it/gaia-sins/
 */
export class SQLiteClusteringDatabase implements ClusteringDatabase {
  private db: Database.Database | null = null;
  private spatialLiteEnabled = false;
  private stmtCache = new Map<string, Database.Statement>();
  private dbPath: string;

  constructor(workingDir: string) {
    this.dbPath = path.join(workingDir, "clustering.db");
  }

  // Optimized batch sizes for better performance
  private static readonly DEFAULT_BATCH_SIZE = 1000;
  private static readonly BULK_OPERATION_BATCH_SIZE = 5000;

  // SQL statements
  private static readonly INSERT_OBJECT_SQL = `
    INSERT OR REPLACE INTO objects 
    (key, type, source, geometry, geometry_with_elevations, geom, is_polygon, activities, ski_areas, 
     is_basis_for_new_ski_area, is_in_ski_area_polygon, is_in_ski_area_site, 
     lift_type, difficulty, viirs_pixels, properties) 
    VALUES (?, ?, ?, ?, ?, GeomFromText(?, 4326), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  async initialize(): Promise<void> {
    // Create working directory if it doesn't exist
    const workingDir = path.dirname(this.dbPath);
    if (!fs.existsSync(workingDir)) {
      fs.mkdirSync(workingDir, { recursive: true });
    }
    
    // Remove existing database file if it exists
    if (fs.existsSync(this.dbPath)) {
      fs.unlinkSync(this.dbPath);
    }
    
    // Create the database file
    this.db = new Database(this.dbPath);

    // Configure SQLite for optimal performance
    this.configureSQLitePerformance();

    // Enable SpatialLite extension - this is required, not optional
    await this.loadSpatialLite();
    await this.createTables();
  }

  private configureSQLitePerformance(): void {
    if (!this.db) throw new Error("Database not initialized");

    // Configure SQLite for optimal clustering performance
    this.db.exec(`
      -- Enable WAL mode for better concurrent access and performance
      PRAGMA journal_mode = WAL;
      
      -- Reduce fsync calls for better performance (still safe with WAL)
      PRAGMA synchronous = NORMAL;
      
      -- Increase cache size to 64MB for better in-memory performance
      PRAGMA cache_size = -64000;
      
      -- Use memory for temporary tables and indexes
      PRAGMA temp_store = MEMORY;
      
      -- Enable memory-mapped I/O for 256MB (better for large datasets)
      PRAGMA mmap_size = 268435456;
      
      -- Optimize page size for spatial data (4KB is good for mixed workloads)
      PRAGMA page_size = 4096;
      
      -- Analyze tables periodically for better query planning
      PRAGMA optimize;
    `);

    console.log("✅ SQLite performance configuration applied");
  }

  private async loadSpatialLite(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    // Try different SpatialLite extension names/paths
    const spatialiteNames = [
      "mod_spatialite",
      "libspatialite",
      "/usr/lib/x86_64-linux-gnu/mod_spatialite.so",
      "/usr/lib/aarch64-linux-gnu/libspatialite.so",
      "/usr/lib/aarch64-linux-gnu/libspatialite.so.7",
      "/usr/local/lib/mod_spatialite.dylib",
      "/opt/homebrew/lib/mod_spatialite.dylib",
    ];

    let spatialiteLoaded = false;
    let lastError: Error | null = null;

    for (const name of spatialiteNames) {
      try {
        this.db.loadExtension(name);
        spatialiteLoaded = true;
        break;
      } catch (error) {
        lastError = error as Error;
        continue;
      }
    }

    if (!spatialiteLoaded) {
      throw new Error(
        `Failed to load SpatialLite extension. Last error: ${lastError?.message}\n` +
          `Please install SpatialLite:\n` +
          `  macOS: brew install libspatialite\n` +
          `  Ubuntu/Debian: sudo apt-get install libspatialite7 libspatialite-dev\n` +
          `  Or set LD_LIBRARY_PATH to include SpatialLite location`,
      );
    }

    // Verify SpatialLite is working by checking for spatial functions
    try {
      this.db.prepare("SELECT spatialite_version()").get();
      this.spatialLiteEnabled = true;
      console.log("✅ SpatialLite extension loaded successfully");
    } catch (error) {
      throw new Error(
        `SpatialLite extension loaded but spatial functions not available: ${error}`,
      );
    }

    // Initialize spatial metadata
    try {
      this.db.exec("SELECT InitSpatialMetaData(1)");
      console.log("✅ SpatialLite metadata initialized");
    } catch (error) {
      // Check if metadata already exists
      try {
        this.db.prepare("SELECT * FROM spatial_ref_sys LIMIT 1").get();
        console.log("✅ SpatialLite metadata already exists");
      } catch {
        throw new Error(`Failed to initialize SpatialLite metadata: ${error}`);
      }
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    // Clear statement cache
    this.stmtCache.clear();
  }

  private ensureInitialized(): Database.Database {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    return this.db;
  }

  private getStatement(sql: string): Database.Statement {
    const db = this.ensureInitialized();

    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  private async processBatches<T>(
    items: T[],
    batchSize: number,
    processor: (batch: T[]) => void,
  ): Promise<void> {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      processor(batch);
    }
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
      (object as any).isPolygon ? 1 : 0,
      JSON.stringify(object.activities || []),
      JSON.stringify(object.skiAreas || []),
      (object as any).isBasisForNewSkiArea ? 1 : 0,
      (object as any).isInSkiAreaPolygon ? 1 : 0,
      (object as any).isInSkiAreaSite ? 1 : 0,
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

    Object.entries(updates).forEach(([field, value]) => {
      switch (field) {
        case "geometry":
          const geometryWKT = this.geoJSONToWKT(value as GeoJSON.Geometry);
          setParts.push("geometry = ?", "geom = GeomFromText(?, 4326)");
          values.push(JSON.stringify(value), geometryWKT);
          break;
        case "skiAreas":
          setParts.push("ski_areas = ?");
          values.push(JSON.stringify(value));
          break;
        case "isBasisForNewSkiArea":
          setParts.push("is_basis_for_new_ski_area = ?");
          values.push(value ? 1 : 0);
          break;
        case "isInSkiAreaPolygon":
          setParts.push("is_in_ski_area_polygon = ?");
          values.push(value ? 1 : 0);
          break;
        case "isPolygon":
          setParts.push("is_polygon = ?");
          values.push(value ? 1 : 0);
          break;
        case "activities":
          setParts.push("activities = ?");
          values.push(JSON.stringify(value));
          break;
        case "properties":
          setParts.push("properties = ?");
          values.push(JSON.stringify(value));
          break;
      }
    });

    return { setParts, values };
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    // Create main objects table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS objects (
        key TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        geometry TEXT NOT NULL,
        geometry_with_elevations TEXT,
        is_polygon BOOLEAN NOT NULL,
        activities TEXT,
        ski_areas TEXT,
        is_basis_for_new_ski_area BOOLEAN DEFAULT FALSE,
        is_in_ski_area_polygon BOOLEAN DEFAULT FALSE,
        is_in_ski_area_site BOOLEAN DEFAULT FALSE,
        lift_type TEXT,
        difficulty TEXT,
        viirs_pixels TEXT,
        properties TEXT NOT NULL
      )
    `);

    // Add spatial geometry column - SpatialLite is required at this point
    if (!this.spatialLiteEnabled) {
      throw new Error("Cannot create tables without SpatialLite extension");
    }

    // Check if geom column already exists
    const columns = this.db.prepare("PRAGMA table_info(objects)").all();
    const hasGeomColumn = columns.some((col: any) => col.name === "geom");

    if (!hasGeomColumn) {
      this.db.exec(`
        SELECT AddGeometryColumn('objects', 'geom', 4326, 'GEOMETRY', 'XY')
      `);
      console.log("✅ Added spatial geometry column to objects table");
    } else {
      console.log("✅ Spatial geometry column already exists");
    }
  }

  async createIndexes(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    if (!this.spatialLiteEnabled) {
      throw new Error(
        "Cannot create spatial indexes without SpatialLite extension",
      );
    }

    // Create spatial index (safe to call multiple times)
    try {
      this.db.exec("SELECT CreateSpatialIndex('objects', 'geom')");
      console.log("✅ Created spatial index on geometry column");
    } catch (error) {
      // Index might already exist, check if it's the expected error
      if (
        error instanceof Error &&
        error.message.includes("SpatialIndex is already defined")
      ) {
        console.log("✅ Spatial index already exists");
      } else {
        throw error;
      }
    }

    // Create optimized composite indexes for common query patterns
    this.db.exec(`
      -- Core filtering indexes
      CREATE INDEX IF NOT EXISTS idx_type_source ON objects(type, source);
      CREATE INDEX IF NOT EXISTS idx_type_polygon ON objects(type, is_polygon);
      
      -- Ski area assignment queries
      CREATE INDEX IF NOT EXISTS idx_ski_areas ON objects(ski_areas);
      CREATE INDEX IF NOT EXISTS idx_type_ski_areas ON objects(type, ski_areas);
      
      -- Unassigned object queries (critical for clustering performance)
      CREATE INDEX IF NOT EXISTS idx_type_basis ON objects(type, is_basis_for_new_ski_area) 
        WHERE is_basis_for_new_ski_area = 1;
      CREATE INDEX IF NOT EXISTS idx_unassigned_runs ON objects(type, is_basis_for_new_ski_area) 
        WHERE type = 'RUN' AND is_basis_for_new_ski_area = 1;
      
      -- Source-specific queries with polygon filtering
      CREATE INDEX IF NOT EXISTS idx_source_polygon ON objects(source, is_polygon) 
        WHERE is_polygon = 1;
      CREATE INDEX IF NOT EXISTS idx_source_type_polygon ON objects(source, type, is_polygon);
      
      -- Activity-based filtering (for spatial searches)
      CREATE INDEX IF NOT EXISTS idx_activities ON objects(activities);
      CREATE INDEX IF NOT EXISTS idx_type_activities ON objects(type, activities);
      
      -- Polygon containment queries
      CREATE INDEX IF NOT EXISTS idx_polygon_filter ON objects(is_polygon, is_in_ski_area_polygon);
    `);
    console.log("✅ Created optimized composite indexes");
  }

  async saveObject(object: MapObject): Promise<void> {
    this.ensureInitialized();

    if (!this.spatialLiteEnabled) {
      throw new Error("Cannot save objects without SpatialLite extension");
    }

    const stmt = this.getStatement(SQLiteClusteringDatabase.INSERT_OBJECT_SQL);
    const params = this.mapObjectToSQLParams(object);
    stmt.run(...params);
  }

  async saveObjects(objects: MapObject[]): Promise<void> {
    this.ensureInitialized();

    if (!this.spatialLiteEnabled) {
      throw new Error("Cannot save objects without SpatialLite extension");
    }

    // Process in optimized batches for very large datasets
    await this.processBatches(
      objects,
      SQLiteClusteringDatabase.BULK_OPERATION_BATCH_SIZE,
      (batch) => {
        const stmt = this.getStatement(
          SQLiteClusteringDatabase.INSERT_OBJECT_SQL,
        );

        const transaction = this.db!.transaction((objects: MapObject[]) => {
          for (const object of objects) {
            const params = this.mapObjectToSQLParams(object);
            stmt.run(...params);
          }
        });

        transaction(batch);
      },
    );
  }

  async updateObject(key: string, updates: Partial<MapObject>): Promise<void> {
    this.ensureInitialized();

    const { setParts, values } = this.buildUpdateClauses(updates);

    if (setParts.length > 0) {
      values.push(key);
      const stmt = this.getStatement(
        `UPDATE objects SET ${setParts.join(", ")} WHERE key = ?`,
      );
      stmt.run(...values);
    }
  }

  async updateObjects(
    updates: Array<{ key: string; updates: Partial<MapObject> }>,
  ): Promise<void> {
    this.ensureInitialized();

    // Process in optimized batches for very large update sets
    await this.processBatches(
      updates,
      SQLiteClusteringDatabase.BULK_OPERATION_BATCH_SIZE,
      (batch) => {
        const transaction = this.db!.transaction(
          (updates: Array<{ key: string; updates: Partial<MapObject> }>) => {
            for (const { key, updates: objectUpdates } of updates) {
              const { setParts, values } =
                this.buildUpdateClauses(objectUpdates);

              if (setParts.length > 0) {
                values.push(key);
                const stmt = this.getStatement(
                  `UPDATE objects SET ${setParts.join(", ")} WHERE key = ?`,
                );
                stmt.run(...values);
              }
            }
          },
        );

        transaction(batch);
      },
    );
  }

  async removeObject(key: string): Promise<void> {
    const db = this.ensureInitialized();

    // First check if this is a ski area that needs association cleanup
    const objectType = db
      .prepare("SELECT type FROM objects WHERE key = ?")
      .get(key) as any;

    if (objectType && objectType.type === "SKI_AREA") {
      // Clean up all associations to this ski area
      await this.cleanUpSkiAreaAssociations(key);
    }

    const stmt = this.getStatement("DELETE FROM objects WHERE key = ?");
    stmt.run(key);
  }

  private async cleanUpSkiAreaAssociations(skiAreaId: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    // Find all objects that reference this ski area
    const stmt = this.getStatement(
      `SELECT key, ski_areas FROM objects 
       WHERE EXISTS (
         SELECT 1 FROM json_each(ski_areas) 
         WHERE json_each.value = ?
       )`,
    );
    const affectedObjects = stmt.all(skiAreaId);

    const updateStmt = this.getStatement(
      "UPDATE objects SET ski_areas = ? WHERE key = ?",
    );

    const transaction = this.db.transaction((objects: any[]) => {
      for (const obj of objects) {
        try {
          const currentSkiAreas = JSON.parse(obj.ski_areas || "[]");
          const updatedSkiAreas = currentSkiAreas.filter(
            (id: string) => id !== skiAreaId,
          );
          updateStmt.run(JSON.stringify(updatedSkiAreas), obj.key);
        } catch (error) {
          console.warn(
            `Failed to clean up ski area association for object ${obj.key}:`,
            error,
          );
        }
      }
    });

    transaction(affectedObjects);
  }

  async getSkiAreas(options: GetSkiAreasOptions): Promise<SkiAreasCursor> {
    this.ensureInitialized();

    let query = "SELECT * FROM objects WHERE type = 'SKI_AREA'";
    const params: any[] = [];

    if (options.onlySource) {
      query += " AND source = ?";
      params.push(options.onlySource);
    }

    if (options.onlyPolygons) {
      query += " AND is_polygon = 1";
    }

    if (options.onlyInPolygon) {
      const polygonWKT = this.geoJSONToWKT(options.onlyInPolygon);
      query += " AND ST_Within(geom, GeomFromText(?, 4326))";
      params.push(polygonWKT);
    }

    const stmt = this.getStatement(query);
    const rows = params.length > 0 ? stmt.all(...params) : stmt.all();
    const skiAreas = rows.map(this.rowToMapObject) as SkiAreaObject[];

    return new SQLiteSkiAreasCursor(
      skiAreas,
      SQLiteClusteringDatabase.DEFAULT_BATCH_SIZE,
    );
  }

  async getSkiAreasByIds(ids: string[]): Promise<SkiAreasCursor> {
    if (!this.db) throw new Error("Database not initialized");

    const placeholders = ids.map(() => "?").join(",");
    const query = `SELECT * FROM objects WHERE type = 'SKI_AREA' AND key IN (${placeholders})`;

    const stmt = this.getStatement(query);
    const rows = stmt.all(...ids);
    const skiAreas = rows.map(this.rowToMapObject) as SkiAreaObject[];

    return new SQLiteSkiAreasCursor(
      skiAreas,
      SQLiteClusteringDatabase.DEFAULT_BATCH_SIZE,
    );
  }

  async findNearbyObjects(
    area: GeoJSON.Polygon | GeoJSON.MultiPolygon,
    context: SearchContext,
  ): Promise<MapObject[]> {
    if (!this.db) throw new Error("Database not initialized");

    if (!this.spatialLiteEnabled) {
      throw new Error(
        "Cannot perform spatial queries without SpatialLite extension",
      );
    }

    const areaWKT = this.geoJSONToWKT(area);
    let query: string;

    if (context.searchType === "contains") {
      query = `
        SELECT * FROM objects 
        WHERE ST_Within(geom, GeomFromText(?, 4326))
          AND type != 'SKI_AREA'
      `;
    } else {
      query = `
        SELECT * FROM objects 
        WHERE ST_Intersects(geom, GeomFromText(?, 4326))
          AND type != 'SKI_AREA'
      `;
    }

    const params = [areaWKT];

    if (context.activities.length > 0) {
      // Use JSON_EXTRACT to properly check if any activity in the object's activities array
      // matches any activity in the context activities array
      const activityConditions = context.activities
        .map(
          () =>
            "EXISTS (SELECT 1 FROM json_each(activities) WHERE json_each.value = ?)",
        )
        .join(" OR ");
      query += ` AND (${activityConditions})`;
      context.activities.forEach((activity) => {
        params.push(activity);
      });
    }

    // Filter out objects that already belong to this ski area
    query +=
      ` AND (NOT EXISTS (
         SELECT 1 FROM json_each(ski_areas) 
         WHERE json_each.value = ?
       ) OR ski_areas = '[]' OR ski_areas IS NULL)`;
    params.push(context.id);

    if (context.excludeObjectsAlreadyInSkiArea) {
      // Exclude objects that are already assigned to any ski area
      // Only include objects with empty ski_areas arrays or null values
      query += " AND (ski_areas = '[]' OR ski_areas IS NULL)";
    }

    if (context.alreadyVisited.length > 0) {
      const placeholders = context.alreadyVisited.map(() => "?").join(",");
      query += ` AND key NOT IN (${placeholders})`;
      params.push(...context.alreadyVisited);
    }

    const stmt = this.getStatement(query);
    const rows = stmt.all(...params);
    const allFound = rows.map(this.rowToMapObject);
    allFound.forEach((object) => context.alreadyVisited.push(object._key));
    return allFound;
  }

  async getObjectsForSkiArea(skiAreaId: string): Promise<MapObject[]> {
    if (!this.db) throw new Error("Database not initialized");

    const query =
      `SELECT * FROM objects 
       WHERE EXISTS (
         SELECT 1 FROM json_each(ski_areas) 
         WHERE json_each.value = ?
       ) AND type != 'SKI_AREA'`;
    const stmt = this.getStatement(query);
    const rows = stmt.all(skiAreaId);

    return rows.map(this.rowToMapObject);
  }

  async markObjectsAsPartOfSkiArea(
    skiAreaId: string,
    objectKeys: string[],
    isInSkiAreaPolygon: boolean,
  ): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    const getStmt = this.getStatement(
      "SELECT ski_areas, is_in_ski_area_polygon FROM objects WHERE key = ?",
    );
    const updateStmt = this.getStatement(
      `UPDATE objects 
       SET ski_areas = ?, is_in_ski_area_polygon = ?, is_basis_for_new_ski_area = 0
       WHERE key = ?`,
    );

    const transaction = this.db.transaction((objectKeys: string[]) => {
      for (const key of objectKeys) {
        // Get current ski areas and polygon status
        const row = getStmt.get(key) as any;

        if (row) {
          const currentSkiAreas = JSON.parse(row.ski_areas || "[]");

          // This prevents duplicate ski area assignments
          if (skiAreaId && !currentSkiAreas.includes(skiAreaId)) {
            currentSkiAreas.push(skiAreaId);
          }

          const updatedIsInPolygon =
            Boolean(row.is_in_ski_area_polygon) || isInSkiAreaPolygon;

          updateStmt.run(
            JSON.stringify(currentSkiAreas),
            updatedIsInPolygon ? 1 : 0,
            key,
          );
        }
      }
    });

    transaction(objectKeys);
  }

  async getNextUnassignedRun(): Promise<MapObject | null> {
    if (!this.db) throw new Error("Database not initialized");

    const query = `
      SELECT * FROM objects 
      WHERE type = 'RUN' 
        AND is_basis_for_new_ski_area = 1
      LIMIT 1
    `;

    const stmt = this.getStatement(query);
    const row = stmt.get();

    const run = row ? this.rowToMapObject(row) : null;
    if (run && run.activities.length === 0) {
      throw new Error("No activities for run");
    }
    return run;
  }

  async streamSkiAreas(): Promise<AsyncIterable<SkiAreaObject>> {
    if (!this.db) throw new Error("Database not initialized");

    const query = "SELECT * FROM objects WHERE type = 'SKI_AREA'";
    const stmt = this.db.prepare(query);
    const rows = stmt.all();

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
    if (!this.db) throw new Error("Database not initialized");

    const objectStmt = this.db.prepare(
      "SELECT ski_areas FROM objects WHERE key = ?",
    );
    const objectRow = objectStmt.get(objectId) as any;

    if (!objectRow || !objectRow.ski_areas) {
      return [];
    }

    const skiAreaIds = JSON.parse(objectRow.ski_areas).filter(
      (id: any) => id != null,
    );
    if (skiAreaIds.length === 0) {
      return [];
    }

    const placeholders = skiAreaIds.map(() => "?").join(",");
    const query = `SELECT * FROM objects WHERE type = 'SKI_AREA' AND key IN (${placeholders})`;

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...skiAreaIds);
    return rows.map(this.rowToMapObject) as SkiAreaObject[];
  }

  async getRunObjectById(runId: string): Promise<RunObject | null> {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "SELECT * FROM objects WHERE key = ? AND type = 'RUN'",
    );
    const row = stmt.get(runId);

    return row ? (this.rowToMapObject(row) as RunObject) : null;
  }

  private rowToMapObject(row: any): MapObject {
    const baseObject: any = {
      _key: row.key,
      type: row.type as MapObjectType,
      geometry: JSON.parse(row.geometry),
      activities: JSON.parse(row.activities || "[]") as SkiAreaActivity[],
      skiAreas: JSON.parse(row.ski_areas || "[]") as string[],
      source: row.source,
      isPolygon: Boolean(row.is_polygon),
      isBasisForNewSkiArea: Boolean(row.is_basis_for_new_ski_area),
      isInSkiAreaPolygon: Boolean(row.is_in_ski_area_polygon),
      properties: JSON.parse(row.properties || "{}"),
    };

    // Add type-specific fields
    if (row.type === MapObjectType.SkiArea) {
      baseObject.id = row.key;
    } else if (row.type === MapObjectType.Lift) {
      baseObject.geometryWithElevations = JSON.parse(
        row.geometry_with_elevations || row.geometry,
      );
      baseObject.liftType = row.lift_type;
      baseObject.isInSkiAreaSite = Boolean(row.is_in_ski_area_site);
    } else if (row.type === MapObjectType.Run) {
      baseObject.geometryWithElevations = JSON.parse(
        row.geometry_with_elevations || row.geometry,
      );
      baseObject.difficulty = row.difficulty;
      baseObject.viirsPixels = JSON.parse(row.viirs_pixels || "[]");
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

class SQLiteSkiAreasCursor implements SkiAreasCursor {
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
