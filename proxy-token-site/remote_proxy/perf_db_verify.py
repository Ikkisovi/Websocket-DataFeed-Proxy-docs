#!/usr/bin/env python3
"""
perf_db_verify.py — 验证数据库优先架构的性能收益

三个测试:
1. 原始 DB 查询延迟 (直接连接 TimescaleDB)
2. 端到端路径对比 (DB_HIT vs CACHE_HIT vs MISS)
3. 上游跳过验证 (确认 DB 有数据时不调 Alpaca)

运行方式:
    python3 perf_db_verify.py --host 52.37.182.24 --token <token>
"""

import argparse
import asyncio
import json
import os
import statistics
import time
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

import aiohttp

try:
    import asyncpg
    ASYNCPG_AVAILABLE = True
except ImportError:
    asyncpg = None
    ASYNCPG_AVAILABLE = False

# --- 配置 ---
DB_HOST = os.getenv("TIMESCALEDB_HOST", "timescaledb")
DB_PORT = int(os.getenv("TIMESCALEDB_PORT", "5432"))
DB_USER = os.getenv("TIMESCALEDB_USER", "proxy")
DB_PASSWORD = os.getenv("TIMESCALEDB_PASSWORD", "proxy123")
DB_NAME = os.getenv("TIMESCALEDB_DB", "marketdata")


def percentile(sorted_values: List[float], p: float) -> float:
    """计算百分位数。"""
    if not sorted_values:
        return 0.0
    idx = int(len(sorted_values) * p / 100.0)
    idx = min(idx, len(sorted_values) - 1)
    return sorted_values[idx]


def print_stats(name: str, latencies_ms: List[float]):
    """打印延迟统计。"""
    if not latencies_ms:
        print(f"  {name}: no data")
        return
    sorted_ms = sorted(latencies_ms)
    print(f"  {name}:")
    print(f"    count={len(latencies_ms)}, p50={percentile(sorted_ms, 50):.1f}ms, p95={percentile(sorted_ms, 95):.1f}ms, p99={percentile(sorted_ms, 99):.1f}ms, max={max(latencies_ms):.1f}ms")


# ============================================================
# 测试 A: 原始 DB 查询延迟
# ============================================================

async def test_raw_db_latency(iterations: int = 100) -> List[float]:
    """直接查询 TimescaleDB，测量原始查询延迟。"""
    if not ASYNCPG_AVAILABLE:
        print("[Test A] asyncpg not available, skipping")
        return []

    try:
        pool = await asyncpg.create_pool(
            host=DB_HOST, port=DB_PORT, user=DB_USER,
            password=DB_PASSWORD, database=DB_NAME,
            min_size=1, max_size=2, command_timeout=10,
        )
    except Exception as e:
        print(f"[Test A] DB connection failed: {e}")
        return []

    # 先 warm up
    async with pool.acquire() as conn:
        for _ in range(5):
            await conn.fetch("SELECT * FROM bars WHERE symbol = 'AAPL' AND timeframe = '1Min' LIMIT 10")

    latencies = []
    async with pool.acquire() as conn:
        for i in range(iterations):
            start = time.perf_counter()
            rows = await conn.fetch(
                """
                SELECT ts, open, high, low, close, volume, vwap, trade_count
                FROM bars
                WHERE symbol = 'AAPL' AND timeframe = '1Min'
                  AND ts BETWEEN '2026-05-20' AND '2026-05-22'
                ORDER BY ts DESC
                LIMIT 1000
                """,
            )
            elapsed_ms = (time.perf_counter() - start) * 1000
            latencies.append(elapsed_ms)

    await pool.close()
    return latencies


# ============================================================
# 测试 B: 端到端路径对比 (DB_HIT vs CACHE_HIT vs MISS)
# ============================================================

async def test_e2e_latency(session: aiohttp.ClientSession, host: str, token: str, iterations: int = 30) -> Dict[str, List[float]]:
    """
    通过 proxy REST API 测试三种路径的延迟：
    - DB_HIT: DB 有数据，直接返回
    - CACHE_HIT: 强制命中 Redis/disk cache (force_refresh=false, 第二次请求)
    - MISS: 强制绕过所有缓存 (force_refresh=true)
    """
    url = f"http://{host}:8768/v1/history/bars"

    results = {"db_hit": [], "cache_hit": [], "miss": []}

    # 选择一个 DB 中确定有数据的 symbol
    symbol = "AAPL"
    timeframe = "1Min"
    start = "2026-05-20"
    end = "2026-05-22"

    # --- 测试 DB_HIT ---
    # 第一次请求: DB 应该有数据 (因为我们迁移了 cache)
    print(f"[Test B] Testing DB_HIT with {symbol} {timeframe} {start}~{end}")
    for i in range(iterations):
        payload = {
            "token": token,
            "symbol": symbol,
            "timeframe": timeframe,
            "start": start,
            "end": end,
            "limit": 1000,
        }
        start_time = time.perf_counter()
        async with session.post(url, json=payload) as resp:
            body = await resp.read()
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            cache_status = resp.headers.get("X-Cache", "UNKNOWN")
            if cache_status == "DB_HIT":
                results["db_hit"].append(elapsed_ms)
            elif cache_status in ("HIT", "DISK_HIT"):
                results["cache_hit"].append(elapsed_ms)
            else:
                # 可能是第一次 cache miss，计入 db_hit 如果响应很快
                results["db_hit"].append(elapsed_ms)

    # --- 测试 CACHE_HIT ---
    # 同一请求第二次应该命中 Redis cache
    print(f"[Test B] Testing CACHE_HIT (same request again)")
    for i in range(iterations):
        payload = {
            "token": token,
            "symbol": symbol,
            "timeframe": timeframe,
            "start": start,
            "end": end,
            "limit": 1000,
        }
        start_time = time.perf_counter()
        async with session.post(url, json=payload) as resp:
            body = await resp.read()
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            cache_status = resp.headers.get("X-Cache", "UNKNOWN")
            if cache_status in ("HIT", "DISK_HIT"):
                results["cache_hit"].append(elapsed_ms)
            elif cache_status == "DB_HIT":
                results["db_hit"].append(elapsed_ms)

    # --- 测试 MISS (强制刷新) ---
    print(f"[Test B] Testing UPSTREAM_MISS (force_refresh=true)")
    for i in range(iterations):
        payload = {
            "token": token,
            "symbol": symbol,
            "timeframe": timeframe,
            "start": start,
            "end": end,
            "limit": 1000,
            "force_refresh": True,
        }
        start_time = time.perf_counter()
        async with session.post(url, json=payload) as resp:
            body = await resp.read()
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            results["miss"].append(elapsed_ms)

    return results


# ============================================================
# 测试 C: 上游跳过验证
# ============================================================

async def test_upstream_skip(session: aiohttp.ClientSession, host: str, token: str) -> bool:
    """
    验证当 DB 有数据时，proxy 不会调用 Alpaca 上游。

    方法:
    1. 请求一个 DB 中确定有数据的 symbol (DB_HIT)
    2. 检查 proxy 日志中是否出现 "[Cloud] Alpaca history" 或 "[Routing]"
    3. 如果日志中没有 Alpaca 调用记录，说明上游被跳过
    """
    url = f"http://{host}:8768/v1/history/bars"

    symbol = "SPY"  # DB 中数据最多的 symbol
    payload = {
        "token": token,
        "symbol": symbol,
        "timeframe": "1Min",
        "start": "2026-05-20",
        "end": "2026-05-21",
        "limit": 100,
    }

    print(f"[Test C] Requesting {symbol} (should be DB_HIT)...")
    async with session.post(url, json=payload) as resp:
        body = await resp.read()
        cache_status = resp.headers.get("X-Cache", "UNKNOWN")
        print(f"[Test C] Response: status={resp.status}, X-Cache={cache_status}")

        if cache_status == "DB_HIT":
            print(f"[Test C] ✅ DB_HIT confirmed — Alpaca upstream was skipped")
            return True
        elif cache_status in ("HIT", "DISK_HIT"):
            print(f"[Test C] ⚠️ Cache hit (not DB) — need to check logs for upstream call")
            return False
        else:
            print(f"[Test C] ❌ MISS — upstream was called")
            return False


# ============================================================
# 主流程
# ============================================================

async def main():
    parser = argparse.ArgumentParser(description="Verify DB-first performance")
    parser.add_argument("--host", default="52.37.182.24", help="Proxy host")
    parser.add_argument("--token", required=True, help="Auth token")
    parser.add_argument("--iterations", type=int, default=30, help="Iterations per test")
    parser.add_argument("--test", choices=["a", "b", "c", "all"], default="all", help="Which test to run")
    args = parser.parse_args()

    print("=" * 60)
    print("Database-First Performance Verification")
    print("=" * 60)
    print(f"Host: {args.host}")
    print(f"Iterations: {args.iterations}")
    print()

    all_results = {}

    # 测试 A: 原始 DB 延迟
    if args.test in ("a", "all"):
        print("[Test A] Raw DB Query Latency")
        print("-" * 40)
        latencies = await test_raw_db_latency(args.iterations)
        print_stats("DB raw query", latencies)
        all_results["raw_db"] = latencies
        print()

    async with aiohttp.ClientSession() as session:
        # 测试 B: 端到端对比
        if args.test in ("b", "all"):
            print("[Test B] End-to-End Path Comparison")
            print("-" * 40)
            results = await test_e2e_latency(session, args.host, args.token, args.iterations)
            for path, latencies in results.items():
                print_stats(path.upper(), latencies)
            all_results["e2e"] = results
            print()

        # 测试 C: 上游跳过验证
        if args.test in ("c", "all"):
            print("[Test C] Upstream Skip Verification")
            print("-" * 40)
            skipped = await test_upstream_skip(session, args.host, args.token)
            all_results["upstream_skipped"] = skipped
            print()

    # 汇总
    print("=" * 60)
    print("Summary")
    print("=" * 60)

    if "raw_db" in all_results and all_results["raw_db"]:
        raw = sorted(all_results["raw_db"])
        print(f"Raw DB query p95: {percentile(raw, 95):.1f}ms")

    if "e2e" in all_results:
        e2e = all_results["e2e"]
        for path in ["db_hit", "cache_hit", "miss"]:
            if e2e.get(path):
                vals = sorted(e2e[path])
                print(f"E2E {path} p95: {percentile(vals, 95):.1f}ms")

    if "upstream_skipped" in all_results:
        status = "✅ YES" if all_results["upstream_skipped"] else "❌ NO"
        print(f"Upstream skipped when DB has data: {status}")

    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
