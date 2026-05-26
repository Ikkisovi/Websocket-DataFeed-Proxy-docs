import tempfile
import os
from pathlib import Path

# Create a mock args object
class Args:
    pass

import smart_warmer_v2

def test_load_python_file():
    args = Args()
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False) as f:
        f.write(b"""
class Dummy:
    def __init__(self):
        self.tickers = ['AAPL', 'MSFT', 'GOOGL']
""")
        args.tickers_file = f.name
    
    try:
        tickers = smart_warmer_v2.load_baseline_tickers(args)
        assert tickers == ['AAPL', 'MSFT', 'GOOGL']
    finally:
        os.remove(f.name)

def test_load_json_list():
    args = Args()
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        f.write(b'["BTC", "ETH"]')
        args.tickers_file = f.name
    
    try:
        tickers = smart_warmer_v2.load_baseline_tickers(args)
        assert tickers == ["BTC", "ETH"]
    finally:
        os.remove(f.name)

def test_load_json_dict():
    args = Args()
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        f.write(b'{"sp500": ["A", "B"], "etfs": ["C", "B"]}')
        args.tickers_file = f.name
    
    try:
        tickers = smart_warmer_v2.load_baseline_tickers(args)
        # Should dedup and preserve order: A, B, C
        assert tickers == ["A", "B", "C"]
    finally:
        os.remove(f.name)

if __name__ == "__main__":
    test_load_python_file()
    test_load_json_list()
    test_load_json_dict()
    print("All smart_warmer_v2 ticker tests passed!")
