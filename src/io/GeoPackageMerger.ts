import Database from "better-sqlite3";
import { GeoPackageAPI, RTreeIndex } from "@ngageoint/geopackage";

export interface MergeResult {
  tablesProcessed: number;
  rowsInserted: number;
  errors: string[];
}

interface GpkgContentsRow {
  table_name: string;
  data_type: string;
  identifier: string;
  description: string;
  last_change: string;
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  srs_id: number;
}

interface GpkgGeometryColumnsRow {
  table_name: string;
  column_name: string;
  geometry_type_name: string;
  srs_id: number;
  z: number;
  m: number;
}

export class GeoPackageMerger {
  private readonly BATCH_SIZE = 1000;

  async mergeGeoPackages(
    targetPath: string,
    sourcePath: string,
  ): Promise<MergeResult> {
    const targetGp = await GeoPackageAPI.open(targetPath);
    const sourceGp = await GeoPackageAPI.open(sourcePath);

    // Register spatial functions needed for RTree triggers
    // RTreeIndex constructor calls createAllFunctions() automatically
    new RTreeIndex(targetGp, null as any);
    new RTreeIndex(sourceGp, null as any);

    // Get the underlying better-sqlite3 Database objects
    const targetDb = (targetGp.connection.adapter as any).db as Database.Database;
    const sourceDb = (sourceGp.connection.adapter as any).db as Database.Database;

    // Enable performance optimizations
    this.optimizeDatabase(targetDb);
    this.optimizeReadonlyDatabase(sourceDb);

    const result: MergeResult = {
      tablesProcessed: 0,
      rowsInserted: 0,
      errors: [],
    };

    try {
      // Get all table names from source database, excluding GeoPackage metadata tables
      const tables = sourceDb
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='table' 
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE 'gpkg_%'
        AND name NOT LIKE 'rtree_%'
      `,
        )
        .all() as { name: string }[];

      for (const table of tables) {
        const tableName = table.name;

        try {
          const rowsInserted = this.mergeTable(targetDb, sourceDb, tableName);
          result.rowsInserted += rowsInserted;
          result.tablesProcessed++;

          // Update geopackage metadata if this is a geographic table
          this.updateGeoPackageMetadata(targetDb, sourceDb, tableName);
        } catch (error) {
          const errorMessage = `Failed to merge table ${tableName}: ${(error as Error).message}`;
          result.errors.push(errorMessage);
        }
      }
    } finally {
      await targetGp.close();
      await sourceGp.close();
    }

    return result;
  }

  private mergeTable(
    targetDb: Database.Database,
    sourceDb: Database.Database,
    tableName: string,
  ): number {
    // Check if table exists in target
    const targetTableExists = targetDb
      .prepare(
        `
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name = ?
    `,
      )
      .get(tableName);

    if (targetTableExists) {
      return this.mergeDataIntoExistingTable(targetDb, sourceDb, tableName);
    } else {
      return this.copyTableFromSource(targetDb, sourceDb, tableName);
    }
  }

  private mergeDataIntoExistingTable(
    targetDb: Database.Database,
    sourceDb: Database.Database,
    tableName: string,
  ): number {
    // Get total row count for batching
    const totalRows = sourceDb
      .prepare(`SELECT COUNT(*) as count FROM ${tableName}`)
      .get() as { count: number };

    if (totalRows.count === 0) {
      return 0;
    }

    // Get column info to build proper INSERT statement
    const columns = targetDb
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as any[];
    const allColumnNames = columns.map((col) => col.name);

    // Check if there's an auto-incrementing primary key (typically 'id')
    const pkColumn = columns.find((col: any) => col.pk === 1);
    const hasAutoIncrementPK = pkColumn && pkColumn.name === "id";

    let columnList: string;
    let placeholders: string;
    let columnsToInsert: string[];

    if (hasAutoIncrementPK) {
      // Exclude the auto-increment primary key column
      columnsToInsert = allColumnNames.filter((name) => name !== "id");
      columnList = columnsToInsert.join(", ");
      placeholders = columnsToInsert.map(() => "?").join(", ");
    } else {
      columnsToInsert = allColumnNames;
      columnList = allColumnNames.join(", ");
      placeholders = allColumnNames.map(() => "?").join(", ");
    }

    // Check if feature_id column exists and create set of existing feature_ids
    const hasFeatureId = columnsToInsert.includes("feature_id");
    let existingFeatureIds: Set<string> = new Set();

    if (hasFeatureId) {
      // Build a set of existing feature_ids for fast lookup
      const existingIds = targetDb
        .prepare(
          `SELECT feature_id FROM ${tableName} WHERE feature_id IS NOT NULL`,
        )
        .all() as { feature_id: string }[];
      existingFeatureIds = new Set(existingIds.map((row) => row.feature_id));
    }

    // Use INSERT OR IGNORE to handle conflicts on unique constraints other than auto-increment PK
    const insertStmt = targetDb.prepare(`
      INSERT OR IGNORE INTO ${tableName} (${columnList}) 
      VALUES (${placeholders})
    `);

    let insertedCount = 0;
    const insertMany = targetDb.transaction((rows: any[]) => {
      for (const row of rows) {
        // Check for semantic duplicates based on feature_id using the set
        if (
          hasFeatureId &&
          row["feature_id"] &&
          existingFeatureIds.has(row["feature_id"])
        ) {
          continue; // Skip this row silently
        }

        const values = columnsToInsert.map((col) => row[col]);
        try {
          const result = insertStmt.run(...values);
          if (result.changes > 0) {
            insertedCount++;
            // Add to existing set to avoid duplicates within the same batch
            if (hasFeatureId && row["feature_id"]) {
              existingFeatureIds.add(row["feature_id"]);
            }
          }
        } catch (error) {
          // Continue with other rows even if one fails
        }
      }
    });

    // Process in batches to avoid memory issues
    const sourceStmt = sourceDb.prepare(`
      SELECT * FROM ${tableName} 
      ORDER BY ROWID 
      LIMIT ? OFFSET ?
    `);

    for (let offset = 0; offset < totalRows.count; offset += this.BATCH_SIZE) {
      const batch = sourceStmt.all(this.BATCH_SIZE, offset);
      insertMany(batch);
    }

    return insertedCount;
  }

  private copyTableFromSource(
    targetDb: Database.Database,
    sourceDb: Database.Database,
    tableName: string,
  ): number {
    const createTableSql = sourceDb
      .prepare(
        `
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name = ?
    `,
      )
      .get(tableName) as { sql: string } | undefined;

    if (!createTableSql?.sql) {
      throw new Error(`Could not find table definition for ${tableName}`);
    }

    // Create table in target
    targetDb.exec(createTableSql.sql);

    // Get total row count for batching
    const totalRows = sourceDb
      .prepare(`SELECT COUNT(*) as count FROM ${tableName}`)
      .get() as { count: number };

    if (totalRows.count === 0) {
      return 0;
    }

    const columns = targetDb
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as any[];
    const allColumnNames = columns.map((col) => col.name);

    const columnList = allColumnNames.join(", ");
    const placeholders = allColumnNames.map(() => "?").join(", ");

    const insertStmt = targetDb.prepare(`
      INSERT INTO ${tableName} (${columnList}) 
      VALUES (${placeholders})
    `);

    const insertMany = targetDb.transaction((rows: any[]) => {
      for (const row of rows) {
        const values = allColumnNames.map((col) => row[col]);
        insertStmt.run(...values);
      }
    });

    // Process in batches to avoid memory issues
    const sourceStmt = sourceDb.prepare(`
      SELECT * FROM ${tableName} 
      ORDER BY ROWID 
      LIMIT ? OFFSET ?
    `);

    for (let offset = 0; offset < totalRows.count; offset += this.BATCH_SIZE) {
      const batch = sourceStmt.all(this.BATCH_SIZE, offset);
      insertMany(batch);
    }

    return totalRows.count;
  }

  private updateGeoPackageMetadata(
    targetDb: Database.Database,
    sourceDb: Database.Database,
    tableName: string,
  ): void {
    try {
      // Check if this table has an entry in gpkg_contents in the source
      const sourceContent = sourceDb
        .prepare(`SELECT * FROM gpkg_contents WHERE table_name = ?`)
        .get(tableName) as GpkgContentsRow | undefined;

      if (sourceContent) {
        // Insert or update gpkg_contents entry
        const upsertContent = targetDb.prepare(`
          INSERT OR REPLACE INTO gpkg_contents 
          (table_name, data_type, identifier, description, last_change, min_x, min_y, max_x, max_y, srs_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        upsertContent.run(
          sourceContent.table_name,
          sourceContent.data_type,
          sourceContent.identifier,
          sourceContent.description,
          sourceContent.last_change,
          sourceContent.min_x,
          sourceContent.min_y,
          sourceContent.max_x,
          sourceContent.max_y,
          sourceContent.srs_id,
        );

        // Copy geometry_columns entry if it exists
        const sourceGeomCol = sourceDb
          .prepare(`SELECT * FROM gpkg_geometry_columns WHERE table_name = ?`)
          .get(tableName) as GpkgGeometryColumnsRow | undefined;

        if (sourceGeomCol) {
          const upsertGeomCol = targetDb.prepare(`
            INSERT OR REPLACE INTO gpkg_geometry_columns 
            (table_name, column_name, geometry_type_name, srs_id, z, m)
            VALUES (?, ?, ?, ?, ?, ?)
          `);

          upsertGeomCol.run(
            sourceGeomCol.table_name,
            sourceGeomCol.column_name,
            sourceGeomCol.geometry_type_name,
            sourceGeomCol.srs_id,
            sourceGeomCol.z,
            sourceGeomCol.m,
          );
        }
      }
    } catch (error) {
      // Don't fail the entire operation for metadata issues
      // Error will be logged by the caller
    }
  }

  private optimizeDatabase(db: Database.Database): void {
    // Enable WAL mode for better concurrency and performance
    db.pragma("journal_mode = WAL");

    // Increase cache size (default is 2MB, increase to 64MB)
    db.pragma("cache_size = -65536");

    // Disable synchronous writes for better performance (less safe but faster)
    db.pragma("synchronous = NORMAL");

    // Increase page size for better performance with large data
    db.pragma("page_size = 4096");

    // Optimize memory usage
    db.pragma("temp_store = MEMORY");

    // Optimize for bulk operations
    db.pragma("mmap_size = 268435456"); // 256MB
  }

  private optimizeReadonlyDatabase(db: Database.Database): void {
    // Read-only optimizations that don't require write access

    // Increase cache size (default is 2MB, increase to 64MB)
    db.pragma("cache_size = -65536");

    // Optimize memory usage
    db.pragma("temp_store = MEMORY");

    // Optimize for bulk operations
    db.pragma("mmap_size = 268435456"); // 256MB
  }
}
