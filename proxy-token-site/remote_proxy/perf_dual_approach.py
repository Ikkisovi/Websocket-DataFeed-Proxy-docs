#!/usr/bin/env python3
"""
perf_dual_approach.py — 双路径性能对比测试

测试场景（全部只读，不修改任何配置）：
┌─────────────────────────────────────────────────────────────────────────────┐
│ 路径 A: 当前架构（EC2 公网入口）                                             │
│  User ──公网──→ EC2:8768 ──Caddy──→ Tailscale ──→ ThinkCentre:8768 ──→ DB │
├─────────────────────────────────────────────────────────────────────────────┤
│ 路径 B: Tailscale 直连（模拟内网用户）                                        │
│  User ──Tailscale──→ ThinkCentre:8768 ──→ DB                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ 路径 C: Tailscale Serve HTTPS（如果已启用）                                   │
│  User ──Tailscale──→ ThinkCentre:443 ──serve──→ Proxy:8768 ──→ DB          │
└─────────────────────────────────────────────────────────────────────────────┘

三种数据命中场景：
  1. CACHE_HIT   — 请求同一 symbol 多次，命中 Redis/Memory cache
  2. DB_HIT      — 请求不同 symbols（cache miss，DB 命中，不上游）
  3. UPSTREAM    — force_refresh=true（强制走 Alpaca 上游，对比基准）

运行方式:
    python3 perf_dual_approach.py --token <token> --approach all
    python3 perf_dual_approach.py --token <token> --approach ec2 --scenario db_hit
    python3 perf_dual_approach.py --token <token> --approach tailscale --iterations 50
"""

import argparse
import asyncio
import json
import statistics
import time
from typing import Dict, List, Tuple

import aiohttp

# ── 配置 ──
EC2_PUBLIC = "52.37.182.24"
EC2_REST_PORT = 8768
THINKCENTRE_TAILSCALE_IP = "100.70.107.106"
THINKCENTRE_REST_PORT = 8768
THINKCENTRE_SERVE_PORT = 443  # tailscale serve HTTPS (如果启用)

# DB 中有数据的 symbols（基于 cache_to_db 迁移结果）
DB_SYMBOLS = [
    "SPY", "QQQ", "IWM", "TSLA", "NVDA", "AMZN", "TLT", "XLF", "AAPL",
    "META", "GOOGL", "MSFT", "AMD", "JPM", "WMT", "JNJ", "XOM", "VZ",
    "PFE", "COST", "NFLX", "CRM", "ADBE", "ORCL", "IBM", "CSCO", "QCOM"
]

# 用于 CACHE_HIT 测试的固定 symbol（请求多次）
CACHE_HIT_SYMBOL = "SPY"

# 日期范围（确保在 DB 覆盖范围内）
TEST_START = "2026-05-15"
TEST_END = "2026-05-16"
TEST_TIMEFRAME = "1Min"
TEST_LIMIT = 100


def percentile(sorted_vals: List[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    idx = min(int(len(sorted_vals) * p / 100.0), len(sorted_vals) - 1)
    return sorted_vals[idx]


def print_latency_stats(name: str, times_ms: List[float]):
    if not times_ms:
        print(f"  {name}: (no data)")
        return
    s = sorted(times_ms)
    print(f"  {name}: count={len(times_ms)}, p50={percentile(s, 50):.1f}ms, "
          f"p95={percentile(s, 95):.1f}ms, p99={percentile(s, 99):.1f}ms, max={max(times_ms):.1f}ms")


# ── 测试核心 ──

async def single_request(
    session: aiohttp.ClientSession,
    base_url: str,
    token: str,
    symbol: str,
    start: str,
    end: str,
    timeframe: str = TEST_TIMEFRAME,
    limit: int = TEST_LIMIT,
    force_refresh: bool = False,
) -> Tuple[int, str, float, int]:
    """
    发送单个请求，返回 (status, cache_header, latency_ms, bars_count)。
    """
    payload = {
        "token": token,
        "symbol": symbol,
        "timeframe": timeframe,
        "start": start,
        "end": end,
        "limit": limit,
    }
    if force_refresh:
        payload["force_refresh"] = True

    t0 = time.perf_counter()
    async with session.post(base_url, json=payload) as resp:
        body = await resp.json()
        elapsed = (time.perf_counter() - t0) * 1000
        cache = resp.headers.get("X-Cache", "UNKNOWN")
        bars = body.get("bars", {}).get(symbol, [])
        return resp.status, cache, elapsed, len(bars)


# ── 场景 1: CACHE_HIT ──

async def test_cache_hit(session: aiohttp.ClientSession, base_url: str, token: str, iterations: int) -> Dict[str, List[float]]:
    """
    反复请求同一 symbol，测量 CACHE_HIT 延迟。
    第一次可能是 DB_HIT 或 MISS，后续应为 CACHE_HIT。
    """
    print(f"\n[Cache HIT] {iterations} iterations, same symbol ({CACHE_HIT_SYMBOL})")
    results = {"first": [], "hit": []}

    for i in range(iterations):
        status, cache, elapsed, count = await single_request(
            session, base_url, token, CACHE_HIT_SYMBOL, TEST_START, TEST_END
        )
        if i == 0:
            results["first"].append(elapsed)
            print(f"  Request 1: status={status}, cache={cache}, time={elapsed:.1f}ms, bars={count}")
        else:
            results["hit"].append(elapsed)

    print_latency_stats("First request (DB_HIT or MISS)", results["first"])
    print_latency_stats("Subsequent (CACHE_HIT)", results["hit"])
    return results


# ── 场景 2: DB_HIT (cache miss, DB has data) ──

async def test_db_hit(session: aiohttp.ClientSession, base_url: str, token: str, iterations: int) -> List[float]:
    """
    请求不同的 symbols（每个只请求一次），确保 cache miss 但 DB hit。
    通过并发请求不同 symbol 来避免 in-flight coalescing 干扰。
    """
    symbols = DB_SYMBOLS[:iterations]
    print(f"\n[DB HIT] {len(symbols)} unique symbols (cache miss, DB has data)")
    times = []

    for sym in symbols:
        status, cache, elapsed, count = await single_request(
            session, base_url, token, sym, TEST_START, TEST_END
        )
        times.append(elapsed)
        if len(times) <= 3 or len(times) == len(symbols):
            print(f"  {sym}: status={status}, cache={cache}, time={elapsed:.1f}ms, bars={count}")

    print_latency_stats("DB_HIT (no cache)", times)
    return times


# ── 场景 3: UPSTREAM (force_refresh, bypass all caches) ──

async def test_upstream(session: aiohttp.ClientSession, base_url: str, token: str, iterations: int) -> List[float]:
    """
    force_refresh=true 强制走 Alpaca 上游，作为性能基准。
    注意: 如果 Alpaca keys 未配置，会返回 429。
    """
    print(f"\n[UPSTREAM] {iterations} requests with force_refresh=true")
    print("  WARNING: This will hit Alpaca API rate limits quickly!")
    times = []
    errors = 0

    for i in range(iterations):
        status, cache, elapsed, count = await single_request(
            session, base_url, token, CACHE_HIT_SYMBOL, TEST_START, TEST_END,
            force_refresh=True
        )
        times.append(elapsed)
        if status != 200:
            errors += 1
        if i < 3:
            print(f"  Req {i+1}: status={status}, cache={cache}, time={elapsed:.1f}ms")

    print_latency_stats(f"UPSTREAM ({errors} errors)", times)
    return times


# ── 场景 4: 并发吞吐量 ──

async def test_concurrent(session: aiohttp.ClientSession, base_url: str, token: str,
                          workers: int, requests_per_worker: int) -> Dict[str, List[float]]:
    """
    并发测试: workers 个并发客户端，每个发送 requests_per_worker 个请求。
    混合 CACHE_HIT（重复请求）和 DB_HIT（不同 symbols）。
    """
    print(f"\n[Concurrent] {workers} workers × {requests_per_worker} requests = {workers * requests_per_worker} total")
    print("  Mix: 70% CACHE_HIT + 30% DB_HIT")

    hit_times = []
    db_times = []
    errors = 0
    sem = asyncio.Semaphore(workers)

    async def worker_task(worker_id: int):
        nonlocal errors
        sym = DB_SYMBOLS[worker_id % len(DB_SYMBOLS)]
        local_hit = []
        local_db = []
        local_err = 0

        for i in range(requests_per_worker):
            # 70% cache hit (same symbol), 30% db hit (rotate symbols)
            use_cache_hit = (i % 10) < 7
            test_sym = CACHE_HIT_SYMBOL if use_cache_hit else DB_SYMBOLS[(worker_id + i) % len(DB_SYMBOLS)]

            status, cache, elapsed, count = await single_request(
                session, base_url, token, test_sym, TEST_START, TEST_END
            )

            if status != 200:
                local_err += 1
            elif cache in ("HIT", "DISK_HIT"):
                local_hit.append(elapsed)
            elif cache == "DB_HIT":
                local_db.append(elapsed)
            else:
                # MISS or COALESCED — count as upstream
                pass

        return local_hit, local_db, local_err

    tasks = [worker_task(i) for i in range(workers)]
    results = await asyncio.gather(*tasks)

    for h, d, e in results:
        hit_times.extend(h)
        db_times.extend(d)
        errors += e

    total_ok = len(hit_times) + len(db_times)
    total = workers * requests_per_worker
    print(f"  Completed: {total_ok}/{total} OK, {errors} errors")
    print_latency_stats("CACHE_HIT", hit_times)
    print_latency_stats("DB_HIT", db_times)

    # 吞吐量
    # 由于 async 并发，实际时间不是 workers * requests * latency
    # 这里简化计算: 总请求数 / 最快 worker 完成时间不太准确
    # 更好的方式是在外层计时
    return {"hit": hit_times, "db": db_times, "errors": errors}


# ── 路径对比 ──

async def test_approach(approach: str, token: str, scenario: str, iterations: int,
                        workers: int, requests_per_worker: int) -> Dict:
    """测试指定路径的所有场景。"""

    if approach == "ec2":
        base_url = f"http://{EC2_PUBLIC}:{EC2_REST_PORT}/v1/history/bars"
        label = "EC2 Public (current)"
    elif approach == "tailscale":
        base_url = f"http://{THINKCENTRE_TAILSCALE_IP}:{THINKCENTRE_REST_PORT}/v1/history/bars"
        label = "Tailscale Direct (private)"
    elif approach == "serve":
        base_url = f"https://{THINKCENTRE_TAILSCALE_IP}:{THINKCENTRE_SERVE_PORT}/v1/history/bars"
        label = "Tailscale Serve HTTPS"
    else:
        raise ValueError(f"Unknown approach: {approach}")

    print("\n" + "=" * 60)
    print(f"Approach: {label}")
    print(f"URL: {base_url}")
    print("=" * 60)

    results = {"approach": approach, "url": base_url}

    async with aiohttp.ClientSession() as session:
        # 先 warm-up: 发一个请求确保连接建立（用不测试的 symbol）
        try:
            await single_request(session, base_url, token, "WARMUP", TEST_START, TEST_END)
        except Exception as e:
            print(f"  Warm-up failed: {e}")
            return results

        if scenario in ("all", "cache_hit"):
            results["cache_hit"] = await test_cache_hit(session, base_url, token, iterations)

        if scenario in ("all", "db_hit"):
            results["db_hit"] = await test_db_hit(session, base_url, token, iterations)

        if scenario in ("all", "upstream"):
            # 限制 upstream 测试次数，避免触发限流
            up_iter = min(iterations, 5)
            results["upstream"] = await test_upstream(session, base_url, token, up_iter)

        if scenario in ("all", "concurrent"):
            t0 = time.perf_counter()
            results["concurrent"] = await test_concurrent(
                session, base_url, token, workers, requests_per_worker
            )
            total_time = time.perf_counter() - t0
            total_reqs = workers * requests_per_worker
            print(f"\n  Total throughput: {total_reqs / total_time:.1f} req/s")
            results["throughput_rps"] = total_reqs / total_time

    return results


# ── 主流程 ──

async def main():
    parser = argparse.ArgumentParser(description="Dual-approach performance comparison")
    parser.add_argument("--token", required=True, help="Proxy auth token")
    parser.add_argument("--approach", choices=["ec2", "tailscale", "serve", "all"],
                        default="all", help="Which path to test")
    parser.add_argument("--scenario", choices=["cache_hit", "db_hit", "upstream", "concurrent", "all"],
                        default="all", help="Which scenario")
    parser.add_argument("--iterations", type=int, default=20, help="Iterations per test")
    parser.add_argument("--workers", type=int, default=10, help="Concurrent workers")
    parser.add_argument("--requests-per-worker", type=int, default=20, help="Requests per worker")
    args = parser.parse_args()

    print("=" * 60)
    print("Dual-Approach Performance Test")
    print("=" * 60)
    print(f"Token: {'*' * 8}")
    print(f"Scenarios: {args.scenario}")
    print(f"Iterations: {args.iterations}")
    print()
    print("WARNING: This is a READ-ONLY test. No config changes.")
    print("=" * 60)

    all_results = {}

    approaches = ["ec2", "tailscale"]
    if args.approach != "all":
        approaches = [args.approach]

    for approach in approaches:
        try:
            result = await test_approach(
                approach, args.token, args.scenario,
                args.iterations, args.workers, args.requests_per_worker
            )
            all_results[approach] = result
        except Exception as e:
            print(f"\n[ERROR] {approach} test failed: {e}")
            all_results[approach] = {"error": str(e)}

    # 汇总对比
    print("\n" + "=" * 60)
    print("Cross-Approach Comparison")
    print("=" * 60)

    for approach, result in all_results.items():
        if "error" in result:
            print(f"\n{approach.upper()}: FAILED ({result['error']})")
            continue

        print(f"\n{approach.upper()}:")
        if "cache_hit" in result and result["cache_hit"]:
            ch = result["cache_hit"]
            if ch.get("hit"):
                s = sorted(ch["hit"])
                print(f"  CACHE_HIT p95: {percentile(s, 95):.1f}ms")
        if "db_hit" in result and result["db_hit"]:
            s = sorted(result["db_hit"])
            print(f"  DB_HIT    p95: {percentile(s, 95):.1f}ms")
        if "upstream" in result and result["upstream"]:
            s = sorted(result["upstream"])
            print(f"  UPSTREAM  p95: {percentile(s, 95):.1f}ms")
        if "throughput_rps" in result:
            print(f"  Throughput:    {result['throughput_rps']:.1f} req/s")

    print("\n" + "=" * 60)
    print("Key Findings")
    print("=" * 60)

    ec2_db = all_results.get("ec2", {}).get("db_hit", [])
    ts_db = all_results.get("tailscale", {}).get("db_hit", [])

    if ec2_db and ts_db:
        ec2_p95 = percentile(sorted(ec2_db), 95)
        ts_p95 = percentile(sorted(ts_db), 95)
        delta = ec2_p95 - ts_p95
        print(f"\nTailscale Direct vs EC2 Public:")
        print(f"  DB_HIT p95: EC2={ec2_p95:.1f}ms, Tailscale={ts_p95:.1f}ms, delta={delta:+.1f}ms")
        if delta > 10:
            print(f"  → Tailscale Direct saves ~{delta:.0f}ms by bypassing EC2+Caddy")
        elif delta < -10:
            print(f"  → EC2 Public is ~{abs(delta):.0f}ms faster (unexpected)")
        else:
            print(f"  → No significant difference (network variance)")

    print("\n" + "=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
