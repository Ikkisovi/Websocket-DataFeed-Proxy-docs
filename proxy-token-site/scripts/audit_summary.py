#!/usr/bin/env python3
"""Audit summary generator for DataFeed Proxy.
Reads /app/audit.jsonl (inside container) or /home/ec2-user/cloud-proxy/audit.jsonl (host)
and prints a human-readable summary.

Usage:
  python3 audit_summary.py [days=N] [top_users=N] [top_endpoints=N]
  python3 audit_summary.py --json [days=N]              # output as JSON
"""

import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
import argparse


def parse_args():
    p = argparse.ArgumentParser(description="Proxy audit log summary")
    p.add_argument("--days", type=int, default=7, help="Look back N days (default 7)")
    p.add_argument("--top-users", type=int, default=10, help="Show top N users")
    p.add_argument("--top-endpoints", type=int, default=10, help="Show top N endpoints")
    p.add_argument("--json", action="store_true", help="Output as JSON")
    p.add_argument("--file", default="/app/audit.jsonl", help="Path to audit.jsonl")
    return p.parse_args()


def load_events(path, days_back):
    cutoff = datetime.utcnow() - timedelta(days=days_back)
    events = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                # timestamp field may vary; use current time fallback
                ts = ev.get("timestamp")
                if ts is None:
                    ts = datetime.utcnow().timestamp()
                ev["_ts"] = datetime.fromtimestamp(ts) if isinstance(ts, (int, float)) else datetime.utcnow()
                if ev["_ts"] >= cutoff:
                    events.append(ev)
    except FileNotFoundError:
        print(f"File not found: {path}", file=sys.stderr)
        sys.exit(1)
    return events


def summarize(events):
    total = len(events)
    if total == 0:
        return {"total": 0, "message": "No events in range"}

    # Users
    user_counter = Counter(e.get("user_id") or e.get("user", "unknown") for e in events)
    user_details = defaultdict(lambda: {"count": 0, "endpoints": Counter(), "symbols": set(), "elapsed_ms": [], "underlyings": Counter()})
    for e in events:
        uid = e.get("user_id") or e.get("user", "unknown")
        user_details[uid]["count"] += 1
        user_details[uid]["endpoints"][e.get("endpoint", "unknown")] += 1
        sym = e.get("symbols", "")
        if sym:
            user_details[uid]["symbols"].add(sym)
            # Extract underlying (alpha prefix before first digit)
            u = ""
            for ch in sym:
                if ch.isdigit():
                    break
                u += ch
            if u:
                user_details[uid]["underlyings"][u] += 1
        if e.get("elapsed_ms") is not None:
            user_details[uid]["elapsed_ms"].append(e["elapsed_ms"])

    # Endpoints
    endpoint_counter = Counter(e.get("endpoint", "unknown") for e in events)
    ws_modes = Counter(e.get("mode") for e in events if e.get("event") == "ws_request")

    # Status codes
    status_counter = Counter(e.get("status") for e in events if "status" in e)

    # Time distribution
    hourly = Counter(e["_ts"].hour for e in events)

    # Global underlyings
    all_underlyings = Counter()
    for e in events:
        sym = e.get("symbols", "")
        if not sym:
            continue
        u = ""
        for ch in sym:
            if ch.isdigit():
                break
            u += ch
        if u:
            all_underlyings[u] += 1

    result = {
        "total": total,
        "period_days": None,  # filled later
        "users": {
            "total_unique": len(user_counter),
            "top": [
                {
                    "user_id": uid,
                    "requests": c,
                    "top_endpoint": user_details[uid]["endpoints"].most_common(1)[0][0] if user_details[uid]["endpoints"] else None,
                    "unique_symbols": len(user_details[uid]["symbols"]),
                    "avg_latency_ms": round(sum(user_details[uid]["elapsed_ms"]) / len(user_details[uid]["elapsed_ms"]), 1) if user_details[uid]["elapsed_ms"] else None,
                    "top_underlyings": dict(user_details[uid]["underlyings"].most_common(5)),
                }
                for uid, c in user_counter.most_common()
            ],
        },
        "endpoints": {
            "top": [{"endpoint": e, "count": c} for e, c in endpoint_counter.most_common()],
        },
        "ws_modes": [{"mode": m, "count": c} for m, c in ws_modes.most_common()] if ws_modes else [],
        "status_codes": [{"status": s, "count": c} for s, c in status_counter.most_common()] if status_counter else [],
        "hourly_distribution": dict(sorted(hourly.items())),
        "underlyings": dict(all_underlyings.most_common(20)),
    }
    return result


def print_summary(data, args):
    if data["total"] == 0:
        print("No audit events in the requested period.")
        return

    print("=" * 60)
    print(f"  AUDIT SUMMARY  |  Last {args.days} days")
    print("=" * 60)
    print(f"\nTotal requests: {data['total']}")
    print(f"Unique users:   {data['users']['total_unique']}")

    print(f"\n--- Top {args.top_users} Users ---")
    for u in data["users"]["top"][:args.top_users]:
        sym_info = f" | {u['unique_symbols']} symbols" if u["unique_symbols"] else ""
        lat_info = f" | avg {u['avg_latency_ms']}ms" if u["avg_latency_ms"] else ""
        print(f"  {u['user_id']}: {u['requests']} reqs{sym_info}{lat_info}")
        if u["top_endpoint"]:
            print(f"    → mainly: {u['top_endpoint']}")
        if u.get("top_underlyings"):
            top_uls = ", ".join(f"{k}({v})" for k, v in list(u["top_underlyings"].items())[:3])
            print(f"    → stocks: {top_uls}")

    print(f"\n--- Top {args.top_endpoints} Endpoints ---")
    for ep in data["endpoints"]["top"][:args.top_endpoints]:
        pct = ep["count"] / data["total"] * 100
        bar = "█" * int(pct / 2)
        print(f"  {ep['endpoint']}: {ep['count']} ({pct:.1f}%) {bar}")

    if data["ws_modes"]:
        print("\n--- WebSocket Modes ---")
        for m in data["ws_modes"]:
            print(f"  {m['mode']}: {m['count']}")

    if data["status_codes"]:
        print("\n--- HTTP Status Codes ---")
        for s in data["status_codes"]:
            print(f"  {s['status']}: {s['count']}")

    if data.get("underlyings"):
        print("\n--- Top Underlyings (Stocks) ---")
        for stock, c in list(data["underlyings"].items())[:10]:
            pct = c / data["total"] * 100
            print(f"  {stock}: {c} ({pct:.1f}%)")

    print("\n--- Hourly Distribution (UTC) ---")
    for h, c in sorted(data["hourly_distribution"].items()):
        bar = "█" * int(c / max(data["hourly_distribution"].values()) * 30)
        print(f"  {h:02d}: {c} {bar}")
    print("=" * 60)


def main():
    args = parse_args()
    events = load_events(args.file, args.days)
    data = summarize(events)
    data["period_days"] = args.days

    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False, default=str))
    else:
        print_summary(data, args)


if __name__ == "__main__":
    main()
