import Database from "better-sqlite3";
import fs, { createReadStream, createWriteStream } from "fs";
import path from "path";
import { createInterface } from "readline";
import { runCommand } from "../utils/ProcessRunner";

interface MergeStats {
  geoJsonFiles: number;
  csvFiles: number;
  gpkgFiles: number;
  mbtilesFiles: number;
}

const SPECIFIC_FILES = {
  geojson: ["ski_areas.geojson", "lifts.geojson", "runs.geojson"],
  mbtiles: ["openskimap.mbtiles"],
  gpkg: ["openskidata.gpkg"],
  csv: ["csv/lifts.csv", "csv/runs.csv", "csv/ski_areas.csv"],
};

function mergeGeoPackageWithSQLite(
  targetPath: string,
  sourcePath: string,
): void {
  const targetDb = new Database(targetPath);
  const sourceDb = new Database(sourcePath, { readonly: true });

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

    console.log(`  Found ${tables.length} data tables to merge (excluding metadata)`);

    for (const table of tables) {
      const tableName = table.name;
      console.log(`  Merging data table: ${tableName}`);

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
        // Table exists - merge data using INSERT OR IGNORE to handle duplicates
        try {
          const sourceRows = sourceDb
            .prepare(`SELECT * FROM ${tableName}`)
            .all();

          if (sourceRows.length > 0) {
            console.log(`    Inserting ${sourceRows.length} rows into existing table`);
            
            // Get column info to build proper INSERT statement
            const columns = targetDb
              .prepare(`PRAGMA table_info(${tableName})`)
              .all() as any[];
            const allColumnNames = columns.map((col) => col.name);
            
            const columnList = allColumnNames.join(", ");
            const placeholders = allColumnNames.map(() => "?").join(", ");

            // Use INSERT OR IGNORE to handle primary key conflicts gracefully
            const insertStmt = targetDb.prepare(`
              INSERT OR IGNORE INTO ${tableName} (${columnList}) 
              VALUES (${placeholders})
            `);

            const insertMany = targetDb.transaction((rows: any[]) => {
              for (const row of rows) {
                const values = allColumnNames.map((col) => row[col]);
                insertStmt.run(...values);
              }
            });

            insertMany(sourceRows);
          }
        } catch (error) {
          console.warn(`    Warning: Could not merge data into ${tableName}:`, (error as Error).message);
          // Continue with other tables rather than failing completely
        }
      } else {
        // Table doesn't exist - copy entire table structure and data
        try {
          const createTableSql = sourceDb
            .prepare(
              `
            SELECT sql FROM sqlite_master 
            WHERE type='table' AND name = ?
          `,
            )
            .get(tableName) as { sql: string } | undefined;

          if (createTableSql?.sql) {
            console.log(`    Creating new table: ${tableName}`);
            // Create table in target
            targetDb.exec(createTableSql.sql);

            // Copy all data
            const sourceRows = sourceDb
              .prepare(`SELECT * FROM ${tableName}`)
              .all();

            if (sourceRows.length > 0) {
              console.log(`    Copying ${sourceRows.length} rows to new table`);
              
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
            }

            // Update gpkg_contents if this table contains geographic data
            updateGeoPackageMetadata(targetDb, sourceDb, tableName);
          }
        } catch (error) {
          console.warn(`    Warning: Could not create table ${tableName}:`, (error as Error).message);
        }
      }
    }
  } finally {
    targetDb.close();
    sourceDb.close();
  }
}

function updateGeoPackageMetadata(
  targetDb: any,
  sourceDb: any,
  tableName: string,
): void {
  try {
    // Check if this table has an entry in gpkg_contents in the source
    const sourceContent = sourceDb
      .prepare(`SELECT * FROM gpkg_contents WHERE table_name = ?`)
      .get(tableName);

    if (sourceContent) {
      console.log(`    Updating GeoPackage metadata for ${tableName}`);
      
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
        .get(tableName);

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
    console.warn(`    Warning: Could not update metadata for ${tableName}:`, (error as Error).message);
    // Don't fail the entire operation for metadata issues
  }
}

function printUsage(): void {
  console.log(
    "Usage: merge_outputs <output_dir> <input_dir1> [input_dir2] ...",
  );
  console.log("");
  console.log("Merges multiple output data directories into a new directory.");
  console.log("Merges these specific files:");
  console.log("  - ski_areas.geojson, lifts.geojson, runs.geojson");
  console.log("  - openskimap.mbtiles");
  console.log("  - openskidata.gpkg");
  console.log("  - csv/lifts.csv, csv/runs.csv, csv/ski_areas.csv");
}

function validateArguments(): { outputDir: string; inputDirs: string[] } {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    printUsage();
    process.exit(1);
  }

  const outputDir = args[0];
  const inputDirs = args.slice(1);

  // Validate all input directories exist
  for (const inputDir of inputDirs) {
    if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
      console.error(`Input directory does not exist: ${inputDir}`);
      process.exit(1);
    }
  }

  return { outputDir, inputDirs };
}

function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function findSpecificFiles(dir: string, fileList: string[]): string[] {
  const foundFiles: string[] = [];

  for (const fileName of fileList) {
    const fullPath = path.join(dir, fileName);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      foundFiles.push(fullPath);
    }
  }

  return foundFiles;
}

async function mergeGeoJsonFiles(
  inputDirs: string[],
  outputDir: string,
): Promise<number> {
  const processedFiles = new Set<string>();
  let mergeCount = 0;

  try {
    for (const inputDir of inputDirs) {
      console.log(`\nProcessing input directory: ${inputDir}`);
      const geoJsonFiles = findSpecificFiles(inputDir, SPECIFIC_FILES.geojson);
      console.log(`Found ${geoJsonFiles.length} GeoJSON files in ${inputDir}`);

      for (const inputPath of geoJsonFiles) {
        const relativePath = path.relative(inputDir, inputPath);
        const outputPath = path.join(outputDir, relativePath);

        console.log(
          `Processing GeoJSON: ${relativePath} (${fs.statSync(inputPath).size} bytes)`,
        );

        ensureDirectoryExists(path.dirname(outputPath));

        if (!processedFiles.has(relativePath)) {
          // First file for this path - create new FeatureCollection
          console.log(`Creating new output file: ${outputPath}`);
          fs.writeFileSync(
            outputPath,
            '{"type": "FeatureCollection", "features":[\n',
          );
          processedFiles.add(relativePath);
          mergeCount++;
        } else {
          console.log(`Appending to existing output file: ${outputPath}`);
        }

        // Stream the input file line by line
        try {
          await streamGeoJsonFeatures(inputPath, outputPath);
          console.log(`✓ Successfully processed: ${relativePath}`);
        } catch (error) {
          console.error(`✗ Failed to process: ${relativePath}`, error);
          throw error;
        }
      }
    }

    // Finalize all GeoJSON files by removing the trailing comma and adding closing
    console.log(`\nFinalizing ${processedFiles.size} GeoJSON files...`);
    for (const relativePath of processedFiles) {
      const outputPath = path.join(outputDir, relativePath);
      console.log(`Finalizing: ${relativePath}`);

      try {
        await finalizeGeoJsonFile(outputPath);
        console.log(`✓ Successfully finalized: ${relativePath}`);
      } catch (error) {
        console.error(`✗ Failed to finalize: ${relativePath}`, error);
        throw error;
      }
    }
  } catch (error) {
    console.error("Error in mergeGeoJsonFiles:", error);
    throw error;
  }

  return mergeCount;
}

async function streamGeoJsonFeatures(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const readStream = createReadStream(inputPath, { encoding: "utf8" });
    const writeStream = createWriteStream(outputPath, { flags: "a" });
    const rl = createInterface({
      input: readStream,
      crlfDelay: Infinity,
    });

    let lineNumber = 0;
    const featureLines: string[] = [];
    let isFirstLine = true;
    let isProcessing = true;

    const cleanup = () => {
      try {
        rl.close();
        readStream.destroy();
        if (!writeStream.destroyed) {
          writeStream.end();
        }
      } catch (err) {
        // Ignore cleanup errors
      }
    };

    const handleError = (error: Error) => {
      console.error(`Error processing ${inputPath}:`, error);
      cleanup();
      reject(error);
    };

    let pendingWrites = 0;
    const writeBatch = (content: string) => {
      pendingWrites++;
      writeStream.write(content, (err) => {
        pendingWrites--;
        if (err) {
          handleError(err);
          return;
        }

        // If this was the last write and we're done processing, resolve
        if (pendingWrites === 0 && !isProcessing) {
          writeStream.end(() => {
            resolve();
          });
        }
      });
    };

    rl.on("line", (line) => {
      try {
        lineNumber++;

        // Skip the first line (header: {"type": "FeatureCollection", "features":[)
        // and detect the last line (closing: ]})
        if (isFirstLine) {
          isFirstLine = false;
          return;
        }

        // Check if this is the last line (closing bracket)
        const trimmedLine = line.trim();
        if (trimmedLine === "]}" || trimmedLine === "]}") {
          return;
        }

        // This is a feature line - add it to the batch
        featureLines.push(line);

        // Write in batches to avoid memory buildup
        if (featureLines.length >= 1000) {
          const batchContent = featureLines.join("\n") + ",\n";
          featureLines.length = 0;
          writeBatch(batchContent);
        }
      } catch (error) {
        handleError(error as Error);
      }
    });

    rl.on("close", () => {
      try {
        isProcessing = false;

        // Write remaining features
        if (featureLines.length > 0) {
          const finalContent = featureLines.join("\n") + ",\n";
          writeBatch(finalContent);
        } else if (pendingWrites === 0) {
          // No pending writes and no remaining features
          writeStream.end(() => {
            resolve();
          });
        }
      } catch (error) {
        handleError(error as Error);
      }
    });

    rl.on("error", handleError);
    readStream.on("error", handleError);
    writeStream.on("error", handleError);

    // Set a timeout to prevent hanging
    setTimeout(() => {
      if (isProcessing) {
        handleError(new Error(`Timeout processing file: ${inputPath}`));
      }
    }, 300000); // 5 minute timeout
  });
}

async function finalizeGeoJsonFile(outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tempPath = outputPath + ".tmp";
    let readStream: fs.ReadStream | null = null;
    let writeStream: fs.WriteStream | null = null;

    const cleanup = () => {
      try {
        if (readStream && !readStream.destroyed) {
          readStream.destroy();
        }
        if (writeStream && !writeStream.destroyed) {
          writeStream.destroy();
        }
        // Clean up temp file if it exists
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (err) {
        // Ignore cleanup errors
      }
    };

    const handleError = (error: Error) => {
      console.error(`Error finalizing ${outputPath}:`, error);
      cleanup();
      reject(error);
    };

    try {
      readStream = createReadStream(outputPath, { encoding: "utf8" });
      writeStream = createWriteStream(tempPath, { encoding: "utf8" });

      let buffer = "";

      readStream.on("data", (chunk: string | Buffer) => {
        try {
          const chunkStr = chunk.toString();
          buffer += chunkStr;

          // If buffer is getting large, write most of it but keep the end
          if (buffer.length > 10000) {
            const keepSize = 200; // Keep more to be safe
            const writeSize = buffer.length - keepSize;
            const toWrite = buffer.slice(0, writeSize);
            buffer = buffer.slice(writeSize);

            writeStream!.write(toWrite, (err) => {
              if (err) {
                handleError(err);
              }
            });
          }
        } catch (error) {
          handleError(error as Error);
        }
      });

      readStream.on("end", () => {
        try {
          // Remove trailing comma and newline, then add proper closing
          let finalContent = buffer.replace(/,\s*$/, "");
          finalContent += "\n]}\n";

          writeStream!.write(finalContent, (err) => {
            if (err) {
              handleError(err);
              return;
            }

            writeStream!.end();
          });
        } catch (error) {
          handleError(error as Error);
        }
      });

      writeStream.on("finish", () => {
        try {
          // Replace original with finalized version
          fs.renameSync(tempPath, outputPath);
          resolve();
        } catch (error) {
          handleError(error as Error);
        }
      });

      readStream.on("error", handleError);
      writeStream.on("error", handleError);

      // Set a timeout for finalization
      setTimeout(() => {
        handleError(new Error(`Timeout finalizing file: ${outputPath}`));
      }, 180000); // 3 minute timeout
    } catch (error) {
      handleError(error as Error);
    }
  });
}

async function mergeCsvFiles(
  inputDirs: string[],
  outputDir: string,
): Promise<number> {
  const processedFiles = new Set<string>();
  let mergeCount = 0;

  for (const inputDir of inputDirs) {
    const csvFiles = findSpecificFiles(inputDir, SPECIFIC_FILES.csv);

    for (const inputPath of csvFiles) {
      const relativePath = path.relative(inputDir, inputPath);
      const outputPath = path.join(outputDir, relativePath);

      console.log(`Processing CSV: ${relativePath}`);

      ensureDirectoryExists(path.dirname(outputPath));

      if (!processedFiles.has(relativePath)) {
        // First file for this path - copy header
        const lines = fs.readFileSync(inputPath, "utf8").split("\n");
        const header = lines[0];
        const content = lines.slice(1).join("\n");

        fs.writeFileSync(outputPath, header + "\n");
        if (content.trim()) {
          fs.appendFileSync(outputPath, content);
        }

        processedFiles.add(relativePath);
        mergeCount++;
      } else {
        // Subsequent files - skip header
        const lines = fs.readFileSync(inputPath, "utf8").split("\n");
        const content = lines.slice(1).join("\n");

        if (content.trim()) {
          fs.appendFileSync(outputPath, content);
        }
      }
    }
  }

  return mergeCount;
}

async function mergeGpkgFiles(
  inputDirs: string[],
  outputDir: string,
): Promise<number> {
  const processedFiles = new Set<string>();
  let mergeCount = 0;

  for (const inputDir of inputDirs) {
    const gpkgFiles = findSpecificFiles(inputDir, SPECIFIC_FILES.gpkg);

    for (const inputPath of gpkgFiles) {
      const relativePath = path.relative(inputDir, inputPath);
      const outputPath = path.join(outputDir, relativePath);

      console.log(`Processing GeoPackage: ${relativePath}`);

      ensureDirectoryExists(path.dirname(outputPath));

      if (!processedFiles.has(relativePath)) {
        // First file for this path - copy as base
        fs.copyFileSync(inputPath, outputPath);
        processedFiles.add(relativePath);
        mergeCount++;
      } else {
        // Subsequent files - merge using SQLite directly
        try {
          mergeGeoPackageWithSQLite(outputPath, inputPath);
        } catch (error) {
          console.error(`Failed to merge GeoPackage from ${inputPath}:`, error);
          throw error;
        }
      }
    }
  }

  return mergeCount;
}

async function mergeMbtilesFiles(
  inputDirs: string[],
  outputDir: string,
): Promise<number> {
  const processedFiles = new Set<string>();
  let mergeCount = 0;

  for (const inputDir of inputDirs) {
    const mbtilesFiles = findSpecificFiles(inputDir, SPECIFIC_FILES.mbtiles);

    for (const inputPath of mbtilesFiles) {
      const relativePath = path.relative(inputDir, inputPath);
      const outputPath = path.join(outputDir, relativePath);

      console.log(`Processing MBTiles: ${relativePath}`);

      ensureDirectoryExists(path.dirname(outputPath));

      if (!processedFiles.has(relativePath)) {
        // First file for this path - copy as base
        fs.copyFileSync(inputPath, outputPath);
        processedFiles.add(relativePath);
        mergeCount++;
      } else {
        // Subsequent files - merge using tile-join
        try {
          const tempOutput = outputPath + ".tmp";

          await runCommand("tile-join", [
            "-f",
            "--no-tile-size-limit",
            "-o",
            tempOutput,
            outputPath,
            inputPath,
          ]);

          // Replace original with merged version
          fs.renameSync(tempOutput, outputPath);
        } catch (error) {
          console.error(`Failed to merge MBTiles from ${inputPath}:`, error);
          throw error;
        }
      }
    }
  }

  return mergeCount;
}

async function main(): Promise<void> {
  try {
    const { outputDir, inputDirs } = validateArguments();

    console.log(`Merging ${inputDirs.length} directories into: ${outputDir}`);

    ensureDirectoryExists(outputDir);

    const stats: MergeStats = {
      geoJsonFiles: 0,
      csvFiles: 0,
      gpkgFiles: 0,
      mbtilesFiles: 0,
    };

    // Merge each file type
    console.log("\n=== Merging GeoJSON files ===");
    stats.geoJsonFiles = await mergeGeoJsonFiles(inputDirs, outputDir);

    console.log("\n=== Merging CSV files ===");
    stats.csvFiles = await mergeCsvFiles(inputDirs, outputDir);

    console.log("\n=== Merging GeoPackage files ===");
    stats.gpkgFiles = await mergeGpkgFiles(inputDirs, outputDir);

    console.log("\n=== Merging MBTiles files ===");
    stats.mbtilesFiles = await mergeMbtilesFiles(inputDirs, outputDir);

    console.log("\n=== Merge Complete ===");
    console.log(`Successfully merged:`);
    console.log(`  - ${stats.geoJsonFiles} GeoJSON files`);
    console.log(`  - ${stats.csvFiles} CSV files`);
    console.log(`  - ${stats.gpkgFiles} GeoPackage files`);
    console.log(`  - ${stats.mbtilesFiles} MBTiles files`);
    console.log(`Output directory: ${outputDir}`);
  } catch (error) {
    console.error("Merge failed:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
