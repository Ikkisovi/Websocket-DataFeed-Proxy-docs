#!/usr/bin/env python3
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
    print(f"Running Index Options Verification (SPX & NDX)")
    print(f"REST API Host: {REST_URL}")
    print(f"============================================================\n")

    # 1. Health Check
    try:
        req = urllib.request.Request(f"{REST_URL}/health", method="GET")
        with urllib.request.urlopen(req, timeout=5) as response:
            text = response.read().decode("utf-8").strip()
            log_result("Health Check", response.status == 200 and text == "OK", f"status={response.status}, body={text}")
    except Exception as e:
        log_result("Health Check", False, str(e))

    # 2. SPX Option Contracts Query (mimics user, falls back to ThetaData since Alpaca does not support SPX)
    print("\n[Test 1] Querying SPX options contracts for date 2026-05-20...")
    payload = {
        "underlying_symbols": "SPX",
        "date": "2026-05-20",
        "limit": 5,
        "provider": "auto"
    }
    status, result = request_json("/v1/options/contracts", payload=payload)
    spx_sym = None
    if status == 200 and isinstance(result, dict):
        contracts = result.get("option_contracts") or []
        provider = result.get("source", result.get("provider", "unknown"))
        if contracts:
            spx_sym = contracts[0].get("symbol")
            log_result(f"SPX Option Contracts Query (Source: {provider})", True, f"Found {len(contracts)} contracts. Sample OCC: {spx_sym}")
        else:
            log_result(f"SPX Option Contracts Query (Source: {provider})", False, "Contracts list is empty")
    else:
        log_result("SPX Option Contracts Query", False, f"status={status}, result={result}")

    # 3. NDX Option Contracts Query (falls back to ThetaData since Alpaca does not support NDX)
    print("\n[Test 2] Querying NDX options contracts for date 2026-05-20...")
    payload = {
        "underlying_symbols": "NDX",
        "date": "2026-05-20",
        "limit": 5,
        "provider": "auto"
    }
    status, result = request_json("/v1/options/contracts", payload=payload)
    ndx_sym = None
    if status == 200 and isinstance(result, dict):
        contracts = result.get("option_contracts") or []
        provider = result.get("source", result.get("provider", "unknown"))
        if contracts:
            ndx_sym = contracts[0].get("symbol")
            log_result(f"NDX Option Contracts Query (Source: {provider})", True, f"Found {len(contracts)} contracts. Sample OCC: {ndx_sym}")
        else:
            log_result(f"NDX Option Contracts Query (Source: {provider})", False, "Contracts list is empty")
    else:
        log_result("NDX Option Contracts Query", False, f"status={status}, result={result}")

    # 4. SPX Option Chain Auto-Resolution & Historical Bars
    print("\n[Test 3] Querying historical option bars for SPX (Auto-resolving chain to 10 contracts)...")
    payload = {
        "symbol": "SPX",
        "timeframe": "1Day",
        "start": "2026-05-18",
        "end": "2026-05-20",
        "provider": "auto"
    }
    status, result = request_json("/v1/history/options/bars", payload=payload)
    if status == 200 and isinstance(result, dict):
        bars = result.get("bars") or {}
        provider = result.get("provider", "unknown")
        success = len(bars) > 0
        detail = f"status={status}, provider={provider}, resolved_contracts={list(bars.keys())[:3]}... total_count={len(bars)}"
        log_result("SPX Option Chain Auto-Resolution & Bars", success, detail)
    else:
        log_result("SPX Option Chain Auto-Resolution & Bars", False, f"status={status}, result={result}")

    # 5. NDX Option Chain Auto-Resolution & Historical Bars
    print("\n[Test 4] Querying historical option bars for NDX (Auto-resolving chain to 10 contracts)...")
    payload = {
        "symbol": "NDX",
        "timeframe": "1Day",
        "start": "2026-05-18",
        "end": "2026-05-20",
        "provider": "auto"
    }
    status, result = request_json("/v1/history/options/bars", payload=payload)
    if status == 200 and isinstance(result, dict):
        bars = result.get("bars") or {}
        provider = result.get("provider", "unknown")
        success = len(bars) > 0
        detail = f"status={status}, provider={provider}, resolved_contracts={list(bars.keys())[:3]}... total_count={len(bars)}"
        log_result("NDX Option Chain Auto-Resolution & Bars", success, detail)
    else:
        log_result("NDX Option Chain Auto-Resolution & Bars", False, f"status={status}, result={result}")

    # 6. Specific SPX OCC contract direct query (if we found one)
    if spx_sym:
        print(f"\n[Test 5] Querying direct historical bars for OCC contract: {spx_sym}...")
        payload = {
            "symbol": spx_sym,
            "timeframe": "1Day",
            "start": "2026-05-18",
            "end": "2026-05-20",
            "provider": "thetadata"
        }
        status, result = request_json("/v1/history/options/bars", payload=payload)
        if status == 200 and isinstance(result, dict):
            bars = result.get("bars") or {}
            contract_bars = bars.get(spx_sym, [])
            log_result("Direct OCC SPX Bars Query", True, f"status={status}, bar_count={len(contract_bars)}")
        else:
            log_result("Direct OCC SPX Bars Query", False, f"status={status}, result={result}")

    print(f"\n============================================================")
    print(f"Results: {GREEN}{passed} passed{RESET}, {RED}{failed} failed{RESET}")
    print(f"============================================================")
    sys.exit(0 if failed == 0 else 1)

if __name__ == "__main__":
    main()
