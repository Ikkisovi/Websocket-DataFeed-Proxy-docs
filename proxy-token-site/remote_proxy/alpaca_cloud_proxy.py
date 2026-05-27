import asyncio
import json
import os
from datetime import date
try:
    import orjson as _orjson
    # orjson is 3-10x faster than stdlib json; used in hot paths only.
    # Returns bytes from dumps and accepts bytes/str/memoryview in loads.
    def _fast_loads(data):
        if isinstance(data, str):
            return _orjson.loads(data.encode())
        return _orjson.loads(data)
    def _fast_dumps_str(obj) -> str:
        return _orjson.dumps(obj).decode()
except Exception:
    _orjson = None
    _fast_loads = json.loads
    def _fast_dumps_str(obj) -> str:
        return json.dumps(obj, separators=(",", ":"))
import secrets
import time
from pathlib import Path
from typing import Dict, Set

import aiohttp
from aiohttp import web
import msgpack
import websockets

try:
    import redis.asyncio as redis_async
except ImportError:
    redis_async = None
try:
    import uvloop
    asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
except Exception:
    pass

# === Disk Cache ===
try:
    from disk_cache import get_disk_cache
    _disk_cache = None
except ImportError:
    get_disk_cache = None
    _disk_cache = None

# === TimescaleDB Manager (数据库优先架构) ===
try:
    from db_manager import (
        get_db_pool, close_db_pool, query_bars, query_options_bars,
        insert_bars_batch, insert_options_bars_batch,
        upsert_latest_quote, upsert_latest_options_quote,
        check_bars_coverage, get_db_stats,
    )
    DB_MANAGER_AVAILABLE = True
except ImportError:
    DB_MANAGER_AVAILABLE = False
    get_db_pool = None
    close_db_pool = None
    query_bars = None
    query_options_bars = None
    insert_bars_batch = None
    insert_options_bars_batch = None
    upsert_latest_quote = None
    upsert_latest_options_quote = None
    check_bars_coverage = None
    get_db_stats = None

async def get_disk_cache_instance():
    global _disk_cache
    if _disk_cache is not None:
        return _disk_cache
    if get_disk_cache is None:
        return None
    _disk_cache = get_disk_cache()
    await _disk_cache.start_cleanup_loop()
    print("[Cache] Disk cache initialized and running background cleanup")
    return _disk_cache

# === ThetaData Dual Provider ===
THETADATA_ENABLED = os.getenv("THETADATA_ENABLED", "true").lower() in ("true", "1", "yes")
THETADATA_CREDS_FILE = os.getenv("THETADATA_CREDS_FILE", "/app/.thetadata_credentials.txt")
THETADATA_SDK_TIMEOUT_SECONDS = float(os.getenv("THETADATA_SDK_TIMEOUT_SECONDS", "30"))
ALPACA_OPTIONS_HISTORY_AVAILABLE_FROM = "2024-02-01"
theta_client = None
theta_client_lock = asyncio.Lock()

async def get_theta_client():
    global theta_client
    if theta_client is not None:
        return theta_client
    async with theta_client_lock:
        if theta_client is not None:
            return theta_client
        if not THETADATA_ENABLED:
            return None
        if not Path(THETADATA_CREDS_FILE).exists():
            print("[ThetaData] Credentials file not found, disabling")
            return None
        try:
            from thetadata import ThetaClient
            loop = asyncio.get_event_loop()
            theta_client = await loop.run_in_executor(
                None, lambda: ThetaClient(creds_file=THETADATA_CREDS_FILE)
            )
            print("[ThetaData] Client initialized successfully")
            return theta_client
        except Exception as e:
            print(f"[ThetaData] Failed to initialize: {e}")
            return None


# --- Persistent HTTP session (connection pool for Alpaca/ThetaData upstream) ---
_http_session: "aiohttp.ClientSession | None" = None

async def get_http_session() -> "aiohttp.ClientSession":
    """Return a shared aiohttp session with connection pooling."""
    global _http_session
    if _http_session is None or _http_session.closed:
        connector = aiohttp.TCPConnector(
            limit=100,           # total connections
            limit_per_host=30,   # per upstream host
            ttl_dns_cache=300,   # cache DNS 5min
            enable_cleanup_closed=True,
        )
        _http_session = aiohttp.ClientSession(
            connector=connector,
            timeout=aiohttp.ClientTimeout(total=30),
        )
        print("[HTTP] Persistent session created (pool: 100 total / 30 per host)")
    return _http_session


def _parse_occ_symbol_theta(symbol):
    import re
    m = re.match(r'^([A-Z]{1,6})(\d{6})([CP])(\d{6,8})$', symbol.strip().upper())
    if not m:
        return None
    root, yymmdd, right, strike_digits = m.groups()
    if len(strike_digits) < 8:
        strike_digits = strike_digits.zfill(8)
    yy = int(yymmdd[:2])
    yyyy = 2000 + yy if yy < 50 else 1900 + yy
    exp = f"{yyyy}{yymmdd[2:]}"
    # OCC strike: 8 digits, first 5 are whole dollars, last 3 are decimal (1/1000)
    # e.g., 00200000 = $200.000, 00170500 = $170.500
    # ThetaData SDK wants strike in dollars: "200" or "200.0"
    strike_dollars = int(strike_digits[:5]) + int(strike_digits[5:]) / 1000.0
    return root, exp, right, strike_dollars


def _format_occ_option_symbol(root, expiration, right, strike):
    exp_clean = str(expiration).replace("-", "").strip()
    if len(exp_clean) != 8:
        return None
    right_clean = str(right).strip().upper()
    if right_clean in ("CALL", "C"):
        right_letter = "C"
    elif right_clean in ("PUT", "P"):
        right_letter = "P"
    else:
        return None
    strike_int = int(round(float(strike) * 1000))
    return f"{str(root).strip().upper()}{exp_clean[2:]}{right_letter}{strike_int:08d}"


def _theta_row_to_alpaca_contract(row, default_symbol=None):
    root = row.get("symbol", default_symbol)
    expiration = row.get("expiration", "")
    right = row.get("right", "")
    strike = row.get("strike", 0)
    occ_symbol = _format_occ_option_symbol(root, expiration, right, strike)
    if not occ_symbol:
        return None
    right_clean = str(right).strip().lower()
    option_type = "call" if right_clean in ("call", "c") else "put"
    expiration_iso = str(expiration)
    if len(expiration_iso) == 8 and expiration_iso.isdigit():
        expiration_iso = f"{expiration_iso[:4]}-{expiration_iso[4:6]}-{expiration_iso[6:]}"
    return {
        "id": occ_symbol,
        "symbol": occ_symbol,
        "name": f"{str(root).strip().upper()} {expiration_iso} {float(strike):g} {option_type}",
        "status": "active",
        "tradable": False,
        "expiration_date": expiration_iso,
        "root_symbol": str(root).strip().upper(),
        "underlying_symbol": str(root).strip().upper(),
        "type": option_type,
        "style": "american",
        "strike_price": str(float(strike)),
        "size": "100",
        "source": "thetadata",
    }


async def fetch_theta_option_contracts(underlying_symbols, date_value=None, request_type="quote", max_dte=None, limit=1000):
    global theta_client
    try:
        import datetime
        if date_value:
            date_obj = datetime.datetime.strptime(str(date_value).split("T")[0].replace("-", ""), "%Y%m%d").date()
        else:
            date_obj = datetime.datetime.now().date()

        if isinstance(underlying_symbols, (list, tuple)):
            symbols = [str(item).strip().upper() for item in underlying_symbols if str(item).strip()]
        else:
            symbols = [item.strip().upper() for item in str(underlying_symbols).split(",") if item.strip()]
        if not symbols:
            return None

        req_type = str(request_type or "quote").strip().upper()
        if req_type not in ("QUOTE", "TRADE"):
            req_type = "QUOTE"

        kwargs = {"request_type": req_type, "date": date_obj, "symbol": symbols}
        if max_dte is not None:
            kwargs["max_dte"] = int(max_dte)

        loop = asyncio.get_event_loop()
        df = None
        for attempt in range(2):
            client = await get_theta_client()
            if client is None:
                return None
            try:
                df = await loop.run_in_executor(None, lambda: client.option_list_contracts(**kwargs))
                break
            except Exception as e:
                err_str = str(e).lower()
                if attempt == 0 and ("unauthenticated" in err_str or "session" in err_str or "conflict" in err_str or "connection" in err_str):
                    print(f"[ThetaData] Resetting client in fetch_theta_option_contracts due to error: {e}")
                    async with theta_client_lock:
                        theta_client = None
                    continue
                else:
                    raise

        if df is None or len(df) == 0:
            return {"option_contracts": [], "source": "thetadata"}
        df = df.to_pandas() if hasattr(df, "to_pandas") else df
        contracts = []
        for _, row in df.iterrows():
            contract = _theta_row_to_alpaca_contract(row)
            if contract:
                contracts.append(contract)
            if len(contracts) >= limit:
                break
        return {"option_contracts": contracts, "source": "thetadata"}
    except Exception as e:
        print(f"[ThetaData] Contracts error: {e}")
        if "session" in str(e).lower() or "unauthenticated" in str(e).lower() or "rpc" in str(e).lower():
            async with theta_client_lock:
                theta_client = None
        return None



async def fetch_option_chain_for_symbol(symbol, expiration_date=None, limit=10):
    """Fetch option chain for a stock symbol using ThetaData. Returns list of OCC symbols."""
    global theta_client
    try:
        import datetime
        if expiration_date is None:
            expiration_date = datetime.datetime.now().date()
        else:
            expiration_date = datetime.datetime.strptime(str(expiration_date).split("T")[0], "%Y-%m-%d").date()
        
        loop = asyncio.get_event_loop()
        df = None
        for attempt in range(2):
            client = await get_theta_client()
            if client is None:
                return None
            try:
                df = await loop.run_in_executor(
                    None,
                    lambda s=symbol, e=expiration_date: client.option_list_contracts(request_type="QUOTE", date=e, symbol=[s])
                )
                break
            except Exception as e:
                err_str = str(e).lower()
                if attempt == 0 and ("unauthenticated" in err_str or "session" in err_str or "conflict" in err_str or "connection" in err_str):
                    print(f"[ThetaData] Resetting client in fetch_option_chain due to error: {e}")
                    async with theta_client_lock:
                        theta_client = None
                    continue
                else:
                    raise

        if df is None or len(df) == 0:
            return None
        df = df.to_pandas() if hasattr(df, "to_pandas") else df
        occ_symbols = []
        for _, row in df.iterrows():
            root = row.get("symbol", symbol)
            exp = row.get("expiration", "")
            right = row.get("right", "")
            strike = row.get("strike", 0)
            if not all([root, exp, right, strike]):
                continue
            
            occ = _format_occ_option_symbol(root, exp, right, strike)
            if not occ:
                continue
            occ_symbols.append(occ)
        return occ_symbols[:limit]  # Limit to requested limit
    except Exception as e:
        print(f"[OptionChain] Error fetching chain for {symbol}: {e}")
        if "session" in str(e).lower() or "unauthenticated" in str(e).lower() or "rpc" in str(e).lower():
            async with theta_client_lock:
                theta_client = None
        return None

_TF_TO_IVL = {"1Min": "1m", "5Min": "5m", "15Min": "15m", "30Min": "30m", "1Hour": "1h", "1D": "1d"}

async def fetch_theta_option_bars(symbols, start, end, timeframe="1Min"):
    global theta_client
    try:
        import datetime
        start_date = datetime.datetime.strptime(start.split("T")[0], "%Y-%m-%d").date()
        end_date = datetime.datetime.strptime(end.split("T")[0], "%Y-%m-%d").date()
        interval = _TF_TO_IVL.get(timeframe, "1m")
        all_bars = {}
        loop = asyncio.get_event_loop()
        symbol_list = symbols if isinstance(symbols, list) else [s.strip() for s in str(symbols).split(",")]
        for symbol in symbol_list:
            parsed = _parse_occ_symbol_theta(symbol)
            if parsed is None:
                continue
            all_bars[symbol] = []  # Initialize empty list to ensure 100% coverage in the response
            root, exp_str, right, strike_dollars = parsed
            exp_date = datetime.datetime.strptime(exp_str, "%Y%m%d").date()
            
            df = None
            for attempt in range(2):
                client = await get_theta_client()
                if client is None:
                    break
                try:
                    df = await loop.run_in_executor(
                        None,
                        lambda r=root, e=exp_date, iv=interval, s=start_date, en=end_date, st=strike_dollars, ri=right:
                            client.option_history_ohlc(symbol=r, expiration=e, interval=iv, start_date=s, end_date=en, strike=str(st), right=ri)
                    )
                    break
                except Exception as e:
                    err_str = str(e).lower()
                    if attempt == 0 and ("unauthenticated" in err_str or "session" in err_str or "conflict" in err_str or "connection" in err_str):
                        print(f"[ThetaData] Resetting client in fetch_theta_option_bars for {symbol} due to error: {e}")
                        async with theta_client_lock:
                            theta_client = None
                        continue
                    else:
                        print(f"[ThetaData] Error {symbol}: {e}")
                        if "session" in err_str or "unauthenticated" in err_str or "rpc" in err_str:
                            async with theta_client_lock:
                                theta_client = None
                        break

            if df is not None and len(df) > 0:
                df = df.to_pandas() if hasattr(df, "to_pandas") else df
                bars = []
                for _, row in df.iterrows():
                    # ThetaData SDK returns: symbol, expiration, strike, right, timestamp, open, high, low, close, volume, count, vwap
                    ts_val = row.get("timestamp", row.get("date", ""))
                    if hasattr(ts_val, "strftime"):
                        ts = ts_val.strftime("%Y-%m-%dT%H:%M:%SZ")
                    elif isinstance(ts_val, (int, float)):
                        # ms_of_day format
                        total_ms = int(ts_val)
                        hh, mm, ss = total_ms // 3600000, (total_ms % 3600000) // 60000, (total_ms % 60000) // 1000
                        ts = f"T{hh:02d}:{mm:02d}:{ss:02d}Z"
                    else:
                        ts = str(ts_val)
                    bars.append({"t": ts, "o": float(row.get("open", 0)), "h": float(row.get("high", 0)), "l": float(row.get("low", 0)), "c": float(row.get("close", 0)), "v": int(row.get("volume", 0)), "n": int(row.get("count", 0))})
                all_bars[symbol] = bars
        return {"bars": all_bars, "pages": 1} if all_bars else None
    except Exception as e:
        print(f"[ThetaData] Provider error: {e}")
        return None

WS_PORT = int(os.getenv("WS_PORT", "8765"))
HTTP_PORT = int(os.getenv("HTTP_PORT", "8766"))

# Force paper mode (no live trading account)
IS_LIVE = False
IS_PRO = os.getenv("IS_PRO", "false").lower() in ("true", "1", "yes")
REST_ONLY = os.getenv("REST_ONLY", "false").lower() in ("true", "1", "yes")

ALPACA_MASTER_KEY = (
    os.getenv("ALPACA_MASTER_KEY")
    or os.getenv("ALPACA_API_KEY")
    or os.getenv("APCA_API_KEY_ID")
)
ALPACA_MASTER_SECRET = (
    os.getenv("ALPACA_MASTER_SECRET")
    or os.getenv("ALPACA_API_SECRET")
    or os.getenv("APCA_API_SECRET_KEY")
)
PROXY_TOKEN = os.getenv("ALPACA_PROXY_TOKEN", "")
REDIS_URL = os.getenv("REDIS_URL", "")
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "86400"))
SEND_TIMEOUT_SECONDS = float(os.getenv("SEND_TIMEOUT_SECONDS", "1.5"))
SEND_QUEUE_MAX = int(os.getenv("SEND_QUEUE_MAX", "200"))
OPTIONS_FEED = os.getenv("ALPACA_OPTIONS_FEED", "opra" if IS_PRO else "indicative").lower()
DEBUG_LOG_PATH = os.getenv("DEBUG_LOG_PATH", "/tmp/cloud-proxy-debug.log")
DEBUG_LOG_ENABLED = os.getenv("DEBUG_LOG_ENABLED", "false").lower() in ("1", "true", "yes")

if IS_LIVE:
    TRADING_URL = "https://api.alpaca.markets"
    DATA_URL = "https://data.alpaca.markets"
    STREAM_URL = "wss://stream.data.alpaca.markets/v2/sip" if IS_PRO else "wss://stream.data.alpaca.markets/v2/iex"
else:
    TRADING_URL = "https://paper-api.alpaca.markets"
    DATA_URL = "https://data.alpaca.markets"
    # Try the configured feed even in paper mode, as some paper keys have SIP access
    STREAM_URL = "wss://stream.data.alpaca.markets/v2/sip" if IS_PRO else "wss://stream.data.alpaca.markets/v2/iex"
    print(f"[Cloud] Paper mode, using {STREAM_URL}", flush=True)
TEST_STREAM_URL = os.getenv("ALPACA_TEST_STREAM_URL", "wss://stream.data.alpaca.markets/v2/test")
OPTIONS_STREAM_URL = f"wss://stream.data.alpaca.markets/v1beta1/{OPTIONS_FEED}"
CRYPTO_STREAM_URL = os.getenv("ALPACA_CRYPTO_STREAM_URL", "wss://stream.data.alpaca.markets/v1beta3/crypto/us")
BOATS_STREAM_URL = os.getenv("ALPACA_BOATS_STREAM_URL", "wss://stream.data.alpaca.markets/v1beta1/boats")
OVERNIGHT_STREAM_URL = os.getenv("ALPACA_OVERNIGHT_STREAM_URL", "wss://stream.data.alpaca.markets/v1beta1/overnight")
NEWS_STREAM_URL = os.getenv("ALPACA_NEWS_STREAM_URL", "wss://stream.data.alpaca.markets/v1beta1/news")

alpaca_ws = None
alpaca_options_ws = None
alpaca_test_ws = None
alpaca_boats_ws = None
alpaca_overnight_ws = None
alpaca_crypto_ws = None
alpaca_news_ws = None
alpaca_lock = asyncio.Lock()
alpaca_options_lock = asyncio.Lock()
alpaca_test_lock = asyncio.Lock()
alpaca_boats_lock = asyncio.Lock()
alpaca_overnight_lock = asyncio.Lock()
alpaca_crypto_lock = asyncio.Lock()
alpaca_news_lock = asyncio.Lock()
pending_subscription_update = False
pending_options_subscription_update = False
pending_test_subscription_update = False
pending_boats_subscription_update = False
pending_overnight_subscription_update = False
pending_crypto_subscription_update = False
pending_news_subscription_update = False
subscribed_trades: Set[str] = set()
subscribed_quotes: Set[str] = set()
subscribed_option_trades: Set[str] = set()
subscribed_option_quotes: Set[str] = set()
subscribed_test_trades: Set[str] = set()
subscribed_test_quotes: Set[str] = set()
subscribed_boats_trades: Set[str] = set()
subscribed_boats_quotes: Set[str] = set()
subscribed_overnight_trades: Set[str] = set()
subscribed_overnight_quotes: Set[str] = set()
subscribed_orderbooks: Set[str] = set()
subscribed_crypto_trades: Set[str] = set()
subscribed_news: Set[str] = set()

relay_clients: Set[websockets.WebSocketServerProtocol] = set()
relay_authed: Set[websockets.WebSocketServerProtocol] = set()
relay_subscriptions: Dict[websockets.WebSocketServerProtocol, Dict[str, Set[str]]] = {}
relay_send_queues: Dict[websockets.WebSocketServerProtocol, asyncio.Queue] = {}
relay_send_tasks: Dict[websockets.WebSocketServerProtocol, asyncio.Task] = {}

options_relay_clients: Set[websockets.WebSocketServerProtocol] = set()
options_relay_authed: Set[websockets.WebSocketServerProtocol] = set()
options_relay_subscriptions: Dict[websockets.WebSocketServerProtocol, Dict[str, Set[str]]] = {}
options_relay_send_queues: Dict[websockets.WebSocketServerProtocol, asyncio.Queue] = {}
options_relay_send_tasks: Dict[websockets.WebSocketServerProtocol, asyncio.Task] = {}

test_relay_clients: Set[websockets.WebSocketServerProtocol] = set()
test_relay_authed: Set[websockets.WebSocketServerProtocol] = set()
test_relay_subscriptions: Dict[websockets.WebSocketServerProtocol, Dict[str, Set[str]]] = {}
test_relay_send_queues: Dict[websockets.WebSocketServerProtocol, asyncio.Queue] = {}
test_relay_send_tasks: Dict[websockets.WebSocketServerProtocol, asyncio.Task] = {}

boats_relay_clients: Set[websockets.WebSocketServerProtocol] = set()
boats_relay_authed: Set[websockets.WebSocketServerProtocol] = set()
boats_relay_subscriptions: Dict[websockets.WebSocketServerProtocol, Dict[str, Set[str]]] = {}
boats_relay_send_queues: Dict[websockets.WebSocketServerProtocol, asyncio.Queue] = {}
boats_relay_send_tasks: Dict[websockets.WebSocketServerProtocol, asyncio.Task] = {}

overnight_relay_clients: Set[websockets.WebSocketServerProtocol] = set()
overnight_relay_authed: Set[websockets.WebSocketServerProtocol] = set()
overnight_relay_subscriptions: Dict[websockets.WebSocketServerProtocol, Dict[str, Set[str]]] = {}
overnight_relay_send_queues: Dict[websockets.WebSocketServerProtocol, asyncio.Queue] = {}
overnight_relay_send_tasks: Dict[websockets.WebSocketServerProtocol, asyncio.Task] = {}

crypto_relay_clients: Set[websockets.WebSocketServerProtocol] = set()
crypto_relay_authed: Set[websockets.WebSocketServerProtocol] = set()
crypto_relay_subscriptions: Dict[websockets.WebSocketServerProtocol, Dict[str, Set[str]]] = {}
crypto_relay_send_queues: Dict[websockets.WebSocketServerProtocol, asyncio.Queue] = {}
crypto_relay_send_tasks: Dict[websockets.WebSocketServerProtocol, asyncio.Task] = {}

news_relay_clients: Set[websockets.WebSocketServerProtocol] = set()
news_relay_authed: Set[websockets.WebSocketServerProtocol] = set()
news_relay_subscriptions: Dict[websockets.WebSocketServerProtocol, Dict[str, Set[str]]] = {}
news_relay_send_queues: Dict[websockets.WebSocketServerProtocol, asyncio.Queue] = {}
news_relay_send_tasks: Dict[websockets.WebSocketServerProtocol, asyncio.Task] = {}

ws_user_id: Dict[websockets.WebSocketServerProtocol, str] = {}
options_ws_user_id: Dict[websockets.WebSocketServerProtocol, str] = {}
test_ws_user_id: Dict[websockets.WebSocketServerProtocol, str] = {}
boats_ws_user_id: Dict[websockets.WebSocketServerProtocol, str] = {}
overnight_ws_user_id: Dict[websockets.WebSocketServerProtocol, str] = {}
crypto_ws_user_id: Dict[websockets.WebSocketServerProtocol, str] = {}
news_ws_user_id: Dict[websockets.WebSocketServerProtocol, str] = {}
ws_stats: Dict[websockets.WebSocketServerProtocol, dict] = {}

redis_client = None

# Feed activity counters (for "subscribed" vs actual data)
alpaca_msg_count = 0
alpaca_last_log = 0.0
alpaca_last_msg_time = 0.0
alpaca_options_msg_count = 0
alpaca_options_last_log = 0.0
alpaca_options_last_msg_time = 0.0
alpaca_test_msg_count = 0
alpaca_test_last_log = 0.0
alpaca_test_last_msg_time = 0.0
alpaca_boats_msg_count = 0
alpaca_boats_last_log = 0.0
alpaca_boats_last_msg_time = 0.0
alpaca_overnight_msg_count = 0
alpaca_overnight_last_log = 0.0
alpaca_overnight_last_msg_time = 0.0
alpaca_crypto_msg_count = 0
alpaca_crypto_last_log = 0.0
alpaca_crypto_last_msg_time = 0.0
alpaca_news_msg_count = 0
alpaca_news_last_log = 0.0
alpaca_news_last_msg_time = 0.0


FULL_ACCESS_PERMISSIONS = {
    "ws": {
        "stocks": True,
        "options": True,
        "overnight": True,
        "crypto": True,
        "news": True,
        "boats": True,
        "test": True,
    },
    "rest": {
        "stocks_history": True,
        "options_history": True,
        "options_contracts": True,
        "options_snapshots": True,
        "options_snapshots_expiry": True,
        "crypto_orderbooks": True,
        "news_history": True,
        "admin_token_lookup": True,
    },
}

NO_ACCESS_PERMISSIONS = {
    "ws": {
        "stocks": False,
        "options": False,
        "overnight": False,
        "crypto": False,
        "news": False,
        "boats": False,
        "test": False,
    },
    "rest": {
        "stocks_history": False,
        "options_history": False,
        "options_contracts": False,
        "options_snapshots": False,
        "options_snapshots_expiry": False,
        "crypto_orderbooks": False,
        "news_history": False,
        "admin_token_lookup": False,
    },
}

WS_PERMISSION_BY_MODE = {
    "stock": "stocks",
    "options": "options",
    "overnight": "overnight",
    "crypto": "crypto",
    "news": "news",
    "boats": "boats",
    "test": "test",
}

PROXY_AUTH_PARAM_NAMES = {"token", "api_key", "api_secret", "key", "secret", "auth"}

THETADATA_VALUE_OPTION_ENDPOINTS = {
    "/v3/option/list/symbols": "options_contracts",
    "/v3/option/list/dates/quote": "options_contracts",
    "/v3/option/list/dates/trade": "options_contracts",
    "/v3/option/list/expirations": "options_contracts",
    "/v3/option/list/strikes": "options_contracts",
    "/v3/option/list/contracts/quote": "options_contracts",
    "/v3/option/list/contracts/trade": "options_contracts",
    "/v3/option/snapshot/ohlc": "options_snapshots",
    "/v3/option/snapshot/quote": "options_snapshots",
    "/v3/option/snapshot/open_interest": "options_snapshots",
    "/v3/option/history/eod": "options_history",
    "/v3/option/history/ohlc": "options_history",
    "/v3/option/history/quote": "options_history",
    "/v3/option/history/open_interest": "options_history",
    "/v3/option/at_time/quote": "options_history",
}

THETADATA_VALUE_OPTION_ROUTE_PATTERNS = (
    "/v3/option/list/symbols",
    "/v3/option/list/dates/{request_type}",
    "/v3/option/list/expirations",
    "/v3/option/list/strikes",
    "/v3/option/list/contracts/{request_type}",
    "/v3/option/snapshot/ohlc",
    "/v3/option/snapshot/quote",
    "/v3/option/snapshot/open_interest",
    "/v3/option/history/eod",
    "/v3/option/history/ohlc",
    "/v3/option/history/quote",
    "/v3/option/history/open_interest",
    "/v3/option/at_time/quote",
)

REST_PERMISSION_BY_ENDPOINT = {
    "/v1/history/bars": "stocks_history",
    "/v1/history/options/bars": "options_history",
    "/v1/options/contracts": "options_contracts",
    "/v1/options/snapshots": "options_snapshots",
    "/v1/options/snapshots/expiry": "options_snapshots_expiry",
    "/v1/options/snapshots/ohlc": "options_snapshots",
    "/v1/options/snapshots/trade": "options_snapshots",
    "/v1/options/snapshots/quote": "options_snapshots",
    "/v1/options/snapshots/market_value": "options_snapshots",
    "/v1/options/open_interest": "options_history",
    "/v1/options/eod": "options_history",
    "/v1/history/options/eod": "options_history",
    "/v1/history/options/trades": "options_history",
    "/v1beta1/options/trades": "options_history",
    "/v3/option/history/ohlc": "options_history",
    "/v3/option/snapshot/ohlc": "options_snapshots",
    "/v1/crypto/us/latest/orderbooks": "crypto_orderbooks",
    "/v1/history/news": "news_history",
    "/v1/admin/token/lookup": "admin_token_lookup",
    "/v1/history/options/trade_quote": "options_history",
    "/v1/options/history/trade_quote": "options_history",
    "/v1/stock/history/trade_quote": "stocks_history",
}
REST_PERMISSION_BY_ENDPOINT.update(THETADATA_VALUE_OPTION_ENDPOINTS)

token_to_principal: Dict[str, dict] = {}
user_registry_source = None
user_registry_path = None


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in ("1", "true", "yes", "y")


def _env_csv(name: str):
    raw = os.getenv(name, "")
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def get_proxy_token() -> str:
    return os.getenv("ALPACA_PROXY_TOKEN", "")


def is_fallback_enabled() -> bool:
    return _env_flag("ALLOW_SINGLE_TENANT_FALLBACK", False) and bool(get_proxy_token())


def _ignore_users_and_fallback() -> bool:
    return _env_flag("IGNORE_USERS_AND_FALLBACK", False)


def is_fallback_ip_allowed(client_ip: str) -> bool:
    if not is_fallback_enabled():
        return False
    allowed = _env_csv("FALLBACK_ALLOWED_IPS")
    # Single-tenant mode: when no allow-list is configured, allow all client IPs.
    if not allowed:
        return True
    return client_ip in allowed


def _deep_copy_json(value):
    return json.loads(json.dumps(value))


def _default_principal_for_user(user_id: str, token: str):
    return {
        "token": token,
        "user_id": user_id,
        "role": "legacy",
        "permissions": _deep_copy_json(FULL_ACCESS_PERMISSIONS),
    }


def _normalize_principal_entry(token, entry):
    if not token or not isinstance(entry, dict):
        return None
    user_id = entry.get("user_id") or entry.get("id") or entry.get("name")
    if not user_id:
        return None
    principal = {
        "token": str(token),
        "user_id": str(user_id),
        "role": str(entry.get("role") or "legacy"),
        "permissions": _deep_copy_json(FULL_ACCESS_PERMISSIONS),
        "expires_at": entry.get("expires_at"),
    }
    provided_permissions = entry.get("permissions")
    if isinstance(provided_permissions, dict):
        merged = _deep_copy_json(NO_ACCESS_PERMISSIONS)
        for section in ("ws", "rest"):
            values = provided_permissions.get(section)
            if isinstance(values, dict):
                for key, value in values.items():
                    if key in merged[section]:
                        merged[section][key] = bool(value)
        # Preserve custom concurrency limits
        if "max_ws_conns" in provided_permissions:
            merged["max_ws_conns"] = provided_permissions["max_ws_conns"]
        if "max_rest_conns" in provided_permissions:
            merged["max_rest_conns"] = provided_permissions["max_rest_conns"]
        principal["permissions"] = merged
    return principal


def _normalize_user_entries(payload):
    if payload is None:
        return {}
    if isinstance(payload, dict) and "users" in payload:
        payload = payload.get("users")
    if isinstance(payload, dict):
        mapping = {}
        for token, user_value in payload.items():
            if not token or not user_value:
                continue
            if isinstance(user_value, dict):
                principal = _normalize_principal_entry(token, user_value)
            else:
                principal = _default_principal_for_user(str(user_value), str(token))
            if principal:
                mapping[str(token)] = principal
        if payload and not mapping:
            raise RuntimeError("No valid users in registry")
        return mapping
    if isinstance(payload, list):
        mapping = {}
        for item in payload:
            if not isinstance(item, dict):
                continue
            token = item.get("token") or item.get("access_token")
            user_id = item.get("user_id") or item.get("id") or item.get("name")
            if token and user_id:
                principal = _normalize_principal_entry(token, item) or _default_principal_for_user(str(user_id), str(token))
                mapping[str(token)] = principal
        if payload and not mapping:
            raise RuntimeError("No valid users in registry")
        return mapping
    raise RuntimeError("Invalid users payload")


_last_registry_mtime = 0.0
_user_registry_lock = asyncio.Lock()

async def watch_user_registry_loop():
    """Background task that checks users.json for external modifications asynchronously."""
    global _last_registry_mtime, token_to_principal
    users_path = (os.getenv("PROXY_USERS_PATH") or "").strip()
    if not users_path:
        return
        
    loop = asyncio.get_event_loop()
    while True:
        await asyncio.sleep(5)  # Check every 5 seconds
        try:
            # Check file mtime in the background thread executor (fully non-blocking)
            mtime = await loop.run_in_executor(None, os.path.getmtime, users_path)
            
            async with _user_registry_lock:
                if mtime != _last_registry_mtime:
                    print(f"[Auth] users.json modified externally, reloading registry (mtime={mtime})", flush=True)
                    def read_and_parse():
                        with open(users_path, "r", encoding="utf-8") as handle:
                            return json.load(handle)
                            
                    payload = await loop.run_in_executor(None, read_and_parse)
                    token_to_principal = _normalize_user_entries(payload)
                    _last_registry_mtime = mtime
        except asyncio.CancelledError:
            break
        except Exception:
            # Ignore and retry (e.g. if file is temporarily locked or not yet created)
            pass

def load_user_registry():
    global token_to_principal, user_registry_source, user_registry_path, _last_registry_mtime

    users_json = (os.getenv("PROXY_USERS_JSON") or "").strip()
    users_path = (os.getenv("PROXY_USERS_PATH") or "").strip()
    if users_json and users_path:
        print("[Cloud] PROXY_USERS_JSON set; ignoring PROXY_USERS_PATH", flush=True)

    if users_json:
        if token_to_principal and user_registry_source == "PROXY_USERS_JSON":
            return token_to_principal
        try:
            payload = json.loads(users_json)
        except Exception as exc:
            if is_fallback_enabled() and _ignore_users_and_fallback():
                token_to_principal = {}
                user_registry_source = "fallback"
                user_registry_path = None
                return token_to_principal
            raise RuntimeError("Invalid PROXY_USERS_JSON") from exc
        token_to_principal = _normalize_user_entries(payload)
        user_registry_source = "PROXY_USERS_JSON"
        user_registry_path = None
        return token_to_principal

    if users_path:
        # Initial synchronous load on startup if not already loaded
        if not token_to_principal or user_registry_source != "PROXY_USERS_PATH":
            try:
                with open(users_path, "r", encoding="utf-8") as handle:
                    payload = json.load(handle)
                token_to_principal = _normalize_user_entries(payload)
                user_registry_source = "PROXY_USERS_PATH"
                user_registry_path = users_path
                _last_registry_mtime = os.path.getmtime(users_path)
            except Exception as exc:
                if is_fallback_enabled() and _ignore_users_and_fallback():
                    token_to_principal = {}
                    user_registry_source = "fallback"
                    user_registry_path = None
                    return token_to_principal
                raise RuntimeError("Invalid PROXY_USERS_PATH") from exc
        
        # Subsequent calls are 100% in-memory and super fast
        return token_to_principal

    token_to_principal = {}
    user_registry_source = None
    user_registry_path = None
    _last_registry_mtime = 0.0
    return token_to_principal


def reset_user_registry_state():
    global token_to_principal, user_registry_source, user_registry_path, _last_registry_mtime
    token_to_principal = {}
    user_registry_source = None
    user_registry_path = None
    _last_registry_mtime = 0.0


def persist_user_registry():
    global _last_registry_mtime
    if not user_registry_path:
        raise RuntimeError("User registry is not file-backed")
    registry_path = Path(user_registry_path)
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = registry_path.with_name(f"{registry_path.name}.tmp")
    users_payload = {
        "users": [
            {
                "token": token,
                "user_id": principal.get("user_id"),
                "role": principal.get("role") or "legacy",
                "permissions": principal.get("permissions") or _deep_copy_json(FULL_ACCESS_PERMISSIONS),
            }
            for token, principal in sorted(token_to_principal.items())
        ]
    }
    temp_path.write_text(
        json.dumps(users_payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    temp_path.replace(registry_path)
    
    # Safely update _last_registry_mtime to bypass the background reloader
    try:
        _last_registry_mtime = os.path.getmtime(user_registry_path)
    except Exception:
        _last_registry_mtime = time.time()


def find_token_for_user_id(user_id: str):
    if not user_id:
        return None
    registry = load_user_registry()
    for token, principal in registry.items():
        if principal.get("user_id") == user_id:
            return token
    return None


def ensure_token_for_user_id(user_id: str):
    if not user_id:
        raise ValueError("user_id is required")
    registry = load_user_registry()
    existing = find_token_for_user_id(user_id)
    if existing:
        return existing, False
    if user_registry_source != "PROXY_USERS_PATH" or not user_registry_path:
        raise RuntimeError("Token registry is read-only")
    token = secrets.token_hex(16)
    while token in registry:
        token = secrets.token_hex(16)
    registry[token] = _default_principal_for_user(str(user_id), str(token))
    persist_user_registry()
    return token, True


def _parse_x_forwarded_for(raw: str):
    if not raw:
        return None
    for part in raw.split(","):
        candidate = part.strip()
        if candidate:
            return candidate
    return None


def resolve_client_ip(peer_ip: str, headers=None):
    headers = headers or {}
    forwarded_ip = None
    client_ip = peer_ip
    if _env_flag("TRUST_PROXY_HEADERS", False):
        trusted = set(_env_csv("TRUST_PROXY_IPS"))
        if trusted and peer_ip in trusted:
            forwarded_ip = _parse_x_forwarded_for(headers.get("X-Forwarded-For", ""))
            if forwarded_ip:
                client_ip = forwarded_ip
    return client_ip, forwarded_ip



def _fallback_principal(user_id: str = "fallback"):
    return {
        "token": get_proxy_token(),
        "user_id": user_id,
        "role": "fallback",
        "permissions": _deep_copy_json(FULL_ACCESS_PERMISSIONS),
    }


def resolve_http_principal(token: str, request):
    if not token:
        return None
    registry = load_user_registry()
    if registry:
        principal = registry.get(token)
        if principal and _is_token_expired(principal):
            print(f"[Auth] Token expired for user {principal.get('user_id')}", flush=True)
            return None
        return principal
    peer_ip = getattr(request, "remote", None) or ""
    headers = dict(getattr(request, "headers", {}) or {})
    client_ip, _forwarded = resolve_client_ip(peer_ip, headers)
    if is_fallback_ip_allowed(client_ip) and token == get_proxy_token():
        return _fallback_principal()
    return None


def resolve_http_user_id(token: str, request):
    principal = resolve_http_principal(token, request)
    if principal:
        return principal.get("user_id")
    return None


def log_http_usage(endpoint: str, user_id, status: int, start_time: float, extra: dict | None = None):
    event = {
        "event": "http_request",
        "timestamp": time.time(),
        "endpoint": endpoint,
        "user_id": user_id,
        "status": status,
        "elapsed_ms": int((time.time() - start_time) * 1000),
    }
    if extra:
        event.update(extra)
    enqueue_usage_event(event)


def respond_cached_raw(cached, endpoint, user_id, start_time, extra=None, cache_status="HIT", cdn_max_age=3600):
    """Return a cached JSON payload (already serialized) as the HTTP response
    without parse+re-encode. Major win on cache HIT hot path."""
    log_http_usage(endpoint, user_id, 200, start_time, extra)
    if isinstance(cached, bytes):
        body = cached
    elif isinstance(cached, str):
        body = cached.encode()
    else:
        body = _fast_dumps_str(cached).encode()
    return web.Response(
        body=body,
        status=200,
        content_type="application/json",
        headers={
            "X-Cache": cache_status,
            "Cache-Control": f"public, max-age={cdn_max_age}, stale-while-revalidate=3600",
            "CDN-Cache-Control": f"public, max-age={cdn_max_age}",
            "Vary": "Accept-Encoding",
        },
    )

usage_log_queue: asyncio.Queue | None = None
usage_log_task: asyncio.Task | None = None
usage_log_dropped = 0
usage_log_shutdown_requested = False
usage_log_shutdown_reason = None
usage_log_error_logged = False


def usage_log_required() -> bool:
    return _env_flag("USAGE_LOG_REQUIRED", False)


def usage_log_queue_max() -> int:
    raw = os.getenv("USAGE_LOG_QUEUE_MAX", "10000")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = 10000
    return max(1, value)


def usage_log_path() -> str:
    return os.getenv("USAGE_LOG_PATH", "/tmp/cloud-proxy-usage.jsonl")


def request_usage_log_shutdown(reason: str):
    global usage_log_shutdown_requested, usage_log_shutdown_reason
    usage_log_shutdown_requested = True
    usage_log_shutdown_reason = reason


def reset_usage_log_state():
    global usage_log_queue, usage_log_task, usage_log_dropped
    global usage_log_shutdown_requested, usage_log_shutdown_reason, usage_log_error_logged
    usage_log_queue = None
    usage_log_task = None
    usage_log_dropped = 0
    usage_log_shutdown_requested = False
    usage_log_shutdown_reason = None
    usage_log_error_logged = False



# === Rate Limiting ===
class RateLimiter:
    """Simple in-memory rate limiter per user."""
    def __init__(self):
        self._requests: dict[str, list[float]] = {}  # user_id -> list of timestamps
        self._ws_subs: dict[str, int] = {}  # user_id -> symbol count
        self._lock = asyncio.Lock()

    async def check_rest(self, user_id: str, role: str = "default") -> tuple[bool, int, int]:
        """Check REST rate limit. Returns (allowed, current_count, limit)."""
        if not user_id:
            return True, 0, 0
        limits = {
            "basic": 600,        # 10 req/s
            "value": 1800,       # 30 req/s — REST-heavy mid tier (above standard, below premium)
            "standard": 1800,    # 30 req/s
            "premium": 6000,     # 100 req/s
            "test": 5000,       # internal load-test role — lifted so 18 test
                                # users × 5000/min = 90k/min can saturate the
                                # paid key's 10k/min Alpaca limit and exercise
                                # the multi-key pool's free overflow capacity
            "default": 30,
            "legacy": 60,
            "fallback": 1000,
            "admin": 1000,
        }
        limit = limits.get(role, 30)
        now = time.time()
        window = 60.0  # 1 minute window
        async with self._lock:
            timestamps = self._requests.get(user_id, [])
            # Remove old entries
            timestamps = [t for t in timestamps if now - t < window]
            if len(timestamps) >= limit:
                self._requests[user_id] = timestamps
                return False, len(timestamps), limit
            timestamps.append(now)
            self._requests[user_id] = timestamps
            return True, len(timestamps), limit

    async def check_ws_subs(self, user_id: str, requested_symbols: int, role: str = "default") -> tuple[bool, int, int]:
        """Check WS subscription symbol limit. Returns (allowed, current, limit)."""
        if not user_id:
            return True, 0, 0
        limits = {
            "basic": 10,
            "value": 30,
            "standard": 100,
            "premium": 500,
            "test": 200,        # internal load-test role
            "default": 50,
            "legacy": 100,
            "fallback": 1000,
            "admin": 1000,
        }
        limit = limits.get(role, 50)
        async with self._lock:
            current = self._ws_subs.get(user_id, 0)
            if current + requested_symbols > limit:
                return False, current, limit
            self._ws_subs[user_id] = max(0, current + requested_symbols)
            return True, self._ws_subs[user_id], limit

    async def decr_ws_subs(self, user_id: str, count: int):
        """Decrement WS subscription count on unsubscribe/disconnect."""
        if not user_id:
            return
        async with self._lock:
            current = self._ws_subs.get(user_id, 0)
            self._ws_subs[user_id] = max(0, current - count)

    def get_user_stats(self, user_id: str) -> dict:
        now = time.time()
        window = 60.0
        timestamps = [t for t in self._requests.get(user_id, []) if now - t < window]
        return {
            "rest_requests_1min": len(timestamps),
            "ws_symbols": self._ws_subs.get(user_id, 0),
        }

    def get_all_stats(self) -> dict:
        now = time.time()
        window = 60.0
        result = {}
        for uid, timestamps in self._requests.items():
            active = [t for t in timestamps if now - t < window]
            result[uid] = {
                "rest_requests_1min": len(active),
                "ws_symbols": self._ws_subs.get(uid, 0),
            }
        return result




# === Stream Priority: WS > REST under load ===
REST_CONCURRENT_MAX = int(os.getenv("REST_CONCURRENT_MAX", "50"))
REST_OVERLOAD_LATENCY_SEC = float(os.getenv("REST_OVERLOAD_LATENCY_SEC", "0.5"))
REST_CRITICAL_LATENCY_SEC = float(os.getenv("REST_CRITICAL_LATENCY_SEC", "2.0"))

_rest_active_count = 0
_rest_active_lock = asyncio.Lock()

_user_rest_active: dict[str, int] = {}
_user_rest_active_lock = asyncio.Lock()


def count_active_ws_connections(user_id: str) -> int:
    """Count active WebSocket connections for a user across all active modes."""
    if not user_id:
        return 0
    count = 0
    for d in (ws_user_id, options_ws_user_id, test_ws_user_id, boats_ws_user_id, overnight_ws_user_id, crypto_ws_user_id, news_ws_user_id):
        count += sum(1 for uid in d.values() if uid == user_id)
    return count



async def _rest_enter():
    global _rest_active_count
    async with _rest_active_lock:
        _rest_active_count += 1


async def _rest_exit():
    global _rest_active_count
    async with _rest_active_lock:
        _rest_active_count = max(0, _rest_active_count - 1)


_load_status_cache = {"ts": 0.0, "value": (False, False, {})}

def get_rest_load_status():
    """Returns (overloaded, critical, stats). Cached for 1s to avoid syscall
    storm on every REST request (psutil reads /proc/* each call)."""
    now = time.time()
    if now - _load_status_cache["ts"] < 1.0:
        return _load_status_cache["value"]
    stats = get_system_stats()
    mem = stats.get("memory_percent", 0)
    load1 = stats.get("load_1min", 0)
    cpu = stats.get("cpu_percent", 0)
    critical = mem > 92 or load1 > 4.0 or cpu > 95
    overloaded = mem > 85 or load1 > 2.0 or cpu > 80
    value = (overloaded, critical, stats)
    _load_status_cache["ts"] = now
    _load_status_cache["value"] = value
    return value


async def _extract_token(request) -> str | None:
    # 1. Check query parameters
    token = request.query.get("token")
    if token:
        return token
    # 2. Check Authorization header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:]
    # 3. Check JSON body if applicable
    if request.method == "POST" and request.content_type == "application/json":
        try:
            data = await request.json()
            if isinstance(data, dict):
                return data.get("token")
        except Exception:
            pass
    return None


@web.middleware
async def stream_priority_middleware(request, handler):
    """Backpressure middleware: slow/reject REST when system overloaded. WS unaffected."""
    
    # Extract token and resolve user_id for concurrency limit
    user_id = None
    max_rest_conns = 3  # Default fallback limit
    
    if request.path != "/health":
        try:
            token = await _extract_token(request)
            if token:
                principal = resolve_http_principal(token, request)
                if principal:
                    user_id = principal.get("user_id")
                    role = principal.get("role", "default")
                    
                    permissions = principal.get("permissions", {})
                    if "max_rest_conns" in permissions:
                        max_rest_conns = int(permissions["max_rest_conns"])
                    else:
                        role_limits = {
                            "basic": 2,
                            "value": 3,
                            "standard": 5,
                            "premium": 10,
                            "test": 200,        # internal load-test role — lifted for stress testing
                            "default": 3,
                            "legacy": 5,
                            "fallback": 100,
                            "admin": 100,
                        }
                        max_rest_conns = role_limits.get(role, 3)
        except Exception as exc:
            print(f"[Middleware] Token extraction / resolution failed: {exc}", flush=True)

    # Concurrency limit check
    if user_id:
        async with _user_rest_active_lock:
            current = _user_rest_active.get(user_id, 0)
            if current >= max_rest_conns:
                log_http_usage(request.path, user_id, 429, time.time(), {"reason": "concurrency_limit", "current": current, "limit": max_rest_conns})
                return web.Response(
                    status=429,
                    text=json.dumps({"error": f"REST concurrency limit exceeded: {current}/{max_rest_conns} parallel requests"}),
                    content_type="application/json"
                )
            _user_rest_active[user_id] = current + 1

    try:
        overloaded, critical, stats = get_rest_load_status()
        current_active = _rest_active_count

        # Hard reject under critical load
        if critical:
            if current_active > max(1, REST_CONCURRENT_MAX // 4):
                return web.Response(
                    status=503,
                    headers={
                        "Retry-After": "10",
                        "X-Priority": "stream",
                        "X-Load": "critical",
                        "X-Rest-Active": str(current_active),
                    },
                    text=json.dumps({"error": "Server overloaded, stream priority active. Retry later."}),
                )

        # Reject under overloaded + concurrency cap
        if overloaded:
            if current_active > REST_CONCURRENT_MAX:
                return web.Response(
                    status=503,
                    headers={
                        "Retry-After": "5",
                        "X-Priority": "stream",
                        "X-Load": "high",
                        "X-Rest-Active": str(current_active),
                    },
                    text=json.dumps({"error": "Server overloaded, stream priority active. Retry later."}),
                )

        await _rest_enter()
        try:
            # Only apply throttle sleep when there is real REST queuing —
            # otherwise mem/load signals punish cache hits with 500ms latency
            # for no concurrency-reduction benefit.
            queue_pressure = current_active > max(1, REST_CONCURRENT_MAX // 2)
            if critical and queue_pressure:
                await asyncio.sleep(REST_CRITICAL_LATENCY_SEC)
            elif overloaded and queue_pressure:
                await asyncio.sleep(REST_OVERLOAD_LATENCY_SEC)

            response = await handler(request)

            # Annotate response headers
            if critical:
                response.headers["X-Priority"] = "stream"
                response.headers["X-Load"] = "critical"
                response.headers["X-Rest-Active"] = str(current_active)
            elif overloaded:
                response.headers["X-Priority"] = "stream"
                response.headers["X-Load"] = "high"
                response.headers["X-Rest-Active"] = str(current_active)

            return response
        finally:
            await _rest_exit()
    finally:
        if user_id:
            async with _user_rest_active_lock:
                current = _user_rest_active.get(user_id, 0)
                _user_rest_active[user_id] = max(0, current - 1)



class AdaptiveRateLimiter(RateLimiter):
    """Tightens REST limits under system load. WS limits unchanged."""

    async def check_rest(self, user_id: str, role: str = "default"):
        base_allowed, current, base_limit = await super().check_rest(user_id, role)
        if not base_allowed:
            return False, current, base_limit

        overloaded, critical, _stats = get_rest_load_status()
        if critical:
            tightened = max(1, base_limit // 4)
            if current > tightened:
                return False, current, tightened
            return True, current, tightened
        if overloaded:
            tightened = max(1, base_limit // 2)
            if current > tightened:
                return False, current, tightened
            return True, current, tightened
        return True, current, base_limit


rate_limiter = AdaptiveRateLimiter()


def is_system_overloaded() -> bool:
    """Check if system is under stress (memory or CPU)."""
    try:
        import psutil
        mem = psutil.virtual_memory()
        if mem.percent > 95:
            return True
        load1, _, _ = psutil.getloadavg()
        if load1 > 20.0:
            return True
    except Exception:
        pass
    return False


def get_system_stats() -> dict:
    """Get current system resource stats."""
    try:
        import psutil
        mem = psutil.virtual_memory()
        load1, load5, load15 = psutil.getloadavg()
        return {
            "memory_percent": mem.percent,
            "memory_available_mb": mem.available // (1024 * 1024),
            "load_1min": load1,
            "load_5min": load5,
            "load_15min": load15,
            # interval=None: non-blocking, returns delta since last call.
            # interval>0 calls time.sleep() and freezes the asyncio event loop —
            # under N concurrent REST requests this serializes to N×interval of
            # pure blocking. Seeded at startup so first call isn't 0.0.
            "cpu_percent": psutil.cpu_percent(interval=None),
        }
    except Exception:
        return {}



def init_usage_logger():
    global usage_log_queue
    if usage_log_queue is None:
        usage_log_queue = asyncio.Queue(maxsize=usage_log_queue_max())
    return usage_log_queue


def handle_usage_log_error(exc: Exception, reason: str):
    global usage_log_error_logged
    if usage_log_required():
        request_usage_log_shutdown(reason)
        return
    if not usage_log_error_logged:
        usage_log_error_logged = True
        print(f"[Cloud] Usage log error ({reason}): {exc}", flush=True)


def log_ws_usage(event_type: str, user_id, mode: str, extra: dict | None = None):
    event = {
        "event": "ws_request",
        "ws_event": event_type,
        "user_id": user_id,
        "mode": mode,
        "timestamp": time.time(),
    }
    if extra:
        event.update(extra)
    enqueue_usage_event(event)


def enqueue_usage_event(event: dict) -> bool:
    global usage_log_dropped
    if usage_log_queue is None:
        init_usage_logger()
    try:
        usage_log_queue.put_nowait(event)
        return True
    except asyncio.QueueFull:
        if usage_log_required():
            request_usage_log_shutdown("usage_log_overflow")
            return False
        usage_log_dropped += 1
        try:
            _ = usage_log_queue.get_nowait()
            usage_log_queue.put_nowait(event)
            return True
        except Exception:
            return False


def validate_usage_log_path_or_fail():
    path = usage_log_path()
    try:
        with open(path, "a", encoding="utf-8"):
            pass
    except Exception as exc:
        handle_usage_log_error(exc, "usage_log_open_failed")
        if usage_log_required():
            raise RuntimeError("Usage log path not writable") from exc


async def usage_log_writer():
    if usage_log_queue is None:
        init_usage_logger()
    # Drain the queue in batches: open() + close() per event is a syscall
    # storm that blocks the event loop under load. Keep the file open and
    # flush after each batch.
    path = usage_log_path()
    while True:
        event = await usage_log_queue.get()
        if event is None:
            break
        batch = [event]
        # Greedy drain — collect anything else already queued (non-blocking)
        for _ in range(255):
            try:
                nxt = usage_log_queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            if nxt is None:
                batch.append(None)
                break
            batch.append(nxt)
        try:
            with open(path, "a", encoding="utf-8") as handle:
                for ev in batch:
                    if ev is None:
                        continue
                    handle.write(json.dumps(ev) + "\n")
        except Exception as exc:
            handle_usage_log_error(exc, "writer_failed")
            if usage_log_required():
                break
        if batch and batch[-1] is None:
            break


def _is_token_expired(principal) -> bool:
    """Check if a principal's token has expired based on expires_at field."""
    if not principal or not isinstance(principal, dict):
        return False
    expires_at = principal.get("expires_at")
    if not expires_at:
        return False  # no expiry set = never expires
    try:
        from datetime import datetime, timezone
        exp_str = str(expires_at).replace("+00:00", "Z").replace("+0000", "Z")
        if exp_str.endswith("Z"):
            exp_str = exp_str[:-1]
        # Handle both with and without microseconds
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
            try:
                exp_dt = datetime.strptime(exp_str, fmt).replace(tzinfo=timezone.utc)
                break
            except ValueError:
                continue
        else:
            return False
        return datetime.now(timezone.utc) > exp_dt
    except Exception:
        return False


def token_required() -> bool:
    registry = load_user_registry()
    if registry:
        return True
    return bool(get_proxy_token())


def is_valid_token(token: str) -> bool:
    registry = load_user_registry()
    if registry:
        return token in registry
    if is_fallback_enabled():
        return token == get_proxy_token()
    if not token_required():
        return True
    return False


def _principal_permissions(principal):
    if not isinstance(principal, dict):
        return _deep_copy_json(NO_ACCESS_PERMISSIONS)
    permissions = principal.get("permissions")
    if isinstance(permissions, dict):
        return permissions
    return _deep_copy_json(FULL_ACCESS_PERMISSIONS)


def allow_ws_mode(principal, mode: str) -> bool:
    key = WS_PERMISSION_BY_MODE.get(mode)
    if not key:
        return False
    return bool(_principal_permissions(principal).get("ws", {}).get(key, False))


def allow_rest_endpoint(principal, endpoint: str) -> bool:
    key = rest_permission_for_endpoint(endpoint)
    if not key:
        return False
    if key == "news_history":
        return True
    return bool(_principal_permissions(principal).get("rest", {}).get(key, False))


def rest_permission_for_endpoint(endpoint: str):
    key = REST_PERMISSION_BY_ENDPOINT.get(endpoint)
    if key:
        return key
    return native_provider_permission(endpoint)


def native_provider_for_endpoint(endpoint: str):
    if endpoint.startswith("/v3/option/"):
        return "thetadata"
    if native_provider_permission(endpoint):
        return "alpaca"
    return None


def native_provider_permission(endpoint: str):
    if endpoint.startswith("/v2/stocks/"):
        return "stocks_history"
    if endpoint.startswith("/v1beta3/crypto/"):
        return "crypto_orderbooks"
    if endpoint.startswith("/v1beta1/crypto-perps/"):
        return "crypto_orderbooks"
    if endpoint == "/v1beta1/news" or endpoint.startswith("/v1beta1/news/"):
        return "news_history"
    if endpoint == "/v2/options/contracts" or endpoint.startswith("/v2/options/contracts/"):
        return "options_contracts"
    if endpoint.startswith("/v1beta1/options/"):
        if "/latest/" in endpoint or endpoint.endswith("/latest") or "/snapshots" in endpoint:
            return "options_snapshots"
        return "options_history"
    return None


def alpaca_upstream_url(endpoint: str) -> str:
    if endpoint == "/v2/options/contracts" or endpoint.startswith("/v2/options/contracts/"):
        return f"{TRADING_URL}{endpoint}"
    return f"{DATA_URL}{endpoint}"


def _cacheable_request_params(params: dict) -> dict:
    cleaned = {}
    for key, value in (params or {}).items():
        if key in PROXY_AUTH_PARAM_NAMES or value is None:
            continue
        if hasattr(value, "isoformat"):
            value = value.isoformat()
        elif isinstance(value, (list, tuple)):
            value = [item.isoformat() if hasattr(item, "isoformat") else item for item in value]
        cleaned[key] = value
    return cleaned


def _merged_request_params(data: dict, request) -> dict:
    params = dict(request.rel_url.query)
    if isinstance(data, dict):
        for key, value in data.items():
            if key in PROXY_AUTH_PARAM_NAMES:
                continue
            params[key] = value
    return params


async def _get_disk_cached_response(endpoint: str, params: dict):
    try:
        disk = await get_disk_cache_instance()
        if disk is None:
            return None
        return await disk.get(endpoint, _cacheable_request_params(params))
    except Exception as e:
        print(f"[DiskCache] {endpoint} get error: {e}")
        return None


async def _put_disk_cached_response(endpoint: str, params: dict, payload):
    if not isinstance(payload, (dict, list)):
        return
    try:
        disk = await get_disk_cache_instance()
        if disk is not None:
            await disk.put(endpoint, _cacheable_request_params(params), payload)
    except Exception as e:
        print(f"[DiskCache] {endpoint} put error: {e}")



# === In-Memory Cache (replaces Redis for 1GB RAM instances) ===
class MemoryRedisClient:
    """Drop-in Redis replacement using Python dict + TTL."""
    def __init__(self, max_size=500, default_ttl=300):
        self._cache = {}  # key -> (value_bytes, expire_timestamp)
        self._max_size = max_size
        self._default_ttl = default_ttl
        self._lock = asyncio.Lock()

    async def get(self, key):
        async with self._lock:
            if key not in self._cache:
                return None
            value, expire_at = self._cache[key]
            if time.time() > expire_at:
                del self._cache[key]
                return None
            return value

    async def set(self, key, value, ex=None):
        ttl = ex or self._default_ttl
        async with self._lock:
            # Evict oldest if at capacity
            if len(self._cache) >= self._max_size:
                oldest_key = min(self._cache, key=lambda k: self._cache[k][1])
                del self._cache[oldest_key]
            self._cache[key] = (value, time.time() + ttl)

    async def close(self):
        pass

_memory_redis_client = None

async def get_redis_client():
    global _memory_redis_client
    if _memory_redis_client is not None:
        return _memory_redis_client

    redis_url = os.getenv("REDIS_URL")
    if redis_async is not None and redis_url:
        try:
            # Dynamically connect to the real running Redis container on EC2!
            client = redis_async.from_url(redis_url, decode_responses=True)
            await client.ping()
            print(f"[Cache] Connected to actual Redis container at {redis_url}", flush=True)
            _memory_redis_client = client
            return _memory_redis_client
        except Exception as e:
            print(f"[Cache] Failed to connect to Redis container at {redis_url}: {e}. Falling back to MemoryRedis...", flush=True)

    max_size = int(os.getenv("CACHE_MAX_ENTRIES", "500"))
    ttl = int(os.getenv("CACHE_TTL_SECONDS", "300"))
    _memory_redis_client = MemoryRedisClient(max_size=max_size, default_ttl=ttl)
    print(f"[Cache] MemoryRedis initialized: max_size={max_size}, ttl={ttl}s", flush=True)
    return _memory_redis_client


# In-flight request coalescing: key -> asyncio.Future
_inflight_requests: dict = {}
_inflight_lock = asyncio.Lock()

def _make_inflight_key(endpoint: str, params: dict) -> str:
    return f"{endpoint}:{params.get('symbols','')}:{params.get('symbol','')}:{params.get('start','')}:{params.get('end','')}:{params.get('timeframe','')}:{params.get('limit',10000)}:{params.get('max_pages',100)}"


def unpack_message(message):
    if isinstance(message, (bytes, bytearray)):
        return msgpack.unpackb(message, raw=False)
    if isinstance(message, str):
        return json.loads(message)
    return message


def debug_log(message, data, hypothesis_id, run_id="run1"):
    if not DEBUG_LOG_ENABLED:
        return
    payload = {
        "sessionId": "debug-session",
        "runId": run_id,
        "hypothesisId": hypothesis_id,
        "location": "alpaca_cloud_proxy.py",
        "message": message,
        "data": data,
        "timestamp": int(time.time() * 1000),
    }
    try:
        with open(DEBUG_LOG_PATH, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload) + "\n")
    except Exception:
        return


def agent_log(hypothesis_id, location, message, data=None, run_id="run1"):
    """
    Backward-compatible bridge for legacy agent_log(...) callsites.
    """
    payload = {"location": location}
    if data:
        payload.update(data)
    debug_log(message, payload, hypothesis_id, run_id=run_id)


def filter_subscription_messages(data):
    if isinstance(data, dict):
        if data.get("T") == "subscription":
            return None, 1
        return data, 0
    if isinstance(data, list):
        filtered = [item for item in data if not (isinstance(item, dict) and item.get("T") == "subscription")]
        removed = len(data) - len(filtered)
        return (filtered or None), removed
    return data, 0


def _invalid_stock_symbols(symbols):
    invalid = []
    dot_symbols = []
    for symbol in symbols:
        if not isinstance(symbol, str) or not symbol:
            invalid.append(symbol)
            continue
        if "." in symbol:
            dot_symbols.append(symbol)
        if not all(ch.isalnum() or ch == "." for ch in symbol):
            invalid.append(symbol)
    return invalid, dot_symbols


def _invalid_option_symbols(symbols):
    invalid = []
    for symbol in symbols:
        if not isinstance(symbol, str) or not symbol or not symbol.isalnum():
            invalid.append(symbol)
    return invalid


def _normalize_crypto_symbol(value):
    if not isinstance(value, str):
        return None
    text = value.strip().upper()
    if not text:
        return None
    parts = text.split("/")
    if len(parts) != 2:
        return None
    base, quote = parts[0].strip(), parts[1].strip()
    if not base or not quote:
        return None
    if not base.isalnum() or not quote.isalnum():
        return None
    return f"{base}/{quote}"


def _invalid_crypto_symbols(symbols):
    invalid = []
    for symbol in symbols:
        if _normalize_crypto_symbol(symbol) is None:
            invalid.append(symbol)
    return invalid


def _normalize_news_symbol(value):
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if text == "*":
        return "*"
    return text.upper()


def _filter_news_subscriptions(news):
    if isinstance(news, str):
        news_list = [news]
    else:
        news_list = list(news or [])
    valid = []
    invalid = []
    for item in news_list:
        norm = _normalize_news_symbol(item)
        if norm is None:
            invalid.append(item)
        else:
            valid.append(norm)
    valid_set = set(valid)
    if "*" in valid_set:
        valid_set = {"*"}
    return valid_set, invalid


def ws_is_closed(ws) -> bool:
    if ws is None:
        return True
    closed = getattr(ws, "closed", None)
    if isinstance(closed, bool):
        return closed
    close_code = getattr(ws, "close_code", None)
    if close_code is not None:
        return True
    state = getattr(ws, "state", None)
    if state is not None:
        try:
            if isinstance(state, int):
                return state == 3
            return str(state).lower().endswith("closed")
        except Exception:
            return False
    return False


def ws_is_open(ws) -> bool:
    if ws is None:
        return False
    is_open = getattr(ws, "open", None)
    if isinstance(is_open, bool):
        return is_open
    state = getattr(ws, "state", None)
    if state is not None:
        try:
            if isinstance(state, int):
                return state == 1
            return str(state).lower().endswith("open")
        except Exception:
            return False
    return not ws_is_closed(ws)


async def connect_alpaca():
    global alpaca_ws
    if alpaca_ws is not None:
        return alpaca_ws

    if not ALPACA_MASTER_KEY or not ALPACA_MASTER_SECRET:
        raise RuntimeError("Missing ALPACA_MASTER_KEY/ALPACA_MASTER_SECRET for cloud collector.")

    async with alpaca_lock:
        if alpaca_ws is not None:
            return alpaca_ws

        print(f"[Cloud] Connecting to Alpaca: {STREAM_URL}", flush=True)
        ws = await websockets.connect(STREAM_URL, compression=None)

        msg = await ws.recv()
        data = unpack_message(msg)
        print(f"[Cloud] Alpaca welcome: {data}", flush=True)

        auth_msg = {"action": "auth", "key": ALPACA_MASTER_KEY, "secret": ALPACA_MASTER_SECRET}
        print(f"[Cloud] Sending auth with key prefix: {ALPACA_MASTER_KEY[:4] if ALPACA_MASTER_KEY else 'NONE'}...", flush=True)
        await ws.send(json.dumps(auth_msg))

        auth_resp = await ws.recv()
        auth_data = unpack_message(auth_resp)
        print(f"[Cloud] Alpaca auth response: {auth_data}", flush=True)
        
        # If auth failed, clear the ws object so we don't try to use it
        if isinstance(auth_data, list) and auth_data[0].get("T") == "error":
            print(f"[Cloud] FATAL: Alpaca authentication failed: {auth_data[0]}", flush=True)
            await ws.close()
            return None
        
        if isinstance(auth_data, dict) and auth_data.get("T") == "error":
            print(f"[Cloud] FATAL: Alpaca authentication failed: {auth_data}", flush=True)
            await ws.close()
            return None

        alpaca_ws = ws
        return ws


async def connect_alpaca_test():
    global alpaca_test_ws
    if alpaca_test_ws is not None:
        return alpaca_test_ws

    if not ALPACA_MASTER_KEY or not ALPACA_MASTER_SECRET:
        raise RuntimeError("Missing ALPACA_MASTER_KEY/ALPACA_MASTER_SECRET for cloud collector.")

    async with alpaca_test_lock:
        if alpaca_test_ws is not None:
            return alpaca_test_ws

        print(f"[Cloud] Connecting to Alpaca TEST: {TEST_STREAM_URL}", flush=True)
        ws = await websockets.connect(TEST_STREAM_URL, compression=None)

        msg = await ws.recv()
        data = unpack_message(msg)
        print(f"[Cloud] Alpaca TEST welcome: {data}", flush=True)

        auth_msg = {"action": "auth", "key": ALPACA_MASTER_KEY, "secret": ALPACA_MASTER_SECRET}
        await ws.send(json.dumps(auth_msg))

        auth_resp = await ws.recv()
        auth_data = unpack_message(auth_resp)
        print(f"[Cloud] Alpaca TEST auth response: {auth_data}", flush=True)

        if isinstance(auth_data, list) and auth_data and auth_data[0].get("T") == "error":
            print(f"[Cloud] FATAL: Alpaca TEST authentication failed: {auth_data[0]}", flush=True)
            await ws.close()
            return None

        if isinstance(auth_data, dict) and auth_data.get("T") == "error":
            print(f"[Cloud] FATAL: Alpaca TEST authentication failed: {auth_data}", flush=True)
            await ws.close()
            return None

        alpaca_test_ws = ws
        return ws


async def connect_alpaca_boats():
    global alpaca_boats_ws
    if alpaca_boats_ws is not None:
        return alpaca_boats_ws

    if not ALPACA_MASTER_KEY or not ALPACA_MASTER_SECRET:
        raise RuntimeError("Missing ALPACA_MASTER_KEY/ALPACA_MASTER_SECRET for cloud collector.")

    async with alpaca_boats_lock:
        if alpaca_boats_ws is not None:
            return alpaca_boats_ws

        print(f"[Cloud] Connecting to Alpaca BOATS: {BOATS_STREAM_URL}", flush=True)
        ws = await websockets.connect(BOATS_STREAM_URL, compression=None)

        msg = await ws.recv()
        data = unpack_message(msg)
        print(f"[Cloud] Alpaca BOATS welcome: {data}", flush=True)

        auth_msg = {"action": "auth", "key": ALPACA_MASTER_KEY, "secret": ALPACA_MASTER_SECRET}
        await ws.send(json.dumps(auth_msg))

        auth_resp = await ws.recv()
        auth_data = unpack_message(auth_resp)
        print(f"[Cloud] Alpaca BOATS auth response: {auth_data}", flush=True)

        if isinstance(auth_data, list) and auth_data and auth_data[0].get("T") == "error":
            print(f"[Cloud] FATAL: Alpaca BOATS authentication failed: {auth_data[0]}", flush=True)
            await ws.close()
            return None

        if isinstance(auth_data, dict) and auth_data.get("T") == "error":
            print(f"[Cloud] FATAL: Alpaca BOATS authentication failed: {auth_data}", flush=True)
            await ws.close()
            return None

        alpaca_boats_ws = ws
        return ws


async def connect_alpaca_overnight():
    global alpaca_overnight_ws
    if alpaca_overnight_ws is not None:
        return alpaca_overnight_ws

    if not ALPACA_MASTER_KEY or not ALPACA_MASTER_SECRET:
        raise RuntimeError("Missing ALPACA_MASTER_KEY/ALPACA_MASTER_SECRET for cloud collector.")

    async with alpaca_overnight_lock:
        if alpaca_overnight_ws is not None:
            return alpaca_overnight_ws

        print(f"[Cloud] Connecting to Alpaca OVERNIGHT: {OVERNIGHT_STREAM_URL}", flush=True)
        ws = await websockets.connect(OVERNIGHT_STREAM_URL, compression=None)

        msg = await ws.recv()
        data = unpack_message(msg)
        print(f"[Cloud] Alpaca OVERNIGHT welcome: {data}", flush=True)

        auth_msg = {"action": "auth", "key": ALPACA_MASTER_KEY, "secret": ALPACA_MASTER_SECRET}
        await ws.send(json.dumps(auth_msg))

        auth_resp = await ws.recv()
        auth_data = unpack_message(auth_resp)
        print(f"[Cloud] Alpaca OVERNIGHT auth response: {auth_data}", flush=True)

        if isinstance(auth_data, list) and auth_data and auth_data[0].get("T") == "error":
            print(f"[Cloud] FATAL: Alpaca OVERNIGHT authentication failed: {auth_data[0]}", flush=True)
            await ws.close()
            return None

        if isinstance(auth_data, dict) and auth_data.get("T") == "error":
            print(f"[Cloud] FATAL: Alpaca OVERNIGHT authentication failed: {auth_data}", flush=True)
            await ws.close()
            return None

        alpaca_overnight_ws = ws
        return ws


async def connect_alpaca_options(key: str = None, secret: str = None, label: str = "paid"):
    global alpaca_options_ws
    
    key = key or ALPACA_MASTER_KEY
    secret = secret or ALPACA_MASTER_SECRET

    if label == "paid" and alpaca_options_ws is not None:
        return alpaca_options_ws, label

    if not key or not secret:
        raise RuntimeError(f"Missing key/secret for Alpaca Options WS (label={label}).")

    async with alpaca_options_lock:
        if label == "paid" and alpaca_options_ws is not None:
            return alpaca_options_ws, label

        print(f"[Cloud] Connecting to Alpaca Options ({label}): {OPTIONS_STREAM_URL}")
        ws = await websockets.connect(
            OPTIONS_STREAM_URL,
            compression=None,
            additional_headers={"Content-Type": "application/msgpack"},
        )

        msg = await ws.recv()
        data = unpack_message(msg)
        print(f"[Cloud] Alpaca options ({label}) welcome: {data}")

        auth_msg = {"action": "auth", "key": key, "secret": secret}
        await ws.send(msgpack.packb(auth_msg, use_bin_type=True))

        auth_resp = await ws.recv()
        auth_data = unpack_message(auth_resp)
        print(f"[Cloud] Alpaca options ({label}) auth response: {auth_data}")

        if label == "paid":
            alpaca_options_ws = ws
        return ws, label


async def connect_alpaca_crypto():
    global alpaca_crypto_ws
    if alpaca_crypto_ws is not None:
        return alpaca_crypto_ws

    if not ALPACA_MASTER_KEY or not ALPACA_MASTER_SECRET:
        raise RuntimeError("Missing ALPACA_MASTER_KEY/ALPACA_MASTER_SECRET for cloud collector.")

    async with alpaca_crypto_lock:
        if alpaca_crypto_ws is not None:
            return alpaca_crypto_ws

        print(f"[Cloud] Connecting to Alpaca Crypto: {CRYPTO_STREAM_URL}", flush=True)
        ws = await websockets.connect(CRYPTO_STREAM_URL, compression=None)

        msg = await ws.recv()
        data = unpack_message(msg)
        print(f"[Cloud] Alpaca crypto welcome: {data}", flush=True)

        auth_msg = {"action": "auth", "key": ALPACA_MASTER_KEY, "secret": ALPACA_MASTER_SECRET}
        await ws.send(json.dumps(auth_msg))

        auth_resp = await ws.recv()
        auth_data = unpack_message(auth_resp)
        print(f"[Cloud] Alpaca crypto auth response: {auth_data}", flush=True)

        if isinstance(auth_data, list) and auth_data and isinstance(auth_data[0], dict) and auth_data[0].get("T") == "error":
            print(f"[Cloud] FATAL: Alpaca crypto authentication failed: {auth_data[0]}", flush=True)
            await ws.close()
            return None

        if isinstance(auth_data, dict) and auth_data.get("T") == "error":
            print(f"[Cloud] FATAL: Alpaca crypto authentication failed: {auth_data}", flush=True)
            await ws.close()
            return None

        alpaca_crypto_ws = ws
        return ws


async def connect_alpaca_news():
    global alpaca_news_ws
    if alpaca_news_ws is not None:
        return alpaca_news_ws

    if not ALPACA_MASTER_KEY or not ALPACA_MASTER_SECRET:
        raise RuntimeError("Missing ALPACA_MASTER_KEY/ALPACA_MASTER_SECRET for cloud collector.")

    async with alpaca_news_lock:
        if alpaca_news_ws is not None:
            return alpaca_news_ws

        print(f"[Cloud] Connecting to Alpaca News: {NEWS_STREAM_URL}", flush=True)
        ws = await websockets.connect(NEWS_STREAM_URL, compression=None)

        msg = await ws.recv()
        data = unpack_message(msg)
        print(f"[Cloud] Alpaca news welcome: {data}", flush=True)

        auth_msg = {"action": "auth", "key": ALPACA_MASTER_KEY, "secret": ALPACA_MASTER_SECRET}
        await ws.send(json.dumps(auth_msg))

        auth_resp = await ws.recv()
        auth_data = unpack_message(auth_resp)
        print(f"[Cloud] Alpaca news auth response: {auth_data}", flush=True)

        if isinstance(auth_data, list) and auth_data and isinstance(auth_data[0], dict) and auth_data[0].get("T") == "error":
            print(f"[Cloud] FATAL: Alpaca news authentication failed: {auth_data[0]}", flush=True)
            await ws.close()
            return None

        if isinstance(auth_data, dict) and auth_data.get("T") == "error":
            print(f"[Cloud] FATAL: Alpaca news authentication failed: {auth_data}", flush=True)
            await ws.close()
            return None

        alpaca_news_ws = ws
        return ws


async def send_alpaca_subscription():
    global subscribed_trades, subscribed_quotes, pending_subscription_update
    if ws_is_closed(alpaca_ws):
        pending_subscription_update = True
        return

    trades = set()
    quotes = set()
    for subs in relay_subscriptions.values():
        trades.update(subs.get("trades", set()))
        quotes.update(subs.get("quotes", set()))

    if trades == subscribed_trades and quotes == subscribed_quotes:
        return

    if not trades and not quotes:
        print("[Cloud] Skipping empty subscribe request to Alpaca", flush=True)
        return

    invalid, dot_symbols = _invalid_stock_symbols(trades | quotes)
    if invalid or dot_symbols:
        trades = {s for s in trades if isinstance(s, str) and s not in dot_symbols and s not in invalid}
        quotes = {s for s in quotes if isinstance(s, str) and s not in dot_symbols and s not in invalid}
        print(
            f"[Cloud] Filtered invalid stock symbols: invalid={len(invalid)} dots={len(dot_symbols)}",
            flush=True,
        )
    subscribed_trades = trades
    subscribed_quotes = quotes
    invalid, dot_symbols = _invalid_stock_symbols(subscribed_trades | subscribed_quotes)
    # region agent log
    debug_log(
        "alpaca_subscribe_payload",
        {
            "trades_len": len(subscribed_trades),
            "quotes_len": len(subscribed_quotes),
            "dot_count": len(dot_symbols),
            "invalid_count": len(invalid),
            "dot_sample": dot_symbols[:5],
            "invalid_sample": invalid[:5],
        },
        "H7",
    )
    # endregion agent log
    msg = {
        "action": "subscribe",
        "trades": list(subscribed_trades),
        "quotes": list(subscribed_quotes),
        "bars": []
    }
    print(f"[Cloud] Sending subscribe to Alpaca: {msg}", flush=True)
    await alpaca_ws.send(json.dumps(msg))
    pending_subscription_update = False
    print(f"[Cloud] Alpaca subscribed: trades={len(subscribed_trades)}, quotes={len(subscribed_quotes)}")


async def send_alpaca_test_subscription():
    global subscribed_test_trades, subscribed_test_quotes, pending_test_subscription_update
    if ws_is_closed(alpaca_test_ws):
        pending_test_subscription_update = True
        return

    trades = set()
    quotes = set()
    for subs in test_relay_subscriptions.values():
        trades.update(subs.get("trades", set()))
        quotes.update(subs.get("quotes", set()))

    if trades == subscribed_test_trades and quotes == subscribed_test_quotes:
        return

    if not trades and not quotes:
        print("[Cloud] Skipping empty subscribe request to Alpaca TEST", flush=True)
        return

    invalid, dot_symbols = _invalid_stock_symbols(trades | quotes)
    if invalid or dot_symbols:
        trades = {s for s in trades if isinstance(s, str) and s not in dot_symbols and s not in invalid}
        quotes = {s for s in quotes if isinstance(s, str) and s not in dot_symbols and s not in invalid}
        print(
            f"[Cloud] Filtered invalid stock symbols for TEST: invalid={len(invalid)} dots={len(dot_symbols)}",
            flush=True,
        )

    subscribed_test_trades = trades
    subscribed_test_quotes = quotes
    msg = {
        "action": "subscribe",
        "trades": list(subscribed_test_trades),
        "quotes": list(subscribed_test_quotes),
        "bars": []
    }
    print(f"[Cloud] Sending subscribe to Alpaca TEST: {msg}", flush=True)
    await alpaca_test_ws.send(json.dumps(msg))
    pending_test_subscription_update = False
    print(
        f"[Cloud] Alpaca TEST subscribed: trades={len(subscribed_test_trades)}, "
        f"quotes={len(subscribed_test_quotes)}"
    )


async def send_alpaca_boats_subscription():
    global subscribed_boats_trades, subscribed_boats_quotes, pending_boats_subscription_update
    if ws_is_closed(alpaca_boats_ws):
        pending_boats_subscription_update = True
        return

    trades = set()
    quotes = set()
    for subs in boats_relay_subscriptions.values():
        trades.update(subs.get("trades", set()))
        quotes.update(subs.get("quotes", set()))

    if trades == subscribed_boats_trades and quotes == subscribed_boats_quotes:
        return

    if not trades and not quotes:
        print("[Cloud] Skipping empty subscribe request to Alpaca BOATS", flush=True)
        return

    invalid, dot_symbols = _invalid_stock_symbols(trades | quotes)
    if invalid or dot_symbols:
        trades = {s for s in trades if isinstance(s, str) and s not in dot_symbols and s not in invalid}
        quotes = {s for s in quotes if isinstance(s, str) and s not in dot_symbols and s not in invalid}
        print(
            f"[Cloud] Filtered invalid stock symbols for BOATS: invalid={len(invalid)} dots={len(dot_symbols)}",
            flush=True,
        )

    subscribed_boats_trades = trades
    subscribed_boats_quotes = quotes
    msg = {
        "action": "subscribe",
        "trades": list(subscribed_boats_trades),
        "quotes": list(subscribed_boats_quotes),
        "bars": []
    }
    print(f"[Cloud] Sending subscribe to Alpaca BOATS: {msg}", flush=True)
    await alpaca_boats_ws.send(json.dumps(msg))
    pending_boats_subscription_update = False
    print(
        f"[Cloud] Alpaca BOATS subscribed: trades={len(subscribed_boats_trades)}, "
        f"quotes={len(subscribed_boats_quotes)}"
    )


async def send_alpaca_overnight_subscription():
    global subscribed_overnight_trades, subscribed_overnight_quotes, pending_overnight_subscription_update
    if ws_is_closed(alpaca_overnight_ws):
        pending_overnight_subscription_update = True
        return

    trades = set()
    quotes = set()
    for subs in overnight_relay_subscriptions.values():
        trades.update(subs.get("trades", set()))
        quotes.update(subs.get("quotes", set()))

    if trades == subscribed_overnight_trades and quotes == subscribed_overnight_quotes:
        return

    if not trades and not quotes:
        print("[Cloud] Skipping empty subscribe request to Alpaca OVERNIGHT", flush=True)
        return

    invalid, dot_symbols = _invalid_stock_symbols(trades | quotes)
    if invalid or dot_symbols:
        trades = {s for s in trades if isinstance(s, str) and s not in dot_symbols and s not in invalid}
        quotes = {s for s in quotes if isinstance(s, str) and s not in dot_symbols and s not in invalid}
        print(
            f"[Cloud] Filtered invalid stock symbols for OVERNIGHT: invalid={len(invalid)} dots={len(dot_symbols)}",
            flush=True,
        )

    subscribed_overnight_trades = trades
    subscribed_overnight_quotes = quotes
    msg = {
        "action": "subscribe",
        "trades": list(subscribed_overnight_trades),
        "quotes": list(subscribed_overnight_quotes),
        "bars": []
    }
    print(f"[Cloud] Sending subscribe to Alpaca OVERNIGHT: {msg}", flush=True)
    await alpaca_overnight_ws.send(json.dumps(msg))
    pending_overnight_subscription_update = False
    print(
        f"[Cloud] Alpaca OVERNIGHT subscribed: trades={len(subscribed_overnight_trades)}, "
        f"quotes={len(subscribed_overnight_quotes)}"
    )


async def send_alpaca_options_subscription():
    global subscribed_option_trades, subscribed_option_quotes, pending_options_subscription_update
    if ws_is_closed(alpaca_options_ws):
        pending_options_subscription_update = True
        return

    trades = set()
    quotes = set()
    for subs in options_relay_subscriptions.values():
        trades.update(subs.get("trades", set()))
        quotes.update(subs.get("quotes", set()))

    if trades == subscribed_option_trades and quotes == subscribed_option_quotes:
        return

    invalid = _invalid_option_symbols(trades | quotes)
    if invalid:
        trades = {s for s in trades if isinstance(s, str) and s not in invalid}
        quotes = {s for s in quotes if isinstance(s, str) and s not in invalid}
        print(f"[Cloud] Filtered invalid option symbols: invalid={len(invalid)}", flush=True)
    subscribed_option_trades = trades
    subscribed_option_quotes = quotes
    invalid = _invalid_option_symbols(subscribed_option_trades | subscribed_option_quotes)
    # region agent log
    debug_log(
        "alpaca_options_subscribe_payload",
        {
            "trades_len": len(subscribed_option_trades),
            "quotes_len": len(subscribed_option_quotes),
            "invalid_count": len(invalid),
            "invalid_sample": invalid[:5],
        },
        "H8",
    )
    # endregion agent log
    msg = {
        "action": "subscribe",
        "trades": list(subscribed_option_trades),
        "quotes": list(subscribed_option_quotes),
        "bars": []
    }
    await alpaca_options_ws.send(msgpack.packb(msg, use_bin_type=True))
    pending_options_subscription_update = False
    print(f"[Cloud] Alpaca options subscribed: trades={len(subscribed_option_trades)}, quotes={len(subscribed_option_quotes)}")


async def send_alpaca_crypto_subscription():
    global subscribed_orderbooks, subscribed_crypto_trades, pending_crypto_subscription_update
    if ws_is_closed(alpaca_crypto_ws):
        pending_crypto_subscription_update = True
        return

    orderbooks = set()
    trades = set()
    for subs in crypto_relay_subscriptions.values():
        orderbooks.update(subs.get("orderbooks", set()))
        trades.update(subs.get("trades", set()))

    normalized_orderbooks = set()
    invalid_orderbooks = []
    for value in orderbooks:
        norm = _normalize_crypto_symbol(value)
        if norm is None:
            invalid_orderbooks.append(value)
        else:
            normalized_orderbooks.add(norm)

    normalized_trades = set()
    invalid_trades = []
    for value in trades:
        norm = _normalize_crypto_symbol(value)
        if norm is None:
            invalid_trades.append(value)
        else:
            normalized_trades.add(norm)

    if normalized_orderbooks == subscribed_orderbooks and normalized_trades == subscribed_crypto_trades:
        return

    if not normalized_orderbooks and not normalized_trades:
        print("[Cloud] Skipping empty crypto subscribe request to Alpaca", flush=True)
        return

    if invalid_orderbooks or invalid_trades:
        print(
            f"[Cloud] Filtered invalid crypto symbols: orderbooks={len(invalid_orderbooks)} trades={len(invalid_trades)}",
            flush=True,
        )

    subscribed_orderbooks = normalized_orderbooks
    subscribed_crypto_trades = normalized_trades
    # Sort to keep upstream payload deterministic (useful for logs/tests).
    msg = {
        "action": "subscribe",
        "orderbooks": sorted(subscribed_orderbooks),
        "trades": sorted(subscribed_crypto_trades),
    }
    print(f"[Cloud] Sending crypto subscribe to Alpaca: {msg}", flush=True)
    await alpaca_crypto_ws.send(json.dumps(msg))
    pending_crypto_subscription_update = False
    print(
        f"[Cloud] Alpaca crypto subscribed: orderbooks={len(subscribed_orderbooks)} trades={len(subscribed_crypto_trades)}",
        flush=True,
    )


async def send_alpaca_news_subscription():
    global subscribed_news, pending_news_subscription_update
    if ws_is_closed(alpaca_news_ws):
        pending_news_subscription_update = True
        return

    news = set()
    for subs in news_relay_subscriptions.values():
        news.update(subs.get("news", set()))

    valid_news, invalid_news = _filter_news_subscriptions(news)
    if valid_news == subscribed_news:
        return

    if not valid_news:
        print("[Cloud] Skipping empty news subscribe request to Alpaca", flush=True)
        return

    if invalid_news:
        print(f"[Cloud] Filtered invalid news filters: invalid={len(invalid_news)}", flush=True)

    subscribed_news = valid_news
    msg = {
        "action": "subscribe",
        "news": sorted(subscribed_news),
    }
    print(f"[Cloud] Sending news subscribe to Alpaca: {msg}", flush=True)
    await alpaca_news_ws.send(json.dumps(msg))
    pending_news_subscription_update = False
    print(f"[Cloud] Alpaca news subscribed: filters={len(subscribed_news)}", flush=True)


async def send_queue_drain(websocket, send_queues, send_tasks):
    queue = send_queues.pop(websocket, None)
    if queue is not None:
        try:
            queue.put_nowait(None)
        except asyncio.QueueFull:
            try:
                queue.get_nowait()
                queue.put_nowait(None)
            except Exception:
                pass
    task = send_tasks.pop(websocket, None)
    if task is not None:
        task.cancel()




async def cleanup_ws(websocket, mode: str = "stock", reason: str = "disconnect", is_options=None, is_test=None):
    # Backward-compatible: some callsites pass is_options/is_test booleans.
    if isinstance(mode, bool):
        mode = "options" if mode else "stock"
    if is_options is True:
        mode = "options"
    if is_test is True:
        mode = "test"
    ws_stats.pop(websocket, None)
    if mode == "options":
        options_relay_clients.discard(websocket)
        options_relay_authed.discard(websocket)
        subs = options_relay_subscriptions.pop(websocket, None) or {}
        user_id = options_ws_user_id.pop(websocket, None)
        total_symbols = sum(len(s or []) for s in subs.values())
        if total_symbols > 0 and user_id:
            await rate_limiter.decr_ws_subs(user_id, total_symbols)
        await send_queue_drain(websocket, options_relay_send_queues, options_relay_send_tasks)
        try:
            await send_alpaca_options_subscription()
        except Exception:
            pass
    elif mode == "crypto":
        crypto_relay_clients.discard(websocket)
        crypto_relay_authed.discard(websocket)
        subs = crypto_relay_subscriptions.pop(websocket, None) or {}
        user_id = crypto_ws_user_id.pop(websocket, None)
        total_symbols = sum(len(s or []) for s in subs.values())
        if total_symbols > 0 and user_id:
            await rate_limiter.decr_ws_subs(user_id, total_symbols)
        await send_queue_drain(websocket, crypto_relay_send_queues, crypto_relay_send_tasks)
        try:
            await send_alpaca_crypto_subscription()
        except Exception:
            pass
    elif mode == "news":
        news_relay_clients.discard(websocket)
        news_relay_authed.discard(websocket)
        subs = news_relay_subscriptions.pop(websocket, None) or {}
        user_id = news_ws_user_id.pop(websocket, None)
        total_symbols = sum(len(s or []) for s in subs.values())
        if total_symbols > 0 and user_id:
            await rate_limiter.decr_ws_subs(user_id, total_symbols)
        await send_queue_drain(websocket, news_relay_send_queues, news_relay_send_tasks)
        try:
            await send_alpaca_news_subscription()
        except Exception:
            pass
    elif mode == "boats":
        boats_relay_clients.discard(websocket)
        boats_relay_authed.discard(websocket)
        subs = boats_relay_subscriptions.pop(websocket, None) or {}
        user_id = boats_ws_user_id.pop(websocket, None)
        total_symbols = sum(len(s or []) for s in subs.values())
        if total_symbols > 0 and user_id:
            await rate_limiter.decr_ws_subs(user_id, total_symbols)
        await send_queue_drain(websocket, boats_relay_send_queues, boats_relay_send_tasks)
        try:
            await send_alpaca_boats_subscription()
        except Exception:
            pass
    elif mode == "overnight":
        overnight_relay_clients.discard(websocket)
        overnight_relay_authed.discard(websocket)
        subs = overnight_relay_subscriptions.pop(websocket, None) or {}
        user_id = overnight_ws_user_id.pop(websocket, None)
        total_symbols = sum(len(s or []) for s in subs.values())
        if total_symbols > 0 and user_id:
            await rate_limiter.decr_ws_subs(user_id, total_symbols)
        await send_queue_drain(websocket, overnight_relay_send_queues, overnight_relay_send_tasks)
        try:
            await send_alpaca_overnight_subscription()
        except Exception:
            pass
    elif mode == "test":
        test_relay_clients.discard(websocket)
        test_relay_authed.discard(websocket)
        subs = test_relay_subscriptions.pop(websocket, None) or {}
        user_id = test_ws_user_id.pop(websocket, None)
        total_symbols = sum(len(s or []) for s in subs.values())
        if total_symbols > 0 and user_id:
            await rate_limiter.decr_ws_subs(user_id, total_symbols)
        await send_queue_drain(websocket, test_relay_send_queues, test_relay_send_tasks)
        try:
            await send_alpaca_test_subscription()
        except Exception:
            pass
    else:
        relay_clients.discard(websocket)
        relay_authed.discard(websocket)
        subs = relay_subscriptions.pop(websocket, None) or {}
        user_id = ws_user_id.pop(websocket, None)
        total_symbols = sum(len(s or []) for s in subs.values())
        if total_symbols > 0 and user_id:
            await rate_limiter.decr_ws_subs(user_id, total_symbols)
        await send_queue_drain(websocket, relay_send_queues, relay_send_tasks)
        try:
            await send_alpaca_subscription()
        except Exception:
            pass
async def client_sender(websocket, queue):
    while True:
        payload = await queue.get()
        if payload is None:
            break
        try:
            await asyncio.wait_for(websocket.send(payload), timeout=SEND_TIMEOUT_SECONDS)
        except Exception:
            break


def max_drops_before_close() -> int:
    raw = os.getenv("MAX_DROPS_BEFORE_CLOSE", "100")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = 100
    return max(1, value)


def _ensure_ws_stats(websocket):
    stats = ws_stats.get(websocket)
    if stats is None:
        stats = {
            "bytes_sent": 0,
            "msgs_sent": 0,
            "msgs_dropped": 0,
            "connected_at": time.time(),
        }
        ws_stats[websocket] = stats
    return stats


def _record_ws_drop(websocket):
    stats = _ensure_ws_stats(websocket)
    stats["msgs_dropped"] = stats.get("msgs_dropped", 0) + 1
    if stats.get("slow_closed"):
        return
    if stats["msgs_dropped"] >= max_drops_before_close():
        stats["slow_closed"] = True
        if ws_is_open(websocket):
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None
            if loop is not None:
                loop.create_task(websocket.close(code=1008, reason="slow_client"))


def enqueue_payload(websocket, payload, send_queues):
    queue = send_queues.get(websocket)
    if queue is None:
        return False
    try:
        queue.put_nowait(payload)
        return True
    except asyncio.QueueFull:
        _record_ws_drop(websocket)
        try:
            _ = queue.get_nowait()
            queue.put_nowait(payload)
            return True
        except Exception:
            return False




def _ws_peer_ip(websocket) -> str:
    addr = getattr(websocket, "remote_address", None)
    if isinstance(addr, (tuple, list)) and addr:
        return str(addr[0])
    if isinstance(addr, str):
        return addr
    return "unknown"


def _resolve_ws_path(websocket, path=None):
    """
    websockets >= 11 may call handlers as handler(connection) (no explicit path arg).
    Older versions call handler(websocket, path).

    Support both by falling back to attributes on the websocket/connection object.
    """
    candidate = path
    if not candidate:
        candidate = getattr(websocket, "path", None)
    if not candidate:
        request = getattr(websocket, "request", None)
        candidate = getattr(request, "path", None) if request is not None else None
        if not candidate and request is not None:
            candidate = getattr(request, "raw_path", None)
    if not candidate:
        return None
    try:
        candidate = str(candidate)
    except Exception:
        return None
    if "?" in candidate:
        candidate = candidate.split("?", 1)[0]
    if candidate.endswith("/") and candidate != "/":
        candidate = candidate.rstrip("/")
    return candidate


def resolve_ws_principal(token: str, websocket):
    if not token:
        return None
    registry = load_user_registry()
    if registry:
        principal = registry.get(token)
        if principal and _is_token_expired(principal):
            print(f"[Auth] WS token expired for user {principal.get('user_id')}", flush=True)
            return None
        return principal
    peer_ip = _ws_peer_ip(websocket)
    headers = getattr(websocket, "request_headers", {}) or {}
    client_ip, _forwarded = resolve_client_ip(peer_ip, dict(headers))
    if is_fallback_ip_allowed(client_ip) and token == get_proxy_token():
        return _fallback_principal()
    return None


def resolve_ws_user_id(token: str, websocket):
    principal = resolve_ws_principal(token, websocket)
    if principal:
        return principal.get("user_id")
    return None


def _filter_stock_subscriptions(trades, quotes):
    trades_list = list(trades or [])
    quotes_list = list(quotes or [])
    trades_set = set(trades_list)
    quotes_set = set(quotes_list)
    invalid, dot_symbols = _invalid_stock_symbols(trades_set | quotes_set)
    invalid_set = set(invalid) | set(dot_symbols)
    valid_trades = {s for s in trades_set if isinstance(s, str) and s and s not in invalid_set}
    valid_quotes = {s for s in quotes_set if isinstance(s, str) and s and s not in invalid_set}
    invalid_trades = [s for s in trades_list if s in invalid_set or not isinstance(s, str) or not s]
    invalid_quotes = [s for s in quotes_list if s in invalid_set or not isinstance(s, str) or not s]
    return valid_trades, valid_quotes, invalid_trades, invalid_quotes


def _filter_option_subscriptions(trades, quotes):
    trades_list = list(trades or [])
    quotes_list = list(quotes or [])
    trades_set = set(trades_list)
    quotes_set = set(quotes_list)
    invalid = set(_invalid_option_symbols(trades_set | quotes_set))
    valid_trades = {s for s in trades_set if isinstance(s, str) and s and s not in invalid}
    valid_quotes = {s for s in quotes_set if isinstance(s, str) and s and s not in invalid}
    invalid_trades = [s for s in trades_list if s in invalid or not isinstance(s, str) or not s]
    invalid_quotes = [s for s in quotes_list if s in invalid or not isinstance(s, str) or not s]
    return valid_trades, valid_quotes, invalid_trades, invalid_quotes


def _is_control_message(item) -> bool:
    return isinstance(item, dict) and item.get("T") in ("subscription", "success", "error")


def _channel_from_item(item):
    if not isinstance(item, dict):
        return None
    msg_type = item.get("T")
    if msg_type in ("t", "trades", "trade"):
        return "trades"
    if msg_type in ("q", "quotes", "quote"):
        return "quotes"
    if msg_type in ("o", "orderbook", "orderbooks"):
        return "orderbooks"
    return None


def _symbol_from_item(item):
    if not isinstance(item, dict):
        return None
    return item.get("S") or item.get("sym") or item.get("symbol")


def fanout_to_subscribers(data, authed_set, subscriptions, send_queues, is_options: bool):
    if data is None:
        return
    if isinstance(data, list):
        items = [item for item in data if isinstance(item, dict)]
    elif isinstance(data, dict):
        items = [data]
    else:
        return

    if not items:
        return

    items = [item for item in items if not _is_control_message(item)]
    if not items:
        return

    for ws in list(authed_set):
        if not ws_is_open(ws):
            continue
        subs = subscriptions.get(ws) or {}
        filtered = []
        for item in items:
            channel = _channel_from_item(item)
            if channel is None:
                continue
            symbol = _symbol_from_item(item)
            if not symbol:
                continue
            allowed = subs.get(channel) or set()
            if symbol in allowed:
                filtered.append(item)
        if not filtered:
            continue
        packed = msgpack.packb(filtered, use_bin_type=True)
        enqueue_payload(ws, packed, send_queues)


def fanout_to_crypto_subscribers(data, authed_set, subscriptions, send_queues):
    if data is None:
        return
    if isinstance(data, list):
        items = [item for item in data if isinstance(item, dict)]
    elif isinstance(data, dict):
        items = [data]
    else:
        return

    if not items:
        return

    items = [item for item in items if not _is_control_message(item)]
    if not items:
        return

    for ws in list(authed_set):
        if not ws_is_open(ws):
            continue
        subs = subscriptions.get(ws) or {}
        allowed_orderbooks = subs.get("orderbooks") or set()
        allowed_trades = subs.get("trades") or set()
        if not allowed_orderbooks and not allowed_trades:
            continue
        filtered = []
        for item in items:
            channel = _channel_from_item(item)
            symbol = _symbol_from_item(item)
            if not symbol:
                continue
            if channel == "orderbooks" and symbol in allowed_orderbooks:
                filtered.append(item)
            elif channel == "trades" and symbol in allowed_trades:
                filtered.append(item)
        if not filtered:
            continue
        enqueue_payload(ws, json.dumps(filtered), send_queues)


def fanout_to_news_subscribers(data, authed_set, subscriptions, send_queues):
    if data is None:
        return
    if isinstance(data, list):
        items = [item for item in data if isinstance(item, dict)]
    elif isinstance(data, dict):
        items = [data]
    else:
        return

    if not items:
        return

    items = [item for item in items if not _is_control_message(item)]
    if not items:
        return

    for ws in list(authed_set):
        if not ws_is_open(ws):
            continue
        subs = subscriptions.get(ws) or {}
        allowed_news = subs.get("news") or set()
        if not allowed_news:
            continue
        if "*" in allowed_news:
            filtered = items
        else:
            filtered = []
            for item in items:
                if item.get("T") != "n":
                    continue
                article_symbols = item.get("symbols") or []
                if not isinstance(article_symbols, list):
                    continue
                normalized_symbols = {
                    str(symbol).strip().upper()
                    for symbol in article_symbols
                    if isinstance(symbol, str) and symbol.strip()
                }
                if normalized_symbols & allowed_news:
                    filtered.append(item)
        if not filtered:
            continue
        payload = filtered if isinstance(data, list) else filtered[0]
        enqueue_payload(ws, json.dumps(payload), send_queues)


async def handle_relay_message(websocket, data, mode: str):
    remote_ip = _ws_peer_ip(websocket)
    global pending_subscription_update, pending_options_subscription_update, pending_test_subscription_update
    global pending_boats_subscription_update, pending_overnight_subscription_update, pending_crypto_subscription_update
    global pending_news_subscription_update

    # Backward-compatible: some tests pass a boolean here.
    if isinstance(mode, bool):
        mode = "options" if mode else "stock"

    is_options = mode == "options"
    is_test = mode == "test"
    is_crypto = mode == "crypto"
    is_news = mode == "news"
    is_boats = mode == "boats"
    is_overnight = mode == "overnight"
    send_queues = (
        options_relay_send_queues
        if is_options
        else (
            news_relay_send_queues
            if is_news
            else (
                crypto_relay_send_queues
                if is_crypto
                else (
                    boats_relay_send_queues
                    if is_boats
                    else (overnight_relay_send_queues if is_overnight else (test_relay_send_queues if is_test else relay_send_queues))
                )
            )
        )
    )
    action = data.get("action")
    if action == "auth":
        token = data.get("token", "")
        # Mask token for safe logging
        token_masked = token[:8] + "..." + token[-4:] if len(token) > 12 else (token[:8] + "..." if len(token) > 8 else token)
        principal = resolve_ws_principal(token, websocket)
        if not principal:
            print(f"[Cloud] AUTH FAILED: invalid token from {remote_ip} (token={token_masked}, mode={mode})", flush=True)
            resp = [{"T": "error", "msg": "invalid token"}]
            payload = json.dumps(resp) if (is_crypto or is_news) else msgpack.packb(resp, use_bin_type=True)
            enqueue_payload(websocket, payload, send_queues)
            await websocket.close(code=1008)
            return
        if not allow_ws_mode(principal, mode):
            user_id = principal.get("user_id", "unknown")
            print(f"[Cloud] AUTH FAILED: forbidden mode from {remote_ip} (user={user_id}, mode={mode}, token={token_masked})", flush=True)
            resp = [{"T": "error", "msg": "forbidden"}]
            payload = json.dumps(resp) if (is_crypto or is_news) else msgpack.packb(resp, use_bin_type=True)
            enqueue_payload(websocket, payload, send_queues)
            await websocket.close(code=1008)
            return
        user_id = principal.get("user_id")

        # Concurrency limit check
        ws_conns_limit = 5
        permissions = principal.get("permissions", {})
        if "max_ws_conns" in permissions:
            ws_conns_limit = int(permissions["max_ws_conns"])
        else:
            role = principal.get("role", "default")
            role_limits = {
                "basic": 1,
                "value": 2,
                "standard": 3,
                "premium": float("inf"),
                "test": 5,          # internal load-test role
                "default": 3,
                "legacy": 5,
                "fallback": 100,
                "admin": 100,
            }
            ws_conns_limit = role_limits.get(role, 3)

        current_ws_conns = count_active_ws_connections(user_id)
        if current_ws_conns >= ws_conns_limit:
            print(f"[Cloud] AUTH FAILED: connection limit exceeded for user={user_id} ({current_ws_conns}/{ws_conns_limit}, mode={mode})", flush=True)
            resp = [{"T": "error", "msg": f"Connection limit exceeded: {current_ws_conns}/{ws_conns_limit} active websockets"}]
            payload = json.dumps(resp) if (is_crypto or is_news) else msgpack.packb(resp, use_bin_type=True)
            enqueue_payload(websocket, payload, send_queues)
            log_ws_usage("auth_rejected", user_id, mode, {"reason": "conns_limit", "current": current_ws_conns, "limit": ws_conns_limit})
            await websocket.close(code=1008)
            return

        print(f"[Cloud] AUTH SUCCESS: user={user_id} from {remote_ip} (mode={mode}, token={token_masked})", flush=True)
        user_id = principal.get("user_id")

        try:
            if is_options:
                await connect_alpaca_options()
            elif is_crypto:
                await connect_alpaca_crypto()
            elif is_news:
                await connect_alpaca_news()
            elif is_boats:
                await connect_alpaca_boats()
            elif is_overnight:
                await connect_alpaca_overnight()
            elif is_test:
                await connect_alpaca_test()
            else:
                await connect_alpaca()
        except Exception as exc:
            resp = [{"T": "error", "msg": str(exc)}]
            payload = json.dumps(resp) if (is_crypto or is_news) else msgpack.packb(resp, use_bin_type=True)
            enqueue_payload(websocket, payload, send_queues)
            await websocket.close()
            return

        # Mask token for audit log (first 8 chars + ...)
        token_masked = token[:8] + "..." + token[-4:] if len(token) > 12 else token
        log_ws_usage("auth", user_id, mode, {"token_masked": token_masked})

        if is_options:
            options_relay_authed.add(websocket)
            options_ws_user_id[websocket] = user_id
        elif is_crypto:
            crypto_relay_authed.add(websocket)
            crypto_ws_user_id[websocket] = user_id
        elif is_news:
            news_relay_authed.add(websocket)
            news_ws_user_id[websocket] = user_id
        elif is_boats:
            boats_relay_authed.add(websocket)
            boats_ws_user_id[websocket] = user_id
        elif is_overnight:
            overnight_relay_authed.add(websocket)
            overnight_ws_user_id[websocket] = user_id
        elif is_test:
            test_relay_authed.add(websocket)
            test_ws_user_id[websocket] = user_id
        else:
            relay_authed.add(websocket)
            ws_user_id[websocket] = user_id

        if websocket not in ws_stats:
            ws_stats[websocket] = {
                "bytes_sent": 0,
                "msgs_sent": 0,
                "msgs_dropped": 0,
                "connected_at": time.time(),
            }

        resp = [{"T": "success", "msg": "authenticated"}]
        payload = json.dumps(resp) if (is_crypto or is_news) else msgpack.packb(resp, use_bin_type=True)
        enqueue_payload(websocket, payload, send_queues)
        if is_options and pending_options_subscription_update:
            await send_alpaca_options_subscription()
        if is_crypto and pending_crypto_subscription_update:
            await send_alpaca_crypto_subscription()
        if is_news and pending_news_subscription_update:
            await send_alpaca_news_subscription()
        if is_boats and pending_boats_subscription_update:
            await send_alpaca_boats_subscription()
        if is_overnight and pending_overnight_subscription_update:
            await send_alpaca_overnight_subscription()
        if is_test and pending_test_subscription_update:
            await send_alpaca_test_subscription()
        if not is_options and not is_test and not is_crypto and not is_news and pending_subscription_update:
            await send_alpaca_subscription()
        return

    if action == "subscribe":
        if is_options and websocket not in options_relay_authed:
            print(f"[Cloud] Ignoring options subscribe: not authed yet", flush=True)
            return
        if is_crypto and websocket not in crypto_relay_authed:
            print(f"[Cloud] Ignoring crypto subscribe: not authed yet", flush=True)
            return
        if is_news and websocket not in news_relay_authed:
            print(f"[Cloud] Ignoring news subscribe: not authed yet", flush=True)
            return
        if is_boats and websocket not in boats_relay_authed:
            print(f"[Cloud] Ignoring boats subscribe: not authed yet", flush=True)
            return
        if is_overnight and websocket not in overnight_relay_authed:
            print(f"[Cloud] Ignoring overnight subscribe: not authed yet", flush=True)
            return
        if is_test and websocket not in test_relay_authed:
            print(f"[Cloud] Ignoring test subscribe: not authed yet", flush=True)
            return
        if not is_options and not is_test and not is_crypto and not is_news and not is_boats and not is_overnight and websocket not in relay_authed:
            print(f"[Cloud] Ignoring subscribe: not authed yet", flush=True)
            return
        trades = data.get("trades", [])
        quotes = data.get("quotes", [])
        news = data.get("news", [])

        # Get user_id for audit log before rate limit check
        sub_user_id = None
        if is_options:
            sub_user_id = options_ws_user_id.get(websocket)
        elif is_crypto:
            sub_user_id = crypto_ws_user_id.get(websocket)
        elif is_news:
            sub_user_id = news_ws_user_id.get(websocket)
        elif is_boats:
            sub_user_id = boats_ws_user_id.get(websocket)
        elif is_overnight:
            sub_user_id = overnight_ws_user_id.get(websocket)
        elif is_test:
            sub_user_id = test_ws_user_id.get(websocket)
        else:
            sub_user_id = ws_user_id.get(websocket)

        # Get old active symbols count
        if is_options:
            old_subs = options_relay_subscriptions.get(websocket, {})
        elif is_crypto:
            old_subs = crypto_relay_subscriptions.get(websocket, {})
        elif is_news:
            old_subs = news_relay_subscriptions.get(websocket, {})
        elif is_boats:
            old_subs = boats_relay_subscriptions.get(websocket, {})
        elif is_overnight:
            old_subs = overnight_relay_subscriptions.get(websocket, {})
        elif is_test:
            old_subs = test_relay_subscriptions.get(websocket, {})
        else:
            old_subs = relay_subscriptions.get(websocket, {})
        
        old_active_count = sum(len(s or []) for s in old_subs.values())

        # Get new active symbols count (using the target mode's filtering strategy)
        if is_options:
            valid_trades, valid_quotes, _, _ = _filter_option_subscriptions(trades, quotes)
            new_active_count = len(valid_trades) + len(valid_quotes)
        elif is_crypto:
            valid_orderbooks = set()
            for sym in list(data.get("orderbooks", []) or []):
                norm = _normalize_crypto_symbol(sym)
                if norm is not None:
                    valid_orderbooks.add(norm)
            valid_trades = set()
            for sym in list(data.get("trades", []) or []):
                norm = _normalize_crypto_symbol(sym)
                if norm is not None:
                    valid_trades.add(norm)
            new_active_count = len(valid_orderbooks) + len(valid_trades)
        elif is_news:
            valid_news, _ = _filter_news_subscriptions(news)
            new_active_count = len(valid_news)
        else:
            valid_trades, valid_quotes, _, _ = _filter_stock_subscriptions(trades, quotes)
            new_active_count = len(valid_trades) + len(valid_quotes)

        delta = new_active_count - old_active_count

        # Rate limit: check symbol subscription limit based on delta
        if delta != 0:
            role = "default"
            for p in token_to_principal.values():
                if p.get("user_id") == sub_user_id:
                    role = p.get("role", "default")
                    break
            sub_allowed, sub_current, sub_limit = await rate_limiter.check_ws_subs(sub_user_id, delta, role)
            if not sub_allowed:
                resp = [{"T": "error", "msg": f"Subscription limit exceeded: {sub_current}/{sub_limit} symbols"}]
                payload = json.dumps(resp) if (is_crypto or is_news) else msgpack.packb(resp, use_bin_type=True)
                enqueue_payload(websocket, payload, send_queues)
                log_ws_usage("subscribe_rejected", sub_user_id, mode, {"reason": "symbol_limit", "requested": new_active_count, "current": sub_current, "limit": sub_limit})
                return

        log_ws_usage("subscribe", sub_user_id, mode, {
            "trades": trades,
            "quotes": quotes,
            "news": news,
        })
        if is_options:
            if "*" in quotes:
                resp = [{"T": "error", "msg": "option quotes do not allow * subscription"}]
                enqueue_payload(websocket, msgpack.packb(resp, use_bin_type=True), options_relay_send_queues)
                return
            valid_trades, valid_quotes, invalid_trades, invalid_quotes = _filter_option_subscriptions(trades, quotes)
            options_relay_subscriptions[websocket] = {"trades": valid_trades, "quotes": valid_quotes}
            if valid_trades or valid_quotes:
                await send_alpaca_options_subscription()
            resp = [{
                "T": "subscription",
                "trades": list(valid_trades),
                "quotes": list(valid_quotes),
                "invalid_trades": invalid_trades,
                "invalid_quotes": invalid_quotes,
            }]
            enqueue_payload(websocket, msgpack.packb(resp, use_bin_type=True), options_relay_send_queues)
        elif is_crypto:
            valid_orderbooks = set()
            invalid_orderbooks = []
            for sym in list(data.get("orderbooks", []) or []):
                norm = _normalize_crypto_symbol(sym)
                if norm is None:
                    invalid_orderbooks.append(sym)
                else:
                    valid_orderbooks.add(norm)

            valid_trades = set()
            invalid_trades = []
            for sym in list(data.get("trades", []) or []):
                norm = _normalize_crypto_symbol(sym)
                if norm is None:
                    invalid_trades.append(sym)
                else:
                    valid_trades.add(norm)

            crypto_relay_subscriptions[websocket] = {
                "orderbooks": valid_orderbooks,
                "trades": valid_trades,
            }
            if valid_orderbooks or valid_trades:
                await send_alpaca_crypto_subscription()
            resp = [{
                "T": "subscription",
                "orderbooks": sorted(list(valid_orderbooks)),
                "trades": sorted(list(valid_trades)),
                "invalid_orderbooks": invalid_orderbooks,
                "invalid_trades": invalid_trades,
            }]
            enqueue_payload(websocket, json.dumps(resp), crypto_relay_send_queues)
        elif is_news:
            valid_news, invalid_news = _filter_news_subscriptions(news)
            news_relay_subscriptions[websocket] = {"news": valid_news}
            if valid_news:
                await send_alpaca_news_subscription()
            resp = [{
                "T": "subscription",
                "news": sorted(list(valid_news)),
                "invalid_news": invalid_news,
            }]
            enqueue_payload(websocket, json.dumps(resp), news_relay_send_queues)
        elif is_boats:
            valid_trades, valid_quotes, invalid_trades, invalid_quotes = _filter_stock_subscriptions(trades, quotes)
            boats_relay_subscriptions[websocket] = {"trades": valid_trades, "quotes": valid_quotes}
            if valid_trades or valid_quotes:
                await send_alpaca_boats_subscription()
            resp = [{
                "T": "subscription",
                "trades": list(valid_trades),
                "quotes": list(valid_quotes),
                "invalid_trades": invalid_trades,
                "invalid_quotes": invalid_quotes,
            }]
            enqueue_payload(websocket, msgpack.packb(resp, use_bin_type=True), boats_relay_send_queues)
        elif is_overnight:
            valid_trades, valid_quotes, invalid_trades, invalid_quotes = _filter_stock_subscriptions(trades, quotes)
            overnight_relay_subscriptions[websocket] = {"trades": valid_trades, "quotes": valid_quotes}
            if valid_trades or valid_quotes:
                await send_alpaca_overnight_subscription()
            resp = [{
                "T": "subscription",
                "trades": list(valid_trades),
                "quotes": list(valid_quotes),
                "invalid_trades": invalid_trades,
                "invalid_quotes": invalid_quotes,
            }]
            enqueue_payload(websocket, msgpack.packb(resp, use_bin_type=True), overnight_relay_send_queues)
        elif is_test:
            valid_trades, valid_quotes, invalid_trades, invalid_quotes = _filter_stock_subscriptions(trades, quotes)
            test_relay_subscriptions[websocket] = {"trades": valid_trades, "quotes": valid_quotes}
            if valid_trades or valid_quotes:
                await send_alpaca_test_subscription()
            resp = [{
                "T": "subscription",
                "trades": list(valid_trades),
                "quotes": list(valid_quotes),
                "invalid_trades": invalid_trades,
                "invalid_quotes": invalid_quotes,
            }]
            enqueue_payload(websocket, msgpack.packb(resp, use_bin_type=True), test_relay_send_queues)
        else:
            valid_trades, valid_quotes, invalid_trades, invalid_quotes = _filter_stock_subscriptions(trades, quotes)
            relay_subscriptions[websocket] = {"trades": valid_trades, "quotes": valid_quotes}
            if valid_trades or valid_quotes:
                await send_alpaca_subscription()
            resp = [{
                "T": "subscription",
                "trades": list(valid_trades),
                "quotes": list(valid_quotes),
                "invalid_trades": invalid_trades,
                "invalid_quotes": invalid_quotes,
            }]
            enqueue_payload(websocket, msgpack.packb(resp, use_bin_type=True), relay_send_queues)


async def handle_relay(websocket, path=None):
    _relay_log_counter = 0
    _relay_log_interval = 100
    # Global system overload protection
    if is_system_overloaded():
        await websocket.close(code=1013, reason="System overloaded")
        return

    path = _resolve_ws_path(websocket, path)
    mode = "stock"
    if path == "/stream/options":
        mode = "options"
    elif path == "/stream/test":
        mode = "test"
    elif path == "/stream/crypto":
        mode = "crypto"
    elif path == "/stream/news":
        mode = "news"
    elif path == "/stream/boats":
        mode = "boats"
    elif path == "/stream/overnight":
        mode = "overnight"
    if path and path not in ("/stream", "/stream/options", "/stream/test", "/stream/crypto", "/stream/news", "/stream/boats", "/stream/overnight"):
        await websocket.close()
        return

    if mode == "options":
        options_relay_clients.add(websocket)
        options_relay_subscriptions[websocket] = {"trades": set(), "quotes": set()}
        options_relay_send_queues[websocket] = asyncio.Queue(maxsize=SEND_QUEUE_MAX)
        options_relay_send_tasks[websocket] = asyncio.create_task(client_sender(websocket, options_relay_send_queues[websocket]))
        _relay_log_counter += 1
        if _relay_log_counter % _relay_log_interval == 1:
            print(f"[Cloud] Options relay connected. Total relays: {len(options_relay_clients)}")
    elif mode == "crypto":
        crypto_relay_clients.add(websocket)
        crypto_relay_subscriptions[websocket] = {"orderbooks": set(), "trades": set()}
        crypto_relay_send_queues[websocket] = asyncio.Queue(maxsize=SEND_QUEUE_MAX)
        crypto_relay_send_tasks[websocket] = asyncio.create_task(client_sender(websocket, crypto_relay_send_queues[websocket]))
        _relay_log_counter += 1
        if _relay_log_counter % _relay_log_interval == 1:
            print(f"[Cloud] Crypto relay connected. Total relays: {len(crypto_relay_clients)}")
    elif mode == "news":
        news_relay_clients.add(websocket)
        news_relay_subscriptions[websocket] = {"news": set()}
        news_relay_send_queues[websocket] = asyncio.Queue(maxsize=SEND_QUEUE_MAX)
        news_relay_send_tasks[websocket] = asyncio.create_task(client_sender(websocket, news_relay_send_queues[websocket]))
        _relay_log_counter += 1
        if _relay_log_counter % _relay_log_interval == 1:
            print(f"[Cloud] News relay connected. Total relays: {len(news_relay_clients)}")
    elif mode == "boats":
        boats_relay_clients.add(websocket)
        boats_relay_subscriptions[websocket] = {"trades": set(), "quotes": set()}
        boats_relay_send_queues[websocket] = asyncio.Queue(maxsize=SEND_QUEUE_MAX)
        boats_relay_send_tasks[websocket] = asyncio.create_task(client_sender(websocket, boats_relay_send_queues[websocket]))
        _relay_log_counter += 1
        if _relay_log_counter % _relay_log_interval == 1:
            print(f"[Cloud] BOATS relay connected. Total relays: {len(boats_relay_clients)}")
    elif mode == "overnight":
        overnight_relay_clients.add(websocket)
        overnight_relay_subscriptions[websocket] = {"trades": set(), "quotes": set()}
        overnight_relay_send_queues[websocket] = asyncio.Queue(maxsize=SEND_QUEUE_MAX)
        overnight_relay_send_tasks[websocket] = asyncio.create_task(client_sender(websocket, overnight_relay_send_queues[websocket]))
        _relay_log_counter += 1
        if _relay_log_counter % _relay_log_interval == 1:
            print(f"[Cloud] OVERNIGHT relay connected. Total relays: {len(overnight_relay_clients)}")
    elif mode == "test":
        test_relay_clients.add(websocket)
        test_relay_subscriptions[websocket] = {"trades": set(), "quotes": set()}
        test_relay_send_queues[websocket] = asyncio.Queue(maxsize=SEND_QUEUE_MAX)
        test_relay_send_tasks[websocket] = asyncio.create_task(client_sender(websocket, test_relay_send_queues[websocket]))
        _relay_log_counter += 1
        if _relay_log_counter % _relay_log_interval == 1:
            print(f"[Cloud] TEST relay connected. Total relays: {len(test_relay_clients)}")
    else:
        relay_clients.add(websocket)
        relay_subscriptions[websocket] = {"trades": set(), "quotes": set()}
        relay_send_queues[websocket] = asyncio.Queue(maxsize=SEND_QUEUE_MAX)
        relay_send_tasks[websocket] = asyncio.create_task(client_sender(websocket, relay_send_queues[websocket]))
        print(f"[Cloud] Relay connected. Total relays: {len(relay_clients)}")
    try:
        async for message in websocket:
            try:
                data = unpack_message(message)
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict):
                            await handle_relay_message(websocket, item, mode)
                elif isinstance(data, dict):
                    await handle_relay_message(websocket, data, mode)
            except Exception as exc:
                print(f"[Cloud] Relay message error: {exc}")
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        await cleanup_ws(websocket, mode, reason="disconnect")
        if mode == "options":
            _relay_log_counter += 1
            if _relay_log_counter % _relay_log_interval == 1:
                print(f"[Cloud] Options relay disconnected. Total relays: {len(options_relay_clients)}")
        elif mode == "crypto":
            _relay_log_counter += 1
            if _relay_log_counter % _relay_log_interval == 1:
                print(f"[Cloud] Crypto relay disconnected. Total relays: {len(crypto_relay_clients)}")
        elif mode == "boats":
            _relay_log_counter += 1
            if _relay_log_counter % _relay_log_interval == 1:
                print(f"[Cloud] BOATS relay disconnected. Total relays: {len(boats_relay_clients)}")
        elif mode == "overnight":
            _relay_log_counter += 1
            if _relay_log_counter % _relay_log_interval == 1:
                print(f"[Cloud] OVERNIGHT relay disconnected. Total relays: {len(overnight_relay_clients)}")
        elif mode == "test":
            _relay_log_counter += 1
            if _relay_log_counter % _relay_log_interval == 1:
                print(f"[Cloud] TEST relay disconnected. Total relays: {len(test_relay_clients)}")
        else:
            print(f"[Cloud] Relay disconnected. Total relays: {len(relay_clients)}")


async def forward_alpaca_messages():
    global alpaca_ws
    global alpaca_msg_count, alpaca_last_log, alpaca_last_msg_time
    while True:
        if alpaca_ws is None:
            await asyncio.sleep(1)
            continue
        try:
            message = await alpaca_ws.recv()
            alpaca_msg_count += 1
            alpaca_last_msg_time = time.time()
            data = unpack_message(message)
            data, removed = filter_subscription_messages(data)
            if removed:
                # region agent log
                debug_log(
                    "filtered_subscription",
                    {"removed_count": removed, "relays": len(relay_authed)},
                    "H6",
                )
                # endregion agent log
            if data is None:
                continue
            
            # Log periodic stats to confirm data flow
            if alpaca_msg_count % 100 == 1:
                sample = data[0] if isinstance(data, list) and data else data
                print(f"[Cloud] Forwarding data from Alpaca, type: {sample.get('T') if isinstance(sample, dict) else 'raw'}", flush=True)
                # region agent log
                debug_log(
                    "alpaca_data_sample",
                    {
                        "type": sample.get("T") if isinstance(sample, dict) else "raw",
                        "relays": len(relay_authed),
                        "msg_count": alpaca_msg_count,
                    },
                    "H10",
                )
                # endregion agent log

            # #region agent log
            if alpaca_msg_count % 500 == 1:
                queue_sizes = []
                for ws in list(relay_send_queues.keys())[:3]:
                    queue_sizes.append(relay_send_queues[ws].qsize())
                agent_log(
                    "H4",
                    "alpaca_cloud_proxy.py:forward_alpaca_messages",
                    "relay_queue_snapshot",
                    {"relays": len(relay_authed), "queue_sizes": queue_sizes},
                )
            # #endregion agent log

            # Log control messages (success, subscription, error)
            if isinstance(data, list):
                for item in data:
                    if item.get("T") in ("subscription", "success", "error"):
                        print(f"[Cloud] Alpaca control msg: {item}", flush=True)
            elif isinstance(data, dict):
                if data.get("T") in ("subscription", "success", "error"):
                    print(f"[Cloud] Alpaca control msg: {data}", flush=True)
            fanout_to_subscribers(data, relay_authed, relay_subscriptions, relay_send_queues, is_options=False)

            # --- TimescaleDB: 实时写入最新报价 (fire-and-forget) ---
            if DB_MANAGER_AVAILABLE and upsert_latest_quote is not None:
                try:
                    msgs = data if isinstance(data, list) else [data] if isinstance(data, dict) else []
                    for msg in msgs:
                        if not isinstance(msg, dict):
                            continue
                        msg_type = msg.get("T")
                        sym = msg.get("S", "")
                        if msg_type == "q" and sym:  # quote message
                            asyncio.create_task(
                                upsert_latest_quote(
                                    symbol=sym,
                                    bid_price=msg.get("bp"),
                                    bid_size=msg.get("bs"),
                                    ask_price=msg.get("ap"),
                                    ask_size=msg.get("as"),
                                    timestamp=msg.get("t"),
                                    source="alpaca_ws",
                                )
                            )
                        elif msg_type == "t" and sym:  # trade message
                            asyncio.create_task(
                                upsert_latest_quote(
                                    symbol=sym,
                                    last_price=msg.get("p"),
                                    last_size=msg.get("s"),
                                    timestamp=msg.get("t"),
                                    source="alpaca_ws",
                                )
                            )
                except Exception as e:
                    # WS 数据写入失败不能影响主流程
                    pass

            now = time.time()
            if now - alpaca_last_log >= 10:
                alpaca_last_log = now
                age = now - alpaca_last_msg_time if alpaca_last_msg_time else -1
                print(
                    f"[Cloud] Alpaca feed active: msgs={alpaca_msg_count} relays={len(relay_authed)} "
                    f"last_age={age:.1f}s"
                )
        except websockets.exceptions.ConnectionClosed:
            print("[Cloud] Alpaca connection closed, reconnecting...")
            alpaca_ws = None
            await asyncio.sleep(5)
        except Exception as exc:
            print(f"[Cloud] Error forwarding Alpaca messages: {exc}")
            await asyncio.sleep(1)


async def forward_alpaca_test_messages():
    global alpaca_test_ws
    global alpaca_test_msg_count, alpaca_test_last_log, alpaca_test_last_msg_time
    while True:
        if alpaca_test_ws is None:
            await asyncio.sleep(1)
            continue
        try:
            message = await alpaca_test_ws.recv()
            alpaca_test_msg_count += 1
            alpaca_test_last_msg_time = time.time()
            data = unpack_message(message)
            data, _removed = filter_subscription_messages(data)
            if data is None:
                continue
            fanout_to_subscribers(data, test_relay_authed, test_relay_subscriptions, test_relay_send_queues, is_options=False)
            now = time.time()
            if now - alpaca_test_last_log >= 10:
                alpaca_test_last_log = now
                age = now - alpaca_test_last_msg_time if alpaca_test_last_msg_time else -1
                print(
                    f"[Cloud] Alpaca TEST feed active: msgs={alpaca_test_msg_count} "
                    f"relays={len(test_relay_authed)} last_age={age:.1f}s"
                )
        except websockets.exceptions.ConnectionClosed:
            print("[Cloud] Alpaca TEST connection closed, reconnecting...")
            alpaca_test_ws = None
            await asyncio.sleep(5)
        except Exception as exc:
            print(f"[Cloud] Error forwarding Alpaca TEST messages: {exc}")
            await asyncio.sleep(1)


async def forward_alpaca_boats_messages():
    global alpaca_boats_ws
    global alpaca_boats_msg_count, alpaca_boats_last_log, alpaca_boats_last_msg_time
    while True:
        if alpaca_boats_ws is None:
            await asyncio.sleep(1)
            continue
        try:
            message = await alpaca_boats_ws.recv()
            alpaca_boats_msg_count += 1
            alpaca_boats_last_msg_time = time.time()
            data = unpack_message(message)
            data, _removed = filter_subscription_messages(data)
            if data is None:
                continue
            fanout_to_subscribers(data, boats_relay_authed, boats_relay_subscriptions, boats_relay_send_queues, is_options=False)
            now = time.time()
            if now - alpaca_boats_last_log >= 10:
                alpaca_boats_last_log = now
                age = now - alpaca_boats_last_msg_time if alpaca_boats_last_msg_time else -1
                print(
                    f"[Cloud] Alpaca BOATS feed active: msgs={alpaca_boats_msg_count} "
                    f"relays={len(boats_relay_authed)} last_age={age:.1f}s"
                )
        except websockets.exceptions.ConnectionClosed:
            print("[Cloud] Alpaca BOATS connection closed, reconnecting...")
            alpaca_boats_ws = None
            await asyncio.sleep(5)
        except Exception as exc:
            print(f"[Cloud] Error forwarding Alpaca BOATS messages: {exc}")
            await asyncio.sleep(1)


async def forward_alpaca_overnight_messages():
    global alpaca_overnight_ws
    global alpaca_overnight_msg_count, alpaca_overnight_last_log, alpaca_overnight_last_msg_time
    while True:
        if alpaca_overnight_ws is None:
            await asyncio.sleep(1)
            continue
        try:
            message = await alpaca_overnight_ws.recv()
            alpaca_overnight_msg_count += 1
            alpaca_overnight_last_msg_time = time.time()
            data = unpack_message(message)
            data, _removed = filter_subscription_messages(data)
            if data is None:
                continue
            fanout_to_subscribers(data, overnight_relay_authed, overnight_relay_subscriptions, overnight_relay_send_queues, is_options=False)
            now = time.time()
            if now - alpaca_overnight_last_log >= 10:
                alpaca_overnight_last_log = now
                age = now - alpaca_overnight_last_msg_time if alpaca_overnight_last_msg_time else -1
                print(
                    f"[Cloud] Alpaca OVERNIGHT feed active: msgs={alpaca_overnight_msg_count} "
                    f"relays={len(overnight_relay_authed)} last_age={age:.1f}s"
                )
        except websockets.exceptions.ConnectionClosed:
            print("[Cloud] Alpaca OVERNIGHT connection closed, reconnecting...")
            alpaca_overnight_ws = None
            await asyncio.sleep(5)
        except Exception as exc:
            print(f"[Cloud] Error forwarding Alpaca OVERNIGHT messages: {exc}")
            await asyncio.sleep(1)


async def forward_alpaca_options_messages():
    global alpaca_options_ws
    global alpaca_options_msg_count, alpaca_options_last_log, alpaca_options_last_msg_time
    while True:
        if alpaca_options_ws is None:
            await asyncio.sleep(1)
            continue
        try:
            message = await alpaca_options_ws.recv()
            alpaca_options_msg_count += 1
            alpaca_options_last_msg_time = time.time()
            data = unpack_message(message)
            data, removed = filter_subscription_messages(data)
            if removed:
                # region agent log
                debug_log(
                    "filtered_options_subscription",
                    {"removed_count": removed, "relays": len(options_relay_authed)},
                    "H6",
                )
                # endregion agent log
            if data is None:
                continue
            fanout_to_subscribers(data, options_relay_authed, options_relay_subscriptions, options_relay_send_queues, is_options=True)

            # --- TimescaleDB: 实时写入期权最新报价 (fire-and-forget) ---
            if DB_MANAGER_AVAILABLE and upsert_latest_options_quote is not None:
                try:
                    msgs = data if isinstance(data, list) else [data] if isinstance(data, dict) else []
                    for msg in msgs:
                        if not isinstance(msg, dict):
                            continue
                        msg_type = msg.get("T")
                        occ_sym = msg.get("S", "")
                        if msg_type in ("q", "t") and occ_sym:
                            # 从 OCC symbol 提取 root symbol
                            parsed = _parse_occ_symbol_theta(occ_sym)
                            root = parsed[0] if parsed else occ_sym
                            asyncio.create_task(
                                upsert_latest_options_quote(
                                    symbol=occ_sym,
                                    root_symbol=root,
                                    bid_price=msg.get("bp") if msg_type == "q" else None,
                                    bid_size=msg.get("bs") if msg_type == "q" else None,
                                    ask_price=msg.get("ap") if msg_type == "q" else None,
                                    ask_size=msg.get("as") if msg_type == "q" else None,
                                    last_price=msg.get("p") if msg_type == "t" else None,
                                    timestamp=msg.get("t"),
                                    source="alpaca_ws",
                                )
                            )
                except Exception:
                    pass

            now = time.time()
            if now - alpaca_options_last_log >= 10:
                alpaca_options_last_log = now
                age = now - alpaca_options_last_msg_time if alpaca_options_last_msg_time else -1
                print(
                    f"[Cloud] Alpaca options feed active: msgs={alpaca_options_msg_count} "
                    f"relays={len(options_relay_authed)} last_age={age:.1f}s"
                )
        except websockets.exceptions.ConnectionClosed:
            print("[Cloud] Alpaca options connection closed, reconnecting...")
            alpaca_options_ws = None
            await asyncio.sleep(5)
        except Exception as exc:
            print(f"[Cloud] Error forwarding Alpaca options messages: {exc}")
            await asyncio.sleep(1)


async def forward_alpaca_crypto_messages():
    global alpaca_crypto_ws
    global alpaca_crypto_msg_count, alpaca_crypto_last_log, alpaca_crypto_last_msg_time
    while True:
        if alpaca_crypto_ws is None:
            await asyncio.sleep(1)
            continue
        try:
            message = await alpaca_crypto_ws.recv()
            alpaca_crypto_msg_count += 1
            alpaca_crypto_last_msg_time = time.time()
            data = unpack_message(message)
            data, _removed = filter_subscription_messages(data)
            if data is None:
                continue

            fanout_to_crypto_subscribers(data, crypto_relay_authed, crypto_relay_subscriptions, crypto_relay_send_queues)
            now = time.time()
            if now - alpaca_crypto_last_log >= 10:
                alpaca_crypto_last_log = now
                age = now - alpaca_crypto_last_msg_time if alpaca_crypto_last_msg_time else -1
                print(
                    f"[Cloud] Alpaca crypto feed active: msgs={alpaca_crypto_msg_count} "
                    f"relays={len(crypto_relay_authed)} last_age={age:.1f}s"
                )
        except websockets.exceptions.ConnectionClosed:
            print("[Cloud] Alpaca crypto connection closed, reconnecting...")
            alpaca_crypto_ws = None
            await asyncio.sleep(5)
        except Exception as exc:
            print(f"[Cloud] Error forwarding Alpaca crypto messages: {exc}")
            await asyncio.sleep(1)


async def forward_alpaca_news_messages():
    global alpaca_news_ws
    global alpaca_news_msg_count, alpaca_news_last_log, alpaca_news_last_msg_time
    while True:
        if alpaca_news_ws is None:
            await asyncio.sleep(1)
            continue
        try:
            message = await alpaca_news_ws.recv()
            alpaca_news_msg_count += 1
            alpaca_news_last_msg_time = time.time()
            data = unpack_message(message)
            data, _removed = filter_subscription_messages(data)
            if data is None:
                continue
            fanout_to_news_subscribers(data, news_relay_authed, news_relay_subscriptions, news_relay_send_queues)
            now = time.time()
            if now - alpaca_news_last_log >= 10:
                alpaca_news_last_log = now
                age = now - alpaca_news_last_msg_time if alpaca_news_last_msg_time else -1
                print(
                    f"[Cloud] Alpaca news feed active: msgs={alpaca_news_msg_count} "
                    f"relays={len(news_relay_authed)} last_age={age:.1f}s"
                )
        except websockets.exceptions.ConnectionClosed:
            print("[Cloud] Alpaca news connection closed, reconnecting...")
            alpaca_news_ws = None
            await asyncio.sleep(5)
        except Exception as exc:
            print(f"[Cloud] Error forwarding Alpaca news messages: {exc}")
            await asyncio.sleep(1)


async def handle_history_request(request):
    start_time = time.time()
    # Support both POST (JSON body) and GET (query params).
    # GET enables Cloudflare edge caching (CF doesn't cache POST by default).
    if request.method == "GET":
        data = dict(request.rel_url.query)
    else:
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON"}, status=400)

    token = data.get("token", "")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:]

    principal = resolve_http_principal(token, request)
    user_id = principal.get("user_id") if principal else None
    endpoint = "/v1/history/bars"

    # --- CDN cache headers (Vector C: Edge caching) ---
    # Historical bar data is immutable — cache aggressively at the CDN edge.
    # Intraday data (timeframe ≤ 1min AND today in range) changes frequently.
    def _is_today_ds(ds: str) -> bool:
        if not ds:
            return False
        try:
            return ds.split("T")[0] == date.today().isoformat()
        except Exception:
            return False

    end_date = data.get("end") or data.get("end_date") or ""
    start_date = data.get("start") or data.get("start_date") or ""
    _tf = (data.get("timeframe") or "1Min").lower()
    _is_daily = _tf in ("1day", "1d", "day", "daily", "1week", "1w", "week", "1month", "1mo", "month")
    _end_is_today = _is_today_ds(end_date)
    _start_is_past = bool(start_date) and not _is_today_ds(start_date)
    # Historical if: daily/weekly/monthly bars, OR start is in the past
    # (even if end is today — historical portion is immutable).
    _is_historical = _is_daily or (_start_is_past and not _end_is_today)
    _cdn_max_age = 604800 if _is_historical else 60  # 7 days vs 60s
    _cdn_cache_headers = {
        "Cache-Control": f"public, max-age={_cdn_max_age}, stale-while-revalidate=3600",
        "CDN-Cache-Control": f"public, max-age={_cdn_max_age}",
        "Vary": "Accept-Encoding",
    }

    def _log_and_return(payload, status, cache_status="MISS"):
        log_http_usage(endpoint, user_id, status, start_time, {"symbol": data.get("symbol"), "timeframe": data.get("timeframe")})
        # web.json_response uses stdlib json.dumps which dominates CPU under
        # load; pre-serialize with orjson and return raw text instead.
        resp_headers = {"X-Cache": cache_status}
        if status == 200:
            resp_headers.update(_cdn_cache_headers)
        return web.Response(
            body=_fast_dumps_str(payload),
            status=status,
            content_type="application/json",
            headers=resp_headers,
        )

    def _return_cached_raw(cached, cache_status):
        # Cache stores already-serialized JSON; skip the parse+re-encode
        # round-trip on the HIT hot path.
        log_http_usage(endpoint, user_id, 200, start_time, {"symbol": data.get("symbol"), "timeframe": data.get("timeframe")})
        if isinstance(cached, bytes):
            body = cached
        else:
            body = cached.encode() if isinstance(cached, str) else _fast_dumps_str(cached).encode()
        resp_headers = {"X-Cache": cache_status}
        resp_headers.update(_cdn_cache_headers)
        return web.Response(
            body=body,
            status=200,
            content_type="application/json",
            headers=resp_headers,
        )

    # region agent log
    agent_log(
        "P1",
        "alpaca_cloud_proxy.py:handle_history_request",
        "history_request_received",
        {
            "has_token_in_body": bool(data.get("token")),
            "has_auth_header": bool(request.headers.get("Authorization")),
            "symbol": data.get("symbol"),
            "timeframe": data.get("timeframe"),
            "start": data.get("start"),
            "end": data.get("end"),
            "limit": data.get("limit"),
            "max_pages": data.get("max_pages"),
            "feed": data.get("feed"),
        },
    )
    # endregion agent log

    if not principal:
        # region agent log
        agent_log(
            "P2",
            "alpaca_cloud_proxy.py:handle_history_request",
            "token_validation_failed",
            {
                "token_required": token_required(),
                "token_present": bool(token),
            },
        )
        # endregion agent log
        return _log_and_return({"error": "Invalid token"}, 401)
    if not allow_rest_endpoint(principal, endpoint):
        return _log_and_return({"error": "Forbidden"}, 403)

    role = principal.get("role", "default") if principal else "default"
    allowed, req_count, req_limit = await rate_limiter.check_rest(user_id, role)
    if not allowed:
        log_http_usage(endpoint, user_id, 429, start_time, {"reason": "rate_limit", "count": req_count, "limit": req_limit})
        return web.Response(status=429, text=f'Rate limit exceeded: {req_count}/{req_limit} req/min')

    symbol = data.get("symbol")
    start = data.get("start")
    end = data.get("end")
    timeframe = data.get("timeframe", "1Min")
    user_explicit_feed = data.get("feed")  # None if user didn't specify; picker uses this
    feed = user_explicit_feed or ("sip" if IS_PRO else "iex")
    limit = data.get("limit", 10000)
    max_pages = data.get("max_pages", 100)
    # Warmer reconciliation: when force_refresh=true, skip cache lookup and
    # force the request through paid/SIP. The fresh response overwrites any
    # IEX-served entry from intraday traffic. Used by smart_warmer_v2.
    force_refresh = bool(data.get("force_refresh"))
    if force_refresh:
        user_explicit_feed = "sip"
        feed = "sip"

    if not all([symbol, start, end]):
        return _log_and_return({"error": "Missing required fields"}, 400)

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 10000
    limit = max(1, min(limit, 10000))

    try:
        max_pages = int(max_pages)
    except (TypeError, ValueError):
        max_pages = 100
    max_pages = max(1, max_pages)

    # In-memory cache key intentionally drops `feed` for historical bars —
    # SIP and IEX converge on closed-market data, so we share the namespace
    # to avoid duplicate entries. Live/recent data is routed to paid by the
    # picker's end_recent rule, so cache writes still come from SIP for that.
    cache_key = f"bars:{symbol}:{start}:{end}:{timeframe}:{limit}:{max_pages}"
    redis_conn = await get_redis_client()
    if redis_conn is not None and not force_refresh:
        cached = await redis_conn.get(cache_key)
        if cached:
            return _return_cached_raw(cached, cache_status="HIT")

    # --- Disk cache check ---
    try:
        from alpaca_key_pool import get_key_pool, alpaca_get
        pool = get_key_pool()
        entry, _ = pool.pick("/v1/history/bars", {"end": end, "feed": user_explicit_feed or ""})
        expected_feed_class = "sip" if entry and entry.tier == "paid" else "iex"

        disk = await get_disk_cache_instance()
        if disk is not None:
            disk_params = {
                "symbol": symbol,
                "start": start,
                "end": end,
                "timeframe": timeframe,
                "feed": feed,
                "limit": limit,
                "max_pages": max_pages
            }
            if not force_refresh:
                disk_hit = await disk.get("/v1/history/bars", disk_params, feed_class=expected_feed_class)
                if disk_hit is not None:
                    if redis_conn is not None:
                        await redis_conn.set(cache_key, _fast_dumps_str(disk_hit), ex=CACHE_TTL_SECONDS)
                    return _log_and_return(disk_hit, 200, cache_status="DISK_HIT")
    except Exception as e:
        print(f"[DiskCache] bars get error: {e}")

    # --- TimescaleDB query (数据库优先) ---
    # 在请求上游之前，先查询本地 TimescaleDB。如果数据完整，直接返回。
    # 这是数据库优先架构的核心：本地 DB 成为主要数据源，上游仅用于回填。
    if DB_MANAGER_AVAILABLE and query_bars is not None and not force_refresh:
        try:
            db_result = await query_bars(symbol, timeframe, start, end, limit)
            if db_result is not None:
                # DB 命中 — 写入 Redis 缓存后返回
                if redis_conn is not None:
                    await redis_conn.set(cache_key, _fast_dumps_str(db_result), ex=CACHE_TTL_SECONDS)
                # 同时写入 Disk cache
                try:
                    if disk is not None:
                        await disk.put("/v1/history/bars", disk_params, db_result, feed_class="db")
                except Exception:
                    pass
                return _log_and_return(db_result, 200, cache_status="DB_HIT")
        except Exception as e:
            print(f"[DB] query_bars error: {e}", flush=True)

    # --- In-flight coalescing ---
    # When many concurrent clients request the same (symbol, start, end, timeframe)
    # we collapse them into a single upstream call. The leader fetches + populates
    # the cache; followers wait on the leader's future and return the same payload
    # with X-Cache: COALESCED. This is the biggest win for stress-test patterns
    # where N workers share a small symbol pool.
    inflight_key = _make_inflight_key("bars", {
        "symbol": symbol, "start": start, "end": end,
        "timeframe": timeframe, "limit": limit, "max_pages": max_pages
    })
    leader_future = None
    async with _inflight_lock:
        existing = _inflight_requests.get(inflight_key)
        if existing is not None:
            leader_future = existing
        else:
            leader_future = asyncio.get_event_loop().create_future()
            _inflight_requests[inflight_key] = leader_future
            leader_future = None  # marker: we are the leader

    if leader_future is not None:
        try:
            leader_result = await leader_future
            return _log_and_return(leader_result["payload"], leader_result["status"], cache_status="COALESCED")
        except Exception:
            pass  # leader failed → fall through and do our own fetch

    params = {
        "symbols": symbol,
        "start": start,
        "end": end,
        "timeframe": timeframe,
        "adjustment": "all",
        "feed": feed,
        "limit": limit
    }

    all_bars = []
    next_page_token = None
    pages = 0
    actual_feed_class = "unknown"

    session = await get_http_session()
    while True:
        if next_page_token:
            params["page_token"] = next_page_token
        elif "page_token" in params:
            del params["page_token"]

        # Note: the upstream URL is /v2/stocks/bars for the proxy to Alpaca
        # picker_params only includes user-explicit feed (not the default "sip")
        # so the picker can correctly route old-data requests to free keys
        _picker = {"end": end, "feed": user_explicit_feed or ""}
        status, headers, body, feed_class_used = await alpaca_get(
            session, "/v2/stocks/bars", params, end_hint=end,
            routing_endpoint="/v1/history/bars",
            picker_params=_picker
        )
        actual_feed_class = feed_class_used

        if status != 200:
            error_text = body.decode('utf-8', errors='replace')
            print(f"[Cloud] Alpaca history error {status}: {error_text[:200]}")
            error_payload = {"error": f"Alpaca returned {status}"}
            resp_headers = {"X-Cache": "MISS"}
            if status == 429 and "Retry-After" in headers:
                resp_headers["Retry-After"] = headers["Retry-After"]
            # Signal followers with same error so they get a fast 429 too
            async with _inflight_lock:
                f = _inflight_requests.pop(inflight_key, None)
            if f is not None and not f.done():
                f.set_result({"payload": error_payload, "status": status})
            return web.json_response(error_payload, status=status, headers=resp_headers)

        try:
            result = _fast_loads(body)
        except Exception:
            async with _inflight_lock:
                f = _inflight_requests.pop(inflight_key, None)
            if f is not None and not f.done():
                f.set_result({"payload": {"error": "Invalid JSON from Alpaca"}, "status": 500})
            return _log_and_return({"error": "Invalid JSON from Alpaca"}, 500, cache_status="MISS")

        bars = result.get("bars", {}).get(symbol, [])
        if bars:
            all_bars.extend(bars)

        next_page_token = result.get("next_page_token")
        pages += 1
        if not next_page_token or pages >= max_pages:
            break

    response_payload = {"bars": {symbol: all_bars}, "pages": pages}
    if next_page_token:
        response_payload["next_page_token"] = next_page_token

    if redis_conn is not None:
        await redis_conn.set(cache_key, _fast_dumps_str(response_payload), ex=CACHE_TTL_SECONDS)

    # --- Disk cache save ---
    try:
        if disk is not None:
            await disk.put("/v1/history/bars", disk_params, response_payload, feed_class=actual_feed_class)
    except Exception as e:
        print(f"[DiskCache] bars put error: {e}")

    # --- TimescaleDB save (数据库优先: 上游数据写入本地 DB) ---
    if DB_MANAGER_AVAILABLE and insert_bars_batch is not None and all_bars:
        try:
            # fire-and-forget: 不阻塞响应，后台写入 DB
            asyncio.create_task(
                insert_bars_batch(
                    symbol=symbol,
                    timeframe=timeframe,
                    bars=all_bars,
                    feed=actual_feed_class,
                    source="alpaca",
                )
            )
        except Exception as e:
            print(f"[DB] insert_bars_batch error: {e}", flush=True)

    # Signal followers with success payload
    async with _inflight_lock:
        f = _inflight_requests.pop(inflight_key, None)
    if f is not None and not f.done():
        f.set_result({"payload": response_payload, "status": 200})

    # region agent log
    agent_log(
        "P3",
        "alpaca_cloud_proxy.py:handle_history_request",
        "history_response_ready",
        {
            "symbol": symbol,
            "bars": len(all_bars),
            "pages": pages,
            "elapsed_ms": int((time.time() - start_time) * 1000),
        },
    )
    # endregion agent log

    return _log_and_return(response_payload, 200)


async def handle_options_history_request(request):
    start_time = time.time()
    if request.method == "GET":
        data = dict(request.rel_url.query)
    else:
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON"}, status=400)

    token = data.get("token", "")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:]

    principal = resolve_http_principal(token, request)
    user_id = principal.get("user_id") if principal else None
    endpoint = "/v1/history/options/bars"

    def _log_and_return(payload, status, cache_status="MISS"):
        symbols_log = data.get("symbols") or data.get("symbol")
        log_http_usage(endpoint, user_id, status, start_time, {"symbols": symbols_log, "timeframe": data.get("timeframe")})
        return web.Response(body=_fast_dumps_str(payload), status=status, content_type="application/json", headers={"X-Cache": cache_status})

    if not principal:
        return _log_and_return({"error": "Invalid token"}, 401)
    if not allow_rest_endpoint(principal, endpoint):
        return _log_and_return({"error": "Forbidden"}, 403)

    role = principal.get("role", "default") if principal else "default"
    allowed, req_count, req_limit = await rate_limiter.check_rest(user_id, role)
    if not allowed:
        log_http_usage(endpoint, user_id, 429, start_time, {"reason": "rate_limit", "count": req_count, "limit": req_limit})
        return web.Response(status=429, text=f'Rate limit exceeded: {req_count}/{req_limit} req/min')

    symbol = data.get("symbol")
    symbols = data.get("symbols")
    start = data.get("start")
    end = data.get("end")
    timeframe = data.get("timeframe", "1Min")
    limit = data.get("limit", 10000)
    max_pages = data.get("max_pages", 100)
    provider = str(data.get("provider", "auto")).strip().lower()
    if provider in ("theta", "thetadata"):
        provider = "thetadata"
    if provider not in ("auto", "thetadata", "alpaca"):
        return _log_and_return({"error": "Invalid provider. Use auto, alpaca, or thetadata."}, 400)

    if not symbols and symbol:
        symbols = symbol

    # Auto-resolve stock symbol to option chain
    symbol_list = symbols if isinstance(symbols, list) else [s.strip() for s in str(symbols).split(",")]
    occ_symbols = []
    has_unresolved_stock = False
    for sym in symbol_list:
        parsed = _parse_occ_symbol_theta(sym)
        if parsed is not None:
            occ_symbols.append(sym)
        else:
            # Try to fetch option chain for stock symbol active on the start date
            chain = await fetch_option_chain_for_symbol(sym, expiration_date=start)
            if chain:
                occ_symbols.extend(chain)
                print(f"[OptionChain] Resolved {sym} to {len(chain)} contracts")
            else:
                has_unresolved_stock = True
                print(f"[OptionChain] No contracts found for {sym}")
    
    if has_unresolved_stock and not occ_symbols:
        # If we failed to resolve any stock symbols, and there are no valid OCC symbols,
        # return empty bars instead of forwarding invalid stock symbols to upstream API.
        return _log_and_return({"bars": {}, "next_page_token": None}, 200, cache_status="MISS")

    if occ_symbols:
        symbols = ",".join(occ_symbols)
    
    if not all([symbols, start, end]):
        return _log_and_return({"error": "Missing required fields"}, 400)

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 10000
    limit = max(1, min(limit, 10000))

    try:
        max_pages = int(max_pages)
    except (TypeError, ValueError):
        max_pages = 100
    max_pages = max(1, max_pages)

    cache_key = f"options_bars:{provider}:{symbols}:{start}:{end}:{timeframe}:{limit}:{max_pages}"
    redis_conn = await get_redis_client()
    if redis_conn is not None:
        cached = await redis_conn.get(cache_key)
        if cached:
            return respond_cached_raw(cached, endpoint, user_id, start_time)

    # --- Disk cache check ---
    try:
        disk = await get_disk_cache_instance()
        if disk is not None:
            disk_params = {
                "symbol": symbols,
                "start": start,
                "end": end,
                "timeframe": timeframe,
                "limit": limit,
                "max_pages": max_pages,
                "provider": provider
            }
            disk_hit = await disk.get("/v1/history/options/bars", disk_params)
            if disk_hit is not None:
                if redis_conn is not None:
                    await redis_conn.set(cache_key, _fast_dumps_str(disk_hit), ex=CACHE_TTL_SECONDS)
                return _log_and_return(disk_hit, 200, cache_status="DISK_HIT")
    except Exception as e:
        print(f"[DiskCache] options_bars get error: {e}")

    # --- TimescaleDB query (数据库优先) ---
    # 对期权 bars，先查询本地 DB。注意: 期权支持多 symbols，我们逐个查询合并结果。
    if DB_MANAGER_AVAILABLE and query_options_bars is not None:
        try:
            db_all_bars = {}
            db_has_data = False
            for occ_sym in occ_symbols:
                db_result = await query_options_bars(occ_sym, timeframe, start, end, limit)
                if db_result and db_result.get("bars"):
                    db_has_data = True
                    for sym, bars in db_result["bars"].items():
                        db_all_bars[sym] = bars
            if db_has_data:
                db_payload = {"bars": db_all_bars, "pages": 1, "provider": "timescaledb", "db_source": True}
                if redis_conn is not None:
                    await redis_conn.set(cache_key, _fast_dumps_str(db_payload), ex=CACHE_TTL_SECONDS)
                return _log_and_return(db_payload, 200, cache_status="DB_HIT")
        except Exception as e:
            print(f"[DB] query_options_bars error: {e}", flush=True)

    # --- In-flight coalescing ---
    inflight_key = _make_inflight_key("options_bars", data)
    async with _inflight_lock:
        existing = _inflight_requests.get(inflight_key)
        if existing is not None:
            future = existing
        else:
            future = asyncio.get_event_loop().create_future()
            _inflight_requests[inflight_key] = future
            future = None  # marker: we are the leader

    if future is not None:
        # Follower: wait for leader
        try:
            leader_result = await future
            return _log_and_return(leader_result["payload"], leader_result["status"], cache_status="COALESCED")
        except Exception:
            pass  # leader failed, continue to individual fetch

    # === ThetaData primary provider ===
    theta_result = None
    if THETADATA_ENABLED and provider in ("auto", "thetadata"):
        try:
            theta_result = await fetch_theta_option_bars(symbols, start, end, timeframe)
            if theta_result and theta_result.get("bars"):
                response_payload = theta_result
                response_payload["provider"] = "thetadata"
                if redis_conn is not None:
                    await redis_conn.set(cache_key, _fast_dumps_str(response_payload), ex=CACHE_TTL_SECONDS)

                # --- Disk cache save ---
                try:
                    disk = await get_disk_cache_instance()
                    if disk is not None:
                        disk_params = {
                            "symbol": symbols,
                            "start": start,
                            "end": end,
                            "timeframe": timeframe,
                            "limit": limit,
                            "max_pages": max_pages,
                            "provider": provider
                        }
                        await disk.put("/v1/history/options/bars", disk_params, response_payload)
                except Exception as e:
                    print(f"[DiskCache] options_bars put error (theta): {e}")
                agent_log("P3O", "alpaca_cloud_proxy.py:handle_options_history_request", "theta_options_history_ok", {"symbols": symbols, "bars": sum(len(v) for v in response_payload.get("bars", {}).values()), "elapsed_ms": int((time.time() - start_time) * 1000)})

                # --- TimescaleDB save (ThetaData 数据写入本地 DB) ---
                if DB_MANAGER_AVAILABLE and insert_options_bars_batch is not None:
                    try:
                        for occ_sym, bars in response_payload.get("bars", {}).items():
                            if bars:
                                parsed = _parse_occ_symbol_theta(occ_sym)
                                root = parsed[0] if parsed else occ_sym
                                exp = parsed[1] if parsed else None
                                strike = parsed[3] if parsed else None
                                right = parsed[2] if parsed else None
                                opt_type = "call" if right in ("C", "CALL") else "put" if right in ("P", "PUT") else None
                                asyncio.create_task(
                                    insert_options_bars_batch(
                                        symbol=occ_sym,
                                        root_symbol=root,
                                        expiration_date=exp,
                                        strike_price=strike,
                                        option_type=opt_type,
                                        timeframe=timeframe,
                                        bars=bars,
                                        feed="opra",
                                        source="thetadata",
                                    )
                                )
                    except Exception as e:
                        print(f"[DB] insert_options_bars_batch error: {e}", flush=True)

                # Signal followers
                if future is None:
                    result = {"payload": response_payload, "status": 200}
                    async with _inflight_lock:
                        f = _inflight_requests.pop(inflight_key, None)
                    if f is not None and not f.done():
                        f.set_result(result)
                return _log_and_return(response_payload, 200, cache_status="MISS")
        except Exception as e:
            print(f"[ThetaData] Fallback to Alpaca: {e}")

    if provider == "thetadata":
        return _log_and_return({"error": "ThetaData returned no option bars"}, 502)

    if not ALPACA_MASTER_KEY or not ALPACA_MASTER_SECRET:
        return _log_and_return({"error": "Cloud missing Alpaca master keys"}, 500)

    # === Alpaca fallback ===
    url = f"{DATA_URL}/v1beta1/options/bars"
    params = {
        "symbols": symbols,
        "start": start,
        "end": end,
        "timeframe": timeframe,
        "limit": limit
    }
    headers = {
        "APCA-API-KEY-ID": ALPACA_MASTER_KEY,
        "APCA-API-SECRET-KEY": ALPACA_MASTER_SECRET,
        "Accept": "application/json"
    }

    session = await get_http_session()
    all_bars = {}
    next_page_token = None
    pages = 0

    while True:
        if next_page_token:
            params["page_token"] = next_page_token
        elif "page_token" in params:
            del params["page_token"]

        async with session.get(url, params=params, headers=headers) as resp:
            if resp.status != 200:
                error_text = await resp.text()
                print(f"[Cloud] Alpaca options history error {resp.status}: {error_text[:200]}")
                error_payload = {"error": f"Alpaca returned {resp.status}"}
                # Signal followers on error
                if future is None:
                    result = {"payload": error_payload, "status": resp.status}
                    async with _inflight_lock:
                        f = _inflight_requests.pop(inflight_key, None)
                    if f is not None and not f.done():
                        f.set_result(result)
                return _log_and_return(error_payload, resp.status, cache_status="MISS")

            result = await resp.json()
            bars = result.get("bars", {})
            if isinstance(bars, list):
                all_bars = bars
            elif isinstance(bars, dict):
                for key, value in bars.items():
                    if key not in all_bars:
                        all_bars[key] = []
                    all_bars[key].extend(value or [])

            next_page_token = result.get("next_page_token")
            pages += 1
            if not next_page_token or pages >= max_pages:
                break

    response_payload = {"bars": all_bars, "pages": pages}
    response_payload["provider"] = "alpaca"
    if next_page_token:
        response_payload["next_page_token"] = next_page_token

    if redis_conn is not None:
        await redis_conn.set(cache_key, _fast_dumps_str(response_payload), ex=CACHE_TTL_SECONDS)

    # --- Disk cache save ---
    try:
        disk = await get_disk_cache_instance()
        if disk is not None:
            disk_params = {
                "symbol": symbols,
                "start": start,
                "end": end,
                "timeframe": timeframe,
                "limit": limit,
                "max_pages": max_pages,
                "provider": provider
            }
            await disk.put("/v1/history/options/bars", disk_params, response_payload)
    except Exception as e:
        print(f"[DiskCache] options_bars put error (alpaca): {e}")

    # --- TimescaleDB save (Alpaca 期权数据写入本地 DB) ---
    if DB_MANAGER_AVAILABLE and insert_options_bars_batch is not None:
        try:
            for occ_sym, bars in response_payload.get("bars", {}).items():
                if bars:
                    parsed = _parse_occ_symbol_theta(occ_sym)
                    root = parsed[0] if parsed else occ_sym
                    exp = parsed[1] if parsed else None
                    strike = parsed[3] if parsed else None
                    right = parsed[2] if parsed else None
                    opt_type = "call" if right in ("C", "CALL") else "put" if right in ("P", "PUT") else None
                    asyncio.create_task(
                        insert_options_bars_batch(
                            symbol=occ_sym,
                            root_symbol=root,
                            expiration_date=exp,
                            strike_price=strike,
                            option_type=opt_type,
                            timeframe=timeframe,
                            bars=bars,
                            feed="opra",
                            source="alpaca",
                        )
                    )
        except Exception as e:
            print(f"[DB] insert_options_bars_batch error (alpaca): {e}", flush=True)

    # Signal followers
    if future is None:
        result = {"payload": response_payload, "status": 200}
        async with _inflight_lock:
            f = _inflight_requests.pop(inflight_key, None)
        if f is not None and not f.done():
            f.set_result(result)

    agent_log(
        "P3O",
        "alpaca_cloud_proxy.py:handle_options_history_request",
        "options_history_response_ready",
        {
            "symbols": symbols,
            "pages": pages,
            "elapsed_ms": int((time.time() - start_time) * 1000),
        },
    )

    return _log_and_return(response_payload, 200, cache_status="MISS")


def _extract_http_request_auth(data, request):
    token = data.get("token", "")
    if not token:
        token = request.query.get("token", "")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:]
    api_key = data.get("key") or request.query.get("key") or ALPACA_MASTER_KEY
    api_secret = data.get("secret") or request.query.get("secret") or ALPACA_MASTER_SECRET
    return token, api_key, api_secret




async def handle_option_open_interest_request(request):
    global theta_client
    start_time = time.time()
    data = {}
    if request.method == "POST":
        try:
            data = await request.json()
        except Exception:
            pass

    def get_param(name, default=None):
        val = data.get(name)
        if val is None:
            val = request.query.get(name)
        return val if val is not None else default

    token = get_param("token", "")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:]

    principal = resolve_http_principal(token, request)
    user_id = principal.get("user_id") if principal else None
    endpoint = "/v1/options/open_interest"

    def _log_and_return(payload, status, cache_status="MISS"):
        log_http_usage(endpoint, user_id, status, start_time)
        return web.Response(body=_fast_dumps_str(payload), status=status, content_type="application/json", headers={"X-Cache": cache_status})

    if not principal:
        return _log_and_return({"error": "Invalid token"}, 401)
    if not allow_rest_endpoint(principal, endpoint):
        return _log_and_return({"error": "Forbidden"}, 403)

    role = principal.get("role", "default") if principal else "default"
    allowed, req_count, req_limit = await rate_limiter.check_rest(user_id, role)
    if not allowed:
        log_http_usage(endpoint, user_id, 429, start_time, {"reason": "rate_limit", "count": req_count, "limit": req_limit})
        return web.Response(status=429, text=f'Rate limit exceeded: {req_count}/{req_limit} req/min')

    symbol = get_param("symbol")
    start = get_param("start")
    end = get_param("end")
    expiration = get_param("expiration", "*")
    strike = get_param("strike", "*")
    right = get_param("right", "both")
    max_dte = get_param("max_dte")
    strike_range = get_param("strike_range")

    if not symbol or not start or not end:
        return _log_and_return({"error": "Missing required fields: symbol, start, end"}, 400)

    cache_params = {
        "symbol": symbol,
        "start": start,
        "end": end,
        "expiration": expiration,
        "strike": strike,
        "right": right,
        "max_dte": max_dte,
        "strike_range": strike_range,
    }
    disk_hit = await _get_disk_cached_response(endpoint, cache_params)
    if disk_hit is not None:
        return _log_and_return(disk_hit, 200, cache_status="DISK_HIT")

    try:
        import datetime
        start_date = datetime.datetime.strptime(start.split("T")[0], "%Y-%m-%d").date()
        end_date = datetime.datetime.strptime(end.split("T")[0], "%Y-%m-%d").date()
        loop = asyncio.get_event_loop()

        kwargs = dict(symbol=symbol, expiration=expiration, start_date=start_date, end_date=end_date, strike=strike, right=right)
        if max_dte is not None:
            kwargs["max_dte"] = int(max_dte)
        if strike_range is not None:
            kwargs["strike_range"] = int(strike_range)

        df = None
        for attempt in range(2):
            client = await get_theta_client()
            if client is None:
                return _log_and_return({"error": "ThetaData not available"}, 503)
            try:
                df = await loop.run_in_executor(None, lambda: client.option_history_open_interest(**kwargs))
                break
            except Exception as e:
                err_str = str(e).lower()
                if attempt == 0 and ("unauthenticated" in err_str or "session" in err_str or "conflict" in err_str or "connection" in err_str):
                    print(f"[ThetaData] Resetting client in OI request due to error: {e}")
                    async with theta_client_lock:
                        theta_client = None
                    continue
                else:
                    raise

        if hasattr(df, "to_pandas"):
            df = df.to_pandas()

        records = []
        if df is not None and len(df) > 0:
            for _, row in df.iterrows():
                rec = {}
                for col in df.columns:
                    val = row[col]
                    if hasattr(val, "item"):
                        val = val.item()
                    elif hasattr(val, "isoformat"):
                        val = val.isoformat()
                    elif hasattr(val, "strftime"):
                        val = val.strftime("%Y-%m-%d")
                    rec[col] = val
                records.append(rec)

        response_payload = {"data": records, "count": len(records), "provider": "thetadata"}
        await _put_disk_cached_response(endpoint, cache_params, response_payload)
        return _log_and_return(response_payload, 200)
    except Exception as e:
        print(f"[ThetaData] OI error: {e}")
        err_str = str(e).lower()
        if "session" in err_str or "unauthenticated" in err_str or "rpc" in err_str or "conflict" in err_str:
            async with theta_client_lock:
                theta_client = None
        return _log_and_return({"error": str(e)}, 500)


async def handle_option_history_trade_quote_request(request):
    global theta_client
    start_time = time.time()
    if request.method == "GET":
        data = dict(request.rel_url.query)
    else:
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON"}, status=400)

    token = data.get("token", "")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:]

    principal = resolve_http_principal(token, request)
    user_id = principal.get("user_id") if principal else None
    endpoint = request.path

    def _log_and_return(payload, status, cache_status="MISS"):
        log_http_usage(endpoint, user_id, status, start_time)
        return web.Response(body=_fast_dumps_str(payload), status=status, content_type="application/json", headers={"X-Cache": cache_status})

    if not principal:
        return _log_and_return({"error": "Invalid token"}, 401)
    if not allow_rest_endpoint(principal, endpoint):
        return _log_and_return({"error": "Forbidden"}, 403)

    role = principal.get("role", "default") if principal else "default"
    allowed, req_count, req_limit = await rate_limiter.check_rest(user_id, role)
    if not allowed:
        log_http_usage(endpoint, user_id, 429, start_time, {"reason": "rate_limit", "count": req_count, "limit": req_limit})
        return web.Response(status=429, text=f'Rate limit exceeded: {req_count}/{req_limit} req/min')

    symbol = data.get("symbol")
    date_val = data.get("date")
    start_date_val = data.get("start_date")
    end_date_val = data.get("end_date")
    start_time_val = data.get("start_time", "09:30:00")
    end_time_val = data.get("end_time", "16:00:00")
    exclusive = data.get("exclusive", False)
    venue = data.get("venue", "opra")

    if not symbol:
        return _log_and_return({"error": "Missing required field: symbol"}, 400)

    parsed = _parse_occ_symbol_theta(symbol)
    if not parsed:
        return _log_and_return({"error": "Invalid OCC symbol format. Expected e.g. AAPL260522C00200000"}, 400)
    root, exp_str, right, strike_dollars = parsed

    if not date_val and not (start_date_val and end_date_val):
        return _log_and_return({"error": "Missing required date fields: 'date' or both 'start_date' and 'end_date' must be provided"}, 400)

    client = await get_theta_client()
    if client is None:
        return _log_and_return({"error": "ThetaData not available"}, 503)

    try:
        import datetime

        def _parse_date(d_str):
            if not d_str:
                return None
            d_str = str(d_str).strip()
            for fmt in ("%Y-%m-%d", "%Y%m%d"):
                try:
                    return datetime.datetime.strptime(d_str, fmt).date()
                except ValueError:
                    pass
            raise ValueError(f"Invalid date format: {d_str}. Expected YYYY-MM-DD or YYYYMMDD")

        def _parse_time(t_str):
            if not t_str:
                return None
            t_str = str(t_str).strip()
            for fmt in ("%H:%M:%S.%f", "%H:%M:%S", "%H:%M"):
                try:
                    return datetime.datetime.strptime(t_str, fmt).time()
                except ValueError:
                    pass
            raise ValueError(f"Invalid time format: {t_str}. Expected HH:MM:SS")

        exp_date = datetime.datetime.strptime(exp_str, "%Y%m%d").date()
        parsed_date = _parse_date(date_val) if date_val else None
        parsed_start_date = _parse_date(start_date_val) if start_date_val else None
        parsed_end_date = _parse_date(end_date_val) if end_date_val else None
        parsed_start_time = _parse_time(start_time_val) if start_time_val else None
        parsed_end_time = _parse_time(end_time_val) if end_time_val else None

        # Canonical cache endpoint (alias-independent) so both /v1/history/options/trade_quote
        # and /v1/options/history/trade_quote share entries
        cache_endpoint = "/v1/history/options/trade_quote"
        cache_params = {
            "symbol": symbol,
            "date": str(parsed_date) if parsed_date else "",
            "start_date": str(parsed_start_date) if parsed_start_date else "",
            "end_date": str(parsed_end_date) if parsed_end_date else "",
            "start_time": str(parsed_start_time) if parsed_start_time else "",
            "end_time": str(parsed_end_time) if parsed_end_time else "",
            "exclusive": bool(exclusive),
        }
        cache_key = (
            f"opt_tq:{symbol}:{cache_params['date']}:{cache_params['start_date']}:"
            f"{cache_params['end_date']}:{cache_params['start_time']}:{cache_params['end_time']}:"
            f"{cache_params['exclusive']}"
        )
        redis_conn = await get_redis_client()
        if redis_conn is not None:
            cached = await redis_conn.get(cache_key)
            if cached:
                return respond_cached_raw(cached, endpoint, user_id, start_time)
        disk_hit = await _get_disk_cached_response(cache_endpoint, cache_params)
        if disk_hit is not None:
            if redis_conn is not None:
                await redis_conn.set(cache_key, _fast_dumps_str(disk_hit), ex=CACHE_TTL_SECONDS)
            return _log_and_return(disk_hit, 200, cache_status="DISK_HIT")

        loop = asyncio.get_event_loop()
        kwargs = {
            "symbol": root,
            "expiration": exp_date,
            "strike": str(strike_dollars),
            "right": right,
            "exclusive": bool(exclusive)
        }
        if parsed_date:
            kwargs["date"] = parsed_date
        else:
            kwargs["start_date"] = parsed_start_date
            kwargs["end_date"] = parsed_end_date

        if parsed_start_time:
            kwargs["start_time"] = parsed_start_time
        if parsed_end_time:
            kwargs["end_time"] = parsed_end_time

        df = None
        for attempt in range(2):
            try:
                client = await get_theta_client()
                if client is None:
                    return _log_and_return({"error": "ThetaData not available"}, 503)
                
                df = await loop.run_in_executor(None, lambda: client.option_history_trade_quote(**kwargs))
                break
            except Exception as e:
                err_str = str(e).lower()
                if attempt == 0 and ("unauthenticated" in err_str or "session" in err_str or "conflict" in err_str or "connection" in err_str):
                    print(f"[ThetaData] Resetting client due to error: {e}")
                    async with theta_client_lock:
                        theta_client = None
                    continue
                else:
                    raise

        if hasattr(df, "to_pandas"):
            df = df.to_pandas()

        records = []
        if df is not None and len(df) > 0:
            for _, row in df.iterrows():
                rec = {}
                for col in df.columns:
                    val = row[col]
                    if hasattr(val, "item"):
                        val = val.item()
                    elif hasattr(val, "isoformat"):
                        val = val.isoformat()
                    elif hasattr(val, "strftime"):
                        val = val.strftime("%Y-%m-%d")
                    rec[col] = val
                records.append(rec)

        response_payload = {"data": records, "count": len(records)}
        if redis_conn is not None:
            await redis_conn.set(cache_key, _fast_dumps_str(response_payload), ex=CACHE_TTL_SECONDS)
        await _put_disk_cached_response(cache_endpoint, cache_params, response_payload)
        return _log_and_return(response_payload, 200)
    except Exception as e:
        print(f"[ThetaData] Option history trade_quote error: {e}")
        return _log_and_return({"error": str(e)}, 500)


async def handle_stock_history_trade_quote_request(request):
    """Handle stock trade+quote history via Alpaca REST API.
    
    Calls:
    - GET /v2/stocks/{symbol}/trades (historical trades)
    - GET /v2/stocks/{symbol}/quotes (historical quotes)
    
    Parameters:
    - symbol: stock symbol (e.g. AAPL)
    - start: start datetime (ISO 8601)
    - end: end datetime (ISO 8601)
    - limit: max records per request (default 1000, max 10000)
    - feed: sip/iex (default sip)
    """
    start_time = time.time()
    if request.method == "GET":
        data = dict(request.rel_url.query)
    else:
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON"}, status=400)

    token = data.get("token", "")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:]

    principal = resolve_http_principal(token, request)
    user_id = principal.get("user_id") if principal else None
    endpoint = "/v1/stock/history/trade_quote"

    def _log_and_return(payload, status, cache_status="MISS"):
        log_http_usage(endpoint, user_id, status, start_time, {"symbol": data.get("symbol")})
        return web.Response(body=_fast_dumps_str(payload), status=status, content_type="application/json", headers={"X-Cache": cache_status})

    if not principal:
        return _log_and_return({"error": "Invalid token"}, 401)
    if not allow_rest_endpoint(principal, endpoint):
        return _log_and_return({"error": "Forbidden"}, 403)

    role = principal.get("role", "default") if principal else "default"
    allowed, req_count, req_limit = await rate_limiter.check_rest(user_id, role)
    if not allowed:
        log_http_usage(endpoint, user_id, 429, start_time, {"reason": "rate_limit", "count": req_count, "limit": req_limit})
        return web.Response(status=429, text=f'Rate limit exceeded: {req_count}/{req_limit} req/min')

    symbol = data.get("symbol")
    start = data.get("start")
    end = data.get("end")
    limit = data.get("limit", 1000)
    feed = data.get("feed", "sip" if IS_PRO else "iex")

    if not symbol:
        return _log_and_return({"error": "Missing required field: symbol"}, 400)
    if not start or not end:
        return _log_and_return({"error": "Missing required fields: start and end"}, 400)

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 1000
    limit = max(1, min(limit, 10000))

    cache_params = {
        "symbol": symbol,
        "start": start,
        "end": end,
        "limit": limit,
        "feed": feed,
    }
    cache_key = f"stock_tq:{symbol}:{start}:{end}:{limit}:{feed}"
    redis_conn = await get_redis_client()
    if redis_conn is not None:
        cached = await redis_conn.get(cache_key)
        if cached:
            return respond_cached_raw(cached, endpoint, user_id, start_time)
    disk_hit = await _get_disk_cached_response(endpoint, cache_params)
    if disk_hit is not None:
        if redis_conn is not None:
            await redis_conn.set(cache_key, _fast_dumps_str(disk_hit), ex=CACHE_TTL_SECONDS)
        return _log_and_return(disk_hit, 200, cache_status="DISK_HIT")

    if not ALPACA_MASTER_KEY or not ALPACA_MASTER_SECRET:
        return _log_and_return({"error": "Cloud missing Alpaca master keys"}, 500)

    headers = {
        "APCA-API-KEY-ID": ALPACA_MASTER_KEY,
        "APCA-API-SECRET-KEY": ALPACA_MASTER_SECRET,
        "Accept": "application/json"
    }

    async def fetch_alpaca_data(url_path, params):
        """Fetch paginated data from Alpaca."""
        url = f"{DATA_URL}{url_path}"
        all_records = []
        next_page_token = None
        pages = 0
        max_pages = 100

        session = await get_http_session()
        while True:
            if next_page_token:
                params["page_token"] = next_page_token
            elif "page_token" in params:
                del params["page_token"]

            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    print(f"[Cloud] Alpaca {url_path} error {resp.status}: {error_text[:200]}")
                    return None, resp.status, error_text

                result = await resp.json()
                # Alpaca returns trades/quotes as dict keyed by symbol, e.g. {"trades": {"AAPL": [...]}}
                records = []
                if "trades" in result:
                    trades_by_sym = result.get("trades", {})
                    if isinstance(trades_by_sym, dict):
                        for sym_records in trades_by_sym.values():
                            if isinstance(sym_records, list):
                                records.extend(sym_records)
                    elif isinstance(trades_by_sym, list):
                        records.extend(trades_by_sym)
                elif "quotes" in result:
                    quotes_by_sym = result.get("quotes", {})
                    if isinstance(quotes_by_sym, dict):
                        for sym_records in quotes_by_sym.values():
                            if isinstance(sym_records, list):
                                records.extend(sym_records)
                    elif isinstance(quotes_by_sym, list):
                        records.extend(quotes_by_sym)
                if records:
                    all_records.extend(records)

                next_page_token = result.get("next_page_token")
                pages += 1
                if not next_page_token or pages >= max_pages:
                    break

        return all_records, 200, None

    # Fetch trades
    trades_params = {
        "symbols": symbol,
        "start": start,
        "end": end,
        "feed": feed,
        "limit": limit
    }
    trades, trades_status, trades_error = await fetch_alpaca_data("/v2/stocks/trades", trades_params)

    # Fetch quotes
    quotes_params = {
        "symbols": symbol,
        "start": start,
        "end": end,
        "feed": feed,
        "limit": limit
    }
    quotes, quotes_status, quotes_error = await fetch_alpaca_data("/v2/stocks/quotes", quotes_params)

    response_payload = {
        "symbol": symbol,
        "start": start,
        "end": end,
        "feed": feed,
    }

    if trades_status == 200:
        response_payload["trades"] = trades
        response_payload["trade_count"] = len(trades)
    else:
        response_payload["trades_error"] = trades_error or f"HTTP {trades_status}"

    if quotes_status == 200:
        response_payload["quotes"] = quotes
        response_payload["quote_count"] = len(quotes)
    else:
        response_payload["quotes_error"] = quotes_error or f"HTTP {quotes_status}"

    if trades_status != 200 and quotes_status != 200:
        return _log_and_return({
            "error": "Failed to fetch both trades and quotes",
            "trades_error": response_payload.get("trades_error"),
            "quotes_error": response_payload.get("quotes_error")
        }, 500)

    # Only cache when both legs succeeded — partial responses are misleading on replay
    if trades_status == 200 and quotes_status == 200:
        if redis_conn is not None:
            await redis_conn.set(cache_key, _fast_dumps_str(response_payload), ex=CACHE_TTL_SECONDS)
        await _put_disk_cached_response(endpoint, cache_params, response_payload)
    return _log_and_return(response_payload, 200)


async def handle_option_eod_request(request):
    global theta_client
    start_time = time.time()
    data = {}
    if request.method == "POST":
        try:
            data = await request.json()
        except Exception:
            pass

    def get_param(name, default=None):
        val = data.get(name)
        if val is None:
            val = request.query.get(name)
        return val if val is not None else default

    token = get_param("token", "")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:]

    principal = resolve_http_principal(token, request)
    user_id = principal.get("user_id") if principal else None
    endpoint = request.path

    def _log_and_return(payload, status, cache_status="MISS"):
        log_http_usage(endpoint, user_id, status, start_time)
        return web.Response(body=_fast_dumps_str(payload), status=status, content_type="application/json", headers={"X-Cache": cache_status})

    if not principal:
        return _log_and_return({"error": "Invalid token"}, 401)
    if not allow_rest_endpoint(principal, endpoint):
        return _log_and_return({"error": "Forbidden"}, 403)

    role = principal.get("role", "default") if principal else "default"
    allowed, req_count, req_limit = await rate_limiter.check_rest(user_id, role)
    if not allowed:
        log_http_usage(endpoint, user_id, 429, start_time, {"reason": "rate_limit", "count": req_count, "limit": req_limit})
        return web.Response(status=429, text=f'Rate limit exceeded: {req_count}/{req_limit} req/min')

    symbol = get_param("symbol")
    start = get_param("start")
    end = get_param("end")
    expiration = get_param("expiration", "*")
    strike = get_param("strike", "*")
    right = get_param("right", "both")
    max_dte = get_param("max_dte")
    strike_range = get_param("strike_range")

    if not symbol or not start or not end:
        return _log_and_return({"error": "Missing required fields: symbol, start, end"}, 400)

    cache_params = {
        "symbol": symbol,
        "start": start,
        "end": end,
        "expiration": expiration,
        "strike": strike,
        "right": right,
        "max_dte": max_dte,
        "strike_range": strike_range,
    }
    disk_hit = await _get_disk_cached_response(endpoint, cache_params)
    if disk_hit is not None:
        return _log_and_return(disk_hit, 200, cache_status="DISK_HIT")

    try:
        import datetime
        start_date = datetime.datetime.strptime(start.split("T")[0], "%Y-%m-%d").date()
        end_date = datetime.datetime.strptime(end.split("T")[0], "%Y-%m-%d").date()
        loop = asyncio.get_event_loop()

        kwargs = dict(symbol=symbol, expiration=expiration, start_date=start_date, end_date=end_date, strike=strike, right=right)
        if max_dte is not None:
            kwargs["max_dte"] = int(max_dte)
        if strike_range is not None:
            kwargs["strike_range"] = int(strike_range)

        df = None
        for attempt in range(2):
            client = await get_theta_client()
            if client is None:
                return _log_and_return({"error": "ThetaData not available"}, 503)
            try:
                df = await loop.run_in_executor(None, lambda: client.option_history_eod(**kwargs))
                break
            except Exception as e:
                err_str = str(e).lower()
                if attempt == 0 and ("unauthenticated" in err_str or "session" in err_str or "conflict" in err_str or "connection" in err_str):
                    print(f"[ThetaData] Resetting client in EOD request due to error: {e}")
                    async with theta_client_lock:
                        theta_client = None
                    continue
                else:
                    raise

        if hasattr(df, "to_pandas"):
            df = df.to_pandas()

        records = []
        if df is not None and len(df) > 0:
            for _, row in df.iterrows():
                rec = {}
                for col in df.columns:
                    val = row[col]
                    if hasattr(val, "item"):
                        val = val.item()
                    elif hasattr(val, "isoformat"):
                        val = val.isoformat()
                    elif hasattr(val, "strftime"):
                        val = val.strftime("%Y-%m-%d")
                    rec[col] = val
                records.append(rec)

        response_payload = {"data": records, "count": len(records), "provider": "thetadata"}
        await _put_disk_cached_response(endpoint, cache_params, response_payload)
        return _log_and_return(response_payload, 200)
    except Exception as e:
        print(f"[ThetaData] EOD error: {e}")
        err_str = str(e).lower()
        if "session" in err_str or "unauthenticated" in err_str or "rpc" in err_str or "conflict" in err_str:
            async with theta_client_lock:
                theta_client = None
        return _log_and_return({"error": str(e)}, 500)


async def handle_options_history_trades_request(request):
    start_time = time.time()
    data = {}
    if request.method == "POST":
        try:
            data = await request.json()
        except Exception:
            pass

    def get_param(name, default=None):
        val = data.get(name)
        if val is None:
            val = request.query.get(name)
        return val if val is not None else default

    token = get_param("token", "")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:]

    principal = resolve_http_principal(token, request)
    user_id = principal.get("user_id") if principal else None
    endpoint = request.path

    def _log_and_return(payload, status, cache_status="MISS"):
        symbols_log = get_param("symbols") or get_param("symbol")
        log_http_usage(endpoint, user_id, status, start_time, {"symbols": symbols_log})
        return web.Response(body=_fast_dumps_str(payload), status=status, content_type="application/json", headers={"X-Cache": cache_status})

    if not principal:
        return _log_and_return({"error": "Invalid token"}, 401)
    if not allow_rest_endpoint(principal, endpoint):
        return _log_and_return({"error": "Forbidden"}, 403)

    role = principal.get("role", "default") if principal else "default"
    allowed, req_count, req_limit = await rate_limiter.check_rest(user_id, role)
    if not allowed:
        log_http_usage(endpoint, user_id, 429, start_time, {"reason": "rate_limit", "count": req_count, "limit": req_limit})
        return web.Response(status=429, text=f'Rate limit exceeded: {req_count}/{req_limit} req/min')

    symbol = get_param("symbol")
    symbols = get_param("symbols")
    start = get_param("start")
    end = get_param("end")
    limit = get_param("limit", 1000)
    page_token = get_param("page_token")
    sort = get_param("sort", "asc")

    if not symbols and symbol:
        symbols = symbol

    if not symbols:
        return _log_and_return({"error": "Missing required field: symbols"}, 400)

    # Clean symbols
    if isinstance(symbols, (list, tuple)):
        symbol_list = [str(item).strip().upper() for item in symbols if str(item).strip()]
        symbols = ",".join(symbol_list)
    else:
        symbol_list = [s.strip().upper() for s in str(symbols).split(",") if s.strip()]
        symbols = ",".join(symbol_list)

    cache_endpoint = "/v1/history/options/trades"
    cache_params = {
        "symbols": symbols,
        "start": start or "",
        "end": end or "",
        "limit": limit,
        "page_token": page_token or "",
        "sort": sort,
    }
    cache_key = f"opt_trades:{symbols}:{start}:{end}:{limit}:{page_token or ''}:{sort}"
    redis_conn = await get_redis_client()
    if redis_conn is not None:
        cached = await redis_conn.get(cache_key)
        if cached:
            return respond_cached_raw(cached, endpoint, user_id, start_time)
    disk_hit = await _get_disk_cached_response(cache_endpoint, cache_params)
    if disk_hit is not None:
        if redis_conn is not None:
            await redis_conn.set(cache_key, _fast_dumps_str(disk_hit), ex=CACHE_TTL_SECONDS)
        return _log_and_return(disk_hit, 200, cache_status="DISK_HIT")

    def _with_alpaca_options_history_notice(payload):
        if not isinstance(payload, dict):
            return payload
        payload.setdefault("data_availability", {
            "provider": "alpaca",
            "historical_options_since": ALPACA_OPTIONS_HISTORY_AVAILABLE_FROM,
        })
        start_date = str(start or "").split("T")[0]
        if len(start_date) == 8 and start_date.isdigit():
            start_date = f"{start_date[:4]}-{start_date[4:6]}-{start_date[6:8]}"
        if start_date and start_date < ALPACA_OPTIONS_HISTORY_AVAILABLE_FROM:
            payload.setdefault(
                "warning",
                f"Alpaca historical option data is available from {ALPACA_OPTIONS_HISTORY_AVAILABLE_FROM} onward.",
            )
        return payload

    # 1. Try querying Alpaca first (no fallback but notify user empty response when its too early or on failure)
    api_key = get_param("api_key") or ALPACA_MASTER_KEY
    api_secret = get_param("api_secret") or ALPACA_MASTER_SECRET

    alpaca_failed = False
    alpaca_trades_resp = {}

    if not api_key or not api_secret:
        print("[Cloud] Missing Alpaca credentials, returning empty trades response")
        alpaca_failed = True
    else:
        try:
            try:
                limit_val = int(limit)
            except (TypeError, ValueError):
                limit_val = 1000
            limit_val = max(1, min(limit_val, 10000))

            headers = {
                "APCA-API-KEY-ID": api_key,
                "APCA-API-SECRET-KEY": api_secret,
                "Accept": "application/json",
            }
            url = f"{DATA_URL}/v1beta1/options/trades"
            params = {
                "symbols": symbols,
                "limit": limit_val,
                "sort": sort,
            }
            if start:
                params["start"] = start
            if end:
                params["end"] = end
            if page_token:
                params["page_token"] = page_token

            print(f"[Cloud] Querying Alpaca historical options trades for: {symbols}")
            session = await get_http_session()
            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status != 200:
                    alpaca_failed = True
                    err_txt = await resp.text()
                    print(f"[Cloud] Alpaca option trades returned error status {resp.status}: {err_txt[:200]}")
                else:
                    alpaca_trades_resp = await resp.json()
        except Exception as e:
            print(f"[Cloud] Alpaca option trades request exception: {e}")
            alpaca_failed = True

    # If Alpaca failed or returned empty response, gracefully return {"trades": {}, "next_page_token": null}
    # — do NOT cache empty/failed responses so a later success can populate
    if alpaca_failed or not alpaca_trades_resp or "trades" not in alpaca_trades_resp:
        return _log_and_return(_with_alpaca_options_history_notice({"trades": {}, "next_page_token": None}), 200)

    response_payload = _with_alpaca_options_history_notice(alpaca_trades_resp)
    if redis_conn is not None:
        await redis_conn.set(cache_key, _fast_dumps_str(response_payload), ex=CACHE_TTL_SECONDS)
    await _put_disk_cached_response(cache_endpoint, cache_params, response_payload)
    return _log_and_return(response_payload, 200)


def _theta_get_param(params, *names, default=None):
    for name in names:
        val = params.get(name)
        if val is not None and val != "":
            return val
    return default


def _theta_parse_date(value, *, allow_yymmdd=False, default=None, required=False):
    if value is None or value == "":
        if required:
            raise ValueError("Missing required date parameter")
        return default
    if hasattr(value, "year") and hasattr(value, "month") and hasattr(value, "day"):
        return value
    import datetime
    raw = str(value).strip().split("T")[0]
    if raw == "*":
        return raw
    compact = raw.replace("-", "")
    if allow_yymmdd and len(compact) == 6 and compact.isdigit():
        yy = int(compact[:2])
        yyyy = 2000 + yy if yy < 50 else 1900 + yy
        compact = f"{yyyy}{compact[2:]}"
    if len(compact) == 8 and compact.isdigit():
        return datetime.datetime.strptime(compact, "%Y%m%d").date()
    return datetime.datetime.strptime(raw, "%Y-%m-%d").date()


def _theta_parse_time(value, default=None):
    if value is None or value == "":
        return default
    if hasattr(value, "hour") and hasattr(value, "minute"):
        return value
    import datetime
    raw = str(value).strip()
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.datetime.strptime(raw, fmt).time()
        except ValueError:
            pass
    raise ValueError(f"Invalid time value: {value}")


def _theta_optional_int(value):
    if value is None or value == "":
        return None
    return int(value)


def _theta_symbol_list(value):
    if value is None or value == "":
        return None
    if isinstance(value, (list, tuple)):
        return [str(item).strip().upper() for item in value if str(item).strip()]
    return [item.strip().upper() for item in str(value).split(",") if item.strip()]


def _theta_right(value):
    raw = str(value or "both").strip().lower()
    if raw in ("c", "call"):
        return "call"
    if raw in ("p", "put"):
        return "put"
    return "both"


def _theta_jsonable(value):
    if hasattr(value, "item"):
        value = value.item()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _theta_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_theta_jsonable(v) for v in value]
    try:
        import math
        if isinstance(value, float) and math.isnan(value):
            return None
    except Exception:
        pass
    return value


def _theta_result_to_payload(endpoint, method_name, result):
    if hasattr(result, "to_pandas"):
        result = result.to_pandas()
    if hasattr(result, "to_dicts"):
        records = [_theta_jsonable(row) for row in result.to_dicts()]
        return {"endpoint": endpoint, "method": method_name, "data": records, "count": len(records), "provider": "thetadata"}
    if hasattr(result, "iterrows") and hasattr(result, "columns"):
        records = []
        for _, row in result.iterrows():
            records.append({str(col): _theta_jsonable(row[col]) for col in result.columns})
        return {"endpoint": endpoint, "method": method_name, "data": records, "count": len(records), "provider": "thetadata"}
    if isinstance(result, dict):
        payload = _theta_jsonable(result)
        payload.setdefault("endpoint", endpoint)
        payload.setdefault("method", method_name)
        payload.setdefault("provider", "thetadata")
        return payload
    if isinstance(result, (list, tuple)):
        data = _theta_jsonable(list(result))
        return {"endpoint": endpoint, "method": method_name, "data": data, "count": len(data), "provider": "thetadata"}
    return {"endpoint": endpoint, "method": method_name, "data": _theta_jsonable(result), "provider": "thetadata"}


def _theta_build_sdk_call(endpoint, params):
    root = _theta_get_param(params, "root", "symbol", "underlying")
    expiration_value = _theta_get_param(params, "exp", "expiration", "expiration_date")
    strike = _theta_get_param(params, "strike", default="*")
    if strike != "*":
        strike = str(strike)
    right = _theta_right(_theta_get_param(params, "right", default="both"))
    max_dte = _theta_optional_int(_theta_get_param(params, "max_dte"))
    strike_range = _theta_optional_int(_theta_get_param(params, "strike_range"))
    date_value = _theta_get_param(params, "date")
    start_date_value = _theta_get_param(params, "start_date", "start")
    end_date_value = _theta_get_param(params, "end_date", "end")
    interval = _theta_get_param(params, "interval", "ivl", "timeframe", default="1s")

    def exact_expiration():
        return _theta_parse_date(expiration_value, allow_yymmdd=True, required=True)

    def wildcard_expiration():
        return _theta_parse_date(expiration_value, allow_yymmdd=True, default="*")

    if endpoint == "/v3/option/list/symbols":
        return "option_list_symbols", {}
    if endpoint.startswith("/v3/option/list/dates/"):
        if not root:
            raise ValueError("Missing required parameter: root or symbol")
        return "option_list_dates", {
            "request_type": endpoint.rsplit("/", 1)[-1].upper(),
            "symbol": str(root).upper(),
            "expiration": exact_expiration(),
            "strike": strike,
            "right": right,
        }
    if endpoint == "/v3/option/list/expirations":
        symbols = _theta_symbol_list(root)
        if not symbols:
            raise ValueError("Missing required parameter: root or symbol")
        return "option_list_expirations", {"symbol": symbols}
    if endpoint == "/v3/option/list/strikes":
        symbols = _theta_symbol_list(root)
        if not symbols:
            raise ValueError("Missing required parameter: root or symbol")
        return "option_list_strikes", {"symbol": symbols, "expiration": exact_expiration()}
    if endpoint.startswith("/v3/option/list/contracts/"):
        date = _theta_parse_date(date_value or start_date_value, required=True)
        kwargs = {
            "request_type": endpoint.rsplit("/", 1)[-1].upper(),
            "date": date,
            "symbol": _theta_symbol_list(root),
            "max_dte": max_dte,
        }
        return "option_list_contracts", {k: v for k, v in kwargs.items() if v is not None}

    if endpoint in ("/v3/option/snapshot/ohlc", "/v3/option/snapshot/quote", "/v3/option/snapshot/open_interest"):
        if not root:
            raise ValueError("Missing required parameter: root or symbol")
        method = {
            "/v3/option/snapshot/ohlc": "option_snapshot_ohlc",
            "/v3/option/snapshot/quote": "option_snapshot_quote",
            "/v3/option/snapshot/open_interest": "option_snapshot_open_interest",
        }[endpoint]
        min_time = _theta_parse_time(_theta_get_param(params, "min_time"), default=None)
        kwargs = {
            "symbol": str(root).upper(),
            "expiration": wildcard_expiration(),
            "strike": strike,
            "right": right,
            "max_dte": max_dte,
            "strike_range": strike_range,
            "min_time": min_time,
        }
        return method, {k: v for k, v in kwargs.items() if v is not None}

    if endpoint == "/v3/option/history/eod":
        if not root:
            raise ValueError("Missing required parameter: root or symbol")
        return "option_history_eod", {
            "symbol": str(root).upper(),
            "expiration": wildcard_expiration(),
            "start_date": _theta_parse_date(start_date_value, required=True),
            "end_date": _theta_parse_date(end_date_value, required=True),
            "strike": strike,
            "right": right,
            "max_dte": max_dte,
            "strike_range": strike_range,
        }
    if endpoint == "/v3/option/history/ohlc":
        if not root:
            raise ValueError("Missing required parameter: root or symbol")
        kwargs = {
            "symbol": str(root).upper(),
            "expiration": exact_expiration(),
            "interval": interval,
            "date": _theta_parse_date(date_value) if date_value else None,
            "strike": strike,
            "right": right,
            "start_time": _theta_parse_time(_theta_get_param(params, "start_time"), default=None),
            "end_time": _theta_parse_time(_theta_get_param(params, "end_time"), default=None),
            "strike_range": strike_range,
            "start_date": _theta_parse_date(start_date_value) if start_date_value else None,
            "end_date": _theta_parse_date(end_date_value) if end_date_value else None,
        }
        return "option_history_ohlc", {k: v for k, v in kwargs.items() if v is not None}
    if endpoint == "/v3/option/history/quote":
        if not root:
            raise ValueError("Missing required parameter: root or symbol")
        kwargs = {
            "symbol": str(root).upper(),
            "expiration": wildcard_expiration(),
            "interval": interval,
            "date": _theta_parse_date(date_value) if date_value else None,
            "strike": strike,
            "right": right,
            "start_time": _theta_parse_time(_theta_get_param(params, "start_time"), default=None),
            "end_time": _theta_parse_time(_theta_get_param(params, "end_time"), default=None),
            "max_dte": max_dte,
            "strike_range": strike_range,
            "start_date": _theta_parse_date(start_date_value) if start_date_value else None,
            "end_date": _theta_parse_date(end_date_value) if end_date_value else None,
        }
        return "option_history_quote", {k: v for k, v in kwargs.items() if v is not None}
    if endpoint == "/v3/option/history/open_interest":
        if not root:
            raise ValueError("Missing required parameter: root or symbol")
        kwargs = {
            "symbol": str(root).upper(),
            "expiration": wildcard_expiration(),
            "date": _theta_parse_date(date_value) if date_value else None,
            "strike": strike,
            "right": right,
            "max_dte": max_dte,
            "strike_range": strike_range,
            "start_date": _theta_parse_date(start_date_value) if start_date_value else None,
            "end_date": _theta_parse_date(end_date_value) if end_date_value else None,
        }
        return "option_history_open_interest", {k: v for k, v in kwargs.items() if v is not None}
    if endpoint == "/v3/option/at_time/quote":
        if not root:
            raise ValueError("Missing required parameter: root or symbol")
        kwargs = {
            "symbol": str(root).upper(),
            "start_date": _theta_parse_date(start_date_value, required=True),
            "end_date": _theta_parse_date(end_date_value, required=True),
            "time_of_day": str(_theta_get_param(params, "time_of_day", "time", "timestamp", default="09:30:00")),
            "expiration": wildcard_expiration(),
            "strike": strike,
            "right": right,
            "max_dte": max_dte,
            "strike_range": strike_range,
        }
        return "option_at_time_quote", {k: v for k, v in kwargs.items() if v is not None}

    raise ValueError(f"Unsupported ThetaData Value endpoint: {endpoint}")


async def _execute_thetadata_value_proxy(endpoint: str, params: dict):
    global theta_client
    method_name, kwargs = _theta_build_sdk_call(endpoint, params)
    print(f"[ProviderProxy] ThetaData SDK {method_name} for {endpoint} with params {kwargs}")
    loop = asyncio.get_event_loop()
    
    result = None
    for attempt in range(2):
        client = await get_theta_client()
        if client is None:
            return {"error": "ThetaData not available"}, 503
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(None, lambda: getattr(client, method_name)(**kwargs)),
                timeout=THETADATA_SDK_TIMEOUT_SECONDS,
            )
            break
        except Exception as e:
            err_str = str(e).lower()
            if attempt == 0 and ("unauthenticated" in err_str or "session" in err_str or "conflict" in err_str or "connection" in err_str):
                print(f"[ThetaData] Resetting client in ProviderProxy due to error: {e}")
                async with theta_client_lock:
                    theta_client = None
                continue
            else:
                if "session" in err_str or "unauthenticated" in err_str or "rpc" in err_str or "conflict" in err_str:
                    async with theta_client_lock:
                        theta_client = None
                raise

    return _theta_result_to_payload(endpoint, method_name, result), 200


async def _execute_alpaca_native_proxy(endpoint: str, params: dict, api_key: str, api_secret: str):
    if not api_key or not api_secret:
        return {"error": "Cloud missing Alpaca master keys"}, 500
    url = alpaca_upstream_url(endpoint)
    headers = {
        "APCA-API-KEY-ID": api_key,
        "APCA-API-SECRET-KEY": api_secret,
        "Accept": "application/json",
    }
    print(f"[ProviderProxy] Alpaca GET {url} params={params}")
    session = await get_http_session()
    async with session.get(url, params=params, headers=headers) as resp:
        body = await resp.read()
        try:
            payload = json.loads(body)
        except Exception:
            payload = body.decode("utf-8", "ignore")
        return payload, resp.status


async def handle_provider_proxy(request):
    start_time = time.time()
    data = {}
    if request.method == "POST":
        try:
            data = await request.json()
        except Exception:
            pass

    endpoint = request.path
    provider = native_provider_for_endpoint(endpoint)
    token, api_key, api_secret = _extract_http_request_auth(data, request)
    principal = resolve_http_principal(token, request)
    user_id = principal.get("user_id") if principal else None

    def _log_and_return(payload, status, cache_status="MISS"):
        log_http_usage(endpoint, user_id, status, start_time, {"provider": provider})
        headers = {"X-Cache": cache_status, "X-Provider": provider or "unknown"}
        if isinstance(payload, (dict, list)):
            return web.json_response(payload, status=status, headers=headers)
        return web.Response(text=str(payload), status=status, headers=headers)

    if provider is None:
        return _log_and_return({"error": "Unsupported provider endpoint"}, 404)
    if request.method not in ("GET", "POST"):
        return _log_and_return({"error": "Only GET and POST are supported for provider proxy endpoints"}, 405)
    if not principal:
        return _log_and_return({"error": "Invalid token"}, 401)
    if not allow_rest_endpoint(principal, endpoint):
        return _log_and_return({"error": "Forbidden"}, 403)

    role = principal.get("role", "default") if principal else "default"
    allowed, req_count, req_limit = await rate_limiter.check_rest(user_id, role)
    if not allowed:
        log_http_usage(endpoint, user_id, 429, start_time, {"reason": "rate_limit", "count": req_count, "limit": req_limit})
        return web.Response(status=429, text=f'Rate limit exceeded: {req_count}/{req_limit} req/min')

    params = _merged_request_params(data, request)
    disk_hit = await _get_disk_cached_response(endpoint, params)
    if disk_hit is not None:
        return _log_and_return(disk_hit, 200, cache_status="DISK_HIT")

    try:
        if provider == "alpaca":
            payload, status = await _execute_alpaca_native_proxy(endpoint, params, api_key, api_secret)
        else:
            payload, status = await _execute_thetadata_value_proxy(endpoint, params)
        if status == 200 and isinstance(payload, (dict, list)):
            await _put_disk_cached_response(endpoint, params, payload)
        return _log_and_return(payload, status)
    except ValueError as e:
        return _log_and_return({"error": str(e)}, 400)
    except asyncio.TimeoutError:
        return _log_and_return({"error": f"{provider} request timed out after {THETADATA_SDK_TIMEOUT_SECONDS:g}s"}, 504)
    except Exception as e:
        print(f"[ProviderProxy] {provider} request failed for {endpoint}: {e}")
        return _log_and_return({"error": f"{provider} request failed: {e}"}, 502)


async def handle_theta_direct_proxy(request):
    return await handle_provider_proxy(request)


async def handle_option_contracts_request(request):
    start_time = time.time()
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    token, api_key, api_secret = _extract_http_request_auth(data, request)
    principal = resolve_http_principal(token, request)
    user_id = principal.get("user_id") if principal else None
    endpoint = "/v1/options/contracts"

    def _log_and_return(payload, status, cache_status="MISS"):
        log_http_usage(endpoint, user_id, status, start_time)
        return web.Response(body=_fast_dumps_str(payload), status=status, content_type="application/json", headers={"X-Cache": cache_status})

    if not principal:
        return _log_and_return({"error": "Invalid token"}, 401)
    if not allow_rest_endpoint(principal, endpoint):
        return _log_and_return({"error": "Forbidden"}, 403)

    role = principal.get("role", "default") if principal else "default"
    allowed, req_count, req_limit = await rate_limiter.check_rest(user_id, role)
    if not allowed:
        log_http_usage(endpoint, user_id, 429, start_time, {"reason": "rate_limit", "count": req_count, "limit": req_limit})
        return web.Response(status=429, text=f'Rate limit exceeded: {req_count}/{req_limit} req/min')

    underlying_symbols = data.get("underlying_symbols") or data.get("underlying")
    symbol_or_id = data.get("symbol_or_id") or data.get("symbol")
    expiration_date = data.get("expiration_date")
    expiration_date_gte = data.get("expiration_date_gte")
    expiration_date_lte = data.get("expiration_date_lte")
    strike_price_gte = data.get("strike_price_gte")
    strike_price_lte = data.get("strike_price_lte")
    option_type = data.get("type") or data.get("option_type")
    limit = data.get("limit", 1000)
    provider = str(data.get("provider", "auto")).strip().lower()
    if provider in ("theta", "thetadata"):
        provider = "thetadata"
    if provider not in ("auto", "alpaca", "thetadata"):
        return _log_and_return({"error": "Invalid provider. Use auto, alpaca, or thetadata."}, 400)

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 1000
    limit = max(1, min(limit, 10000))

    if isinstance(underlying_symbols, (list, tuple)):
        underlying_symbols = ",".join(str(item).strip().upper() for item in underlying_symbols if str(item).strip())
    elif isinstance(underlying_symbols, str):
        underlying_symbols = underlying_symbols.strip().upper()

    if isinstance(symbol_or_id, str):
        symbol_or_id = symbol_or_id.strip()

    cache_params = {
        "provider": provider,
        "underlying_symbols": underlying_symbols,
        "symbol_or_id": symbol_or_id,
        "expiration_date": expiration_date,
        "expiration_date_gte": expiration_date_gte,
        "expiration_date_lte": expiration_date_lte,
        "strike_price_gte": strike_price_gte,
        "strike_price_lte": strike_price_lte,
        "type": option_type,
        "limit": limit,
        "date": data.get("date"),
        "request_type": data.get("request_type", "quote"),
        "max_dte": data.get("max_dte"),
    }
    disk_hit = await _get_disk_cached_response(endpoint, cache_params)
    if disk_hit is not None:
        return _log_and_return(disk_hit, 200, cache_status="DISK_HIT")

    if provider == "thetadata":
        if symbol_or_id:
            return _log_and_return({"error": "ThetaData contract fallback only supports underlying_symbols, not symbol_or_id lookup"}, 400)
        if not underlying_symbols:
            return _log_and_return({"error": "Missing required fields"}, 400)
        theta_result = await fetch_theta_option_contracts(
            underlying_symbols,
            date_value=data.get("date"),
            request_type=data.get("request_type", "quote"),
            max_dte=data.get("max_dte"),
            limit=limit,
        )
        if theta_result is None:
            return _log_and_return({"error": "ThetaData not available"}, 503)
        await _put_disk_cached_response(endpoint, cache_params, theta_result)
        return _log_and_return(theta_result, 200)

    if not api_key or not api_secret:
        if provider == "auto" and underlying_symbols and not symbol_or_id:
            theta_result = await fetch_theta_option_contracts(
                underlying_symbols,
                date_value=data.get("date"),
                request_type=data.get("request_type", "quote"),
                max_dte=data.get("max_dte"),
                limit=limit,
            )
            if theta_result is not None:
                await _put_disk_cached_response(endpoint, cache_params, theta_result)
                return _log_and_return(theta_result, 200)
        return _log_and_return({"error": "Cloud missing Alpaca master keys"}, 500)

    if symbol_or_id:
        url = f"{TRADING_URL}/v2/options/contracts/{symbol_or_id}"
        params = {}
    else:
        if not underlying_symbols:
            return _log_and_return({"error": "Missing required fields"}, 400)
        url = f"{TRADING_URL}/v2/options/contracts"
        params = {
            "underlying_symbols": underlying_symbols,
            "limit": limit,
        }
        if expiration_date:
            params["expiration_date"] = expiration_date
        if expiration_date_gte:
            params["expiration_date_gte"] = expiration_date_gte
        if expiration_date_lte:
            params["expiration_date_lte"] = expiration_date_lte
        if strike_price_gte is not None:
            params["strike_price_gte"] = strike_price_gte
        if strike_price_lte is not None:
            params["strike_price_lte"] = strike_price_lte
        if option_type:
            params["type"] = option_type

    headers = {
        "APCA-API-KEY-ID": api_key,
        "APCA-API-SECRET-KEY": api_secret,
        "Accept": "application/json",
    }

    print(f"[Cloud] Options contracts request: {underlying_symbols or symbol_or_id}")

    session = await get_http_session()
    async with session.get(url, params=params, headers=headers) as resp:
        if resp.status != 200:
            error_text = await resp.text()
            print(f"[Cloud] Options contracts error {resp.status}: {error_text[:200]}")
            if provider == "auto" and underlying_symbols and not symbol_or_id:
                theta_result = await fetch_theta_option_contracts(
                    underlying_symbols,
                    date_value=data.get("date"),
                    request_type=data.get("request_type", "quote"),
                    max_dte=data.get("max_dte"),
                    limit=limit,
                )
                if theta_result is not None:
                    await _put_disk_cached_response(endpoint, cache_params, theta_result)
                    return _log_and_return(theta_result, 200)
            return _log_and_return({"error": f"Alpaca returned {resp.status}", "details": error_text}, resp.status)
        result = await resp.json()
        if isinstance(result, dict):
            result.setdefault("source", "alpaca")
        await _put_disk_cached_response(endpoint, cache_params, result)
        return _log_and_return(result, 200)


def format_theta_timestamp(date_val, ms_val):
    if not date_val:
        import datetime
        return datetime.datetime.utcnow().isoformat() + "Z"
    try:
        import datetime
        date_str = str(int(date_val)) # YYYYMMDD
        ms = int(ms_val or 0)
        seconds = ms // 1000
        ms_remainder = ms % 1000
        dt = datetime.datetime.strptime(date_str, "%Y%m%d") + datetime.timedelta(seconds=seconds, milliseconds=ms_remainder)
        return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    except Exception:
        import datetime
        return datetime.datetime.utcnow().isoformat() + "Z"


async def query_theta_snapshot_single(client, symbol, subcommand):
    parsed = _parse_occ_symbol_theta(symbol)
    if not parsed:
        return symbol, {"error": "Invalid OCC symbol format"}
        
    root, exp_str, right, strike_dollars = parsed
    import datetime
    try:
        exp_date = datetime.datetime.strptime(exp_str, "%Y%m%d").date()
    except Exception as e:
        return symbol, {"error": f"Invalid expiration format: {e}"}
        
    strike_str = str(strike_dollars)
    loop = asyncio.get_event_loop()
    
    # Helper to fetch OHLC snapshot as fallback (for active contracts on VALUE tier)
    async def get_ohlc_fallback():
        try:
            df = await loop.run_in_executor(
                None,
                lambda: client.option_snapshot_ohlc(symbol=root, expiration=exp_date, strike=strike_str, right=right)
            )
            rows = df.to_dicts() if hasattr(df, "to_dicts") else (df.to_dict(orient="records") if hasattr(df, "to_dict") else [])
            if rows:
                return rows[0]
        except Exception:
            pass
        return None

    # Helper to fetch EOD history as ultimate fallback (works perfectly for expired contracts!)
    async def get_eod_fallback():
        try:
            # Look back 15 days from expiration date to safely capture the last trading day's EOD
            start_d = exp_date - datetime.timedelta(days=15)
            df = await loop.run_in_executor(
                None,
                lambda: client.option_history_eod(symbol=root, expiration=exp_date, strike=strike_str, right=right, start_date=start_d, end_date=exp_date)
            )
            rows = df.to_dicts() if hasattr(df, "to_dicts") else (df.to_dict(orient="records") if hasattr(df, "to_dict") else [])
            if rows:
                return rows[-1]
        except Exception as e:
            print(f"[ThetaData] EOD fallback error for {symbol}: {e}")
        return None
    
    try:
        if subcommand == "ohlc":
            row = None
            try:
                df = await loop.run_in_executor(
                    None,
                    lambda: client.option_snapshot_ohlc(symbol=root, expiration=exp_date, strike=strike_str, right=right)
                )
                rows = df.to_dicts() if hasattr(df, "to_dicts") else (df.to_dict(orient="records") if hasattr(df, "to_dict") else [])
                if rows:
                    row = rows[0]
            except Exception:
                row = await get_eod_fallback()
                if row:
                    row = {
                        "open": row.get("open", 0.0),
                        "high": row.get("high", 0.0),
                        "low": row.get("low", 0.0),
                        "close": row.get("close", 0.0),
                        "volume": row.get("volume", 0),
                        "timestamp": row.get("created") or row.get("date")
                    }
            
            if not row:
                return symbol, {}
                
            ts_val = row.get("timestamp") or row.get("date") or row.get("created")
            t_str = ts_val.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z" if hasattr(ts_val, "strftime") else (str(ts_val) + "T16:00:00.000Z" if ts_val else (datetime.datetime.utcnow().isoformat() + "Z"))
            
            return symbol, {
                "ohlc": {
                    "o": float(row.get("open", 0.0)),
                    "h": float(row.get("high", 0.0)),
                    "l": float(row.get("low", 0.0)),
                    "c": float(row.get("close", 0.0)),
                    "v": int(row.get("volume", 0)),
                    "t": t_str
                }
            }
            
        elif subcommand == "trade":
            row = None
            try:
                df = await loop.run_in_executor(
                    None,
                    lambda: client.option_snapshot_trade(symbol=root, expiration=exp_date, strike=strike_str, right=right)
                )
                rows = df.to_dicts() if hasattr(df, "to_dicts") else (df.to_dict(orient="records") if hasattr(df, "to_dict") else [])
                if rows:
                    row = rows[0]
            except Exception:
                row = await get_ohlc_fallback()
                if row:
                    row = {
                        "price": row.get("close", 0.0),
                        "size": row.get("volume", 0),
                        "exchange": "OHLC_EOD",
                        "timestamp": row.get("timestamp") or row.get("date")
                    }
                else:
                    row = await get_eod_fallback()
                    if row:
                        row = {
                            "price": row.get("close", 0.0),
                            "size": row.get("volume", 0),
                            "exchange": "EOD_HIST",
                            "timestamp": row.get("created") or row.get("date")
                        }
            
            if not row:
                return symbol, {}
            
            ts_val = row.get("timestamp") or row.get("date") or row.get("created")
            t_str = ts_val.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z" if hasattr(ts_val, "strftime") else (str(ts_val) + "T16:00:00.000Z" if ts_val else (datetime.datetime.utcnow().isoformat() + "Z"))
            
            return symbol, {
                "latestTrade": {
                    "p": float(row.get("price", 0.0)),
                    "s": int(row.get("size", 0)),
                    "x": str(row.get("exchange", "")),
                    "t": t_str
                }
            }
            
        elif subcommand == "quote":
            row = None
            try:
                df = await loop.run_in_executor(
                    None,
                    lambda: client.option_snapshot_quote(symbol=root, expiration=exp_date, strike=strike_str, right=right)
                )
                rows = df.to_dicts() if hasattr(df, "to_dicts") else (df.to_dict(orient="records") if hasattr(df, "to_dict") else [])
                if rows:
                    row = rows[0]
            except Exception:
                row = await get_ohlc_fallback()
                if row:
                    row = {
                        "ask": row.get("close", 0.0),
                        "ask_size": 1,
                        "ask_exchange": "OHLC_EOD",
                        "bid": row.get("close", 0.0),
                        "bid_size": 1,
                        "bid_exchange": "OHLC_EOD",
                        "timestamp": row.get("timestamp") or row.get("date")
                    }
                else:
                    row = await get_eod_fallback()
                    if row:
                        row = {
                            "ask": row.get("ask", row.get("close", 0.0)),
                            "ask_size": row.get("ask_size", 1),
                            "ask_exchange": str(row.get("ask_exchange", "EOD_HIST")),
                            "bid": row.get("bid", row.get("close", 0.0)),
                            "bid_size": row.get("bid_size", 1),
                            "bid_exchange": str(row.get("bid_exchange", "EOD_HIST")),
                            "timestamp": row.get("created") or row.get("date")
                        }
            
            if not row:
                return symbol, {}
            
            ts_val = row.get("timestamp") or row.get("date") or row.get("created")
            t_str = ts_val.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z" if hasattr(ts_val, "strftime") else (str(ts_val) + "T16:00:00.000Z" if ts_val else (datetime.datetime.utcnow().isoformat() + "Z"))
            
            return symbol, {
                "latestQuote": {
                    "ap": float(row.get("ask", 0.0)),
                    "as": int(row.get("ask_size", 0)),
                    "ax": str(row.get("ask_exchange", "")),
                    "bp": float(row.get("bid", 0.0)),
                    "bs": int(row.get("bid_size", 0)),
                    "bx": str(row.get("bid_exchange", "")),
                    "t": t_str
                }
            }
            
        elif subcommand == "market_value":
            row = None
            try:
                df = await loop.run_in_executor(
                    None,
                    lambda: client.option_snapshot_market_value(symbol=root, expiration=exp_date, strike=strike_str, right=right)
                )
                rows = df.to_dicts() if hasattr(df, "to_dicts") else (df.to_dict(orient="records") if hasattr(df, "to_dict") else [])
                if rows:
                    row = rows[0]
            except Exception:
                row = await get_ohlc_fallback()
                if row:
                    row = {
                        "market_value": row.get("close", 0.0),
                        "timestamp": row.get("timestamp") or row.get("date")
                    }
                else:
                    row = await get_eod_fallback()
                    if row:
                        row = {
                            "market_value": row.get("close", 0.0),
                            "timestamp": row.get("created") or row.get("date")
                        }
            
            if not row:
                return symbol, {}
            
            ts_val = row.get("timestamp") or row.get("date") or row.get("created")
            t_str = ts_val.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z" if hasattr(ts_val, "strftime") else (str(ts_val) + "T16:00:00.000Z" if ts_val else (datetime.datetime.utcnow().isoformat() + "Z"))
            
            return symbol, {
                "marketValue": {
                    "value": float(row.get("market_value", 0.0)),
                    "t": t_str
                }
            }
            
        elif subcommand == "open_interest":
            row = None
            try:
                df = await loop.run_in_executor(
                    None,
                    lambda: client.option_snapshot_open_interest(symbol=root, expiration=exp_date, strike=strike_str, right=right)
                )
                rows = df.to_dicts() if hasattr(df, "to_dicts") else (df.to_dict(orient="records") if hasattr(df, "to_dict") else [])
                if rows:
                    row = rows[0]
            except Exception:
                row = await get_eod_fallback()
                if row:
                    row = {
                        "open_interest": row.get("open_interest", 0),
                        "timestamp": row.get("created") or row.get("date")
                    }
                    
            if not row:
                return symbol, {}
                
            ts_val = row.get("timestamp") or row.get("date") or row.get("created")
            t_str = ts_val.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z" if hasattr(ts_val, "strftime") else (str(ts_val) + "T16:00:00.000Z" if ts_val else (datetime.datetime.utcnow().isoformat() + "Z"))
            
            return symbol, {
                "openInterest": {
                    "oi": int(row.get("open_interest", 0)),
                    "t": t_str
                }
            }
            
        else: # default combined
            res = {}
            has_data = False
            
            # Query quote
            try:
                df_quote = await loop.run_in_executor(
                    None,
                    lambda: client.option_snapshot_quote(symbol=root, expiration=exp_date, strike=strike_str, right=right)
                )
                rows_quote = df_quote.to_dicts() if hasattr(df_quote, "to_dicts") else (df_quote.to_dict(orient="records") if hasattr(df_quote, "to_dict") else [])
                if rows_quote:
                    row = rows_quote[0]
                    ts_val = row.get("timestamp") or row.get("date")
                    t_str = ts_val.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z" if hasattr(ts_val, "strftime") else (datetime.datetime.utcnow().isoformat() + "Z")
                    res["latestQuote"] = {
                        "ap": float(row.get("ask", 0.0)),
                        "as": int(row.get("ask_size", 0)),
                        "ax": str(row.get("ask_exchange", "")),
                        "bp": float(row.get("bid", 0.0)),
                        "bs": int(row.get("bid_size", 0)),
                        "bx": str(row.get("bid_exchange", "")),
                        "t": t_str
                    }
                    has_data = True
            except Exception:
                pass
            
            # Query trade
            try:
                df_trade = await loop.run_in_executor(
                    None,
                    lambda: client.option_snapshot_trade(symbol=root, expiration=exp_date, strike=strike_str, right=right)
                )
                rows_trade = df_trade.to_dicts() if hasattr(df_trade, "to_dicts") else (df_trade.to_dict(orient="records") if hasattr(df_trade, "to_dict") else [])
                if rows_trade:
                    row = rows_trade[0]
                    ts_val = row.get("timestamp") or row.get("date")
                    t_str = ts_val.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z" if hasattr(ts_val, "strftime") else (datetime.datetime.utcnow().isoformat() + "Z")
                    res["latestTrade"] = {
                        "p": float(row.get("price", 0.0)),
                        "s": int(row.get("size", 0)),
                        "x": str(row.get("exchange", "")),
                        "t": t_str
                    }
                    has_data = True
            except Exception:
                pass
                
            # If both failed (VALUE subscription or expired contract), try OHLC fallback
            if not has_data:
                row = await get_ohlc_fallback()
                if row:
                    ts_val = row.get("timestamp") or row.get("date")
                    t_str = ts_val.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z" if hasattr(ts_val, "strftime") else (datetime.datetime.utcnow().isoformat() + "Z")
                    close_price = float(row.get("close", 0.0))
                    volume = int(row.get("volume", 0))
                    
                    res["latestQuote"] = {
                        "ap": close_price,
                        "as": 1,
                        "ax": "OHLC_EOD",
                        "bp": close_price,
                        "bs": 1,
                        "bx": "OHLC_EOD",
                        "t": t_str
                    }
                    res["latestTrade"] = {
                        "p": close_price,
                        "s": volume,
                        "x": "OHLC_EOD",
                        "t": t_str
                    }
                    has_data = True
            
            # If OHLC fallback also failed/empty (expired contract), fall back to EOD daily history
            if not has_data:
                row = await get_eod_fallback()
                if row:
                    ts_val = row.get("created") or row.get("date")
                    t_str = ts_val.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z" if hasattr(ts_val, "strftime") else (str(ts_val) + "T16:00:00.000Z" if ts_val else (datetime.datetime.utcnow().isoformat() + "Z"))
                    close_price = float(row.get("close", 0.0))
                    volume = int(row.get("volume", 0))
                    
                    res["latestQuote"] = {
                        "ap": float(row.get("ask", close_price)),
                        "as": int(row.get("ask_size", 1)),
                        "ax": str(row.get("ask_exchange", "EOD_HIST")),
                        "bp": float(row.get("bid", close_price)),
                        "bs": int(row.get("bid_size", 1)),
                        "bx": str(row.get("bid_exchange", "EOD_HIST")),
                        "t": t_str
                    }
                    res["latestTrade"] = {
                        "p": close_price,
                        "s": volume,
                        "x": "EOD_HIST",
                        "t": t_str
                    }
            return symbol, res
            
    except Exception as e:
        print(f"[ThetaData] Snapshot query error for {symbol}: {e}")
        if "session" in str(e).lower() or "unauthenticated" in str(e).lower() or "rpc" in str(e).lower():
            global theta_client
            theta_client = None
        return symbol, {"error": str(e)}


def _normalize_option_symbols(value):
    if isinstance(value, (list, tuple)):
        symbol_list = [str(item).strip().upper() for item in value if str(item).strip()]
    elif isinstance(value, str):
        symbol_list = [item.strip().upper() for item in value.split(",") if item.strip()]
    else:
        symbol_list = []
    return symbol_list, ",".join(symbol_list)


async def _fetch_alpaca_option_latest_snapshot(symbols: str, feed: str, api_key: str, api_secret: str, subcommand: str):
    resource = "quotes" if subcommand == "quote" else "trades"
    field = "latestQuote" if subcommand == "quote" else "latestTrade"
    if not api_key or not api_secret:
        return {}, True, 500, "Cloud missing Alpaca master keys"

    headers = {
        "APCA-API-KEY-ID": api_key,
        "APCA-API-SECRET-KEY": api_secret,
        "Accept": "application/json",
    }
    params = {"symbols": symbols, "feed": feed}
    url = f"{DATA_URL}/v1beta1/options/{resource}/latest"

    session = await get_http_session()
    async with session.get(url, params=params, headers=headers) as resp:
        if resp.status != 200:
            return {}, True, resp.status, await resp.text()
        payload = await resp.json()

    records = payload.get(resource) or {}
    if not isinstance(records, dict):
        return {}, False, 200, ""
    return {sym: {field: value} for sym, value in records.items() if value}, False, 200, ""


async def handle_option_snapshots_request(request):
    start_time = time.time()
    if request.method == "GET":
        data = dict(request.rel_url.query)
    else:
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON"}, status=400)

    token, api_key, api_secret = _extract_http_request_auth(data, request)
    principal = resolve_http_principal(token, request)
    user_id = principal.get("user_id") if principal else None
    
    endpoint = request.path
    path_lower = endpoint.lower()
    
    subcommand = "default"
    if "/ohlc" in path_lower:
        subcommand = "ohlc"
    elif "/trade" in path_lower:
        subcommand = "trade"
    elif "/quote" in path_lower:
        subcommand = "quote"
    elif "/market_value" in path_lower:
        subcommand = "market_value"
    elif "/open_interest" in path_lower:
        subcommand = "open_interest"

    def _log_and_return(payload, status, cache_status="MISS"):
        log_http_usage(endpoint, user_id, status, start_time)
        return web.Response(body=_fast_dumps_str(payload), status=status, content_type="application/json", headers={"X-Cache": cache_status})

    if not principal:
        return _log_and_return({"error": "Invalid token"}, 401)
    if not allow_rest_endpoint(principal, "/v1/options/snapshots"):
        return _log_and_return({"error": "Forbidden"}, 403)

    role = principal.get("role", "default") if principal else "default"
    allowed, req_count, req_limit = await rate_limiter.check_rest(user_id, role)
    if not allowed:
        log_http_usage(endpoint, user_id, 429, start_time, {"reason": "rate_limit", "count": req_count, "limit": req_limit})
        return web.Response(status=429, text=f'Rate limit exceeded: {req_count}/{req_limit} req/min')

    symbols = data.get("symbols") or data.get("symbol")
    feed = data.get("feed", OPTIONS_FEED)
    limit = data.get("limit", 100)

    symbol_list_str, symbols = _normalize_option_symbols(symbols)

    if not symbols:
        return _log_and_return({"error": "Missing required fields"}, 400)

    cache_params = {
        "symbols": symbols,
        "feed": feed,
        "limit": limit,
        "subcommand": subcommand,
    }

    # 1. Check Tier 1 In-Memory Cache first
    cache_key = f"options_snapshots:{symbols}:{feed}:{limit}:{subcommand}"
    redis_conn = await get_redis_client()
    if redis_conn is not None:
        cached = await redis_conn.get(cache_key)
        if cached:
            return respond_cached_raw(cached, endpoint, user_id, start_time)

    # 2. Check Tier 2 Disk Cache
    disk_hit = await _get_disk_cached_response(endpoint, cache_params)
    if disk_hit is not None:
        if redis_conn is not None:
            await redis_conn.set(cache_key, _fast_dumps_str(disk_hit))
        return _log_and_return(disk_hit, 200, cache_status="DISK_HIT")

    if str(feed).strip().lower() == "thetadata":
        client = await get_theta_client()
        if client is None:
            return _log_and_return({"error": "ThetaData client is not initialized or disabled"}, 500)
            
        print(f"[Cloud] Routing options snapshots to ThetaData: {symbols} subcommand={subcommand}")
        try:
            tasks = [query_theta_snapshot_single(client, sym, subcommand) for sym in symbol_list_str]
            results = await asyncio.gather(*tasks)
            snapshots = {sym: res for sym, res in results if res}
            payload = {"snapshots": snapshots}
            await _put_disk_cached_response(endpoint, cache_params, payload)
            if redis_conn is not None:
                await redis_conn.set(cache_key, json.dumps(payload))
            return _log_and_return(payload, 200)
        except Exception as e:
            print(f"[Cloud] ThetaData options snapshots unhandled error: {e}")
            return _log_and_return({"error": "ThetaData query failed", "details": str(e)}, 500)

    # Try querying Alpaca first
    alpaca_snapshots = {}
    alpaca_failed = False
    alpaca_error_status = 200
    alpaca_error_text = ""

    if not api_key or not api_secret:
        print("[Cloud] Missing Alpaca master keys, marking Alpaca as failed for fallback")
        alpaca_failed = True
        alpaca_error_status = 500
        alpaca_error_text = "Cloud missing Alpaca master keys"
    else:
        try:
            try:
                limit = int(limit)
            except (TypeError, ValueError):
                limit = 100
            limit = max(1, min(limit, 1000))

            if subcommand in ("quote", "trade"):
                print(f"[Cloud] Alpaca options latest {subcommand} request: {symbols} feed={feed}")
                alpaca_snapshots, alpaca_failed, alpaca_error_status, alpaca_error_text = await _fetch_alpaca_option_latest_snapshot(
                    symbols, feed, api_key, api_secret, subcommand
                )
                if alpaca_failed:
                    print(f"[Cloud] Alpaca options latest {subcommand} error {alpaca_error_status}: {alpaca_error_text[:200]}")
            else:
                headers = {
                    "APCA-API-KEY-ID": api_key,
                    "APCA-API-SECRET-KEY": api_secret,
                    "Accept": "application/json",
                }
                url = f"{DATA_URL}/v1beta1/options/snapshots"
                params = {
                    "symbols": symbols,
                    "feed": feed,
                    "limit": limit,
                }

                print(f"[Cloud] Alpaca options snapshots request: {symbols} feed={feed}")
                session = await get_http_session()
                async with session.get(url, params=params, headers=headers) as resp:
                    if resp.status != 200:
                        alpaca_failed = True
                        alpaca_error_status = resp.status
                        alpaca_error_text = await resp.text()
                        print(f"[Cloud] Alpaca options snapshots error {resp.status}: {alpaca_error_text[:200]}")
                    else:
                        result = await resp.json()
                        alpaca_snapshots = result.get("snapshots") or {}
                        if not isinstance(alpaca_snapshots, dict):
                            alpaca_snapshots = {}
        except Exception as e:
            alpaca_failed = True
            alpaca_error_status = 500
            alpaca_error_text = str(e)
            print(f"[Cloud] Alpaca options snapshots exception: {e}")

    # Determine missing symbols
    if alpaca_failed:
        missing_symbols = symbol_list_str
    else:
        missing_symbols = [sym for sym in symbol_list_str if sym not in alpaca_snapshots]

    # Fallback to ThetaData for missing symbols
    if missing_symbols:
        print(f"[Cloud] Option snapshots missing or failed for {missing_symbols}. Falling back to ThetaData...")
        client = await get_theta_client()
        if client is not None:
            try:
                tasks = [query_theta_snapshot_single(client, sym, subcommand) for sym in missing_symbols]
                results = await asyncio.gather(*tasks)
                for sym, res in results:
                    if res and "error" not in res:
                        alpaca_snapshots[sym] = res
            except Exception as e:
                print(f"[Cloud] ThetaData fallback options snapshots error: {e}")

    # If Alpaca failed completely and we couldn't get any snapshots from ThetaData either, return the original Alpaca error
    if alpaca_failed and not alpaca_snapshots:
        return _log_and_return({"error": f"Alpaca returned {alpaca_error_status}", "details": alpaca_error_text}, alpaca_error_status)

    # Return merged/successful snapshots
    payload = {"snapshots": alpaca_snapshots}
    await _put_disk_cached_response(endpoint, cache_params, payload)
    if redis_conn is not None:
        await redis_conn.set(cache_key, json.dumps(payload))
    return _log_and_return(payload, 200)


async def handle_crypto_latest_orderbooks_request(request):
    start_time = time.time()
    if request.method == "GET":
        data = dict(request.rel_url.query)
    else:
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON"}, status=400)

    token, api_key, api_secret = _extract_http_request_auth(data, request)
    principal = resolve_http_principal(token, request)
    user_id = principal.get("user_id") if principal else None
    endpoint = "/v1/crypto/us/latest/orderbooks"

    def _log_and_return(payload, status, cache_status="MISS"):
        log_http_usage(endpoint, user_id, status, start_time)
        return web.Response(body=_fast_dumps_str(payload), status=status, content_type="application/json", headers={"X-Cache": cache_status})

    if not principal:
        return _log_and_return({"error": "Invalid token"}, 401)
    if not allow_rest_endpoint(principal, endpoint):
        return _log_and_return({"error": "Forbidden"}, 403)

    role = principal.get("role", "default") if principal else "default"
    allowed, req_count, req_limit = await rate_limiter.check_rest(user_id, role)
    if not allowed:
        log_http_usage(endpoint, user_id, 429, start_time, {"reason": "rate_limit", "count": req_count, "limit": req_limit})
        return web.Response(status=429, text=f'Rate limit exceeded: {req_count}/{req_limit} req/min')

    symbols = data.get("symbols") or data.get("symbol")
    if isinstance(symbols, (list, tuple)):
        symbols = ",".join(str(item).strip().upper() for item in symbols if str(item).strip())
    elif isinstance(symbols, str):
        symbols = symbols.strip().upper()

    if not api_key or not api_secret or not symbols:
        return _log_and_return({"error": "Missing required fields"}, 400)

    headers = {
        "APCA-API-KEY-ID": api_key,
        "APCA-API-SECRET-KEY": api_secret,
        "Accept": "application/json",
    }
    url = f"{DATA_URL}/v1beta3/crypto/us/latest/orderbooks"
    params = {"symbols": symbols}

    print(f"[Cloud] Crypto orderbooks request: {symbols}")

    session = await get_http_session()
    async with session.get(url, params=params, headers=headers) as resp:
        if resp.status != 200:
            error_text = await resp.text()
            print(f"[Cloud] Crypto orderbooks error {resp.status}: {error_text[:200]}")
            return _log_and_return({"error": f"Alpaca returned {resp.status}", "details": error_text}, resp.status)
        result = await resp.json()
        return _log_and_return(result, 200)


async def handle_option_snapshots_by_expiry_request(request):
    """Return all option snapshots for an underlying + expiry date (all strikes, calls+puts)."""
    start_time = time.time()
    if request.method == "GET":
        data = dict(request.rel_url.query)
    else:
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON"}, status=400)

    token, api_key, api_secret = _extract_http_request_auth(data, request)

    principal = resolve_http_principal(token, request)
    user_id = principal.get("user_id") if principal else None
    endpoint = "/v1/options/snapshots/expiry"

    def _log_and_return(payload, status, cache_status="MISS"):
        log_http_usage(endpoint, user_id, status, start_time)
        return web.Response(body=_fast_dumps_str(payload), status=status, content_type="application/json", headers={"X-Cache": cache_status})

    if not principal:
        return _log_and_return({"error": "Invalid token"}, 401)
    if not allow_rest_endpoint(principal, endpoint):
        return _log_and_return({"error": "Forbidden"}, 403)

    role = principal.get("role", "default") if principal else "default"
    allowed, req_count, req_limit = await rate_limiter.check_rest(user_id, role)
    if not allowed:
        log_http_usage(endpoint, user_id, 429, start_time, {"reason": "rate_limit", "count": req_count, "limit": req_limit})
        return web.Response(status=429, text=f'Rate limit exceeded: {req_count}/{req_limit} req/min')

    underlying = data.get("underlying")
    expiry = data.get("expiry")
    feed = data.get("feed", OPTIONS_FEED)
    if not underlying or not expiry:
        return _log_and_return({"error": "Missing required fields"}, 400)

    if not api_key or not api_secret:
        return _log_and_return({"error": "Cloud missing Alpaca master keys"}, 500)

    # Memory-only short-TTL cache: live snapshots, no disk archive
    cache_key = f"snap_expiry:{underlying}:{expiry}:{feed}"
    redis_conn = await get_redis_client()
    if redis_conn is not None:
        cached = await redis_conn.get(cache_key)
        if cached:
            return respond_cached_raw(cached, endpoint, user_id, start_time)

    headers = {
        "APCA-API-KEY-ID": api_key,
        "APCA-API-SECRET-KEY": api_secret,
        "Accept": "application/json"
    }

    contracts_url = f"{TRADING_URL}/v2/options/contracts"
    contracts_params = {
        "underlying_symbols": underlying,
        "expiration_date": expiry,
        "limit": 1000
    }

    print(f"[Cloud] Options snapshots by expiry: {underlying} exp={expiry}")

    session = await get_http_session()
    async with session.get(contracts_url, params=contracts_params, headers=headers) as resp:
        if resp.status != 200:
            error_text = await resp.text()
            print(f"[Cloud] Options contracts error {resp.status}: {error_text[:200]}")
            return _log_and_return({"error": f"Alpaca returned {resp.status}", "details": error_text}, resp.status)
        contracts_resp = await resp.json()

    contracts = contracts_resp.get("option_contracts") or []
    symbols = [c.get("symbol") for c in contracts if c.get("symbol")]
    if not symbols:
        return _log_and_return({"contracts": [], "snapshots": {}, "count": 0}, 200)

    snapshots = {}
    batch_size = 100
    snapshots_url = f"{DATA_URL}/v1beta1/options/snapshots"
    for i in range(0, len(symbols), batch_size):
        batch = symbols[i:i + batch_size]
        params = {
            "symbols": ",".join(batch),
            "feed": feed,
        }
        async with session.get(snapshots_url, params=params, headers=headers) as resp:
            if resp.status != 200:
                error_text = await resp.text()
                print(f"[Cloud] Options snapshots error {resp.status}: {error_text[:200]}")
                return _log_and_return({"error": f"Alpaca returned {resp.status}", "details": error_text}, resp.status)
            snap_resp = await resp.json()
            snap_map = snap_resp.get("snapshots") or snap_resp
            if isinstance(snap_map, dict):
                snapshots.update(snap_map)

    response_payload = {"contracts": contracts, "snapshots": snapshots, "count": len(contracts)}
    if redis_conn is not None:
        await redis_conn.set(cache_key, json.dumps(response_payload))  # default TTL (300s)
    return _log_and_return(response_payload, 200)


async def handle_option_snapshots_underlying_request(request):
    """Return all option snapshots for an underlying symbol (entire option chain)."""
    start_time = time.time()
    underlying = request.match_info.get("underlying_symbol", "").upper().strip()
    if not underlying:
        return web.json_response({"error": "Missing underlying symbol"}, status=400)

    try:
        if request.method == "POST":
            data = await request.json()
        else:
            data = dict(request.rel_url.query)
    except Exception:
        data = {}

    token, api_key, api_secret = _extract_http_request_auth(data, request)
    principal = resolve_http_principal(token, request)
    user_id = principal.get("user_id") if principal else None

    endpoint = f"/v1/options/snapshots/{underlying}"

    def _log_and_return(payload, status, cache_status="MISS"):
        log_http_usage(endpoint, user_id, status, start_time)
        return web.Response(body=_fast_dumps_str(payload), status=status, content_type="application/json", headers={"X-Cache": cache_status})

    if not principal:
        return _log_and_return({"error": "Invalid token"}, 401)
    if not allow_rest_endpoint(principal, "/v1/options/snapshots"):
        return _log_and_return({"error": "Forbidden"}, 403)

    role = principal.get("role", "default") if principal else "default"
    allowed, req_count, req_limit = await rate_limiter.check_rest(user_id, role)
    if not allowed:
        log_http_usage(endpoint, user_id, 429, start_time, {"reason": "rate_limit", "count": req_count, "limit": req_limit})
        return web.Response(status=429, text=f'Rate limit exceeded: {req_count}/{req_limit} req/min')

    feed = data.get("feed") or request.query.get("feed") or OPTIONS_FEED

    # Memory-only short-TTL cache: live chain snapshot, no disk archive
    cache_key = f"snap_chain:{underlying}:{feed}"
    redis_conn = await get_redis_client()
    if redis_conn is not None:
        cached = await redis_conn.get(cache_key)
        if cached:
            return respond_cached_raw(cached, endpoint, user_id, start_time)

    # First, try querying Alpaca for the option chain snapshot
    alpaca_snapshots = {}
    alpaca_failed = False
    alpaca_error_status = 200
    alpaca_error_text = ""

    if not api_key or not api_secret:
        print("[Cloud] Missing Alpaca master keys for underlying option chain snapshot, falling back")
        alpaca_failed = True
        alpaca_error_status = 500
        alpaca_error_text = "Cloud missing Alpaca master keys"
    else:
        try:
            headers = {
                "APCA-API-KEY-ID": api_key,
                "APCA-API-SECRET-KEY": api_secret,
                "Accept": "application/json",
            }
            # Alpaca's endpoint is GET /v1beta1/options/snapshots/{underlying_symbol}
            url = f"{DATA_URL}/v1beta1/options/snapshots/{underlying}"
            params = {
                "feed": feed,
            }
            print(f"[Cloud] Alpaca option chain snapshots request for {underlying} feed={feed}")
            session = await get_http_session()
            async with session.get(url, params=params, headers=headers) as resp:
                if resp.status != 200:
                    alpaca_failed = True
                    alpaca_error_status = resp.status
                    alpaca_error_text = await resp.text()
                    print(f"[Cloud] Alpaca option chain snapshots error {resp.status}: {alpaca_error_text[:200]}")
                else:
                    result = await resp.json()
                    alpaca_snapshots = result.get("snapshots") or {}
                    if not isinstance(alpaca_snapshots, dict):
                        alpaca_snapshots = {}
        except Exception as e:
            alpaca_failed = True
            alpaca_error_status = 500
            alpaca_error_text = str(e)
            print(f"[Cloud] Alpaca option chain snapshots exception: {e}")

    # Fallback to ThetaData if Alpaca failed or returned empty chain
    if alpaca_failed or not alpaca_snapshots:
        print(f"[Cloud] Alpaca option chain snapshot failed/empty for {underlying}. Falling back to ThetaData...")
        # Get active contract list from ThetaData
        try:
            # We fetch up to 150 contracts for a full option chain snapshot
            occ_symbols = await fetch_option_chain_for_symbol(underlying, limit=150)
            if occ_symbols:
                print(f"[Cloud] Found {len(occ_symbols)} contracts for {underlying} from ThetaData. Fetching snapshots...")
                client = await get_theta_client()
                if client is not None:
                    # Fetch snapshots in parallel for each contract from ThetaData
                    tasks = [query_theta_snapshot_single(client, sym, "default") for sym in occ_symbols]
                    results = await asyncio.gather(*tasks)
                    theta_snapshots = {}
                    for sym, res in results:
                        if res and "error" not in res:
                            theta_snapshots[sym] = res
                    
                    if theta_snapshots:
                        alpaca_snapshots = theta_snapshots
                        alpaca_failed = False  # We successfully retrieved the chain via ThetaData fallback!
        except Exception as e:
            print(f"[Cloud] ThetaData fallback option chain snapshots error: {e}")

    if alpaca_failed:
        return _log_and_return({"error": f"Alpaca returned {alpaca_error_status}", "details": alpaca_error_text}, alpaca_error_status)

    response_payload = {"snapshots": alpaca_snapshots}
    if redis_conn is not None:
        await redis_conn.set(cache_key, json.dumps(response_payload))  # default TTL (300s)
    return _log_and_return(response_payload, 200)


async def handle_news_history_request(request):
    start_time = time.time()
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    token, api_key, api_secret = _extract_http_request_auth(data, request)
    principal = resolve_http_principal(token, request)
    user_id = principal.get("user_id") if principal else None
    endpoint = "/v1/history/news"

    def _log_and_return(payload, status, cache_status="MISS"):
        log_http_usage(endpoint, user_id, status, start_time, {"symbols": data.get("symbols") or data.get("symbol"), "limit": data.get("limit")})
        return web.Response(body=_fast_dumps_str(payload), status=status, content_type="application/json", headers={"X-Cache": cache_status})

    if not principal:
        return _log_and_return({"error": "Invalid token"}, 401)
    if not allow_rest_endpoint(principal, endpoint):
        return _log_and_return({"error": "Forbidden"}, 403)

    role = principal.get("role", "default") if principal else "default"
    allowed, req_count, req_limit = await rate_limiter.check_rest(user_id, role)
    if not allowed:
        log_http_usage(endpoint, user_id, 429, start_time, {"reason": "rate_limit", "count": req_count, "limit": req_limit})
        return web.Response(status=429, text=f'Rate limit exceeded: {req_count}/{req_limit} req/min')
    if not api_key or not api_secret:
        return _log_and_return({"error": "Cloud missing Alpaca master keys"}, 500)

    symbols = data.get("symbols") or data.get("symbol")
    start = data.get("start")
    end = data.get("end")
    limit = data.get("limit", 50)
    sort = data.get("sort", "asc")
    include_content = data.get("include_content")
    exclude_contentless = data.get("exclude_contentless")
    page_token = data.get("page_token")
    max_pages = data.get("max_pages", 1)

    if isinstance(symbols, (list, tuple)):
        symbols = ",".join(str(item).strip().upper() for item in symbols if str(item).strip())
    elif isinstance(symbols, str):
        symbols = symbols.strip().upper()

    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 50
    limit = max(1, min(limit, 50))

    try:
        max_pages = int(max_pages)
    except (TypeError, ValueError):
        max_pages = 1
    max_pages = max(1, min(max_pages, 100))

    cache_params = {
        "symbols": symbols or "",
        "start": start or "",
        "end": end or "",
        "limit": limit,
        "sort": sort,
        "include_content": include_content,
        "exclude_contentless": exclude_contentless,
        "page_token": page_token or "",
        "max_pages": max_pages,
    }
    cache_key = f"news:{symbols or '*'}:{start}:{end}:{limit}:{sort}:{page_token or ''}:{max_pages}"
    redis_conn = await get_redis_client()
    if redis_conn is not None:
        cached = await redis_conn.get(cache_key)
        if cached:
            return respond_cached_raw(cached, endpoint, user_id, start_time)
    disk_hit = await _get_disk_cached_response(endpoint, cache_params)
    if disk_hit is not None:
        if redis_conn is not None:
            await redis_conn.set(cache_key, _fast_dumps_str(disk_hit), ex=CACHE_TTL_SECONDS)
        return _log_and_return(disk_hit, 200, cache_status="DISK_HIT")

    headers = {
        "APCA-API-KEY-ID": api_key,
        "APCA-API-SECRET-KEY": api_secret,
        "Accept": "application/json",
    }
    params = {
        "limit": limit,
        "sort": sort,
    }
    if symbols:
        params["symbols"] = symbols
    if start:
        params["start"] = start
    if end:
        params["end"] = end
    if include_content is not None:
        params["include_content"] = str(include_content).lower() if isinstance(include_content, bool) else include_content
    if exclude_contentless is not None:
        params["exclude_contentless"] = str(exclude_contentless).lower() if isinstance(exclude_contentless, bool) else exclude_contentless
    if page_token:
        params["page_token"] = page_token

    url = f"{DATA_URL}/v1beta1/news"
    print(f"[Cloud] News history request: symbols={symbols or '*'} start={start} end={end} limit={limit} max_pages={max_pages}")

    session = await get_http_session()
    all_news = []
    next_page_token = page_token
    pages = 0
    while True:
        if next_page_token:
            params["page_token"] = next_page_token
        elif "page_token" in params:
            del params["page_token"]
        async with session.get(url, params=params, headers=headers) as resp:
            if resp.status != 200:
                error_text = await resp.text()
                print(f"[Cloud] News history error {resp.status}: {error_text[:200]}")
                return _log_and_return({"error": f"Alpaca returned {resp.status}", "details": error_text}, resp.status)
            result = await resp.json()
            news_items = result.get("news") or []
            if isinstance(news_items, list):
                all_news.extend(news_items)
            next_page_token = result.get("next_page_token")
            pages += 1
            if not next_page_token or pages >= max_pages:
                break

    response_payload = {"news": all_news, "pages": pages}
    if next_page_token:
        response_payload["next_page_token"] = next_page_token

    if redis_conn is not None:
        await redis_conn.set(cache_key, _fast_dumps_str(response_payload), ex=CACHE_TTL_SECONDS)
    await _put_disk_cached_response(endpoint, cache_params, response_payload)
    return _log_and_return(response_payload, 200)


async def handle_token_lookup_request(request):
    start_time = time.time()
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    wechat_id = data.get("wechat_id") or data.get("user_id") or data.get("name")
    if not wechat_id:
        return web.json_response({"error": "Missing required fields"}, status=400)
    wechat_id = str(wechat_id).strip()
    if not wechat_id:
        return web.json_response({"error": "Missing required fields"}, status=400)

    create_missing = data.get("create_missing", True)
    if isinstance(create_missing, str):
        create_missing = create_missing.strip().lower() not in ("0", "false", "no", "n")

    endpoint = "/v1/admin/token/lookup"

    def _log_and_return(payload, status, cache_status="MISS"):
        log_http_usage(endpoint, wechat_id, status, start_time, {"created": bool(payload.get("created")) if isinstance(payload, dict) else False})
        return web.Response(body=_fast_dumps_str(payload), status=status, content_type="application/json", headers={"X-Cache": cache_status})

    token = find_token_for_user_id(wechat_id)
    created = False

    if token is None and create_missing:
        try:
            token, created = ensure_token_for_user_id(wechat_id)
        except RuntimeError as exc:
            return _log_and_return({"error": str(exc)}, 409)

    if token is None:
        return _log_and_return({"error": "Token not found"}, 404)

    response_payload = {
        "wechat_id": wechat_id,
        "token": token,
        "created": created,
        "registry_source": user_registry_source or "none",
    }
    return _log_and_return(response_payload, 201 if created else 200)


async def handle_audit_request(request):
    start_time = time.time()
    token = ""
    try:
        data = await request.json()
        token = data.get("token", "")
    except Exception:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:]

    principal = resolve_http_principal(token, request)
    user_id = principal.get("user_id") if principal else None
    endpoint = "/v1/admin/audit"

    def _log_and_return(payload, status, cache_status="MISS"):
        log_http_usage(endpoint, user_id, status, start_time)
        return web.Response(body=_fast_dumps_str(payload), status=status, content_type="application/json", headers={"X-Cache": cache_status})

    if not principal:
        return _log_and_return({"error": "Invalid token"}, 401)

    # Allow admin/fallback roles full access; regular users can view their own logs
    role = principal.get("role", "")
    perms = _principal_permissions(principal)
    is_admin = role in ("admin", "fallback") or perms.get("rest", {}).get("admin_token_lookup", False)
    query_user_filter = request.query.get("user_id", "")
    if not is_admin and query_user_filter and query_user_filter != user_id:
        return _log_and_return({"error": "Forbidden: can only query your own logs"}, 403)
    effective_user_filter = user_id if not is_admin else (query_user_filter or "")

    # Query params
    limit = request.query.get("limit", "100")
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 100
    limit = max(1, min(limit, 1000))

    # user_filter set above as effective_user_filter
    event_filter = request.query.get("event", "")
    mode_filter = request.query.get("mode", "")

    log_path = usage_log_path()
    events = []
    try:
        with open(log_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except Exception:
                    continue
                if effective_user_filter and ev.get("user_id") != effective_user_filter:
                    continue
                if event_filter:
                    ev_type = ev.get("event") or ev.get("ws_event")
                    if ev_type != event_filter:
                        continue
                if mode_filter and ev.get("mode") != mode_filter:
                    continue
                events.append(ev)
    except FileNotFoundError:
        pass
    except Exception as e:
        return _log_and_return({"error": f"Failed to read log: {e}"}, 500)

    # Return most recent first
    events.reverse()
    total = len(events)
    events = events[:limit]

    return _log_and_return({
        "total": total,
        "returned": len(events),
        "events": events,
    }, 200)


async def handle_stats_request(request):
    start_time = time.time()
    token = ""
    try:
        data = await request.json()
        token = data.get("token", "")
    except Exception:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:]

    principal = resolve_http_principal(token, request)
    user_id = principal.get("user_id") if principal else None
    endpoint = "/v1/admin/stats"

    def _log_and_return(payload, status, cache_status="MISS"):
        log_http_usage(endpoint, user_id, status, start_time)
        return web.Response(body=_fast_dumps_str(payload), status=status, content_type="application/json", headers={"X-Cache": cache_status})

    if not principal:
        return _log_and_return({"error": "Invalid token"}, 401)

    role = principal.get("role", "")
    perms = _principal_permissions(principal)
    is_admin = role in ("admin", "fallback") or perms.get("rest", {}).get("admin_token_lookup", False)

    query_user_id = request.query.get("user_id", "")
    if not is_admin and query_user_id and query_user_id != user_id:
        return _log_and_return({"error": "Forbidden: can only query your own stats"}, 403)

    effective_user_id = user_id if not is_admin else (query_user_id or user_id)

    # Per-user stats
    user_stats = rate_limiter.get_user_stats(effective_user_id) if effective_user_id else {}

    # Admin: include all users and system stats
    all_user_stats = None
    system_stats = None
    if is_admin:
        all_user_stats = rate_limiter.get_all_stats()
        system_stats = get_system_stats()

    return _log_and_return({
        "user_id": effective_user_id,
        "user_stats": user_stats,
        "all_user_stats": all_user_stats,
        "system": system_stats,
    }, 200)


async def handle_admin_pool_request(request):
    """Toggle free-key routing at runtime for A/B tests.
    POST /v1/admin/pool with {"free_disabled": true|false}.
    """
    try:
        from alpaca_key_pool import get_key_pool
        pool = get_key_pool()
        data = await request.json()
        if "free_disabled" in data:
            pool.free_disabled = bool(data["free_disabled"])
        return web.json_response({
            "free_disabled": pool.free_disabled,
            "free_keys": [e.label for e in pool.free],
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_admin_cache_clear_request(request):
    """Clear in-memory cache + optionally disk cache for A/B test isolation.
    POST /v1/admin/cache/clear with {"clear_disk": true|false}.
    """
    try:
        data = await request.json() if request.body_exists else {}
        cleared = {"memory": 0, "disk_files": 0}
        client = await get_redis_client()
        if isinstance(client, MemoryRedisClient):
            cleared["memory"] = len(client._cache)
            client._cache.clear()
        if data.get("clear_disk"):
            import shutil, os as _os
            base = _os.getenv("DISK_CACHE_DIR", "/var/cache/alpaca")
            if _os.path.isdir(base):
                for sub in _os.listdir(base):
                    p = _os.path.join(base, sub)
                    if _os.path.isdir(p):
                        shutil.rmtree(p, ignore_errors=True)
                        cleared["disk_files"] += 1
        return web.json_response({"cleared": cleared})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_health_request(request):
    try:
        from alpaca_key_pool import get_key_pool
        pool = get_key_pool()
        pool_stats = {}
        now = time.time()
        cutoff = now - 60.0
        for entry in pool.entries:
            # Prune stale timestamps so count_1min reflects the actual
            # sliding-window count (not raw deque length).
            while entry.timestamps and entry.timestamps[0] < cutoff:
                entry.timestamps.popleft()
            count = len(entry.timestamps)
            pool_stats[entry.label] = {
                "count_1min": count,
                "remaining": entry.remaining_from_header if entry.remaining_from_header is not None else max(0, entry.limit_per_min - count)
            }
        # DB health (lightweight ping, not full stats)
        db_stats = {"enabled": False}
        if DB_MANAGER_AVAILABLE:
            try:
                from db_manager import get_db_pool
                pool = await get_db_pool()
                if pool is not None:
                    async with pool.acquire() as conn:
                        await conn.fetchval("SELECT 1")
                    db_stats = {"enabled": True, "error": ""}
                else:
                    db_stats = {"enabled": True, "error": "pool unavailable"}
            except Exception as e:
                db_stats = {"enabled": True, "error": str(e)}
        return web.json_response({"status": "OK", "pool": pool_stats, "db": db_stats})
    except Exception as e:
        return web.json_response({"status": "OK", "pool": {"error": str(e)}})


async def start_http_server():
    app = web.Application(middlewares=[stream_priority_middleware])
    app.router.add_post("/v1/history/bars", handle_history_request)
    app.router.add_get("/v1/history/bars", handle_history_request)
    app.router.add_post("/v1/history/options/bars", handle_options_history_request)
    app.router.add_get("/v1/history/options/bars", handle_options_history_request)
    app.router.add_post("/v1/options/open_interest", handle_option_open_interest_request)
    app.router.add_get("/v1/options/open_interest", handle_option_open_interest_request)
    app.router.add_post("/v1/options/eod", handle_option_eod_request)
    app.router.add_get("/v1/options/eod", handle_option_eod_request)
    app.router.add_post("/v1/history/options/eod", handle_option_eod_request)
    app.router.add_get("/v1/history/options/eod", handle_option_eod_request)
    app.router.add_post("/v1/history/options/trades", handle_options_history_trades_request)
    app.router.add_get("/v1/history/options/trades", handle_options_history_trades_request)
    for pattern in THETADATA_VALUE_OPTION_ROUTE_PATTERNS:
        app.router.add_post(pattern, handle_provider_proxy)
        app.router.add_get(pattern, handle_provider_proxy)
    app.router.add_post("/v1/history/news", handle_news_history_request)
    app.router.add_get("/v1/history/news", handle_news_history_request)
    app.router.add_post("/v1/options/contracts", handle_option_contracts_request)
    app.router.add_get("/v1/options/contracts", handle_option_contracts_request)
    app.router.add_post("/v1/options/snapshots", handle_option_snapshots_request)
    app.router.add_get("/v1/options/snapshots", handle_option_snapshots_request)
    app.router.add_post("/v1/options/snapshots/ohlc", handle_option_snapshots_request)
    app.router.add_get("/v1/options/snapshots/ohlc", handle_option_snapshots_request)
    app.router.add_post("/v1/options/snapshots/trade", handle_option_snapshots_request)
    app.router.add_get("/v1/options/snapshots/trade", handle_option_snapshots_request)
    app.router.add_post("/v1/options/snapshots/quote", handle_option_snapshots_request)
    app.router.add_get("/v1/options/snapshots/quote", handle_option_snapshots_request)
    app.router.add_post("/v1/options/snapshots/market_value", handle_option_snapshots_request)
    app.router.add_get("/v1/options/snapshots/market_value", handle_option_snapshots_request)
    app.router.add_post("/v1/options/snapshots/open_interest", handle_option_snapshots_request)
    app.router.add_get("/v1/options/snapshots/open_interest", handle_option_snapshots_request)
    app.router.add_post("/v1/options/snapshots/expiry", handle_option_snapshots_by_expiry_request)
    app.router.add_get("/v1/options/snapshots/expiry", handle_option_snapshots_by_expiry_request)
    app.router.add_post("/v1/options/snapshots/{underlying_symbol}", handle_option_snapshots_underlying_request)
    app.router.add_get("/v1/options/snapshots/{underlying_symbol}", handle_option_snapshots_underlying_request)
    app.router.add_post("/v1/crypto/us/latest/orderbooks", handle_crypto_latest_orderbooks_request)
    app.router.add_get("/v1/crypto/us/latest/orderbooks", handle_crypto_latest_orderbooks_request)
    app.router.add_post("/v1/admin/token/lookup", handle_token_lookup_request)
    app.router.add_post("/v1/admin/audit", handle_audit_request)
    app.router.add_post("/v1/admin/stats", handle_stats_request)
    app.router.add_post("/v1/history/options/trade_quote", handle_option_history_trade_quote_request)
    app.router.add_get("/v1/history/options/trade_quote", handle_option_history_trade_quote_request)
    app.router.add_post("/v1/options/history/trade_quote", handle_option_history_trade_quote_request)
    app.router.add_get("/v1/options/history/trade_quote", handle_option_history_trade_quote_request)
    app.router.add_post("/v1/stock/history/trade_quote", handle_stock_history_trade_quote_request)
    app.router.add_get("/v1/stock/history/trade_quote", handle_stock_history_trade_quote_request)
    native_provider_patterns = (
        "/v2/stocks/{tail:.*}",
        "/v1beta3/crypto/{tail:.*}",
        "/v1beta1/crypto-perps/{tail:.*}",
        "/v1beta1/options/{tail:.*}",
        "/v1beta1/news",
        "/v1beta1/news/{tail:.*}",
        "/v2/options/contracts",
        "/v2/options/contracts/{tail:.*}",
    )
    for pattern in native_provider_patterns:
        app.router.add_get(pattern, handle_provider_proxy)
        app.router.add_post(pattern, handle_provider_proxy)
    app.router.add_get("/health", handle_health_request)
    app.router.add_post("/v1/admin/pool", handle_admin_pool_request)
    app.router.add_post("/v1/admin/cache/clear", handle_admin_cache_clear_request)

    async def _cleanup_http_session(app_ref):
        global _http_session
        if _http_session and not _http_session.closed:
            await _http_session.close()
            print("[HTTP] Persistent session closed")
    app.on_cleanup.append(_cleanup_http_session)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", HTTP_PORT)
    await site.start()
    print(f"[Cloud] HTTP server listening on port {HTTP_PORT}")
    return runner


async def start_websocket_server():
    server = await websockets.serve(handle_relay, "0.0.0.0", WS_PORT, compression=None)
    print(
        f"[Cloud] WS server listening on port {WS_PORT} "
        "(/stream, /stream/options, /stream/test, /stream/crypto, /stream/news, /stream/boats, /stream/overnight)"
    )
    return server


async def main():
    print("=" * 60)
    print("Alpaca Cloud Proxy")
    print(f"  WS Port: {WS_PORT}")
    print(f"  HTTP Port: {HTTP_PORT}")
    print(f"  Mode: {'LIVE' if IS_LIVE else 'PAPER'}")
    print(f"  Feed: {'SIP (Pro)' if IS_PRO else 'IEX (Free)'}")
    print("=" * 60)
    # Seed psutil's CPU sampler so the first non-blocking call in the REST
    # middleware returns a real delta instead of 0.0.
    try:
        import psutil
        psutil.cpu_percent(interval=None)
    except Exception:
        pass
    # Disk I/O executor: default pool (min(32, cpu+4) ≈ 6-8) is too small for
    # concurrent cache reads/writes, causing cache-hit p95 to exceed miss p95.
    import concurrent.futures
    loop = asyncio.get_running_loop()
    loop.set_default_executor(concurrent.futures.ThreadPoolExecutor(max_workers=32))
    # 初始化 TimescaleDB 连接池 (数据库优先架构)
    if DB_MANAGER_AVAILABLE:
        try:
            db_pool = await get_db_pool()
            if db_pool:
                print("[DB] Database-first mode: REST queries will hit TimescaleDB before upstream", flush=True)
            else:
                print("[DB] DB pool not available, falling back to cache-only mode", flush=True)
        except Exception as e:
            print(f"[DB] Initialization error: {e}, continuing without DB", flush=True)
    else:
        print("[DB] db_manager not available, DB features disabled", flush=True)

    http_runner = await start_http_server()
    forwarders = []

    if REST_ONLY:
        print("[Cloud] REST_ONLY mode: skipping all WS upstream connections", flush=True)
    else:
        ws_server = await start_websocket_server()
        forwarders += [
            asyncio.create_task(forward_alpaca_messages()),
            asyncio.create_task(forward_alpaca_test_messages()),
            asyncio.create_task(forward_alpaca_boats_messages()),
            asyncio.create_task(forward_alpaca_overnight_messages()),
            asyncio.create_task(forward_alpaca_options_messages()),
            asyncio.create_task(forward_alpaca_crypto_messages()),
            asyncio.create_task(forward_alpaca_news_messages()),
        ]

    # Start usage log writer
    init_usage_logger()
    global usage_log_task
    usage_log_task = asyncio.create_task(usage_log_writer())

    # Start background users.json watcher
    watcher_task = asyncio.create_task(watch_user_registry_loop())

    forwarders += [usage_log_task, watcher_task]

    try:
        await asyncio.Future()
    except asyncio.CancelledError:
        pass
    finally:
        for task in forwarders:
            task.cancel()
        await asyncio.gather(*forwarders, return_exceptions=True)
        await http_runner.cleanup()
        if not REST_ONLY:
            ws_server.close()
            await ws_server.wait_closed()
        # 关闭 TimescaleDB 连接池
        if DB_MANAGER_AVAILABLE:
            try:
                await close_db_pool()
            except Exception:
                pass


if __name__ == "__main__":
    asyncio.run(main())
