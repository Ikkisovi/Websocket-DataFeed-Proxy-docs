"""Unit tests for KeyPool.pick() routing matrix (T3)."""
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from alpaca_key_pool import KeyPool, KeyEntry


def make_pool(num_free: int = 2, free_limit: int = 200) -> KeyPool:
    """Build a pool with paid + N free keys, bypassing env."""
    entries = [KeyEntry(key="PK", secret="SK", tier="paid", limit_per_min=10_000, label="paid")]
    for i in range(1, num_free + 1):
        entries.append(KeyEntry(
            key=f"FK{i}", secret=f"FS{i}", tier="free",
            limit_per_min=free_limit, label=f"free_{i}",
        ))
    return KeyPool(entries=entries)


# ─── Rule 1: force_paid override ─────────────────────────────────────────

def test_force_paid_overrides_everything():
    pool = make_pool(num_free=2)
    entry, reason = pool.pick("/v1/history/bars", {"end": "2020-01-01"}, force_paid=True)
    assert entry.label == "paid"
    assert reason == "force_paid"


# ─── Rule 2: endpoint requires paid (SIP/OPRA/snapshot/latest) ─────────

@pytest.mark.parametrize("endpoint", [
    "/v2/stocks/AAPL/snapshot",
    "/v2/stocks/AAPL/quotes/latest",
    "/v2/stocks/AAPL/trades/latest",
    "/v1/options/snapshots",
    "/v1/options/snapshots/expiry",
    "/v1/options/contracts",
    "/v1beta1/options/snapshots",
    "/v3/option/snapshot/quote",
    "/v1/crypto/us/latest/orderbooks",
    "/v1beta3/crypto/us/latest/orderbooks",
])
def test_endpoint_requires_paid(endpoint):
    pool = make_pool(num_free=2)
    entry, reason = pool.pick(endpoint, {})
    assert entry.label == "paid"
    assert reason == "endpoint_requires_paid"


# ─── Rule 3a: /v1/history/bars with explicit feed=sip → paid ───────────

def test_bars_feed_sip_explicit_routes_paid_even_with_old_end():
    pool = make_pool(num_free=2)
    entry, reason = pool.pick(
        "/v1/history/bars",
        {"feed": "sip", "end": "2020-01-01"},
    )
    assert entry.label == "paid"
    assert reason == "feed_sip_explicit"


# ─── Rule 3b: /v1/history/bars with missing end → paid (safe default) ──

def test_bars_end_missing_routes_paid():
    pool = make_pool(num_free=2)
    entry, reason = pool.pick("/v1/history/bars", {"symbol": "AAPL"})
    assert entry.label == "paid"
    assert reason == "end_missing"


def test_bars_end_unparseable_routes_paid():
    pool = make_pool(num_free=2)
    entry, reason = pool.pick("/v1/history/bars", {"end": "garbage"})
    assert entry.label == "paid"
    assert reason == "end_missing"


# ─── Rule 3c: /v1/history/bars with recent end → paid ──────────────────

def test_bars_end_recent_routes_paid():
    pool = make_pool(num_free=2)
    now_iso = datetime.now(timezone.utc).isoformat()  # right now → < 15min ago
    entry, reason = pool.pick("/v1/history/bars", {"end": now_iso})
    assert entry.label == "paid"
    assert reason == "end_recent"


def test_bars_end_just_inside_safety_margin_routes_paid():
    """end = now − 14min → still recent (< 15min + 60s buffer)."""
    pool = make_pool(num_free=2)
    end = (datetime.now(timezone.utc) - timedelta(minutes=14)).isoformat()
    entry, reason = pool.pick("/v1/history/bars", {"end": end})
    assert entry.label == "paid"
    assert reason == "end_recent"


# ─── Rule 3d: /v1/history/bars with old end → free ─────────────────────

def test_bars_end_old_routes_free():
    pool = make_pool(num_free=2)
    end = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    entry, reason = pool.pick("/v1/history/bars", {"end": end})
    assert entry.tier == "free"
    assert reason == "free_eligible"


def test_bars_end_old_round_robins_across_free_keys():
    pool = make_pool(num_free=2)
    end = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    e1, _ = pool.pick("/v1/history/bars", {"end": end, "symbol": "A"})
    e2, _ = pool.pick("/v1/history/bars", {"end": end, "symbol": "B"})
    e3, _ = pool.pick("/v1/history/bars", {"end": end, "symbol": "C"})
    # Round-robin: free_1, free_2, free_1
    assert (e1.label, e2.label, e3.label) == ("free_1", "free_2", "free_1")


def test_bars_old_with_date_only_format_routes_free():
    """`end=2025-01-02` (no time) should parse as end-of-day UTC and route free."""
    pool = make_pool(num_free=2)
    entry, reason = pool.pick("/v1/history/bars", {"end": "2020-01-02"})
    assert entry.tier == "free"
    assert reason == "free_eligible"


# ─── Rule 4: news always routes free ───────────────────────────────────

def test_news_routes_free():
    pool = make_pool(num_free=2)
    entry, reason = pool.pick("/v1/history/news", {})
    assert entry.tier == "free"
    assert reason == "free_eligible"


# ─── Exhaustion fallback ────────────────────────────────────────────────

def test_all_free_exhausted_falls_back_to_paid():
    pool = make_pool(num_free=2, free_limit=3)
    end = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    now = time.time()
    # Exhaust both free keys
    for fk in pool.free:
        fk.timestamps.extend([now] * fk.limit_per_min)
    entry, reason = pool.pick("/v1/history/bars", {"end": end}, now=now)
    assert entry.label == "paid"
    assert reason == "free_exhausted_fallback"


def test_one_free_exhausted_skips_to_other():
    pool = make_pool(num_free=2, free_limit=3)
    end = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    now = time.time()
    # Exhaust only free_1
    pool.free[0].timestamps.extend([now] * pool.free[0].limit_per_min)
    entry, reason = pool.pick("/v1/history/bars", {"end": end}, now=now)
    assert entry.label == "free_2"
    assert reason == "free_eligible"


def test_no_free_keys_configured_routes_paid_with_fallback_reason():
    pool = make_pool(num_free=0)
    end = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    entry, reason = pool.pick("/v1/history/bars", {"end": end})
    assert entry.label == "paid"
    assert reason == "free_exhausted_fallback"


def test_no_keys_configured_at_all_returns_none():
    pool = KeyPool(entries=[])
    entry, reason = pool.pick("/v1/history/news", {})
    assert entry is None
    assert reason == "no_keys_configured"


# ─── is_exhausted() behaviour ───────────────────────────────────────────

def test_is_exhausted_via_local_count():
    key = KeyEntry(key="K", secret="S", tier="free", limit_per_min=5, label="t")
    now = time.time()
    for _ in range(5):
        key.timestamps.append(now)
    assert key.is_exhausted(now=now) is True


def test_is_exhausted_prunes_old_entries():
    key = KeyEntry(key="K", secret="S", tier="free", limit_per_min=3, label="t")
    old = time.time() - 120  # > 60s ago, should be pruned
    for _ in range(10):
        key.timestamps.append(old)
    # Even though deque has 10 entries, they're all stale
    assert key.is_exhausted(now=time.time()) is False
    # After is_exhausted call, deque should be pruned
    assert len(key.timestamps) == 0


def test_is_exhausted_via_header_remaining_zero():
    key = KeyEntry(key="K", secret="S", tier="free", limit_per_min=100, label="t")
    key.remaining_from_header = 0
    key.reset_at = time.time() + 30  # 30s until reset
    assert key.is_exhausted() is True
    # Past reset → no longer exhausted (count check applies)
    key.reset_at = time.time() - 10
    assert key.is_exhausted() is False


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
