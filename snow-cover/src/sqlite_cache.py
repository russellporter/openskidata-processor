#!/usr/bin/env python3
"""
The embedded cache store, from Python.

The processor keeps its caches (elevation, geocoding, snow cover) in one SQLite file. This reads
and writes the snow cover entries of that same file, so the data fetched here is what the
processor reads: ``json_cache(kind, key, value, ts)`` with ``kind = 3``, ``value`` the JSON text,
``ts`` the time it was stored in milliseconds. The table definitions below are the processor's
own (``rust/crates/osd-cache/src/store.rs``); keep them identical.

Historical satellite data does not change, so entries are written without expiry (a
time-to-live of 0 keeps them forever).
"""

import json
import sqlite3
import time
from pathlib import Path
from typing import Any, List, Optional

SNOW_COVER_KIND = 3

SCHEMA = """
CREATE TABLE IF NOT EXISTS elevation (
  key INTEGER PRIMARY KEY,
  value REAL,
  ts INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS json_cache (
  kind INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (kind, key)
) WITHOUT ROWID;
"""


class SQLiteCacheSync:
    """Snow cover entries of the processor's cache file."""

    def __init__(self, path: str, ttl_ms: int = 0, kind: int = SNOW_COVER_KIND):
        self.path = path
        self.ttl_ms = ttl_ms
        self.kind = kind
        self._connection: Optional[sqlite3.Connection] = None

    def initialize(self) -> None:
        parent = Path(self.path).parent
        parent.mkdir(parents=True, exist_ok=True)
        # The processor may have the file open; wait for it rather than fail.
        self._connection = sqlite3.connect(self.path, timeout=60)
        self._connection.execute("PRAGMA journal_mode = WAL")
        self._connection.execute("PRAGMA synchronous = NORMAL")
        self._connection.executescript(SCHEMA)
        self._connection.commit()

    def _db(self) -> sqlite3.Connection:
        if self._connection is None:
            raise RuntimeError("Cache not initialized")
        return self._connection

    def get(self, key: str) -> Optional[Any]:
        row = self._db().execute(
            "SELECT value, ts FROM json_cache WHERE kind = ? AND key = ?", (self.kind, key)
        ).fetchone()
        if row is None:
            return None
        value, ts = row
        if self.ttl_ms > 0 and int(time.time() * 1000) - ts > self.ttl_ms:
            return None
        return json.loads(value)

    def set(self, key: str, value: Any) -> None:
        self._db().execute(
            "INSERT INTO json_cache (kind, key, value, ts) VALUES (?, ?, ?, ?) "
            "ON CONFLICT (kind, key) DO UPDATE SET value = excluded.value, ts = excluded.ts",
            (self.kind, key, json.dumps(value, separators=(",", ":")), int(time.time() * 1000)),
        )
        self._db().commit()

    def delete(self, key: str) -> None:
        self._db().execute(
            "DELETE FROM json_cache WHERE kind = ? AND key = ?", (self.kind, key)
        )
        self._db().commit()

    def size(self) -> int:
        return self._db().execute(
            "SELECT COUNT(*) FROM json_cache WHERE kind = ?", (self.kind,)
        ).fetchone()[0]

    def keys(self, prefix: str = "") -> List[str]:
        """The keys that start with ``prefix``, in key order."""
        # A range scan on the primary key; LIKE would not use it and treats % and _ specially.
        rows = self._db().execute(
            "SELECT key FROM json_cache WHERE kind = ? AND key >= ? AND key < ? ORDER BY key",
            (self.kind, prefix, prefix + "\U0010ffff"),
        ).fetchall()
        return [row[0] for row in rows]

    def close(self) -> None:
        if self._connection is not None:
            self._connection.commit()
            self._connection.close()
            self._connection = None
