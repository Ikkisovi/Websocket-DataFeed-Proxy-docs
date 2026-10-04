#!/usr/bin/env python3
"""Apply a reviewed, hash-bound docs overlay without restarting the portal."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


DOC_PAGE_INDEXES = (
    "docs/index.html",
    "docs/market/overview/index.html",
    "docs/market/stocks/index.html",
    "docs/market/options/index.html",
    "docs/market/indices/index.html",
    "docs/market/research-signals/index.html",
    "docs/market/crypto-news/index.html",
    "docs/market/cn/index.html",
    "docs/financial/index.html",
    "docs/financial/regular/index.html",
    "docs/financial/morningstar/index.html",
    "docs/financial/statements/index.html",
    "docs/financial/ratios-growth/index.html",
    "docs/bulk/download/index.html",
    "docs/realtime/websocket/index.html",
    "docs/realtime/subscriptions/index.html",
    "docs/status/index.html",
    "docs/usage/index.html",
)

# BEGIN GENERATED ARTICLE FILES
DOC_ARTICLE_INDEXES = (
    "docs/financial/morningstar/morningstar-coverage/index.html",
    "docs/financial/morningstar/morningstar-fields/index.html",
    "docs/financial/morningstar/morningstar-history/index.html",
    "docs/financial/morningstar/morningstar-overview/index.html",
    "docs/financial/morningstar/morningstar-pit/index.html",
    "docs/financial/morningstar/morningstar-processing/index.html",
    "docs/financial/ratios-growth/fmp-balance-sheet-statement-growth/index.html",
    "docs/financial/ratios-growth/fmp-cash-flow-statement-growth/index.html",
    "docs/financial/ratios-growth/fmp-enterprise-values/index.html",
    "docs/financial/ratios-growth/fmp-financial-growth/index.html",
    "docs/financial/ratios-growth/fmp-financial-scores/index.html",
    "docs/financial/ratios-growth/fmp-income-statement-growth/index.html",
    "docs/financial/ratios-growth/fmp-key-metrics-ttm/index.html",
    "docs/financial/ratios-growth/fmp-key-metrics/index.html",
    "docs/financial/ratios-growth/fmp-ratios-ttm/index.html",
    "docs/financial/ratios-growth/fmp-ratios/index.html",
    "docs/financial/regular/fmp-aftermarket-quote/index.html",
    "docs/financial/regular/fmp-aftermarket-trade/index.html",
    "docs/financial/regular/fmp-analyst-estimates/index.html",
    "docs/financial/regular/fmp-available-countries/index.html",
    "docs/financial/regular/fmp-available-exchanges/index.html",
    "docs/financial/regular/fmp-available-industries/index.html",
    "docs/financial/regular/fmp-available-sectors/index.html",
    "docs/financial/regular/fmp-balance-sheet-statement-growth/index.html",
    "docs/financial/regular/fmp-balance-sheet-statement/index.html",
    "docs/financial/regular/fmp-batch-aftermarket-quote/index.html",
    "docs/financial/regular/fmp-batch-aftermarket-trade/index.html",
    "docs/financial/regular/fmp-batch-quote-short/index.html",
    "docs/financial/regular/fmp-batch-quote/index.html",
    "docs/financial/regular/fmp-cash-flow-statement-growth/index.html",
    "docs/financial/regular/fmp-cash-flow-statement/index.html",
    "docs/financial/regular/fmp-cik-list/index.html",
    "docs/financial/regular/fmp-company-notes/index.html",
    "docs/financial/regular/fmp-custom-discounted-cash-flow/index.html",
    "docs/financial/regular/fmp-custom-levered-discounted-cash-flow/index.html",
    "docs/financial/regular/fmp-delisted-companies/index.html",
    "docs/financial/regular/fmp-discounted-cash-flow/index.html",
    "docs/financial/regular/fmp-dividends/index.html",
    "docs/financial/regular/fmp-earnings/index.html",
    "docs/financial/regular/fmp-employee-count/index.html",
    "docs/financial/regular/fmp-enterprise-values/index.html",
    "docs/financial/regular/fmp-financial-growth/index.html",
    "docs/financial/regular/fmp-financial-reports-dates/index.html",
    "docs/financial/regular/fmp-financial-scores/index.html",
    "docs/financial/regular/fmp-financial-statement-symbol-list/index.html",
    "docs/financial/regular/fmp-fundamentals-overview/index.html",
    "docs/financial/regular/fmp-future-data-families/index.html",
    "docs/financial/regular/fmp-grades-consensus/index.html",
    "docs/financial/regular/fmp-grades-historical/index.html",
    "docs/financial/regular/fmp-grades/index.html",
    "docs/financial/regular/fmp-historical-employee-count/index.html",
    "docs/financial/regular/fmp-historical-market-capitalization/index.html",
    "docs/financial/regular/fmp-historical-price-eod/index.html",
    "docs/financial/regular/fmp-income-statement-growth/index.html",
    "docs/financial/regular/fmp-income-statement/index.html",
    "docs/financial/regular/fmp-key-executives/index.html",
    "docs/financial/regular/fmp-key-metrics-ttm/index.html",
    "docs/financial/regular/fmp-key-metrics/index.html",
    "docs/financial/regular/fmp-levered-discounted-cash-flow/index.html",
    "docs/financial/regular/fmp-market-capitalization-batch/index.html",
    "docs/financial/regular/fmp-market-capitalization/index.html",
    "docs/financial/regular/fmp-owner-earnings/index.html",
    "docs/financial/regular/fmp-pit-statements/index.html",
    "docs/financial/regular/fmp-price-target-consensus/index.html",
    "docs/financial/regular/fmp-price-target-summary/index.html",
    "docs/financial/regular/fmp-profile/index.html",
    "docs/financial/regular/fmp-quote-short/index.html",
    "docs/financial/regular/fmp-quote/index.html",
    "docs/financial/regular/fmp-ratings-historical/index.html",
    "docs/financial/regular/fmp-ratings-snapshot/index.html",
    "docs/financial/regular/fmp-ratios-ttm/index.html",
    "docs/financial/regular/fmp-ratios/index.html",
    "docs/financial/regular/fmp-request-contract/index.html",
    "docs/financial/regular/fmp-response-metadata/index.html",
    "docs/financial/regular/fmp-revenue-geographic-segmentation/index.html",
    "docs/financial/regular/fmp-revenue-product-segmentation/index.html",
    "docs/financial/regular/fmp-shares-float-all/index.html",
    "docs/financial/regular/fmp-shares-float/index.html",
    "docs/financial/regular/fmp-snapshot-boundary/index.html",
    "docs/financial/regular/fmp-splits/index.html",
    "docs/financial/regular/fmp-stock-list/index.html",
    "docs/financial/regular/fmp-stock-peers/index.html",
    "docs/financial/regular/fmp-stock-price-change/index.html",
    "docs/financial/regular/fmp-symbol-change/index.html",
    "docs/financial/statements/fmp-balance-sheet-statement/index.html",
    "docs/financial/statements/fmp-cash-flow-statement/index.html",
    "docs/financial/statements/fmp-income-statement/index.html",
    "docs/financial/statements/fmp-pit-statements/index.html",
    "docs/market/cn/cn-access/index.html",
    "docs/market/cn/cn-catalog/index.html",
    "docs/market/cn/cn-daily-bars/index.html",
    "docs/market/cn/cn-data-overview/index.html",
    "docs/market/cn/cn-etf-minute/index.html",
    "docs/market/cn/cn-etf/index.html",
    "docs/market/cn/cn-fundamentals/index.html",
    "docs/market/cn/cn-funds/index.html",
    "docs/market/cn/cn-membership/index.html",
    "docs/market/cn/cn-minute-bars/index.html",
    "docs/market/cn/cn-options/index.html",
    "docs/market/cn/cn-reference/index.html",
    "docs/market/cn/cn-shareholders/index.html",
    "docs/market/cn/cn-unavailable/index.html",
    "docs/market/cn/cn-valuation/index.html",
    "docs/market/crypto-news/get-post-v1beta3-crypto-us-snapshots/index.html",
    "docs/market/crypto-news/post-v1-crypto-us-latest-orderbooks/index.html",
    "docs/market/crypto-news/post-v1-history-news/index.html",
    "docs/market/indices/cash-indices-overview/index.html",
    "docs/market/indices/get-post-v1-indices-daily/index.html",
    "docs/market/indices/get-post-v1-indices-history/index.html",
    "docs/market/indices/get-post-v1-indices-minute/index.html",
    "docs/market/indices/get-v1-indices-daily-coverage/index.html",
    "docs/market/indices/get-v1-indices-minute-coverage/index.html",
    "docs/market/options/post-v1-history-options-bars/index.html",
    "docs/market/options/post-v1-history-options-eod/index.html",
    "docs/market/options/post-v1-history-options-trades/index.html",
    "docs/market/options/post-v1-options-contracts/index.html",
    "docs/market/options/post-v1-options-open-interest/index.html",
    "docs/market/options/post-v1-options-snapshots-expiry/index.html",
    "docs/market/options/post-v1-options-snapshots-open-interest/index.html",
    "docs/market/options/post-v1-options-snapshots-quote/index.html",
    "docs/market/options/post-v1-options-snapshots-trade/index.html",
    "docs/market/options/post-v1-options-snapshots/index.html",
    "docs/market/options/post-v3-option-at-time-quote/index.html",
    "docs/market/options/post-v3-option-direct-value/index.html",
    "docs/market/options/post-v3-option-history-ohlc/index.html",
    "docs/market/options/post-v3-option-snapshot-ohlc/index.html",
    "docs/market/options/provider-fallback-cache/index.html",
    "docs/market/overview/authentication/index.html",
    "docs/market/overview/error-codes/index.html",
    "docs/market/overview/free-plan-usage/index.html",
    "docs/market/overview/get-admin-pending/index.html",
    "docs/market/overview/overview/index.html",
    "docs/market/overview/post-admin-approve/index.html",
    "docs/market/overview/post-admin-login/index.html",
    "docs/market/overview/post-admin-reject/index.html",
    "docs/market/overview/post-check-status/index.html",
    "docs/market/overview/post-generate-token/index.html",
    "docs/market/overview/post-register/index.html",
    "docs/market/overview/rate-limits/index.html",
    "docs/market/overview/tiers-permissions/index.html",
    "docs/market/research-signals/get-post-v1-spectral-tick-flow/index.html",
    "docs/market/research-signals/get-v1-spectral-tick-flow-coverage/index.html",
    "docs/market/research-signals/spectral-fields/index.html",
    "docs/market/research-signals/spectral-methodology/index.html",
    "docs/market/research-signals/spectral-overview/index.html",
    "docs/market/research-signals/spectral-processing/index.html",
    "docs/market/research-signals/spectral-workflows/index.html",
    "docs/market/stocks/market-us-world/index.html",
    "docs/market/stocks/post-v1-history-bars/index.html",
    "docs/market/stocks/post-v1-stock-history-trade-quote/index.html",
    "docs/market/stocks/stock-auctions/index.html",
    "docs/market/stocks/stock-bars/index.html",
    "docs/market/stocks/stock-condition-codes/index.html",
    "docs/market/stocks/stock-data-availability/index.html",
    "docs/market/stocks/stock-exchange-codes/index.html",
    "docs/market/stocks/stock-latest-bars/index.html",
    "docs/market/stocks/stock-latest-quotes/index.html",
    "docs/market/stocks/stock-latest-trades/index.html",
    "docs/market/stocks/stock-quotes/index.html",
    "docs/market/stocks/stock-single-bars/index.html",
    "docs/market/stocks/stock-single-latest-bar/index.html",
    "docs/market/stocks/stock-single-latest-quote/index.html",
    "docs/market/stocks/stock-single-latest-trade/index.html",
    "docs/market/stocks/stock-single-quotes/index.html",
    "docs/market/stocks/stock-single-snapshot/index.html",
    "docs/market/stocks/stock-single-trades/index.html",
    "docs/market/stocks/stock-snapshots/index.html",
    "docs/market/stocks/stock-trades/index.html",
    "docs/realtime/subscriptions/bar/index.html",
    "docs/realtime/subscriptions/quote/index.html",
    "docs/realtime/subscriptions/subscribe/index.html",
    "docs/realtime/subscriptions/trade/index.html",
    "docs/realtime/subscriptions/unsubscribe/index.html",
    "docs/realtime/websocket/auth-message/index.html",
    "docs/realtime/websocket/backpressure/index.html",
    "docs/realtime/websocket/bar/index.html",
    "docs/realtime/websocket/crypto/index.html",
    "docs/realtime/websocket/endpoint/index.html",
    "docs/realtime/websocket/heartbeat/index.html",
    "docs/realtime/websocket/news/index.html",
    "docs/realtime/websocket/options/index.html",
    "docs/realtime/websocket/overnight/index.html",
    "docs/realtime/websocket/quote/index.html",
    "docs/realtime/websocket/reconnect/index.html",
    "docs/realtime/websocket/stocks/index.html",
    "docs/realtime/websocket/subscribe/index.html",
    "docs/realtime/websocket/trade/index.html",
    "docs/realtime/websocket/unsubscribe/index.html",
)
# END GENERATED ARTICLE FILES

FILES = (
    "assets/docs-page.js", "assets/token-page.js", "assets/register-page.js",
    "assets/providers/fmp-data.png", "assets/providers/morningstar.png", "assets/providers/alpaca.png",
    "skills/leandata-market-data/SKILL.md",
    "language.js", "register-page.jsx",
    "docs/doc-navigation.mjs", "docs/doc-components.jsx", "docs/doc-layout.css",
    "docs/docs-site.jsx", "docs/tokens.css", "tokens.css",
    *DOC_PAGE_INDEXES, *DOC_ARTICLE_INDEXES, "index.html",
)

RELEASE_ROOT = Path("/srv/leandata/site-releases/docs-nav")
PUBLIC_ROOT = Path("/srv/leandata/proxy-token-site/public")
CONTAINER = "leandata-v2-leandata-ui-1"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_copy(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".docs-next-", dir=target.parent)
    os.close(fd)
    try:
        shutil.copyfile(source, name)
        os.chmod(name, 0o644)
        os.replace(name, target)
    finally:
        Path(name).unlink(missing_ok=True)


def deploy(release, manifest_path, apply):
    manifest = json.loads(manifest_path.read_text())
    assert re.fullmatch(r"[0-9a-f]{40}", manifest["commit"])
    assert release.name == manifest["commit"]
    assert release.parent == RELEASE_ROOT
    assert set(manifest["files"]) == set(FILES)
    public = PUBLIC_ROOT
    source = release / "proxy-token-site/public"
    container = CONTAINER
    before = json.loads(subprocess.check_output(["docker", "inspect", container]))[0]
    mount = next(m for m in before["Mounts"] if m["Destination"] == "/app/public")
    assert mount["Source"] == str(public) and not mount["RW"]
    identity = (public.stat().st_dev, public.stat().st_ino)
    for name in FILES:
        target = public / name
        expected_before = manifest["files"][name]["before"]
        assert not target.is_symlink()
        assert digest(source / name) == manifest["files"][name]["after"], name
        if expected_before is None:
            assert not target.exists(), name
        else:
            assert target.is_file(), name
            assert digest(target) == expected_before, name
    for name, expected in manifest["dependencies"].items():
        assert name in {"token-page.jsx", "language.js", "docs/usage-page.jsx", "docs-site.jsx"}
        assert digest(public / name) == expected, name
    if not apply:
        print("Static docs preflight passed; no live files changed.")
        return

    backup = release / "rollback"
    backup.mkdir()  # Fail closed on an already attempted release.
    for name in FILES:
        live = public / name
        if live.exists():
            target = backup / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(live, target)
    receipt = {**manifest, "container_id": before["Id"], "public_inode": identity}
    try:
        # Keep directory inodes and publish HTML only after the bundles and styles.
        for name in FILES:
            atomic_copy(source / name, public / name)
        for name in FILES:
            expected = manifest["files"][name]["after"]
            assert digest(public / name) == expected, name
            actual = subprocess.check_output([
                "docker", "exec", container, "sha256sum", "/app/public/" + name,
            ], text=True).split()[0]
            assert actual == expected, name
        after = json.loads(subprocess.check_output(["docker", "inspect", container]))[0]
        assert before["Id"] == after["Id"]
        assert before["State"]["StartedAt"] == after["State"]["StartedAt"]
        assert identity == (public.stat().st_dev, public.stat().st_ino)
        receipt["status"] = "host_container_verified_public_acceptance_pending"
    except BaseException:
        for name in FILES:
            saved = backup / name
            live = public / name
            if saved.exists():
                atomic_copy(saved, live)
            else:
                live.unlink(missing_ok=True)
        receipt["status"] = "rolled_back"
        raise
    finally:
        (release / "deployment.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"commit": manifest["commit"], "status": receipt["status"]}))


def rollback(release, manifest_path):
    """Restore the original bytes only while the applied release still owns them."""
    manifest = json.loads(manifest_path.read_text())
    receipt_path = release / "deployment.json"
    receipt = json.loads(receipt_path.read_text())
    assert re.fullmatch(r"[0-9a-f]{40}", manifest["commit"])
    assert release.name == manifest["commit"] and release.parent == RELEASE_ROOT
    assert set(manifest["files"]) == set(FILES)
    assert receipt["commit"] == manifest["commit"]
    assert receipt["status"] == "host_container_verified_public_acceptance_pending"
    before = json.loads(subprocess.check_output(["docker", "inspect", CONTAINER]))[0]
    assert before["Id"] == receipt["container_id"]
    assert list((PUBLIC_ROOT.stat().st_dev, PUBLIC_ROOT.stat().st_ino)) == receipt["public_inode"]
    backup = release / "rollback"
    for name in FILES:
        live, saved = PUBLIC_ROOT / name, backup / name
        assert not live.is_symlink() and digest(live) == manifest["files"][name]["after"], name
        expected = manifest["files"][name]["before"]
        if expected is None:
            assert not saved.exists(), name
        else:
            assert saved.is_file() and digest(saved) == expected, name
    for name in FILES:
        live, saved = PUBLIC_ROOT / name, backup / name
        if saved.exists():
            atomic_copy(saved, live)
        else:
            live.unlink()
    for name in FILES:
        expected = manifest["files"][name]["before"]
        live = PUBLIC_ROOT / name
        assert (not live.exists()) if expected is None else digest(live) == expected, name
    after = json.loads(subprocess.check_output(["docker", "inspect", CONTAINER]))[0]
    assert before["Id"] == after["Id"] and before["State"]["StartedAt"] == after["State"]["StartedAt"]
    receipt["status"] = "rolled_back_by_operator"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"commit": manifest["commit"], "status": receipt["status"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=Path)
    parser.add_argument("manifest", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    with open("/srv/leandata/docs-static-deploy.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.rollback:
            rollback(args.release.resolve(), args.manifest.resolve())
        else:
            deploy(args.release.resolve(), args.manifest.resolve(), args.apply)
