#!/usr/bin/env python3
"""
cache_to_db.py — 将现有 disk cache (gzip JSON) 迁移到 TimescaleDB

遍历 /var/cache/alpaca/ 下的所有 .json.gz 文件：
- 解析文件名/路径识别 endpoint 和参数
- 解压读取 JSON 内容
- 如果是 bars 数据，转换为 DB 记录格式
- 使用 COPY 协议高效批量写入 TimescaleDB

运行方式:
    python3 cache_to_db.py --dry-run          # 预览，不写入
    python3 cache_to_db.py                    # 全量迁移
    python3 cache_to_db.py --batch-size 5000  # 调整批量大小
    python3 cache_to_db.py --workers 4        # 并行处理

性能预期:
    - 单个 NVMe SSD 上 30GB cache 约 50-100 万个文件
    - COPY 协议写入速度: 5-10万条/秒
    - 总时间: 30GB cache → 约 30-60 分钟
"""

import argparse
import asyncio
import gzip
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Tuple, Dict, Any, Optional
from concurrent.futures import ProcessPoolExecutor
import multiprocessing

try:
    import asyncpg
    ASYNCPG_AVAILABLE = True
except ImportError:
    asyncpg = None
    ASYNCPG_AVAILABLE = False

# --- 配置 ---
CACHE_DIR = os.getenv("DISK_CACHE_DIR", "/var/cache/alpaca")
DB_HOST = os.getenv("TIMESCALEDB_HOST", "timescaledb")
DB_PORT = int(os.getenv("TIMESCALEDB_PORT", "5432"))
DB_USER = os.getenv("TIMESCALEDB_USER", "proxy")
DB_PASSWORD = os.getenv("TIMESCALEDB_PASSWORD", "proxy123")
DB_NAME = os.getenv("TIMESCALEDB_DB", "marketdata")


def parse_iso_timestamp(ts_str: str) -> Optional[datetime]:
    """解析 ISO 格式时间戳。"""
    if not ts_str:
        return None
    try:
        s = str(ts_str).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def read_cache_file(path: str) -> Optional[Tuple[Dict, Dict]]:
    """
    读取单个 cache 文件。

    返回: (metadata, data) 或 None（如果无法解析）
    """
    try:
        # 读取 .meta 文件获取元数据
        meta_path = path.replace(".json.gz", ".meta")
        meta = {}
        if os.path.exists(meta_path):
            with open(meta_path, "r") as f:
                meta = json.load(f)

        # 读取 gzip JSON
        with gzip.open(path, "rt", encoding="utf-8") as f:
            data = json.load(f)

        return meta, data
    except Exception as e:
        return None


def bars_to_records(symbol: str, timeframe: str, bars: List[Dict], feed: str = "sip", source: str = "cache_migration") -> List[Tuple]:
    """将 bars 列表转换为 DB 记录。"""
    records = []
    for bar in bars:
        ts = parse_iso_timestamp(bar.get("t"))
        if ts is None:
            continue
        records.append((
            symbol.upper(),
            timeframe,
            ts,
            bar.get("o"),
            bar.get("h"),
            bar.get("l"),
            bar.get("c"),
            bar.get("v"),
            bar.get("vw"),
            bar.get("n"),
            feed,
            source,
        ))
    return records


def find_all_cache_files(cache_dir: str) -> List[str]:
    """递归查找所有 .json.gz 文件。"""
    files = []
    for root, _dirs, filenames in os.walk(cache_dir):
        for fname in filenames:
            if fname.endswith(".json.gz"):
                files.append(os.path.join(root, fname))
    return files


def extract_params_from_disk_key(key: str) -> Dict[str, str]:
    """
    尝试从 disk cache key (sha256) 反向推断参数。

    由于 key 是 sha256 hash，无法直接还原。但我们可以通过读取 .meta 文件
    或者解析目录结构来获取信息。

    实际上更好的方法是：直接读取文件内容，根据内容结构判断类型。
    """
    return {}


def classify_cache_data(data: Any) -> Tuple[str, Optional[str], Optional[str], List[Dict]]:
    """
    分类 cache 数据，返回 (data_type, symbol, timeframe, bars_list)。

    支持的格式:
    - Alpaca bars: {"bars": {"SYMBOL": [{"t":"...", "o":...}]}}
    - 其他格式跳过
    """
    if not isinstance(data, dict):
        return "unknown", None, None, []

    # 检查是否是 bars 格式
    bars_obj = data.get("bars")
    if isinstance(bars_obj, dict):
        for symbol, bars in bars_obj.items():
            if isinstance(bars, list) and bars:
                # 尝试从第一条记录推断 timeframe
                sample = bars[0]
                if isinstance(sample, dict) and "t" in sample:
                    # 根据时间戳推断 timeframe
                    ts_str = sample.get("t", "")
                    timeframe = _infer_timeframe_from_bars(bars)
                    return "bars", symbol, timeframe, bars

    # 检查是否是 options bars 格式 (类似但 symbol 是 OCC 格式)
    if isinstance(bars_obj, dict):
        for symbol, bars in bars_obj.items():
            if isinstance(bars, list) and bars:
                sample = bars[0]
                if isinstance(sample, dict) and "t" in sample:
                    timeframe = _infer_timeframe_from_bars(bars)
                    return "options_bars", symbol, timeframe, bars

    return "unknown", None, None, []


def _infer_timeframe_from_bars(bars: List[Dict]) -> str:
    """根据 bars 时间间隔推断 timeframe。"""
    if len(bars) < 2:
        return "1Min"  # 默认

    try:
        t1 = parse_iso_timestamp(bars[0].get("t"))
        t2 = parse_iso_timestamp(bars[1].get("t"))
        if t1 and t2:
            delta = (t2 - t1).total_seconds()
            if delta == 60:
                return "1Min"
            elif delta == 300:
                return "5Min"
            elif delta == 900:
                return "15Min"
            elif delta == 1800:
                return "30Min"
            elif delta == 3600:
                return "1Hour"
            elif delta >= 86400:
                return "1Day"
    except Exception:
        pass

    return "1Min"  # 默认


# ============================================================
# 异步数据库操作
# ============================================================

async def get_db_pool():
    if not ASYNCPG_AVAILABLE:
        return None
    try:
        return await asyncpg.create_pool(
            host=DB_HOST, port=DB_PORT, user=DB_USER,
            password=DB_PASSWORD, database=DB_NAME,
            min_size=2, max_size=5, command_timeout=60,
        )
    except Exception as e:
        print(f"[Migrate] DB connection failed: {e}")
        return None


async def copy_bars_to_db(pool, records: List[Tuple]) -> int:
    """批量写入 bars，使用 ON CONFLICT DO NOTHING 跳过重复。"""
    if pool is None or not records:
        return 0
    # 去重：同一个 (symbol, timeframe, ts) 保留最后出现的记录
    seen = {}
    for rec in records:
        key = (rec[0], rec[1], rec[2])  # symbol, timeframe, ts
        seen[key] = rec
    deduped = list(seen.values())

    async with pool.acquire() as conn:
        # 使用 executemany + ON CONFLICT DO NOTHING 避免重复键错误
        result = await conn.executemany(
            """
            INSERT INTO bars (symbol, timeframe, ts, open, high, low, close, volume, vwap, trade_count, feed, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (symbol, timeframe, ts) DO NOTHING
            """,
            deduped,
        )
    return len(deduped)


async def copy_options_bars_to_db(pool, records: List[Tuple]) -> int:
    if pool is None or not records:
        return 0
    async with pool.acquire() as conn:
        await conn.copy_records_to_table(
            "options_bars",
            records=records,
            columns=[
                "symbol", "root_symbol", "expiration_date", "strike_price", "option_type",
                "timeframe", "ts", "open", "high", "low", "close", "volume",
                "vwap", "trade_count", "open_interest", "feed", "source",
            ],
        )
    return len(records)


# ============================================================
# 主流程
# ============================================================

async def main():
    parser = argparse.ArgumentParser(description="Migrate disk cache to TimescaleDB")
    parser.add_argument("--cache-dir", default=CACHE_DIR, help="Cache directory")
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    parser.add_argument("--batch-size", type=int, default=10000, help="COPY batch size")
    parser.add_argument("--limit", type=int, default=0, help="Limit files to process (0 = all)")
    parser.add_argument("--workers", type=int, default=4, help="Parallel file readers")
    args = parser.parse_args()

    print("=" * 60)
    print("Cache to TimescaleDB Migration")
    print("=" * 60)
    print(f"Cache dir: {args.cache_dir}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"Batch size: {args.batch_size}")

    # 连接 DB
    pool = await get_db_pool()
    if pool is None:
        print("[Migrate] DB not available, exiting")
        return

    # 扫描文件
    print(f"\n[Migrate] Scanning {args.cache_dir}...")
    all_files = find_all_cache_files(args.cache_dir)
    print(f"[Migrate] Found {len(all_files)} cache files")

    if args.limit > 0:
        all_files = all_files[:args.limit]
        print(f"[Migrate] Limited to {args.limit} files")

    # 统计
    total_files = 0
    total_bars_files = 0
    total_options_files = 0
    total_skipped = 0
    total_bars = 0
    total_records_inserted = 0

    # 收集所有 records
    all_bar_records: List[Tuple] = []
    all_options_records: List[Tuple] = []

    start_time = time.time()

    for i, filepath in enumerate(all_files):
        if (i + 1) % 1000 == 0:
            elapsed = time.time() - start_time
            print(f"[Migrate] Processed {i+1}/{len(all_files)} files ({elapsed:.1f}s)...")

        result = read_cache_file(filepath)
        if result is None:
            total_skipped += 1
            continue

        meta, data = result
        total_files += 1

        data_type, symbol, timeframe, bars = classify_cache_data(data)

        if data_type == "bars" and symbol and bars:
            records = bars_to_records(symbol, timeframe or "1Min", bars)
            if records:
                all_bar_records.extend(records)
                total_bars_files += 1
                total_bars += len(bars)

                # 批量写入
                if len(all_bar_records) >= args.batch_size:
                    if not args.dry_run:
                        inserted = await copy_bars_to_db(pool, all_bar_records)
                        total_records_inserted += inserted
                    all_bar_records = []

        elif data_type == "options_bars" and symbol and bars:
            # TODO: 期权 bars 需要 root_symbol, expiration_date 等额外字段
            # 暂时跳过，或者简单处理
            total_options_files += 1

    # 写入剩余 records
    if all_bar_records and not args.dry_run:
        inserted = await copy_bars_to_db(pool, all_bar_records)
        total_records_inserted += inserted

    # 关闭 DB
    await pool.close()

    elapsed = time.time() - start_time

    print("\n" + "=" * 60)
    print("Migration Summary")
    print("=" * 60)
    print(f"Files scanned: {len(all_files)}")
    print(f"Files parsed: {total_files}")
    print(f"Bars files: {total_bars_files}")
    print(f"Options files: {total_options_files}")
    print(f"Skipped: {total_skipped}")
    print(f"Total bars: {total_bars}")
    print(f"Records inserted: {total_records_inserted}")
    print(f"Time: {elapsed:.1f}s ({total_bars / elapsed:.0f} bars/s)")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
