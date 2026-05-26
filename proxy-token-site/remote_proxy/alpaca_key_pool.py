"""Alpaca multi-key routing pool.

Owns the set of Alpaca API keys available to the proxy (1 paid Algo+ + N free)
and decides which key serves each upstream request. See plan at
/home/kai/.claude/plans/velvety-orbiting-pearl.md.

Phases live in separate tasks:
  T2 (this file, initial): KeyEntry + KeyPool skeleton + env loading
  T3: pick() with routing matrix
  T4: sliding-window counter + header reconciliation
  T5: alpaca_get helper with fallback retry
  T6: observability (pool stats in /health + routing log line)

The pool is a process-global singleton. Single-instance proxy on the
ThinkCentre means in-process state is fine; do not reach for Redis.
"""

from __future__ import annotations

import os
import sys
import time
import asyncio
import aiohttp
from datetime import datetime, timezone
from dataclasses import dataclass, field
from collections import deque
from typing import Optional


# Defaults (overridable via env)
PAID_DEFAULT_LIMIT_PER_MIN = 10_000   # Algo Trader Plus market-data ceiling
FREE_DEFAULT_LIMIT_PER_MIN = 200      # Alpaca documented free-tier cap


@dataclass
class KeyEntry:
    """One Alpaca API credential pair + its rate-limit accounting."""
    key: str
    secret: str
    tier: str                            # "paid" | "free"
    limit_per_min: int
    label: str                           # human-readable: "paid", "free_1", "free_2"
    # Counter state (populated by T4)
    timestamps: deque = field(default_factory=deque)
    remaining_from_header: Optional[int] = None
    reset_at: Optional[float] = None     # epoch seconds when the rate window resets

    def __repr__(self) -> str:
        return f"KeyEntry(label={self.label!r}, tier={self.tier!r}, limit={self.limit_per_min}/min)"

    def is_exhausted(self, now: Optional[float] = None) -> bool:
        """Return True if this key has hit its per-minute budget.

        Truth signal priority: Alpaca's X-RateLimit-Remaining header (when known)
        beats our local count. T4 fills in real counter logic; this method works
        once T4 has populated state. T3 uses it as-is — never-recorded keys read
        as not-exhausted.
        """
        now = now or time.time()
        
        # 1. Handle reset boundary
        if self.reset_at is not None and now >= self.reset_at:
            # The rate limit window has reset. Clear constraints and stale local history.
            while self.timestamps and self.timestamps[0] < self.reset_at:
                self.timestamps.popleft()
            self.remaining_from_header = None
            self.reset_at = None

        # 2. Check header truth signal for exhaustion
        if self.remaining_from_header is not None and self.remaining_from_header <= 0:
            return True

        # 3. Local sliding window count
        cutoff = now - 60.0
        # Prune old entries (O(1) amortized via deque popleft)
        while self.timestamps and self.timestamps[0] < cutoff:
            self.timestamps.popleft()
        
        return len(self.timestamps) >= self.limit_per_min

    def record_request(self, now: Optional[float] = None) -> None:
        """Record an outgoing request to increment the local counter."""
        self.timestamps.append(now or time.time())

    def record_response(self, headers: dict, now: Optional[float] = None) -> None:
        """Reconcile local counter with Alpaca's rate limit headers.
        
        Headers to look for (case-insensitive usually, but we check both):
        - X-RateLimit-Remaining
        - X-RateLimit-Reset
        """
        now = now or time.time()
        
        # Helper to extract case-insensitive headers
        def get_header(key: str) -> Optional[str]:
            lower_key = key.lower()
            for k, v in headers.items():
                if k.lower() == lower_key:
                    return v
            return None
            
        remaining_str = get_header("X-RateLimit-Remaining")
        reset_str = get_header("X-RateLimit-Reset")
        
        if remaining_str is not None:
            try:
                self.remaining_from_header = int(remaining_str)
            except ValueError:
                pass
                
        if reset_str is not None:
            try:
                self.reset_at = float(reset_str)
            except ValueError:
                pass
        
        # Reconcile local deque if Alpaca says we have fewer remaining than we thought.
        # local_remaining = self.limit_per_min - len(self.timestamps)
        # If remaining_from_header < local_remaining, we should pad our timestamps
        # to match the header's strictness, so we don't accidentally over-admit
        # in the next few milliseconds before the next request.
        cutoff = now - 60.0
        while self.timestamps and self.timestamps[0] < cutoff:
            self.timestamps.popleft()
            
        if self.remaining_from_header is not None:
            local_remaining = max(0, self.limit_per_min - len(self.timestamps))
            if self.remaining_from_header < local_remaining:
                # We need to artificially inflate our local count to match Alpaca's limit
                # by adding timestamps right now.
                deficit = local_remaining - self.remaining_from_header
                for _ in range(deficit):
                    self.timestamps.append(now)


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    """Read env var. Returns default if missing OR empty string (unset semantics)."""
    v = os.getenv(name)
    return v if v else default


def _load_paid() -> Optional[KeyEntry]:
    """Load the paid Algo+ master key. Returns None if not configured."""
    # Same fallback chain as alpaca_cloud_proxy.py lines 289-297
    key = _env("ALPACA_MASTER_KEY") or _env("ALPACA_API_KEY") or _env("APCA_API_KEY_ID")
    secret = _env("ALPACA_MASTER_SECRET") or _env("ALPACA_API_SECRET") or _env("APCA_API_SECRET_KEY")
    if not key or not secret:
        return None
    limit = int(_env("ALPACA_MASTER_LIMIT", str(PAID_DEFAULT_LIMIT_PER_MIN)))
    return KeyEntry(key=key, secret=secret, tier="paid", limit_per_min=limit, label="paid")


def _load_free_key(idx: int) -> Optional[KeyEntry]:
    """Load free key N (1-indexed) if both key and secret env vars are set."""
    key = _env(f"ALPACA_FREE_KEY_{idx}")
    secret = _env(f"ALPACA_FREE_SECRET_{idx}")
    if not key or not secret:
        return None
    limit = int(_env(f"ALPACA_FREE_KEY_{idx}_LIMIT", str(FREE_DEFAULT_LIMIT_PER_MIN)))
    return KeyEntry(key=key, secret=secret, tier="free", limit_per_min=limit, label=f"free_{idx}")


class KeyPool:
    """Container of KeyEntries with routing + accounting (filled out in T3/T4/T5)."""

    def __init__(self, entries: Optional[list[KeyEntry]] = None):
        if entries is not None:
            self.entries = list(entries)
        else:
            loaded: list[KeyEntry] = []
            paid = _load_paid()
            if paid is not None:
                loaded.append(paid)
            for i in range(1, 11):  # up to 10 free keys
                free = _load_free_key(i)
                if free is not None:
                    loaded.append(free)
            self.entries = loaded

        # Convenience accessors
        self.paid: Optional[KeyEntry] = next((e for e in self.entries if e.tier == "paid"), None)
        self.free: list[KeyEntry] = [e for e in self.entries if e.tier == "free"]

        # Round-robin index for free-key selection (filled in by T3)
        self._free_cursor = 0
        # Runtime kill-switch for A/B tests: when True, the picker treats
        # free keys as if they don't exist (always falls back to paid).
        self.free_disabled = False

    def describe(self) -> list[tuple[str, int]]:
        """Roster: [(label, limit_per_min), ...] — used by /health and CLI checks."""
        return [(e.label, e.limit_per_min) for e in self.entries]

    def by_label(self, label: str) -> Optional[KeyEntry]:
        return next((e for e in self.entries if e.label == label), None)

    def __repr__(self) -> str:
        return f"KeyPool({len(self.entries)} entries: {[e.label for e in self.entries]})"

    # ─── Picker (T3) ────────────────────────────────────────────────────

    def pick(
        self,
        endpoint: str,
        params: Optional[dict] = None,
        force_paid: bool = False,
        now: Optional[float] = None,
    ) -> tuple[Optional[KeyEntry], str]:
        """Choose a KeyEntry for an upstream Alpaca request.

        Returns (chosen_entry, reason_code) — reason is one of:
          "force_paid" | "endpoint_requires_paid" | "feed_sip_explicit"
          | "end_recent" | "end_missing" | "free_eligible"
          | "free_exhausted_fallback" | "no_keys_configured"
          | "no_paid_configured"

        Pure function modulo the keys' own counter state. Always returns paid
        as last-resort fallback; never returns an exhausted free key.
        """
        params = params or {}
        now = now or time.time()

        # Rule 1: explicit override
        if force_paid:
            return (self.paid, "force_paid")

        # Rule 2: endpoint absolutely requires paid (SIP/OPRA/snapshot/latest)
        if _endpoint_requires_paid(endpoint):
            return (self.paid, "endpoint_requires_paid")

        # Rule 3: bars-specific routing
        if endpoint in ("/v1/history/bars", "/v2/stocks/bars"):
            feed = (params.get("feed") or "").lower()
            if feed == "sip":
                return (self.paid, "feed_sip_explicit")
            end_value = params.get("end") or params.get("end_date")
            if not end_value:
                return (self.paid, "end_missing")
            end_dt = _parse_iso_or_date(end_value)
            if end_dt is None:
                return (self.paid, "end_missing")
            cutoff = datetime.now(timezone.utc).timestamp() - (15 * 60 + 60)  # 15min + 60s safety
            if end_dt.timestamp() > cutoff:
                return (self.paid, "end_recent")
            return self._pick_free_or_fallback("free_eligible")

        # Rule 4: news always eligible for free (no recency concept)
        if endpoint == "/v1/history/news" or endpoint.startswith("/v1beta1/news"):
            return self._pick_free_or_fallback("free_eligible")

        # Rule 5: default — paid
        return (self.paid, "endpoint_requires_paid")

    def _pick_free_or_fallback(self, success_reason: str) -> tuple[Optional[KeyEntry], str]:
        """Round-robin across non-exhausted free keys; fall back to paid."""
        if self.free_disabled:
            if self.paid is None:
                return (None, "no_keys_configured")
            return (self.paid, "free_disabled_runtime")
        if not self.free:
            if self.paid is None:
                return (None, "no_keys_configured")
            return (self.paid, "free_exhausted_fallback")

        n = len(self.free)
        for _ in range(n):
            candidate = self.free[self._free_cursor % n]
            self._free_cursor = (self._free_cursor + 1) % n
            if not candidate.is_exhausted():
                return (candidate, success_reason)

        # All free exhausted
        if self.paid is None:
            return (None, "no_keys_configured")
        return (self.paid, "free_exhausted_fallback")


# ─── Endpoint classification helpers ────────────────────────────────────

# Endpoints that absolutely must use the paid key:
#   - SIP-quality "latest" endpoints (free is IEX-only)
#   - Options REST (free is indicative, but options REST is also gated by ThetaData)
#   - Snapshots (require SIP)
#   - Crypto orderbooks (uncached realtime)
_PAID_ONLY_PREFIXES = (
    "/v2/stocks/",        # snapshot, trades/latest, quotes/latest
    "/v1/options/",       # snapshots / contracts / open_interest / eod
    "/v1beta1/options/",  # raw Alpaca options
    "/v2/options/",       # contracts API
    "/v3/option/",        # ThetaData SDK path (irrelevant to Alpaca key, but never free)
    "/v1/crypto/",
    "/v1beta3/crypto/",
)
_PAID_ONLY_SUBSTRINGS = ("/latest/", "/snapshot")


def _endpoint_requires_paid(endpoint: str) -> bool:
    """True if this endpoint must NEVER route to a free key (data-quality regression)."""
    if any(endpoint.startswith(p) for p in _PAID_ONLY_PREFIXES):
        return True
    if any(s in endpoint for s in _PAID_ONLY_SUBSTRINGS):
        return True
    return False


def _parse_iso_or_date(value) -> Optional[datetime]:
    """Parse "2025-01-02T15:00:00Z" / "2025-01-02" / epoch float into a UTC datetime."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    s = str(value).strip()
    # Try ISO 8601 first
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        pass
    # Fall back to bare date (treat as end-of-day UTC)
    try:
        dt = datetime.strptime(s.split("T")[0], "%Y-%m-%d")
        return dt.replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
    except ValueError:
        return None


# Process-global singleton
_pool_singleton: Optional[KeyPool] = None


def get_key_pool() -> KeyPool:
    """Returns the process-wide KeyPool, building it lazily from env."""
    global _pool_singleton
    if _pool_singleton is None:
        _pool_singleton = KeyPool()
    return _pool_singleton


def reset_key_pool() -> None:
    """Test-only: clear the singleton so the next get_key_pool() rebuilds from env."""
    global _pool_singleton
    _pool_singleton = None


async def alpaca_get(
    session: aiohttp.ClientSession,
    path: str,
    params: dict,
    end_hint: Optional[str] = None,
    routing_endpoint: Optional[str] = None,
    picker_params: Optional[dict] = None
) -> tuple[int, dict, bytes, str]:
    """
    Fetch from Alpaca using the key pool.
    Returns: (status_code, headers_dict, body_bytes, feed_class_used)

    Handles single retry fallback (free -> paid) on 429/5xx or network errors.
    If all eligible keys are exhausted, returns 429 without making a request.

    routing_endpoint: the proxy-side endpoint name used for picker routing
    decisions (e.g. "/v1/history/bars"). If None, falls back to `path`.
    This matters because `path` is the upstream Alpaca URL (e.g. "/v2/stocks/bars")
    which may match paid-only prefix rules that shouldn't apply to bars.

    picker_params: override params dict for the picker routing decision.
    If None, uses `params`. Useful when `params` contains defaults (e.g. feed="sip")
    that should not influence routing (picker should only see user-explicit values).
    """
    pool = get_key_pool()
    now = time.time()
    picker_endpoint = routing_endpoint or path

    # We pass end_hint into the params dictionary for the picker to see it,
    # but we don't modify the actual query params unless needed. The picker
    # checks `params.get("end")`. If end_hint is provided, we merge it for the picker.
    if picker_params is None:
        picker_params = dict(params)
    if end_hint and "end" not in picker_params:
        picker_params["end"] = end_hint
        
    # Attempt 1
    entry, reason = pool.pick(picker_endpoint, picker_params, now=now)
    if entry is None:
        # No keys configured at all
        return 429, {"Retry-After": "60"}, b'{"error": "No keys configured"}', "unknown"

    feed_class = "sip" if entry.tier == "paid" else "iex"
    print(f"[Routing] endpoint={picker_endpoint} upstream={path} tier={entry.tier} label={entry.label} reason={reason}", flush=True, file=sys.stderr)
    
    # If the key is ALREADY exhausted before we even send, we only return 429
    # if it's the paid key (since picker falls back to paid if free is exhausted).
    if entry.is_exhausted(now=now):
        # We don't have another fallback if the paid key is exhausted, or if
        # force_paid was used and it's exhausted.
        reset = entry.reset_at if entry.reset_at else now + 60
        retry_after = max(1, int(reset - now))
        return 429, {"Retry-After": str(retry_after)}, b'{"error": "Rate limit exhausted"}', feed_class

    headers = {
        "APCA-API-KEY-ID": entry.key,
        "APCA-API-SECRET-KEY": entry.secret,
        "Accept": "application/json"
    }
    url = f"https://data.alpaca.markets{path}"
    
    entry.record_request(now=now)
    try:
        async with session.get(url, params=params, headers=headers) as resp:
            body = await resp.read()
            resp_headers = dict(resp.headers)
            entry.record_response(resp_headers, now=time.time())
            status = resp.status
    except aiohttp.ClientError:
        status = 502  # Network error maps to 502 Bad Gateway
        resp_headers = {}
        body = b'{"error": "Network exception"}'

    # If successful or a non-retryable client error
    if status < 429 or status in (400, 401, 403, 404, 422):
        return status, resp_headers, body, feed_class
        
    # Fallback to paid if we used a free key and got 429 or 5xx
    if entry.tier == "free" and pool.paid is not None:
        paid_entry = pool.paid
        now = time.time()
        
        if paid_entry.is_exhausted(now=now):
            print(f"[Routing] endpoint={path} tier=paid label=paid reason=fallback_exhausted")
            reset = paid_entry.reset_at if paid_entry.reset_at else now + 60
            retry_after = max(1, int(reset - now))
            return 429, {"Retry-After": str(retry_after)}, b'{"error": "Rate limit exhausted on fallback"}', "sip"
            
        print(f"[Routing] endpoint={path} tier=paid label=paid reason=fallback_retry")
        fallback_headers = dict(headers)
        fallback_headers["APCA-API-KEY-ID"] = paid_entry.key
        fallback_headers["APCA-API-SECRET-KEY"] = paid_entry.secret
        paid_entry.record_request(now=now)
        
        try:
            async with session.get(url, params=params, headers=fallback_headers) as fallback_resp:
                fallback_body = await fallback_resp.read()
                fallback_headers_resp = dict(fallback_resp.headers)
                paid_entry.record_response(fallback_headers_resp, now=time.time())
                return fallback_resp.status, fallback_headers_resp, fallback_body, "sip"
        except aiohttp.ClientError:
            return 502, {}, b'{"error": "Network exception on fallback"}', "sip"

    # If we already used paid or no paid exists, just return the 429/5xx
    return status, resp_headers, body, feed_class
