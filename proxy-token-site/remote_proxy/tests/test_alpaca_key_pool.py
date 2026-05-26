"""Unit tests for alpaca_key_pool.KeyPool env loading (T2)."""
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from alpaca_key_pool import KeyPool, get_key_pool, reset_key_pool


@pytest.fixture(autouse=True)
def clean_env_and_singleton(monkeypatch):
    """Clear all Alpaca env vars + the pool singleton between tests."""
    for var in [
        "ALPACA_MASTER_KEY", "ALPACA_MASTER_SECRET", "ALPACA_MASTER_LIMIT",
        "ALPACA_API_KEY", "ALPACA_API_SECRET",
        "APCA_API_KEY_ID", "APCA_API_SECRET_KEY",
        "ALPACA_FREE_KEY_1", "ALPACA_FREE_SECRET_1", "ALPACA_FREE_KEY_1_LIMIT",
        "ALPACA_FREE_KEY_2", "ALPACA_FREE_SECRET_2", "ALPACA_FREE_KEY_2_LIMIT",
        "ALPACA_FREE_KEY_3", "ALPACA_FREE_SECRET_3",
    ]:
        monkeypatch.delenv(var, raising=False)
    reset_key_pool()
    yield
    reset_key_pool()


def test_paid_only_loads_one_entry(monkeypatch):
    monkeypatch.setenv("ALPACA_MASTER_KEY", "PK_PAID")
    monkeypatch.setenv("ALPACA_MASTER_SECRET", "SEC_PAID")
    pool = KeyPool()
    assert pool.describe() == [("paid", 10_000)]
    assert pool.paid is not None and pool.paid.key == "PK_PAID"
    assert pool.free == []


def test_paid_plus_two_free(monkeypatch):
    monkeypatch.setenv("ALPACA_MASTER_KEY", "PK_PAID")
    monkeypatch.setenv("ALPACA_MASTER_SECRET", "SEC_PAID")
    monkeypatch.setenv("ALPACA_FREE_KEY_1", "PK_F1")
    monkeypatch.setenv("ALPACA_FREE_SECRET_1", "SEC_F1")
    monkeypatch.setenv("ALPACA_FREE_KEY_2", "PK_F2")
    monkeypatch.setenv("ALPACA_FREE_SECRET_2", "SEC_F2")
    pool = KeyPool()
    assert pool.describe() == [("paid", 10_000), ("free_1", 200), ("free_2", 200)]
    assert len(pool.free) == 2
    assert pool.free[0].label == "free_1"
    assert pool.free[1].label == "free_2"


def test_free_key_custom_limit(monkeypatch):
    monkeypatch.setenv("ALPACA_MASTER_KEY", "PK_PAID")
    monkeypatch.setenv("ALPACA_MASTER_SECRET", "SEC_PAID")
    monkeypatch.setenv("ALPACA_FREE_KEY_1", "PK_F1")
    monkeypatch.setenv("ALPACA_FREE_SECRET_1", "SEC_F1")
    monkeypatch.setenv("ALPACA_FREE_KEY_1_LIMIT", "100")  # override default 200
    pool = KeyPool()
    assert pool.describe() == [("paid", 10_000), ("free_1", 100)]


def test_free_key_missing_secret_is_skipped(monkeypatch):
    """If only one of (KEY, SECRET) is set, the entry is silently skipped."""
    monkeypatch.setenv("ALPACA_MASTER_KEY", "PK_PAID")
    monkeypatch.setenv("ALPACA_MASTER_SECRET", "SEC_PAID")
    monkeypatch.setenv("ALPACA_FREE_KEY_1", "PK_F1")
    # ALPACA_FREE_SECRET_1 not set
    pool = KeyPool()
    assert pool.describe() == [("paid", 10_000)]
    assert pool.free == []


def test_empty_env_string_treated_as_unset(monkeypatch):
    monkeypatch.setenv("ALPACA_MASTER_KEY", "PK_PAID")
    monkeypatch.setenv("ALPACA_MASTER_SECRET", "SEC_PAID")
    monkeypatch.setenv("ALPACA_FREE_KEY_1", "")
    monkeypatch.setenv("ALPACA_FREE_SECRET_1", "SEC_F1")
    pool = KeyPool()
    assert pool.describe() == [("paid", 10_000)]


def test_apca_alias_for_paid(monkeypatch):
    """Back-compat: APCA_API_KEY_ID is accepted when ALPACA_MASTER_KEY missing."""
    monkeypatch.setenv("APCA_API_KEY_ID", "PK_ALIAS")
    monkeypatch.setenv("APCA_API_SECRET_KEY", "SEC_ALIAS")
    pool = KeyPool()
    assert pool.paid is not None
    assert pool.paid.key == "PK_ALIAS"


def test_no_keys_at_all_yields_empty_pool(monkeypatch):
    pool = KeyPool()
    assert pool.describe() == []
    assert pool.paid is None
    assert pool.free == []


def test_get_key_pool_singleton(monkeypatch):
    monkeypatch.setenv("ALPACA_MASTER_KEY", "PK_PAID")
    monkeypatch.setenv("ALPACA_MASTER_SECRET", "SEC_PAID")
    p1 = get_key_pool()
    p2 = get_key_pool()
    assert p1 is p2  # same instance
    reset_key_pool()
    p3 = get_key_pool()
    assert p3 is not p1  # rebuilt after reset


def test_explicit_entries_overrides_env(monkeypatch):
    """KeyPool(entries=[...]) bypasses env loading — used by tests and a force-paid mode."""
    from alpaca_key_pool import KeyEntry
    monkeypatch.setenv("ALPACA_MASTER_KEY", "IGNORED")
    monkeypatch.setenv("ALPACA_MASTER_SECRET", "IGNORED")
    custom = [KeyEntry(key="X", secret="Y", tier="paid", limit_per_min=42, label="custom")]
    pool = KeyPool(entries=custom)
    assert pool.describe() == [("custom", 42)]


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
