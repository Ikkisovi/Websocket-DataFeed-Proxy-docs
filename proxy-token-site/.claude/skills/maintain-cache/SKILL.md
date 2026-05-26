---
name: maintain-cache
description: "Instructions for maintaining, monitoring, and debugging the proxy's hot cache, HDD archives, TimescaleDB, and data warmers on the ThinkCentre."
argument-hint: "[topic or subcommand: run|monitor|archive|db|options|kill]"
---

# Alpaca Proxy — Cache, DB & Warmer Maintenance Skill

---

## 1. Hot Cache (NVMe) & Archive (HDD)

| Tier | Path on ThinkCentre (`100.70.107.106`) | Details |
|---|---|---|
| **L2 Hot Cache** | `/var/cache/alpaca/` | NVMe. Limited to 30GB via LRU. Opaque SHA-256 keys. Background cleanup runs hourly. |
| **L3 Archive** | `/mnt/data/cache/archive/` | HDD. Unlimited human-readable JSON.gz files organized by date and endpoint. |

### Inspecting Cache Health

```bash
# Check size of the hot cache (NVMe)
ssh mint@100.70.107.106 "du -sh /var/cache/alpaca/"

# Check size of the archive (HDD)
ssh mint@100.70.107.106 "du -sh /mnt/data/cache/archive/"

# Check available disk space for the archive HDD
ssh mint@100.70.107.106 "df -h /mnt/data"

# Count total archived files
ssh mint@100.70.107.106 "find /mnt/data/cache/archive/ -type f | wc -l"
```

---

## 2. TimescaleDB (Database-First Architecture)

Docker container: `timescaledb` on ThinkCentre. All historical data lives here.

### Schema

| Table | Type | Content |
|---|---|---|
| `bars` | hypertable | Stock bars: 1Min, 5Min, 15Min, 1Hour, 1Day. Source: Alpaca |
| `options_bars` | hypertable | Option EOD bars (1Day only for value plan). Source: ThetaData |
| `option_contracts` | regular table | Option chain metadata: symbol, root, expiration, strike, type |
| `latest_quotes` | regular table | Latest quote snapshot (real-time, not historical) |
| `latest_options_quotes` | regular table | Latest option quote snapshot |
| `news` | hypertable | News articles |
| `backfill_log` | regular table | Warmer run tracking |

### DB Stats

```bash
ssh mint@100.70.107.106 "docker exec -e PGPASSWORD=proxy123 timescaledb psql -U proxy -d marketdata -c 'SELECT * FROM v_db_stats;'"
```

### Coverage Check (per symbol)

```bash
# Bars coverage for a symbol
ssh mint@100.70.107.106 "docker exec -e PGPASSWORD=proxy123 timescaledb psql -U proxy -d marketdata -c \"SELECT timeframe, COUNT(*), MIN(ts)::date, MAX(ts)::date FROM bars WHERE symbol='SPY' GROUP BY timeframe ORDER BY timeframe;\""

# Options coverage
ssh mint@100.70.107.106 "docker exec -e PGPASSWORD=proxy123 timescaledb psql -U proxy -d marketdata -c \"SELECT COUNT(DISTINCT symbol) as contracts, COUNT(*) as bars FROM options_bars WHERE timeframe='1Day';\""
```

---

## 3. Warmer v4 (Smart Warmer — Full Universe Backfill)

Source: `/home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/smart_warmer_v4.py` on ThinkCentre. The container image does **not** include this file — copy it in after restarts.

### What it does

1. **Stock bars** — Alpaca REST API (paid key, 100/s, 20 concurrent) → `bars` table
2. **Option bars** — Proxy REST API `/v1/history/options/bars` → `options_bars` table (1Day for value plan; 1Min may work via proxy)
3. **Option contracts** — Proxy REST API `/v1/options/contracts` → `option_contracts` table

### Key constraints

| Constraint | Details |
|---|---|
| ThetaData value plan | **NO** historical minute bars via SDK directly. EOD (`option_history_eod`) works. 1Min may work via proxy REST endpoint (not guaranteed). |
| ThetaData session | **ONE** active session per account. Warmer must NOT create its own `ThetaClient` — it conflicts with proxy's session. **Warmer now routes through proxy REST API** to avoid this. |
| EOD date range | Max 365 days per request. Warmer batches by year. |
| Option listing | Contracts typically list ~90-180 days before expiration. Warmer limits start_date to `expiration - 180 days`. |
| Alpaca bars | Free keys do NOT support historical bars (403). Only paid key works. Rate: 100/s with key pool. |

### Container Runtime Notes

The proxy container (`ec2-primary-backup-alpaca-cloud-proxy-1`) is a minimal image:
- No `ps` or `kill` commands
- No `pyyaml` installed (needed by `tickers_loader.py`)
- Proxy listens on **port 8766** internally (mapped to 8768 externally)
- `TIMESCALEDB_HOST=timescaledb` resolves via Docker network
- Files copied to `/app/` are lost on container restart

### Start the Warmer

```bash
# Copy files into container (required after restarts)
ssh mint@100.70.107.106 "docker cp /home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/smart_warmer_v4.py ec2-primary-backup-alpaca-cloud-proxy-1:/app/"
ssh mint@100.70.107.106 "docker cp /home/mint/Websocket-DataFeed-Proxy/ec2-primary-backup/tickers_loader.py ec2-primary-backup-alpaca-cloud-proxy-1:/app/"

# Install deps if needed
ssh mint@100.70.107.106 "docker exec ec2-primary-backup-alpaca-cloud-proxy-1 pip3 install pyyaml"

# Bars: NDX100 + SP500 (run inside container)
ssh mint@100.70.107.106 "docker exec -d ec2-primary-backup-alpaca-cloud-proxy-1 sh -c 'python3 -u /app/smart_warmer_v4.py --token a8b20ed4-80cb-493e-94e9-7d71cac1b9c2 --data-types bars --symbols-source ndx100,sp500 --days-back 730 --rate 100 --parallel 20 --timeframes 1Min,5Min,15Min,1Hour,1Day > /tmp/warmer_ndx_sp500.log 2>&1'"

# Options: SPY + QQQ + SPX + NDX (run inside container, via proxy)
ssh mint@100.70.107.106 "docker exec -d ec2-primary-backup-alpaca-cloud-proxy-1 sh -c 'python3 -u /app/smart_warmer_v4.py --token a8b20ed4-80cb-493e-94e9-7d71cac1b9c2 --data-types options --options-underlyings SPY,QQQ,SPX,NDX --days-back 730 --rate 1 > /tmp/warmer_options.log 2>&1'"
```

### Monitor

```bash
# Real-time logs
ssh -t mint@100.70.107.106 "docker exec ec2-primary-backup-alpaca-cloud-proxy-1 tail -f /tmp/warmer_options.log"
ssh -t mint@100.70.107.106 "docker exec ec2-primary-backup-alpaca-cloud-proxy-1 tail -f /tmp/warmer_ndx_sp500.log"

# Progress (every 60s)
ssh mint@100.70.107.106 "docker exec -e PGPASSWORD=proxy123 timescaledb psql -U proxy -d marketdata -c 'SELECT * FROM v_db_stats;'"
```

### Kill

```bash
# List warmer PIDs from host
ssh mint@100.70.107.106 "docker top ec2-primary-backup-alpaca-cloud-proxy-1 | grep warm"

# Kill by PID (replace <PID> with actual value from docker top)
ssh mint@100.70.107.106 "docker exec ec2-primary-backup-alpaca-cloud-proxy-1 python3 -c 'import os, signal; os.kill(<PID>, signal.SIGKILL)'"

# Or restart the entire container (blunt, resets ThetaData session too)
ssh mint@100.70.107.106 "docker restart ec2-primary-backup-alpaca-cloud-proxy-1"
```

---

## 4. Troubleshooting

### "Invalid session ID" from ThetaData

**Cause**: Multiple processes/containers using the same ThetaData credentials simultaneously.

**Fix**: 
1. Kill ALL warmer processes
2. Restart proxy container to reset session: `docker restart ec2-primary-backup-alpaca-cloud-proxy-1`
3. Wait 30s, verify: `curl -s -X POST http://127.0.0.1:8768/v3/option/history/eod ...`
4. Restart warmer (single process only)

### "No data found" for option_history_ohlc

**Expected** on ThetaData value plan. Value plan does NOT include historical minute bars. Use `option_history_eod` instead (daily bars with OHLC + bid/ask).

### Bars warmer 403 errors

**Cause**: Free Alpaca keys cannot fetch historical bars. Only paid master key works for bars backfill. Warmer automatically routes to paid key via `feed=sip`.

---

## 5. Past Warmer Versions (reference)

- `smart_warmer_v2.py` — Legacy cache-only warmer (pre-TimescaleDB)
- `smart_warmer_v3.py` — Basic TimescaleDB backfill
- `smart_warmer_v4.py` — Current: concurrent bars + options via proxy REST + option_contracts metadata
