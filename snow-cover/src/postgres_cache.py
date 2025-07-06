#!/usr/bin/env python3
"""
PostgreSQL-based cache for snow cover data.

Python equivalent of the TypeScript PostgresCache class for cross-language compatibility.
Supports TTL-based expiration and atomic operations for snow cover pixel data.
"""

import json
import time
import logging
import asyncio
from typing import Optional, Any, Dict
import asyncpg


class PostgresCache:
    """PostgreSQL-based cache with TTL support for snow cover data."""
    
    def __init__(self, cache_type: str, ttl_ms: int = 0):
        """
        Initialize the PostgreSQL cache.
        
        Args:
            cache_type: Cache type for namespacing (e.g., 'snow_cover')
            ttl_ms: Time-to-live in milliseconds (0 means no expiration)
        """
        self.cache_type = cache_type
        self.ttl_ms = ttl_ms
        self.logger = logging.getLogger(__name__)
        self._pool = None
        self._initialized = False
        
        # Database configuration
        self.db_config = {
            'host': 'localhost',
            'port': 5432,
            'database': 'openskidata_cache',
            'user': 'postgres',
            # No password required for local trust authentication
        }
    
    async def initialize(self):
        """Initialize the cache database and create tables."""
        # First, ensure the cache database exists
        await self._ensure_cache_database()
        
        # Create connection pool to cache database
        self._pool = await asyncpg.create_pool(
            min_size=1,
            max_size=5,
            **self.db_config
        )
        
        # Create cache table and indexes
        await self._create_cache_table()
        
        self._initialized = True
        self.logger.debug(f"PostgreSQL cache initialized for type: {self.cache_type}")
    
    async def _ensure_cache_database(self):
        """Ensure the cache database exists."""
        # Connect to postgres database to create cache database if needed
        admin_config = {**self.db_config, 'database': 'postgres'}
        
        conn = await asyncpg.connect(**admin_config)
        try:
            # Check if cache database exists
            result = await conn.fetchval(
                "SELECT 1 FROM pg_database WHERE datname = $1",
                'openskidata_cache'
            )
            
            if not result:
                # Create cache database
                await conn.execute(f'CREATE DATABASE "openskidata_cache"')
                self.logger.info("Created persistent cache database: openskidata_cache")
        finally:
            await conn.close()
    
    async def _create_cache_table(self):
        """Create cache table and indexes."""
        async with self._pool.acquire() as conn:
            # Create cache table with composite primary key
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS cache (
                    key TEXT NOT NULL,
                    cache_type TEXT NOT NULL,
                    value JSONB NOT NULL,
                    timestamp BIGINT NOT NULL,
                    PRIMARY KEY (cache_type, key)
                )
            """)
            
            # Create index on timestamp for efficient cleanup
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_cache_timestamp 
                ON cache(cache_type, timestamp)
            """)
    
    def _ensure_initialized(self):
        """Ensure the cache is initialized."""
        if not self._initialized or not self._pool:
            raise RuntimeError("Cache not initialized")
    
    async def get(self, key: str) -> Optional[Any]:
        """
        Get a value from the cache.
        
        Args:
            key: Cache key
            
        Returns:
            Cached value or None if not found/expired
        """
        self._ensure_initialized()
        
        async with self._pool.acquire() as conn:
            result = await conn.fetchrow(
                "SELECT value, timestamp FROM cache WHERE cache_type = $1 AND key = $2",
                self.cache_type, key
            )
            
            if not result:
                return None
            
            value, timestamp = result
            
            # Check if entry has expired
            current_time_ms = int(time.time() * 1000)
            if self.ttl_ms > 0 and current_time_ms - timestamp > self.ttl_ms:
                # Delete expired entry
                await conn.execute(
                    "DELETE FROM cache WHERE cache_type = $1 AND key = $2",
                    self.cache_type, key
                )
                return None
            
            try:
                return value  # asyncpg automatically handles JSONB conversion
            except Exception as e:
                self.logger.warning(f"Failed to parse cached value for key {key}: {e}")
                # Delete corrupted entry
                await conn.execute(
                    "DELETE FROM cache WHERE cache_type = $1 AND key = $2",
                    self.cache_type, key
                )
                return None
    
    async def set(self, key: str, value: Any) -> None:
        """
        Set a value in the cache.
        
        Args:
            key: Cache key
            value: Value to cache
        """
        self._ensure_initialized()
        
        timestamp = int(time.time() * 1000)
        
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO cache (key, cache_type, value, timestamp) 
                   VALUES ($1, $2, $3, $4) 
                   ON CONFLICT (cache_type, key) 
                   DO UPDATE SET value = EXCLUDED.value, timestamp = EXCLUDED.timestamp""",
                key, self.cache_type, json.dumps(value), timestamp
            )
    
    async def delete(self, key: str) -> None:
        """
        Delete a value from the cache.
        
        Args:
            key: Cache key to delete
        """
        self._ensure_initialized()
        
        async with self._pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM cache WHERE cache_type = $1 AND key = $2",
                self.cache_type, key
            )
    
    async def cleanup(self) -> int:
        """
        Remove expired entries from the cache.
        
        Returns:
            Number of entries removed
        """
        if not self._initialized or self.ttl_ms <= 0:
            return 0
        
        cutoff_time = int(time.time() * 1000) - self.ttl_ms
        
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM cache WHERE cache_type = $1 AND timestamp < $2",
                self.cache_type, cutoff_time
            )
            # Extract number of deleted rows from result
            deleted_count = int(result.split()[-1]) if result.startswith('DELETE') else 0
            return deleted_count
    
    async def clear(self) -> None:
        """Clear all entries from the cache for this cache type."""
        self._ensure_initialized()
        
        async with self._pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM cache WHERE cache_type = $1",
                self.cache_type
            )
    
    async def size(self) -> int:
        """
        Get the number of entries in the cache for this cache type.
        
        Returns:
            Number of cache entries
        """
        self._ensure_initialized()
        
        async with self._pool.acquire() as conn:
            result = await conn.fetchval(
                "SELECT COUNT(*) FROM cache WHERE cache_type = $1",
                self.cache_type
            )
            return result
    
    async def close(self) -> None:
        """Close the cache connection pool."""
        if self._pool:
            await self._pool.close()
            self._pool = None
        self._initialized = False
        self.logger.debug(f"PostgreSQL cache closed for type: {self.cache_type}")
    
    async def periodic_cleanup(self) -> None:
        """Run periodic cleanup to remove expired entries."""
        if self.ttl_ms > 0:
            deleted = await self.cleanup()
            if deleted > 0:
                self.logger.info(f"Cleaned up {deleted} expired cache entries from {self.cache_type} cache")


# Synchronous wrapper for use in non-async contexts
class PostgresCacheSync:
    """Synchronous wrapper around PostgresCache for compatibility with existing sync code."""
    
    def __init__(self, cache_type: str, ttl_ms: int = 0):
        self._cache = PostgresCache(cache_type, ttl_ms)
        self._loop = None
    
    def _get_loop(self):
        """Get or create event loop for sync operations."""
        if self._loop is None or self._loop.is_closed():
            try:
                self._loop = asyncio.get_event_loop()
            except RuntimeError:
                self._loop = asyncio.new_event_loop()
                asyncio.set_event_loop(self._loop)
        return self._loop
    
    def initialize(self):
        """Initialize the cache (sync version)."""
        loop = self._get_loop()
        return loop.run_until_complete(self._cache.initialize())
    
    def get(self, key: str) -> Optional[Any]:
        """Get a value from the cache (sync version)."""
        loop = self._get_loop()
        return loop.run_until_complete(self._cache.get(key))
    
    def set(self, key: str, value: Any) -> None:
        """Set a value in the cache (sync version)."""
        loop = self._get_loop()
        return loop.run_until_complete(self._cache.set(key, value))
    
    def delete(self, key: str) -> None:
        """Delete a value from the cache (sync version)."""
        loop = self._get_loop()
        return loop.run_until_complete(self._cache.delete(key))
    
    def cleanup(self) -> int:
        """Remove expired entries (sync version)."""
        loop = self._get_loop()
        return loop.run_until_complete(self._cache.cleanup())
    
    def clear(self) -> None:
        """Clear all entries (sync version)."""
        loop = self._get_loop()
        return loop.run_until_complete(self._cache.clear())
    
    def size(self) -> int:
        """Get cache size (sync version)."""
        loop = self._get_loop()
        return loop.run_until_complete(self._cache.size())
    
    def close(self) -> None:
        """Close the cache (sync version)."""
        loop = self._get_loop()
        return loop.run_until_complete(self._cache.close())
    
    def periodic_cleanup(self) -> None:
        """Run periodic cleanup (sync version)."""
        loop = self._get_loop()
        return loop.run_until_complete(self._cache.periodic_cleanup())