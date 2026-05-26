#!/usr/bin/env python3
"""
Upstream rate limit probe — finds the empirical Alpaca REST ceiling.

Run from local machine (no proxy involved).
Phase A: direct Alpaca REST  →  finds max sustained req/min before 429
Phase B: ThetaData via proxy →  finds effective ThetaData ceiling (uses cache)

Usage:
  python3 perf_upstream_probe.py                         # both phases
  python3 perf_upstream_probe.py --alpaca-only           # Phase A only
  python3 perf_upstream_probe.py --theta-only --token T  # Phase B only
  python3 perf_upstream_probe.py --rate 5 --duration 30  # custom steady rate
"""

import asyncio
import aiohttp
import argparse
import statistics
import time
from collections import Counter

G = "\033[92m"; Y = "\033[93m"; R = "\033[91m"; B = "\033[94m"; X = "\033[0m"

ALPACA_BARS_URL = "https://data.alpaca.markets/v2/stocks/bars"
PROBE_SYMBOL    = "AAPL"
PROBE_START     = "2025-01-02"   # Historical — immutable, never rate-limited at Alpaca data layer
PROBE_END       = "2025-01-03"


# ─── Alpaca direct helpers ──────────────────────────────────────────────────

async def _alpaca_one(session: aiohttp.ClientSession, key: str, secret: str, i: int):
    headers = {"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret}
    params  = {"symbols": PROBE_SYMBOL, "start": PROBE_START, "end": PROBE_END,
                "timeframe": "1Hour", "limit": 5}
    t0 = time.perf_counter()
    try:
        async with session.get(ALPACA_BARS_URL, headers=headers, params=params,
                               timeout=aiohttp.ClientTimeout(total=15)) as r:
            await r.read()
            return i, r.status, time.perf_counter() - t0
    except Exception:
        return i, 0, time.perf_counter() - t0


async def probe_alpaca_steady(key: str, secret: str, rate_per_sec: float,
                               duration_sec: int) -> dict:
    """Send requests at a steady rate for duration_sec, return stats."""
    interval = 1.0 / rate_per_sec
    total_planned = int(rate_per_sec * duration_sec)
    results = []
    connector = aiohttp.TCPConnector(limit=max(20, int(rate_per_sec) + 5))
    async with aiohttp.ClientSession(connector=connector) as session:
        start = time.perf_counter()
        tasks = []
        for i in range(total_planned):
            tasks.append(asyncio.create_task(_alpaca_one(session, key, secret, i)))
            await asyncio.sleep(interval)
        results = await asyncio.gather(*tasks)
    elapsed = time.perf_counter() - start
    return _summarise(results, elapsed, total_planned)


async def probe_alpaca_burst(key: str, secret: str, burst: int) -> dict:
    """Send burst requests as fast as possible (parallel)."""
    concurrency = min(burst, 30)
    connector = aiohttp.TCPConnector(limit=concurrency)
    async with aiohttp.ClientSession(connector=connector) as session:
        results = await asyncio.gather(
            *[_alpaca_one(session, key, secret, i) for i in range(burst)]
        )
    return _summarise(results, None, burst)


def _summarise(results, elapsed, total) -> dict:
    codes = Counter(r[1] for r in results)
    lats  = [r[2] for r in results if r[1] == 200]
    return {
        "total": total,
        "ok": codes.get(200, 0),
        "throttled": codes.get(429, 0),
        "errors": total - codes.get(200, 0) - codes.get(429, 0),
        "avg_lat": statistics.mean(lats) if lats else 0,
        "p95_lat": statistics.quantiles(lats, n=20)[18] if len(lats) >= 20 else (max(lats) if lats else 0),
        "elapsed": elapsed,
    }


def _row(label, s):
    ok, thr, err = s["ok"], s["throttled"], s["errors"]
    color = G if thr == 0 and err == 0 else (Y if thr < s["total"] * 0.1 else R)
    avg = f"{s['avg_lat']*1000:.0f}ms" if s["avg_lat"] else "–"
    p95 = f"{s['p95_lat']*1000:.0f}ms" if s["p95_lat"] else "–"
    throttle_pct = f"({thr/s['total']*100:.0f}%)" if s["total"] else ""
    return f"  {label:<28} {color}✓{ok:4d}  ⊘{thr:4d}{throttle_pct:<6}  E{err}{X}  avg={avg} p95={p95}"


# ─── ThetaData via proxy helpers ────────────────────────────────────────────

async def _proxy_one(session: aiohttp.ClientSession, host: str, port: int,
                     token: str, i: int):
    url = f"http://{host}:{port}/v1/history/options/bars"
    payload = {"token": token, "symbol": "AAPL260619C00200000",
               "timeframe": "1Hour", "start": "2025-01-02", "end": "2025-01-03"}
    t0 = time.perf_counter()
    try:
        async with session.post(url, json=payload,
                                timeout=aiohttp.ClientTimeout(total=30)) as r:
            await r.read()
            cache = r.headers.get("X-Cache", "NONE")
            return i, r.status, time.perf_counter() - t0, cache
    except Exception:
        return i, 0, time.perf_counter() - t0, "ERROR"


async def probe_theta_burst(token: str, host: str, port: int, burst: int) -> dict:
    concurrency = min(burst, 10)
    connector = aiohttp.TCPConnector(limit=concurrency)
    async with aiohttp.ClientSession(connector=connector) as session:
        results = await asyncio.gather(
            *[_proxy_one(session, host, port, token, i) for i in range(burst)]
        )
    codes  = Counter(r[1] for r in results)
    lats   = [r[2] for r in results if r[1] == 200]
    hits   = sum(1 for r in results if "HIT" in r[3])
    misses = sum(1 for r in results if r[3] == "NONE" and r[1] == 200)
    return {
        "total": burst,
        "ok": codes.get(200, 0),
        "throttled": codes.get(429, 0),
        "errors": burst - codes.get(200, 0) - codes.get(429, 0),
        "avg_lat": statistics.mean(lats) if lats else 0,
        "p95_lat": statistics.quantiles(lats, n=20)[18] if len(lats) >= 20 else (max(lats) if lats else 0),
        "cache_hits": hits,
        "cache_misses": misses,
        "elapsed": None,
    }


# ─── Main ───────────────────────────────────────────────────────────────────

async def main(args):
    print(f"\n{B}{'='*62}{X}")
    print(f"{B}  Upstream Rate Limit Probe{X}")
    print(f"{B}{'='*62}{X}\n")

    # ── Phase A: Alpaca direct ──────────────────────────────────────────
    if args.key and not args.theta_only:
        print(f"{B}── Phase A: Alpaca REST Direct (no proxy) ──{X}")
        print(f"  Symbol: {PROBE_SYMBOL}  |  Endpoint: GET /v2/stocks/bars\n")

        # Step 1: steady-rate test
        for rate in [1.0, 3.0, 5.0]:
            dur = 30
            planned = int(rate * dur)
            print(f"  Steady {rate:.0f} req/s × {dur}s = {planned} total ...", flush=True)
            s = await probe_alpaca_steady(args.key, args.secret, rate, dur)
            print(_row(f"  rate={rate:.0f}/s", s))
            if s["throttled"] > 0:
                print(f"  {R}→ 429 hit at {rate:.0f} req/s ({rate*60:.0f} req/min){X}")
                break
            await asyncio.sleep(10)   # small pause between probes

        print()
        # Step 2: burst test — how much can we absorb in a single burst?
        print(f"  Burst test (all-at-once):\n")
        alpaca_ceiling = None
        for burst in [20, 50, 100, 200]:
            print(f"  Burst {burst:4d} parallel ... ", end="", flush=True)
            s = await probe_alpaca_burst(args.key, args.secret, burst)
            print(_row("", s).strip())
            if s["throttled"] > 0 and alpaca_ceiling is None:
                alpaca_ceiling = burst
            await asyncio.sleep(65)   # wait for 60s window to reset

        if alpaca_ceiling:
            print(f"\n  {Y}Result: first 429 at burst={alpaca_ceiling}. Sustained ceiling ≈ {alpaca_ceiling - 20}–{alpaca_ceiling} req/min{X}")
        else:
            print(f"\n  {G}Result: no 429 up to 200 req/burst. Alpaca plan allows ≥200 req/min.{X}")
        print()

    # ── Phase B: ThetaData via proxy ────────────────────────────────────
    if args.token and not args.alpaca_only:
        print(f"{B}── Phase B: ThetaData via Proxy (cache warmed on 1st burst) ──{X}")
        print(f"  Host: {args.host}:{args.port}  |  Endpoint: POST /v1/history/options/bars\n")

        first_burst = True
        for burst in [5, 10, 20, 40, 80]:
            label = "(cache-warm run)" if first_burst else ""
            print(f"  Burst {burst:3d} {label}... ", end="", flush=True)
            s = await probe_theta_burst(args.token, args.host, args.port, burst)
            ok, thr, err = s["ok"], s["throttled"], s["errors"]
            hits = s["cache_hits"]
            avg  = f"{s['avg_lat']*1000:.0f}ms"
            color = G if thr == 0 and err == 0 else R
            print(f"{color}✓{ok}  ⊘{thr}  E{err}  cache_hits={hits}{X}  avg={avg}")

            if s["throttled"] > 0:
                print(f"  {R}→ ThetaData ceiling hit at burst={burst}{X}")
                break
            first_burst = False
            await asyncio.sleep(3)

        print()
        print(f"  {Y}Note: second+ bursts hit cache → true ThetaData upstream{X}")
        print(f"  {Y}ceiling only visible on first (cache-miss) run.{X}\n")

    print(f"{B}{'='*62}{X}")
    print(f"  Use these numbers to set safe tier rate limits.")
    print(f"  Alpaca ceiling → caps total proxy REST req/min across ALL users.")
    print(f"  Divide by expected user count for per-tier guidance.")
    print(f"{B}{'='*62}{X}\n")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Upstream rate limit probe")
    p.add_argument("--key",        default="PKTEH544LNSKZEHOJ7MWSN7AY5",
                   help="Alpaca API Key ID (master)")
    p.add_argument("--secret",     default="71mcpK41TvRsAM6aTa6gvmwwsdHeB459MG9GVMWX5KSY",
                   help="Alpaca API Secret Key")
    p.add_argument("--token",      default="967d4072-bb60-479a-958b-8003f493bc5d",
                   help="Proxy token (premium tier) for ThetaData probe")
    p.add_argument("--host",       default="52.37.182.24", help="Proxy host")
    p.add_argument("--port",       type=int, default=8768,  help="Proxy REST port")
    p.add_argument("--alpaca-only", action="store_true",   help="Skip ThetaData probe")
    p.add_argument("--theta-only",  action="store_true",   help="Skip Alpaca direct probe")
    p.add_argument("--rate",       type=float, default=0,  help="Override: single steady rate (req/s)")
    p.add_argument("--duration",   type=int,   default=30, help="Duration for steady-rate test (s)")
    args = p.parse_args()

    if args.rate > 0:
        async def _single():
            print(f"\nSingle steady-rate probe: {args.rate} req/s × {args.duration}s")
            s = await probe_alpaca_steady(args.key, args.secret, args.rate, args.duration)
            print(_row(f"rate={args.rate}/s", s))
        asyncio.run(_single())
    else:
        asyncio.run(main(args))
