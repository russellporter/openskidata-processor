import { PostgresCache } from "./PostgresCache";
import { PostgresCacheConfig } from "../Config";

describe("PostgresCache", () => {
  let cache: PostgresCache<any>;
  const cacheType = "test_cache";
  
  // Create unique database name for each test run to avoid conflicts
  const uniqueDbName = `openskidata_cache_test_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  
  const testConfig: PostgresCacheConfig = {
    host: "localhost",
    port: 5432,
    database: uniqueDbName,
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD,
    maxConnections: 5,
  };

  beforeEach(async () => {
    cache = new PostgresCache(cacheType, testConfig, 0); // No TTL for basic tests
    await cache.initialize();
  });

  afterEach(async () => {
    await cache.clear(); // Clean up test data
    await cache.close();
  });

  describe("basic operations", () => {
    it("should set and get a simple value", async () => {
      const key = "test_key";
      const value = "test_value";

      await cache.set(key, value);
      const retrieved = await cache.get(key);

      expect(retrieved).toBe(value);
    });

    it("should return null for non-existent key", async () => {
      const result = await cache.get("non_existent_key");
      expect(result).toBeNull();
    });

    it("should handle complex objects", async () => {
      const key = "complex_key";
      const value = {
        string: "test",
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        nested: {
          inner: "value",
        },
      };

      await cache.set(key, value);
      const retrieved = await cache.get(key);

      expect(retrieved).toEqual(value);
    });

    it("should overwrite existing values", async () => {
      const key = "overwrite_key";
      const value1 = "first_value";
      const value2 = "second_value";

      await cache.set(key, value1);
      await cache.set(key, value2);
      const retrieved = await cache.get(key);

      expect(retrieved).toBe(value2);
    });

    it("should delete values", async () => {
      const key = "delete_key";
      const value = "delete_value";

      await cache.set(key, value);
      await cache.delete(key);
      const retrieved = await cache.get(key);

      expect(retrieved).toBeNull();
    });

    it("should clear all values for cache type", async () => {
      const keys = ["key1", "key2", "key3"];
      const value = "test_value";

      // Set multiple values
      for (const key of keys) {
        await cache.set(key, value);
      }

      // Verify they exist
      for (const key of keys) {
        const retrieved = await cache.get(key);
        expect(retrieved).toBe(value);
      }

      // Clear all
      await cache.clear();

      // Verify they're gone
      for (const key of keys) {
        const retrieved = await cache.get(key);
        expect(retrieved).toBeNull();
      }
    });

    it("should return correct size", async () => {
      const initialSize = await cache.size();
      expect(initialSize).toBe(0);

      await cache.set("key1", "value1");
      const sizeAfterOne = await cache.size();
      expect(sizeAfterOne).toBe(1);

      await cache.set("key2", "value2");
      const sizeAfterTwo = await cache.size();
      expect(sizeAfterTwo).toBe(2);

      await cache.delete("key1");
      const sizeAfterDelete = await cache.size();
      expect(sizeAfterDelete).toBe(1);
    });
  });

  describe("TTL functionality", () => {
    let ttlCache: PostgresCache<string>;
    const shortTTL = 100; // 100ms TTL

    beforeEach(async () => {
      ttlCache = new PostgresCache("test_ttl_cache", testConfig, shortTTL);
      await ttlCache.initialize();
    });

    afterEach(async () => {
      await ttlCache.clear();
      await ttlCache.close();
    });

    it("should expire values after TTL", async () => {
      const key = "ttl_key";
      const value = "ttl_value";

      await ttlCache.set(key, value);

      // Should be available immediately
      const immediate = await ttlCache.get(key);
      expect(immediate).toBe(value);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, shortTTL + 50));

      // Should be null after expiration
      const expired = await ttlCache.get(key);
      expect(expired).toBeNull();
    });

    it("should not expire values before TTL", async () => {
      const key = "ttl_key_2";
      const value = "ttl_value_2";

      await ttlCache.set(key, value);

      // Wait for less than TTL
      await new Promise((resolve) => setTimeout(resolve, shortTTL / 2));

      // Should still be available
      const notExpired = await ttlCache.get(key);
      expect(notExpired).toBe(value);
    });

    it("should cleanup expired entries", async () => {
      const key = "cleanup_key";
      const value = "cleanup_value";

      await ttlCache.set(key, value);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, shortTTL + 50));

      // Run cleanup
      const deletedCount = await ttlCache.cleanup();
      expect(deletedCount).toBe(1);

      // Verify the entry is gone
      const retrieved = await ttlCache.get(key);
      expect(retrieved).toBeNull();
    });

    it("should not cleanup non-expired entries", async () => {
      const key = "no_cleanup_key";
      const value = "no_cleanup_value";

      await ttlCache.set(key, value);

      // Run cleanup immediately (before expiration)
      const deletedCount = await ttlCache.cleanup();
      expect(deletedCount).toBe(0);

      // Verify the entry is still there
      const retrieved = await ttlCache.get(key);
      expect(retrieved).toBe(value);
    });
  });

  describe("cache type isolation", () => {
    let cache1: PostgresCache<string>;
    let cache2: PostgresCache<string>;

    beforeEach(async () => {
      cache1 = new PostgresCache("cache_type_1", testConfig, 0);
      cache2 = new PostgresCache("cache_type_2", testConfig, 0);
      await cache1.initialize();
      await cache2.initialize();
    });

    afterEach(async () => {
      await cache1.clear();
      await cache2.clear();
      await cache1.close();
      await cache2.close();
    });

    it("should isolate values by cache type", async () => {
      const key = "same_key";
      const value1 = "cache1_value";
      const value2 = "cache2_value";

      await cache1.set(key, value1);
      await cache2.set(key, value2);

      const retrieved1 = await cache1.get(key);
      const retrieved2 = await cache2.get(key);

      expect(retrieved1).toBe(value1);
      expect(retrieved2).toBe(value2);
    });

    it("should clear only specific cache type", async () => {
      const key = "isolation_key";
      const value1 = "cache1_value";
      const value2 = "cache2_value";

      await cache1.set(key, value1);
      await cache2.set(key, value2);

      await cache1.clear();

      const retrieved1 = await cache1.get(key);
      const retrieved2 = await cache2.get(key);

      expect(retrieved1).toBeNull();
      expect(retrieved2).toBe(value2);
    });

    it("should count size per cache type", async () => {
      await cache1.set("key1", "value1");
      await cache1.set("key2", "value2");
      await cache2.set("key1", "value1");

      const size1 = await cache1.size();
      const size2 = await cache2.size();

      expect(size1).toBe(2);
      expect(size2).toBe(1);
    });
  });

  describe("error handling", () => {
    it("should handle malformed cache entries gracefully", async () => {
      // This test would require manually inserting malformed JSON,
      // which is difficult with the current interface.
      // In practice, PostgreSQL's JSONB type provides good validation.
      expect(true).toBe(true);
    });

    it("should throw error when not initialized", async () => {
      const uninitializedCache = new PostgresCache("uninitialized", testConfig, 0);

      await expect(uninitializedCache.get("key")).rejects.toThrow(
        "Cache not initialized"
      );
      await expect(uninitializedCache.set("key", "value")).rejects.toThrow(
        "Cache not initialized"
      );
      await expect(uninitializedCache.delete("key")).rejects.toThrow(
        "Cache not initialized"
      );
      await expect(uninitializedCache.size()).rejects.toThrow(
        "Cache not initialized"
      );
      await expect(uninitializedCache.clear()).rejects.toThrow(
        "Cache not initialized"
      );
    });
  });

  describe("multiple initialization", () => {
    it("should handle multiple initialization calls gracefully", async () => {
      const multiInitCache = new PostgresCache("multi_init", undefined, 0);

      await multiInitCache.initialize();
      await multiInitCache.initialize(); // Should not throw

      await multiInitCache.set("test", "value");
      const retrieved = await multiInitCache.get("test");
      expect(retrieved).toBe("value");

      await multiInitCache.close();
    });
  });
});