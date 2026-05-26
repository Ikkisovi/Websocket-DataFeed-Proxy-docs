#!/usr/bin/env python3
"""
Comparative Performance and Routing Benchmarker: Tailscale Funnel vs EC2 Caddy.
Compares the public Tailscale Funnel route against the legacy public EC2 Caddy route
to isolate DERP relay routing latency, SSL handshake overhead, and cache processing.
"""

import asyncio
import aiohttp
import time
import argparse
import sys
import statistics

# Active test token (e.g. Xiaosu)
DEFAULT_TOKEN = "b1328189-ecde-48cc-a4cb-2a634fad8ade"

EC2_BASE = "http://52.37.182.24:8768"
FUNNEL_BASE = "https://leandata.tail5a8dea.ts.net"

class FunnelVsEc2Benchmark:
    def __init__(self, token, symbol, count, concurrency):
        self.token = token
        self.symbol = symbol
        self.count = count
        self.concurrency = concurrency

        self.ec2_health = f"{EC2_BASE}/health"
        self.funnel_health = f"{FUNNEL_BASE}/health"

        self.ec2_bars = f"{EC2_BASE}/v1/history/bars"
        self.funnel_bars = f"{FUNNEL_BASE}/v1/history/bars"

        # Results holders
        self.ec2_ping_times = []
        self.funnel_ping_times = []

        self.ec2_hit_times = []
        self.funnel_hit_times = []

        self.ec2_miss_times = []
        self.funnel_miss_times = []

    async def get_health(self, url, time_list):
        """Measures raw network TTFB via health check (no auth required)."""
        start = time.time()
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=10.0) as resp:
                    if resp.status == 200:
                        await resp.read()
                        time_list.append(time.time() - start)
                        return True
        except Exception as e:
            print(f"  [Error] Health check failed for {url}: {e}")
        return False

    async def query_bars(self, url, time_list, force_refresh=False):
        """Query bars to measure cache hit / miss speed."""
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }
        # Fixed dates ensures it hits NVMe cache, unless force_refresh is True
        payload = {
            "symbol": self.symbol,
            "timeframe": "1Day",
            "start": "2026-05-01",
            "end": "2026-05-20",
            "force_refresh": force_refresh
        }

        start = time.time()
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=payload, timeout=15.0) as resp:
                    if resp.status == 200:
                        await resp.read()
                        time_list.append(time.time() - start)
                        return True
                    else:
                        print(f"  [Error] Request to {url} returned status {resp.status}")
        except Exception as e:
            print(f"  [Error] Request to {url} failed: {e}")
        return False

    async def run_sequential_ping(self):
        """Run health check pings sequentially to measure raw route baseline."""
        print(f"\n1. Running raw network latency checks (10 pings sequentially)...")
        for i in range(10):
            await self.get_health(self.ec2_health, self.ec2_ping_times)
            await self.get_health(self.funnel_health, self.funnel_ping_times)
            await asyncio.sleep(0.1)
        print("   ✓ Done.")

    async def run_cache_hit_test(self):
        """Run cache hit tests (pre-warmed queries to isolate cache response speed)."""
        print(f"\n2. Warming cache for {self.symbol}...")
        # Warm cache on both servers
        await self.query_bars(self.ec2_bars, [], force_refresh=False)
        await self.query_bars(self.funnel_bars, [], force_refresh=False)

        print(f"   Running cache-hit tests ({self.count} requests sequentially)...")
        for i in range(self.count):
            await self.query_bars(self.ec2_bars, self.ec2_hit_times, force_refresh=False)
            await self.query_bars(self.funnel_bars, self.funnel_hit_times, force_refresh=False)
            await asyncio.sleep(0.1)
        print("   ✓ Done.")

    async def run_cache_miss_test(self):
        """Run cache miss tests (bypass cache to isolate upstream data processing latency)."""
        print(f"\n3. Running cache-miss tests ({self.count // 2} requests sequentially)...")
        # Misses require hitting upstream so we do fewer queries to respect rate limits
        for i in range(max(1, self.count // 2)):
            # force_refresh=True skips L1/L2 cache and forces query to Alpaca
            await self.query_bars(self.ec2_bars, self.ec2_miss_times, force_refresh=True)
            await self.query_bars(self.funnel_bars, self.funnel_miss_times, force_refresh=True)
            # Upstream cooldown
            await asyncio.sleep(1.0)
        print("   ✓ Done.")

    def calculate_percentiles(self, lst):
        if not lst:
            return 0.0, 0.0, 0.0
        lst_sorted = sorted(lst)
        n = len(lst_sorted)
        p50 = lst_sorted[int(n * 0.50)]
        p90 = lst_sorted[int(n * 0.90)] if n > 1 else p50
        p95 = lst_sorted[int(n * 0.95)] if n > 1 else p90
        return p50 * 1000.0, p90 * 1000.0, p95 * 1000.0

    def print_report(self):
        print("\n" + "="*70)
        print("   COMPARATIVE ROUTE PERFORMANCE ANALYSIS REPORT")
        print("="*70)
        print(f"  Target Token:     {self.token[:8]}...{self.token[-8:]}")
        print(f"  Test Symbol:      {self.symbol}")
        print(f"  Legacy EC2 path:  {EC2_BASE}")
        print(f"  Funnel HTTPS:     {FUNNEL_BASE}")
        print("="*70)

        # 1. Pings
        ec2_p50, ec2_p90, ec2_p95 = self.calculate_percentiles(self.ec2_ping_times)
        fun_p50, fun_p90, fun_p95 = self.calculate_percentiles(self.funnel_ping_times)
        print("\n[Suite 1: Raw Network Latency (Health Ping)]")
        print(f"  Route        | p50 (Median) | p90          | p95")
        print(f"  -------------|--------------|--------------|-------------")
        print(f"  EC2 Legacy   | {ec2_p50:6.1f} ms   | {ec2_p90:6.1f} ms   | {ec2_p95:6.1f} ms")
        print(f"  Funnel HTTPS | {fun_p50:6.1f} ms   | {fun_p90:6.1f} ms   | {fun_p95:6.1f} ms")
        delta_ping = fun_p50 - ec2_p50
        print(f"  >> Raw Routing Delta (Median): {delta_ping:+.1f} ms")

        # 2. Hits
        ec2_h50, ec2_h90, ec2_h95 = self.calculate_percentiles(self.ec2_hit_times)
        fun_h50, fun_h90, fun_h95 = self.calculate_percentiles(self.funnel_hit_times)
        print("\n[Suite 2: REST Cache-Hit Performance (Pre-warmed NVMe)]")
        print(f"  Route        | p50 (Median) | p90          | p95")
        print(f"  -------------|--------------|--------------|-------------")
        print(f"  EC2 Legacy   | {ec2_h50:6.1f} ms   | {ec2_h90:6.1f} ms   | {ec2_h95:6.1f} ms")
        print(f"  Funnel HTTPS | {fun_h50:6.1f} ms   | {fun_h90:6.1f} ms   | {fun_h95:6.1f} ms")
        delta_hit = fun_h50 - ec2_h50
        print(f"  >> Cache-Hit Delta (Median):  {delta_hit:+.1f} ms")

        # 3. Misses
        ec2_m50, ec2_m90, ec2_m95 = self.calculate_percentiles(self.ec2_miss_times)
        fun_m50, fun_m90, fun_m95 = self.calculate_percentiles(self.funnel_miss_times)
        print("\n[Suite 3: REST Cache-Miss Latency (Upstream Alpaca Query)]")
        print(f"  Route        | p50 (Median) | p90          | p95")
        print(f"  -------------|--------------|--------------|-------------")
        print(f"  EC2 Legacy   | {ec2_m50:6.1f} ms   | {ec2_m90:6.1f} ms   | {ec2_m95:6.1f} ms")
        print(f"  Funnel HTTPS | {fun_m50:6.1f} ms   | {fun_m90:6.1f} ms   | {fun_m95:6.1f} ms")
        delta_miss = fun_m50 - ec2_m50
        print(f"  >> Cache-Miss Delta (Median): {delta_miss:+.1f} ms")

        print("\n" + "="*70)
        print("   ARCHITECTURAL INTERPRETATION & DECISION GUIDE")
        print("="*70)
        
        # Guide logic
        if fun_h50 < ec2_h50 * 0.7:
            print("  ★  VERDICT: Tailscale Funnel is significantly faster (>= 30% latency reduction).")
            print("     Recommendation: Proceed with full migration, deprecate EC2.")
        elif fun_h50 > ec2_h50 * 1.3:
            print("  ⚠️  VERDICT: EC2 legacy route is faster. Tailscale DERP中继引入了显著延迟。")
            print("     Recommendation: Keep EC2 as active primary path, or tune Tailscale region.")
        else:
            print("  ✓  VERDICT: Latencies are comparable (within +/- 30% bounds).")
            print("     Recommendation: Keep both paths active. Dual-path redundancy is optimal.")

        print("="*70 + "\n")

    async def run(self):
        print(f"============================================================")
        # We clarify it's the public internet routes to both
        print(f"Tailscale Funnel vs EC2 Caddy Public Route Benchmarker")
        print(f"============================================================")
        
        await self.run_sequential_ping()
        await self.run_cache_hit_test()
        await self.run_cache_miss_test()
        
        self.print_report()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Funnel vs EC2 Public Route Benchmarker")
    parser.add_argument("--token", default=DEFAULT_TOKEN, help="Proxy auth token")
    parser.add_argument("--symbol", default="AAPL", help="Symbol to query")
    parser.add_argument("--count", type=int, default=10, help="Number of queries for hits")
    parser.add_argument("--concurrency", type=int, default=3, help="Max concurrency limit")
    args = parser.parse_args()

    benchmark = FunnelVsEc2Benchmark(
        token=args.token,
        symbol=args.symbol,
        count=args.count,
        concurrency=args.concurrency
    )

    try:
        asyncio.run(benchmark.run())
    except KeyboardInterrupt:
        print("\nInterrupted.")
        sys.exit(0)
