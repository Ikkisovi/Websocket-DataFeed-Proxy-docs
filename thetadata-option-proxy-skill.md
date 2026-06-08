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
