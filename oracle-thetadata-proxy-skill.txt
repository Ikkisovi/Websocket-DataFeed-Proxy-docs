# ThetaData Option Proxy User Guide

Use this guide to connect to the public Leandata market-data proxy with a user token. It covers the public API surface only: no server IPs, deployment paths, SSH commands, internal credentials, or provider account details are required.

## Public Surfaces

- Token portal: `https://leandata.uk`
- REST history and cached data: `https://api.leandata.uk`
- REST real-time data: `https://rt-api.leandata.uk`
- WebSocket stream: use the WS endpoint shown in the Leandata docs.

All surfaces use the same token.

## Authentication

For REST, pass your token in the Authorization header:

```bash
curl -H "Authorization: Bearer <TOKEN>" \
  "https://api.leandata.uk/health"
```

For WebSocket, connect first, then send:

```json
{"action":"auth","token":"<TOKEN>"}
```

Keep your token private. Do not commit it, paste it into public tickets, or include it in screenshots.

## Endpoint Smoke Test

From an OpenAlice checkout:

```bash
ALPACA_PROXY_TOKEN="<TOKEN>" pnpm test:alpaca-proxy -- \
  --http-base=https://api.leandata.uk \
  --ws-base=<WS_BASE>
```

Expected checks:

- `PASS health - OK`
- `PASS stock-history - 200`
- `PASS option-snapshots - 200`
- `PASS options-history - 200`
- `PASS stock-stream`
- `PASS options-stream`
- `PASS test-stream`
- `PASS crypto-stream`

## Stock History

```bash
curl -X POST https://api.leandata.uk/v1/history/bars \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL","timeframe":"1Day","start":"2024-01-02","end":"2024-01-05","limit":5}'
```

## Option Contracts

```bash
curl -X POST https://api.leandata.uk/v1/options/contracts \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"underlying_symbols":"AAPL","limit":2,"provider":"auto"}'
```

Use the returned OCC `symbol` in option snapshot and option history calls.

## Option History

Daily option bars can use the default `provider: "auto"` path:

```bash
curl -X POST https://api.leandata.uk/v1/history/options/bars \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"symbols":"AAPL260620C00200000","start":"2025-05-01","end":"2025-05-15","timeframe":"1Day","provider":"auto"}'
```

Intraday option bars require Alpaca:

```bash
curl -X POST https://api.leandata.uk/v1/history/options/bars \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"symbols":"AAPL260620C00200000","start":"2025-05-01","end":"2025-05-01","timeframe":"1Min","provider":"alpaca"}'
```

## Option Snapshots

```bash
curl -X POST https://api.leandata.uk/v1/options/snapshots/expiry \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"underlying":"AAPL","expiry":"2026-07-17","feed":"indicative"}'
```

## ThetaData Value Notes

ThetaData Value supports selected option list, EOD, quote, OHLC snapshot, and open-interest endpoints. It does not provide direct option trades, trade_quote, market value, implied volatility, or greeks through ThetaData. Use Alpaca-backed snapshots for greeks and IV.

For `provider: "thetadata"`, intraday option history may return no data on Value plans. Use `timeframe: "1Day"` or set `provider: "alpaca"` for intraday bars.

## Common Errors

- `401 Unauthorized`: token is missing, invalid, or expired.
- `403 Forbidden`: your tier does not include this endpoint.
- Empty option history: verify OCC symbol, date range, expiry, and provider.
- Shell prompt hangs after copy-paste: check that each `-H "Authorization: Bearer <TOKEN>" \` line has a closing quote before the trailing backslash.


---

---
name: oracle-thetadata-proxy
description: Guide and instructions for utilizing, testing, operating, and troubleshooting the ThetaData Option Proxy Service migrated to the Oracle Cloud instance. Use when running integration tests, running the missing tickers sync script, or debugging Docker containers and TimescaleDB status on the Oracle server.
---

# Oracle Cloud ThetaData Option Proxy Service - Usage & Operations Skill

## 1. Overview & Topology

The ThetaData option history REST proxy service has been migrated from the local ThinkCentre (TC) machine to the Oracle Cloud instance. This proxy serves as a pass-through layer that routes options history queries to a local Theta Terminal (Primary) with automatic fallback to the Alpaca REST API.

```
Local Client (OpenAlice / scripts)
    │  (via Tailscale)
    ▼
Oracle Cloud Instance (Tailscale IP: 100.82.194.120)
    ├── REST Proxy (Port 8768) ──► python alpaca_cloud_proxy.py
    │       ├── Primary: Theta Terminal (Localhost Port 25510)
    │       ├── Database Cache: TimescaleDB (Localhost Port 5432)
    │       └── Fallback: Alpaca REST API (v1beta1/options/bars)
    └── WS Proxy (Port 8767) ──► Real-time Stock / Option Streams (direct to Alpaca)
```

### Key Network Addresses
* **Oracle IP (Tailscale)**: `100.82.194.120`
* **REST Proxy URL**: `http://100.82.194.120:8768`
* **WS Proxy URL**: `ws://100.82.194.120:8767`
* **TimescaleDB Port (Local)**: `5432`

---

## 2. Prerequisites & Setup

Before interacting with the proxy, ensure that:
1. **Tailscale is Connected**: You must be connected to the Tailscale network. Verify you can ping the Oracle instance:
   ```bash
   ping 100.82.194.120
   ```
2. **Secrets Loaded**: Local data scripts require credentials loaded from `~/.openalice_secrets.env` (containing `ALPACA_API_KEY`, `ALPACA_API_SECRET`, and `PROXY_TOKEN`).

---

## 3. Core Commands & Workflows

### A. Health Check & Diagnostics
Verify the REST proxy health and cache database status:
```bash
curl -i http://100.82.194.120:8768/health
```
A successful response should look like:
```json
{
  "status": "OK",
  "pool": { ... },
  "db": {
    "enabled": true,
    "error": ""
  }
}
```

### B. Run Integration Tests
Verify all HTTP endpoints and WebSocket streams on Oracle Cloud:
```bash
npx tsx scripts/test-alpaca-cloud-proxy.ts --host=100.82.194.120 --token=<YOUR_PROXY_TOKEN>
```
Successful test output shows:
```
PASS health - OK
PASS stock-history - 200
PASS option-snapshots - 200
PASS options-history - 200
PASS stock-stream
PASS options-stream
PASS test-stream
PASS crypto-stream
```

### C. Sync Missing Tickers & Materialize Panels
To sync missing option bars for the current Lean universe (e.g. `LRN`, `CMCSA`, `RL`, `UBER`, `QTWO`) through the Oracle Cloud proxy, run:
```bash
# Dry run check (only prints symbols/ranges without downloading)
bash scripts/sync_missing_tickers_via_oracle.sh --dry-run

# Run full sync and panels re-materialization
bash scripts/sync_missing_tickers_via_oracle.sh
```
This script will:
1. Check Tailscale connectivity.
2. Query Oracle Cloud REST proxy on port 8768 to fetch 1-min option bars.
3. Save downloaded bars to the local cache (`data/quant-research`).
4. Re-materialize the dataset panels.
5. Verify universe coverage.

---

## 4. Oracle Server Operations (Remote Management)

To manage or debug the services running on the Oracle Cloud instance, connect via SSH:
```bash
ssh opc@100.82.194.120
```

### A. Service Locations
* **Docker Compose Directory**: `/home/opc/proxy-token-site/remote_proxy/`
* **Durable Cache Archive**: Located in `/home/opc/proxy-token-site/remote_proxy/archive/`
* **Credentials Path**: `/home/opc/proxy-token-site/remote_proxy/.thetadata_credentials.txt`

### B. Managing Containers via Docker Compose
Navigate to the remote directory and run operations:
```bash
cd /home/opc/proxy-token-site/remote_proxy/

# Check running containers
docker compose -f docker-compose.cloud-proxy.yml ps

# View real-time logs of the proxy
docker compose -f docker-compose.cloud-proxy.yml logs -f cloud-proxy

# Restart the proxy service
docker compose -f docker-compose.cloud-proxy.yml restart cloud-proxy

# Rebuild and start all containers
docker compose -f docker-compose.cloud-proxy.yml up -d --build
```

### C. Querying TimescaleDB Database
To check options bars insertion count directly on TimescaleDB inside Oracle Cloud:
```bash
docker exec timescaledb psql -U proxy -d marketdata -c "select count(*) from options_bars;"
```

---

## 5. Troubleshooting

* **`HTTP Error 401: Unauthorized`**: The token passed in the request is invalid or missing in `/home/opc/proxy-token-site/remote_proxy/users.json` on Oracle.
* **`ConnectionRefusedError` (Connection to 100.82.194.120:8768 failed)**:
  1. Verify Tailscale connectivity: `tailscale status`.
  2. Check if the docker container is running on the Oracle instance: `docker compose -f docker-compose.cloud-proxy.yml ps`.
* **TimescaleDB connection errors in container logs**:
  Verify `/var/lib/postgresql/timescale` permissions on Oracle host have UID 70 (postgres user in container):
  ```bash
  sudo chown -R 70:70 /var/lib/postgresql/timescale
  ```
