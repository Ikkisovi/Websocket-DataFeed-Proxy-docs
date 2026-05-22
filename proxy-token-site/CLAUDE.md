# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run dev server locally (port 3000)
node server.js

# Run tests
npm test

# Deploy to EC2
bash deploy.sh
```

**Single test**: Jest has no built-in single-test runner; use `--testNamePattern` to filter:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest --testNamePattern="<test name>"
```

**On-EC2 ops** (SSH key: `~/.ssh/id_ed25519`, host: `ec2-user@52.37.182.24`):
```bash
# View live logs
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "sudo journalctl -u proxy-token-site -f"

# Restart service (PM2 is the real process manager; systemd unit is broken — wrong node path)
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "pm2 reload proxy-token-site"

# Analyze proxy audit log
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "python3 /home/ec2-user/proxy-token-site/scripts/audit_summary.py --days=7 --top-users=10"
```

> **Warning**: `deploy.sh` wipes `data/pending.json` on every deploy (line 25). If there are pending approvals, approve or back them up first.

## Architecture

This repo is the **token-issuance frontend** for a WebSocket/REST data proxy. Two distinct services run on EC2 (`52.37.182.24`):

1. **proxy-token-site** (this repo) — Express app on port 3000, managed by systemd as `proxy-token-site.service`
2. **cloud-proxy** — The upstream data proxy at `/home/ec2-user/cloud-proxy/` (separate codebase, not in this repo)

### How token provisioning works

The token site does **not** call an API to register users with the proxy. It directly reads and writes the proxy's config file at `/home/ec2-user/cloud-proxy/users.json` (hardcoded at `server.js:21`). Both services run on the same EC2 host, making this a local file write.

Flow:
```
User registers → data/pending.json
Admin approves → data/users.json + /home/ec2-user/cloud-proxy/users.json (token written here)
User generates token → validates against data/users.json, then writes to cloud-proxy/users.json
```

Token expiry is always **1 month from issuance**. If a user already has a token in `cloud-proxy/users.json`, the existing token is returned without regenerating.

### Service tiers

Three tiers are defined in `server.js:24-46`:

| Tier | `role` field | WS channels | REST endpoints |
|------|-------------|-------------|----------------|
| `premium` | `premium` | stocks, options, overnight, crypto, news, boats, test | all history + snapshots + orderbooks |
| `limited_premium` | `limited_premium` | stocks, options | history, contracts, snapshots (no crypto/news) |
| `basic` | `basic` | stocks, news | stocks_history, news_history only |

### Data storage

All state is in flat JSON files — no database:
- `data/users.json` — approved users with roles and permissions
- `data/pending.json` — registration queue (pending/approved/rejected entries)
- `/home/ec2-user/cloud-proxy/users.json` — the proxy's live token registry

### Admin authentication

Admin sessions are stored in an **in-memory Set** (`adminSessions`, `server.js:49`). Sessions do not survive a server restart. Auth uses `X-Admin-Token` header. Password is set via `ADMIN_PASSWORD` env var (systemd default: `admin123`).

### Docs site

The docs are hosted on GitHub Pages: `https://ikkisovi.github.io/Websocket-DataFeed-Proxy-docs/`

- Source: `claude_design/docs-site.jsx` (React, rendered client-side via CDN)
- The `patch_docs*.js` and `patch_content.js` scripts are one-off node scripts that modify `claude_design/docs-site.jsx` in place
- `docs_export/` contains the exported standalone HTML for the GitHub Pages site
- The token site embeds this docs URL in an iframe on the main page (`public/index.html`)

### Known proxy REST endpoints (cloud-proxy)

These are the REST data endpoints served by cloud-proxy (documented in the docs site, accessible to approved users via `Authorization: Bearer <token>`):

| Endpoint | Tier required | Description |
|----------|--------------|-------------|
| `POST /v1/history/bars` | basic+ | Historical stock OHLCV bars |
| `POST /v1/history/news` | basic+ | Historical market news |
| `POST /v1/options/contracts` | limited_premium+ | Option chains / active contracts |
| `POST /v1/options/snapshots` | limited_premium+ | Realtime option snapshots (greeks, IV, NBBO) |
| `POST /v1/options/snapshots/expiry` | limited_premium+ | Option snapshots by expiration date |
| `POST /v1/history/options/bars` | limited_premium+ | Historical options OHLCV bars |
| `POST /v1/options/open_interest` | limited_premium+ | Open interest per contract |
| `POST /v1/options/eod` | limited_premium+ | End-of-day options summaries |
| `POST /v1/crypto/us/latest/orderbooks` | premium only | L2 orderbooks for US crypto markets |

WebSocket channels (connect with token in query string or header): `stocks`, `options`, `overnight`, `crypto`, `news`, `boats`, `test` — availability depends on tier.
