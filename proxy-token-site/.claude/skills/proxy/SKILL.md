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
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│ PUBLIC INTERNET                                                                               │
│                                                                                               │
│   Main site:    https://leandata.uk        → CF Tunnel → TC localhost:3000                    │
│     /           docs (API reference)                                                          │
│     /register   user registration                                                             │
│     /admin      admin panel                                                                   │
│     /api/*      token API                                                                     │
│   REST API:     https://api.leandata.uk    → CF Tunnel → TC localhost:8768  (historical/cache)│
│   RT REST API:  https://rt-api.leandata.uk → CF Tunnel → EC2 localhost:8768  (real-time)      │
│   WebSocket:    ws://52.37.182.24:8767/*   → EC2 proxy direct (AWS internal to Alpaca)        │
└───────────────┬──────────────────────────────────────┬────────────────────────────────────────┘
                │ CF Tunnels (2)                         │ Direct TCP
                ▼                                        ▼
┌──────────────────────────────────────────┐  ┌──────────────────────────────────────────────────┐
│ ThinkCentre  tailscale 100.70.107.106    │  │ EC2  ip 52.37.182.24  (us-west-2)               │
│ user: mint                               │  │ user: ec2-user                                   │
│                                          │  │                                                  │
│  :8768 ─ Docker: alpaca_cloud_proxy.py   │  │  :8767 ─ Docker: alpaca_cloud_proxy.py           │
│          REST_ONLY=true (no WS upstream) │  │          WS + REST (real-time endpoints)          │
│          Alpaca + ThetaData upstream     │  │          5 free keys + master key                 │
│          Connection pool: 100/30 per host│  │          Connection pool: 100/30 per host         │
│  :3000 ─ Node: proxy-token-site          │  │          Connects direct to Alpaca WS             │
│          (Express: docs + register +     │  │          Alpaca upstream: 200ms (vs TC 351ms cold)│
│           admin + token API)             │  │                                                  │
│  :5432 ─ Docker: TimescaleDB            │  │  users.json ← SCP from ThinkCentre               │
│                                          │  │                                                  │
│  cloudflared ─ systemd (api.leandata.uk) │  │  cloudflared ─ systemd (rt-api.leandata.uk)      │
│  Disk cache: /mnt/data/cache/ (NVMe L2)  │  │  REST on :8768, WS on :8767                      │
│  users.json ← token-site writes locally  │  └──────────────────────────────────────────────────┘
└──────────────────────────────────────────┘
```

**Endpoint routing**: `api.leandata.uk` for historical/cacheable data (bars, EOD, contracts, news). `rt-api.leandata.uk` for real-time data (snapshots, crypto orderbooks) when EC2's faster upstream latency matters. Both support GET and POST.

### Why hybrid?
- **REST on TC**: Free via Cloudflare, disk cache on NVMe, ThetaData + TimescaleDB local. **Edge cache** (L0) on CF POP eliminates tunnel round-trip for repeat queries — `override_origin` with 7-day TTL, GET-only.
- **WS on EC2**: Benchmarked p50 33.5ms vs TC's 58.6ms — AWS internal network to Alpaca is faster and more stable for real-time streaming. Alpaca has **no** single-endpoint limit, so Alpaca snapshots/WS can safely live on EC2. (The single-endpoint subscription constraint is **ThetaData's**, not Alpaca's — see Constraints.)
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
# 0. PRE-DEPLOY GUARD: verify no local dev paths leaked into server.js
grep -n 'PROXY_USERS_FILE\|EC2_SSH_KEY' server.js
# MUST show TC paths: '/home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json'
#                     '/home/mint/.ssh/ec2_ed25519.pem'
# NOT: 'remote_proxy/users.json' or '/home/kai/.ssh/id_ed25519'
# ⚠️  Incident 2026-05-27: wrong paths caused 30-user auth outage

# 1. Push server files to ThinkCentre
scp ./server.js mint@100.70.107.106:/home/mint/proxy-token-site/server.js
scp ./server.test.js mint@100.70.107.106:/home/mint/proxy-token-site/server.test.js

# 2. Run tests (STOP if they fail — do NOT restart)
ssh mint@100.70.107.106 "export PATH=/home/mint/.local/opt/node-v22.22.2-linux-x64/bin:\$PATH && cd /home/mint/proxy-token-site && npx jest --no-cache 2>&1"

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

### Docs/Usage Deploy (no restart needed)

```bash
# Deploy to public/docs/ (standalone docs site)
scp ./public/docs/docs-site.jsx mint@100.70.107.106:/home/mint/proxy-token-site/public/docs/docs-site.jsx
scp ./public/docs/usage-page.jsx mint@100.70.107.106:/home/mint/proxy-token-site/public/docs/usage-page.jsx
scp ./public/docs/status-body.jsx mint@100.70.107.106:/home/mint/proxy-token-site/public/docs/status-body.jsx
# ⚠️  MUST sync to public/ root too (token page index.html loads from there):
ssh mint@100.70.107.106 "cp /home/mint/proxy-token-site/public/docs/{docs-site,usage-page,status-body}.jsx /home/mint/proxy-token-site/public/"
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
ssh mint@100.70.107.106 "scp -i /home/mint/.ssh/ec2_ed25519.pem /home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json ec2-user@52.37.182.24:/home/ec2-user/cloud-proxy/users.json"
# Or from local machine if TC→EC2 SCP isn't set up:
ssh mint@100.70.107.106 "cat /home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json" | ssh -i /tmp/ec2_ed25519.pem ec2-user@52.37.182.24 "cat > /home/ec2-user/cloud-proxy/users.json"
# Verify on EC2
ssh -i /tmp/ec2_ed25519.pem ec2-user@52.37.182.24 "python3 -c \"import json;d=json.load(open('/home/ec2-user/cloud-proxy/users.json'));print(len(d['users']),'users synced')\""
```

### Built-in Prevention Guards & Sync-Verify (Added 2026-05-27)

To ensure high availability and prevent sync/path config anomalies (like writing to dev fallbacks or breaking TC-EC2 connection), we have implemented 4 safeguards and an E2E testing framework:

1. **Startup Path Guard**: On boot, server.js automatically checks if it is running on the ThinkCentre (checks if `/home/mint` exists) and throws a loud warning if `PROXY_USERS_FILE` or `EC2_SSH_KEY` points to a local developer fallback path.
2. **Post-Write Verification**: After every write to `PROXY_USERS_FILE` via `writeProxyUsersAndSyncAsync()`, the portal reads the file back from disk to verify the active user count exactly matches the in-memory/database registry. Returns `{ ok: false }` if a mismatch is detected.
3. **Admin User Deletion (`POST /api/admin/delete-user`)**: Completely cleans up a user by removing them from all 3 token portal registries (local `users.json`, `pending.json`, and `PROXY_USERS_FILE`) and triggers an automatic SSH sync to update the EC2 WebSocket registry.
4. **SSH Sync Verification (`GET /api/admin/sync-verify`)**: Remotely queries the EC2 primary instance via SSH to read its active `/home/ec2-user/cloud-proxy/users.json`, diffs it against the ThinkCentre's database of approved users, and returns lists of `missingOnEC2` and `extraOnEC2` to guarantee total network-wide consistency.

#### End-to-End Test Suite (`test_e2e.js`)
Verify the entire topology, authentication, key picker routing, and sync operations in 5 phases:
- **Phase 1: Sync check** — calls `/api/admin/sync-verify` to ensure TC and EC2 registries match.
- **Phase 2: Token health** — loops through all active approved users, generates tokens, and performs a live query on `/v1/history/bars` to verify the token is accepted.
- **Phase 3: Registration** — registers 6 test users (representing trial, basic, value/stocks, value/options, standard, premium tiers) and approves them.
- **Phase 4: Permission Matrix** — runs live validation across 6 distinct REST data routes (stocks/options/crypto/news) for all tiers, asserting correct allow/deny responses based on service limits.
- **Phase 5: Cleanup** — deletes all generated test users using `/api/admin/delete-user` and verifies no trace of them remains on either TC or EC2.

**Running the E2E Test:**
```bash
# From local developer machine (authenticates via SSH to TC):
node test_e2e.js

# Running directly on the ThinkCentre origin host:
DIRECT=true node test_e2e.js
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
| `docs-site.jsx`, `usage-page.jsx`, `status-body.jsx`, `index.html` | `/home/kai/product-apim/proxy-token-site/public/docs/` | `/home/mint/proxy-token-site/public/docs/` | SCP (static, no restart) |
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
| `/api/status` | GET | Live probe: REST + RT + WS (3 components). Returns `overall` + per-component `status`, `latencyMs`. **Auto-detects outages** on state transitions. |
| `/api/uptime` | GET | 90-day daily aggregated uptime `%` arrays (rest, rt, ws) |
| `/api/latency?range=24h\|7d\|30d` | GET | Bucketed latency time series (1h buckets, p50 per bucket) for all 3 components |
| `/api/incidents` | GET | List all recorded incidents (newest first, max 100) |
| `/api/incidents` | POST | Manually log an incident `{component, severity?, title, summary?, duration?}` |

Status probes (3 components):
- **REST**: `GET http://localhost:8768/health` (10s timeout) — TC proxy
- **RT**: `GET ${PROXY_RT_URL}/health` via Node `https` + a **shared keep-alive agent** (10s timeout) — `rt-api.leandata.uk` (EC2 via CF tunnel)
- **WS**: TCP connect to `52.37.182.24:8767` (5s timeout) — EC2 direct

Latency is only recorded when probe succeeds (`probe.ok === true`) — prevents timeout durations from polluting latency data.

**RT probe keep-alive (fixed 2026-06-03):** `probeRt()` uses a shared `https.Agent({keepAlive})` + a 25s background heartbeat (`setInterval` in the `require.main` block, `.unref()`'d). Without it, each periodic probe cold-handshaked a fresh TLS connection to the CF edge → RT showed ~265ms while REST (localhost, no TLS) and WS (bare TCP) showed single/tens of ms — a pure measurement artifact, NOT EC2/upstream slowness (CF edge is always `cf-cache-status: HIT` on `/health`). Warm reused socket → RT measures its real ~30-40ms. **Don't "fix" the high RT number by moving rt-api off EC2** — the EC2 placement wins on cache-MISS upstream latency to Alpaca (~850ms vs TC ~1100ms).

Status data + incidents persisted to `data/status.json`. Migration guard: `if (!statusData.latency.rt) statusData.latency.rt = [];` for backward compat from 2-component to 3-component.

**Incident auto-detection** (runs inside `/api/status` probe):
- Server boot → logs `resolved` "Service restart"
- REST/RT/WS probe transitions `up→down` → logs `major` outage incident
- REST/RT/WS probe transitions `down→up` → logs `resolved` recovery incident
- Manual: `POST /api/incidents` for planned maintenance, custom events

Frontend: StatusBody + LatencyChart inlined in `public/docs/docs-site.jsx` (the Status tab). LatencyChart renders 3 series (rest=blue, rt=green-teal, ws=amber). Component grid is 3-column.

**Usage API** (on ThinkCentre via `https://leandata.uk`, auth by username):

| Endpoint | Method | Description |
|---|---|---|
| `/api/usage/audit?username=X&limit=N` | GET/POST | Proxies to cloud proxy `/v1/admin/audit`. Resolves username→token from proxy `users.json`, forwards with token in POST body. Returns `{total, returned, events}`. |
| `/api/usage/stats?username=X` | GET/POST | Proxies to cloud proxy `/v1/admin/stats`. Same username→token resolution. Returns `{user_id, user_stats, all_user_stats, system}`. |

`resolveUserToken(username)` reads `PROXY_USERS_FILE`, finds `user_id === username`, returns the token. The proxy's `handle_audit_request` extracts token from JSON body (NOT Authorization header when body is valid JSON).

Frontend: `public/docs/usage-page.jsx` — the "Usage" tab in docs-site.jsx. User enters their username (persisted in `localStorage` as `usage-username`), fetches from `/api/usage/audit` and `/api/usage/stats`. Aggregates audit events into daily charts (REST volume, cache hit/miss, WS subscriptions) + recent events table. Falls back to mock data when no real events found.

**Tests:** `server.test.js` — 60 tests. Test env sets `PROXY_RT_URL=http://127.0.0.1:1`, `PROXY_WS_HOST=127.0.0.1`, `PROXY_WS_PORT=1`, `BYPASS_SYNC=true` for fast probe failure + no SCP in tests.

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

## 6. Cache architecture (5-layer)

All REST endpoints on ThinkCentre hit layers in order:

```
Request
  → L0: Cloudflare Edge Cache (POP-level, override_origin, 604800s TTL)
      cf-cache-status: HIT → response served directly from nearest POP (5-23ms)
      cf-cache-status: MISS → request proceeds through tunnel to origin
  → L1: in-process Python dict (MemoryRedisClient, 500 entries, 300s TTL)
  → L2: gzip JSON on NVMe (/var/cache/alpaca, 30GB budget, tiered TTL via disk_cache.py)
      archive dual-write → /mnt/data/cache/archive/{stocks,options}/{type}/{symbol}/date.json.gz
  → L3: TimescaleDB (local PostgreSQL 16 + TimescaleDB 2.27.1)
      query_bars / query_options_bars — returns X-Cache: DB_HIT
  → Upstream: Alpaca REST / ThetaData SDK
In-flight coalescing (asyncio.Future) prevents duplicate upstream calls.
```

**Edge cache (L0)** is GET-only — CF doesn't cache POST by default. The proxy exposes GET handlers for all data endpoints: `/v1/history/bars`, `/v1/history/options/bars`, `/v1/options/eod`, `/v1/options/snapshots/*`, `/v1/options/contracts`, `/v1/history/news`, `/v1/crypto/us/latest/orderbooks`, `/v1/stock/history/trade_quote`, `/v1/history/options/trade_quote`. Clients should use GET with query params for cacheable endpoints.

**Connection pooling** (added 2026-05-26): All upstream HTTP calls use a shared `aiohttp.ClientSession` via `get_http_session()` with `TCPConnector(limit=100, limit_per_host=30, ttl_dns_cache=300)`. Eliminates per-request TCP+TLS overhead (~200ms savings on warm connections).

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
- Status page: StatusBody + LatencyChart inlined in `docs-site.jsx` (3-component: REST, RT, WS)
- Usage page: `usage-page.jsx` — per-user usage dashboard (auth by username, charts + audit table)
- HTML shell: `/home/kai/product-apim/index.html` (loads docs-site.jsx)
- Docs HTML: `public/docs/index.html` (loads status-body.jsx + usage-page.jsx + docs-site.jsx)
- GitHub Pages: `https://ikkisovi.github.io/Websocket-DataFeed-Proxy-docs/`
- Token portal (TC): `https://leandata.uk` serves the same docs via `public/docs/`
- Codebase pushed to both `gh-pages` and `main` branches
- **Tabs**: Proxy API | WS usage | Status (live 3-component) | Usage (per-user, 30d)

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

## 9b. Latency Optimization (measured 2026-05-26)

### SLA Targets
- **REST:** TTFB p99 < 100ms for 1yr daily bars
- **WS:** End-to-end p99 < 20ms (ingestion to client delivery)

### Baseline Measurements (2026-05-26)

| Path | p50 | p95 | p99 | Notes |
|------|-----|-----|-----|-------|
| REST localhost:8768 (on TC) | **0.8ms** | 1.1ms | **1.9ms** | Proxy itself is sub-1ms (orjson + uvloop + L1 dict cache) |
| REST via Cloudflare (pre-cache) | 38ms | 96ms | **636ms** | ❌ Tunnel overhead + spikes |
| REST via CF edge cache HIT | ~23ms | ~30ms | **<30ms** | ✅ POP-level cached, no tunnel round-trip |
| WS EC2 proxy (after-hours) | sub-ms/msg | — | — | Proxy overhead negligible |

### Primary Bottleneck: Cloudflare Tunnel (~37ms median)

The proxy returns cache HITs in 0.8ms. All REST latency comes from the Cloudflare Tunnel network round-trip: `Client → CF Edge → Tunnel → TC → response → Tunnel → CF Edge → Client`.

### What Was Implemented

**Proxy-side (alpaca_cloud_proxy.py):**
1. **Cache-Control headers on REST responses** — `max-age=604800` (7 days) for historical bars, `max-age=60` for intraday. Added to `_log_and_return()`, `_return_cached_raw()`, and global `respond_cached_raw()`.
2. **GET handlers for ALL data endpoints** — Cloudflare doesn't cache POST. Added `request.method == "GET"` branch + `app.router.add_get()` for: bars, options bars, eod, snapshots (all variants), contracts, news, crypto orderbooks, trade_quote.
3. **`from datetime import date`** added to top-level imports for CDN TTL computation.
4. **Connection pooling** — Replaced 12 per-request `aiohttp.ClientSession()` with shared `get_http_session()`. Uses `TCPConnector(limit=100, limit_per_host=30, ttl_dns_cache=300)`. Saves ~200ms per warm upstream call.

**Infrastructure:**
5. **EC2 REST port exposed** — Docker compose updated: `8768:8766` alongside `8767:8765`.
6. **Cloudflare tunnel on EC2** — `rt-api.leandata.uk` → EC2 `localhost:8768`. Tunnel ID: `83625723-5d1d-4e41-8358-2f9d5c1bb27d`. Systemd service: `cloudflared`.

**Cloudflare-side (API config):**
7. **Cache Rule (api.leandata.uk)** — Ruleset `7890ae112a864415b6d5aa5432813bf5`, rule `091d42a7eb6a4983854ebd7ca4676b01`:
   - `set_cache_settings` with `edge_ttl: override_origin, default: 604800` (7 days)
   - Matches: `api.leandata.uk` + paths `/v1/history/*`, `/v1/options/*`, `/health`
   - `cf-cache-status: HIT` verified
8. **Cache Rule (rt-api.leandata.uk)** — rule `5b129803ec5246bbbf164d861beaddb3`:
   - `set_cache_settings` with `edge_ttl: override_origin, default: 60` (60 seconds)
   - Matches: `rt-api.leandata.uk` + paths `/v1/history/*`, `/v1/options/*`, `/v1/crypto/*`, `/v1/stock/*`, `/health`
   - `cf-cache-status: HIT` verified

### Edge Cache Behavior
```
Client → CF POP (nearest) → cached response (~5-10ms from US-East, ~23ms from Vancouver)
                        ↓ only on MISS (first request or TTL expiry)
                        Tunnel → TC proxy → DB (TimescaleDB) → response cached at POP
```

### Upstream Latency (with connection pooling)
| Host | Cold (new TCP+TLS) | Warm (pooled) | Notes |
|---|---|---|---|
| TC → Alpaca | ~351ms | ~150ms | TELUS residential → Alpaca (Virginia) |
| EC2 → Alpaca | ~200ms | ~100ms | AWS backbone → Alpaca |

### Endpoint Routing (api vs rt-api)
- **api.leandata.uk** (TC): Historical bars, EOD, contracts, news — edge-cacheable, DB-first
- **rt-api.leandata.uk** (EC2): Snapshots, crypto orderbooks — real-time, EC2's faster upstream
- Cache HIT: TC faster (~230ms vs ~270ms due to tunnel overhead difference)
- Cache MISS: EC2 faster (~850ms vs ~1100ms due to upstream latency)

### Constraints
- **ThetaData can only subscribe/connect from 1 endpoint** → ThetaData runs on a single host (TC). Alpaca has NO such limit — Alpaca WS/snapshots stay on EC2 purely for the latency win above, not a key constraint.
- TC runs `REST_ONLY=true` → no WS upstream
- ThinkCentre behind NAT (TELUS residential) → no direct external access
- Cloudflare Free plan → Cache Rules available (up to 10)
- `bypass_by_default` mode still routes through tunnel for freshness checks → use `override_origin`
- EC2 cloudflared tunnel: separate from TC tunnel, independent lifecycle

### Benchmarks
```bash
# REST TTFB benchmark (run on ThinkCentre)
ssh mint@100.70.107.106 "cd /home/mint/proxy-token-site && BENCH_TOKEN=<token> python3 bench_rest.py"

# WS latency benchmark (run on ThinkCentre)
ssh mint@100.70.107.106 "cd /home/mint/proxy-token-site && ALPACA_KEY=<key> ALPACA_SECRET=<secret> EC2_TOKEN=<token> python3 bench_ws.py"

# Quick CF edge cache verification
curl -s -D - "https://api.leandata.uk/v1/history/bars?token=TOKEN&symbol=AAPL&start=2025-01-01&end=2025-12-31&timeframe=1Day&limit=10" 2>&1 | grep cf-cache-status
```

### CF Cache Rule Management
```bash
# Verify rule exists
curl -s "https://api.cloudflare.com/client/v4/zones/e27a171bec65736ad1d24dbc65573bd3/rulesets" \
  -H "X-Auth-Email: ikkipipii@gmail.com" -H "X-Auth-Key: <GLOBAL_API_KEY>" | python3 -c "import json,sys; [print(r['name'],r['id'],r['phase']) for r in json.load(sys.stdin).get('result',[]) if 'cache' in r.get('phase','')]"

# Purge all cache
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/e27a171bec65736ad1d24dbc65573bd3/purge_cache" \
  -H "X-Auth-Email: ikkipipii@gmail.com" -H "X-Auth-Key: <GLOBAL_API_KEY>" \
  -H "Content-Type: application/json" -d '{"purge_everything":true}'
```

---

## 10. Quick reference paths

| Thing | Local | ThinkCentre | EC2 |
|---|---|---|---|
| Docs repo root (gh-pages) | `/home/kai/product-apim/` | — | — |
| `docs-site.jsx` | `proxy-token-site/public/docs/docs-site.jsx` | `public/docs/docs-site.jsx` | — |
| `usage-page.jsx` | `proxy-token-site/public/docs/usage-page.jsx` | `public/docs/usage-page.jsx` | — |
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
| Benchmarks | `proxy-token-site/bench_rest.py`, `bench_ws.py` | same (SCP'd) | — |

## 11. Important Notes

- ThinkCentre SSH via Tailscale: `ssh mint@100.70.107.106`
- EC2 SSH: `ssh -i /tmp/ec2_ed25519.pem ec2-user@52.37.182.24`
- `cloudflared` is a systemd service on BOTH TC and EC2 — survives reboots
- TC cloudflared tunnel: `api.leandata.uk` → TC:8768 (tunnel ID `5a12e8d8-ca2c-4d9c-9a1c-259f3e849d86`)
- EC2 cloudflared tunnel: `rt-api.leandata.uk` → EC2:8768 (tunnel ID `83625723-5d1d-4e41-8358-2f9d5c1bb27d`)
- `server.js` exports `{ app, TIERS, syncToEC2, computeExpiry, readJSON, writeJSON }`
- ThinkCentre proxy runs `REST_ONLY=true` — no WS upstream connections
- EC2 proxy runs WS + REST — ports 8767 (WS) and 8768 (REST) exposed
- **Connection pooling**: All upstream HTTP calls use shared `get_http_session()` with `TCPConnector(limit=100, limit_per_host=30)`. Saves ~200ms per warm Alpaca call.
- users.json sync: TC → EC2 (token-site on TC is source of truth)
- EC2 uses `docker-compose` (hyphenated legacy), TC uses `docker compose` (plugin)
- Tests use isolated temp dirs — safe to run anywhere
- Domain `leandata.uk` DNS is managed by Cloudflare (nameservers pointed to CF)
- **DB_ENABLED=true** on TC — proxy is in DB-first mode (`X-Cache: DB_HIT`). EC2 has no DB.
- TimescaleDB container: `timescaledb` (same Docker network as proxy, hostname `timescaledb`)
- From host outside Docker: `TIMESCALEDB_HOST=localhost` for warmer/migration scripts
- smart_warmer_v2 = HTTP disk cache warmer (nightly cron); smart_warmer_v4 = direct DB backfill (manual)
- **crontab still runs v2** — v4 is not yet scheduled; run v4 manually for full DB gap fills
- **CF edge cache active** — Two cache rules: `api.leandata.uk` with 604800s (7d) TTL, `rt-api.leandata.uk` with 60s TTL. Both use `override_origin`. `cf-cache-status: HIT` = served from POP. GET requests required.
- **GET routes on ALL data endpoints** — snapshots, crypto, trade_quote, news, contracts all support GET for CF edge caching.
- **CF API auth:** email `ikkipipii@gmail.com`, zone ID `e27a171bec65736ad1d24dbc65573bd3`, Cache Ruleset ID `7890ae112a864415b6d5aa5432813bf5`
- **Single-endpoint constraint is ThetaData's, NOT Alpaca's:** ThetaData can only subscribe/connect from one endpoint, so it runs on a single host (TC). Alpaca keys have no such limit — Alpaca WS/snapshots stay on EC2 for latency, not a constraint. REST keys are independent per host (each has own master key).
- **Usage API**: `/api/usage/audit?username=X` and `/api/usage/stats?username=X` — resolves username→token server-side via `resolveUserToken()` reading `PROXY_USERS_FILE`, then forwards to cloud proxy with token in POST body (NOT Authorization header — proxy reads token from body when JSON is valid)
- **Usage page**: `public/docs/usage-page.jsx` — "Usage" tab in docs-site.jsx. Auth by username (localStorage key `usage-username`). Shows 30d daily charts + audit events table.
- **PITFALL — dual docs-site.jsx copies**: `public/docs-site.jsx` (root, loaded by `index.html` for the token page) and `public/docs/docs-site.jsx` (loaded by `docs/index.html` for the standalone docs). **Both must be identical.** After editing `public/docs/docs-site.jsx`, always sync: `cp public/docs/docs-site.jsx public/docs-site.jsx` on TC. Same applies to `usage-page.jsx` and `status-body.jsx` — they exist in both `public/` and `public/docs/`.
- **PITFALL — DocsSite topbar duplication**: The token page (`index.html`) renders `<TokenTopbar>` + `<DocsSite>`. DocsSite must receive `hideTopbar={true}` when embedded in the token page to avoid a duplicate nav row. The `hideTopbar` prop controls this (not the old `isEmbedded` iframe check).
- **Status probes (3 components)**: REST (localhost:8768), RT (rt-api.leandata.uk), WS (TCP 52.37.182.24:8767). Latency only recorded on success. Env vars: `PROXY_RT_URL`, `PROXY_WS_HOST`, `PROXY_WS_PORT`.
- **Test env vars**: `PROXY_RT_URL=http://127.0.0.1:1`, `PROXY_WS_HOST=127.0.0.1`, `PROXY_WS_PORT=1`, `BYPASS_SYNC=true` — ensures all probes fail fast and no SCP runs in tests.
- **TC node PATH**: `export PATH=/home/mint/.local/opt/node-v22.22.2-linux-x64/bin:$PATH` needed before `npx`/`node` commands via SSH
- **LAN IP:** ThinkCentre LAN `10.218.77.110` (direct access at <2ms when on same network)
- **CF traffic accumulator (added 2026-06-03):** `/home/mint/cf-traffic/cf_traffic_log.py` on TC. Daily cron `35 0 * * *` queries CF GraphQL `httpRequests1dGroups` (zone `e27a171...`) for the `bytes` (egress) + `requests` of the **last 7 days** (dedup-append → self-heals if a night's run hits a transient DNS/network blip, as happened 2026-06-04 00:35), writes to `daily.jsonl`, prints rolling-30d GB + **Argo Smart Routing** cost estimate ($5/mo + $0.10/GB) to `cf_traffic.log`. One-shot: `python3 cf_traffic_log.py --backfill 30` (CF free plan retains ~8 days). Creds in `/home/mint/.cf_creds` (600: `CF_EMAIL`/`CF_KEY`) — swap to a scoped Analytics:Read token, script unchanged. Baseline 2026-06-03: ~3.2 GB/mo, ~495k req/mo → Argo ≈ $5.32/mo (per-GB negligible). NOTE: dataset field is `bytes`, NOT `edgeResponseBytes` (latter is adaptive-groups only).
