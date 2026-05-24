---
name: proxy
description: "Full architecture context + deploy/ops for the Alpaca data proxy service — EC2 token site, ThinkCentre cloud proxy, Caddy bridge, cache layers, warmer, and ops access. Use when working on, debugging, deploying, or asking questions about any part of the proxy system. Also triggers on /proxy, deploy, push, sync, restart PM2, register page, users.json, ThinkCentre, cloud-proxy."
argument-hint: "[topic or subcommand: server|page|test|sync|status|cache|ssh|deploy]"
---

# Alpaca Data Proxy — System Skill

This skill loads the complete architecture context for the proxy stack so you can operate, debug, and modify it without re-explanation.

**If the user passed a topic argument ($ARGUMENTS), focus first on that section** (e.g. `/proxy cache`, `/proxy deploy`, `/proxy ssh`, `/proxy sync`). Otherwise present a brief index and wait for a specific question.

---

## 1. Topology

Two physical hosts, Tailscale mesh. **EC2 does NOT run its own cloud-proxy — it forwards everything to ThinkCentre via Caddy.**

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
│           auto-SCPs users.json → ThinkCentre on approve/generate     │
│                                                                      │
│   :8767 ─ Caddy ──→ 100.70.107.106:8767  (WS → ThinkCentre)         │
│   :8768 ─ Caddy ──→ 100.70.107.106:8768  (REST → ThinkCentre)       │
│           OPTIONS preflight returns 204 locally; CORS headers added  │
│                                                                      │
│   (No local cloud-proxy container — killed 2026-05-23)               │
└──────────────────────────────────────────────────────────────────────┘
                       │ Tailscale
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│ ThinkCentre  tailscale 100.70.107.106  user: mint                    │
│                                                                      │
│   :8767/:8768 ─ Docker: alpaca_cloud_proxy.py                        │
│           THE live public-facing proxy (Alpaca + ThetaData upstream) │
│           Reads /app/users.json (volume-mounted from host)           │
│           Source: ~/Websocket-DataFeed-Proxy/ec2-primary-backup/     │
│                                                                      │
│   users.json: ~/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json│
│   Disk cache: /mnt/data/cache/ (100GB budget)                        │
└──────────────────────────────────────────────────────────────────────┘
```

**Key rule:** "the proxy" = **ThinkCentre proxy** (public-facing). EC2 is just the front door (registration + Caddy reverse proxy).

---

## 2. SSH access

```bash
# EC2 (ed25519 key)
ssh -i /tmp/ec2_ed25519.pem ec2-user@52.37.182.24

# ThinkCentre (Tailscale SSH — may need browser auth, provide URL to user)
ssh mint@100.70.107.106

# From EC2 → ThinkCentre (for SCP sync, used by server.js automatically)
ssh mint@100.70.107.106
scp /home/ec2-user/cloud-proxy/users.json mint@100.70.107.106:/home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json
```

Note: The old RSA key `~/.ssh/alpacaproxy.pem` is for the **backup** EC2 (52.24.223.82) only.

---

## 3. Deploy Subcommands

Parse the user's args to determine which operation(s) to run:

| Arg | What it does |
|---|---|
| *(none)* / `deploy` | Full deploy: server + tests + restart + health check + sync |
| `server` | Deploy server.js + server.test.js, run tests, restart PM2 |
| `page` | Deploy frontend files (register-page.jsx, tokens.css) to EC2 public/ |
| `docs` | Commit & push docs-site.jsx to GitHub Pages |
| `test` | Run tests on EC2 only (no deploy) |
| `sync` | Force SCP users.json from EC2 to ThinkCentre |
| `status` | Show PM2 status + logs + ThinkCentre docker status |

### Full Deploy Sequence

```bash
# 1. Push server files (source: proxy-token-site/ subdir)
scp -i /tmp/ec2_ed25519.pem ./server.js ec2-user@52.37.182.24:/home/ec2-user/proxy-token-site/server.js
scp -i /tmp/ec2_ed25519.pem ./server.test.js ec2-user@52.37.182.24:/home/ec2-user/proxy-token-site/server.test.js

# 2. Run tests (STOP if they fail — do NOT restart PM2)
ssh -i /tmp/ec2_ed25519.pem ec2-user@52.37.182.24 "cd /home/ec2-user/proxy-token-site && npx jest 2>&1"

# 3. Restart PM2
ssh -i /tmp/ec2_ed25519.pem ec2-user@52.37.182.24 "pm2 restart proxy-token-site && sleep 2 && pm2 status"

# 4. Health check (register test user, verify 200, clean up)
ssh -i /tmp/ec2_ed25519.pem ec2-user@52.37.182.24 "
  curl -s -X POST http://localhost:3000/api/register \
    -H 'Content-Type: application/json' \
    -d '{\"username\":\"__healthcheck__\",\"phone\":\"000\",\"tier\":\"trial\"}' && echo '' &&
  node -e \"const fs=require('fs'),p='/home/ec2-user/proxy-token-site/data/pending.json';let d=JSON.parse(fs.readFileSync(p));d=d.filter(x=>x.username!=='__healthcheck__');fs.writeFileSync(p,JSON.stringify(d,null,2));console.log('cleanup done');\"
"

# 5. Sync users.json to ThinkCentre
ssh -i /tmp/ec2_ed25519.pem ec2-user@52.37.182.24 "scp -o StrictHostKeyChecking=no /home/ec2-user/cloud-proxy/users.json mint@100.70.107.106:/home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json"

# 6. Show status + logs
ssh -i /tmp/ec2_ed25519.pem ec2-user@52.37.182.24 "pm2 status && pm2 logs proxy-token-site --lines 5 --nostream 2>&1"
```

### Page Deploy (no restart needed)

Frontend source files live in the **parent docs repo** (`/home/kai/product-apim/`), NOT in `proxy-token-site/`. They are static assets served from EC2 `public/`.

```bash
# register-page.jsx — source: /home/kai/product-apim/register-page.jsx
scp -i /tmp/ec2_ed25519.pem /home/kai/product-apim/register-page.jsx ec2-user@52.37.182.24:/home/ec2-user/proxy-token-site/public/register-page.jsx

# tokens.css — source: /home/kai/product-apim/tokens.css
scp -i /tmp/ec2_ed25519.pem /home/kai/product-apim/tokens.css ec2-user@52.37.182.24:/home/ec2-user/proxy-token-site/public/tokens.css
```

### Docs Deploy (GitHub Pages)

Docs source is `/home/kai/product-apim/docs-site.jsx` in the `gh-pages` branch of `ikkisovi/Websocket-DataFeed-Proxy-docs`.

```bash
cd /home/kai/product-apim
git add docs-site.jsx
git commit -m "docs: <description>"
git push origin gh-pages
```

### Sync Subcommand

```bash
ssh -i /tmp/ec2_ed25519.pem ec2-user@52.37.182.24 "scp -o StrictHostKeyChecking=no /home/ec2-user/cloud-proxy/users.json mint@100.70.107.106:/home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json"
# Verify on ThinkCentre
ssh mint@100.70.107.106 "python3 -c \"import json;d=json.load(open('/home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json'));print(len(d['users']),'users synced')\""
```

---

## 4. Token portal (proxy-token-site)

EC2: `/home/ec2-user/proxy-token-site/` (PM2 process, serves :3000)

**Local source is split across two directories:**

| What | Local path | EC2 path | Deploy method |
|---|---|---|---|
| `server.js`, `server.test.js` | `/home/kai/product-apim/proxy-token-site/` | `/home/ec2-user/proxy-token-site/` | SCP + PM2 restart |
| `register-page.jsx`, `tokens.css` | `/home/kai/product-apim/` (docs repo root) | `/home/ec2-user/proxy-token-site/public/` | SCP (static, no restart) |
| `docs-site.jsx`, `index.html` | `/home/kai/product-apim/` (docs repo root) | GitHub Pages (not on EC2) | git push gh-pages |
| Cloud proxy (`alpaca_cloud_proxy.py`) | `/home/kai/product-apim/proxy-token-site/remote_proxy/` | ThinkCentre `~/Websocket-DataFeed-Proxy/ec2-primary-backup/` | SCP + docker rebuild |

The parent dir `/home/kai/product-apim/` is the `ikkisovi/Websocket-DataFeed-Proxy-docs` repo (branch `gh-pages`). The `proxy-token-site/` subdir is a separate git repo nested inside it.

**Token flow:**
```
User registers → data/pending.json (status: pending)
Admin approves → data/users.json + cloud-proxy/users.json (token written) + SCP to ThinkCentre
User generates token → validates against data/users.json, writes to cloud-proxy/users.json + SCP
```

### Service tiers (5 tiers, defined in server.js)

| UI Tier | Backend Role | REST/min | WS Symbols | REST Parallel | WS Conns | Expiry | WS Access |
|---------|-------------|----------|------------|---------------|----------|--------|-----------|
| trial | standard | 60 | 50 | 5 | 3 | 3 days | stocks, options |
| basic | basic | 10 | 10 | 2 | 1 | 30 days | none (REST only) |
| value | value | 30 | 30 | 3 | 2 | 30 days | stocks OR options (pick one at signup) |
| standard | standard | 60 | 100 | 5 | 3 | 30 days | stocks, options |
| premium | premium | 300 | 500 | 10 | inf | 30 days | all channels |

Rate limits are enforced by the cloud proxy's `RateLimiter` class based on the `role` field.

Admin: `POST /api/admin/login` with `ADMIN_PASSWORD` (default `admin123`), then `X-Admin-Token` header. Sessions are in-memory — die on restart.

**Tests:** `server.test.js` uses isolated temp dirs via `DATA_DIR` and `PROXY_USERS_FILE` env vars. Safe to run on EC2 without affecting live data.

---

## 5. Cloud proxy (ThinkCentre, live)

Docker container: `ec2-primary-backup-alpaca-cloud-proxy-1`
Source: `~/Websocket-DataFeed-Proxy/ec2-primary-backup/alpaca_cloud_proxy.py`

```bash
# On ThinkCentre
docker ps
docker logs ec2-primary-backup-alpaca-cloud-proxy-1 --tail 100
cd ~/Websocket-DataFeed-Proxy/ec2-primary-backup/
docker compose -f docker-compose.cloud-proxy.yml up -d --build
```

**REST endpoints** (all `POST`, auth via `token` in body or `Authorization: Bearer <token>`):

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

**WebSocket channels:** `/stream` (stocks), `/stream/options`, `/stream/overnight`, `/stream/crypto`, `/stream/news`, `/stream/boats`. Auth: `{"action":"auth","token":"..."}`. Stocks/options/overnight/boats use msgpack; crypto/news use JSON.

---

## 6. Cache architecture

Disk cache in `disk_cache.py`, wired into all endpoints:

```
Request → L1 (in-memory, 500 entries, 300s TTL) → L2 (gzip on disk, /mnt/data/cache) → Upstream
```

In-flight coalescing prevents duplicate upstream calls.

---

## 7. Cache warmer

```bash
cd ~/Websocket-DataFeed-Proxy/ec2-primary-backup
python3 smart_warmer_v2.py --token test123 --audit-file audit.jsonl --rate 3.0
python3 smart_warmer_v2.py --token test123 --audit-file audit.jsonl --dry-run  # preview
```

- `tickers.json`: S&P 500 + NASDAQ-100 + ETFs
- `refresh_tickers.py`: pulls current constituents from Wikipedia
- EC2 cron syncs audit.jsonl → ThinkCentre every 15 min
- ThinkCentre cron runs warmer daily at 23:00

---

## 8. Docs site

- Repo: `ikkisovi/Websocket-DataFeed-Proxy-docs` (branch `gh-pages`)
- Local clone: `/home/kai/product-apim/` (this is the docs repo root)
- Source: `/home/kai/product-apim/docs-site.jsx` (React CDN, Babel in-browser)
- HTML shell: `/home/kai/product-apim/index.html` (loads docs-site.jsx)
- GitHub Pages: `https://ikkisovi.github.io/Websocket-DataFeed-Proxy-docs/`
- Token portal links to docs site; they are separate deployments

---

## 9. Quick reference paths

| Thing | Local | EC2 / ThinkCentre |
|---|---|---|
| Docs repo root (gh-pages) | `/home/kai/product-apim/` | GitHub Pages |
| `docs-site.jsx` | `/home/kai/product-apim/docs-site.jsx` | GitHub Pages |
| `register-page.jsx` | `/home/kai/product-apim/register-page.jsx` | EC2: `public/register-page.jsx` |
| `tokens.css` | `/home/kai/product-apim/tokens.css` | EC2: `public/tokens.css` |
| `server.js` / `server.test.js` | `/home/kai/product-apim/proxy-token-site/` | EC2: `/home/ec2-user/proxy-token-site/` |
| Cloud proxy code | `/home/kai/product-apim/proxy-token-site/remote_proxy/alpaca_cloud_proxy.py` | TC: `~/Websocket-DataFeed-Proxy/ec2-primary-backup/alpaca_cloud_proxy.py` |
| Token registry | — | EC2: `/home/ec2-user/cloud-proxy/users.json` → TC: `~/Websocket-DataFeed-Proxy/ec2-primary-backup/users.json` |
| Disk cache | — | TC: `/mnt/data/cache/` |
| Caddyfile | — | EC2: `/etc/caddy/Caddyfile` → `/home/ec2-user/proxy-token-site/Caddyfile_ec2` |
| EC2 SSH key | `/tmp/ec2_ed25519.pem` | — |

## 10. Important Notes

- EC2 SSH key must exist at `/tmp/ec2_ed25519.pem` with `chmod 600`
- ThinkCentre SSH via Tailscale may need browser auth — provide the URL to user
- `server.js` exports `{ app, TIERS, syncToThinkCentre, computeExpiry, readJSON, writeJSON }`
- Tests use isolated temp dirs — safe to run on EC2
- `deploy.sh` wipes `data/pending.json` — back up pending approvals first
