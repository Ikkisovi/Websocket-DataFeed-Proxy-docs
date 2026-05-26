"""
Human-readable archive writer (HDD durable record).

Sits behind DiskCache.put(). For archivable historical endpoints, asynchronously
writes a copy of the response into ARCHIVE_DIR organized by data-type/symbol/date.

Hot tier (DiskCache on NVMe) is opaque sha256 keys, LRU-evicted to 30G.
Archive tier (this module on HDD) is human-readable, never expires, used by
nightly warmer + analytics that don't care about latency.

Format: gzip JSON, one file per (symbol, date, param-hash). Lean-format export
is a separate offline step.

Non-archivable endpoints (live snapshots, admin, crypto realtime) return None
from compute_archive_path() and are silently skipped.
"""

import asyncio
import gzip
import hashlib
import json
import os
from datetime import date as date_cls
from pathlib import Path
from typing import Optional

ARCHIVE_DIR = os.getenv("ARCHIVE_DIR", "/mnt/data/archive")
ARCHIVE_ENABLED = os.getenv("ARCHIVE_ENABLED", "true").lower() in ("1", "true", "yes")


def _normalize_date(value) -> str:
    if not value:
        return date_cls.today().isoformat()
    s = str(value).strip().split("T")[0]
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    return s


def _safe(s) -> str:
    return "".join(c if c.isalnum() else "_" for c in str(s).upper())[:64] or "_"


def _param_hash(params: dict) -> str:
    drop = {"symbol", "symbols", "underlying", "date", "start", "end",
            "start_date", "end_date", "token", "api_key", "api_secret"}
    leftover = {k: v for k, v in sorted(params.items()) if k not in drop and v not in (None, "")}
    payload = json.dumps(leftover, sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(payload.encode()).hexdigest()[:8]


def compute_archive_path(endpoint: str, params: dict) -> Optional[Path]:
    """Return target archive Path, or None if endpoint is not archivable."""
    if not ARCHIVE_ENABLED:
        return None
    base = Path(ARCHIVE_DIR)
    sym_raw = (params.get("symbol") or params.get("symbols")
               or params.get("underlying") or "")
    sym = _safe(sym_raw) if sym_raw else "_global"
    end_value = (params.get("end") or params.get("end_date")
                 or params.get("date") or params.get("start")
                 or params.get("start_date"))
    d = _normalize_date(end_value)
    h = _param_hash(params)

    if endpoint == "/v1/history/bars":
        tf = _safe(params.get("timeframe", "1Min"))
        return base / "stocks" / "bars" / tf / sym / f"{d}__{h}.json.gz"
    if endpoint == "/v1/history/options/bars":
        tf = _safe(params.get("timeframe", "1Min"))
        return base / "options" / "bars" / tf / sym / f"{d}__{h}.json.gz"
    if endpoint == "/v1/history/news":
        return base / "news" / f"{d}__{sym}__{h}.json.gz"
    if endpoint == "/v1/history/options/trade_quote":
        return base / "options" / "trade_quote" / sym / f"{d}__{h}.json.gz"
    if endpoint == "/v1/stock/history/trade_quote":
        return base / "stocks" / "trade_quote" / sym / f"{d}__{h}.json.gz"
    if endpoint == "/v1/history/options/trades":
        return base / "options" / "trades" / sym / f"{d}__{h}.json.gz"
    if endpoint in ("/v1/options/eod", "/v1/history/options/eod"):
        return base / "options" / "eod" / sym / f"{d}__{h}.json.gz"
    if endpoint == "/v1/options/open_interest":
        return base / "options" / "open_interest" / sym / f"{d}__{h}.json.gz"
    if endpoint == "/v1/options/contracts":
        return base / "options" / "contracts" / sym / f"{d}__{h}.json.gz"
    
    # Catch-all fallback for all other endpoints (e.g. snapshots, /v2/stocks/*)
    clean_ep = endpoint.strip("/").replace("/", "_") or "root"
    return base / "other" / clean_ep / sym / f"{d}__{h}.json.gz"


def _write_sync(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "wb") as f:
        f.write(gzip.compress(data, compresslevel=6))
    os.replace(tmp, path)


async def archive_write(endpoint: str, params: dict, payload) -> None:
    """Fire-and-forget archive write. Never raises."""
    try:
        if not isinstance(payload, (dict, list)):
            return
        path = compute_archive_path(endpoint, params)
        if path is None:
            return
        data = json.dumps(payload, separators=(",", ":")).encode()
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _write_sync, path, data)
    except Exception as e:
        print(f"[Archive] write error for {endpoint}: {e}")
