import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { runCommand } from "../utils/ProcessRunner";
import Database from "better-sqlite3";
import { createReadStream, createWriteStream } from "fs";
import { createInterface } from "readline";

interface MergeStats {
  geoJsonFiles: number;
  csvFiles: number;
  gpkgFiles: number;
  mbtilesFiles: number;
}

const SPECIFIC_FILES = {
  geojson: ['ski_areas.geojson', 'lifts.geojson', 'runs.geojson'],
  mbtiles: ['openskimap.mbtiles'],
  gpkg: ['openskidata.gpkg'],
  csv: ['csv/lifts.csv', 'csv/runs.csv', 'csv/ski_areas.csv']
};

function getCommandOutput(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(' ')}\nstderr: ${stderr}`));
      }
    });
    
    process.on('error', (error) => {
      reject(new Error(`Failed to start command "${command}": ${error.message}`));
    });
  });
}

function mergeGeoPackageWithSQLite(targetPath: string, sourcePath: string): void {
  const targetDb = new Database(targetPath);
  const sourceDb = new Database(sourcePath, { readonly: true });
  
  try {
    // Get all table names from source database
    const tables = sourceDb.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all() as { name: string }[];
    
    for (const table of tables) {
      const tableName = table.name;
      console.log(`  Merging table: ${tableName}`);
      
      // Check if table exists in target
      const targetTableExists = targetDb.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name = ?
      `).get(tableName);
      
      if (targetTableExists) {
        // Table exists - get column info and insert data
        const sourceColumns = sourceDb.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
        const columnNames = sourceColumns
          .filter(col => col.pk === 0) // Exclude primary key columns to avoid conflicts
          .map(col => col.name);
        
        if (columnNames.length > 0) {
          const columnList = columnNames.join(', ');
          const placeholders = columnNames.map(() => '?').join(', ');
          
          // Prepare insert statement for target
          const insertStmt = targetDb.prepare(`
            INSERT INTO ${tableName} (${columnList}) 
            VALUES (${placeholders})
          `);
          
          // Get all rows from source table
          const sourceRows = sourceDb.prepare(`SELECT ${columnList} FROM ${tableName}`).all();
          
          // Insert each row into target
          const insertMany = targetDb.transaction((rows: any[]) => {
            for (const row of rows) {
              const values = columnNames.map(col => row[col]);
              insertStmt.run(...values);
            }
          });
          
          insertMany(sourceRows);
        }
      } else {
        // Table doesn't exist - copy entire table structure and data
        // Get CREATE TABLE statement from source
        const createTableSql = sourceDb.prepare(`
          SELECT sql FROM sqlite_master 
          WHERE type='table' AND name = ?
        `).get(tableName) as { sql: string } | undefined;
        
        if (createTableSql?.sql) {
          // Create table in target
          targetDb.exec(createTableSql.sql);
          
          // Copy all data
          const sourceRows = sourceDb.prepare(`SELECT * FROM ${tableName}`).all();
          
          if (sourceRows.length > 0) {
            // Get column names for the new table
            const columns = targetDb.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
            const allColumnNames = columns.map(col => col.name);
            const nonPkColumns = columns.filter(col => col.pk === 0).map(col => col.name);
            
            const columnList = nonPkColumns.join(', ');
            const placeholders = nonPkColumns.map(() => '?').join(', ');
            
            const insertStmt = targetDb.prepare(`
              INSERT INTO ${tableName} (${columnList}) 
              VALUES (${placeholders})
            `);
            
            const insertMany = targetDb.transaction((rows: any[]) => {
              for (const row of rows) {
                const values = nonPkColumns.map(col => row[col]);
                insertStmt.run(...values);
              }
            });
            
            insertMany(sourceRows);
          }
        }
      }
    }
  } finally {
    targetDb.close();
    sourceDb.close();
  }
}


function printUsage(): void {
  console.log("Usage: merge_outputs <output_dir> <input_dir1> [input_dir2] ...");
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

async function mergeGeoJsonFiles(inputDirs: string[], outputDir: string): Promise<number> {
  const processedFiles = new Set<string>();
  let mergeCount = 0;

  for (const inputDir of inputDirs) {
    const geoJsonFiles = findSpecificFiles(inputDir, SPECIFIC_FILES.geojson);
    
    for (const inputPath of geoJsonFiles) {
      const relativePath = path.relative(inputDir, inputPath);
      const outputPath = path.join(outputDir, relativePath);
      
      console.log(`Processing GeoJSON: ${relativePath}`);
      
      ensureDirectoryExists(path.dirname(outputPath));

      if (!processedFiles.has(relativePath)) {
        // First file for this path - create new FeatureCollection
        fs.writeFileSync(outputPath, '{"type": "FeatureCollection", "features":[\n');
        processedFiles.add(relativePath);
        mergeCount++;
      }

      // Stream the input file line by line
      await streamGeoJsonFeatures(inputPath, outputPath);
    }
  }

  // Finalize all GeoJSON files by removing the trailing comma and adding closing
  for (const relativePath of processedFiles) {
    const outputPath = path.join(outputDir, relativePath);
    await finalizeGeoJsonFile(outputPath);
  }

  return mergeCount;
}

async function streamGeoJsonFeatures(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const readStream = createReadStream(inputPath, { encoding: 'utf8' });
    const writeStream = createWriteStream(outputPath, { flags: 'a' });
    const rl = createInterface({
      input: readStream,
      crlfDelay: Infinity
    });

    let lineNumber = 0;
    let totalLines = 0;
    const featureLines: string[] = [];

    // First pass: count total lines
    const countRL = createInterface({
      input: createReadStream(inputPath, { encoding: 'utf8' }),
      crlfDelay: Infinity
    });

    countRL.on('line', () => {
      totalLines++;
    });

    countRL.on('close', () => {
      // Second pass: process features
      rl.on('line', (line) => {
        lineNumber++;
        
        // Skip first line (header) and last line (closing bracket)
        if (lineNumber > 1 && lineNumber < totalLines) {
          featureLines.push(line);
          
          // Write in batches to avoid memory buildup
          if (featureLines.length >= 1000) {
            writeStream.write(featureLines.join('\n') + ',\n');
            featureLines.length = 0;
          }
        }
      });

      rl.on('close', () => {
        // Write remaining features
        if (featureLines.length > 0) {
          writeStream.write(featureLines.join('\n') + ',\n');
        }
        
        writeStream.end();
        resolve();
      });

      rl.on('error', reject);
    });

    countRL.on('error', reject);
  });
}

async function finalizeGeoJsonFile(outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const readStream = createReadStream(outputPath, { encoding: 'utf8' });
    const tempPath = outputPath + '.tmp';
    const writeStream = createWriteStream(tempPath, { encoding: 'utf8' });
    
    let buffer = '';
    let lastChunk = '';

    readStream.on('data', (chunk: string | Buffer) => {
      // Keep the last few characters to find the trailing comma
      const chunkStr = chunk.toString();
      buffer += chunkStr;
      
      // If buffer is getting large, write most of it but keep the end
      if (buffer.length > 10000) {
        const keepSize = 100;
        const writeSize = buffer.length - keepSize;
        writeStream.write(buffer.slice(0, writeSize));
        buffer = buffer.slice(writeSize);
      }
    });

    readStream.on('end', () => {
      // Remove trailing comma and newline, then add proper closing
      let finalContent = buffer.replace(/,\s*$/, '');
      finalContent += '\n]}\n';
      
      writeStream.write(finalContent);
      writeStream.end();
    });

    writeStream.on('finish', () => {
      // Replace original with finalized version
      fs.renameSync(tempPath, outputPath);
      resolve();
    });

    readStream.on('error', reject);
    writeStream.on('error', reject);
  });
}

async function mergeCsvFiles(inputDirs: string[], outputDir: string): Promise<number> {
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
        const lines = fs.readFileSync(inputPath, 'utf8').split('\n');
        const header = lines[0];
        const content = lines.slice(1).join('\n');
        
        fs.writeFileSync(outputPath, header + '\n');
        if (content.trim()) {
          fs.appendFileSync(outputPath, content);
        }
        
        processedFiles.add(relativePath);
        mergeCount++;
      } else {
        // Subsequent files - skip header
        const lines = fs.readFileSync(inputPath, 'utf8').split('\n');
        const content = lines.slice(1).join('\n');
        
        if (content.trim()) {
          fs.appendFileSync(outputPath, content);
        }
      }
    }
  }

  return mergeCount;
}

async function mergeGpkgFiles(inputDirs: string[], outputDir: string): Promise<number> {
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

async function mergeMbtilesFiles(inputDirs: string[], outputDir: string): Promise<number> {
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
            inputPath
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
      mbtilesFiles: 0
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