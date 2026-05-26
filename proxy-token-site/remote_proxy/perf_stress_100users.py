#!/usr/bin/env python3
"""
100-user concurrent stress test for the Alpaca Cloud Proxy.

Three scenarios — run them in order for a complete picture:

  scatter   100 virtual users, Poisson-paced REST + WS, 3 min
            Models: 100 registered users with scattered activity
            Pass: p95(hit) ≤ 300ms, p95(miss) ≤ 8s, 0 × 503

  burst     100 users each fire their tier-rate-limit within 60s
            Models: simultaneous worst-case REST storm
            Pass: ≥ 95% 200, 0 × 503, memory ≤ 85%

  mixed     30 WS streams + 70 REST users, 2 min
            Models: live-trading session during market hours
            Pass: WS auth ≤ 500ms, REST p95(hit) ≤ 400ms

Usage:
  python3 perf_stress_100users.py scatter
  python3 perf_stress_100users.py burst   --users 100
  python3 perf_stress_100users.py mixed   --ws-users 30 --rest-users 70
  python3 perf_stress_100users.py all     --duration 180

Tokens: by default uses the premium token (high limits) to stress the system,
        not per-user rate-limit fairness. For rate-limit testing, supply
        --tokens t1,t2,t3 with different tier tokens.
"""

import asyncio
import aiohttp
import argparse
import json
import random
import statistics
import sys
import time
from collections import Counter, defaultdict

import msgpack
import websockets

# ─── ANSI ───────────────────────────────────────────────────────────────────
G = "\033[92m"; Y = "\033[93m"; R = "\033[91m"; B = "\033[94m"; X = "\033[0m"

# ─── Defaults ───────────────────────────────────────────────────────────────
DEFAULT_TOKEN  = "967d4072-bb60-479a-958b-8003f493bc5d"
DEFAULT_HOST   = "52.37.182.24"
DEFAULT_WS_PORT  = 8767
DEFAULT_REST_PORT = 8768

# Symbol pools
HOT_SYMBOLS    = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META",
                   "SPY",  "QQQ",  "IWM",  "AMD",  "NFLX", "INTC", "QCOM"]
COLD_SYMBOLS   = [f"COLD{i:03d}" for i in range(200)]   # fake → guaranteed MISS

# REST endpoint mix (endpoint, payload_fn)
def _bars_payload(sym):
    return {"symbol": sym, "timeframe": "1Min",
            "start": "2025-01-02", "end": "2025-01-03", "limit": 50}

def _snap_payload(sym):
    return {"symbols": f"{sym}250117C00200000"}

def _contracts_payload(sym):
    return {"symbol": sym, "expiration_date_gte": "2025-01-01",
            "expiration_date_lte": "2025-06-30"}

ENDPOINT_MIX = [
    # (path, payload_fn, weight)
    ("/v1/history/bars",        _bars_payload,       60),
    ("/v1/options/snapshots",   _snap_payload,        20),
    ("/v1/options/contracts",   _contracts_payload,   10),
    ("/v1/history/news",        lambda s: {"limit": 5}, 10),
]
_EP_WEIGHTS = [e[2] for e in ENDPOINT_MIX]

def _pick_endpoint():
    r = random.random() * sum(_EP_WEIGHTS)
    acc = 0
    for ep, fn, w in ENDPOINT_MIX:
        acc += w
        if r <= acc:
            return ep, fn
    return ENDPOINT_MIX[0][0], ENDPOINT_MIX[0][1]

def _pick_symbol(hot_bias=0.6):
    """hot_bias = probability of picking a popular (cached) symbol."""
    if random.random() < hot_bias:
        return random.choice(HOT_SYMBOLS)
    return random.choice(COLD_SYMBOLS)


# ─── Metrics store ──────────────────────────────────────────────────────────

class Metrics:
    def __init__(self):
        self.latencies_by_cache: dict[str, list] = defaultdict(list)   # "HIT"/"DISK_HIT"/"NONE"/etc.
        self.status_codes: list = []
        self.ws_auth_latencies: list = []
        self.ws_msg_count: int = 0
        self.ws_failures: int = 0
        self.ws_success: int = 0
        self.health_snapshots: list = []   # (ts, memory_pct, cpu_pct)
        self._lock = asyncio.Lock()

    async def record_rest(self, latency, status, cache):
        async with self._lock:
            self.latencies_by_cache[cache].append(latency)
            self.status_codes.append(status)

    async def record_ws_auth(self, latency, success):
        async with self._lock:
            if success:
                self.ws_success += 1
                self.ws_auth_latencies.append(latency)
            else:
                self.ws_failures += 1

    async def record_ws_msg(self):
        async with self._lock:
            self.ws_msg_count += 1

    async def record_health(self, snap):
        async with self._lock:
            self.health_snapshots.append(snap)

    def summary(self) -> dict:
        all_lats = []
        for lats in self.latencies_by_cache.values():
            all_lats.extend(lats)

        def pct(lats, n):
            if len(lats) >= n:
                return statistics.quantiles(lats, n=100)[n - 1]
            return max(lats) if lats else 0

        hit_lats  = self.latencies_by_cache.get("HIT",      []) + \
                    self.latencies_by_cache.get("DISK_HIT",  [])
        miss_lats = self.latencies_by_cache.get("NONE",     []) + \
                    self.latencies_by_cache.get("MISS",      [])

        codes = Counter(self.status_codes)
        total = len(self.status_codes)
        # Cache hit rate uses ONLY successful-with-cache-header requests as
        # denominator. 429s and errors never reached the cache layer.
        cache_observed = len(hit_lats) + len(miss_lats)
        return {
            "total_rest": total,
            "ok":       codes.get(200, 0),
            "rate_limited": codes.get(429, 0),
            "overloaded":   codes.get(503, 0),
            "errors":        total - codes.get(200, 0) - codes.get(429, 0) - codes.get(503, 0),
            "cache_hit_count":  len(hit_lats),
            "cache_miss_count": len(miss_lats),
            "cache_hit_rate":   len(hit_lats) / cache_observed if cache_observed else 0,
            "hit_p50":   pct(hit_lats, 50) * 1000 if hit_lats else None,
            "hit_p95":   pct(hit_lats, 95) * 1000 if hit_lats else None,
            "hit_p99":   pct(hit_lats, 99) * 1000 if hit_lats else None,
            "miss_p50":  pct(miss_lats, 50) * 1000 if miss_lats else None,
            "miss_p95":  pct(miss_lats, 95) * 1000 if miss_lats else None,
            "all_p50":   pct(all_lats, 50) * 1000 if all_lats else None,
            "all_p95":   pct(all_lats, 95) * 1000 if all_lats else None,
            "ws_success": self.ws_success,
            "ws_failures": self.ws_failures,
            "ws_msgs":    self.ws_msg_count,
            "ws_auth_p95": pct(self.ws_auth_latencies, 95) * 1000 if self.ws_auth_latencies else None,
            "max_memory_pct": max((s["memory_percent"] for s in self.health_snapshots), default=None),
            "max_cpu_pct":    max((s["cpu_percent"]    for s in self.health_snapshots), default=None),
        }


# ─── REST worker ────────────────────────────────────────────────────────────

def _pick_token(tokens: list, idx: int) -> str:
    """Round-robin token assignment for virtual users."""
    return tokens[idx % len(tokens)]


async def rest_worker(user_id: int, token: str, host: str, port: int,
                      duration: float, avg_interval: float,
                      hot_bias: float, metrics: Metrics,
                      session: aiohttp.ClientSession):
    """Single virtual REST user. Runs for duration seconds."""
    deadline = time.monotonic() + duration
    base_url = f"{"https" if port == 443 else "http"}://{host}:{port}"
    headers  = {"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"}

    while time.monotonic() < deadline:
        ep, fn = _pick_endpoint()
        sym    = _pick_symbol(hot_bias)
        payload = {**fn(sym), "token": token}   # add token to body as well
        t0 = time.perf_counter()
        try:
            async with session.post(base_url + ep, headers=headers, json=payload,
                                    timeout=aiohttp.ClientTimeout(total=30)) as r:
                await r.read()
                lat   = time.perf_counter() - t0
                cache = r.headers.get("X-Cache", "NONE")
                await metrics.record_rest(lat, r.status, cache)
        except Exception:
            await metrics.record_rest(time.perf_counter() - t0, 0, "ERROR")

        # Poisson inter-arrival: sleep ~ Exp(1/avg_interval)
        jitter = random.expovariate(1.0 / avg_interval)
        jitter = max(0.1, min(jitter, avg_interval * 4))
        await asyncio.sleep(jitter)


# ─── WS worker ──────────────────────────────────────────────────────────────

async def ws_worker(user_id: int, token: str, host: str, port: int,
                    duration: float, metrics: Metrics):
    """Single virtual WS user: connect, auth, subscribe, receive for duration."""
    url = f"{"wss" if port == 443 else "ws"}://{host}:{port}/stream"
    sym = random.choice(HOT_SYMBOLS)
    t0  = time.perf_counter()
    try:
        async with websockets.connect(url, open_timeout=10) as ws:
            auth_t = time.perf_counter()
            await ws.send(json.dumps({"action": "auth", "token": token}))
            raw = await asyncio.wait_for(ws.recv(), timeout=8)
            auth_lat = time.perf_counter() - auth_t

            try:
                msg = msgpack.unpackb(raw, raw=False) if isinstance(raw, bytes) else json.loads(raw)
            except Exception:
                msg = []
            success = isinstance(msg, list) and any(m.get("T") == "success" for m in msg if isinstance(m, dict))
            await metrics.record_ws_auth(auth_lat, success)

            if not success:
                return

            await ws.send(json.dumps({"action": "subscribe", "trades": [sym], "quotes": [sym]}))
            await asyncio.wait_for(ws.recv(), timeout=5)   # sub confirm

            deadline = time.monotonic() + duration
            while time.monotonic() < deadline:
                try:
                    await asyncio.wait_for(ws.recv(), timeout=1)
                    await metrics.record_ws_msg()
                except asyncio.TimeoutError:
                    pass

    except Exception as e:
        await metrics.record_ws_auth(time.perf_counter() - t0, False)


# ─── Health poller ───────────────────────────────────────────────────────────

async def health_poller(host: str, port: int, metrics: Metrics,
                         interval: float, duration: float):
    url = f"{"https" if port == 443 else "http"}://{host}:{port}/health"
    deadline = time.monotonic() + duration
    async with aiohttp.ClientSession() as s:
        while time.monotonic() < deadline:
            try:
                async with s.get(url, timeout=aiohttp.ClientTimeout(total=5)) as r:
                    if r.status == 200:
                        body = await r.json(content_type=None)
                        sys_info = body.get("system", {})
                        if sys_info:
                            await metrics.record_health(sys_info)
            except Exception:
                pass
            await asyncio.sleep(interval)


# ─── Scenarios ───────────────────────────────────────────────────────────────

async def scenario_scatter(args, metrics):
    """100 virtual users with scattered Poisson-paced REST activity."""
    users   = args.users
    duration = args.duration
    avg_interval = 3.0   # avg 20 REST req/min per user — well within standard tier

    print(f"  {users} users  |  avg {60/avg_interval:.0f} req/min each  |  {duration}s")
    print(f"  hot-symbol bias 70% (cache hits expected)")
    print(f"  endpoints: bars 60%, snapshots 20%, contracts 10%, news 10%\n")

    connector = aiohttp.TCPConnector(limit=users + 10)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = []
        # Stagger starts over first 10s to avoid thundering herd
        for i in range(users):
            delay = random.uniform(0, 10)
            tasks.append(asyncio.create_task(_delayed(
                rest_worker(i, _pick_token(args.tokens, i), args.host, args.rest_port,
                            duration, avg_interval, 0.7, metrics, session),
                delay
            )))
        tasks.append(asyncio.create_task(
            health_poller(args.host, args.rest_port, metrics, 20, duration + 15)
        ))
        await asyncio.gather(*tasks, return_exceptions=True)


async def scenario_burst(args, metrics):
    """100 users each fire 30 requests simultaneously within 60s."""
    users    = args.users
    tier_rate = 30    # standard tier: 30 req/min for this scenario
    duration = 60
    avg_interval = 60.0 / tier_rate   # 2s between each user's requests

    print(f"  {users} users  |  {tier_rate} REST req/min each  |  60s burst window")
    print(f"  total theoretical: {users * tier_rate} req in 60s = {users * tier_rate / 60:.0f} req/sec\n")

    connector = aiohttp.TCPConnector(limit=users * 5)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = []
        for i in range(users):
            tasks.append(asyncio.create_task(
                rest_worker(i, _pick_token(args.tokens, i), args.host, args.rest_port,
                            duration, avg_interval, 0.5, metrics, session)
            ))
        tasks.append(asyncio.create_task(
            health_poller(args.host, args.rest_port, metrics, 15, duration + 10)
        ))
        await asyncio.gather(*tasks, return_exceptions=True)


async def scenario_mixed(args, metrics):
    """30 WS streams + 70 REST users simultaneously."""
    ws_users   = args.ws_users
    rest_users = args.rest_users
    duration   = args.duration

    print(f"  {ws_users} WS connections + {rest_users} REST users  |  {duration}s\n")

    connector = aiohttp.TCPConnector(limit=rest_users + 10)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = []
        for i in range(ws_users):
            tasks.append(asyncio.create_task(
                ws_worker(i, _pick_token(args.tokens, i), args.host, args.ws_port, duration, metrics)
            ))
        for i in range(rest_users):
            delay = random.uniform(0, 5)
            tasks.append(asyncio.create_task(_delayed(
                rest_worker(i, _pick_token(args.tokens, ws_users + i), args.host, args.rest_port,
                            duration, 4.0, 0.7, metrics, session),
                delay
            )))
        tasks.append(asyncio.create_task(
            health_poller(args.host, args.rest_port, metrics, 15, duration + 10)
        ))
        await asyncio.gather(*tasks, return_exceptions=True)


async def _delayed(coro, delay):
    await asyncio.sleep(delay)
    await coro


# ─── Pass/fail verdict ───────────────────────────────────────────────────────

THRESHOLDS = {
    "scatter": {
        "hit_p95_ms":  300,
        "miss_p95_ms": 8000,
        "max_503":     0,
        "min_ok_pct":  0.95,
    },
    "burst": {
        "hit_p95_ms":  600,
        "miss_p95_ms": 10000,
        "max_503":     0,
        "min_ok_pct":  0.90,
    },
    "mixed": {
        "hit_p95_ms":   400,
        "miss_p95_ms":  10000,
        "ws_auth_p95_ms": 500,
        "max_503":      0,
        "min_ok_pct":   0.90,
    },
}

def verdict(scenario: str, s: dict):
    t = THRESHOLDS.get(scenario, {})
    checks = []

    def check(label, val, threshold, op="le", unit="ms"):
        passed = (val <= threshold) if op == "le" else (val >= threshold)
        v = f"{val:.0f}{unit}" if val is not None else "N/A"
        sym = G + "✓" + X if passed else R + "✗" + X
        checks.append((passed, f"  {sym}  {label}: {v}  (threshold {op} {threshold}{unit})"))

    if t.get("hit_p95_ms") and s["hit_p95"] is not None:
        check("Cache-hit  p95 latency", s["hit_p95"], t["hit_p95_ms"])
    if t.get("miss_p95_ms") and s["miss_p95"] is not None:
        check("Cache-miss p95 latency", s["miss_p95"], t["miss_p95_ms"])
    if t.get("ws_auth_p95_ms") and s["ws_auth_p95"] is not None:
        check("WS auth   p95 latency", s["ws_auth_p95"], t["ws_auth_p95_ms"])
    if s["total_rest"] > 0:
        check("503 count", s["overloaded"], t.get("max_503", 0))
        ok_pct = s["ok"] / s["total_rest"]
        check("Success rate", ok_pct * 100, t.get("min_ok_pct", 0.9) * 100, op="ge", unit="%")

    return checks


# ─── Report ──────────────────────────────────────────────────────────────────

def print_report(scenario: str, s: dict, elapsed: float):
    print(f"\n{B}{'─'*60}{X}")
    print(f"{B}  Results: {scenario.upper()}{X}  ({elapsed:.0f}s)\n")

    if s["total_rest"] > 0:
        print(f"  REST requests:  {s['total_rest']}  (✓{s['ok']}  ⊘{s['rate_limited']}  ⊘⊘{s['overloaded']}  E{s['errors']})")
        hr = s["cache_hit_rate"] * 100
        print(f"  Cache hit rate: {hr:.1f}%  ({s['cache_hit_count']} hits / {s['cache_miss_count']} misses)")
        print()

        if s["hit_p95"] is not None:
            print(f"  Cache HIT  latency:  p50={s['hit_p50']:.0f}ms  p95={s['hit_p95']:.0f}ms  p99={s['hit_p99']:.0f}ms")
        if s["miss_p95"] is not None:
            print(f"  Cache MISS latency:  p50={s['miss_p50']:.0f}ms  p95={s['miss_p95']:.0f}ms")
        print(f"  Overall    latency:  p50={s['all_p50']:.0f}ms  p95={s['all_p95']:.0f}ms")
        print()

    if s["ws_success"] or s["ws_failures"]:
        auth_p95 = f"{s['ws_auth_p95']:.0f}ms" if s["ws_auth_p95"] else "–"
        print(f"  WS connections: ✓{s['ws_success']}  ✗{s['ws_failures']}   msgs={s['ws_msgs']}   auth_p95={auth_p95}")
        print()

    if s["max_memory_pct"] is not None:
        mem_color = G if s["max_memory_pct"] < 80 else R
        cpu_color = G if s["max_cpu_pct"] < 80 else R
        print(f"  ThinkCentre peak:  {mem_color}mem={s['max_memory_pct']:.0f}%{X}  {cpu_color}cpu={s['max_cpu_pct']:.0f}%{X}")
        print()

    # Pass/fail
    checks = verdict(scenario, s)
    print(f"  Pass/Fail:")
    all_pass = all(c[0] for c in checks)
    for _, line in checks:
        print(line)
    overall = f"{G}  PASS{X}" if all_pass else f"{R}  FAIL{X}"
    print(f"\n  Overall: {overall}\n")


# ─── Entry point ─────────────────────────────────────────────────────────────

async def run(args):
    scenarios = [args.scenario] if args.scenario != "all" else ["scatter", "burst", "mixed"]

    for sc in scenarios:
        metrics = Metrics()
        print(f"\n{B}{'='*60}{X}")
        print(f"{B}  Scenario: {sc.upper()}{X}")
        print(f"{B}{'='*60}{X}\n")
        t0 = time.monotonic()

        if sc == "scatter":
            await scenario_scatter(args, metrics)
        elif sc == "burst":
            await scenario_burst(args, metrics)
        elif sc == "mixed":
            await scenario_mixed(args, metrics)

        elapsed = time.monotonic() - t0
        print_report(sc, metrics.summary(), elapsed)

        if args.scenario == "all" and sc != scenarios[-1]:
            print(f"\n  Cooling down 30s before next scenario...")
            await asyncio.sleep(30)


def main():
    p = argparse.ArgumentParser(description="100-user concurrent proxy stress test")
    p.add_argument("scenario", choices=["scatter", "burst", "mixed", "all"],
                   help="Which scenario to run (or 'all')")
    p.add_argument("--host",       default=DEFAULT_HOST,     help="Proxy EC2 host")
    p.add_argument("--ws-port",    type=int, default=DEFAULT_WS_PORT)
    p.add_argument("--rest-port",  type=int, default=DEFAULT_REST_PORT)
    p.add_argument("--token",      default=DEFAULT_TOKEN,
                   help="Single auth token (fallback if --tokens/--tokens-file not given)")
    p.add_argument("--tokens",     default=None,
                   help="Comma-separated tokens — virtual users round-robin across them")
    p.add_argument("--tokens-file", default=None,
                   help="JSON file from provision_test_users.py: [{user_id,token},...]")
    p.add_argument("--users",      type=int, default=100)
    p.add_argument("--ws-users",   type=int, default=30)
    p.add_argument("--rest-users", type=int, default=70)
    p.add_argument("--duration",   type=int, default=180,
                   help="Test duration in seconds (scatter/mixed; burst always 60s)")
    args = p.parse_args()

    # Resolve token list (priority: --tokens-file > --tokens > --token)
    if args.tokens_file:
        with open(args.tokens_file) as f:
            data = json.load(f)
            args.tokens = [t["token"] for t in data if t.get("token")]
    elif args.tokens:
        args.tokens = [t.strip() for t in args.tokens.split(",") if t.strip()]
    else:
        args.tokens = [args.token]

    if not args.tokens:
        print(f"{R}No tokens resolved. Provide --tokens, --tokens-file, or --token.{X}")
        sys.exit(1)

    print(f"\n{B}Alpaca Cloud Proxy — 100-User Concurrent Stress Test{X}")
    print(f"Target: {args.host}  REST:{args.rest_port}  WS:{args.ws_port}")
    print(f"Tokens: {len(args.tokens)} ({', '.join(t[:8]+'...' for t in args.tokens[:3])}{'…' if len(args.tokens)>3 else ''})")
    print(f"\nThresholds (pass/fail):")
    for sc, t in THRESHOLDS.items():
        print(f"  {sc}: hit_p95 ≤ {t['hit_p95_ms']}ms  miss_p95 ≤ {t['miss_p95_ms']}ms  503s = 0")

    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        print("\nInterrupted.")
        sys.exit(0)


if __name__ == "__main__":
    main()
