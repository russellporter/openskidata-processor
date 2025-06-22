import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export interface CacheEntry<T> {
  key: string;
  value: T;
  timestamp: number;
}

export class SQLiteCache<T> {
  private db: Database.Database | null = null;
  private insertStmt: Database.Statement | null = null;
  private selectStmt: Database.Statement | null = null;
  private deleteStmt: Database.Statement | null = null;
  private cleanupStmt: Database.Statement | null = null;

  constructor(
    private cacheFile: string,
    private ttlMs: number = 0 // 0 means no expiration
  ) {}

  async initialize(): Promise<void> {
    const dir = path.dirname(this.cacheFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.cacheFile);
    
    // Configure for optimal performance with concurrent access
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA cache_size = -8000; -- 8MB cache
      PRAGMA temp_store = MEMORY;
      PRAGMA mmap_size = 67108864; -- 64MB mmap
    `);

    // Create cache table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);

    // Create index on timestamp for efficient cleanup
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cache_timestamp ON cache(timestamp)
    `);

    // Prepare statements
    this.insertStmt = this.db.prepare(
      "INSERT OR REPLACE INTO cache (key, value, timestamp) VALUES (?, ?, ?)"
    );
    this.selectStmt = this.db.prepare(
      "SELECT value, timestamp FROM cache WHERE key = ?"
    );
    this.deleteStmt = this.db.prepare("DELETE FROM cache WHERE key = ?");
    this.cleanupStmt = this.db.prepare(
      "DELETE FROM cache WHERE timestamp < ?"
    );
  }

  async get(key: string): Promise<T | null> {
    if (!this.db || !this.selectStmt) {
      throw new Error("Cache not initialized");
    }

    const row = this.selectStmt.get(key) as { value: string; timestamp: number } | undefined;
    
    if (!row) {
      return null;
    }

    // Check if entry has expired
    if (this.ttlMs > 0 && Date.now() - row.timestamp > this.ttlMs) {
      this.deleteStmt?.run(key);
      return null;
    }

    try {
      return JSON.parse(row.value) as T;
    } catch (error) {
      console.warn(`Failed to parse cached value for key ${key}:`, error);
      this.deleteStmt?.run(key);
      return null;
    }
  }

  async set(key: string, value: T): Promise<void> {
    if (!this.db || !this.insertStmt) {
      throw new Error("Cache not initialized");
    }

    const timestamp = Date.now();
    const serializedValue = JSON.stringify(value);
    
    this.insertStmt.run(key, serializedValue, timestamp);
  }

  async delete(key: string): Promise<void> {
    if (!this.db || !this.deleteStmt) {
      throw new Error("Cache not initialized");
    }

    this.deleteStmt.run(key);
  }

  async cleanup(): Promise<number> {
    if (!this.db || !this.cleanupStmt || this.ttlMs <= 0) {
      return 0;
    }

    const cutoffTime = Date.now() - this.ttlMs;
    const result = this.cleanupStmt.run(cutoffTime);
    return result.changes;
  }

  async clear(): Promise<void> {
    if (!this.db) {
      throw new Error("Cache not initialized");
    }

    this.db.exec("DELETE FROM cache");
  }

  async size(): Promise<number> {
    if (!this.db) {
      throw new Error("Cache not initialized");
    }

    const result = this.db.prepare("SELECT COUNT(*) as count FROM cache").get() as { count: number };
    return result.count;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.insertStmt = null;
      this.selectStmt = null;
      this.deleteStmt = null;
      this.cleanupStmt = null;
    }
  }

  // Run periodic cleanup (call this periodically to clean expired entries)
  async periodicCleanup(): Promise<void> {
    if (this.ttlMs > 0) {
      const deleted = await this.cleanup();
      if (deleted > 0) {
        console.log(`Cleaned up ${deleted} expired cache entries`);
      }
    }
  }
}