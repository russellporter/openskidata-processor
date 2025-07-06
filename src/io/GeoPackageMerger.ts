import Database from "better-sqlite3";

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
  mergeGeoPackages(targetPath: string, sourcePath: string): MergeResult {
    const targetDb = new Database(targetPath);
    const sourceDb = new Database(sourcePath, { readonly: true });
    
    const result: MergeResult = {
      tablesProcessed: 0,
      rowsInserted: 0,
      errors: []
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
      targetDb.close();
      sourceDb.close();
    }

    return result;
  }

  private mergeTable(targetDb: Database.Database, sourceDb: Database.Database, tableName: string): number {
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

  private mergeDataIntoExistingTable(targetDb: Database.Database, sourceDb: Database.Database, tableName: string): number {
    const sourceRows = sourceDb
      .prepare(`SELECT * FROM ${tableName}`)
      .all();

    if (sourceRows.length === 0) {
      return 0;
    }

    // Get column info to build proper INSERT statement
    const columns = targetDb
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as any[];
    const allColumnNames = columns.map((col) => col.name);
    
    // Check if there's an auto-incrementing primary key (typically 'id')
    const pkColumn = columns.find((col: any) => col.pk === 1);
    const hasAutoIncrementPK = pkColumn && pkColumn.name === 'id';
    
    let columnList: string;
    let placeholders: string;
    let columnsToInsert: string[];
    
    if (hasAutoIncrementPK) {
      // Exclude the auto-increment primary key column
      columnsToInsert = allColumnNames.filter(name => name !== 'id');
      columnList = columnsToInsert.join(", ");
      placeholders = columnsToInsert.map(() => "?").join(", ");
    } else {
      columnsToInsert = allColumnNames;
      columnList = allColumnNames.join(", ");
      placeholders = allColumnNames.map(() => "?").join(", ");
    }

    // Check if feature_id column exists and add duplicate detection
    const hasFeatureId = columnsToInsert.includes('feature_id');
    
    // Use INSERT OR IGNORE to handle conflicts on unique constraints other than auto-increment PK
    const insertStmt = targetDb.prepare(`
      INSERT OR IGNORE INTO ${tableName} (${columnList}) 
      VALUES (${placeholders})
    `);

    let insertedCount = 0;
    const insertMany = targetDb.transaction((rows: any[]) => {
      for (const row of rows) {
        // Check for semantic duplicates based on feature_id before attempting insert
        if (hasFeatureId && row['feature_id']) {
          const featureId = row['feature_id'];
          const existing = targetDb.prepare(`SELECT COUNT(*) as count FROM ${tableName} WHERE feature_id = ?`).get(featureId) as { count: number };
          if (existing.count > 0) {
            continue; // Skip this row silently
          }
        }
        
        const values = columnsToInsert.map((col) => row[col]);
        try {
          const result = insertStmt.run(...values);
          if (result.changes > 0) {
            insertedCount++;
          }
        } catch (error) {
          // Continue with other rows even if one fails
        }
      }
    });

    insertMany(sourceRows);
    return insertedCount;
  }

  private copyTableFromSource(targetDb: Database.Database, sourceDb: Database.Database, tableName: string): number {
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

    // Copy all data
    const sourceRows = sourceDb
      .prepare(`SELECT * FROM ${tableName}`)
      .all();

    if (sourceRows.length === 0) {
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

    insertMany(sourceRows);
    return sourceRows.length;
  }

  private updateGeoPackageMetadata(targetDb: Database.Database, sourceDb: Database.Database, tableName: string): void {
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
          sourceContent.srs_id
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
            sourceGeomCol.m
          );
        }
      }
    } catch (error) {
      // Don't fail the entire operation for metadata issues
      // Error will be logged by the caller
    }
  }
}