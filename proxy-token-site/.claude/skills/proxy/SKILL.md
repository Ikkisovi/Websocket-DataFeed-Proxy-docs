---
name: proxy
description: "Full architecture context + deploy/ops for the Alpaca data proxy service — hybrid split: REST via Cloudflare→ThinkCentre, WS via EC2 direct to Alpaca. Token-site on ThinkCentre, users.json syncs TC→EC2. Use when working on, debugging, deploying, or asking questions about any part of the proxy system. Also triggers on /proxy, deploy, push, sync, restart, register page, users.json, ThinkCentre, cloud-proxy, cloudflare, leandata, ec2."
argument-hint: "[topic or subcommand: server|page|test|status|cache|ssh|deploy|cloudflare]"
---

# Alpaca Data Proxy — System Skill

This skill loads the complete architecture context for the proxy stack so you can operate, debug, and modify it without re-explanation.

**If the user passed a topic argument ($ARGUMENTS), focus first on that section** (e.g. `/proxy cache`, `/proxy deploy`, `/proxy ssh`, `/proxy cloudflare`). Otherwise present a brief index and wait for a specific question.

---

## 1. Topology — Hybrid Split Architecture

**REST and WS run on different hosts.** ThinkCentre handles REST (lower cost, Cloudflare global edge). EC2 handles WS (lower latency to Alpaca via AWS internal network). Token portal on ThinkCentre.

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ PUBLIC INTERNET                                                                       │
│                                                                                       │
│   Main site:    https://leandata.uk        → Cloudflare Tunnel → TC localhost:3000    │
│     /           docs (API reference)                                                  │
│     /register   user registration                                                     │
│     /admin      admin panel                                                           │
│     /api/*      token API                                                             │
│   REST API:     https://api.leandata.uk    → Cloudflare Tunnel → TC localhost:8768    │
│   WebSocket:    ws://52.37.182.24:8767/*   → EC2 proxy direct (AWS internal to Alpaca)│
└───────────────┬───────────────────────────────────────────────┬───────────────────────┘
                │                                               │
                │ Cloudflare Tunnel                             │ Direct TCP
                ▼                                               ▼
┌──────────────────────────────────────────┐  ┌────────────────────────────────────────┐
│ ThinkCentre  tailscale 100.70.107.106    │  │ EC2  ip 52.37.182.24                   │
│ user: mint                               │  │ user: ec2-user                         │
│                                          │  │                                        │
│  :8768 ─ Docker: alpaca_cloud_proxy.py   │  │  :8767 ─ Docker: alpaca_cloud_proxy.py │
│          REST_ONLY=true (no WS upstream) │  │          WS-only (no REST port exposed) │
│          Alpaca + ThetaData upstream     │  │          5 free keys + master key       │
│  :3000 ─ Node: proxy-token-site          │  │          Connects direct to Alpaca WS   │
│          (Express: docs + register +     │
│           admin + token API)             │  │                                        │
│  :5432 ─ Docker: TimescaleDB            │  │  users.json ← SCP from ThinkCentre     │
│                                          │  │                                        │
│  cloudflared ─ systemd service           │  │  No Caddy, no Tailscale relay          │
│  Disk cache: /mnt/data/cache/ (NVMe L2)  │  │  Pure WS forwarding to Alpaca          │
│  users.json ← token-site writes locally  │  └────────────────────────────────────────┘
└──────────────────────────────────────────┘
```

### Why hybrid?
- **REST on TC**: Free via Cloudflare, disk cache on NVMe, ThetaData + TimescaleDB local
- **WS on EC2**: Benchmarked p50 33.5ms vs TC's 58.6ms — AWS internal network to Alpaca is faster and more stable for real-time streaming
- **REST_ONLY mode**: TC proxy sets `REST_ONLY=true` env var → skips all WS upstream connections, avoids Alpaca's per-key WS connection limit conflict

### Cloudflare Tunnel Routes (managed in Cloudflare Dashboard → Zero Trust → Networks → Tunnels)

| Hostname | Path | Service | Purpose |
|---|---|---|---|
| `api.leandata.uk` | `*` | `http://localhost:8768` | REST data proxy |
| `leandata.uk` | `*` | `http://localhost:3000` | Main site (docs + register + admin + API) |
| `leandata.uk` | `register` | `http://localhost:3000` | Registration page |
| `leandata.uk` | `admin` | `http://localhost:3000` | Admin panel |
| Catch-all | | `http_status:404` | Default fallback |

**No WS via Cloudflare** — WS goes directly to EC2, not through Cloudflare.

### Key rules:
- Main site → `https://leandata.uk` (docs, register, admin, token API)
- REST data → `https://api.leandata.uk` (Cloudflare → ThinkCentre :8768)
- WS → `ws://52.37.182.24:8767/*` (EC2 direct)
- users.json sync direction: **TC → EC2** (reversed from legacy)
- EC2 no longer runs Caddy or relays to TC — it runs its own WS proxy

---

## 2. SSH access

```bash
# ThinkCentre (primary — Tailscale SSH)
ssh mint@100.70.107.106

# EC2 (WS proxy)
ssh -i /tmp/ec2_ed25519.pem ec2-user@52.37.182.24
```

Note: The old RSA key `~/.ssh/alpacaproxy.pem` is for the **backup** EC2 (52.24.223.82) only.

---

## 3. Deploy Subcommands

Parse the user's args to determine which operation(s) to run:

| Arg | What it does |
|---|---|
| *(none)* / `deploy` | Full deploy: server + tests + restart + health check |
| `server` | Deploy server.js + server.test.js to ThinkCentre, run tests, restart |
| `proxy` | Deploy cloud proxy code to ThinkCentre AND/OR EC2, rebuild Docker |
| `page` | Deploy frontend files (token-page.jsx, tokens.css) to ThinkCentre public/ |
| `docs` | Commit & push docs-site.jsx to GitHub Pages |
| `test` | Run tests on ThinkCentre only (no deploy) |
| `status` | Show node/docker status + cloudflared health on ThinkCentre + EC2 docker status |
| `cloudflare` | Check cloudflared service status and tunnel connectivity |
| `sync` | Force SCP users.json from ThinkCentre → EC2 |

### Full Deploy Sequence (ThinkCentre — token-site)

```bash
# 1. Push server files to ThinkCentre
scp ./server.js mint@100.70.107.106:/home/mint/proxy-token-site/server.js
scp ./server.test.js mint@100.70.107.106:/home/mint/proxy-token-site/server.test.js

# 2. Run tests (STOP if they fail — do NOT restart)
ssh mint@100.70.107.106 "cd /home/mint/proxy-token-site && npx jest 2>&1"

# 3. Restart token-site
ssh mint@100.70.107.106 "pm2 restart proxy-token-site 2>/dev/null || (cd /home/mint/proxy-token-site && node server.js &)"

# 4. Health check
curl -s -X POST https://leandata.uk/api/register \
# (main site serves /api/* for token operations)
  -H 'Content-Type: application/json' \
  -d '{"username":"__healthcheck__","phone":"000","tier":"trial"}' && echo ''
# Clean up test registration
ssh mint@100.70.107.106 "node -e \"const fs=require('fs'),p='/home/mint/proxy-token-site/data/pending.json';let d=JSON.parse(fs.readFileSync(p));d=d.filter(x=>x.username!=='__healthcheck__');fs.writeFileSync(p,JSON.stringify(d,null,2));console.log('cleanup done')\""

# 5. Show status
ssh mint@100.70.107.106 "systemctl is-active cloudflared; docker ps --format 'table {{.Names}}\t{{.Status}}'; ss -tlnp | grep -E '3000|8767|8768'"
```

### Proxy Deploy — ThinkCentre (REST-only)

```bash
scp ./remote_proxy/alpaca_cloud_proxy.py mint@100.70.107.106:/home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/alpaca_cloud_proxy.py
scp ./remote_proxy/disk_cache.py mint@100.70.107.106:/home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/disk_cache.py
ssh mint@100.70.107.106 "cd ~/Websocket-DataFeed-Proxy/ec2-primary-backup && docker compose -f docker-compose.cloud-proxy.yml up -d --build"
```

### Proxy Deploy — EC2 (WS-only)

```bash
scp -i /tmp/ec2_ed25519.pem ./remote_proxy/alpaca_cloud_proxy.py ec2-user@52.37.182.24:/home/ec2-user/cloud-proxy/alpaca_cloud_proxy.py
scp -i /tmp/ec2_ed25519.pem ./remote_proxy/alpaca_key_pool.py ec2-user@52.37.182.24:/home/ec2-user/cloud-proxy/alpaca_key_pool.py
scp -i /tmp/ec2_ed25519.pem ./remote_proxy/disk_cache.py ec2-user@52.37.182.24:/home/ec2-user/cloud-proxy/disk_cache.py
ssh -i /tmp/ec2_ed25519.pem ec2-user@52.37.182.24 "cd ~/cloud-proxy && docker-compose -f docker-compose.cloud-proxy.yml up -d --build"
```

**Note:** EC2 uses `docker-compose` (hyphenated, legacy binary), NOT `docker compose` plugin.

### Page Deploy (no restart needed)

```bash
scp /home/kai/product-apim/token-page.jsx mint@100.70.107.106:/home/mint/proxy-token-site/public/token-page.jsx
scp /home/kai/product-apim/tokens.css mint@100.70.107.106:/home/mint/proxy-token-site/public/tokens.css
```

### Docs Deploy (GitHub Pages)

```bash
cd /home/kai/product-apim
git add docs-site.jsx
git commit -m "docs: <description>"
git push origin gh-pages
```

### Sync Subcommand (TC → EC2)

```bash
# Push users.json from ThinkCentre to EC2 for WS auth
ssh mint@100.70.107.106 "scp -i ~/.ssh/ec2_key /home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json ec2-user@52.37.182.24:/home/ec2-user/cloud-proxy/users.json"
# Or from local machine if TC→EC2 SCP isn't set up:
ssh mint@100.70.107.106 "cat /home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json" | ssh -i /tmp/ec2_ed25519.pem ec2-user@52.37.182.24 "cat > /home/ec2-user/cloud-proxy/users.json"
# Verify on EC2
ssh -i /tmp/ec2_ed25519.pem ec2-user@52.37.182.24 "python3 -c \"import json;d=json.load(open('/home/ec2-user/cloud-proxy/users.json'));print(len(d['users']),'users synced')\""
```

### Cloudflare Status

```bash
ssh mint@100.70.107.106 "sudo systemctl status cloudflared --no-pager | head -15"
ssh mint@100.70.107.106 "sudo journalctl -u cloudflared --since '10 min ago' --no-pager | grep -E 'ERR|Updated|config'"
# Test routes externally
curl -s -o /dev/null -w '%{http_code}' https://api.leandata.uk/health      # REST → 200
curl -s -o /dev/null -w '%{http_code}' https://leandata.uk                # Main site → 200
curl -s -o /dev/null -w '%{http_code}' https://leandata.uk/register       # Register → 200
```

---

## 4. Token portal (proxy-token-site)

ThinkCentre: `/home/mint/proxy-token-site/` (Node process, serves :3000, exposed via `token.leandata.uk`)

**Local source is split across two directories:**

| What | Local path | ThinkCentre path | Deploy method |
|---|---|---|---|
| `server.js`, `server.test.js` | `/home/kai/product-apim/proxy-token-site/` | `/home/mint/proxy-token-site/` | SCP + restart |
| `token-page.jsx`, `tokens.css` | `/home/kai/product-apim/` (docs repo root) | `/home/mint/proxy-token-site/public/` | SCP (static, no restart) |
| `docs-site.jsx`, `index.html` | `/home/kai/product-apim/` (docs repo root) | GitHub Pages (not on TC) | git push gh-pages |
| Cloud proxy (`alpaca_cloud_proxy.py`) | `/home/kai/product-apim/proxy-token-site/remote_proxy/` | TC: `~/Websocket-DataFeed-Proxy/ec2-primary-backup/` + EC2: `~/cloud-proxy/` | SCP + docker rebuild |

The parent dir `/home/kai/product-apim/` is the `ikkisovi/Websocket-DataFeed-Proxy-docs` repo (branch `gh-pages`). The `proxy-token-site/` subdir is a separate git repo nested inside it.

**Token flow (TC writes locally, syncs to EC2 for WS auth):**
```
User registers → data/pending.json (status: pending)
Admin approves → data/users.json + proxy users.json (local on TC)
User generates token → validates against data/users.json, writes to proxy users.json (local on TC)
Sync: TC users.json → SCP → EC2 users.json (so EC2 WS proxy can authenticate users)
```

**users.json sync direction: TC → EC2** (token-site on TC is the source of truth; EC2 needs a copy for WS auth). This is the REVERSE of the legacy flow (which was EC2 → TC when token-site was on EC2).

### Service tiers (5 tiers, defined in server.js)

| UI Tier | Backend Role | REST/min | WS Symbols | REST Parallel | WS Conns | Expiry | WS Access |
|---------|-------------|----------|------------|---------------|----------|--------|-----------|
| trial | standard | 60 | 50 | 5 | 3 | 3 days | all channels |
| basic | basic | 10 | 10 | 2 | 1 | 30 days | none (REST only) |
| value | value | 30 | 30 | 3 | 2 | 30 days | all channels |
| standard | standard | 60 | 100 | 5 | 3 | 30 days | all channels |
| premium | premium | 300 | 500 | 10 | inf | 30 days | all channels |

Rate limits are enforced by the cloud proxy's `RateLimiter` class based on the `role` field.

Admin: `POST /api/admin/login` with `ADMIN_PASSWORD` (default `admin123`), then `X-Admin-Token` header. Sessions are in-memory — die on restart.

**Status API** (no auth required, on ThinkCentre via `https://leandata.uk`):

| Endpoint | Method | Description |
|---|---|---|
| `/api/status` | GET | Live probe: REST proxy `/health` + WS TCP connect. Returns `overall` + per-component `status`, `latencyMs`. **Auto-detects outages** and logs incidents on state transitions. |
| `/api/uptime` | GET | 90-day daily aggregated uptime `%` arrays (rest + ws) |
| `/api/latency?range=24h\|7d\|30d` | GET | Bucketed latency time series (1h buckets, p50 per bucket) |
| `/api/incidents` | GET | List all recorded incidents (newest first, max 100) |
| `/api/incidents` | POST | Manually log an incident `{component, severity?, title, summary?, duration?}` |

Status data + incidents persisted to `data/status.json`. REST probe hits `http://localhost:8768/health` (10s timeout). WS probe does TCP connect to `52.37.182.24:8767`.

**Incident auto-detection** (runs inside `/api/status` probe):
- Server boot → logs `resolved` "Service restart"
- REST/WS probe transitions `up→down` → logs `major` outage incident
- REST/WS probe transitions `down→up` → logs `resolved` recovery incident
- Manual: `POST /api/incidents` for planned maintenance, custom events

Frontend: StatusBody is inlined in `public/docs-site.jsx` (the Status tab). Fetches `/api/incidents` on mount.

**Tests:** `server.test.js` — 14 status+incident tests covering `/api/status`, `/api/uptime`, `/api/latency`, `/api/incidents` (GET/POST, validation, cap at 100).

---

## 5. Cloud proxy — Dual Host

### ThinkCentre (REST-only)

Docker container: `ec2-primary-backup-alpaca-cloud-proxy-1`
Source: `~/Websocket-DataFeed-Proxy/ec2-primary-backup/alpaca_cloud_proxy.py`
**Env: `REST_ONLY=true`** — skips all WS upstream connections.

```bash
# On ThinkCentre
docker ps
docker logs ec2-primary-backup-alpaca-cloud-proxy-1 --tail 100
cd ~/Websocket-DataFeed-Proxy/ec2-primary-backup/
docker compose -f docker-compose.cloud-proxy.yml up -d --build
```

### EC2 (WS-only)

Docker container in `~/cloud-proxy/`
Source: `~/cloud-proxy/alpaca_cloud_proxy.py`
Port: `0.0.0.0:8767:8765` (WS only, no REST port)
Keys: 5 free Alpaca keys + master key (for key pool rotation on REST fallback)

```bash
# On EC2
docker ps
docker logs $(docker ps -q) --tail 100
cd ~/cloud-proxy/
docker-compose -f docker-compose.cloud-proxy.yml up -d --build
```

**REST endpoints** (all on ThinkCentre via `https://api.leandata.uk`, `POST`, auth via `token` in body or `Authorization: Bearer <token>`):

| Endpoint | Tier | Source |
|---|---|---|
| `/v1/history/bars` | basic+ | Alpaca |
| `/v1/history/news` | basic+ | Alpaca |
| `/v1/options/contracts` | standard+ | Alpaca |
| `/v1/options/snapshots[/ohlc\|/trade\|/quote\|/market_value]` | standard+ | Alpaca/ThetaData |
| `/v1/options/snapshots/expiry` | standard+ | Alpaca |
| `/v1/history/options/bars` | standard+ | ThetaData primary, Alpaca fallback |
| `/v1/options/open_interest` | standard+ | ThetaData |
| `/v1/options/eod` | standard+ | ThetaData |
| `/v1/crypto/us/latest/orderbooks` | premium | Alpaca |
| `/v1/history/options/trade_quote` | standard+ | ThetaData |
| `/v1/stock/history/trade_quote` | standard+ | ThetaData |
| `/health` | none | health check (returns 200) |

**WebSocket channels** (all on EC2 via `ws://52.37.182.24:8767`):
`/stream` (stocks), `/stream/options`, `/stream/overnight`, `/stream/crypto`, `/stream/news`, `/stream/boats`.
Auth: `{"action":"auth","token":"..."}`. Stocks/options/overnight/boats use msgpack; crypto/news use JSON.

---

## 6. Cache architecture (4-layer)

All REST endpoints on ThinkCentre hit layers in order:

```
Request
  → L1: in-process Python dict (MemoryRedisClient, 500 entries, 300s TTL)
  → L2: gzip JSON on NVMe (/var/cache/alpaca, 30GB budget, tiered TTL via disk_cache.py)
      archive dual-write → /mnt/data/cache/archive/{stocks,options}/{type}/{symbol}/date.json.gz
  → L3: TimescaleDB (local PostgreSQL 16 + TimescaleDB 2.27.1)
      query_bars / query_options_bars — returns X-Cache: DB_HIT
  → Upstream: Alpaca REST / ThetaData SDK
In-flight coalescing (asyncio.Future) prevents duplicate upstream calls.
```

**TTL tiers** (disk_cache.py `ENDPOINT_TTL`):
- `/v1/options/eod`, `/v1/history/options/bars` historical: **7 days**
- Same endpoints with `end=today`: **60s**
- `/v1/options/snapshots[/*]`: **300s**
- `/v1/options/contracts`, `/v1/options/open_interest`: **3600s**
- `/v1/history/news`: **300s**

**EOD alias fix** (2026-05-26): `/v1/options/eod` and `/v1/history/options/eod` now share a single cache namespace (canonical key = `/v1/options/eod`).

**TimescaleDB tables** (DB-first mode active, `DB_ENABLED=true`):
| Table | Rows | Coverage |
|---|---|---|
| `bars` | ~134M | 2021-01-04 → present |
| `options_bars` | ~34M | 2024-05-27 → present |
| `option_contracts` | ~9K | — |
| `latest_quotes` | — | realtime upsert |
| `news` | — | not yet populated |

**DB connection** (from host): `localhost:5432`, user `proxy`, db `marketdata`. From Docker network: hostname `timescaledb`.

---

## 7. Cache warmers

Two separate tools with different purposes:

### smart_warmer_v2.py — Nightly HTTP cache warmer (CURRENTLY IN CRONTAB)

Warms the **disk cache** (L2) by replaying hot pairs from audit.jsonl + baseline tickers via HTTP proxy calls. Does NOT write to DB directly.

```bash
cd ~/Websocket-DataFeed-Proxy/ec2-primary-backup
python3 smart_warmer_v2.py --token test123 --audit-file audit.jsonl --rate 3.0
python3 smart_warmer_v2.py --token test123 --audit-file audit.jsonl --dry-run
```

Cron: `0 23 * * *` daily — `warmer_v2.log`

### smart_warmer_v4.py — Full universe DB backfill (run manually / on-demand)

Backfills **TimescaleDB directly** — bars (Alpaca API), quotes (proxy→ThetaData), options bars (proxy→ThetaData). Checks existing DB coverage and only fetches missing date ranges. Does NOT warm disk cache.

```bash
cd ~/Websocket-DataFeed-Proxy/ec2-primary-backup
# bars only (all lean+ndx100+sp500 symbols, 2yr):
TIMESCALEDB_HOST=localhost python3 smart_warmer_v4.py --token test123 --data-types bars --dry-run

# options backfill:
TIMESCALEDB_HOST=localhost python3 smart_warmer_v4.py --token test123 \
  --data-types options --options-underlyings SPX,NDX,QQQ,SPY --options-max-dte 730

# full backfill (bars + quotes + options):
TIMESCALEDB_HOST=localhost python3 smart_warmer_v4.py --token test123 --data-types bars,quotes,options
```

**Note:** v4 uses `TIMESCALEDB_HOST=localhost` when run from host (outside Docker). Symbol sources: lean universe (73 symbols, highest priority) + NASDAQ-100 + S&P 500.

### eod_from_bars.py — CPU-side EOD cache synthesizer

Transforms a `/v1/history/options/bars?timeframe=1Day` response into `/v1/options/eod` disk cache entries — eliminates the separate ThetaData call during warming.

```python
from eod_from_bars import bars_to_eod_cache
stats = bars_to_eod_cache(occ_symbols, start, end, bars_response, cache_dir="/var/cache/alpaca")
```

---

## 8. Docs site

- Repo: `ikkisovi/Websocket-DataFeed-Proxy-docs` (branches: `gh-pages` = docs, `main` = full codebase)
- Local clone: `/home/kai/product-apim/` (this is the docs repo root)
- Source: `/home/kai/product-apim/docs-site.jsx` (React CDN, Babel in-browser)
- Status page: `status-body.jsx` (uptime grid, latency chart, incident log — uses `/api/status`, `/api/uptime`, `/api/latency`)
- HTML shell: `/home/kai/product-apim/index.html` (loads docs-site.jsx)
- Docs HTML: `public/docs/index.html` (loads status-body.jsx + docs-site.jsx)
- GitHub Pages: `https://ikkisovi.github.io/Websocket-DataFeed-Proxy-docs/`
- Token portal (TC): `https://leandata.uk` serves the same docs via `public/docs/`
- Codebase pushed to both `gh-pages` and `main` branches

---

## 9. Cloudflare Tunnel Operations

`cloudflared` runs as a systemd service on ThinkCentre, remotely managed (no local config.yml).

```bash
# Status
sudo systemctl status cloudflared

# Logs (look for ERR, config updates)
sudo journalctl -u cloudflared -f
sudo journalctl -u cloudflared --since "10 min ago" | grep -E "ERR|Updated|config"

# Restart (resets all 4 edge connections)
sudo systemctl restart cloudflared

# Reinstall (if token changes)
sudo cloudflared service install <NEW_TOKEN>
```

Route changes are made in Cloudflare Dashboard → Zero Trust → Networks → Tunnels → Public Hostnames. Changes propagate to `cloudflared` within ~30s (logged as "Updated to new configuration").

**Known behavior:** `cloudflared` maintains 4 parallel connections to Cloudflare edge. Occasional `control stream failure` on one connector is normal — it auto-retries. If all 4 fail, check home internet or restart the service.

---

## 10. Quick reference paths

| Thing | Local | ThinkCentre | EC2 |
|---|---|---|---|
| Docs repo root (gh-pages) | `/home/kai/product-apim/` | — | — |
| `docs-site.jsx` | `/home/kai/product-apim/docs-site.jsx` | — (GitHub Pages) | — |
| `token-page.jsx` | `/home/kai/product-apim/token-page.jsx` | `public/token-page.jsx` | — |
| `tokens.css` | `/home/kai/product-apim/tokens.css` | `public/tokens.css` | — |
| `server.js` / `server.test.js` | `/home/kai/product-apim/proxy-token-site/` | `/home/mint/proxy-token-site/` | — |
| Cloud proxy code | `remote_proxy/alpaca_cloud_proxy.py` | `~/Websocket-DataFeed-Proxy/ec2-primary-backup/` | `~/cloud-proxy/` |
| Token registry (proxy) | — | `~/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json` | `~/cloud-proxy/users.json` |
| Hot disk cache | — | `/var/cache/alpaca/` (NVMe, 30GB) | — |
| Archive (durable) | — | `/mnt/data/cache/archive/` | — |
| TimescaleDB data | — | `/home/mint/postgresql-data/` | — |
| DB init schema | — | `~/Websocket-DataFeed-Proxy/ec2-primary-backup/init_db.sql` | — |
| Nightly warmer | — | `ec2-primary-backup/smart_warmer_v2.py` (cron 23:00) | — |
| Full backfill | — | `ec2-primary-backup/smart_warmer_v4.py` (manual) | — |
| EOD synthesizer | — | `ec2-primary-backup/eod_from_bars.py` | — |
| Archive migrator | — | `ec2-primary-backup/archive_to_db.py` | — |
| Options cache tests | — | `ec2-primary-backup/test_options_cache.py` | — |
| EC2 SSH key | `/tmp/ec2_ed25519.pem` | — | — |

## 11. Important Notes

- ThinkCentre SSH via Tailscale: `ssh mint@100.70.107.106`
- EC2 SSH: `ssh -i /tmp/ec2_ed25519.pem ec2-user@52.37.182.24`
- `cloudflared` is a systemd service — survives reboots automatically
- `server.js` exports `{ app, TIERS, syncToEC2, computeExpiry, readJSON, writeJSON }`
- ThinkCentre proxy runs `REST_ONLY=true` — no WS upstream connections
- EC2 proxy runs WS-only — port 8767 exposed, no REST port
- users.json sync: TC → EC2 (token-site on TC is source of truth)
- EC2 uses `docker-compose` (hyphenated legacy), TC uses `docker compose` (plugin)
- Tests use isolated temp dirs — safe to run anywhere
- Domain `leandata.uk` DNS is managed by Cloudflare (nameservers pointed to CF)
- **DB_ENABLED=true** in `ec2-primary-backup/.env` — proxy is in DB-first mode (`X-Cache: DB_HIT`)
- TimescaleDB container: `timescaledb` (same Docker network as proxy, hostname `timescaledb`)
- From host outside Docker: `TIMESCALEDB_HOST=localhost` for warmer/migration scripts
- smart_warmer_v2 = HTTP disk cache warmer (nightly cron); smart_warmer_v4 = direct DB backfill (manual)
- **crontab still runs v2** — v4 is not yet scheduled; run v4 manually for full DB gap fills
