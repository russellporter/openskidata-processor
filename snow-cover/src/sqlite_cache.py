#!/usr/bin/env python3
"""
SQLite-based cache for snow cover data.

Python equivalent of the TypeScript SQLiteCache class for cross-language compatibility.
Supports TTL-based expiration and atomic operations for snow cover pixel data.
"""

import json
import sqlite3
import time
import logging
from pathlib import Path
from typing import Optional, Any, Dict
from contextlib import contextmanager


class SQLiteCache:
    """SQLite-based cache with TTL support for snow cover data."""
    
    def __init__(self, cache_file: str, ttl_ms: int = 0):
        """
        Initialize the SQLite cache.
        
        Args:
            cache_file: Path to the SQLite database file
            ttl_ms: Time-to-live in milliseconds (0 means no expiration)
        """
        self.cache_file = Path(cache_file)
        self.ttl_ms = ttl_ms
        self.logger = logging.getLogger(__name__)
        self._initialized = False
    
    async def initialize(self):
        """Initialize the cache database and create tables."""
        # Create directory if it doesn't exist
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        
        with self._get_connection() as conn:
            # Configure for optimal performance with concurrent access
            conn.executescript("""
                PRAGMA journal_mode = WAL;
                PRAGMA synchronous = NORMAL;
                PRAGMA cache_size = -8000;
                PRAGMA temp_store = MEMORY;
                PRAGMA mmap_size = 67108864;
            """)
            
            # Create cache table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS cache (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    timestamp INTEGER NOT NULL
                )
            """)
            
            # Create index on timestamp for efficient cleanup
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_cache_timestamp ON cache(timestamp)
            """)
            
            conn.commit()
        
        self._initialized = True
        self.logger.debug(f"SQLite cache initialized: {self.cache_file}")
    
    @contextmanager
    def _get_connection(self):
        """Get a database connection with proper error handling."""
        conn = None
        try:
            conn = sqlite3.connect(str(self.cache_file))
            conn.row_factory = sqlite3.Row
            yield conn
        except Exception as e:
            if conn:
                conn.rollback()
            raise e
        finally:
            if conn:
                conn.close()
    
    async def get(self, key: str) -> Optional[Any]:
        """
        Get a value from the cache.
        
        Args:
            key: Cache key
            
        Returns:
            Cached value or None if not found/expired
        """
        if not self._initialized:
            raise RuntimeError("Cache not initialized")
        
        with self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT value, timestamp FROM cache WHERE key = ?",
                (key,)
            )
            row = cursor.fetchone()
            
            if not row:
                return None
            
            value_str, timestamp = row
            
            # Check if entry has expired
            if self.ttl_ms > 0 and (time.time() * 1000) - timestamp > self.ttl_ms:
                # Delete expired entry
                conn.execute("DELETE FROM cache WHERE key = ?", (key,))
                conn.commit()
                return None
            
            try:
                return json.loads(value_str)
            except json.JSONDecodeError as e:
                self.logger.warning(f"Failed to parse cached value for key {key}: {e}")
                # Delete corrupted entry
                conn.execute("DELETE FROM cache WHERE key = ?", (key,))
                conn.commit()
                return None
    
    async def set(self, key: str, value: Any) -> None:
        """
        Set a value in the cache.
        
        Args:
            key: Cache key
            value: Value to cache
        """
        if not self._initialized:
            raise RuntimeError("Cache not initialized")
        
        timestamp = int(time.time() * 1000)
        serialized_value = json.dumps(value)
        
        with self._get_connection() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO cache (key, value, timestamp) VALUES (?, ?, ?)",
                (key, serialized_value, timestamp)
            )
            conn.commit()
    
    async def delete(self, key: str) -> None:
        """
        Delete a value from the cache.
        
        Args:
            key: Cache key to delete
        """
        if not self._initialized:
            raise RuntimeError("Cache not initialized")
        
        with self._get_connection() as conn:
            conn.execute("DELETE FROM cache WHERE key = ?", (key,))
            conn.commit()
    
    async def cleanup(self) -> int:
        """
        Remove expired entries from the cache.
        
        Returns:
            Number of entries removed
        """
        if not self._initialized or self.ttl_ms <= 0:
            return 0
        
        cutoff_time = int(time.time() * 1000) - self.ttl_ms
        
        with self._get_connection() as conn:
            cursor = conn.execute("DELETE FROM cache WHERE timestamp < ?", (cutoff_time,))
            deleted_count = cursor.rowcount
            conn.commit()
            return deleted_count
    
    async def clear(self) -> None:
        """Clear all entries from the cache."""
        if not self._initialized:
            raise RuntimeError("Cache not initialized")
        
        with self._get_connection() as conn:
            conn.execute("DELETE FROM cache")
            conn.commit()
    
    async def size(self) -> int:
        """
        Get the number of entries in the cache.
        
        Returns:
            Number of cache entries
        """
        if not self._initialized:
            raise RuntimeError("Cache not initialized")
        
        with self._get_connection() as conn:
            cursor = conn.execute("SELECT COUNT(*) FROM cache")
            return cursor.fetchone()[0]
    
    async def close(self) -> None:
        """Close the cache (no-op for SQLite as connections are per-transaction)."""
        if self._initialized:
            self.logger.debug(f"SQLite cache closed: {self.cache_file}")
            self._initialized = False
    
    async def periodic_cleanup(self) -> None:
        """Run periodic cleanup to remove expired entries."""
        if self.ttl_ms > 0:
            deleted = await self.cleanup()
            if deleted > 0:
                self.logger.info(f"Cleaned up {deleted} expired cache entries")


# Synchronous wrapper for use in non-async contexts
class SQLiteCacheSync:
    """Synchronous wrapper around SQLiteCache for compatibility with existing sync code."""
    
    def __init__(self, cache_file: str, ttl_ms: int = 0):
        self._cache = SQLiteCache(cache_file, ttl_ms)
    
    def initialize(self):
        """Initialize the cache (sync version)."""
        import asyncio
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        return loop.run_until_complete(self._cache.initialize())
    
    def get(self, key: str) -> Optional[Any]:
        """Get a value from the cache (sync version)."""
        import asyncio
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(self._cache.get(key))
    
    def set(self, key: str, value: Any) -> None:
        """Set a value in the cache (sync version)."""
        import asyncio
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(self._cache.set(key, value))
    
    def delete(self, key: str) -> None:
        """Delete a value from the cache (sync version)."""
        import asyncio
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(self._cache.delete(key))
    
    def cleanup(self) -> int:
        """Remove expired entries (sync version)."""
        import asyncio
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(self._cache.cleanup())
    
    def clear(self) -> None:
        """Clear all entries (sync version)."""
        import asyncio
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(self._cache.clear())
    
    def size(self) -> int:
        """Get cache size (sync version)."""
        import asyncio
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(self._cache.size())
    
    def close(self) -> None:
        """Close the cache (sync version)."""
        import asyncio
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(self._cache.close())
    
    def periodic_cleanup(self) -> None:
        """Run periodic cleanup (sync version)."""
        import asyncio
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(self._cache.periodic_cleanup())