"""Unit tests for the feed_class cache-key dimension (T1)."""
import sys
import os
import pytest

# Allow importing from parent directory
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from disk_cache import generate_disk_key


def test_default_unknown_preserves_legacy_key():
    """Pre-feed_class cache entries must remain accessible after the upgrade."""
    legacy_payload_key = generate_disk_key("/v1/history/bars", {"symbol": "AAPL"})
    explicit_unknown_key = generate_disk_key("/v1/history/bars", {"symbol": "AAPL"}, feed_class="unknown")
    assert legacy_payload_key == explicit_unknown_key, \
        "default feed_class='unknown' must produce the same key as omitting the param (back-compat)"


def test_sip_and_iex_dont_collide():
    """A SIP response and an IEX response for the same (endpoint, params) must NOT share a cache entry."""
    sip_key = generate_disk_key("/v1/history/bars", {"symbol": "AAPL"}, feed_class="sip")
    iex_key = generate_disk_key("/v1/history/bars", {"symbol": "AAPL"}, feed_class="iex")
    assert sip_key != iex_key, \
        "SIP and IEX responses must use different cache keys to prevent IEX data poisoning SIP requests"


def test_opra_and_indicative_dont_collide():
    """OPRA (paid options) and indicative (free options) must NOT share cache entries."""
    opra_key = generate_disk_key("/v1/options/snapshots", {"symbols": "AAPL250117C00200000"}, feed_class="opra")
    indic_key = generate_disk_key("/v1/options/snapshots", {"symbols": "AAPL250117C00200000"}, feed_class="indicative")
    assert opra_key != indic_key


def test_same_feed_class_same_key():
    """Two requests with identical (endpoint, params, feed_class) must produce the same key."""
    k1 = generate_disk_key("/v1/history/bars", {"symbol": "AAPL", "timeframe": "1Min"}, feed_class="sip")
    k2 = generate_disk_key("/v1/history/bars", {"symbol": "AAPL", "timeframe": "1Min"}, feed_class="sip")
    assert k1 == k2


def test_user_fields_stripped_regardless_of_feed():
    """User-specific fields (token, etc) must still be stripped after feed_class addition."""
    with_token = generate_disk_key("/v1/history/bars", {"symbol": "AAPL", "token": "abc"}, feed_class="sip")
    without_token = generate_disk_key("/v1/history/bars", {"symbol": "AAPL"}, feed_class="sip")
    assert with_token == without_token


def test_empty_string_feed_class_treated_as_unknown():
    """Defensive: empty feed_class should behave like unknown (back-compat)."""
    empty_key = generate_disk_key("/v1/history/bars", {"symbol": "AAPL"}, feed_class="")
    unknown_key = generate_disk_key("/v1/history/bars", {"symbol": "AAPL"}, feed_class="unknown")
    assert empty_key == unknown_key


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
