#!/usr/bin/env python3
"""
Provision N internal load-test users via the token-site registration + admin
approve flow. Writes tokens to test_tokens.json for use with perf_stress_100users.py.

Each user is registered with tier="test" → mapped to role="test" on the proxy
(200 req/min, 10 REST parallel, 5 WS conns). Marked test_user:true so the
warmer ignores their audit entries.

Usage:
  python3 provision_test_users.py                      # 20 users at EC2 prod
  python3 provision_test_users.py --count 50
  python3 provision_test_users.py --host localhost --port 3000  # against local server.js
"""

import argparse
import json
import sys
import time
import urllib.request
import urllib.error


def _post(url: str, body: dict, headers: dict = None, timeout: int = 15):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {"error": str(e)}
    except Exception as e:
        return 0, {"error": str(e)}


def main(args):
    base = f"http://{args.host}:{args.port}"
    print(f"\n=== Provisioning {args.count} test users at {base} ===\n")

    # 1. Admin login
    print(f"  → Admin login...")
    status, body = _post(f"{base}/api/admin/login", {"password": args.admin_password})
    if status != 200 or "token" not in body:
        print(f"  ✗ Admin login failed: {status} {body}")
        sys.exit(1)
    admin_token = body["token"]
    admin_headers = {"X-Admin-Token": admin_token}
    print(f"  ✓ Admin session token obtained\n")

    # 2. Unique prefix so re-runs don't collide on usernames
    prefix = args.prefix or f"perftest_{int(time.time())}"
    print(f"  Username prefix: {prefix}\n")

    tokens = []
    for i in range(args.count):
        username = f"{prefix}_{i:03d}"
        phone    = f"555{int(time.time()) % 10000:04d}{i:03d}"

        # Register
        status, body = _post(f"{base}/api/register", {
            "username": username,
            "phone": phone,
            "tier": "test",
        })
        if status != 200 or "id" not in body:
            print(f"  [{i:02d}] {username} register failed: {status} {body}")
            continue
        pending_id = body["id"]

        # Approve (this generates the token + syncs to ThinkCentre)
        status, body = _post(f"{base}/api/admin/approve",
                              {"id": pending_id}, headers=admin_headers,
                              timeout=30)   # SCP can be slow
        if status != 200 or "token" not in body:
            print(f"  [{i:02d}] {username} approve failed: {status} {body}")
            continue

        tokens.append({"user_id": username, "token": body["token"],
                        "expiry": body.get("expiry", "")})
        print(f"  [{i:02d}] ✓ {username} → {body['token'][:8]}…")

    # 3. Save
    with open(args.output, "w") as f:
        json.dump(tokens, f, indent=2)

    print(f"\n  Saved {len(tokens)}/{args.count} tokens to {args.output}")

    if not tokens:
        print(f"  No tokens provisioned. Aborting.")
        sys.exit(1)

    # 4. Smoke test one token against the proxy
    print(f"\n  → Smoke-testing first token against proxy...")
    smoke_url = f"http://{args.proxy_host}:{args.proxy_port}/v1/history/bars"
    smoke_body = {
        "token": tokens[0]["token"],
        "symbol": "AAPL", "timeframe": "1Min",
        "start": "2025-01-02", "end": "2025-01-03", "limit": 5,
    }
    status, body = _post(smoke_url, smoke_body, timeout=20)
    if status == 200:
        print(f"  ✓ Smoke test passed (200)\n")
    else:
        keys = list(body.keys()) if isinstance(body, dict) else []
        print(f"  ⚠ Smoke test returned {status}. Keys: {keys}")
        print(f"    (This is OK if users.json hasn't synced to ThinkCentre yet — wait 10s.)\n")

    # 5. Print ready-to-paste invocation
    print(f"  Run stress test with these tokens:")
    print(f"  python3 perf_stress_100users.py scatter --tokens-file {args.output}\n")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Provision N test users for load testing")
    p.add_argument("--host",            default="52.37.182.24",
                   help="Token site host (EC2)")
    p.add_argument("--port",            type=int, default=3000)
    p.add_argument("--admin-password",  default="admin123")
    p.add_argument("--count",           type=int, default=20)
    p.add_argument("--prefix",          default=None,
                   help="Username prefix (default: perftest_<timestamp>)")
    p.add_argument("--output",          default="test_tokens.json")
    p.add_argument("--proxy-host",      default="52.37.182.24",
                   help="Proxy host for smoke test")
    p.add_argument("--proxy-port",      type=int, default=8768)
    args = p.parse_args()
    main(args)
