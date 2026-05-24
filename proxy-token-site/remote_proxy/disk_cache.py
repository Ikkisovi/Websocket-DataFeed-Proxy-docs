#!/usr/bin/env python3
"""
Persistent Parquet-based disk cache for Alpaca Cloud Proxy.

Architecture:
  Request → In-Memory (TTLCache, 1000 entries, 5min)
          → Disk Cache (Parquet on HDD, 100GB budget, tiered TTL)
          → Upstream Alpaca/ThetaData

Design constraints:
- 125GB HDD at /mnt/data/cache
- 1.9GB RAM — cache metadata in memory, actual data on disk
- Single-process asyncio — all I/O via run_in_executor
"""

import asyncio
import hashlib
import json
import os
import time
import shutil
from datetime import datetime, date
from pathlib import Path
from typing import Optional, Dict, Any
from functools import partial

# --- Configuration ---
CACHE_BASE_DIR = os.getenv("DISK_CACHE_DIR", "/mnt/data/cache")
CACHE_MAX_GB = float(os.getenv("DISK_CACHE_MAX_GB", "100"))
CACHE_CLEANUP_INTERVAL = int(os.getenv("DISK_CACHE_CLEANUP_INTERVAL", "3600"))  # seconds

# TTL tiers (seconds)
TTL_HISTORICAL = 7 * 86400     # 7 days — past market data is immutable
TTL_INTRADAY = 60              # 60s — today's data still updating
TTL_SNAPSHOTS = 300            # 5 min — options snapshots
TTL_CONTRACTS = 3600           # 1 hour — option contracts list
TTL_DEFAULT = 300              # 5 min fallback

# Endpoints and their TTL mapping
ENDPOINT_TTL = {
    "/v1/history/bars": "tiered",           # historical vs intraday
    "/v1/history/options/bars": "tiered",   # historical vs intraday
    "/v1/options/open_interest": TTL_CONTRACTS,
    "/v1/options/eod": TTL_HISTORICAL,
    "/v1/history/options/eod": TTL_HISTORICAL,
    "/v1/options/contracts": TTL_CONTRACTS,
    "/v1/options/snapshots": TTL_SNAPSHOTS,
    "/v1/options/snapshots/expiry": TTL_SNAPSHOTS,
    "/v1/history/news": TTL_DEFAULT,
    "/v3/option/list/symbols": TTL_CONTRACTS,
    "/v3/option/list/dates/quote": TTL_CONTRACTS,
    "/v3/option/list/dates/trade": TTL_CONTRACTS,
    "/v3/option/list/expirations": TTL_CONTRACTS,
    "/v3/option/list/strikes": TTL_CONTRACTS,
    "/v3/option/list/contracts/quote": TTL_CONTRACTS,
    "/v3/option/list/contracts/trade": TTL_CONTRACTS,
    "/v3/option/snapshot/ohlc": TTL_SNAPSHOTS,
    "/v3/option/snapshot/quote": TTL_SNAPSHOTS,
    "/v3/option/snapshot/open_interest": TTL_SNAPSHOTS,
    "/v3/option/history/eod": TTL_HISTORICAL,
    "/v3/option/history/ohlc": "tiered",
    "/v3/option/history/quote": "tiered",
    "/v3/option/history/open_interest": TTL_HISTORICAL,
    "/v3/option/at_time/quote": "tiered",
}


def _is_today(date_str: str) -> bool:
    """Check if a date string refers to today."""
    if not date_str:
        return False
    try:
        d = date_str.split("T")[0]
        return d == date.today().isoformat()
    except Exception:
        return False


def compute_ttl(endpoint: str, params: dict) -> int:
    """Compute cache TTL based on endpoint and request parameters."""
    ttl_spec = ENDPOINT_TTL.get(endpoint, TTL_DEFAULT)
    if endpoint.startswith("/v2/stocks/"):
        if "/latest" in endpoint or endpoint.endswith("/snapshot") or endpoint.endswith("/snapshots"):
            ttl_spec = TTL_INTRADAY
        elif endpoint.startswith("/v2/stocks/meta/"):
            ttl_spec = TTL_CONTRACTS
        else:
            ttl_spec = "tiered"
    elif endpoint.startswith("/v1beta3/crypto/") or endpoint.startswith("/v1beta1/crypto-perps/"):
        ttl_spec = TTL_INTRADAY if "/latest/" in endpoint else "tiered"
    elif endpoint.startswith("/v1beta1/options/"):
        ttl_spec = TTL_SNAPSHOTS if ("/latest/" in endpoint or "/snapshots" in endpoint) else "tiered"
    elif endpoint == "/v1beta1/news" or endpoint.startswith("/v1beta1/news/"):
        ttl_spec = TTL_DEFAULT
    elif endpoint == "/v2/options/contracts" or endpoint.startswith("/v2/options/contracts/"):
        ttl_spec = TTL_CONTRACTS
    if isinstance(ttl_spec, int):
        return ttl_spec
    # "tiered" — check if the request covers today
    end_date = params.get("end") or params.get("end_date") or params.get("date") or ""
    if not end_date:
        return TTL_INTRADAY
    if _is_today(end_date):
        return TTL_INTRADAY
    return TTL_HISTORICAL


def generate_disk_key(endpoint: str, params: dict) -> str:
    """Deterministic cache key from endpoint + normalized params.
    
    Strips user-specific fields (token, user_id, auth).
    """
    cacheable = {
        k: v for k, v in sorted(params.items())
        if k not in ("token", "user_id", "auth", "api_key", "api_secret")
    }
    payload = f"{endpoint}:{json.dumps(cacheable, sort_keys=True, separators=(',', ':'))}"
    return hashlib.sha256(payload.encode()).hexdigest()


def _cache_path(key: str) -> Path:
    """Get filesystem path for a cache entry."""
    # Use first 2 chars as directory shard to avoid too many files in one dir
    return Path(CACHE_BASE_DIR) / key[:2] / f"{key}.json.gz"


def _meta_path(key: str) -> Path:
    return Path(CACHE_BASE_DIR) / key[:2] / f"{key}.meta"


def _write_cache_sync(key: str, data: bytes, ttl: int):
    """Synchronous write — called via run_in_executor."""
    import gzip
    path = _cache_path(key)
    meta = _meta_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    
    # Write compressed data
    with open(path, "wb") as f:
        f.write(gzip.compress(data, compresslevel=6))
    
    # Write metadata
    meta_data = {
        "created_at": time.time(),
        "expires_at": time.time() + ttl,
        "ttl": ttl,
        "size_bytes": len(data),
        "compressed_bytes": path.stat().st_size,
    }
    with open(meta, "w") as f:
        json.dump(meta_data, f)


def _read_cache_sync(key: str) -> Optional[bytes]:
    """Synchronous read — called via run_in_executor."""
    import gzip
    path = _cache_path(key)
    meta = _meta_path(key)
    
    if not path.exists() or not meta.exists():
        return None
    
    try:
        with open(meta, "r") as f:
            meta_data = json.load(f)
        
        if time.time() > meta_data.get("expires_at", 0):
            # Expired — delete
            path.unlink(missing_ok=True)
            meta.unlink(missing_ok=True)
            return None
        
        with open(path, "rb") as f:
            return gzip.decompress(f.read())
    except Exception as e:
        print(f"[DiskCache] Read error for {key[:16]}: {e}")
        return None


def _cleanup_sync(max_gb: float):
    """Remove expired entries and enforce disk budget."""
    base = Path(CACHE_BASE_DIR)
    if not base.exists():
        return
    
    now = time.time()
    removed_expired = 0
    removed_lru = 0
    entries = []
    
    # Pass 1: Remove expired, collect surviving entries
    for meta_path in base.rglob("*.meta"):
        try:
            with open(meta_path, "r") as f:
                meta = json.load(f)
            if now > meta.get("expires_at", 0):
                data_path = meta_path.with_suffix("").with_suffix(".json.gz")
                data_path.unlink(missing_ok=True)
                meta_path.unlink(missing_ok=True)
                removed_expired += 1
            else:
                data_path = meta_path.with_suffix("").with_suffix(".json.gz")
                if data_path.exists():
                    entries.append({
                        "meta_path": meta_path,
                        "data_path": data_path,
                        "created_at": meta.get("created_at", 0),
                        "size": meta.get("compressed_bytes", 0),
                    })
        except Exception:
            continue
    
    # Pass 2: Enforce disk budget (LRU eviction)
    total_bytes = sum(e["size"] for e in entries)
    max_bytes = max_gb * 1024 * 1024 * 1024
    
    if total_bytes > max_bytes:
        # Sort by creation time, evict oldest
        entries.sort(key=lambda e: e["created_at"])
        while total_bytes > max_bytes * 0.9 and entries:  # Evict to 90%
            entry = entries.pop(0)
            entry["data_path"].unlink(missing_ok=True)
            entry["meta_path"].unlink(missing_ok=True)
            total_bytes -= entry["size"]
            removed_lru += 1
    
    # Clean empty directories
    for dirpath in sorted(base.rglob("*"), reverse=True):
        if dirpath.is_dir():
            try:
                dirpath.rmdir()  # Only succeeds if empty
            except OSError:
                pass
    
    if removed_expired or removed_lru:
        print(
            f"[DiskCache] Cleanup: expired={removed_expired} lru={removed_lru} "
            f"total_mb={total_bytes / 1024 / 1024:.1f}"
        )


class DiskCache:
    """Async disk cache backed by gzip-compressed JSON files."""
    
    def __init__(self):
        self._executor = None
        self._cleanup_task = None
        self._stats = {"hits": 0, "misses": 0, "writes": 0, "errors": 0}
    
    async def get(self, endpoint: str, params: dict) -> Optional[dict]:
        """Get cached response. Returns None on miss."""
        key = generate_disk_key(endpoint, params)
        loop = asyncio.get_event_loop()
        try:
            data = await loop.run_in_executor(None, _read_cache_sync, key)
            if data is not None:
                self._stats["hits"] += 1
                return json.loads(data)
            self._stats["misses"] += 1
            return None
        except Exception as e:
            self._stats["errors"] += 1
            print(f"[DiskCache] Get error: {e}")
            return None
    
    async def put(self, endpoint: str, params: dict, response: dict):
        """Store response in disk cache (non-blocking)."""
        key = generate_disk_key(endpoint, params)
        ttl = compute_ttl(endpoint, params)
        data = json.dumps(response, separators=(",", ":")).encode()
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(None, _write_cache_sync, key, data, ttl)
            self._stats["writes"] += 1
        except Exception as e:
            self._stats["errors"] += 1
            print(f"[DiskCache] Put error: {e}")
    
    def put_nowait(self, endpoint: str, params: dict, response: dict):
        """Fire-and-forget cache write."""
        loop = asyncio.get_event_loop()
        loop.create_task(self.put(endpoint, params, response))
    
    def get_stats(self) -> dict:
        """Return cache stats."""
        stats = dict(self._stats)
        try:
            usage = shutil.disk_usage(CACHE_BASE_DIR)
            stats["disk_used_mb"] = round((usage.total - usage.free) / 1024 / 1024, 1)
            stats["disk_free_mb"] = round(usage.free / 1024 / 1024, 1)
        except Exception:
            pass
        return stats
    
    async def start_cleanup_loop(self):
        """Start background cleanup task."""
        async def _loop():
            while True:
                await asyncio.sleep(CACHE_CLEANUP_INTERVAL)
                try:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(None, _cleanup_sync, CACHE_MAX_GB)
                except Exception as e:
                    print(f"[DiskCache] Cleanup error: {e}")
        
        self._cleanup_task = asyncio.create_task(_loop())
    
    async def shutdown(self):
        if self._cleanup_task:
            self._cleanup_task.cancel()


# Singleton
_disk_cache = None


def get_disk_cache() -> DiskCache:
    global _disk_cache
    if _disk_cache is None:
        _disk_cache = DiskCache()
        # Ensure base dir exists
        Path(CACHE_BASE_DIR).mkdir(parents=True, exist_ok=True)
    return _disk_cache
