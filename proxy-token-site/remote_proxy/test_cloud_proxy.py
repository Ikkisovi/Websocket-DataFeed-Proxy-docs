#!/usr/bin/env python3
"""
Alpaca Cloud Proxy Test Suite v3
Tests: disk cache, REST API (POST /v1/), WebSocket, concurrent requests
"""

import asyncio
import aiohttp
import json
import time
import sys
import subprocess

WS_URL = "ws://35.95.134.76:8767"
REST_URL = "http://35.95.134.76:8768"
TEST_TOKEN = "a8b20ed4-80cb-493e-94e9-7d71cac1b9c2"
TIMEOUT = aiohttp.ClientTimeout(total=15)

GREEN = "\033[92m"
RED = "\033[91m"
RESET = "\033[0m"

passed = 0
failed = 0

async def log_result(name, success, detail=""):
    global passed, failed
    if success:
        passed += 1
        print(f"{GREEN}✓{RESET} {name}")
    else:
        failed += 1
        print(f"{RED}✗{RESET} {name}: {detail}")

async def test_health():
    try:
        async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
            async with session.get(f"{REST_URL}/health") as resp:
                text = await resp.text()
                await log_result("Health Check", resp.status == 200 and text == "OK", f"status={resp.status}")
    except Exception as e:
        await log_result("Health Check", False, str(e))

async def test_rest_history_bars():
    try:
        headers = {"Authorization": f"Bearer {TEST_TOKEN}", "Content-Type": "application/json"}
        payload = {"symbol": "AAPL", "timeframe": "1Day", "start": "2024-01-01", "end": "2024-01-10", "limit": 5}
        start = time.time()
        async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
            async with session.post(f"{REST_URL}/v1/history/bars", headers=headers, json=payload) as resp:
                elapsed = time.time() - start
                text = await resp.text()
                has_data = len(text) > 50
                cache_header = resp.headers.get("X-Cache", "MISS")
                await log_result(f"REST History Bars ({cache_header}, {elapsed:.2f}s)", resp.status == 200 and has_data, f"status={resp.status}")
    except Exception as e:
        await log_result("REST History Bars", False, str(e))

async def test_rest_cache_hit():
    try:
        headers = {"Authorization": f"Bearer {TEST_TOKEN}", "Content-Type": "application/json"}
        payload = {"symbol": "AAPL", "timeframe": "1Day", "start": "2024-01-01", "end": "2024-01-10", "limit": 5}
        async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
            await session.post(f"{REST_URL}/v1/history/bars", headers=headers, json=payload)
        start = time.time()
        async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
            async with session.post(f"{REST_URL}/v1/history/bars", headers=headers, json=payload) as resp:
                elapsed = time.time() - start
                cache_header = resp.headers.get("X-Cache", "UNKNOWN")
                success = cache_header in ["HIT", "DISK_HIT", "MEMORY_HIT"] and elapsed < 0.5
                await log_result(f"REST Cache Hit ({cache_header}, {elapsed:.3f}s)", success, f"got {cache_header}")
    except Exception as e:
        await log_result("REST Cache Hit", False, str(e))

async def test_rest_invalid_token():
    try:
        headers = {"Authorization": "Bearer invalid_token", "Content-Type": "application/json"}
        payload = {"symbol": "AAPL", "timeframe": "1Day"}
        async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
            async with session.post(f"{REST_URL}/v1/history/bars", headers=headers, json=payload) as resp:
                await log_result("REST Invalid Token", resp.status in [401, 403], f"expected 401/403, got {resp.status}")
    except Exception as e:
        await log_result("REST Invalid Token", False, str(e))

async def test_options_contracts():
    try:
        headers = {"Authorization": f"Bearer {TEST_TOKEN}", "Content-Type": "application/json"}
        payload = {"underlying_symbols": "AAPL", "status": "active", "limit": 5}
        async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
            async with session.post(f"{REST_URL}/v1/options/contracts", headers=headers, json=payload) as resp:
                text = await resp.text()
                has_data = len(text) > 50
                await log_result("Options Contracts", resp.status == 200 and has_data, f"status={resp.status}")
    except Exception as e:
        await log_result("Options Contracts", False, str(e))

async def test_websocket_connect():
    try:
        import websockets
        uri = f"{WS_URL}/stocks"
        async with websockets.connect(uri, additional_headers={"Authorization": f"Bearer {TEST_TOKEN}"}) as ws:
            msg = {"action": "subscribe", "trades": ["AAPL"], "quotes": [], "bars": []}
            await ws.send(json.dumps(msg))
            response = await asyncio.wait_for(ws.recv(), timeout=5.0)
            data = json.loads(response)
            success = "subscriptions" in data or "error" not in data
            await log_result("WebSocket Connect + Subscribe", success, f"keys={list(data.keys())}")
    except Exception as e:
        await log_result("WebSocket Connect", False, str(e))

async def test_concurrent_requests():
    try:
        headers = {"Authorization": f"Bearer {TEST_TOKEN}", "Content-Type": "application/json"}
        payload = {"symbol": "AAPL", "timeframe": "1Day", "start": "2024-01-01", "end": "2024-01-05"}
        async def single_request():
            async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
                async with session.post(f"{REST_URL}/v1/history/bars", headers=headers, json=payload) as resp:
                    return resp.status == 200
        start = time.time()
        results = await asyncio.gather(*[single_request() for _ in range(10)])
        elapsed = time.time() - start
        success_count = sum(results)
        await log_result(f"Concurrent Requests (10x, {elapsed:.2f}s)", success_count >= 8, f"{success_count}/10 passed")
    except Exception as e:
        await log_result("Concurrent Requests", False, str(e))

async def test_disk_cache():
    try:
        result = subprocess.run(["ssh", "-i", "~/.ssh/id_ed25519", "-o", "StrictHostKeyChecking=no", "ec2-user@35.95.134.76", "sudo find /mnt/data/cache -name '*.json.gz' | wc -l"], capture_output=True, text=True, timeout=10)
        count = int(result.stdout.strip())
        await log_result(f"Disk Cache Files ({count} files)", count > 0, f"got {count}")
    except Exception as e:
        await log_result("Disk Cache Files", False, str(e))

async def test_admin_stats():
    try:
        headers = {"Authorization": f"Bearer {TEST_TOKEN}", "Content-Type": "application/json"}
        async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
            async with session.post(f"{REST_URL}/v1/admin/stats", headers=headers, json={}) as resp:
                await log_result("Admin Stats", resp.status == 200, f"status={resp.status}")
    except Exception as e:
        await log_result("Admin Stats", False, str(e))

async def test_gzip_compression():
    try:
        headers = {"Authorization": f"Bearer {TEST_TOKEN}", "Content-Type": "application/json", "Accept-Encoding": "gzip"}
        payload = {"symbol": "AAPL,MSFT,GOOGL,AMZN,TSLA", "timeframe": "1Day", "start": "2023-01-01", "end": "2024-01-01"}
        async with aiohttp.ClientSession(timeout=TIMEOUT) as session:
            async with session.post(f"{REST_URL}/v1/history/bars", headers=headers, json=payload) as resp:
                encoding = resp.headers.get("Content-Encoding", "none")
                await log_result(f"Gzip Compression ({encoding})", encoding == "gzip", f"got {encoding}")
    except Exception as e:
        await log_result("Gzip Compression", False, str(e))

async def main():
    print(f"\n{'='*60}")
    print("Alpaca Cloud Proxy Test Suite v3")
    print(f"REST API:  {REST_URL}")
    print(f"WebSocket: {WS_URL}")
    print(f"{'='*60}\n")
    
    await test_health()
    await test_rest_history_bars()
    await test_rest_cache_hit()
    await test_rest_invalid_token()
    await test_options_contracts()
    await test_websocket_connect()
    await test_concurrent_requests()
    await test_disk_cache()
    await test_admin_stats()
    await test_gzip_compression()
    
    print(f"\n{'='*60}")
    print(f"Results: {GREEN}{passed} passed{RESET}, {RED}{failed} failed{RESET}")
    print(f"{'='*60}")
    return failed == 0

if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
