#!/usr/bin/env python3
"""
tickers_loader.py — 统一加载各类股票 symbol 列表

支持来源:
1. 用户自定义 lean universe (Python 文件) — 最高优先级
2. NASDAQ-100 (GitHub: jmccarrell/n100tickers)
3. S&P 500 (GitHub: fja05680/sp500)
4. 本地 JSON 缓存 (fallback)
"""

import asyncio
import json
import re
import ast
from pathlib import Path
from typing import List, Tuple, Optional

import aiohttp
import yaml

SCRIPT_DIR = Path(__file__).parent

# GitHub raw URLs
NASDAQ100_URL = "https://raw.githubusercontent.com/jmccarrell/n100tickers/main/src/nasdaq_100_ticker_history/n100-ticker-changes-2026.yaml"
SP500_URL = "https://raw.githubusercontent.com/fja05680/sp500/master/sp500.csv"

# ── Lean Universe (用户提供, hardcoded fallback) ──
LEAN_UNIVERSE_TICKERS = [
    "AGX", "ALL", "APP", "ARQT", "AMZN", "BLBD", "CDE", "META", "CRDO", "HOOD", "RKLB",
    "EAT", "EZPW", "GOOGL", "INCY", "KGC", "LRN", "AAPL", "AMD", "VST", "USAR", "DY",
    "MU", "NVDA", "OKTA", "ORGO", "POWL", "MRVL", "NOK", "PPC", "QTWO", "RCL", "TSLA", "CCL", "B", "INTC", "IREN",
    "SFM", "SKYW", "SSRM", "STRL", "SYF", "TMUS", "TTMI", "TWLO", "UBER", "BMY", "SEZL",
    "WLDN", "PARR", "ANET", "V", "CRM", "LLY", "C", "SCHW", "CAT", "VRT", "RL", "UAL", "DIS", "CMCSA", "SNDK", "PL", "WDC", "AVGO", "STX",
    "FN", "GM", "NEM", "LITE",
]


# ── GitHub 拉取 ──

async def fetch_ndx100_from_github(session: aiohttp.ClientSession) -> List[str]:
    """从 GitHub 获取 NASDAQ-100 最新成分股列表."""
    try:
        async with session.get(NASDAQ100_URL, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            data = yaml.safe_load(await resp.text())
        # YAML 格式: {year: 2026, tickers_on_Jan_1: [AAPL, ABNB, ...], changes: [...]}
        if isinstance(data, dict):
            tickers = data.get("tickers_on_Jan_1", [])
            return [s.strip().upper() for s in tickers if isinstance(s, str)]
        # Fallback: 如果是列表格式
        symbols = set()
        for entry in (data if isinstance(data, list) else []):
            if isinstance(entry, dict):
                for sym in entry.get("added", []):
                    symbols.add(sym.strip().upper())
                for sym in entry.get("removed", []):
                    symbols.discard(sym.strip().upper())
        return sorted(symbols)
    except Exception as e:
        print(f"[Tickers] Failed to fetch NASDAQ-100 from GitHub: {e}")
        return []


async def fetch_sp500_from_github(session: aiohttp.ClientSession) -> List[str]:
    """从 GitHub 获取 S&P 500 成分股列表 (CSV)."""
    try:
        import csv
        import io
        async with session.get(SP500_URL, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            text = await resp.text()
        reader = csv.DictReader(io.StringIO(text))
        symbols = [row["Symbol"].strip().upper() for row in reader if row.get("Symbol")]
        return symbols
    except Exception as e:
        print(f"[Tickers] Failed to fetch S&P 500 from GitHub: {e}")
        return []


# ── 本地缓存 ──

def load_cached_tickers(cache_file: Path = None) -> dict:
    if cache_file is None:
        cache_file = SCRIPT_DIR / "tickers_cache.json"
    if cache_file.exists():
        with open(cache_file) as f:
            return json.load(f)
    return {}


def save_cached_tickers(data: dict, cache_file: Path = None):
    if cache_file is None:
        cache_file = SCRIPT_DIR / "tickers_cache.json"
    with open(cache_file, "w") as f:
        json.dump(data, f, indent=2)


# ── Lean Universe ──

def load_lean_universe(filepath: Optional[str] = None) -> List[str]:
    """从用户提供的 Python/JSON 文件加载 lean universe tickers."""
    if filepath:
        path = Path(filepath)
        if path.exists():
            if path.suffix == ".py":
                content = path.read_text()
                m = re.search(r"self\.tickers\s*=\s*(\[[^\]]+\])", content, re.DOTALL)
                if m:
                    try:
                        tickers = ast.literal_eval(m.group(1))
                        return [t.strip().upper() for t in tickers if isinstance(t, str)]
                    except Exception as e:
                        print(f"[Tickers] Failed to parse Python tickers: {e}")
            elif path.suffix == ".json":
                with open(path) as f:
                    data = json.load(f)
                if isinstance(data, list):
                    return [t.strip().upper() for t in data if isinstance(t, str)]
    # Fallback to hardcoded
    return LEAN_UNIVERSE_TICKERS[:]


# ── 统一加载 ──

async def load_all_tickers(
    include_lean: bool = True,
    include_sp500: bool = True,
    include_ndx100: bool = True,
    lean_file: Optional[str] = None,
) -> Tuple[List[str], dict]:
    """
    加载所有 tickers，返回 (合并列表, 来源统计).
    优先级: lean > ndx100 > sp500 (去重保留顺序)
    """
    all_symbols = []
    stats = {}

    # 1. Lean universe (最高优先级)
    if include_lean:
        lean = load_lean_universe(lean_file)
        all_symbols.extend(lean)
        stats["lean_universe"] = len(lean)

    # 2. NASDAQ-100
    if include_ndx100:
        cache = load_cached_tickers()
        ndx100 = cache.get("ndx100", [])
        if not ndx100:
            async with aiohttp.ClientSession() as session:
                ndx100 = await fetch_ndx100_from_github(session)
                if ndx100:
                    cache["ndx100"] = ndx100
                    save_cached_tickers(cache)
        all_symbols.extend(ndx100)
        stats["ndx100"] = len(ndx100)

    # 3. S&P 500
    if include_sp500:
        cache = load_cached_tickers()
        sp500 = cache.get("sp500", [])
        if not sp500:
            async with aiohttp.ClientSession() as session:
                sp500 = await fetch_sp500_from_github(session)
                if sp500:
                    cache["sp500"] = sp500
                    save_cached_tickers(cache)
        all_symbols.extend(sp500)
        stats["sp500"] = len(sp500)

    # 去重保留顺序
    seen = set()
    unique = []
    for s in all_symbols:
        sym = s.strip().upper()
        if sym and sym not in seen:
            seen.add(sym)
            unique.append(sym)

    stats["total_unique"] = len(unique)
    return unique, stats


# ── Options Underlyings ──

OPTIONS_PRIORITY_UNDERLYINGS = ["SPX", "NDX", "QQQ", "SPY", "IWM", "AAPL", "TSLA", "NVDA", "AMZN", "META", "GOOGL", "MSFT"]


def load_options_underlyings(
    priority_only: bool = True,
    lean_file: Optional[str] = None,
) -> List[str]:
    """加载期权回填的 underlying symbols."""
    if priority_only:
        return OPTIONS_PRIORITY_UNDERLYINGS[:]
    # 否则用 lean universe + SPY/QQQ/IWM
    lean = load_lean_universe(lean_file)
    extras = [s for s in ["SPY", "QQQ", "IWM", "SPX", "NDX"] if s not in lean]
    return lean + extras


# ── 测试 ──

async def _test():
    print("Testing tickers loader...")
    symbols, stats = await load_all_tickers()
    print(f"Stats: {stats}")
    print(f"First 10: {symbols[:10]}")
    print(f"Total: {len(symbols)}")
    opts = load_options_underlyings(priority_only=True)
    print(f"Options underlyings: {opts}")


if __name__ == "__main__":
    asyncio.run(_test())
