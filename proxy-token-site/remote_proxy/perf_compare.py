#!/usr/bin/env python3
"""
Comparative Performance and Overhead Benchmarker for Alpaca Cloud Proxy.
Compares direct Alpaca API calls against proxy calls to isolate local proxy overhead and WAN latency.
"""

import asyncio
import aiohttp
import time
import argparse
import sys
import statistics

# Set default credentials extracted from the active container
DEFAULT_KEY = "PKTEH544LNSKZEHOJ7MWSN7AY5"
DEFAULT_SECRET = "71mcpK41TvRsAM6aTa6gvmwwsdHeB459MG9GVMWX5KSY"
DEFAULT_TOKEN = "967d4072-bb60-479a-958b-8003f493bc5d"

SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA"]

class ComparativeBenchmark:
    def __init__(self, key, secret, token, local_host, local_port, remote_host, remote_port, bars_limit):
        self.key = key
        self.secret = secret
        self.token = token
        self.local_host = local_host
        self.local_port = local_port
        self.remote_host = remote_host
        self.remote_port = remote_port
        self.bars_limit = bars_limit

        self.direct_url = "https://data.alpaca.markets/v2/stocks/bars"
        self.local_url = f"http://{local_host}:{local_port}/v1/history/bars"
        self.remote_url = f"http://{remote_host}:{remote_port}/v1/history/bars" if remote_host else None

        self.direct_latencies = []
        self.local_latencies = []
        self.remote_latencies = []

    async def measure_direct(self, symbol):
        """Call Alpaca directly."""
        headers = {
            "APCA-API-KEY-ID": self.key,
            "APCA-API-SECRET-KEY": self.secret,
            "Accept": "application/json"
        }
        params = {
            "symbols": symbol,
            "start": "2026-05-18",
            "end": "2026-05-22",
            "timeframe": "1Min",
            "adjustment": "all",
            "feed": "sip",
            "limit": self.bars_limit
        }
        
        start = time.time()
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.direct_url, headers=headers, params=params, timeout=15.0) as resp:
                    if resp.status == 200:
                        text = await resp.text()
                        latency = time.time() - start
                        self.direct_latencies.append(latency)
                        return latency, True
                    else:
                        return 0.0, False
        except Exception as e:
            print(f"[Direct-{symbol}] Failed: {e}")
            return 0.0, False

    async def measure_proxy(self, symbol, url, latency_list, label):
        """Call historical bars through a proxy."""
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }
        payload = {
            "symbol": symbol,
            "timeframe": "1Min",
            "start": "2026-05-18",
            "end": "2026-05-22",
            "limit": self.bars_limit
        }

        start = time.time()
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=payload, timeout=15.0) as resp:
                    if resp.status == 200:
                        text = await resp.text()
                        latency = time.time() - start
                        latency_list.append(latency)
                        return latency, True
                    else:
                        print(f"[{label}-{symbol}] Proxy returned status {resp.status}")
                        return 0.0, False
        except Exception as e:
            print(f"[{label}-{symbol}] Failed: {e}")
            return 0.0, False

    async def run(self):
        print(f"\n============================================================")
        print(f"Alpaca Cloud Proxy Robust Comparative Benchmarker")
        print(f"============================================================")
        print(f"Alpaca Direct URL:  {self.direct_url}")
        print(f"Local Proxy URL:    {self.local_url}")
        if self.remote_url:
            print(f"Remote Proxy URL:   {self.remote_url}")
        print(f"Symbols to test:    {SYMBOLS}")
        print(f"Bars Limit:         {self.bars_limit}")
        print(f"============================================================\n")

        print("Executing comparative latency queries sequentially (to avoid rate limits)...")
        
        for symbol in SYMBOLS:
            print(f"  Testing {symbol} ...")
            # 1. Direct Alpaca
            direct_lat, direct_ok = await self.measure_direct(symbol)
            if direct_ok:
                print(f"    ✓ Direct Alpaca: {direct_lat:.3f} s")
            
            # 2. Local Proxy
            local_lat, local_ok = await self.measure_proxy(symbol, self.local_url, self.local_latencies, "LocalProxy")
            if local_ok:
                print(f"    ✓ Local Proxy:   {local_lat:.3f} s")

            # 3. Remote Proxy (optional)
            if self.remote_url:
                remote_lat, remote_ok = await self.measure_proxy(symbol, self.remote_url, self.remote_latencies, "RemoteProxy")
                if remote_ok:
                    print(f"    ✓ Remote Proxy:  {remote_lat:.3f} s")

            # Sleep slightly between symbols to avoid aggressive pagination rate-limiting
            await asyncio.sleep(0.5)

        self.report()

    def report(self):
        print("\n" + "="*60)
        print("  COMPARATIVE BENCHMARK ANALYSIS REPORT  ")
        print("="*60)

        avg_direct = statistics.mean(self.direct_latencies) if self.direct_latencies else 0.0
        avg_local = statistics.mean(self.local_latencies) if self.local_latencies else 0.0
        avg_remote = statistics.mean(self.remote_latencies) if self.remote_latencies else 0.0

        print(f"\n[Raw Performance Metrics (Averages)]")
        print(f"  Direct Alpaca Latency:   {avg_direct:.3f} s")
        print(f"  Local Proxy Latency:     {avg_local:.3f} s")
        if self.remote_url:
            print(f"  Remote Proxy Latency:    {avg_remote:.3f} s")

        print(f"\n[Robust Bottleneck & Latency Delta Isolation]")
        
        if avg_direct > 0 and avg_local > 0:
            local_overhead = avg_local - avg_direct
            overhead_percent = (local_overhead / avg_direct) * 100
            print(f"  1. Local Proxy Processing Overhead (Local - Direct):")
            print(f"     Delta:               {local_overhead:+.3f} s ({overhead_percent:+.1f}%)")
            print(f"     Note: This measures local processing (JSON parsing, auth verification, and formatting).")

        if avg_local > 0 and avg_remote > 0:
            wan_overhead = avg_remote - avg_local
            wan_percent = (wan_overhead / avg_local) * 100
            print(f"\n  2. WAN Network & VPN Routing Overhead (Remote - Local):")
            print(f"     Delta:               {wan_overhead:+.3f} s ({wan_percent:+.1f}%)")
            print(f"     Note: This measures physical routing, VPN/Tailscale encapsulation, and internet hops.")

        print("\n" + "="*60 + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Alpaca Cloud Proxy Comparative Benchmarker")
    parser.add_argument("--key", default=DEFAULT_KEY, help="Alpaca API Key ID")
    parser.add_argument("--secret", default=DEFAULT_SECRET, help="Alpaca API Secret Key")
    parser.add_argument("--token", default=DEFAULT_TOKEN, help="Proxy auth token")
    parser.add_argument("--local-host", default="localhost", help="Local proxy host")
    parser.add_argument("--local-port", type=int, default=8766, help="Local proxy port")
    parser.add_argument("--remote-host", default="", help="Remote proxy host (optional)")
    parser.add_argument("--remote-port", type=int, default=8766, help="Remote proxy port")
    parser.add_argument("--bars-limit", type=int, default=1000, help="Bars limit (pagination load)")
    args = parser.parse_args()

    benchmark = ComparativeBenchmark(
        key=args.key,
        secret=args.secret,
        token=args.token,
        local_host=args.local_host,
        local_port=args.local_port,
        remote_host=args.remote_host,
        remote_port=args.remote_port,
        bars_limit=args.bars_limit
    )

    try:
        asyncio.run(benchmark.run())
    except KeyboardInterrupt:
        print("\nBenchmark interrupted.")
        sys.exit(0)
