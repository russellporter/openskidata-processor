import { Pool } from "pg";
import { PostgresConfig } from "../Config";
import { getPostgresPoolConfig } from "./getPostgresPoolConfig";

export interface CacheEntry<T> {
  key: string;
  value: T;
  timestamp: number;
}

export interface CacheOptions {
  valueType?: "JSONB" | "REAL";
}

export class PostgresCache<T> {
  private pool: Pool | null = null;
  private initialized = false;
  private valueType: "JSONB" | "REAL";
  private tableName: string;

  constructor(
    private cacheType: string,
    config: PostgresConfig,
    private ttlMs: number = 0, // 0 means no expiration
    options: CacheOptions = {},
  ) {
    this.config = config;
    this.valueType = options.valueType || "JSONB";
    this.tableName = `${config.tablePrefix}${cacheType}_cache`;
  }

  private config: PostgresConfig;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // First, ensure the cache database exists
    await this.ensureCacheDatabase();

    // Create connection pool to cache database
    const poolConfig = getPostgresPoolConfig(
      this.config.cacheDatabase,
      this.config,
    );
    poolConfig.idleTimeoutMillis = 60000;
    poolConfig.connectionTimeoutMillis = 30000;
    poolConfig.allowExitOnIdle = true;

    this.pool = new Pool(poolConfig);

    // Test connection
    try {
      const client = await this.pool.connect();
      await client.query("SELECT 1");
      client.release();
    } catch (error) {
      throw new Error(
        `Failed to connect to PostgreSQL cache database: ${error}`,
      );
    }

    // Create cache table and indexes
    await this.createCacheTable();

    this.initialized = true;
  }

  private async ensureCacheDatabase(): Promise<void> {
    // Connect to postgres database to create cache database
    const adminPool = new Pool(getPostgresPoolConfig("postgres", this.config));

    try {
      const client = await adminPool.connect();
      try {
        // Check if cache database exists
        const result = await client.query(
          "SELECT 1 FROM pg_database WHERE datname = $1",
          [this.config.cacheDatabase],
        );

        if (result.rows.length === 0) {
          // Create cache database
          await client.query(`CREATE DATABASE "${this.config.cacheDatabase}"`);
          console.log(
            `✅ Created persistent cache database: ${this.config.cacheDatabase}`,
          );
        }
      } finally {
        client.release();
      }
    } catch (error) {
      throw new Error(`Failed to ensure cache database exists: ${error}`);
    } finally {
      await adminPool.end();
    }
  }

  private async createCacheTable(): Promise<void> {
    if (!this.pool) {
      throw new Error("Cache not initialized");
    }

    // Check if dedicated table exists
    const tableInfo = await this.pool.query(
      `
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = $1 AND column_name = 'value'
    `,
      [this.tableName],
    );

    if (tableInfo.rows.length === 0) {
      // Table doesn't exist, create dedicated table
      const valueColumnType =
        this.valueType === "REAL" ? "REAL" : "JSONB NOT NULL";
      await this.pool.query(`
        CREATE TABLE ${this.tableName} (
          key TEXT PRIMARY KEY,
          value ${valueColumnType},
          timestamp BIGINT NOT NULL
        )
      `);

      console.log(`✅ Created dedicated cache table: ${this.tableName}`);
    } else {
      // Table exists, validate it supports our requirements
      const currentType = tableInfo.rows[0].data_type;
      const currentNullable = tableInfo.rows[0].is_nullable === "YES";

      // Fail hard if configuration is incompatible
      if (this.valueType === "REAL" && currentType !== "real") {
        throw new Error(
          `Table ${this.tableName} has ${currentType} type but REAL was requested. ` +
            `Drop the table or use JSONB type.`,
        );
      }

      if (this.valueType === "REAL" && !currentNullable) {
        throw new Error(
          `Table ${this.tableName} does not allow NULL values but REAL type needs to store nulls. ` +
            `Drop the table or use JSONB type.`,
        );
      }
    }

    // Create index on timestamp for efficient cleanup
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_timestamp 
      ON ${this.tableName}(timestamp)
    `);
  }

  private ensureInitialized(): Pool {
    if (!this.pool) {
      throw new Error("Cache not initialized");
    }
    return this.pool;
  }

  private serializeValue(value: T): any {
    if (this.valueType === "REAL") {
      // For REAL type, store number directly (null values are stored as SQL NULL)
      return value;
    } else {
      // For JSONB type, serialize to JSON string
      return JSON.stringify(value);
    }
  }

  private parseValue(dbValue: any): T {
    if (this.valueType === "REAL") {
      // For REAL type, return the number directly (SQL NULL becomes JavaScript null)
      return dbValue as T;
    } else {
      // For JSONB type, PostgreSQL returns the parsed JSON object directly
      return dbValue as T;
    }
  }

  async get(key: string): Promise<T | null> {
    const pool = this.ensureInitialized();

    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT value, timestamp FROM ${this.tableName} WHERE key = $1`,
        [key],
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const timestamp = parseInt(row.timestamp);

      // Check if entry has expired
      if (this.ttlMs > 0 && Date.now() - timestamp > this.ttlMs) {
        await client.query(`DELETE FROM ${this.tableName} WHERE key = $1`, [
          key,
        ]);
        return null;
      }

      try {
        return this.parseValue(row.value);
      } catch (error) {
        console.warn(
          `Failed to parse cached value for key ${key} in cache ${this.cacheType}:`,
          error,
        );
        await client.query(`DELETE FROM ${this.tableName} WHERE key = $1`, [
          key,
        ]);
        return null;
      }
    } finally {
      client.release();
    }
  }

  async set(key: string, value: T): Promise<void> {
    const pool = this.ensureInitialized();

    const client = await pool.connect();
    try {
      const timestamp = Date.now();

      await client.query(
        `INSERT INTO ${this.tableName} (key, value, timestamp) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (key) 
         DO UPDATE SET value = EXCLUDED.value, timestamp = EXCLUDED.timestamp`,
        [key, this.serializeValue(value), timestamp],
      );
    } finally {
      client.release();
    }
  }

  async getMany(keys: string[]): Promise<(T | undefined)[]> {
    if (keys.length === 0) {
      return [];
    }

    const pool = this.ensureInitialized();
    const client = await pool.connect();

    try {
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(",");
      const query = `
        SELECT key, value, timestamp 
        FROM ${this.tableName} 
        WHERE key IN (${placeholders})
      `;

      const result = await client.query(query, keys);

      // Create a map of cached values
      const cachedValues = new Map<string, T>();
      const now = Date.now();

      for (const row of result.rows) {
        const timestamp = parseInt(row.timestamp);

        // Check if entry has expired
        if (this.ttlMs > 0 && now - timestamp > this.ttlMs) {
          continue; // Skip expired entries
        }

        try {
          cachedValues.set(row.key, this.parseValue(row.value));
        } catch (error) {
          console.warn(
            `Failed to parse cached value for key ${row.key} in cache ${this.cacheType}:`,
            error,
          );
        }
      }

      // Return results in the same order as input keys
      return keys.map((key) =>
        cachedValues.has(key) ? cachedValues.get(key)! : undefined,
      );
    } finally {
      client.release();
    }
  }

  async setMany(entries: Array<{ key: string; value: T }>): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    // Deduplicate entries by key (keep last value for each key)
    const uniqueEntries = new Map<string, T>();
    for (const entry of entries) {
      uniqueEntries.set(entry.key, entry.value);
    }

    if (uniqueEntries.size === 0) {
      return;
    }

    const pool = this.ensureInitialized();
    const client = await pool.connect();

    try {
      const timestamp = Date.now();

      // Build bulk insert query
      const values: any[] = [];
      const placeholders: string[] = [];

      Array.from(uniqueEntries.entries()).forEach(([key, value], i) => {
        const offset = i * 3;
        placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
        values.push(key, this.serializeValue(value), timestamp);
      });

      const query = `
        INSERT INTO ${this.tableName} (key, value, timestamp) 
        VALUES ${placeholders.join(", ")}
        ON CONFLICT (key) 
        DO UPDATE SET value = EXCLUDED.value, timestamp = EXCLUDED.timestamp
      `;

      await client.query(query, values);
    } finally {
      client.release();
    }
  }

  async delete(key: string): Promise<void> {
    const pool = this.ensureInitialized();

    const client = await pool.connect();
    try {
      await client.query(`DELETE FROM ${this.tableName} WHERE key = $1`, [key]);
    } finally {
      client.release();
    }
  }

  async cleanup(): Promise<number> {
    if (this.ttlMs <= 0) {
      return 0;
    }

    const pool = this.ensureInitialized();

    const client = await pool.connect();
    try {
      const cutoffTime = Date.now() - this.ttlMs;
      const result = await client.query(
        `DELETE FROM ${this.tableName} WHERE timestamp < $1`,
        [cutoffTime],
      );
      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }

  async clear(): Promise<void> {
    const pool = this.ensureInitialized();

    const client = await pool.connect();
    try {
      await client.query(`DELETE FROM ${this.tableName}`);
    } finally {
      client.release();
    }
  }

  async size(): Promise<number> {
    const pool = this.ensureInitialized();

    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*) as count FROM ${this.tableName}`,
      );
      return parseInt(result.rows[0].count);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.initialized = false;
  }

  // Run periodic cleanup (call this periodically to clean expired entries)
  async periodicCleanup(): Promise<void> {
    if (this.ttlMs > 0) {
      const deleted = await this.cleanup();
      if (deleted > 0) {
        console.log(
          `Cleaned up ${deleted} expired entries from ${this.tableName}`,
        );
      }
    }
  }
}
