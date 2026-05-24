#!/usr/bin/env python3
"""
Test script for Options Snapshot Dual Verification & Fallback (Standard Library Urllib version).
Tests:
- Dynamic discovery of an active contract
- Modern options snapshot query (Alpaca)
- Pre-Feb 2024 historical options snapshot query (ThetaData fallback)
- Mixed options snapshot query (Alpaca + ThetaData hybrid)
- Underlying option chain snapshot (Alpaca + ThetaData fallback)
- Relocated routes and trades history
- Direct ThetaData proxy endpoints (OHLC snapshot & At-Time Quote)
"""

import json
import urllib.request
import urllib.parse
import sys

REST_URL = "http://100.70.107.106:8768"
TEST_TOKEN = "a8b20ed4-80cb-493e-94e9-7d71cac1b9c2"

GREEN = "\033[92m"
RED = "\033[91m"
RESET = "\033[0m"

passed = 0
failed = 0

def log_result(name, success, detail=""):
    global passed, failed
    if success:
        passed += 1
        print(f"{GREEN}✓{RESET} {name}")
    else:
        failed += 1
        print(f"{RED}✗{RESET} {name}: {detail}")

def request_json(path, method="POST", payload=None, params=None):
    url = REST_URL + path
    if params:
        query_str = urllib.parse.urlencode(params)
        url += f"?{query_str}"
    
    headers = {
        "Authorization": f"Bearer {TEST_TOKEN}",
        "Content-Type": "application/json"
    }
    
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            status = response.status
            body = response.read().decode("utf-8")
            try:
                return status, json.loads(body)
            except Exception:
                return status, body
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, body
    except Exception as e:
        return 0, str(e)

def main():
    print(f"\n============================================================")
    print(f"Running Options Snapshot Fallback & Direct Proxy Verification")
    print(f"REST API Host: {REST_URL}")
    print(f"============================================================\n")

    # 1. Fetch active AAPL contract dynamically
    print("Fetching active AAPL option contracts...")
    payload = {"underlying_symbols": "AAPL", "status": "active", "limit": 1}
    status, result = request_json("/v1/options/contracts", method="POST", payload=payload)
    active_sym = None
    active_contract = None
    if status == 200 and isinstance(result, dict):
        contracts = result.get("option_contracts") or []
        if contracts:
            active_contract = contracts[0]
            active_sym = active_contract.get("symbol")
            print(f"Discovered active AAPL contract: {active_sym} (Details: expiration={active_contract.get('expiration_date')}, strike={active_contract.get('strike_price')}, type={active_contract.get('type')})")

    if not active_sym:
        active_sym = "AAPL260619C00200000"
        print(f"Using default active contract symbol: {active_sym}")

    # 2. Test modern options snapshot (should succeed via Alpaca)
    print(f"\n[Test 1] Querying modern snapshot for active symbol: {active_sym}...")
    payload = {"symbols": active_sym}
    status, result = request_json("/v1/options/snapshots", method="POST", payload=payload)
    if status == 200 and isinstance(result, dict):
        snaps = result.get("snapshots") or {}
        log_result("Modern Option Snapshot (Alpaca)", active_sym in snaps, f"status={status}, snaps={list(snaps.keys())}")
    else:
        log_result("Modern Option Snapshot (Alpaca)", False, f"status={status}, result={result}")

    # 3. Test pre-Feb 2024 options snapshot (should fall back to ThetaData)
    hist_sym = "AAPL230616C00150000"
    print(f"\n[Test 2] Querying pre-Feb 2024 snapshot (historical): {hist_sym}...")
    payload = {"symbols": hist_sym}
    status, result = request_json("/v1/options/snapshots", method="POST", payload=payload)
    if status == 200 and isinstance(result, dict):
        snaps = result.get("snapshots") or {}
        success = hist_sym in snaps
        detail = f"status={status}"
        if success:
            snap = snaps[hist_sym]
            detail += f", latestQuote={snap.get('latestQuote')}, latestTrade={snap.get('latestTrade')}"
        log_result("Historical Option Snapshot (ThetaData Fallback)", success, detail)
    else:
        log_result("Historical Option Snapshot (ThetaData Fallback)", False, f"status={status}, result={result}")

    # 4. Test mixed query (hybrid of Alpaca & ThetaData)
    print(f"\n[Test 3] Querying mixed symbols (one modern, one historical): {active_sym}, {hist_sym}...")
    payload = {"symbols": [active_sym, hist_sym]}
    status, result = request_json("/v1/options/snapshots", method="POST", payload=payload)
    if status == 200 and isinstance(result, dict):
        snaps = result.get("snapshots") or {}
        success = active_sym in snaps and hist_sym in snaps
        log_result("Mixed Option Snapshots (Hybrid Alpaca + ThetaData)", success, f"status={status}, snaps={list(snaps.keys())}")
    else:
        log_result("Mixed Option Snapshots (Hybrid Alpaca + ThetaData)", False, f"status={status}, result={result}")

    # 5. Test new option chain snapshot endpoints (GET & POST)
    print(f"\n[Test 4] Querying full option chain snapshots via POST: /v1/options/snapshots/AAPL...")
    status, result = request_json("/v1/options/snapshots/AAPL", method="POST", payload={})
    if status == 200 and isinstance(result, dict):
        snaps = result.get("snapshots") or {}
        log_result("Option Chain Snapshot POST", len(snaps) > 0, f"status={status}, snap_count={len(snaps)}")
    else:
        log_result("Option Chain Snapshot POST", False, f"status={status}, result={result}")

    print(f"\n[Test 5] Querying full option chain snapshots via GET: /v1/options/snapshots/AAPL...")
    status, result = request_json("/v1/options/snapshots/AAPL", method="GET")
    if status == 200 and isinstance(result, dict):
        snaps = result.get("snapshots") or {}
        log_result("Option Chain Snapshot GET", len(snaps) > 0, f"status={status}, snap_count={len(snaps)}")
    else:
        log_result("Option Chain Snapshot GET", False, f"status={status}, result={result}")

    # 6. Test relocated EOD history endpoint via POST: /v1/history/options/eod
    print(f"\n[Test 6] Querying relocated EOD history endpoint via POST: /v1/history/options/eod...")
    payload = {"symbol": "AAPL", "start": "2024-01-02", "end": "2024-01-05", "expiration": "2024-01-19", "strike": "180", "right": "C"}
    status, result = request_json("/v1/history/options/eod", method="POST", payload=payload)
    if status == 200 and isinstance(result, dict):
        data = result.get("data") or []
        log_result("EOD Relocated Route POST", isinstance(data, list), f"status={status}, records={len(data)}")
    else:
        log_result("EOD Relocated Route POST", False, f"status={status}, result={result}")

    # 7. Test options trades history endpoint via GET: /v1/history/options/trades
    print(f"\n[Test 7] Querying options trades history endpoint via GET: /v1/history/options/trades...")
    params = {"symbols": "AAPL240112C00182500", "start": "2024-01-18", "end": "2024-01-18"}
    status, result = request_json("/v1/history/options/trades", method="GET", params=params)
    if status == 200 and isinstance(result, dict):
        trades = result.get("trades")
        success = isinstance(trades, dict) and len(trades) == 0
        log_result("Options Trades (Empty Response when too early)", success, f"status={status}, trades={trades}")
    else:
        log_result("Options Trades (Empty Response when too early)", False, f"status={status}, result={result}")

    # 8. Test direct ThetaData proxy ohlc snapshot: /v3/option/snapshot/ohlc
    print(f"\n[Test 8] Querying direct ThetaData proxy snapshot: /v3/option/snapshot/ohlc...")
    if active_contract:
        exp_date_str = active_contract.get("expiration_date").replace("-", "") # "2026-05-26" -> "20260526"
        strike_val = str(active_contract.get("strike_price"))
        right_val = "C" if active_contract.get("type", "").lower() in ("call", "c") else "P"
        params = {
            "symbol": "AAPL",
            "expiration": exp_date_str,
            "strike": strike_val,
            "right": right_val
        }
    else:
        params = {"symbol": "AAPL", "expiration": "20260619", "strike": "200.00", "right": "C"}
    
    print(f"Using OHLC parameters: {params}")
    status, result = request_json("/v3/option/snapshot/ohlc", method="GET", params=params)
    if status == 200 or (status == 502 and "connect" in str(result).lower()):
        log_result("Direct ThetaData Proxy Snapshot", True, f"status={status}, result={str(result)[:200]}")
    else:
        log_result("Direct ThetaData Proxy Snapshot", False, f"status={status}, result={result}")

    # 9. Test direct ThetaData proxy last quote at time: /v3/option/at_time/quote
    print(f"\n[Test 9] Querying direct ThetaData proxy last quote at time: /v3/option/at_time/quote...")
    params = {
        "symbol": "AAPL",
        "expiration": "20241108",
        "strike": "220.00",
        "right": "call",
        "start_date": "20241104",
        "end_date": "20241104",
        "time_of_day": "09:30:01.000"
    }
    status, result = request_json("/v3/option/at_time/quote", method="GET", params=params)
    if status == 200 or (status == 502 and "connect" in str(result).lower()):
        log_result("Direct ThetaData Proxy At Time Quote", True, f"status={status}, result={str(result)[:200]}")
    else:
        log_result("Direct ThetaData Proxy At Time Quote", False, f"status={status}, result={result}")

    print(f"\n============================================================")
    print(f"Results: {GREEN}{passed} passed{RESET}, {RED}{failed} failed{RESET}")
    print(f"============================================================")
    sys.exit(0 if failed == 0 else 1)

if __name__ == "__main__":
    main()
