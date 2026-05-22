---
name: proxy
description: Load full architecture context for the Alpaca data proxy service — EC2 token site, ThinkCentre cloud proxy, Caddy bridge, cache layers, warmer, and ops access. Use when working on, debugging, deploying, or asking questions about any part of the proxy system.
argument-hint: [topic]
allowed-tools: [Read, Bash, Edit, Write, Grep]
---

# Alpaca Data Proxy — System Skill

This skill loads the complete architecture context for the proxy stack so you can operate, debug, and modify it without re-explanation.

**If the user passed a topic argument ($ARGUMENTS), focus first on that section** (e.g. `/proxy cache`, `/proxy deploy`, `/proxy ssh`). Otherwise present a brief index and wait for a specific question.

---

## 1. Topology

Two physical hosts, three Docker services, one Tailscale mesh.

```
┌──────────────────────────────────────────────────────────────────────┐
│ PUBLIC INTERNET                                                      │
│   Users → 52.37.182.24:3000  (token portal)                          │
│   Users → 52.37.182.24:8767  (WebSocket data)                        │
│   Users → 52.37.182.24:8768  (REST data)                             │
└──────────────────────┬───────────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│ EC2  ip 52.37.182.24   tailscale 100.92.160.46                       │
│                                                                      │
│   :3000 ─ proxy-token-site  (Express, PM2)                           │
│           writes tokens → /home/ec2-user/cloud-proxy/users.json      │
│                                                                      │
│   :8767 ─ Caddy ──→ 100.70.107.106:8767  (Tailscale → ThinkCentre)   │
│   :8768 ─ Caddy ──→ 100.70.107.106:8768  (Tailscale → ThinkCentre)   │
│           OPTIONS preflight returns 204 locally; CORS headers added  │
│                                                                      │
│   127.0.0.1:8765/8766 ─ "EC2 cloud-proxy" Docker container           │
│           Local-only Alpaca proxy, no disk cache, leaner version.    │
│           Writes /home/ec2-user/cloud-proxy/audit.jsonl              │
└──────────────────────────────────────────────────────────────────────┘
                       │ Tailscale
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│ ThinkCentre  tailscale 100.70.107.106  user: mint                    │
│                                                                      │
│   :8767/:8768 ─ "ThinkCentre cloud-proxy" Docker container           │
│           This is the live public-facing proxy. ~2076 lines.         │
│           No disk cache currently (lean version).                    │
│           Image built from:                                          │
│           ~/Desktop/my_openalice/components/my_cloud_lean/proxy/     │
│           cloud/{Dockerfile.cloud-proxy, alpaca_cloud_proxy.py}      │
│                                                                      │
│   :80    ─ Caddy convenience endpoint → localhost:8768               │
│           (For local testing; not on the public path.)               │
│                                                                      │
│   ~/Websocket-DataFeed-Proxy/ec2-primary-backup/                     │
│           Staged dev version (~4336 lines) WITH full L1+L2 cache,    │
│           disk_cache.py, cache warmers. NOT deployed anywhere yet.   │
│           Disk cache wired into all 7 endpoints (patched recently).  │
└──────────────────────────────────────────────────────────────────────┘
```

**Key rule of thumb:** When the user says "the proxy" they usually mean the **ThinkCentre proxy** (public-facing). The EC2 cloud-proxy is internal/fallback. The `ec2-primary-backup` is a staging copy with cache improvements not yet shipped.

---

## 2. SSH access

All SSH uses key `~/.ssh/id_ed25519`. ThinkCentre is reached via `ProxyJump` through EC2.

```bash
# EC2
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24

# ThinkCentre (jump through EC2 over Tailscale)
ssh -i ~/.ssh/id_ed25519 -J ec2-user@52.37.182.24 mint@100.70.107.106

# scp to ThinkCentre
scp -i ~/.ssh/id_ed25519 -o ProxyJump=ec2-user@52.37.182.24 <file> mint@100.70.107.106:<path>
```

**Sudo on ThinkCentre requires a password** (no NOPASSWD). For root-owned files, stage to `/tmp/` and ask the user to run `sudo cp ... && sudo systemctl restart ...`.

**EC2 → ThinkCentre** has its own key for cron use: `~/.ssh/id_thinkcentre` (mint's `authorized_keys` already contains the matching public key).

---

## 3. Token portal (proxy-token-site)

Local repo: `/home/kai/product-apim/proxy-token-site/`. Lives on EC2 at `/home/ec2-user/proxy-token-site/`, run by **PM2** (not systemd — systemd unit is broken).

```bash
# Local dev
node server.js

# Deploy
bash deploy.sh        # NOTE: wipes data/pending.json — back up pending approvals first

# Restart on EC2
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "pm2 reload proxy-token-site"

# Logs
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "pm2 logs proxy-token-site"
```

How token provisioning works: portal writes directly to `/home/ec2-user/cloud-proxy/users.json` (no API call to the proxy). Both services live on the same EC2 host, so this is a local file write. Tokens are 1-month UUIDs and idempotent — re-requesting returns the existing token.

Service tiers (defined in `server.js`):

| tier | role string | WS channels | REST endpoints |
|---|---|---|---|
| Premium | `premium` | stocks, options, overnight, crypto, news, boats, test | all |
| Limited Premium | `limited_premium` | stocks, options | history, contracts, snapshots |
| Basic | `basic` | stocks, news | stocks_history, news_history |

Admin: `POST /admin/login` with `ADMIN_PASSWORD` (default `admin123`), then `X-Admin-Token` header. Sessions are in an in-memory Set — they die on restart.

---

## 4. Cloud proxy (ThinkCentre, live)

Source: `~/Desktop/my_openalice/components/my_cloud_lean/proxy/cloud/alpaca_cloud_proxy.py` (2076 lines, baked into Docker image — no volume mount).

Docker container exposes `:8767 ← container :8765` (WS) and `:8768 ← container :8766` (REST).

```bash
# On ThinkCentre
sudo docker ps                              # find container id
sudo docker logs cloud-proxy-... --tail 100
cd ~/Desktop/my_openalice/components/my_cloud_lean/proxy/cloud/
# edit alpaca_cloud_proxy.py, then:
sudo docker compose -f docker-compose.cloud-proxy.yml up -d --build
```

**Live endpoints** (all `POST`, `Authorization: Bearer <token>`):

| Endpoint | Tier | Source |
|---|---|---|
| `/v1/history/bars` | basic+ | Alpaca |
| `/v1/history/news` | basic+ | Alpaca |
| `/v1/options/contracts` | limited_premium+ | Alpaca |
| `/v1/options/snapshots[/ohlc\|/trade\|/quote\|/market_value\|/open_interest]` | limited_premium+ | Alpaca or ThetaData |
| `/v1/options/snapshots/expiry` | limited_premium+ | Alpaca |
| `/v1/history/options/bars` | limited_premium+ | ThetaData primary, Alpaca fallback |
| `/v1/options/open_interest` | limited_premium+ | ThetaData |
| `/v1/options/eod` | limited_premium+ | ThetaData |
| `/v1/crypto/us/latest/orderbooks` | premium | Alpaca |
| `/v1/history/options/trade_quote`, `/v1/options/history/trade_quote`, `/v1/stock/history/trade_quote` | — | ThetaData (ThinkCentre-only routes) |

WebSocket channels: `/stream` (stocks), `/stream/options`, `/stream/overnight`, `/stream/crypto`, `/stream/news`, `/stream/boats`. Stocks/options/overnight/boats use **msgpack**; crypto/news use **JSON**.

WS auth flow: connect → `{"action":"auth","token":"..."}` → receive `[{"T":"success","msg":"authenticated"}]` → subscribe.

---

## 5. Cache architecture (in ec2-primary-backup staging)

Currently **not in the live ThinkCentre proxy** — exists in `~/Websocket-DataFeed-Proxy/ec2-primary-backup/` and patches were applied to wire it into all 7 cacheable endpoints (May 2026). To deploy: copy the staging files into `my_cloud_lean/proxy/cloud/`, rebuild Docker image, restart.

```
Request
  ↓
L1: in-process Python dict (MemoryRedisClient, 500 entries, 300s TTL)
  ↓ miss
L2: gzip JSON on disk (/mnt/data/cache, 100GB budget, tiered TTL)
  ↓ miss
In-flight coalescing (asyncio.Future) — concurrent identical reqs share one upstream call
  ↓
Upstream (Alpaca / ThetaData)
```

**Disk cache file:** `disk_cache.py` (in `ec2-primary-backup/`). Key = SHA-256 of endpoint + sorted params (token/user_id stripped). All I/O wrapped in `run_in_executor` — non-blocking.

TTL tiers (`ENDPOINT_TTL` in `disk_cache.py`):
- `/v1/history/bars`, `/v1/history/options/bars`: **tiered** — 60s if `end` is today, 7 days if historical
- `/v1/options/open_interest`, `/v1/options/contracts`: 3600s
- `/v1/options/eod`: 7 days
- `/v1/options/snapshots[/expiry]`: 300s
- `/v1/history/news`: 300s

Wiring pattern in handlers (already applied to all 6+ endpoints in staging):
```python
_disk_params = {"symbol": symbol, ...}
try:
    _disk = await get_disk_cache_instance()
    if _disk is not None:
        _hit = await _disk.get("/v1/...", _disk_params)
        if _hit is not None:
            return _log_and_return(_hit, 200, cache_status="DISK_HIT")
except Exception as _e:
    print(f"[DiskCache] ... get error: {_e}")
# ... upstream fetch ...
await _disk.put("/v1/...", _disk_params, response_payload)
```

---

## 6. Cache warmer (adaptive feedback loop)

Lives in `~/Websocket-DataFeed-Proxy/ec2-primary-backup/` on ThinkCentre:

- **`tickers.json`** — S&P 500 (502) + NASDAQ-100 (106) + ETFs (10). Baseline list.
- **`refresh_tickers.py`** — pulls current constituents from Wikipedia, rewrites `tickers.json`. Run monthly.
- **`smart_warmer_v2.py`** — combines hot pairs from audit + baseline tickers, warms via the local proxy.

```bash
# Manual run
cd ~/Websocket-DataFeed-Proxy/ec2-primary-backup
python3 smart_warmer_v2.py --token test123 --audit-file audit.jsonl --rate 3.0

# Dry-run (preview plan, no requests)
python3 smart_warmer_v2.py --token test123 --audit-file audit.jsonl --dry-run
```

**Sync + run automation:**
- EC2 cron `*/15 * * * *`: rsync `/home/ec2-user/cloud-proxy/audit.jsonl` → ThinkCentre via `id_thinkcentre` key (log: `/tmp/audit-sync.log` on EC2)
- ThinkCentre cron `0 23 * * *`: run `smart_warmer_v2.py` (log: `warmer_v2.log`)

---

## 7. Docs site

- React (CDN) source: `claude_design/docs-site.jsx`
- Export to GitHub Pages: `docs_export/docs-site.jsx` (sync this file after edits)
- Live: `https://ikkisovi.github.io/Websocket-DataFeed-Proxy-docs/`
- GitHub repo: `/tmp/Websocket-DataFeed-Proxy-docs/` (local clone for pushes)
- Index page (`public/index.html`) embeds the docs site in an iframe.

The `patch_docs*.js` scripts in repo root are one-off patches against `claude_design/docs-site.jsx` — they exist for history; do not rerun them blindly.

---

## 8. Common ops

```bash
# Tail live proxy logs (ThinkCentre)
ssh -i ~/.ssh/id_ed25519 -J ec2-user@52.37.182.24 mint@100.70.107.106 \
  "sudo docker logs -f \$(sudo docker ps -q --filter name=cloud-proxy)"

# Audit summary (last 24h)
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 \
  "python3 /home/ec2-user/cloud-proxy/scripts/proxy_summary.py 24"

# Check Caddy
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "sudo systemctl status caddy"

# Verify OPTIONS preflight
curl -s -o /dev/null -w '%{http_code}' -X OPTIONS http://52.37.182.24:8768/v1/history/bars  # → 204

# Check warmer log
ssh -i ~/.ssh/id_ed25519 -J ec2-user@52.37.182.24 mint@100.70.107.106 \
  "tail -50 ~/Websocket-DataFeed-Proxy/ec2-primary-backup/warmer_v2.log"
```

---

## 9. Known issues / pending work

1. **Cache not in live proxy yet** — `ec2-primary-backup/alpaca_cloud_proxy.py` has the full cache wiring, but ThinkCentre runs `my_cloud_lean` which doesn't. Deploy step is needed.
2. **No TLS** — Caddy serves HTTP on `:8767/:8768`. Needs a domain pointed at `52.37.182.24` to enable Let's Encrypt.
3. **`deploy.sh` wipes `data/pending.json`** on every deploy. Back up pending approvals first.
4. **Admin sessions are in-memory** — restart kills them. No issue unless restarts are frequent.
5. **7× duplicated relay state in proxy** — each WS channel has its own copy/paste of client sets and queues. Functional but a refactor target (`RelayChannel` class).

---

## 10. Where things live (quick reference)

| Thing | Path |
|---|---|
| Token portal source | `/home/kai/product-apim/proxy-token-site/` |
| Token portal on EC2 | `/home/ec2-user/proxy-token-site/` |
| Token registry | `/home/ec2-user/cloud-proxy/users.json` |
| EC2 cloud-proxy code | `/home/ec2-user/cloud-proxy/alpaca_cloud_proxy.py` |
| EC2 audit log | `/home/ec2-user/cloud-proxy/audit.jsonl` |
| ThinkCentre live proxy | `~/Desktop/my_openalice/components/my_cloud_lean/proxy/cloud/` |
| Staging proxy (w/ cache) | `~/Websocket-DataFeed-Proxy/ec2-primary-backup/` |
| Disk cache directory | `/mnt/data/cache/` (ThinkCentre, when deployed) |
| Caddyfile (EC2) | `/etc/caddy/Caddyfile` |
| Caddyfile (ThinkCentre) | `/etc/caddy/Caddyfile` |
| EC2→ThinkCentre cron key | `~/.ssh/id_thinkcentre` (on EC2) |
