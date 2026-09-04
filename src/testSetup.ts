import { Pool } from "pg";
import { getPostgresPoolConfig } from "./utils/getPostgresPoolConfig.js";
import { getPostgresTestConfig } from "./Config.js";

// Jest global setup function
export default async function globalSetup(): Promise<void> {
  console.log("🔧 Setting up test database...");

  // Create test database if it doesn't exist
  const adminConfig = getPostgresTestConfig();
  const adminPool = new Pool(getPostgresPoolConfig("postgres", adminConfig));

  try {
    const client = await adminPool.connect();
    try {
      // Check if test database exists
      const result = await client.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        ["openskidata_test"],
      );

      if (result.rows.length === 0) {
        // Database doesn't exist, create it
        await client.query('CREATE DATABASE "openskidata_test"');
        console.log("✅ Created test database: openskidata_test");

        // Connect to the new database to enable PostGIS
        const testPool = new Pool(
          getPostgresPoolConfig("openskidata_test", adminConfig),
        );
        try {
          const testClient = await testPool.connect();
          await testClient.query("CREATE EXTENSION IF NOT EXISTS postgis");
          testClient.release();
          console.log("✅ Enabled PostGIS extension on openskidata_test");
        } finally {
          await testPool.end();
        }
      } else {
        console.log("✅ Test database openskidata_test already exists");
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.warn("⚠️ Failed to setup test database:", error);
    console.warn("Tests may fail due to database connectivity issues");
  } finally {
    await adminPool.end();
  }
}
