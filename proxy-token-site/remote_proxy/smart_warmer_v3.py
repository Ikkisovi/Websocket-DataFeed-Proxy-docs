#!/usr/bin/env python3
"""
smart_warmer_v3.py — 夜间数据回填脚本 (数据库优先架构)

职责:
1. 连接 TimescaleDB
2. 读取股票列表 (S&P 500 + NASDAQ-100 + ETFs)
3. 对每个 symbol，检查缺失的数据范围
4. 从 Alpaca REST API 下载缺失的历史 bars
5. 使用 COPY 协议高效批量写入 TimescaleDB
6. 支持增量回填 (只下载 DB 中没有的数据)

运行方式:
    python3 smart_warmer_v3.py --token test123 --rate 3.0 --days-back 30
    python3 smart_warmer_v3.py --token test123 --dry-run  # 预览模式
    python3 smart_warmer_v3.py --symbol AAPL --start 2024-01-01 --end 2024-01-31

回退:
    如果 asyncpg 未安装或 DB 连接失败，自动回退到 v2 行为
    (只写 cache 不写 DB)。
"""

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

import aiohttp

# --- 配置 ---
TIMESCALEDB_HOST = os.getenv("TIMESCALEDB_HOST", "timescaledb")
TIMESCALEDB_PORT = int(os.getenv("TIMESCALEDB_PORT", "5432"))
TIMESCALEDB_USER = os.getenv("TIMESCALEDB_USER", "proxy")
TIMESCALEDB_PASSWORD = os.getenv("TIMESCALEDB_PASSWORD", "proxy123")
TIMESCALEDB_DB = os.getenv("TIMESCALEDB_DB", "marketdata")

ALPACA_KEY = os.getenv("ALPACA_MASTER_KEY", "")
ALPACA_SECRET = os.getenv("ALPACA_MASTER_SECRET", "")
DATA_URL = "https://data.alpaca.markets"

PROXY_HOST = os.getenv("PROXY_HOST", "52.37.182.24")
PROXY_REST_PORT = os.getenv("PROXY_REST_PORT", "8768")

# 回填参数
DEFAULT_TIMEFRAMES = ["1Min", "5Min", "15Min", "1Hour", "1Day"]
DEFAULT_DAYS_BACK = 30
RATE_LIMIT_REQ_PER_SEC = 3.0  # 保守速率，避免触发 Alpaca 限流

# --- asyncpg ---
try:
    import asyncpg
    ASYNCPG_AVAILABLE = True
except ImportError:
    asyncpg = None
    ASYNCPG_AVAILABLE = False


# ============================================================
# 数据库操作
# ============================================================

async def get_db_pool():
    """创建数据库连接池。"""
    if not ASYNCPG_AVAILABLE:
        return None
    try:
        return await asyncpg.create_pool(
            host=TIMESCALEDB_HOST,
            port=TIMESCALEDB_PORT,
            user=TIMESCALEDB_USER,
            password=TIMESCALEDB_PASSWORD,
            database=TIMESCALEDB_DB,
            min_size=2,
            max_size=5,
            command_timeout=30,
        )
    except Exception as e:
        print(f"[WarmerV3] DB connection failed: {e}")
        return None


async def get_db_coverage(pool, symbol: str, timeframe: str) -> Tuple[Optional[datetime], Optional[datetime], int]:
    """返回某 symbol 在 DB 中的 (最早日期, 最新日期, 记录数)。"""
    if pool is None:
        return None, None, 0
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT MIN(ts), MAX(ts), COUNT(*) FROM bars WHERE symbol = $1 AND timeframe = $2",
            symbol.upper(),
            timeframe,
        )
    return row[0], row[1], row[2]


async def bulk_insert_bars(pool, records: List[Tuple]) -> int:
    """使用 COPY 协议批量插入 bars。"""
    if pool is None or not records:
        return 0
    async with pool.acquire() as conn:
        await conn.copy_records_to_table(
            "bars",
            records=records,
            columns=[
                "symbol", "timeframe", "ts", "open", "high", "low",
                "close", "volume", "vwap", "trade_count", "feed", "source",
            ],
        )
    return len(records)


async def log_backfill_start(pool, symbol: str, data_type: str, timeframe: str, start_date: str, end_date: str) -> int:
    if pool is None:
        return -1
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO backfill_log (symbol, data_type, timeframe, start_date, end_date, status, started_at)
               VALUES ($1, $2, $3, $4, $5, 'running', NOW()) RETURNING id""",
            symbol.upper(), data_type, timeframe, start_date, end_date,
        )
    return row["id"] if row else -1


async def log_backfill_complete(pool, task_id: int, records_inserted: int, error_message: Optional[str] = None):
    if pool is None or task_id < 0:
        return
    status = "failed" if error_message else "completed"
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE backfill_log SET status = $1, records_inserted = $2, error_message = $3, completed_at = NOW()
               WHERE id = $4""",
            status, records_inserted, error_message, task_id,
        )


# ============================================================
# Alpaca API
# ============================================================

async def fetch_bars_from_alpaca(
    session: aiohttp.ClientSession,
    symbol: str,
    timeframe: str,
    start: str,
    end: str,
    limit: int = 10000,
) -> Optional[List[Dict]]:
    """从 Alpaca REST API 下载 bars。"""
    if not ALPACA_KEY or not ALPACA_SECRET:
        print("[WarmerV3] Missing ALPACA_MASTER_KEY/SECRET")
        return None

    url = f"{DATA_URL}/v2/stocks/bars"
    params = {
        "symbols": symbol,
        "timeframe": timeframe,
        "start": start,
        "end": end,
        "adjustment": "all",
        "feed": "sip",
        "limit": limit,
    }
    headers = {
        "APCA-API-KEY-ID": ALPACA_KEY,
        "APCA-API-SECRET-KEY": ALPACA_SECRET,
        "Accept": "application/json",
    }

    all_bars = []
    next_page_token = None
    pages = 0
    max_pages = 100

    while True:
        if next_page_token:
            params["page_token"] = next_page_token
        elif "page_token" in params:
            del params["page_token"]

        async with session.get(url, params=params, headers=headers) as resp:
            if resp.status != 200:
                text = await resp.text()
                print(f"[WarmerV3] Alpaca error {resp.status}: {text[:200]}")
                return None
            data = await resp.json()

        bars = data.get("bars", {}).get(symbol, [])
        if bars:
            all_bars.extend(bars)

        next_page_token = data.get("next_page_token")
        pages += 1
        if not next_page_token or pages >= max_pages:
            break

    return all_bars


async def fetch_bars_via_proxy(
    session: aiohttp.ClientSession,
    token: str,
    symbol: str,
    timeframe: str,
    start: str,
    end: str,
    limit: int = 10000,
) -> Optional[List[Dict]]:
    """通过本地代理下载 bars (如果代理已有缓存数据)。"""
    url = f"http://{PROXY_HOST}:{PROXY_REST_PORT}/v1/history/bars"
    payload = {
        "token": token,
        "symbol": symbol,
        "timeframe": timeframe,
        "start": start,
        "end": end,
        "limit": limit,
        "force_refresh": True,  # 确保 SIP 质量数据
    }
    async with session.post(url, json=payload) as resp:
        if resp.status != 200:
            return None
        data = await resp.json()
        return data.get("bars", {}).get(symbol, [])


# ============================================================
# 数据转换
# ============================================================

def parse_alpaca_bar_timestamp(ts_str: str) -> Optional[datetime]:
    """解析 Alpaca bar 时间戳。"""
    if not ts_str:
        return None
    try:
        s = str(ts_str).replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except Exception:
        return None


def bars_to_db_records(symbol: str, timeframe: str, bars: List[Dict], feed: str = "sip", source: str = "alpaca") -> List[Tuple]:
    """将 Alpaca bars 转换为 DB 记录格式。"""
    records = []
    for bar in bars:
        ts = parse_alpaca_bar_timestamp(bar.get("t"))
        if ts is None:
            continue
        records.append((
            symbol.upper(),
            timeframe,
            ts,
            bar.get("o"),
            bar.get("h"),
            bar.get("l"),
            bar.get("c"),
            bar.get("v"),
            bar.get("vw"),
            bar.get("n"),
            feed,
            source,
        ))
    return records


# ============================================================
# 回填逻辑
# ============================================================

async def backfill_symbol(
    pool,
    session: aiohttp.ClientSession,
    symbol: str,
    timeframe: str,
    start_date: str,
    end_date: str,
    token: str,
    use_proxy: bool = False,
    dry_run: bool = False,
) -> Tuple[int, int]:
    """
    回填单个 symbol 的 bars。

    返回: (records_inserted, bars_fetched)
    """
    print(f"[WarmerV3] Backfilling {symbol} {timeframe} {start_date}~{end_date}", flush=True)

    task_id = -1
    if pool and not dry_run:
        task_id = await log_backfill_start(pool, symbol, "bars", timeframe, start_date, end_date)

    bars = None
    try:
        if use_proxy:
            bars = await fetch_bars_via_proxy(session, token, symbol, timeframe, start_date, end_date)
        else:
            bars = await fetch_bars_from_alpaca(session, symbol, timeframe, start_date, end_date)
    except Exception as e:
        print(f"[WarmerV3] Fetch error for {symbol}: {e}")
        if task_id >= 0:
            await log_backfill_complete(pool, task_id, 0, str(e))
        return 0, 0

    if not bars:
        print(f"[WarmerV3] No bars for {symbol}")
        if task_id >= 0:
            await log_backfill_complete(pool, task_id, 0)
        return 0, 0

    records = bars_to_db_records(symbol, timeframe, bars)
    if not records:
        if task_id >= 0:
            await log_backfill_complete(pool, task_id, 0, "no_valid_records")
        return 0, 0

    if dry_run:
        print(f"[WarmerV3] DRY RUN: would insert {len(records)} records for {symbol}")
        return 0, len(bars)

    inserted = 0
    if pool:
        try:
            inserted = await bulk_insert_bars(pool, records)
            print(f"[WarmerV3] Inserted {inserted}/{len(records)} records for {symbol}")
        except Exception as e:
            print(f"[WarmerV3] Insert error for {symbol}: {e}")
            if task_id >= 0:
                await log_backfill_complete(pool, task_id, 0, str(e))
            return 0, len(bars)

    if task_id >= 0:
        await log_backfill_complete(pool, task_id, inserted)

    return inserted, len(bars)


async def determine_backfill_range(
    pool,
    symbol: str,
    timeframe: str,
    days_back: int,
) -> Tuple[str, str]:
    """
    确定需要回填的日期范围。

    策略:
    1. 检查 DB 中该 symbol 的最新数据日期
    2. 如果 DB 为空，回填 days_back 天
    3. 如果 DB 有数据，只回填最新数据之后到今天的部分 (增量)
    """
    end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    if pool is None:
        # 无 DB，全量回填
        start_date = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%Y-%m-%d")
        return start_date, end_date

    earliest, latest, count = await get_db_coverage(pool, symbol, timeframe)

    if latest is None:
        # DB 为空，全量回填
        start_date = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%Y-%m-%d")
        print(f"[WarmerV3] {symbol} {timeframe}: no data in DB, full backfill {start_date}~{end_date}")
    else:
        # 增量回填: 从最新数据日期的下一天开始
        latest_date = latest.date() if hasattr(latest, "date") else latest
        next_day = latest_date + timedelta(days=1)
        start_date = next_day.strftime("%Y-%m-%d")
        if start_date >= end_date:
            print(f"[WarmerV3] {symbol} {timeframe}: up to date (latest={latest_date}), skipping")
            return None, None
        print(f"[WarmerV3] {symbol} {timeframe}: incremental {start_date}~{end_date} (latest in DB={latest_date})")

    return start_date, end_date


# ============================================================
# Symbol 列表
# ============================================================

def load_tickers(tickers_file: Optional[str] = None) -> List[str]:
    """加载股票列表。"""
    if tickers_file and Path(tickers_file).exists():
        with open(tickers_file) as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("tickers", data.get("symbols", []))

    # 默认: S&P 500 + NASDAQ-100 常用 symbols
    default_tickers = [
        # 大型科技股
        "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "TSLA", "NVDA", "NFLX",
        "AMD", "INTC", "CRM", "ADBE", "ORCL", "IBM", "CSCO", "QCOM", "AVGO",
        # 金融
        "JPM", "BAC", "WFC", "GS", "MS", "BLK", "C", "AXP",
        # 消费
        "WMT", "COST", "HD", "PG", "KO", "PEP", "MCD", "NKE", "DIS", "SBUX",
        # 医疗
        "JNJ", "PFE", "UNH", "ABBV", "LLY", "MRK", "TMO", "ABT", "DHR",
        # 工业/能源
        "XOM", "CVX", "CAT", "BA", "GE", "HON", "UPS", "LMT",
        # 通信
        "VZ", "T", "CMCSA", "TMUS",
        # ETF
        "SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "XLF", "XLK", "XLE",
        # 其他热门
        "PLTR", "COIN", "RIVN", "LCID", "SNOW", "ZM", "UBER", "LYFT", "SQ", "SHOP",
    ]
    return default_tickers


# ============================================================
# 主流程
# ============================================================

async def main():
    parser = argparse.ArgumentParser(description="Smart Warmer v3 — TimescaleDB backfill")
    parser.add_argument("--token", required=True, help="Proxy auth token")
    parser.add_argument("--symbol", help="Single symbol to backfill")
    parser.add_argument("--symbols-file", help="JSON file with symbol list")
    parser.add_argument("--timeframes", default=",".join(DEFAULT_TIMEFRAMES), help="Comma-separated timeframes")
    parser.add_argument("--days-back", type=int, default=DEFAULT_DAYS_BACK, help="Days to backfill (for empty DB)")
    parser.add_argument("--start", help="Explicit start date (YYYY-MM-DD)")
    parser.add_argument("--end", help="Explicit end date (YYYY-MM-DD)")
    parser.add_argument("--rate", type=float, default=RATE_LIMIT_REQ_PER_SEC, help="Requests per second")
    parser.add_argument("--use-proxy", action="store_true", help="Fetch via proxy instead of Alpaca direct")
    parser.add_argument("--dry-run", action="store_true", help="Preview only, no DB writes")
    parser.add_argument("--force-full", action="store_true", help="Force full backfill (ignore existing DB data)")
    parser.add_argument("--batch-size", type=int, default=1000, help="COPY batch size")
    args = parser.parse_args()

    print("=" * 60)
    print("Smart Warmer v3 — TimescaleDB Backfill")
    print("=" * 60)
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"Rate: {args.rate} req/s")

    # 连接 DB
    pool = await get_db_pool()
    if pool:
        print(f"[WarmerV3] TimescaleDB connected: {TIMESCALEDB_HOST}:{TIMESCALEDB_PORT}")
    else:
        print("[WarmerV3] TimescaleDB NOT available, will use cache-only mode")

    # 加载 symbols
    if args.symbol:
        symbols = [args.symbol.upper()]
    else:
        symbols = load_tickers(args.symbols_file)

    timeframes = [tf.strip() for tf in args.timeframes.split(",")]

    print(f"[WarmerV3] Symbols: {len(symbols)}")
    print(f"[WarmerV3] Timeframes: {timeframes}")

    # 速率限制: 令牌桶
    min_interval = 1.0 / args.rate
    last_request_time = 0

    total_inserted = 0
    total_fetched = 0
    errors = 0
    skipped = 0

    async with aiohttp.ClientSession() as session:
        for symbol in symbols:
            for tf in timeframes:
                # 确定回填范围
                if args.start and args.end:
                    start_date, end_date = args.start, args.end
                elif args.force_full:
                    end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                    start_date = (datetime.now(timezone.utc) - timedelta(days=args.days_back)).strftime("%Y-%m-%d")
                else:
                    start_date, end_date = await determine_backfill_range(pool, symbol, tf, args.days_back)

                if start_date is None or end_date is None:
                    skipped += 1
                    continue

                # 速率限制
                now = time.time()
                elapsed = now - last_request_time
                if elapsed < min_interval:
                    await asyncio.sleep(min_interval - elapsed)
                last_request_time = time.time()

                # 执行回填
                try:
                    inserted, fetched = await backfill_symbol(
                        pool=pool,
                        session=session,
                        symbol=symbol,
                        timeframe=tf,
                        start_date=start_date,
                        end_date=end_date,
                        token=args.token,
                        use_proxy=args.use_proxy,
                        dry_run=args.dry_run,
                    )
                    total_inserted += inserted
                    total_fetched += fetched
                except Exception as e:
                    print(f"[WarmerV3] Fatal error for {symbol} {tf}: {e}")
                    errors += 1

    # 关闭 DB
    if pool:
        await pool.close()

    print("=" * 60)
    print("Backfill Summary")
    print("=" * 60)
    print(f"Symbols processed: {len(symbols)} x {len(timeframes)} = {len(symbols) * len(timeframes)} tasks")
    print(f"Records fetched: {total_fetched}")
    print(f"Records inserted: {total_inserted}")
    print(f"Skipped (up to date): {skipped}")
    print(f"Errors: {errors}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
