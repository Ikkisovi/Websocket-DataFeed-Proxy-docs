#!/usr/bin/env python3
"""
TimescaleDB 数据库管理器 - 数据库优先架构核心模块

职责:
1. 管理 asyncpg 连接池
2. 提供 Bars/Options Bars 查询接口 (REST API 优先使用)
3. 提供批量插入接口 (WS 数据写入 + 夜间回填)
4. 提供最新报价更新接口

设计原则:
- 所有查询使用预编译语句防止 SQL 注入
- 批量插入使用 executemany 或 COPY 协议
- 连接池自动回收和重连
- 失败时优雅降级 (fallback 到上游)
"""

import asyncio
import os
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Tuple

# asyncpg 是高性能异步 PostgreSQL 驱动
try:
    import asyncpg
    ASYNCPG_AVAILABLE = True
except ImportError:
    asyncpg = None
    ASYNCPG_AVAILABLE = False

# --- 配置 ---
DB_HOST = os.getenv("TIMESCALEDB_HOST", "timescaledb")
DB_PORT = int(os.getenv("TIMESCALEDB_PORT", "5432"))
DB_USER = os.getenv("TIMESCALEDB_USER", "proxy")
DB_PASSWORD = os.getenv("TIMESCALEDB_PASSWORD", "proxy123")
DB_NAME = os.getenv("TIMESCALEDB_DB", "marketdata")
DB_ENABLED = os.getenv("DB_ENABLED", "false").lower() in ("true", "1", "yes")

DB_POOL_MIN_SIZE = int(os.getenv("DB_POOL_MIN_SIZE", "5"))
DB_POOL_MAX_SIZE = int(os.getenv("DB_POOL_MAX_SIZE", "20"))
DB_QUERY_TIMEOUT = float(os.getenv("DB_QUERY_TIMEOUT", "5.0"))

# --- 全局状态 ---
_db_pool: Optional[Any] = None
_db_lock = asyncio.Lock()
_db_initialized = False


async def get_db_pool() -> Optional[Any]:
    """获取或创建数据库连接池。线程安全。"""
    global _db_pool, _db_initialized

    if not DB_ENABLED:
        return None
    if not ASYNCPG_AVAILABLE:
        if not _db_initialized:
            print("[DB] asyncpg not installed, DB features disabled")
            _db_initialized = True
        return None
    if _db_pool is not None:
        return _db_pool

    async with _db_lock:
        if _db_pool is not None:
            return _db_pool
        try:
            _db_pool = await asyncpg.create_pool(
                host=DB_HOST,
                port=DB_PORT,
                user=DB_USER,
                password=DB_PASSWORD,
                database=DB_NAME,
                min_size=DB_POOL_MIN_SIZE,
                max_size=DB_POOL_MAX_SIZE,
                command_timeout=DB_QUERY_TIMEOUT,
                # 连接健康检查
                server_settings={
                    "application_name": "alpaca_cloud_proxy",
                    "jit": "off",  # JIT 编译对短查询有开销
                },
            )
            # 验证连接
            async with _db_pool.acquire() as conn:
                version = await conn.fetchval("SELECT version()")
                print(f"[DB] Connected to TimescaleDB: {version[:50]}...", flush=True)
                # 检查 TimescaleDB 扩展
                ext = await conn.fetchval(
                    "SELECT installed_version FROM pg_available_extensions WHERE name='timescaledb'"
                )
                print(f"[DB] TimescaleDB extension: {ext}", flush=True)

            _db_initialized = True
            print(f"[DB] Pool created: min={DB_POOL_MIN_SIZE}, max={DB_POOL_MAX_SIZE}", flush=True)
            return _db_pool
        except Exception as e:
            print(f"[DB] Failed to connect: {e}", flush=True)
            _db_initialized = True
            return None


async def close_db_pool():
    """关闭连接池。用于优雅退出。"""
    global _db_pool
    if _db_pool is not None:
        await _db_pool.close()
        _db_pool = None
        print("[DB] Pool closed", flush=True)


# ============================================================
# 查询接口 - REST API handler 调用
# ============================================================

async def query_bars(
    symbol: str,
    timeframe: str,
    start: str,
    end: str,
    limit: int = 10000,
) -> Optional[Dict[str, Any]]:
    """
    从 TimescaleDB 查询股票 bars。

    返回 Alpaca 格式: {"bars": {"SYMBOL": [{"t":"...","o":...,"h":...,"l":...,"c":...,"v":...,"vw":...,"n":...}]}}

    如果数据库中没有数据，返回 None (handler 会回退到上游)。
    """
    pool = await get_db_pool()
    if pool is None:
        return None

    try:
        # 解析时间字符串
        start_dt = _parse_datetime(start)
        end_dt = _parse_datetime(end)
        if start_dt is None or end_dt is None:
            return None
        # 如果 end 只有日期部分（如 "2024-01-15"），自动设为当天 23:59:59
        # 这样 "BETWEEN start AND end" 能包含 end 当天的所有数据
        if end_dt.hour == 0 and end_dt.minute == 0 and end_dt.second == 0:
            end_dt = end_dt.replace(hour=23, minute=59, second=59, microsecond=999999)

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT ts, open, high, low, close, volume, vwap, trade_count
                FROM bars
                WHERE symbol = $1 AND timeframe = $2 AND ts BETWEEN $3 AND $4
                ORDER BY ts DESC
                LIMIT $5
                """,
                symbol.upper(),
                timeframe,
                start_dt,
                end_dt,
                limit,
            )

        if not rows:
            return None

        bars_list = []
        for row in rows:
            bar = {
                "t": _format_timestamp(row["ts"]),
                "o": float(row["open"]) if row["open"] is not None else None,
                "h": float(row["high"]) if row["high"] is not None else None,
                "l": float(row["low"]) if row["low"] is not None else None,
                "c": float(row["close"]) if row["close"] is not None else None,
                "v": int(row["volume"]) if row["volume"] is not None else None,
            }
            if row["vwap"] is not None:
                bar["vw"] = float(row["vwap"])
            if row["trade_count"] is not None:
                bar["n"] = int(row["trade_count"])
            bars_list.append(bar)

        # 按时间升序排列 (Alpaca 默认格式)
        bars_list.reverse()

        return {"bars": {symbol.upper(): bars_list}, "pages": 1, "db_source": True}

    except Exception as e:
        print(f"[DB] query_bars error for {symbol}: {e}", flush=True)
        return None


async def query_options_bars(
    symbol: str,
    timeframe: str,
    start: str,
    end: str,
    limit: int = 10000,
) -> Optional[Dict[str, Any]]:
    """从 TimescaleDB 查询期权 bars。返回 Alpaca 格式。"""
    pool = await get_db_pool()
    if pool is None:
        return None

    try:
        start_dt = _parse_datetime(start)
        end_dt = _parse_datetime(end)
        if start_dt is None or end_dt is None:
            return None
        # 如果 end 只有日期部分，自动设为当天 23:59:59
        if end_dt.hour == 0 and end_dt.minute == 0 and end_dt.second == 0:
            end_dt = end_dt.replace(hour=23, minute=59, second=59, microsecond=999999)

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT ts, open, high, low, close, volume, vwap, trade_count, open_interest
                FROM options_bars
                WHERE symbol = $1 AND timeframe = $2 AND ts BETWEEN $3 AND $4
                ORDER BY ts DESC
                LIMIT $5
                """,
                symbol.upper(),
                timeframe,
                start_dt,
                end_dt,
                limit,
            )

        if not rows:
            return None

        bars_list = []
        for row in rows:
            bar = {
                "t": _format_timestamp(row["ts"]),
                "o": float(row["open"]) if row["open"] is not None else None,
                "h": float(row["high"]) if row["high"] is not None else None,
                "l": float(row["low"]) if row["low"] is not None else None,
                "c": float(row["close"]) if row["close"] is not None else None,
                "v": int(row["volume"]) if row["volume"] is not None else None,
            }
            if row["vwap"] is not None:
                bar["vw"] = float(row["vwap"])
            if row["trade_count"] is not None:
                bar["n"] = int(row["trade_count"])
            if row["open_interest"] is not None:
                bar["oi"] = int(row["open_interest"])
            bars_list.append(bar)

        bars_list.reverse()
        return {"bars": {symbol.upper(): bars_list}, "pages": 1, "db_source": True}

    except Exception as e:
        print(f"[DB] query_options_bars error for {symbol}: {e}", flush=True)
        return None


async def check_bars_coverage(
    symbol: str,
    timeframe: str,
    start: str,
    end: str,
) -> Tuple[bool, int]:
    """
    检查某时间段内 bars 数据是否完整。

    返回: (is_complete, count)
    - is_complete: True 如果数据完整覆盖请求范围
    - count: 实际有多少条记录
    """
    pool = await get_db_pool()
    if pool is None:
        return False, 0

    try:
        start_dt = _parse_datetime(start)
        end_dt = _parse_datetime(end)
        if start_dt is None or end_dt is None:
            return False, 0

        async with pool.acquire() as conn:
            count = await conn.fetchval(
                """
                SELECT COUNT(*) FROM bars
                WHERE symbol = $1 AND timeframe = $2 AND ts BETWEEN $3 AND $4
                """,
                symbol.upper(),
                timeframe,
                start_dt,
                end_dt,
            )

        # 简单启发式: 每个交易日约 390 条 1Min bars
        # 更精确的检查需要知道市场日历，这里先按 count > 0 判断
        return count > 0, count

    except Exception as e:
        print(f"[DB] check_coverage error: {e}", flush=True)
        return False, 0


# ============================================================
# 插入接口 - WS 数据写入 + 夜间回填
# ============================================================

async def insert_bars_batch(
    symbol: str,
    timeframe: str,
    bars: List[Dict[str, Any]],
    feed: str = "sip",
    source: str = "alpaca",
) -> int:
    """
    批量插入股票 bars。使用 INSERT ... ON CONFLICT DO UPDATE 实现幂等写入。

    返回插入/更新的记录数。
    """
    pool = await get_db_pool()
    if pool is None or not bars:
        return 0

    try:
        # 准备数据
        records = []
        for bar in bars:
            ts = _parse_datetime(bar.get("t"))
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

        if not records:
            return 0

        async with pool.acquire() as conn:
            # 使用 executemany + ON CONFLICT 实现 UPSERT
            result = await conn.executemany(
                """
                INSERT INTO bars (symbol, timeframe, ts, open, high, low, close, volume, vwap, trade_count, feed, source)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (symbol, timeframe, ts) DO UPDATE SET
                    open = EXCLUDED.open,
                    high = EXCLUDED.high,
                    low = EXCLUDED.low,
                    close = EXCLUDED.close,
                    volume = EXCLUDED.volume,
                    vwap = EXCLUDED.vwap,
                    trade_count = EXCLUDED.trade_count,
                    feed = EXCLUDED.feed,
                    source = EXCLUDED.source,
                    updated_at = NOW()
                """,
                records,
            )

        return len(records)

    except Exception as e:
        print(f"[DB] insert_bars_batch error for {symbol}: {e}", flush=True)
        return 0


async def insert_options_bars_batch(
    symbol: str,
    root_symbol: str,
    expiration_date: str,
    strike_price: float,
    option_type: str,
    timeframe: str,
    bars: List[Dict[str, Any]],
    feed: str = "opra",
    source: str = "thetadata",
) -> int:
    """批量插入选权 bars。"""
    pool = await get_db_pool()
    if pool is None or not bars:
        return 0

    try:
        records = []
        for bar in bars:
            ts = _parse_datetime(bar.get("t"))
            if ts is None:
                continue
            records.append((
                symbol.upper(),
                root_symbol.upper(),
                expiration_date,
                strike_price,
                option_type.lower(),
                timeframe,
                ts,
                bar.get("o"),
                bar.get("h"),
                bar.get("l"),
                bar.get("c"),
                bar.get("v"),
                bar.get("vw"),
                bar.get("n"),
                bar.get("oi"),
                feed,
                source,
            ))

        if not records:
            return 0

        async with pool.acquire() as conn:
            await conn.executemany(
                """
                INSERT INTO options_bars (
                    symbol, root_symbol, expiration_date, strike_price, option_type,
                    timeframe, ts, open, high, low, close, volume, vwap, trade_count,
                    open_interest, feed, source
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                ON CONFLICT (symbol, timeframe, ts) DO UPDATE SET
                    open = EXCLUDED.open,
                    high = EXCLUDED.high,
                    low = EXCLUDED.low,
                    close = EXCLUDED.close,
                    volume = EXCLUDED.volume,
                    vwap = EXCLUDED.vwap,
                    trade_count = EXCLUDED.trade_count,
                    open_interest = EXCLUDED.open_interest,
                    updated_at = NOW()
                """,
                records,
            )

        return len(records)

    except Exception as e:
        print(f"[DB] insert_options_bars_batch error for {symbol}: {e}", flush=True)
        return 0


async def upsert_latest_quote(
    symbol: str,
    bid_price: Optional[float] = None,
    bid_size: Optional[int] = None,
    ask_price: Optional[float] = None,
    ask_size: Optional[int] = None,
    last_price: Optional[float] = None,
    last_size: Optional[int] = None,
    volume: Optional[int] = None,
    timestamp: Optional[str] = None,
    source: str = "alpaca_ws",
) -> bool:
    """
    更新最新报价。用于 WebSocket 实时数据写入。
    使用 UPSERT (INSERT ... ON CONFLICT) 保持单条记录最新。
    """
    pool = await get_db_pool()
    if pool is None:
        return False

    try:
        ts = _parse_datetime(timestamp) if timestamp else datetime.now(timezone.utc)

        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO latest_quotes (
                    symbol, bid_price, bid_size, ask_price, ask_size,
                    last_price, last_size, volume, timestamp, source
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (symbol) DO UPDATE SET
                    bid_price = EXCLUDED.bid_price,
                    bid_size = EXCLUDED.bid_size,
                    ask_price = EXCLUDED.ask_price,
                    ask_size = EXCLUDED.ask_size,
                    last_price = EXCLUDED.last_price,
                    last_size = EXCLUDED.last_size,
                    volume = EXCLUDED.volume,
                    timestamp = EXCLUDED.timestamp,
                    source = EXCLUDED.source,
                    updated_at = NOW()
                WHERE EXCLUDED.timestamp >= latest_quotes.timestamp
                    OR latest_quotes.timestamp IS NULL
                """,
                symbol.upper(),
                bid_price,
                bid_size,
                ask_price,
                ask_size,
                last_price,
                last_size,
                volume,
                ts,
                source,
            )
        return True

    except Exception as e:
        print(f"[DB] upsert_latest_quote error for {symbol}: {e}", flush=True)
        return False


async def upsert_latest_options_quote(
    symbol: str,
    root_symbol: str,
    bid_price: Optional[float] = None,
    bid_size: Optional[int] = None,
    ask_price: Optional[float] = None,
    ask_size: Optional[int] = None,
    last_price: Optional[float] = None,
    volume: Optional[int] = None,
    timestamp: Optional[str] = None,
    source: str = "alpaca_ws",
) -> bool:
    """更新期权最新报价。"""
    pool = await get_db_pool()
    if pool is None:
        return False

    try:
        ts = _parse_datetime(timestamp) if timestamp else datetime.now(timezone.utc)

        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO latest_options_quotes (
                    symbol, root_symbol, bid_price, bid_size, ask_price, ask_size,
                    last_price, volume, timestamp, source
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (symbol) DO UPDATE SET
                    bid_price = EXCLUDED.bid_price,
                    bid_size = EXCLUDED.bid_size,
                    ask_price = EXCLUDED.ask_price,
                    ask_size = EXCLUDED.ask_size,
                    last_price = EXCLUDED.last_price,
                    volume = EXCLUDED.volume,
                    timestamp = EXCLUDED.timestamp,
                    source = EXCLUDED.source,
                    updated_at = NOW()
                WHERE EXCLUDED.timestamp >= latest_options_quotes.timestamp
                    OR latest_options_quotes.timestamp IS NULL
                """,
                symbol.upper(),
                root_symbol.upper(),
                bid_price,
                bid_size,
                ask_price,
                ask_size,
                last_price,
                volume,
                ts,
                source,
            )
        return True

    except Exception as e:
        print(f"[DB] upsert_latest_options_quote error for {symbol}: {e}", flush=True)
        return False


# ============================================================
# 批量 COPY 接口 - 夜间回填高性能写入
# ============================================================

async def copy_bars_from_records(
    records: List[Tuple],
) -> int:
    """
    使用 PostgreSQL COPY 协议高效批量写入 bars。
    比 INSERT 快 5-10 倍，适合夜间回填。

    records 格式: [(symbol, timeframe, ts, open, high, low, close, volume, vwap, trade_count, feed, source), ...]
    """
    pool = await get_db_pool()
    if pool is None or not records:
        return 0

    try:
        async with pool.acquire() as conn:
            # 使用 copy_records_to_table 是最高效的方式
            await conn.copy_records_to_table(
                "bars",
                records=records,
                columns=[
                    "symbol", "timeframe", "ts", "open", "high", "low",
                    "close", "volume", "vwap", "trade_count", "feed", "source",
                ],
            )
        return len(records)

    except Exception as e:
        print(f"[DB] copy_bars error: {e}", flush=True)
        return 0


async def copy_options_bars_from_records(
    records: List[Tuple],
) -> int:
    """使用 COPY 协议高效批量写入期权 bars。"""
    pool = await get_db_pool()
    if pool is None or not records:
        return 0

    try:
        async with pool.acquire() as conn:
            await conn.copy_records_to_table(
                "options_bars",
                records=records,
                columns=[
                    "symbol", "root_symbol", "expiration_date", "strike_price", "option_type",
                    "timeframe", "ts", "open", "high", "low", "close", "volume",
                    "vwap", "trade_count", "open_interest", "feed", "source",
                ],
            )
        return len(records)

    except Exception as e:
        print(f"[DB] copy_options_bars error: {e}", flush=True)
        return 0


# ============================================================
# 回填追踪接口
# ============================================================

async def log_backfill_start(
    symbol: str,
    data_type: str,
    timeframe: str,
    start_date: str,
    end_date: str,
) -> int:
    """记录回填任务开始，返回任务 ID。"""
    pool = await get_db_pool()
    if pool is None:
        return -1

    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO backfill_log (symbol, data_type, timeframe, start_date, end_date, status, started_at)
                VALUES ($1, $2, $3, $4, $5, 'running', NOW())
                RETURNING id
                """,
                symbol.upper(),
                data_type,
                timeframe,
                start_date,
                end_date,
            )
            return row["id"] if row else -1
    except Exception as e:
        print(f"[DB] log_backfill_start error: {e}", flush=True)
        return -1


async def log_backfill_complete(
    task_id: int,
    records_inserted: int,
    error_message: Optional[str] = None,
):
    """记录回填任务完成。"""
    pool = await get_db_pool()
    if pool is None or task_id < 0:
        return

    try:
        status = "failed" if error_message else "completed"
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE backfill_log
                SET status = $1, records_inserted = $2, error_message = $3, completed_at = NOW()
                WHERE id = $4
                """,
                status,
                records_inserted,
                error_message,
                task_id,
            )
    except Exception as e:
        print(f"[DB] log_backfill_complete error: {e}", flush=True)


# ============================================================
# 统计接口
# ============================================================

async def get_db_stats() -> Dict[str, Any]:
    """获取数据库统计信息。"""
    pool = await get_db_pool()
    if pool is None:
        return {"enabled": False}

    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM v_db_stats")
            stats = {}
            for row in rows:
                stats[row["table_name"]] = {
                    "total_rows": row["total_rows"],
                    "unique_symbols": row["unique_symbols"],
                    "earliest": row["earliest_ts"].isoformat() if row["earliest_ts"] else None,
                    "latest": row["latest_ts"].isoformat() if row["latest_ts"] else None,
                    "data_lag_sec": row["data_lag"].total_seconds() if row["data_lag"] else None,
                }
            return {"enabled": True, "tables": stats}
    except Exception as e:
        print(f"[DB] get_db_stats error: {e}", flush=True)
        return {"enabled": True, "error": str(e)}


# ============================================================
# 工具函数
# ============================================================

def _parse_datetime(value) -> Optional[datetime]:
    """解析各种格式的时间字符串为 datetime。"""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    if isinstance(value, (int, float)):
        # Unix timestamp (秒)
        return datetime.fromtimestamp(value, tz=timezone.utc)

    s = str(value).strip()
    if not s:
        return None

    # 处理 'Z' 后缀
    s = s.replace("Z", "+00:00")

    formats = [
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(s, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue

    # 尝试 ISO 格式 (Python 3.7+)
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        pass

    return None


def _format_timestamp(dt) -> str:
    """将 datetime 格式化为 Alpaca API 标准格式。"""
    if isinstance(dt, str):
        return dt
    if dt is None:
        return ""
    # Alpaca 格式: 2024-01-15T09:30:00Z
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


# ============================================================
# 测试入口
# ============================================================

async def _test():
    """本地测试数据库连接。"""
    print("Testing TimescaleDB connection...")
    pool = await get_db_pool()
    if pool is None:
        print("DB not available")
        return

    stats = await get_db_stats()
    print(f"DB stats: {stats}")

    # 测试查询
    result = await query_bars("AAPL", "1Day", "2024-01-01", "2024-01-31")
    print(f"Query result: {result is not None}")


if __name__ == "__main__":
    asyncio.run(_test())
