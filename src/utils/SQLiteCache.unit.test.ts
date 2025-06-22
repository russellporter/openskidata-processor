import * as tmp from "tmp";
import { SQLiteCache } from "./SQLiteCache";

describe("SQLiteCache", () => {
  let cache: SQLiteCache<string>;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = tmp.dirSync().name;
    cache = new SQLiteCache<string>(`${tempDir}/test-cache.db`, 1000); // 1 second TTL
    await cache.initialize();
  });

  afterEach(async () => {
    await cache.close();
  });

  it("should store and retrieve values", async () => {
    await cache.set("key1", "value1");
    const result = await cache.get("key1");
    expect(result).toBe("value1");
  });

  it("should return null for non-existent keys", async () => {
    const result = await cache.get("non-existent");
    expect(result).toBeNull();
  });

  it("should handle complex objects", async () => {
    // Use a separate cache instance for complex objects
    const complexCache = new SQLiteCache<any>(`${tempDir}/complex-cache.db`, 1000);
    await complexCache.initialize();
    
    try {
      const complexObject = {
        id: 123,
        name: "test",
        data: { nested: true, values: [1, 2, 3] },
      };
      
      await complexCache.set("complex", complexObject);
      const result = await complexCache.get("complex");
      expect(result).toEqual(complexObject);
    } finally {
      await complexCache.close();
    }
  });

  it("should delete keys", async () => {
    await cache.set("key1", "value1");
    await cache.delete("key1");
    const result = await cache.get("key1");
    expect(result).toBeNull();
  });

  it("should clear all entries", async () => {
    await cache.set("key1", "value1");
    await cache.set("key2", "value2");
    await cache.clear();
    
    const result1 = await cache.get("key1");
    const result2 = await cache.get("key2");
    expect(result1).toBeNull();
    expect(result2).toBeNull();
  });

  it("should count entries", async () => {
    expect(await cache.size()).toBe(0);
    
    await cache.set("key1", "value1");
    await cache.set("key2", "value2");
    expect(await cache.size()).toBe(2);
  });

  it("should handle TTL expiration", async () => {
    await cache.set("expiring", "value");
    
    // Should exist immediately
    expect(await cache.get("expiring")).toBe("value");
    
    // Wait for expiration (TTL is 1 second)
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    // Should be expired now
    expect(await cache.get("expiring")).toBeNull();
  });

  it("should update existing keys", async () => {
    await cache.set("key1", "initial");
    await cache.set("key1", "updated");
    
    const result = await cache.get("key1");
    expect(result).toBe("updated");
  });

  it("should handle malformed JSON gracefully", async () => {
    // Manually insert malformed JSON to test error handling
    const testCache = new SQLiteCache<any>(`${tempDir}/malformed-test.db`);
    await testCache.initialize();
    
    // Access private db to insert malformed data
    const db = (testCache as any).db;
    const stmt = db.prepare("INSERT INTO cache (key, value, timestamp) VALUES (?, ?, ?)");
    stmt.run("malformed", "invalid json {", Date.now());
    
    const result = await testCache.get("malformed");
    expect(result).toBeNull();
    
    await testCache.close();
  });

  it("should cleanup expired entries", async () => {
    await cache.set("key1", "value1");
    await cache.set("key2", "value2");
    
    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    const deletedCount = await cache.cleanup();
    expect(deletedCount).toBe(2);
    expect(await cache.size()).toBe(0);
  });

  it("should handle cache without TTL", async () => {
    const neverExpireCache = new SQLiteCache<string>(`${tempDir}/no-ttl.db`, 0);
    await neverExpireCache.initialize();
    
    try {
      await neverExpireCache.set("persistent", "value");
      
      // Wait some time
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Should still be there
      expect(await neverExpireCache.get("persistent")).toBe("value");
      
      // Cleanup should not delete anything
      const deletedCount = await neverExpireCache.cleanup();
      expect(deletedCount).toBe(0);
    } finally {
      await neverExpireCache.close();
    }
  });
});