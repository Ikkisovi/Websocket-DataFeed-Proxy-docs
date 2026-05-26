#!/usr/bin/env python3
"""
smart_warmer_v4.py — 全量数据回填脚本

支持:
1. Stock minute bars (Alpaca REST → TimescaleDB bars)
2. Stock quotes 两年历史 (proxy /v1/stock/history/trade_quote → latest_quotes / quotes_history)
3. Options snapshots (ThetaData option_history_ohlc → options_bars)

Symbol 来源:
- Lean universe (73 个, 最高优先级)
- NASDAQ-100 (GitHub)
- S&P 500 (GitHub)

运行方式:
    python3 smart_warmer_v4.py --token test123 --data-types bars,quotes,options
    python3 smart_warmer_v4.py --token test123 --data-types bars --symbols-source lean
    python3 smart_warmer_v4.py --token test123 --data-types options --options-underlyings SPX,NDX,QQQ
"""

import argparse
import asyncio
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

import aiohttp

from tickers_loader import load_all_tickers, load_options_underlyings

# ── 配置 ──
TIMESCALEDB_HOST = os.getenv("TIMESCALEDB_HOST", "timescaledb")
TIMESCALEDB_PORT = int(os.getenv("TIMESCALEDB_PORT", "5432"))
TIMESCALEDB_USER = os.getenv("TIMESCALEDB_USER", "proxy")
TIMESCALEDB_PASSWORD = os.getenv("TIMESCALEDB_PASSWORD", "proxy123")
TIMESCALEDB_DB = os.getenv("TIMESCALEDB_DB", "marketdata")

PROXY_HOST = os.getenv("PROXY_HOST", "127.0.0.1")
PROXY_REST_PORT = os.getenv("PROXY_REST_PORT", "8768")
PROXY_BASE_URL = f"http://{PROXY_HOST}:{PROXY_REST_PORT}"

ALPACA_KEY = os.getenv("ALPACA_MASTER_KEY", "")
ALPACA_SECRET = os.getenv("ALPACA_MASTER_SECRET", "")
ALPACA_DATA_URL = "https://data.alpaca.markets"

# 回填参数
DEFAULT_TIMEFRAMES = ["1Min"]
QUOTES_DAYS_BACK = 730  # 2 years
BARS_DAYS_BACK = 730
RATE_LIMIT_REQ_PER_SEC = 100.0  # key pool handles throttling
MAX_PARALLEL = 20

# ── asyncpg ──
try:
    import asyncpg
    ASYNCPG_AVAILABLE = True
except ImportError:
    asyncpg = None
    ASYNCPG_AVAILABLE = False

# ── key pool ──
try:
    from alpaca_key_pool import alpaca_get, get_key_pool
    KEYPOOL_AVAILABLE = True
except ImportError:
    KEYPOOL_AVAILABLE = False

# ThetaData SDK 是单 session 的，需要全局锁
_theta_lock = asyncio.Lock()
_theta_client = None


# ============================================================
# DB 操作
# ============================================================

async def get_db_pool():
    if not ASYNCPG_AVAILABLE:
        return None
    try:
        return await asyncpg.create_pool(
            host=TIMESCALEDB_HOST, port=TIMESCALEDB_PORT,
            user=TIMESCALEDB_USER, password=TIMESCALEDB_PASSWORD,
            database=TIMESCALEDB_DB, min_size=2, max_size=5, command_timeout=60,
        )
    except Exception as e:
        print(f"[V4] DB connection failed: {e}")
        return None


async def get_db_coverage(pool, symbol: str, timeframe: str, table: str = "bars") -> Tuple[Optional[datetime], Optional[datetime], int]:
    if pool is None:
        return None, None, 0
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT MIN(ts), MAX(ts), COUNT(*) FROM {table} WHERE symbol = $1 AND timeframe = $2",
            symbol.upper(), timeframe,
        )
    return row[0], row[1], row[2]


async def copy_bars_to_db(pool, records: List[Tuple]) -> int:
    if pool is None or not records:
        return 0
    async with pool.acquire() as conn:
        await conn.copy_records_to_table(
            "bars", records=records,
            columns=["symbol", "timeframe", "ts", "open", "high", "low", "close", "volume", "vwap", "trade_count", "feed", "source"],
        )
    return len(records)


async def upsert_quotes_batch(pool, records: List[Tuple]) -> int:
    """批量 upsert latest_quotes. records: [(symbol, bid, bid_size, ask, ask_size, last, last_size, volume, timestamp, source), ...]"""
    if pool is None or not records:
        return 0
    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO latest_quotes (symbol, bid_price, bid_size, ask_price, ask_size, last_price, last_size, volume, timestamp, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (symbol) DO UPDATE SET
                bid_price = EXCLUDED.bid_price, bid_size = EXCLUDED.bid_size,
                ask_price = EXCLUDED.ask_price, ask_size = EXCLUDED.ask_size,
                last_price = EXCLUDED.last_price, last_size = EXCLUDED.last_size,
                volume = EXCLUDED.volume, timestamp = EXCLUDED.timestamp,
                source = EXCLUDED.source, updated_at = NOW()
            WHERE EXCLUDED.timestamp >= latest_quotes.timestamp OR latest_quotes.timestamp IS NULL
            """,
            records,
        )
    return len(records)


async def upsert_option_contracts(pool, contracts: List[Dict]) -> int:
    """写入/更新期权链合约元数据."""
    if pool is None or not contracts:
        return 0
    from datetime import datetime as _dt
    records = []
    for c in contracts:
        exp_str = str(c.get("expiration", "")).replace("-", "").strip()
        try:
            exp_date = _dt.strptime(exp_str, "%Y%m%d").date()
        except Exception:
            continue
        records.append((
            c.get("occ", "").upper(),
            c.get("root", "").upper(),
            exp_date,
            float(c.get("strike", 0)),
            "call" if str(c.get("right", "")).upper() in ("C", "CALL") else "put",
            "thetadata",
        ))
    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO option_contracts (symbol, root_symbol, expiration_date, strike_price, option_type, source)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (symbol) DO UPDATE SET
                last_scanned_at = NOW(),
                active = TRUE
            WHERE EXCLUDED.last_scanned_at > option_contracts.last_scanned_at
            OR option_contracts.last_scanned_at IS NULL
            """,
            records,
        )
    return len(records)


async def copy_options_bars_to_db(pool, records: List[Tuple]) -> int:
    if pool is None or not records:
        return 0
    async with pool.acquire() as conn:
        await conn.copy_records_to_table(
            "options_bars", records=records,
            columns=["symbol", "root_symbol", "expiration_date", "strike_price", "option_type",
                     "timeframe", "ts", "open", "high", "low", "close", "volume", "vwap", "trade_count", "open_interest", "feed", "source"],
        )
    return len(records)


# ============================================================
# 数据获取 — Stock Bars (Alpaca direct)
# ============================================================

async def fetch_bars_from_alpaca(
    session: aiohttp.ClientSession, symbol: str, timeframe: str,
    start: str, end: str, limit: int = 10000,
) -> Optional[List[Dict]]:
    """Fetch bars via key pool (auto-routes across paid + free keys)."""
    all_bars = []
    page_token = None
    params = {
        "symbols": symbol, "timeframe": timeframe,
        "start": start, "end": end,
        "adjustment": "all", "feed": "sip", "limit": limit
    }

    if KEYPOOL_AVAILABLE:
        pool = get_key_pool()
        if not pool.entries:
            print(f"[V4] No Alpaca keys configured")
            return None
        for _ in range(100):
            if page_token:
                params["page_token"] = page_token
            elif "page_token" in params:
                del params["page_token"]

            status, headers, body_bytes, feed = await alpaca_get(
                session, "/v2/stocks/bars", params,
                end_hint=end, routing_endpoint="/v1/history/bars"
            )
            if status == 429:
                # Rate limited — wait and retry with same params
                retry_after = int(headers.get("Retry-After", "5"))
                print(f"[V4] 429 for {symbol}, retry after {retry_after}s")
                await asyncio.sleep(retry_after)
                continue
            if status != 200:
                print(f"[V4] Alpaca error {status} for {symbol}: {body_bytes.decode()[:200]}")
                return None
            data = json.loads(body_bytes)
            bars = data.get("bars", {}).get(symbol, [])
            if bars:
                all_bars.extend(bars)
            page_token = data.get("next_page_token")
            if not page_token:
                break
        return all_bars

    # Fallback: single key (no key pool)
    if not ALPACA_KEY or not ALPACA_SECRET:
        return None
    url = f"{ALPACA_DATA_URL}/v2/stocks/bars"
    headers = {"APCA-API-KEY-ID": ALPACA_KEY, "APCA-API-SECRET-KEY": ALPACA_SECRET, "Accept": "application/json"}
    for _ in range(100):
        if page_token:
            params["page_token"] = page_token
        elif "page_token" in params:
            del params["page_token"]
        async with session.get(url, params=params, headers=headers) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()
        bars = data.get("bars", {}).get(symbol, [])
        if bars:
            all_bars.extend(bars)
        page_token = data.get("next_page_token")
        if not page_token:
            break
    return all_bars


def bars_to_db_records(symbol: str, timeframe: str, bars: List[Dict]) -> List[Tuple]:
    from datetime import datetime
    records = []
    for bar in bars:
        ts_str = bar.get("t", "")
        if not ts_str:
            continue
        ts_str = ts_str.replace("Z", "+00:00")
        try:
            ts = datetime.fromisoformat(ts_str)
        except Exception:
            continue
        records.append((
            symbol.upper(), timeframe, ts,
            bar.get("o"), bar.get("h"), bar.get("l"), bar.get("c"),
            bar.get("v"), bar.get("vw"), bar.get("n"),
            "sip", "alpaca",
        ))
    return records


# ============================================================
# 数据获取 — Stock Quotes (via proxy → ThetaData)
# ============================================================

async def fetch_quotes_via_proxy(
    session: aiohttp.ClientSession, token: str,
    symbol: str, start: str, end: str, limit: int = 1000,
) -> Optional[List[Dict]]:
    """通过 proxy 获取 stock trade/quote 历史 (ThetaData)."""
    url = f"{PROXY_BASE_URL}/v1/stock/history/trade_quote"
    payload = {"token": token, "symbol": symbol, "start": start, "end": end, "limit": limit}
    try:
        async with session.post(url, json=payload) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()
            return data.get("trades_quotes", [])
    except Exception as e:
        print(f"[V4] Quote fetch error for {symbol}: {e}")
        return None


def quotes_to_db_records(quotes: List[Dict], symbol: str) -> List[Tuple]:
    """将 quote snapshot 转为 latest_quotes upsert 记录."""
    from datetime import datetime
    records = []
    for q in quotes:
        ts_str = q.get("t") or q.get("timestamp") or q.get("date")
        if not ts_str:
            continue
        ts_str = str(ts_str).replace("Z", "+00:00")
        try:
            ts = datetime.fromisoformat(ts_str)
        except Exception:
            continue
        records.append((
            symbol.upper(),
            q.get("bp") or q.get("bid_price"),
            q.get("bs") or q.get("bid_size"),
            q.get("ap") or q.get("ask_price"),
            q.get("as") or q.get("ask_size"),
            q.get("p") or q.get("last_price"),
            q.get("s") or q.get("last_size"),
            q.get("v") or q.get("volume"),
            ts,
            "thetadata",
        ))
    return records


# ============================================================
# 数据获取 — Options Snapshots (ThetaData SDK)
# ============================================================

def _nearest_trading_day(ref_date=None, max_lookback=5):
    """回退到最近的交易日（周末/节假日无数据）."""
    import datetime
    if ref_date is None:
        ref_date = datetime.date.today()
    for i in range(max_lookback + 1):
        d = ref_date - datetime.timedelta(days=i)
        # Mon=0 ... Fri=4, Sat=5, Sun=6
        if d.weekday() < 5:
            return d
    return ref_date - datetime.timedelta(days=ref_date.weekday() - 4)


async def _get_theta_client():
    """获取或重建 ThetaData client（带 session 恢复）."""
    global _theta_client
    from thetadata import ThetaClient
    creds_file = os.getenv("THETADATA_CREDS_FILE", "/app/.thetadata_credentials.txt")
    if _theta_client is None:
        _theta_client = ThetaClient(creds_file=creds_file)
    return _theta_client


async def _theta_call(loop, fn, max_retries=2):
    """串行调用 ThetaData SDK，遇到 session 错误自动重连重试."""
    global _theta_client
    async with _theta_lock:
        for attempt in range(max_retries):
            try:
                return await loop.run_in_executor(None, fn)
            except Exception as e:
                msg = str(e)
                if "Invalid session ID" in msg or "UNAUTHENTICATED" in msg:
                    print(f"[V4] ThetaData session expired, reconnecting...")
                    _theta_client = None
                    client = await _get_theta_client()
                    if attempt < max_retries - 1:
                        await asyncio.sleep(1)
                        continue
                raise
        return None


async def fetch_theta_option_chain(
    root_symbol: str, max_dte: int = 730, limit: int = 2000,
) -> List[Dict]:
    """获取某股票的 option chain，过滤两年内到期的 contracts."""
    try:
        creds_file = os.getenv("THETADATA_CREDS_FILE", "/app/.thetadata_credentials.txt")
        if not Path(creds_file).exists():
            return []
        import datetime
        client = await _get_theta_client()
        # 尝试最近几个交易日（数据可能延迟）
        for lookback in range(7):
            query_date = _nearest_trading_day(datetime.date.today() - datetime.timedelta(days=lookback))
            max_expiry = query_date + datetime.timedelta(days=max_dte)
            loop = asyncio.get_event_loop()
            try:
                df = await _theta_call(
                    loop,
                    lambda d=query_date: client.option_list_contracts(request_type="QUOTE", date=d, symbol=[root_symbol])
                )
                if df is not None and len(df) > 0:
                    break
            except Exception as inner_e:
                if "No data found" in str(inner_e) and lookback < 6:
                    continue
                raise
        else:
            return []
        df = df.to_pandas() if hasattr(df, "to_pandas") else df
        contracts = []
        for _, row in df.iterrows():
            exp = row.get("expiration", "")
            if not exp:
                continue
            try:
                exp_str = str(exp).replace("-", "").strip()
                exp_date = datetime.datetime.strptime(exp_str, "%Y%m%d").date()
                if exp_date > max_expiry:
                    continue
            except Exception:
                continue
            contracts.append({
                "symbol": row.get("symbol", root_symbol),
                "root": root_symbol,
                "expiration": str(exp),
                "strike": row.get("strike", 0),
                "right": row.get("right", ""),
                "occ": _format_occ(row.get("symbol", root_symbol), str(exp), row.get("right", ""), row.get("strike", 0)),
            })
        return contracts[:limit]
    except Exception as e:
        print(f"[V4] Option chain fetch error for {root_symbol}: {e}")
        return []


def _format_occ(root: str, expiration: str, right: str, strike) -> str:
    """格式化 OCC option symbol."""
    exp_clean = str(expiration).replace("-", "").strip()
    if len(exp_clean) != 8:
        return ""
    right_clean = str(right).strip().upper()
    if right_clean in ("CALL", "C"):
        rl = "C"
    elif right_clean in ("PUT", "P"):
        rl = "P"
    else:
        return ""
    try:
        strike_int = int(round(float(strike) * 1000))
    except Exception:
        return ""
    return f"{str(root).strip().upper()}{exp_clean[2:]}{rl}{strike_int:08d}"


async def fetch_theta_option_eod(
    contract: Dict, start_date, end_date
) -> List[Dict]:
    """获取单个 option contract 的 EOD 历史数据 (串行 ThetaData 调用，按年分批)."""
    import datetime as _dt
    occ = contract.get("occ")
    if not occ:
        return []
    try:
        client = await _get_theta_client()
        exp_str = str(contract["expiration"]).replace("-", "").strip()
        exp_date = _dt.datetime.strptime(exp_str, "%Y%m%d").date()
        loop = asyncio.get_event_loop()

        all_bars = []
        # ThetaData EOD 限制每次最多 365 天
        current = start_date
        while current <= end_date:
            batch_end = min(current + _dt.timedelta(days=365), end_date)
            df = await _theta_call(
                loop,
                lambda s=current, e=batch_end: client.option_history_eod(
                    symbol=contract["root"],
                    expiration=exp_date,
                    start_date=s,
                    end_date=e,
                    strike=str(int(float(contract["strike"]))),
                    right=contract["right"],
                )
            )
            if df is not None and len(df) > 0:
                df = df.to_pandas() if hasattr(df, "to_pandas") else df
                for _, row in df.iterrows():
                    # EOD 数据的 created 列是带时区的时间戳
                    ts_val = row.get("created")
                    if hasattr(ts_val, "astimezone"):
                        ts = ts_val.astimezone(_dt.timezone.utc)
                    elif hasattr(ts_val, "strftime"):
                        ts = _dt.datetime.strptime(ts_val.strftime("%Y-%m-%dT%H:%M:%S"), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=_dt.timezone.utc)
                    else:
                        ts = _dt.datetime.strptime(str(ts_val).split("+")[0].split(".")[0], "%Y-%m-%d %H:%M:%S").replace(tzinfo=_dt.timezone.utc)
                    all_bars.append({
                        "t": ts,
                        "o": float(row.get("open", 0)),
                        "h": float(row.get("high", 0)),
                        "l": float(row.get("low", 0)),
                        "c": float(row.get("close", 0)),
                        "v": int(row.get("volume", 0)),
                        "n": int(row.get("count", 0)),
                        "oi": None,  # EOD 没有 open_interest
                    })
            current = batch_end + _dt.timedelta(days=1)
        return all_bars
    except Exception as e:
        msg = str(e)
        if "No data found" in msg or "not found" in msg.lower():
            pass
        else:
            print(f"[V4] Option EOD error {occ}: {e}")
        return []


async def get_options_db_coverage(pool, occ: str, timeframe: str = "1Min") -> Tuple[Optional[datetime], int]:
    """获取某个 option contract 的 DB coverage."""
    if pool is None:
        return None, 0
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT MAX(ts), COUNT(*) FROM options_bars WHERE symbol = $1 AND timeframe = $2",
            occ, timeframe,
        )
    return row[0], row[1]


def options_bars_to_db_records(contracts: List[Dict], all_bars: Dict[str, List[Dict]], timeframe: str) -> List[Tuple]:
    from datetime import datetime
    records = []
    for contract in contracts:
        occ = contract.get("occ")
        bars = all_bars.get(occ, [])
        for bar in bars:
            ts_str = bar.get("t", "")
            if not ts_str:
                continue
            ts_str = ts_str.replace("Z", "+00:00")
            try:
                ts = datetime.fromisoformat(ts_str)
            except Exception:
                continue
            records.append((
                occ,
                contract["root"].upper(),
                contract["expiration"],
                float(contract["strike"]),
                "call" if contract["right"].upper() in ("C", "CALL") else "put",
                timeframe,
                ts,
                bar.get("o"), bar.get("h"), bar.get("l"), bar.get("c"),
                bar.get("v"), None, bar.get("n"), bar.get("oi"),
                "opra", "thetadata",
            ))
    return records


# ============================================================
# 回填逻辑
# ============================================================

async def backfill_bars(pool, session: aiohttp.ClientSession, symbols: List[str], timeframes: List[str],
                        token: str, days_back: int, dry_run: bool, rate: float, parallel: int = 20) -> dict:
    """回填股票 minute bars (并发模式，key pool 自动处理限流)."""
    print(f"\n[Bars] Backfilling {len(symbols)} symbols x {len(timeframes)} timeframes, {days_back} days back, parallel={parallel}")
    stats = {"inserted": 0, "fetched": 0, "errors": 0, "skipped": 0}
    lock = asyncio.Lock()
    sem = asyncio.Semaphore(parallel)

    async def _process(symbol: str, tf: str):
        async with sem:
            # 确定回填范围
            earliest, latest, count = await get_db_coverage(pool, symbol, tf, "bars")
            end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            if latest is None:
                start_date = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%Y-%m-%d")
            else:
                next_day = (latest.date() if hasattr(latest, "date") else latest) + timedelta(days=1)
                start_date = next_day.strftime("%Y-%m-%d")
                if start_date >= end_date:
                    async with lock:
                        stats["skipped"] += 1
                    return

            bars = await fetch_bars_from_alpaca(session, symbol, tf, start_date, end_date)
            if bars is None:
                async with lock:
                    stats["errors"] += 1
                return
            if len(bars) == 0:
                async with lock:
                    stats["skipped"] += 1
                return

            records = bars_to_db_records(symbol, tf, bars)
            async with lock:
                stats["fetched"] += len(bars)

            if dry_run:
                print(f"  [DRY] {symbol} {tf}: would insert {len(records)}")
                return

            if pool and records:
                try:
                    inserted = await copy_bars_to_db(pool, records)
                    async with lock:
                        stats["inserted"] += inserted
                    print(f"  {symbol} {tf}: inserted {inserted}/{len(records)} (range {start_date}~{end_date})")
                except Exception as e:
                    print(f"  {symbol} {tf}: insert error {e}")
                    async with lock:
                        stats["errors"] += 1

    tasks = []
    for symbol in symbols:
        for tf in timeframes:
            tasks.append(_process(symbol, tf))
    await asyncio.gather(*tasks, return_exceptions=True)
    return stats


async def backfill_quotes(pool, session: aiohttp.ClientSession, symbols: List[str],
                          token: str, days_back: int, dry_run: bool, rate: float) -> dict:
    """回填 stock quotes (两年历史)."""
    print(f"\n[Quotes] Backfilling {len(symbols)} symbols, {days_back} days back")
    stats = {"inserted": 0, "fetched": 0, "errors": 0}
    min_interval = 1.0 / rate
    last_req = 0

    # 分批处理，每次处理 30 天的范围 (避免单次请求太大)
    batch_days = 30
    today = datetime.now(timezone.utc).date()

    for symbol in symbols:
        for batch_start in range(0, days_back, batch_days):
            end_offset = min(batch_start + batch_days, days_back)
            end_date = (today - timedelta(days=batch_start)).strftime("%Y-%m-%d")
            start_date = (today - timedelta(days=end_offset)).strftime("%Y-%m-%d")

            elapsed = time.time() - last_req
            if elapsed < min_interval:
                await asyncio.sleep(min_interval - elapsed)
            last_req = time.time()

            quotes = await fetch_quotes_via_proxy(session, token, symbol, start_date, end_date)
            if quotes is None:
                stats["errors"] += 1
                continue

            records = quotes_to_db_records(quotes, symbol)
            stats["fetched"] += len(quotes)

            if dry_run:
                print(f"  [DRY] {symbol} {start_date}~{end_date}: would upsert {len(records)} quotes")
                continue

            if pool and records:
                try:
                    inserted = await upsert_quotes_batch(pool, records)
                    stats["inserted"] += inserted
                    print(f"  {symbol} {start_date}~{end_date}: upserted {inserted} quotes")
                except Exception as e:
                    print(f"  {symbol}: quote insert error {e}")
                    stats["errors"] += 1

    return stats


async def backfill_options(pool, session: aiohttp.ClientSession, underlyings: List[str],
                           token: str, days_back: int, dry_run: bool, rate: float,
                           parallel: int = 1) -> dict:
    """回填 options snapshots (串行 ThetaData + 增量，保留完整期权链)."""
    print(f"\n[Options] Backfilling {len(underlyings)} underlyings, max DTE {days_back} days, parallel={parallel}")
    stats = {"contracts": 0, "inserted": 0, "fetched": 0, "errors": 0, "skipped": 0}
    lock = asyncio.Lock()
    sem = asyncio.Semaphore(parallel)

    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=days_back)

    async def _process_contract(contract: Dict, tf: str = "1Day"):
        occ = contract.get("occ")
        if not occ:
            return
        async with sem:
            # 解析 expiration date
            import datetime as _dt
            exp_str = str(contract["expiration"]).replace("-", "").strip()
            try:
                exp_date = _dt.datetime.strptime(exp_str, "%Y%m%d").date()
            except Exception:
                return

            # 期权 contract 通常在 expiration 前 90-180 天上市
            # 保守起见，只请求 expiration 前 180 天到期的数据
            earliest_listing = exp_date - timedelta(days=180)

            # 增量检查
            latest_ts, count = await get_options_db_coverage(pool, occ, tf)
            if latest_ts is not None:
                next_day = (latest_ts.date() if hasattr(latest_ts, "date") else latest_ts) + timedelta(days=1)
                contract_start = max(start_date.date(), earliest_listing, next_day)
            else:
                contract_start = max(start_date.date(), earliest_listing)
            contract_end = min(end_date.date(), exp_date)

            if contract_start >= contract_end:
                async with lock:
                    stats["skipped"] += 1
                return

            bars = await fetch_theta_option_eod(
                contract, contract_start, contract_end
            )

            if not bars:
                return

            async with lock:
                stats["fetched"] += len(bars)

            if dry_run:
                print(f"  [DRY] {occ}: would insert {len(bars)} bars")
                return

            # 构建单 contract 的 records
            records = []
            for bar in bars:
                ts_str = bar.get("t", "").replace("Z", "+00:00")
                try:
                    ts = datetime.fromisoformat(ts_str)
                except Exception:
                    continue
                records.append((
                    occ,
                    contract["root"].upper(),
                    contract["expiration"],
                    float(contract["strike"]),
                    "call" if contract["right"].upper() in ("C", "CALL") else "put",
                    tf,
                    ts,
                    bar.get("o"), bar.get("h"), bar.get("l"), bar.get("c"),
                    bar.get("v"), None, bar.get("n"), bar.get("oi"),
                    "opra", "thetadata",
                ))

            if pool and records:
                try:
                    inserted = await copy_options_bars_to_db(pool, records)
                    async with lock:
                        stats["inserted"] += inserted
                    print(f"  {occ}: inserted {inserted}/{len(records)} ({contract_start}~{contract_end})")
                except Exception as e:
                    print(f"  {occ}: insert error {e}")
                    async with lock:
                        stats["errors"] += 1

    for underlying in underlyings:
        print(f"  Fetching option chain for {underlying}...")
        contracts = await fetch_theta_option_chain(underlying, max_dte=days_back, limit=2000)
        if not contracts:
            print(f"    No contracts found for {underlying}")
            continue

        print(f"    Found {len(contracts)} contracts")
        async with lock:
            stats["contracts"] += len(contracts)

        # 写入期权链元数据
        if pool and contracts and not dry_run:
            try:
                await upsert_option_contracts(pool, contracts)
            except Exception as e:
                print(f"    Option contracts upsert error: {e}")

        if dry_run:
            total_est = len(contracts) * 200  # rough estimate
            print(f"    [DRY] Would process ~{total_est} bars for {len(contracts)} contracts")
            continue

        # 串行处理所有 contracts (EOD 日级数据)
        tasks = [_process_contract(c, "1Day") for c in contracts]
        await asyncio.gather(*tasks, return_exceptions=True)
        print(f"    {underlying} done: {stats['inserted']} total inserted so far")

    return stats


# ============================================================
# 主流程
# ============================================================

async def main():
    parser = argparse.ArgumentParser(description="Smart Warmer v4 — Full Universe Backfill")
    parser.add_argument("--token", required=True, help="Proxy auth token")
    parser.add_argument("--data-types", default="bars", help="Comma-separated: bars,quotes,options")
    parser.add_argument("--symbols-source", default="lean,ndx100,sp500", help="lean,ndx100,sp500")
    parser.add_argument("--lean-file", help="Path to lean universe Python file")
    parser.add_argument("--days-back", type=int, default=BARS_DAYS_BACK, help="Days to backfill")
    parser.add_argument("--timeframes", default=",".join(DEFAULT_TIMEFRAMES), help="Timeframes")
    parser.add_argument("--rate", type=float, default=RATE_LIMIT_REQ_PER_SEC, help="Req/s (key pool auto-throttles)")
    parser.add_argument("--parallel", type=int, default=MAX_PARALLEL, help="Concurrent workers")
    parser.add_argument("--options-underlyings", default="SPX,NDX,QQQ,SPY", help="Option underlyings")
    parser.add_argument("--options-max-dte", type=int, default=730, help="Max days to expiry")
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    parser.add_argument("--batch-size", type=int, default=5000, help="DB batch size")
    args = parser.parse_args()

    data_types = [d.strip() for d in args.data_types.split(",")]
    symbol_sources = [s.strip() for s in args.symbols_source.split(",")]
    timeframes = [t.strip() for t in args.timeframes.split(",")]

    print("=" * 60)
    print("Smart Warmer v4 — Full Universe Backfill")
    print("=" * 60)
    print(f"Data types: {data_types}")
    print(f"Symbol sources: {symbol_sources}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"Rate: {args.rate} req/s, Parallel: {args.parallel}")

    # 连接 DB
    pool = await get_db_pool()
    if pool:
        print(f"[V4] TimescaleDB connected")
    else:
        print("[V4] DB not available")

    # 加载 symbols
    include_lean = "lean" in symbol_sources
    include_ndx = "ndx100" in symbol_sources or "nasdaq100" in symbol_sources
    include_sp = "sp500" in symbol_sources

    symbols, ticker_stats = await load_all_tickers(
        include_lean=include_lean,
        include_sp500=include_sp,
        include_ndx100=include_ndx,
        lean_file=args.lean_file,
    )
    print(f"[V4] Symbols: {ticker_stats}")

    async with aiohttp.ClientSession() as session:
        all_stats = {}

        if "bars" in data_types:
            all_stats["bars"] = await backfill_bars(
                pool, session, symbols, timeframes, args.token,
                args.days_back, args.dry_run, args.rate, args.parallel,
            )

        if "quotes" in data_types:
            all_stats["quotes"] = await backfill_quotes(
                pool, session, symbols, args.token,
                args.days_back, args.dry_run, args.rate,
            )

        if "options" in data_types:
            underlyings = [u.strip().upper() for u in args.options_underlyings.split(",")]
            all_stats["options"] = await backfill_options(
                pool, session, underlyings, args.token,
                args.options_max_dte, args.dry_run, args.rate, args.parallel,
            )

    if pool:
        await pool.close()

    print("\n" + "=" * 60)
    print("Backfill Summary")
    print("=" * 60)
    for dtype, stats in all_stats.items():
        print(f"\n{dtype.upper()}:")
        for k, v in stats.items():
            print(f"  {k}: {v}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
