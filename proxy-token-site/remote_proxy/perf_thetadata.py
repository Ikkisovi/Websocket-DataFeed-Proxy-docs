#!/usr/bin/env python3
"""
Performance & Concurrency Stress Test Generator for ThetaData Endpoints.
Sends high-concurrency requests to the ThinkCentre's direct and fallback ThetaData endpoints
to determine saturation points, latency percentiles, and software bottlenecks under load.
"""

import asyncio
import aiohttp
import time
import argparse
import sys
import statistics
import psutil

# Diverse Option Symbols for Direct and Fallback querying
HISTORICAL_SYMBOLS = [
    "AAPL230616C00150000", "AAPL230616C00160000", "AAPL230616C00170000",
    "MSFT230616C00300000", "MSFT230616C00310000", "MSFT230616C00320000"
]

SPX_SYMBOLS = [
    "SPX241220C05000000", "SPX241220P05000000", "SPX241220C05100000",
    "SPX241220P05100000", "SPX251219C06000000", "SPX251219P06000000"
]

GREEN = "\033[92m"
RED = "\033[91m"
RESET = "\033[0m"

class ThetaDataStressTest:
    def __init__(self, host, port, token, concurrency, requests_count, category):
        self.host = host
        self.port = port
        self.token = token
        self.concurrency = concurrency
        self.requests_count = requests_count
        self.category = category  # 'direct_ohlc', 'direct_quote', 'fallback_hist', 'fallback_spx', 'mixed'
        
        self.base_url = f"http://{host}:{port}"
        
        self.latencies = []
        self.success_count = 0
        self.failures = 0
        self.status_codes = []

    def get_url_and_payload(self, req_id):
        """Constructs target url, method, params, and payload based on category."""
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }
        method = "POST"
        params = None
        payload = None
        
        if self.category == "direct_ohlc":
            method = "GET"
            path = "/v3/option/snapshot/ohlc"
            # direct ThetaData wants YYYYMMDD string format
            params = {
                "symbol": "AAPL",
                "expiration": "20260619",
                "strike": str(150 + (req_id % 10) * 10) + ".00",
                "right": "C" if req_id % 2 == 0 else "P"
            }
        elif self.category == "direct_quote":
            method = "GET"
            path = "/v3/option/at_time/quote"
            params = {
                "symbol": "AAPL",
                "expiration": "20241108",
                "strike": "220.00",
                "right": "call",
                "start_date": "20241104",
                "end_date": "20241104",
                "time_of_day": "09:30:0" + str(req_id % 9) + ".000"
            }
        elif self.category == "fallback_hist":
            path = "/v1/options/snapshots"
            sym = HISTORICAL_SYMBOLS[req_id % len(HISTORICAL_SYMBOLS)]
            payload = {"symbols": sym}
        elif self.category == "fallback_spx":
            path = "/v1/options/snapshots"
            sym = SPX_SYMBOLS[req_id % len(SPX_SYMBOLS)]
            payload = {"symbols": sym}
        else:  # mixed
            path = "/v1/options/snapshots"
            sym1 = HISTORICAL_SYMBOLS[req_id % len(HISTORICAL_SYMBOLS)]
            sym2 = SPX_SYMBOLS[req_id % len(SPX_SYMBOLS)]
            payload = {"symbols": [sym1, sym2]}
            
        return method, self.base_url + path, headers, params, payload

    async def worker(self, queue, session):
        """Processes requests from the queue concurrently."""
        while not queue.empty():
            req_id = await queue.get()
            method, url, headers, params, payload = self.get_url_and_payload(req_id)
            
            start_time = time.time()
            try:
                if method == "GET":
                    async with session.get(url, headers=headers, params=params, timeout=30.0) as resp:
                        latency = time.time() - start_time
                        self.latencies.append(latency)
                        self.status_codes.append(resp.status)
                        cache_header = resp.headers.get("X-Cache", "NONE")
                        
                        if resp.status == 200:
                            text = await resp.text()
                            if "error" not in text.lower() and len(text) > 10:
                                self.success_count += 1
                                print(f"  [Req-{req_id:02d}] {GREEN}SUCCESS{RESET} | Latency: {latency:.3f}s | Cache: {cache_header}")
                            else:
                                self.failures += 1
                                print(f"  [Req-{req_id:02d}] {RED}FAILED{RESET} (Internal Error) | Latency: {latency:.3f}s | Cache: {cache_header}")
                        else:
                            self.failures += 1
                            print(f"  [Req-{req_id:02d}] {RED}FAILED{RESET} (Status {resp.status}) | Latency: {latency:.3f}s | Cache: {cache_header}")
                else:  # POST
                    async with session.post(url, headers=headers, json=payload, timeout=30.0) as resp:
                        latency = time.time() - start_time
                        self.latencies.append(latency)
                        self.status_codes.append(resp.status)
                        cache_header = resp.headers.get("X-Cache", "NONE")
                        
                        if resp.status == 200:
                            text = await resp.text()
                            if "error" not in text.lower() and len(text) > 10:
                                self.success_count += 1
                                print(f"  [Req-{req_id:02d}] {GREEN}SUCCESS{RESET} | Latency: {latency:.3f}s | Cache: {cache_header}")
                            else:
                                self.failures += 1
                                print(f"  [Req-{req_id:02d}] {RED}FAILED{RESET} (Internal Error) | Latency: {latency:.3f}s | Cache: {cache_header}")
                        else:
                            self.failures += 1
                            print(f"  [Req-{req_id:02d}] {RED}FAILED{RESET} (Status {resp.status}) | Latency: {latency:.3f}s | Cache: {cache_header}")
            except Exception as e:
                latency = time.time() - start_time
                self.latencies.append(latency)
                self.failures += 1
                self.status_codes.append(500)
                print(f"  [Req-{req_id:02d}] {RED}EXCEPTION{RESET}: {type(e).__name__} | Latency: {latency:.3f}s")
            finally:
                queue.task_done()

    async def run(self):
        print(f"\n============================================================")
        print(f"ThetaData Concurrency Stress & Load Tester")
        print(f"============================================================")
        print(f"Target Server:  {self.base_url}")
        print(f"Category:       {self.category.upper()}")
        print(f"Total Requests: {self.requests_count}")
        print(f"Concurrency:    {self.concurrency} parallel streams")
        print(f"============================================================\n")

        queue = asyncio.Queue()
        for i in range(self.requests_count):
            await queue.put(i)

        start_time = time.time()
        
        # Configure a fresh ClientSession for the stress test
        connector = aiohttp.TCPConnector(limit=self.concurrency)
        async with aiohttp.ClientSession(connector=connector) as session:
            workers = [asyncio.create_task(self.worker(queue, session)) for _ in range(self.concurrency)]
            await queue.join()
            
            for w in workers:
                w.cancel()

        total_time = time.time() - start_time
        self.report(total_time)

    def report(self, total_time):
        print("\n" + "="*60)
        print(f"  THETADATA LOAD TEST REPORT: {self.category.upper()}  ")
        print("="*60)
        print(f"  Simulated Concurrency: {self.concurrency}")
        print(f"  Total Queries Sent:    {self.requests_count}")
        print(f"  Successful Responses:  {self.success_count}/{self.requests_count} ({self.success_count/self.requests_count*100:.1f}%)")
        print(f"  Failed Responses:      {self.failures}")
        print(f"  Total Duration:        {total_time:.2f} seconds")
        
        if self.latencies:
            avg_lat = statistics.mean(self.latencies)
            p95 = statistics.quantiles(self.latencies, n=20)[18] if len(self.latencies) >= 20 else max(self.latencies)
            p99 = statistics.quantiles(self.latencies, n=100)[98] if len(self.latencies) >= 100 else max(self.latencies)
            
            print(f"  Avg Latency:           {avg_lat:.3f} s")
            print(f"  Min Latency:           {min(self.latencies):.3f} s")
            print(f"  Max Latency:           {max(self.latencies):.3f} s")
            print(f"  p95 Latency:           {p95:.3f} s")
            print(f"  p99 Latency:           {p99:.3f} s")
            print(f"  Throughput:            {self.requests_count / total_time:.2f} req/sec")
            
            # Print status code distribution
            from collections import Counter
            code_counts = Counter(self.status_codes)
            codes_str = ", ".join(f"HTTP {k}: {v}" for k, v in code_counts.items())
            print(f"  Status Codes:          {codes_str}")
        print("="*60 + "\n")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ThetaData Concurrency Stress & Load Tester")
    parser.add_argument("--host", default="100.70.107.106", help="ThinkCentre host IP")
    parser.add_argument("--port", type=int, default=8768, help="REST API port")
    parser.add_argument("--token", default="a8b20ed4-80cb-493e-94e9-7d71cac1b9c2", help="Proxy authorization token")
    parser.add_argument("--concurrency", type=int, default=5, help="Number of parallel requests")
    parser.add_argument("--requests", type=int, default=10, help="Total requests to send")
    parser.add_argument("--category", default="direct_ohlc", choices=["direct_ohlc", "direct_quote", "fallback_hist", "fallback_spx", "mixed"], help="Query category")
    args = parser.parse_args()

    tester = ThetaDataStressTest(
        host=args.host,
        port=args.port,
        token=args.token,
        concurrency=args.concurrency,
        requests_count=args.requests,
        category=args.category
    )

    try:
        asyncio.run(tester.run())
    except KeyboardInterrupt:
        print("\nTest interrupted.")
        sys.exit(0)
