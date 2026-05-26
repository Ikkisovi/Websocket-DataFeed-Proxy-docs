#!/usr/bin/env python3
"""
Unit Test for Proxy Caching Validation.
Mocks outbound aiohttp ClientSession calls to Alpaca, and asserts that:
1. The first call to history endpoints triggers a mock outbound request (X-Cache: MISS).
2. The second call to history endpoints DOES NOT trigger a mock outbound request (X-Cache: HIT).
3. The mock was called exactly once in total, physically proving that Alpaca is bypassed on cache hit.
"""

import unittest
from unittest.mock import AsyncMock, MagicMock, patch
import sys
import os
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

# Set up paths to import from remote_proxy/
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import enhanced

GREEN = "\033[92m"
RED = "\033[91m"
RESET = "\033[0m"

class TestProxyCacheUnit(AioHTTPTestCase):
    async def get_application(self):
        app = web.Application()
        app.router.add_post("/v1/history/bars", enhanced.handle_history_request)
        app.router.add_post("/v1/history/options/bars", enhanced.handle_options_history_request)
        return app

    def setUp(self):
        super().setUp()
        # Clean cache before each test
        enhanced.history_cache.clear()

    async def test_cache_skips_alpaca_outbound(self):
        print(f"\n============================================================")
        print(f"Proxy Stock Cache Mocking & Bypassing Unit Test")
        print(f"============================================================")

        # 1. Setup mock response data from Alpaca
        mock_response_data = {
            "bars": {
                "NVDA": [
                    {"t": "2026-05-20T09:30:00Z", "o": 100, "h": 105, "l": 99, "c": 102, "v": 1000}
                ]
            },
            "next_page_token": None
        }

        # Mock the async context manager returned by session.get(...)
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.json = AsyncMock(return_value=mock_response_data)

        mock_get_ctx = MagicMock()
        mock_get_ctx.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_get_ctx.__aexit__ = AsyncMock(return_value=None)

        # Mock client session and its get method
        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=mock_get_ctx)

        # Patch get_client_session to return our mock session
        with patch('enhanced.get_client_session', AsyncMock(return_value=mock_session)) as mock_get_sess:
            payload = {
                "symbol": "NVDA",
                "timeframe": "1Min",
                "start": "2026-05-19",
                "end": "2026-05-22",
                "limit": 100,
                "key": "mock_key",
                "secret": "mock_secret"
            }

            # --- REQUEST 1: Expect Cache Miss (Should call mock Alpaca) ---
            print("Sending First Stock Request (Expect Cache MISS)...")
            resp1 = await self.client.post("/v1/history/bars", json=payload)
            self.assertEqual(resp1.status, 200)
            
            headers1 = resp1.headers
            cache_header1 = headers1.get("X-Cache", "NONE")
            print(f"  ✓ First Stock Request X-Cache Header: {cache_header1}")
            self.assertEqual(cache_header1, "MISS")
            
            # Assert outbound call was made
            self.assertEqual(mock_session.get.call_count, 1, "Expected exactly 1 call to Alpaca on cache MISS")
            print(f"  ✓ Verified: Outbound Alpaca call was executed once.")

            # Reset call count tracker to explicitly verify subsequent behavior
            mock_session.get.reset_mock()

            # --- REQUEST 2: Expect Cache Hit (Should bypass mock Alpaca) ---
            print("\nSending Second Stock Request (Expect Cache HIT)...")
            resp2 = await self.client.post("/v1/history/bars", json=payload)
            self.assertEqual(resp2.status, 200)
            
            headers2 = resp2.headers
            cache_header2 = headers2.get("X-Cache", "NONE")
            print(f"  ✓ Second Stock Request X-Cache Header: {cache_header2}")
            self.assertEqual(cache_header2, "HIT")
            
            # Assert outbound call was NOT made
            self.assertEqual(mock_session.get.call_count, 0, "Expected 0 calls to Alpaca on cache HIT")
            print(f"  ✓ Verified: Outbound Alpaca call was bypassed completely.")

            # Validate that returned content matches our mock data
            body2 = await resp2.json()
            self.assertIn("bars", body2)
            self.assertIn("NVDA", body2["bars"])
            self.assertEqual(len(body2["bars"]["NVDA"]), 1)
            self.assertEqual(body2["bars"]["NVDA"][0]["c"], 102)

            print(f"\n{GREEN}✓ SUCCESS: Stock cache skipping verified physically via mock isolation!{RESET}")
            print(f"{GREEN}✓ No outbound client session get request was performed on cache hit!{RESET}")
            print(f"============================================================\n")

    async def test_options_cache_skips_alpaca_outbound(self):
        print(f"\n============================================================")
        print(f"Proxy Options Cache Mocking & Bypassing Unit Test")
        print(f"============================================================")

        # 1. Setup mock response data from Alpaca for options bars
        mock_response_data = {
            "bars": {
                "AAPL260619C00150000": [
                    {"t": "2026-05-20T09:30:00Z", "o": 10.0, "h": 10.5, "l": 9.9, "c": 10.2, "v": 100}
                ]
            },
            "next_page_token": None
        }

        # Mock the async context manager returned by session.get(...)
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.json = AsyncMock(return_value=mock_response_data)

        mock_get_ctx = MagicMock()
        mock_get_ctx.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_get_ctx.__aexit__ = AsyncMock(return_value=None)

        # Mock client session and its get method
        mock_session = MagicMock()
        mock_session.get = MagicMock(return_value=mock_get_ctx)

        # Patch get_client_session to return our mock session
        with patch('enhanced.get_client_session', AsyncMock(return_value=mock_session)) as mock_get_sess:
            payload = {
                "symbol": "AAPL260619C00150000",
                "timeframe": "1Min",
                "start": "2026-05-19",
                "end": "2026-05-22",
                "limit": 100,
                "key": "mock_key",
                "secret": "mock_secret"
            }

            # --- REQUEST 1: Expect Cache Miss (Should call mock Alpaca) ---
            print("Sending First Options Request (Expect Cache MISS)...")
            resp1 = await self.client.post("/v1/history/options/bars", json=payload)
            self.assertEqual(resp1.status, 200)
            
            headers1 = resp1.headers
            cache_header1 = headers1.get("X-Cache", "NONE")
            print(f"  ✓ First Options Request X-Cache Header: {cache_header1}")
            self.assertEqual(cache_header1, "MISS")
            
            # Assert outbound call was made
            self.assertEqual(mock_session.get.call_count, 1, "Expected exactly 1 call to Alpaca on cache MISS")
            print(f"  ✓ Verified: Outbound Alpaca call was executed once.")

            # Reset call count tracker
            mock_session.get.reset_mock()

            # --- REQUEST 2: Expect Cache Hit (Should bypass mock Alpaca) ---
            print("\nSending Second Options Request (Expect Cache HIT)...")
            resp2 = await self.client.post("/v1/history/options/bars", json=payload)
            self.assertEqual(resp2.status, 200)
            
            headers2 = resp2.headers
            cache_header2 = headers2.get("X-Cache", "NONE")
            print(f"  ✓ Second Options Request X-Cache Header: {cache_header2}")
            self.assertEqual(cache_header2, "HIT")
            
            # Assert outbound call was NOT made
            self.assertEqual(mock_session.get.call_count, 0, "Expected 0 calls to Alpaca on cache HIT")
            print(f"  ✓ Verified: Outbound Alpaca call was bypassed completely.")

            # Validate returned content matches mock data
            body2 = await resp2.json()
            self.assertIn("bars", body2)
            self.assertIn("AAPL260619C00150000", body2["bars"])
            self.assertEqual(len(body2["bars"]["AAPL260619C00150000"]), 1)
            self.assertEqual(body2["bars"]["AAPL260619C00150000"][0]["c"], 10.2)

            print(f"\n{GREEN}✓ SUCCESS: Options cache skipping verified physically via mock isolation!{RESET}")
            print(f"{GREEN}✓ No outbound client session get request was performed on cache hit!{RESET}")
            print(f"============================================================\n")

if __name__ == "__main__":
    unittest.main()
