import * as readline from "readline";
import { Pool } from "pg";
import { configFromEnvironment } from "../Config";
import { getPostgresPoolConfig } from "../utils/getPostgresPoolConfig";

// List of known cache types from the codebase
const CACHE_TYPES = ["elevation", "geocoding", "snow_cover"];

async function prompt(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

async function getCacheTables(
  pool: Pool,
  tablePrefix: string,
): Promise<string[]> {
  const result = await pool.query(
    `
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename LIKE $1
    ORDER BY tablename
  `,
    [`${tablePrefix}%_cache`],
  );

  return result.rows.map((row) => row.tablename);
}

async function getTableSize(pool: Pool, tableName: string): Promise<string> {
  const result = await pool.query(
    `
    SELECT
      pg_size_pretty(pg_total_relation_size($1)) as size,
      COUNT(*) as rows
    FROM ${tableName}
  `,
    [tableName],
  );

  const { size, rows } = result.rows[0];
  return `${size} (${rows} rows)`;
}

async function clearCache(pool: Pool, tableName: string): Promise<number> {
  const result = await pool.query(`DELETE FROM ${tableName}`);
  return result.rowCount || 0;
}

async function main() {
  console.log("🗑️  Cache Clearing Utility\n");

  const config = configFromEnvironment();
  const postgresConfig = config.postgresCache;

  // Connect to cache database
  const poolConfig = getPostgresPoolConfig(
    postgresConfig.cacheDatabase,
    postgresConfig,
  );
  const pool = new Pool(poolConfig);

  try {
    // Test connection
    await pool.query("SELECT 1");
    console.log(
      `✅ Connected to cache database: ${postgresConfig.cacheDatabase}\n`,
    );
  } catch (error) {
    console.error(
      `❌ Failed to connect to cache database: ${postgresConfig.cacheDatabase}`,
    );
    console.error(
      "Make sure the database exists and PostgreSQL is running.\n",
    );
    console.error(`Error: ${error}`);
    process.exit(1);
  }

  try {
    // Get all cache tables
    const tables = await getCacheTables(pool, postgresConfig.tablePrefix);

    if (tables.length === 0) {
      console.log("No cache tables found.");
      return;
    }

    console.log(`Found ${tables.length} cache table(s):\n`);

    // Show table information and prompt for each
    let totalCleared = 0;
    for (const tableName of tables) {
      const size = await getTableSize(pool, tableName);
      console.log(`📊 ${tableName}: ${size}`);

      const shouldClear = await prompt(`   Clear this cache?`);

      if (shouldClear) {
        const rowsDeleted = await clearCache(pool, tableName);
        console.log(`   ✅ Cleared ${rowsDeleted} rows from ${tableName}\n`);
        totalCleared += rowsDeleted;
      } else {
        console.log(`   ⏭️  Skipped ${tableName}\n`);
      }
    }

    if (totalCleared > 0) {
      console.log(
        `\n✨ Done! Cleared ${totalCleared} total rows across all selected caches.`,
      );
    } else {
      console.log("\n✨ Done! No caches were cleared.");
    }
  } catch (error) {
    console.error("\n❌ Error during cache clearing:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
