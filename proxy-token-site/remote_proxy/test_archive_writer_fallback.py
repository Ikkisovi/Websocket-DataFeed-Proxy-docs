import os
from pathlib import Path

# Override environment variable for testing
os.environ["ARCHIVE_DIR"] = "/tmp/test_archive"
os.environ["ARCHIVE_ENABLED"] = "true"

from archive_writer import compute_archive_path

def test_archive_writer_explicit():
    # Test an explicit endpoint
    path = compute_archive_path("/v1/history/bars", {"symbol": "AAPL", "timeframe": "1Min", "end": "2026-05-20"})
    print("Explicit path:", str(path))
    assert path is not None
    assert "/tmp/test_archive/stocks/bars/1MIN/AAPL/2026-05-20__" in str(path) or "/tmp/test_archive/stocks/bars/1Min/AAPL/2026-05-20__" in str(path)

def test_archive_writer_fallback():
    # Test a fallback endpoint that was previously returning None
    path = compute_archive_path("/v1/options/snapshots", {"symbols": "AAPL"})
    assert path is not None
    # Path should be /tmp/test_archive/other/v1_options_snapshots/AAPL/YYYY-MM-DD__hash.json.gz
    assert "/tmp/test_archive/other/v1_options_snapshots/AAPL/" in str(path)

def test_archive_writer_root_fallback():
    # Test a root endpoint fallback
    path = compute_archive_path("/", {"symbol": "BTC"})
    assert path is not None
    assert "/tmp/test_archive/other/root/BTC/" in str(path)

if __name__ == "__main__":
    test_archive_writer_explicit()
    test_archive_writer_fallback()
    test_archive_writer_root_fallback()
    print("All archive_writer fallback tests passed!")
