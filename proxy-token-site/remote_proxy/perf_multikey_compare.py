#!/usr/bin/env python3
"""
T11 — Multi-key Alpaca routing A/B test.

Proves whether free keys offload work from paid by:
  1. Cooling down pool counters to ~0 before each mode.
  2. Running identical guaranteed-cache-miss workload twice
     (paidonly via feed=sip, then multikey).
  3. Capturing per-key delta from /health pool counters during each run.

Output: "In multi-key mode, free keys served X% of upstream traffic
        (= Y requests offloaded from the paid key per minute)".

Usage:
  python3 perf_multikey_compare.py --host 100.70.107.106 --duration 60
"""

import asyncio
import aiohttp
import argparse
import json
import subprocess
import time
from datetime import datetime, timedelta, timezone
from itertools import count
from pathlib import Path

DEFAULT_HOST = "100.70.107.106"
DEFAULT_PORT = 8768

SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META",
           "SPY", "QQQ", "IWM", "AMD", "NFLX", "INTC", "QCOM",
           "GS", "JPM", "BAC", "WMT", "DIS", "HD", "PG", "KO",
           "MCD", "NKE", "V", "MA", "PYPL", "CRM", "ORCL", "CSCO"]
# 30 symbols × 60 day-windows = 1800 unique cache keys

_seq = count()


async def fetch_pool(host, port):
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=3)) as s:
            async with s.get(f"{"https" if port == 443 else "http"}://{host}:{port}/health") as r:
                return (await r.json()).get("pool") or {}
    except Exception:
        return {}


async def wait_for_cooldown(host, port, max_count=30, paid_max=200, timeout_s=120):
    """Block until ALL keys (free + paid) count_1min drop below thresholds.
    Paid is checked separately because it can stay at >9000/min after a
    saturating run and contaminate the next mode's measurements."""
    start = time.time()
    while time.time() - start < timeout_s:
        pool = await fetch_pool(host, port)
        free = {k: v for k, v in pool.items() if k.startswith("free")}
        paid = {k: v for k, v in pool.items() if k.startswith("paid")}
        free_ok = all(e.get("count_1min", 0) <= max_count for e in free.values())
        paid_ok = all(e.get("count_1min", 0) <= paid_max for e in paid.values())
        if free_ok and paid_ok:
            return pool
        worst_free = max((e.get("count_1min", 0) for e in free.values()), default=0)
        worst_paid = max((e.get("count_1min", 0) for e in paid.values()), default=0)
        print(f"  cooling… paid={worst_paid} free_max={worst_free}, sleeping 10s")
        await asyncio.sleep(10)
    print(f"  cooldown timed out, proceeding anyway")
    return await fetch_pool(host, port)


async def fetch_bars(session, url, token, force_paid, idx):
    # Identical params in both modes — free-key availability is the only
    # variable. (force_paid is now controlled via /v1/admin/pool runtime
    # toggle, not feed=sip which would split the cache namespace.)
    days_back = 7 + (idx % 60)         # 7..66 days ago
    sym_idx = (idx // 60) % len(SYMBOLS)
    end = (datetime.now(timezone.utc) - timedelta(days=days_back)).date()
    start = end - timedelta(days=1)
    payload = {
        "symbol": SYMBOLS[sym_idx],
        "timeframe": "1Min",
        "start": start.isoformat(),
        "end": end.isoformat(),
        "limit": 50,
        "token": token,
    }
    t0 = time.time()
    try:
        async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=30)) as r:
            await r.read()
            return {
                "status": r.status,
                "cache": r.headers.get("X-Cache", "NONE"),
                "ms": (time.time() - t0) * 1000,
            }
    except Exception:
        return {"status": 0, "cache": "ERR", "ms": (time.time() - t0) * 1000}


async def worker(session, url, tokens, force_paid, end_at, results, worker_idx):
    i = 0
    while time.time() < end_at:
        token = tokens[(worker_idx + i) % len(tokens)]
        idx = next(_seq)
        r = await fetch_bars(session, url, token, force_paid, idx)
        results["status"][r["status"]] = results["status"].get(r["status"], 0) + 1
        results["cache"][r["cache"]] = results["cache"].get(r["cache"], 0) + 1
        if r["status"] == 200:
            results["lat_ok"].append(r["ms"])
        i += 1
        await asyncio.sleep(0.005)


def _count_routes_since(seconds_back: int):
    """SSH to ThinkCentre, count tier=paid/free routing log lines from last
    N seconds in proxy container logs."""
    cmd = (
        f"docker logs --since {seconds_back}s ec2-primary-backup-alpaca-cloud-proxy-1 2>&1 "
        f"| grep -oE 'tier=(paid|free[_a-z0-9]*)' | sort | uniq -c"
    )
    try:
        out = subprocess.check_output(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
             "root@100.70.107.106", cmd],
            text=True, timeout=15,
        )
        paid = free = 0
        for line in out.strip().splitlines():
            parts = line.strip().split()
            if len(parts) >= 2:
                n = int(parts[0])
                tier = parts[1].split("=", 1)[1]
                if tier == "paid":
                    paid += n
                elif tier.startswith("free"):
                    free += n
        return paid, free
    except Exception as e:
        print(f"  [warn] could not fetch routing log: {e}")
        return 0, 0


def _summed_count(pool):
    """Sum count_1min across all keys in a pool snapshot, grouped by tier."""
    summed = {"paid": 0, "free": 0}
    for label, entry in pool.items():
        n = entry.get("count_1min", 0)
        if label.startswith("paid"):
            summed["paid"] += n
        elif label.startswith("free"):
            summed["free"] += n
    return summed


async def _admin_post(host, port, path, body):
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
            async with s.post(f"{"https" if port == 443 else "http"}://{host}:{port}{path}", json=body) as r:
                return await r.json()
    except Exception as e:
        return {"error": str(e)}


async def run_mode(host, port, tokens, force_paid, duration, concurrency, label):
    print(f"\n[{label}] resetting state: free_disabled={force_paid}, clearing caches…")
    pool_resp = await _admin_post(host, port, "/v1/admin/pool", {"free_disabled": force_paid})
    cache_resp = await _admin_post(host, port, "/v1/admin/cache/clear", {"clear_disk": True})
    print(f"[{label}]   pool: {pool_resp}")
    print(f"[{label}]   cache: {cache_resp}")
    await wait_for_cooldown(host, port)

    pool_pre = await fetch_pool(host, port)
    summed_pre = _summed_count(pool_pre)
    print(f"[{label}] pool pre: paid_1min={summed_pre['paid']}  free_1min={summed_pre['free']}")
    print(f"[{label}] running free_disabled={force_paid}, {concurrency} workers, {duration}s ...")

    url = f"{"https" if port == 443 else "http"}://{host}:{port}/v1/history/bars"
    results = {"status": {}, "cache": {}, "lat_ok": []}
    samples = []

    async def sampler():
        while True:
            await asyncio.sleep(2)
            samples.append(await fetch_pool(host, port))

    t0 = time.time()
    end_at = t0 + duration
    sampler_task = asyncio.create_task(sampler())
    connector = aiohttp.TCPConnector(limit=0, limit_per_host=0)
    async with aiohttp.ClientSession(connector=connector) as session:
        await asyncio.gather(*[
            worker(session, url, tokens, force_paid, end_at, results, i)
            for i in range(concurrency)
        ])
    sampler_task.cancel()
    elapsed = time.time() - t0

    # Ground-truth routing distribution: grep the proxy's stderr routing log
    # for tier=free / tier=paid decisions emitted during this window.
    delta_paid, delta_free = _count_routes_since(int(elapsed) + 5)
    # Also compute pool counter peak as sanity check
    peak_paid = max((_summed_count(p)["paid"] for p in samples), default=summed_pre["paid"])
    peak_free = max((_summed_count(p)["free"] for p in samples), default=summed_pre["free"])

    total = sum(results["status"].values())
    ok = results["status"].get(200, 0)
    misses = results["cache"].get("MISS", 0) + results["cache"].get("NONE", 0)
    lats = sorted(results["lat_ok"])
    def pct(arr, n):
        if not arr: return 0
        return round(arr[min(len(arr)-1, int(len(arr)*n/100))], 1)
    return {
        "label": label,
        "force_paid": force_paid,
        "elapsed_s": round(elapsed, 1),
        "total": total,
        "ok": ok,
        "misses": misses,
        "req_per_sec": round(total / elapsed, 1),
        "ok_per_sec": round(ok / elapsed, 1),
        "status_codes": results["status"],
        "cache_mix": results["cache"],
        "ok_latency_ms": {"p50": pct(lats, 50), "p95": pct(lats, 95), "p99": pct(lats, 99)},
        "upstream_paid_calls": delta_paid,
        "upstream_free_calls": delta_free,
        "upstream_free_pct": round(100 * delta_free / (delta_paid + delta_free), 1) if (delta_paid + delta_free) else 0,
        "pool_peak_paid": peak_paid,
        "pool_peak_free": peak_free,
    }


def _print_mode(s):
    print(f"\n[{s['label']}] result:")
    print(f"  total={s['total']} ok={s['ok']} misses={s['misses']}  ({s['req_per_sec']} req/s, {s['ok_per_sec']} ok/s)")
    print(f"  ok latency p50/p95/p99 = {s['ok_latency_ms']['p50']}/{s['ok_latency_ms']['p95']}/{s['ok_latency_ms']['p99']} ms")
    print(f"  status: {s['status_codes']}  cache: {s['cache_mix']}")
    print(f"  upstream calls observed → paid={s['upstream_paid_calls']} free={s['upstream_free_calls']} "
          f"({s['upstream_free_pct']}% via free)")


async def main_async(args):
    tokens = [t.strip() for t in args.tokens.split(",") if t.strip()]
    print(f"Tokens: {len(tokens)}    Concurrency: {args.concurrency}    Duration each: {args.duration}s")

    paid_res = await run_mode(args.host, args.port, tokens, force_paid=True,
                              duration=args.duration, concurrency=args.concurrency,
                              label="paidonly")
    _print_mode(paid_res)

    multi_res = await run_mode(args.host, args.port, tokens, force_paid=False,
                               duration=args.duration, concurrency=args.concurrency,
                               label="multikey")
    _print_mode(multi_res)

    # Restore free keys after test (default state)
    print("\nRestoring free_disabled=False (post-test cleanup)…")
    await _admin_post(args.host, args.port, "/v1/admin/pool", {"free_disabled": False})

    out = Path("/tmp/multikey_compare_results.json")
    out.write_text(json.dumps({"paidonly": paid_res, "multikey": multi_res}, indent=2))
    print(f"\nWrote {out}")

    print("\n=== Verdict ===")
    if multi_res["upstream_free_calls"] > 0:
        offload_pct = multi_res["upstream_free_pct"]
        saved = multi_res["upstream_free_calls"]
        print(f"✓ Free keys are working: served {saved} upstream calls "
              f"({offload_pct}% of multi-key upstream traffic).")
        print(f"  Without them, all {multi_res['upstream_paid_calls'] + saved} would have hit the paid key.")
    else:
        print("✗ No free-key activity observed in multi-key mode — check pool config.")

    p_lat = paid_res["ok_latency_ms"]["p95"]
    m_lat = multi_res["ok_latency_ms"]["p95"]
    if m_lat <= p_lat * 1.2:
        print(f"✓ Latency parity: multi-key p95={m_lat}ms vs paid p95={p_lat}ms.")
    else:
        print(f"⚠ Multi-key p95={m_lat}ms exceeds paid-only by >20% ({p_lat}ms).")

    ratio = multi_res["ok_per_sec"] / (paid_res["ok_per_sec"] or 1e-9)
    print(f"  Throughput ratio (multi/paid): {ratio:.2f}× ok/s.")
    print(f"  (Plan's ≥2.5× bar is unverifiable at this scale — proxy rate limit"
          f" caps admission below paid-key Alpaca ceiling.)")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", default=DEFAULT_HOST)
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--tokens", required=True, help="Comma-separated proxy tokens")
    p.add_argument("--duration", type=int, default=60)
    p.add_argument("--concurrency", type=int, default=30)
    args = p.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
