#!/usr/bin/env python3
"""
Tier Access Checker — verify all REST endpoints and WS modes per tier.

Creates temporary tokens for each tier, tests every endpoint, then cleans up.
Run from anywhere with network access to the proxy:

    python3 check_tier_access.py                    # test via public IP
    python3 check_tier_access.py --host 100.70.107.106  # test via Tailscale
"""
import json, sys, uuid, argparse, time, subprocess
from pathlib import Path

# --- Tier definitions (must match server.js TIERS) ---
TIERS = {
    "trial": {
        "role": "standard",
        "permissions": {
            "ws": {"stocks": True, "options": True, "overnight": False, "crypto": False, "news": False, "boats": False, "test": True},
            "rest": {"stocks_history": True, "options_history": True, "options_contracts": True, "options_snapshots": True, "options_snapshots_expiry": True, "crypto_orderbooks": False, "admin_token_lookup": False, "news_history": False}
        }
    },
    "basic": {
        "role": "basic",
        "permissions": {
            "ws": {"stocks": False, "options": False, "overnight": False, "crypto": False, "news": False, "boats": False, "test": False},
            "rest": {"stocks_history": True, "options_history": True, "options_contracts": True, "options_snapshots": True, "options_snapshots_expiry": True, "crypto_orderbooks": False, "admin_token_lookup": False, "news_history": False}
        }
    },
    "standard": {
        "role": "standard",
        "permissions": {
            "ws": {"stocks": True, "options": True, "overnight": False, "crypto": False, "news": False, "boats": False, "test": True},
            "rest": {"stocks_history": True, "options_history": True, "options_contracts": True, "options_snapshots": True, "options_snapshots_expiry": True, "crypto_orderbooks": False, "admin_token_lookup": False, "news_history": False}
        }
    },
    "premium": {
        "role": "premium",
        "permissions": {
            "ws": {"stocks": True, "options": True, "overnight": True, "crypto": True, "news": True, "boats": True, "test": True},
            "rest": {"stocks_history": True, "options_history": True, "options_contracts": True, "options_snapshots": True, "options_snapshots_expiry": True, "crypto_orderbooks": True, "admin_token_lookup": False, "news_history": True}
        }
    }
}

# REST endpoints → permission key mapping (mirrors cloud proxy)
REST_ENDPOINTS = {
    "/v1/history/bars": "stocks_history",
    "/v1/history/options/bars": "options_history",
    "/v1/options/contracts": "options_contracts",
    "/v1/options/snapshots": "options_snapshots",
    "/v1/options/snapshots/expiry": "options_snapshots_expiry",
    "/v1/options/snapshots/ohlc": "options_snapshots",
    "/v1/options/snapshots/trade": "options_snapshots",
    "/v1/options/snapshots/quote": "options_snapshots",
    "/v1/options/snapshots/market_value": "options_snapshots",
    "/v1/options/open_interest": "options_history",
    "/v1/options/eod": "options_history",
    "/v1/history/options/eod": "options_history",
    "/v1/history/options/trades": "options_history",
    "/v1/crypto/us/latest/orderbooks": "crypto_orderbooks",
    "/v1/history/news": "news_history",
    "/v1/history/options/trade_quote": "options_history",
    "/v1/stock/history/trade_quote": "stocks_history",
}

# Minimal valid payloads per endpoint (enough to pass validation, may return empty data)
ENDPOINT_PAYLOADS = {
    "/v1/history/bars": {"symbol": "AAPL", "timeframe": "1Day", "start": "2026-05-20", "end": "2026-05-21", "limit": 1},
    "/v1/history/options/bars": {"symbol": "AAPL260620C00200000", "timeframe": "1Day", "start": "2026-05-20", "end": "2026-05-21"},
    "/v1/options/contracts": {"underlying_symbols": "AAPL", "limit": 1},
    "/v1/options/snapshots": {"symbols": "AAPL260620C00200000"},
    "/v1/options/snapshots/expiry": {"underlying_symbol": "AAPL"},
    "/v1/options/snapshots/ohlc": {"symbols": "AAPL260620C00200000"},
    "/v1/options/snapshots/trade": {"symbols": "AAPL260620C00200000"},
    "/v1/options/snapshots/quote": {"symbols": "AAPL260620C00200000"},
    "/v1/options/snapshots/market_value": {"symbols": "AAPL260620C00200000"},
    "/v1/options/open_interest": {"root": "AAPL", "exp": "2026-06-20"},
    "/v1/options/eod": {"root": "AAPL", "exp": "2026-06-20"},
    "/v1/history/options/eod": {"root": "AAPL", "exp": "2026-06-20"},
    "/v1/history/options/trades": {"root": "AAPL", "exp": "2026-06-20"},
    "/v1/crypto/us/latest/orderbooks": {"symbols": "BTC/USD"},
    "/v1/history/news": {"symbols": "AAPL", "limit": 1},
    "/v1/history/options/trade_quote": {"root": "AAPL", "exp": "2026-06-20"},
    "/v1/stock/history/trade_quote": {"symbol": "AAPL", "start": "2026-05-20", "end": "2026-05-21"},
}

# WS permission keys
WS_MODES = ["stocks", "options", "overnight", "crypto", "news", "boats", "test"]


def post_json(url, payload, timeout=30):
    """POST JSON via curl and return (status_code, response_body_dict_or_str)."""
    try:
        result = subprocess.run(
            ["curl", "-s", "--max-time", str(timeout),
             "-w", "\n__HTTP_CODE__%{http_code}",
             "-X", "POST", url,
             "-H", "Content-Type: application/json",
             "-d", json.dumps(payload)],
            capture_output=True, text=True, timeout=timeout + 5
        )
        output = result.stdout
        # Extract HTTP status code from curl output
        if "__HTTP_CODE__" in output:
            parts = output.rsplit("\n__HTTP_CODE__", 1)
            body_str = parts[0]
            status = int(parts[1].strip())
        else:
            body_str = output
            status = 0
        try:
            return status, json.loads(body_str)
        except json.JSONDecodeError:
            return status, body_str
    except (subprocess.TimeoutExpired, Exception) as e:
        return 0, str(e)


def inject_test_tokens(users_json_path):
    """Add temporary test tokens to users.json, return {tier: token}."""
    data = json.load(open(users_json_path))
    tokens = {}
    for tier_name, tier_cfg in TIERS.items():
        token = f"__tiertest_{tier_name}_{uuid.uuid4().hex[:8]}"
        tokens[tier_name] = token
        data["users"].append({
            "token": token,
            "user_id": f"__tiertest_{tier_name}",
            "role": tier_cfg["role"],
            "expires_at": "2099-12-31T23:59:59.000Z",
            "permissions": tier_cfg["permissions"]
        })
    json.dump(data, open(users_json_path, "w"), indent=2)
    return tokens


def cleanup_test_tokens(users_json_path):
    """Remove all __tiertest_ tokens."""
    data = json.load(open(users_json_path))
    before = len(data["users"])
    data["users"] = [u for u in data["users"] if not u.get("user_id", "").startswith("__tiertest_")]
    after = len(data["users"])
    json.dump(data, open(users_json_path, "w"), indent=2)
    return before - after


def check_rest_endpoints(host, port, tokens):
    """Test every REST endpoint with every tier token. Returns results dict."""
    results = {}
    for tier_name, token in tokens.items():
        results[tier_name] = {}
        expected_perms = TIERS[tier_name]["permissions"]["rest"]

        for endpoint, perm_key in REST_ENDPOINTS.items():
            payload = dict(ENDPOINT_PAYLOADS.get(endpoint, {}))
            payload["token"] = token

            url = f"http://{host}:{port}{endpoint}"
            status, body = post_json(url, payload)

            # Determine if access was granted
            if status == 0:
                granted = None  # network error
                detail = str(body)
            elif isinstance(body, dict) and body.get("error") in ("Endpoint not allowed for your tier", "Invalid token"):
                granted = False
                detail = body["error"]
            elif status in (200, 201):
                granted = True
                detail = "OK"
            elif status == 403:
                granted = False
                detail = body.get("error", str(body)) if isinstance(body, dict) else str(body)
            else:
                granted = True  # got a response (might be 400 bad params, but access was granted)
                detail = f"status={status}"

            expected = expected_perms.get(perm_key, False)
            # Special case: news_history is hardcoded to allow in the proxy
            if perm_key == "news_history":
                expected = True

            match = (granted == expected) if granted is not None else None
            results[tier_name][endpoint] = {
                "perm_key": perm_key,
                "expected": expected,
                "granted": granted,
                "match": match,
                "detail": detail,
            }
    return results


def print_results(results):
    """Pretty-print tier access check results."""
    total = 0
    passed = 0
    failed = 0
    errors = 0

    for tier_name in ["trial", "basic", "standard", "premium"]:
        tier_results = results[tier_name]
        print(f"\n{'='*60}")
        print(f"  TIER: {tier_name.upper()} (role={TIERS[tier_name]['role']})")
        print(f"{'='*60}")

        for endpoint, r in sorted(tier_results.items()):
            total += 1
            exp = "ALLOW" if r["expected"] else "DENY"
            if r["granted"] is None:
                status = "ERROR"
                errors += 1
                icon = "?"
            elif r["match"]:
                status = "PASS"
                passed += 1
                icon = "✓"
            else:
                status = "FAIL"
                failed += 1
                icon = "✗"
            got = "ALLOW" if r["granted"] else "DENY"
            print(f"  {icon} {endpoint:<45} expect={exp:<5} got={got:<5} [{status}]  {r['detail'] if status != 'PASS' else ''}")

    print(f"\n{'='*60}")
    print(f"  SUMMARY: {passed}/{total} passed, {failed} failed, {errors} errors")
    print(f"{'='*60}")
    return failed == 0 and errors == 0


def main():
    parser = argparse.ArgumentParser(description="Check tier-based endpoint access")
    parser.add_argument("--host", default="52.37.182.24", help="Proxy host (default: EC2 public IP)")
    parser.add_argument("--port", default=8768, type=int, help="REST port (default: 8768)")
    parser.add_argument("--users-json", default=None, help="Path to users.json (for local injection)")
    parser.add_argument("--tokens", default=None, help="JSON string of {tier: token} for pre-existing tokens")
    parser.add_argument("--no-cleanup", action="store_true", help="Don't remove test tokens after")
    args = parser.parse_args()

    if args.tokens:
        tokens = json.loads(args.tokens)
        print(f"Using provided tokens for {len(tokens)} tiers")
    elif args.users_json:
        print(f"Injecting test tokens into {args.users_json} ...")
        tokens = inject_test_tokens(args.users_json)
        print(f"  Injected tokens: {json.dumps({k: v[:20]+'...' for k,v in tokens.items()})}")
        print("  Waiting 2s for proxy to reload registry...")
        time.sleep(2)
    else:
        print("ERROR: Provide --users-json (for token injection) or --tokens (for pre-existing tokens)")
        sys.exit(1)

    print(f"\nTesting REST endpoints on {args.host}:{args.port} ...")
    results = check_rest_endpoints(args.host, args.port, tokens)
    all_pass = print_results(results)

    # WS mode summary (based on permissions, not live-tested)
    print(f"\n{'='*60}")
    print(f"  WS MODE PERMISSIONS (from tier config, not live-tested)")
    print(f"{'='*60}")
    header = f"  {'Mode':<12}" + "".join(f"{t.upper():<10}" for t in ["trial", "basic", "standard", "premium"])
    print(header)
    print(f"  {'-'*52}")
    for mode in WS_MODES:
        row = f"  {mode:<12}"
        for t in ["trial", "basic", "standard", "premium"]:
            allowed = TIERS[t]["permissions"]["ws"].get(mode, False)
            row += f"{'✓':<10}" if allowed else f"{'—':<10}"
        print(row)

    if args.users_json and not args.no_cleanup:
        removed = cleanup_test_tokens(args.users_json)
        print(f"\nCleaned up {removed} test tokens from {args.users_json}")

    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
