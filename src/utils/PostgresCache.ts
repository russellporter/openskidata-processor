import { Pool, PoolClient } from "pg";
import { PostgresCacheConfig, getPostgresCacheConfig } from "../Config";

export interface CacheEntry<T> {
  key: string;
  value: T;
  timestamp: number;
}

export class PostgresCache<T> {
  private pool: Pool | null = null;
  private initialized = false;

  constructor(
    private cacheType: string,
    config?: PostgresCacheConfig,
    private ttlMs: number = 0 // 0 means no expiration
  ) {
    this.config = config || getPostgresCacheConfig();
  }

  private config: PostgresCacheConfig;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // First, ensure the cache database exists
    await this.ensureCacheDatabase();

    // Create connection pool to cache database
    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      max: this.config.maxConnections,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 30000,
      allowExitOnIdle: true,
    });

    // Test connection
    try {
      const client = await this.pool.connect();
      await client.query("SELECT 1");
      client.release();
    } catch (error) {
      throw new Error(
        `Failed to connect to PostgreSQL cache database: ${error}`
      );
    }

    // Create cache table and indexes
    await this.createCacheTable();

    this.initialized = true;
  }

  private async ensureCacheDatabase(): Promise<void> {
    // Connect to postgres database to create cache database
    const adminPool = new Pool({
      host: this.config.host,
      port: this.config.port,
      database: "postgres",
      user: this.config.user,
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    try {
      const client = await adminPool.connect();
      try {
        // Check if cache database exists
        const result = await client.query(
          "SELECT 1 FROM pg_database WHERE datname = $1",
          [this.config.database]
        );

        if (result.rows.length === 0) {
          // Create cache database
          await client.query(
            `CREATE DATABASE "${this.config.database}"`
          );
          console.log(
            `✅ Created persistent cache database: ${this.config.database}`
          );
        }
      } finally {
        client.release();
      }
    } catch (error) {
      throw new Error(
        `Failed to ensure cache database exists: ${error}`
      );
    } finally {
      await adminPool.end();
    }
  }

  private async createCacheTable(): Promise<void> {
    if (!this.pool) {
      throw new Error("Cache not initialized");
    }

    // Create cache table with composite primary key
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT NOT NULL,
        cache_type TEXT NOT NULL,
        value JSONB NOT NULL,
        timestamp BIGINT NOT NULL,
        PRIMARY KEY (cache_type, key)
      )
    `);

    // Create index on timestamp for efficient cleanup
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_cache_timestamp 
      ON cache(cache_type, timestamp)
    `);
  }

  private ensureInitialized(): Pool {
    if (!this.pool) {
      throw new Error("Cache not initialized");
    }
    return this.pool;
  }

  async get(key: string): Promise<T | null> {
    const pool = this.ensureInitialized();

    const client = await pool.connect();
    try {
      const result = await client.query(
        "SELECT value, timestamp FROM cache WHERE cache_type = $1 AND key = $2",
        [this.cacheType, key]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const timestamp = parseInt(row.timestamp);

      // Check if entry has expired
      if (this.ttlMs > 0 && Date.now() - timestamp > this.ttlMs) {
        await client.query(
          "DELETE FROM cache WHERE cache_type = $1 AND key = $2",
          [this.cacheType, key]
        );
        return null;
      }

      try {
        return row.value as T;
      } catch (error) {
        console.warn(
          `Failed to parse cached value for key ${key} in cache ${this.cacheType}:`,
          error
        );
        await client.query(
          "DELETE FROM cache WHERE cache_type = $1 AND key = $2",
          [this.cacheType, key]
        );
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
        `INSERT INTO cache (key, cache_type, value, timestamp) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (cache_type, key) 
         DO UPDATE SET value = EXCLUDED.value, timestamp = EXCLUDED.timestamp`,
        [key, this.cacheType, JSON.stringify(value), timestamp]
      );
    } finally {
      client.release();
    }
  }

  async delete(key: string): Promise<void> {
    const pool = this.ensureInitialized();

    const client = await pool.connect();
    try {
      await client.query(
        "DELETE FROM cache WHERE cache_type = $1 AND key = $2",
        [this.cacheType, key]
      );
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
        "DELETE FROM cache WHERE cache_type = $1 AND timestamp < $2",
        [this.cacheType, cutoffTime]
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
      await client.query(
        "DELETE FROM cache WHERE cache_type = $1",
        [this.cacheType]
      );
    } finally {
      client.release();
    }
  }

  async size(): Promise<number> {
    const pool = this.ensureInitialized();

    const client = await pool.connect();
    try {
      const result = await client.query(
        "SELECT COUNT(*) as count FROM cache WHERE cache_type = $1",
        [this.cacheType]
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
          `Cleaned up ${deleted} expired cache entries from ${this.cacheType} cache`
        );
      }
    }
  }
}