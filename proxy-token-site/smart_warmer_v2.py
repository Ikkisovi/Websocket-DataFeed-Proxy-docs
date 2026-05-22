#!/usr/bin/env python3
"""
Adaptive cache warmer v2.

Strategy:
  1. HOT tier   — mine audit.jsonl for the top-N (symbol, timeframe) pairs
                  requested by real users in the last --audit-days days.
                  Warm at the exact timeframes users actually used.
  2. BASELINE   — all S&P 500 + NASDAQ-100 + ETFs from tickers.json.
                  Always warm at 1Day (2 years back).

Behavior:
  - Skips requests that already hit the cache (X-Cache: HIT or DISK_HIT).
  - Pauses during US market hours to avoid competing with live traffic.
  - Respects a configurable req/sec rate to stay under CPU budget.
  - Idempotent: safe to run multiple times; cache writes are no-ops on hit.

Usage:
    python3 smart_warmer_v2.py [options]

    --proxy       http://localhost:8768     Proxy base URL
    --token       <bearer-token>           Auth token
    --audit-file  /path/to/audit.jsonl     Audit log (default: env AUDIT_FILE)
    --audit-days  7                        How many days back to mine
    --hot-limit   50                       Max hot (symbol, tf) pairs from audit
    --baseline-days 730                    Days of 1Day bars for baseline tickers
    --rate        2.0                      Max requests per second
    --skip-market-hours                    Pause during US market hours (default on)
    --no-skip-market-hours                 Run even during market hours
    --dry-run                              Print plan, don't hit proxy

Environment variables (fallbacks):
    PROXY_URL, PROXY_TOKEN, AUDIT_FILE
"""

import asyncio
import aiohttp
import json
import os
import sys
import argparse
import time
from collections import Counter
from datetime import datetime, timedelta, date, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent


# ── CLI ────────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--proxy",      default=os.getenv("PROXY_URL", "http://localhost:8768"))
    p.add_argument("--token",      default=os.getenv("PROXY_TOKEN", ""))
    p.add_argument("--audit-file", default=os.getenv("AUDIT_FILE", "/home/ec2-user/cloud-proxy/audit.jsonl"))
    p.add_argument("--audit-days", type=int, default=7)
    p.add_argument("--hot-limit",  type=int, default=50)
    p.add_argument("--baseline-days", type=int, default=730)
    p.add_argument("--rate",       type=float, default=2.0, help="Max req/sec")
    p.add_argument("--skip-market-hours", default=True, action="store_true")
    p.add_argument("--no-skip-market-hours", dest="skip_market_hours", action="store_false")
    p.add_argument("--dry-run",    action="store_true")
    return p.parse_args()


# ── Market hours ───────────────────────────────────────────────────────────────

def is_market_hours() -> bool:
    now = datetime.now(timezone.utc)
    if now.weekday() >= 5:
        return False
    t = now.time()
    # 13:00–21:30 UTC covers both EST and EDT windows
    return time(13, 0) <= t <= time(21, 30)


from datetime import time as _time  # avoid shadowing


def is_market_hours() -> bool:
    now = datetime.now(timezone.utc)
    if now.weekday() >= 5:
        return False
    t = now.time()
    return _time(13, 0) <= t <= _time(21, 30)


# ── Audit mining ───────────────────────────────────────────────────────────────

WARMABLE_ENDPOINTS = {
    "/v1/history/bars",
    "/v1/history/options/bars",
    "/v1/stock/history/trade_quote",
    "/v1/options/snapshots",
    "/v1/options/snapshots/ohlc",
    "/v1/options/snapshots/trade",
    "/v1/options/snapshots/quote",
    "/v1/options/snapshots/market_value",
    "/v1/options/snapshots/open_interest",
    "/v1/options/snapshots/expiry"
}

def mine_audit(audit_file: str, days: int, limit: int) -> list[tuple[str, str, str]]:
    """
    Returns list of (endpoint, symbol, timeframe) tuples sorted by frequency desc.
    Only successful (status 200) requests are counted.
    """
    if not os.path.exists(audit_file):
        print(f"[audit] File not found: {audit_file} — skipping hot tier")
        return []

    cutoff = datetime.now().timestamp() - days * 86400
    counts: Counter = Counter()

    with open(audit_file) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if ev.get("event") != "http_request":
                continue
            if ev.get("status", 0) != 200:
                continue

            ep = ev.get("endpoint", "")
            if ep not in WARMABLE_ENDPOINTS:
                continue

            # Timestamp check
            ts = ev.get("timestamp")
            if ts is not None:
                if isinstance(ts, (int, float)) and ts < cutoff:
                    continue
                if isinstance(ts, str):
                    try:
                        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                        if dt.timestamp() < cutoff:
                            continue
                    except Exception:
                        pass

            if ep == "/v1/options/snapshots/expiry":
                sym = ev.get("underlying") or ev.get("symbol", "")
                tf = ev.get("expiry", "")
            elif ep in (
                "/v1/options/snapshots",
                "/v1/options/snapshots/ohlc",
                "/v1/options/snapshots/trade",
                "/v1/options/snapshots/quote",
                "/v1/options/snapshots/market_value",
                "/v1/options/snapshots/open_interest"
            ):
                sym = ev.get("symbols") or ev.get("symbol", "")
                tf = ""
            elif ep in ("/v1/stock/history/trade_quote",):
                sym = ev.get("symbol") or ev.get("symbols", "")
                tf = ""
            else:
                sym = ev.get("symbol") or ev.get("symbols", "")
                tf = ev.get("timeframe", "1Day")

            if isinstance(sym, list):
                sym = ",".join(sym)

            for s in str(sym).split(","):
                s = s.strip().upper()
                if s:
                    counts[(ep, s, tf)] += 1

    top = counts.most_common(limit)
    print(f"[audit] Mined {sum(counts.values())} events → top {len(top)} hot pairs (last {days}d)")
    return [(ep, sym, tf) for (ep, sym, tf), _ in top]


# ── Ticker list ────────────────────────────────────────────────────────────────

def load_baseline_tickers() -> list[str]:
    ticker_file = SCRIPT_DIR / "tickers.json"
    if not ticker_file.exists():
        print(f"[tickers] {ticker_file} not found — baseline tier disabled")
        return []
    with open(ticker_file) as f:
        data = json.load(f)
    sp500  = data.get("sp500", [])
    ndx100 = data.get("nasdaq100", [])
    etfs   = data.get("etfs", [])
    combined = list(dict.fromkeys(sp500 + ndx100 + etfs))  # dedup, preserve order
    print(f"[tickers] Baseline: {len(sp500)} S&P500 + {len(ndx100)} NDX100 + {len(etfs)} ETFs = {len(combined)} unique")
    return combined


# ── Warmup task ────────────────────────────────────────────────────────────────

async def warm_one(session: aiohttp.ClientSession, proxy: str, token: str,
                   endpoint: str, symbol: str, timeframe: str,
                   start: str, end: str, dry_run: bool) -> str:
    """Returns cache status string: HIT / DISK_HIT / MISS / ERROR."""
    if dry_run:
        return "DRY_RUN"

    url = f"{proxy}{endpoint}"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    if endpoint in ("/v1/stock/history/trade_quote",):
        payload = {"symbol": symbol, "start": start, "end": end, "limit": 1000}
    elif endpoint in (
        "/v1/options/snapshots",
        "/v1/options/snapshots/ohlc",
        "/v1/options/snapshots/trade",
        "/v1/options/snapshots/quote",
        "/v1/options/snapshots/market_value",
        "/v1/options/snapshots/open_interest"
    ):
        payload = {"symbols": symbol}
    elif endpoint == "/v1/options/snapshots/expiry":
        payload = {"underlying": symbol, "expiry": timeframe}
    else:
        payload = {"symbol": symbol, "timeframe": timeframe, "start": start, "end": end, "limit": 10000}

    try:
        async with session.post(url, headers=headers, json=payload,
                                timeout=aiohttp.ClientTimeout(total=60)) as resp:
            status = resp.headers.get("X-Cache", "MISS")
            if resp.status == 429:
                return "RATE_LIMITED"
            if resp.status not in (200, 204):
                return f"HTTP_{resp.status}"
            return status
    except asyncio.TimeoutError:
        return "TIMEOUT"
    except Exception as e:
        return f"ERROR:{e}"


async def fetch_contracts_for_symbol(session: aiohttp.ClientSession, proxy: str, token: str, symbol: str) -> list[str]:
    """Fetch active option contracts for a stock symbol via the proxy contracts endpoint."""
    url = f"{proxy}/v1/options/contracts"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {"underlying_symbols": symbol, "status": "active", "limit": 5}
    try:
        async with session.post(url, headers=headers, json=payload, timeout=30) as resp:
            if resp.status == 200:
                data = await resp.json()
                contracts = data if isinstance(data, list) else data.get("option_contracts", [])
                return [c["symbol"] for c in contracts if "symbol" in c][:5]
    except Exception as e:
        print(f"[OptionContracts] Error fetching active contracts for {symbol}: {e}")
    return []

def extract_expiry_from_occ(occ: str) -> str:
    """Extract and format expiration date from OCC option contract symbol.
    OCC format is typically: ROOT + YYMMDD + C/P + STRIKE
    """
    occ = occ.upper()
    for idx in range(len(occ)):
        if occ[idx] in ('C', 'P'):
            if idx >= 6:
                yymmdd = occ[idx-6:idx]
                if yymmdd.isdigit():
                    return f"20{yymmdd[0:2]}-{yymmdd[2:4]}-{yymmdd[4:6]}"
            break
    return ""


# ── Main ───────────────────────────────────────────────────────────────────────

async def run(args):
    if not args.token:
        print("ERROR: --token / PROXY_TOKEN is required")
        sys.exit(1)

    today = date.today()
    end_date   = (today - timedelta(days=1)).isoformat()

    # ── Build work list ────────────────────────────────────────────────────────
    work: list[tuple[str, str, str, str, str]] = []  # (endpoint, symbol, tf, start, end)

    baseline_tickers = load_baseline_tickers()
    
    # Pre-fetch active option contracts for baseline tickers to warm options quotes
    all_contracts = {}
    if baseline_tickers:
        print(f"[plan] Fetching active options contracts for {len(baseline_tickers)} baseline tickers...")
        connector = aiohttp.TCPConnector(limit=20)
        async with aiohttp.ClientSession(connector=connector) as session:
            tasks = [fetch_contracts_for_symbol(session, args.proxy, args.token, sym) for sym in baseline_tickers]
            results = await asyncio.gather(*tasks)
            for sym, contracts in zip(baseline_tickers, results):
                all_contracts[sym] = contracts
        print(f"[plan] Finished fetching contracts. Found active contracts for {sum(1 for c in all_contracts.values() if c)} tickers")



    # HOT tier: from audit
    hot = mine_audit(args.audit_file, args.audit_days, args.hot_limit)
    # Determine date range per timeframe
    TF_DAYS = {
        "1Min": 7, "3Min": 7, "5Min": 14, "15Min": 30,
        "30Min": 60, "1Hour": 90, "4Hour": 180, "1Day": 730,
    }
    for ep, sym, tf in hot:
        if ep in ("/v1/stock/history/trade_quote",):
            days_back = 7
        else:
            days_back = TF_DAYS.get(tf, 30)
            if ep == "/v1/history/options/bars":
                days_back = min(days_back, 30)
        start = (today - timedelta(days=days_back)).isoformat()
        work.append((ep, sym, tf, start, end_date))

    # BASELINE tier: S&P500 + NASDAQ-100 + ETFs for ALL frequencies and endpoints
    hot_pairs = {(ep, sym, tf) for ep, sym, tf in hot}

    BAR_TIMEFRAMES = ["1Min", "3Min", "5Min", "15Min", "30Min", "1Hour", "4Hour", "1Day"]

    for sym in baseline_tickers:
        # 1. Stock bars: /v1/history/bars for all timeframes
        for tf in BAR_TIMEFRAMES:
            ep = "/v1/history/bars"
            if (ep, sym, tf) not in hot_pairs:
                days_back = args.baseline_days if tf == "1Day" else TF_DAYS.get(tf, 30)
                start = (today - timedelta(days=days_back)).isoformat()
                work.append((ep, sym, tf, start, end_date))

        # 2. Options bars: /v1/history/options/bars for all timeframes
        for tf in BAR_TIMEFRAMES:
            ep = "/v1/history/options/bars"
            if (ep, sym, tf) not in hot_pairs:
                days_back = args.baseline_days if tf == "1Day" else TF_DAYS.get(tf, 30)
                days_back = min(days_back, 30)
                start = (today - timedelta(days=days_back)).isoformat()
                work.append((ep, sym, tf, start, end_date))

        # 3. Stock quotes: /v1/stock/history/trade_quote
        ep_stock_quote = "/v1/stock/history/trade_quote"
        if (ep_stock_quote, sym, "") not in hot_pairs:
            start = (today - timedelta(days=7)).isoformat()
            work.append((ep_stock_quote, sym, "", start, end_date))

        # 4. Options snapshots: Warm all 6 snapshot endpoints using a comma-separated string of the active contract symbols
        contracts = all_contracts.get(sym, [])
        if contracts:
            joined_contracts = ",".join(contracts)
            snapshot_eps = [
                "/v1/options/snapshots",
                "/v1/options/snapshots/ohlc",
                "/v1/options/snapshots/trade",
                "/v1/options/snapshots/quote",
                "/v1/options/snapshots/market_value",
                "/v1/options/snapshots/open_interest"
            ]
            for ep in snapshot_eps:
                if not any((ep, c, "") in hot_pairs for c in contracts):
                    work.append((ep, joined_contracts, "", "", ""))

            # 5. Options snapshots by expiry: Warm /v1/options/snapshots/expiry for the nearest active contract's expiry date
            nearest_contract = contracts[0]
            expiry_date = extract_expiry_from_occ(nearest_contract)
            if expiry_date:
                ep_expiry = "/v1/options/snapshots/expiry"
                if (ep_expiry, sym, expiry_date) not in hot_pairs:
                    work.append((ep_expiry, sym, expiry_date, "", ""))

    total = len(work)
    print(f"\n[plan] {len(hot)} hot pairs + {total - len(hot)} baseline = {total} total requests")

    if args.dry_run:
        print("\n[dry-run] First 20 tasks:")
        for ep, sym, tf, s, e in work[:20]:
            print(f"  {ep} {sym} {tf} {s}→{e}")
        if total > 20:
            print(f"  ... and {total - 20} more")
        return

    # ── Execute ────────────────────────────────────────────────────────────────
    counters = Counter()
    min_interval = 1.0 / args.rate

    connector = aiohttp.TCPConnector(limit=4)
    async with aiohttp.ClientSession(connector=connector) as session:
        for i, (ep, sym, tf, start, end) in enumerate(work, 1):
            # Market hours pause
            if args.skip_market_hours and is_market_hours():
                print(f"[pause] Market hours — sleeping 300s (task {i}/{total})")
                await asyncio.sleep(300)

            t0 = time.monotonic()
            status = await warm_one(session, args.proxy, args.token, ep, sym, tf, start, end, args.dry_run)
            elapsed = time.monotonic() - t0

            counters[status] += 1
            label = f"{sym:8s} {tf:6s} {ep.split('/')[-1]:12s}"
            print(f"  [{i:4d}/{total}] {label} → {status:12s} ({elapsed:.1f}s)")

            # Rate limiting: sleep remaining time in this interval
            sleep_for = min_interval - elapsed
            if sleep_for > 0:
                await asyncio.sleep(sleep_for)

    # ── Summary ────────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"Warmup complete: {total} requests")
    for k, v in sorted(counters.items(), key=lambda x: -x[1]):
        pct = v / total * 100
        print(f"  {k:15s} {v:5d}  ({pct:.1f}%)")
    hit_rate = (counters["HIT"] + counters["DISK_HIT"]) / total * 100 if total else 0
    print(f"  Cache hit rate: {hit_rate:.1f}%")


def main():
    args = parse_args()
    print("=" * 60)
    print("Adaptive Cache Warmer v2")
    print(f"  Proxy:       {args.proxy}")
    print(f"  Audit file:  {args.audit_file} (last {args.audit_days}d)")
    print(f"  Hot limit:   {args.hot_limit} pairs")
    print(f"  Baseline:    S&P500 + NDX100 × 1Day ({args.baseline_days}d back)")
    print(f"  Rate:        {args.rate} req/s")
    print(f"  Dry run:     {args.dry_run}")
    print("=" * 60)
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
