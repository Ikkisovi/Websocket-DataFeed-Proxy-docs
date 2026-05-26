#!/usr/bin/env python3
"""
Performance and Concurrency Benchmarking Tool for Alpaca Cloud Proxy.
Simulates multiple concurrent WebSocket stream subscribers and huge historical bar requests.
"""

import asyncio
import aiohttp
import websockets
import json
import time
import argparse
import sys
import statistics
import psutil
import msgpack

# A list of diverse symbols to use for concurrent REST requests
SYMBOLS = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "NFLX", "AMD", "INTC",
    "QCOM", "AVGO", "TXN", "MU", "AMAT", "LRCX", "ADI", "KLAC", "SNPS", "CDNS"
]

def unpack_message(message):
    if isinstance(message, (bytes, bytearray)):
        return msgpack.unpackb(message, raw=False)
    if isinstance(message, str):
        return json.loads(message)
    return message

class ProxyBenchmark:
    def __init__(self, host, ws_port, rest_port, token, api_key, api_secret, conns_count, reqs_count, duration, bars_limit):
        self.host = host
        self.ws_port = ws_port
        self.rest_port = rest_port
        self.token = token
        self.api_key = api_key
        self.api_secret = api_secret
        self.conns_count = conns_count
        self.reqs_count = reqs_count
        self.duration = duration
        self.bars_limit = bars_limit

        self.ws_url = f"ws://{host}:{ws_port}/stream"
        self.rest_url = f"http://{host}:{rest_port}/v1/history/bars"

        # Metrics lists
        self.ws_connection_latencies = []
        self.ws_auth_latencies = []
        self.ws_msgs_received = {}
        self.ws_failures = 0
        self.ws_success_conns = 0

        self.rest_latencies = []
        self.rest_success_count = 0
        self.rest_failures = 0
        self.rest_status_codes = []

    async def get_system_load(self):
        """Query host CPU and Memory utilization."""
        try:
            cpu = psutil.cpu_percent(interval=None)
            mem = psutil.virtual_memory().percent
            return cpu, mem
        except Exception:
            return 0.0, 0.0

    async def run_ws_client(self, client_id):
        """Simulate a single WebSocket client connecting, authenticating, and subscribing."""
        start_time = time.time()
        self.ws_msgs_received[client_id] = 0
        try:
            conn_start = time.time()
            async with websockets.connect(self.ws_url) as ws:
                conn_latency = time.time() - conn_start
                self.ws_connection_latencies.append(conn_latency)

                # Wait for welcome message
                # Some versions might wait or we send auth first
                auth_start = time.time()
                if self.token:
                    auth_msg = {"action": "auth", "token": self.token}
                else:
                    auth_msg = {"action": "auth", "key": self.api_key, "secret": self.api_secret}
                await ws.send(json.dumps(auth_msg))

                # Receive auth response
                auth_resp = await asyncio.wait_for(ws.recv(), timeout=5.0)
                auth_latency = time.time() - auth_start
                self.ws_auth_latencies.append(auth_latency)

                # Check if auth succeeded
                try:
                    resp_data = unpack_message(auth_resp)
                    if isinstance(resp_data, list) and resp_data[0].get("T") == "success":
                        self.ws_success_conns += 1
                    else:
                        print(f"[WS-{client_id}] Auth failed: {resp_data}")
                        self.ws_failures += 1
                        return
                except Exception as e:
                    print(f"[WS-{client_id}] Auth parse error: {e}")
                    self.ws_failures += 1
                    return

                # Subscribe to a unique set of symbols to test fanout
                sub_symbols = [SYMBOLS[client_id % len(SYMBOLS)]]
                sub_msg = {"action": "subscribe", "trades": sub_symbols, "quotes": sub_symbols}
                await ws.send(json.dumps(sub_msg))

                # Wait for subscription confirmation
                sub_confirm_raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
                sub_confirm = unpack_message(sub_confirm_raw)

                # Listen for messages for the specified duration
                end_time = time.time() + self.duration
                while time.time() < end_time:
                    try:
                        # Wait for a message with a short timeout to check loop termination
                        msg_raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                        msg = unpack_message(msg_raw)
                        self.ws_msgs_received[client_id] += 1
                    except asyncio.TimeoutError:
                        continue
        except Exception as e:
            print(f"[WS-{client_id}] Connection error: {type(e).__name__} {repr(e)}", flush=True)
            self.ws_failures += 1

    async def run_rest_request(self, req_id):
        """Simulate a single REST historical bar query (cache miss likely)."""
        symbol = SYMBOLS[req_id % len(SYMBOLS)]
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }
        # Use dynamic date to ensure cache miss if desired, or static to hit
        # We request 1 year of daily bars or 2 days of minute bars to make it heavy
        payload = {
            "symbol": symbol,
            "timeframe": "1Min",
            "start": "2026-05-18",
            "end": "2026-05-22",
            "limit": self.bars_limit
        }

        start_time = time.time()
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(self.rest_url, headers=headers, json=payload, timeout=30.0) as resp:
                    latency = time.time() - start_time
                    self.rest_latencies.append(latency)
                    self.rest_status_codes.append(resp.status)

                    if resp.status == 200:
                        text = await resp.text()
                        if len(text) > 100:
                            self.rest_success_count += 1
                        else:
                            self.rest_failures += 1
                    else:
                        self.rest_failures += 1
        except Exception as e:
            latency = time.time() - start_time
            self.rest_latencies.append(latency)
            self.rest_failures += 1

    async def run(self):
        print(f"\n============================================================")
        print(f"Alpaca Cloud Proxy Load Test Benchmark")
        print(f"============================================================")
        print(f"Target host: {self.host}")
        print(f"WS URL:      {self.ws_url} (Conns={self.conns_count})")
        print(f"REST URL:    {self.rest_url} (Parallel Requests={self.reqs_count})")
        print(f"Duration:    {self.duration} seconds")
        print(f"Bars Limit:  {self.bars_limit} per REST query")
        print(f"============================================================\n")

        # Capture initial load
        start_cpu, start_mem = await self.get_system_load()

        # Build execution tasks
        start_time = time.time()
        tasks = []

        # 1. Spawn WebSocket connections
        for i in range(self.conns_count):
            tasks.append(self.run_ws_client(i))

        # 2. Spawn REST requests
        for i in range(self.reqs_count):
            tasks.append(self.run_rest_request(i))

        # Wait for all load simulators to complete
        await asyncio.gather(*tasks)
        total_time = time.time() - start_time

        # Capture peak/final load
        end_cpu, end_mem = await self.get_system_load()

        # Compile metrics
        self.report(total_time, start_cpu, start_mem, end_cpu, end_mem)

    def report(self, total_time, start_cpu, start_mem, end_cpu, end_mem):
        print("\n" + "="*60)
        print("  BENCHMARK PERFORMANCE REPORT  ")
        print("="*60)
        
        # System Load
        print("\n[System Resource Utilization]")
        print(f"  Initial Host Load: CPU={start_cpu:.1f}%, Memory={start_mem:.1f}%")
        print(f"  Final/Peak Load:   CPU={end_cpu:.1f}%, Memory={end_mem:.1f}%")

        # WS Report
        print("\n[WebSocket Connections]")
        print(f"  Simulated Conns:   {self.conns_count}")
        print(f"  Successfully Authed: {self.ws_success_conns}/{self.conns_count}")
        print(f"  Failed/Dropped:     {self.ws_failures}")
        
        if self.ws_connection_latencies:
            print(f"  Avg Connect Time:  {statistics.mean(self.ws_connection_latencies)*1000:.1f} ms")
            print(f"  Min Connect Time:  {min(self.ws_connection_latencies)*1000:.1f} ms")
            print(f"  Max Connect Time:  {max(self.ws_connection_latencies)*1000:.1f} ms")
            
        if self.ws_auth_latencies:
            print(f"  Avg Auth Response: {statistics.mean(self.ws_auth_latencies)*1000:.1f} ms")
            
        total_ws_msgs = sum(self.ws_msgs_received.values())
        print(f"  Total WS Messages: {total_ws_msgs}")
        if self.ws_success_conns > 0:
            print(f"  Throughput:        {total_ws_msgs / total_time:.1f} msgs/sec")

        # REST Report
        print("\n[REST History Requests]")
        print(f"  Simulated Requests: {self.reqs_count}")
        print(f"  Successful (200):   {self.rest_success_count}/{self.reqs_count}")
        print(f"  Failed/Errors:      {self.rest_failures}")
        
        if self.rest_latencies:
            avg_lat = statistics.mean(self.rest_latencies)
            p95 = statistics.quantiles(self.rest_latencies, n=20)[18] if len(self.rest_latencies) >= 20 else max(self.rest_latencies)
            p99 = statistics.quantiles(self.rest_latencies, n=100)[98] if len(self.rest_latencies) >= 100 else max(self.rest_latencies)
            
            print(f"  Avg Latency:        {avg_lat:.3f} s")
            print(f"  Min Latency:        {min(self.rest_latencies):.3f} s")
            print(f"  Max Latency:        {max(self.rest_latencies):.3f} s")
            print(f"  p95 Latency:        {p95:.3f} s")
            print(f"  p99 Latency:        {p99:.3f} s")
            print(f"  Throughput:        {self.reqs_count / total_time:.2f} req/sec")
        
        print("\n" + "="*60 + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Alpaca Cloud Proxy Load Test Benchmark")
    parser.add_argument("--host", default="localhost", help="Proxy Host IP (default: localhost)")
    parser.add_argument("--ws-port", type=int, default=8765, help="WS Port (default: 8765)")
    parser.add_argument("--rest-port", type=int, default=8766, help="REST Port (default: 8766)")
    parser.add_argument("--token", default="967d4072-bb60-479a-958b-8003f493bc5d", help="Proxy auth token")
    parser.add_argument("--key", default="PKTEH544LNSKZEHOJ7MWSN7AY5", help="Alpaca API Key ID")
    parser.add_argument("--secret", default="71mcpK41TvRsAM6aTa6gvmwwsdHeB459MG9GVMWX5KSY", help="Alpaca API Secret Key")
    parser.add_argument("--conns", type=int, default=10, help="Number of WS connections")
    parser.add_argument("--requests", type=int, default=5, help="Number of concurrent REST requests")
    parser.add_argument("--duration", type=int, default=10, help="Test duration in seconds")
    parser.add_argument("--bars-limit", type=int, default=1000, help="Historical bars limit parameter")
    args = parser.parse_args()

    benchmark = ProxyBenchmark(
        host=args.host,
        ws_port=args.ws_port,
        rest_port=args.rest_port,
        token=args.token,
        api_key=args.key,
        api_secret=args.secret,
        conns_count=args.conns,
        reqs_count=args.requests,
        duration=args.duration,
        bars_limit=args.bars_limit
    )

    try:
        asyncio.run(benchmark.run())
    except KeyboardInterrupt:
        print("\nBenchmark interrupted by user.")
        sys.exit(0)
