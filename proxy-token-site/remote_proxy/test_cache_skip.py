#!/usr/bin/env python3
"""
Automated Test for Proxy Caching Validation.
Verifies that historical bar queries return X-Cache: MISS on the first call (fetching from Alpaca),
and X-Cache: HIT on the second call, proving that the outbound call to Alpaca is bypassed.
"""

import asyncio
import aiohttp
import time
import sys

PROXY_URL = "http://localhost:8766/v1/history/bars"
TEST_TOKEN = "967d4072-bb60-479a-958b-8003f493bc5d"
SYMBOL = "NVDA"

GREEN = "\033[92m"
RED = "\033[91m"
RESET = "\033[0m"

async def test_cache_skipping():
    print(f"\n============================================================")
    print(f"Proxy Caching & Alpaca Skip Validation Test")
    print(f"============================================================")
    print(f"Target Endpoint: {PROXY_URL}")
    print(f"Symbol:          {SYMBOL}")
    print(f"============================================================\n")

    headers = {
        "Authorization": f"Bearer {TEST_TOKEN}",
        "Content-Type": "application/json"
    }
    payload = {
        "symbol": SYMBOL,
        "timeframe": "1Min",
        "start": "2026-05-19",
        "end": "2026-05-22",
        "limit": 100
    }

    try:
        async with aiohttp.ClientSession() as session:
            # --- Call 1: Expect Cache Miss (Must fetch from Alpaca) ---
            print("Sending First Query (Expect Cache MISS)...")
            start1 = time.time()
            async with session.post(PROXY_URL, headers=headers, json=payload, timeout=15.0) as resp1:
                latency1 = time.time() - start1
                if resp1.status != 200:
                    text = await resp1.text()
                    print(f"{RED}✗ First Query failed with status {resp1.status}: {text}{RESET}")
                    sys.exit(1)
                
                cache_header1 = resp1.headers.get("X-Cache", "NONE")
                print(f"  ✓ First Query completed in {latency1:.3f} s")
                print(f"  ✓ First Query X-Cache Header: {cache_header1}")
                
                if cache_header1 != "MISS":
                    print(f"{RED}✗ Expected X-Cache: MISS on first call, got {cache_header1}{RESET}")
                    sys.exit(1)

            # Sleep briefly
            await asyncio.sleep(0.5)

            # --- Call 2: Expect Cache Hit (Must skip Alpaca and return instantly) ---
            print("\nSending Second Query (Expect Cache HIT & instant return)...")
            start2 = time.time()
            async with session.post(PROXY_URL, headers=headers, json=payload, timeout=5.0) as resp2:
                latency2 = time.time() - start2
                if resp2.status != 200:
                    text = await resp2.text()
                    print(f"{RED}✗ Second Query failed with status {resp2.status}: {text}{RESET}")
                    sys.exit(1)

                cache_header2 = resp2.headers.get("X-Cache", "NONE")
                print(f"  ✓ Second Query completed in {latency2*1000:.2f} ms")
                print(f"  ✓ Second Query X-Cache Header: {cache_header2}")

                # Validation Assertions
                if cache_header2 != "HIT":
                    print(f"{RED}✗ Expected X-Cache: HIT on second call, got {cache_header2}{RESET}")
                    sys.exit(1)

                # Instantiating socket connections to Alpaca takes > 300ms.
                # A local cache HIT should take < 10ms.
                if latency2 > 0.050:
                    print(f"{RED}✗ Cache Hit took too long: {latency2*1000:.1f}ms. Direct Alpaca call may not have been skipped!{RESET}")
                    sys.exit(1)
                
                speedup = latency1 / latency2 if latency2 > 0 else float('inf')
                print(f"\n{GREEN}✓ SUCCESS: Cache Hit verified successfully!{RESET}")
                print(f"{GREEN}✓ latency1 (Alpaca) = {latency1:.3f} s{RESET}")
                print(f"{GREEN}✓ latency2 (Cache)  = {latency2*1000:.2f} ms ({speedup:.1f}x speedup!){RESET}")
                print(f"{GREEN}✓ Direct network call to Alpaca was successfully skipped!{RESET}")

    except Exception as e:
        print(f"{RED}✗ Test exception occurred: {e}{RESET}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(test_cache_skipping())
