"""Unit tests for KeyPool counters and header reconciliation (T4)."""
import time
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from alpaca_key_pool import KeyEntry, KeyPool

def test_sliding_window_exhaustion():
    """Test: 250 simulated hits in 60s against 200/min key → exhausted at #200."""
    key = KeyEntry(key="K", secret="S", tier="free", limit_per_min=200, label="free_1")
    now = time.time()
    
    # 199 hits -> not exhausted
    for _ in range(199):
        key.record_request(now=now)
    assert key.is_exhausted(now=now) is False
    
    # 200th hit -> exhausted
    key.record_request(now=now)
    assert key.is_exhausted(now=now) is True
    
    # 250 hits total -> still exhausted
    for _ in range(50):
        key.record_request(now=now)
    assert key.is_exhausted(now=now) is True

def test_sliding_window_recovery():
    """Test that after 60 seconds, the key recovers."""
    key = KeyEntry(key="K", secret="S", tier="free", limit_per_min=200, label="free_1")
    start = time.time()
    
    # Exhaust it
    for _ in range(200):
        key.record_request(now=start)
    assert key.is_exhausted(now=start) is True
    
    # 61 seconds later -> recovered
    assert key.is_exhausted(now=start + 61.0) is False

def test_header_reconciliation_reduces_remaining():
    """Test: header says 50-remaining but local count says 80 -> local count updated to 50."""
    key = KeyEntry(key="K", secret="S", tier="free", limit_per_min=200, label="free_1")
    now = time.time()
    
    # Local count says 80 remaining (120 hits recorded)
    for _ in range(120):
        key.record_request(now=now)
        
    local_remaining = 200 - len(key.timestamps)
    assert local_remaining == 80
    
    # Header says 50 remaining, meaning 150 hits actually happened upstream
    headers = {
        "X-RateLimit-Remaining": "50",
        "X-RateLimit-Reset": str(now + 30)
    }
    key.record_response(headers, now=now)
    
    # Local count should be updated so 200 - count = 50 -> count = 150
    assert len(key.timestamps) == 150
    assert key.remaining_from_header == 50
    
    # Still not exhausted
    assert key.is_exhausted(now=now) is False

def test_header_reconciliation_zero_remaining():
    """Test when header says 0 remaining, key is exhausted immediately."""
    key = KeyEntry(key="K", secret="S", tier="free", limit_per_min=200, label="free_1")
    now = time.time()
    
    # 0 hits locally
    assert len(key.timestamps) == 0
    
    headers = {
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": str(now + 45)
    }
    key.record_response(headers, now=now)
    
    # Should be immediately exhausted even though local timestamps weren't artificially padded to 200
    # because remaining_from_header = 0 is a direct truth signal
    assert key.is_exhausted(now=now) is True

def test_header_reconciliation_reset_clears_exhaustion():
    """Test that crossing the reset_at boundary clears header-based exhaustion."""
    key = KeyEntry(key="K", secret="S", tier="free", limit_per_min=200, label="free_1")
    now = time.time()
    
    headers = {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": str(now + 10)
    }
    key.record_response(headers, now=now)
    assert key.is_exhausted(now=now) is True
    
    # 11 seconds later, past reset
    assert key.is_exhausted(now=now + 11) is False
    # State should be cleared
    assert key.remaining_from_header is None
    assert key.reset_at is None

if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
