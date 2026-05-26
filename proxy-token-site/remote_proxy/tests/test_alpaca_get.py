"""Unit tests for alpaca_get helper (T5)."""
import os
import sys
import time
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from alpaca_key_pool import alpaca_get, KeyPool, KeyEntry, reset_key_pool, get_key_pool

# We need pytest-asyncio to run these tests
# Assuming the project uses it, or we can just use our own event loop runner

class MockResponse:
    def __init__(self, status, body=b"{}", headers=None):
        self.status = status
        self._body = body
        self.headers = headers or {}
        
    async def read(self):
        return self._body
        
    async def __aenter__(self):
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        pass


def make_mock_session(*responses):
    session = MagicMock()
    # Create an iterator of async contexts
    
    returns = []
    for resp in responses:
        if isinstance(resp, Exception):
            returns.append(resp)
        else:
            returns.append(resp)
            
    session.get.side_effect = returns
    return session

@pytest.fixture
def mock_pool():
    reset_key_pool()
    pool = get_key_pool()
    pool.entries = [
        KeyEntry(key="PK", secret="SK", tier="paid", limit_per_min=10_000, label="paid"),
        KeyEntry(key="FK1", secret="FS1", tier="free", limit_per_min=200, label="free_1")
    ]
    pool.paid = pool.entries[0]
    pool.free = [pool.entries[1]]
    return pool

def test_alpaca_get_success_on_first_try(mock_pool):
    async def _test():
        # Free eligible route
        session = make_mock_session(MockResponse(200, b'{"data": "success"}', {"X-RateLimit-Remaining": "199"}))
        
        status, headers, body, feed_class = await alpaca_get(
            session,
            "/v1/history/bars",
            {"end": "2020-01-01"}  # Old date -> free key
        )
        
        assert status == 200
        assert body == b'{"data": "success"}'
        assert feed_class == "iex"
        
        # Assert session.get was called with the free key
        session.get.assert_called_once()
        kwargs = session.get.call_args[1]
        assert kwargs["headers"]["APCA-API-KEY-ID"] == "FK1"
        
        # Verify rate limit was recorded
        assert mock_pool.free[0].remaining_from_header == 199
    asyncio.run(_test())

def test_alpaca_get_fallback_on_429(mock_pool):
    async def _test():
        # First response 429 (free), second response 200 (paid)
        session = make_mock_session(
            MockResponse(429, b'{"error": "rate limit"}', {"X-RateLimit-Remaining": "0"}),
            MockResponse(200, b'{"data": "success"}')
        )
        
        status, headers, body, feed_class = await alpaca_get(
            session,
            "/v1/history/bars",
            {"end": "2020-01-01"}
        )
        
        assert status == 200
        assert body == b'{"data": "success"}'
        assert feed_class == "sip"  # Because we fell back to paid
        
        assert session.get.call_count == 2
        
        first_call_kwargs = session.get.call_args_list[0][1]
        assert first_call_kwargs["headers"]["APCA-API-KEY-ID"] == "FK1"
        
        second_call_kwargs = session.get.call_args_list[1][1]
        assert second_call_kwargs["headers"]["APCA-API-KEY-ID"] == "PK"
    asyncio.run(_test())

def test_alpaca_get_all_exhausted(mock_pool):
    async def _test():
        # Both keys are exhausted locally
        now = time.time()
        mock_pool.free[0].timestamps.extend([now] * 200)
        mock_pool.paid.timestamps.extend([now] * 10000)
        
        session = make_mock_session()
        
        status, headers, body, feed_class = await alpaca_get(
            session,
            "/v1/history/bars",
            {"end": "2020-01-01"}
        )
        
        assert status == 429
        assert "Retry-After" in headers
        assert session.get.call_count == 0  # No network requests made
    asyncio.run(_test())

def test_alpaca_get_network_error_fallback(mock_pool):
    async def _test():
        session = make_mock_session(
            aiohttp.ClientError("Network timeout"),
            MockResponse(200, b'{"data": "success"}')
        )
        
        status, headers, body, feed_class = await alpaca_get(
            session,
            "/v1/history/bars",
            {"end": "2020-01-01"}
        )
        
        assert status == 200
        assert feed_class == "sip"
        assert session.get.call_count == 2
    asyncio.run(_test())
    
if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
