#!/usr/bin/env python3
"""Publish the schedule docs with the existing static-release guards and rollback."""
import argparse
import fcntl
from pathlib import Path
import deploy_docs_static as release

# Account assets and untouched retired aliases have independent live amendments.
# Keep them out of this documentation overlay; never roll them back incidentally.
PRESERVE = {
    "assets/account-page.js", "account-page.jsx", "account.html",
    "docs/financial/morningstar/morningstar-daily-history/index.html",
    "docs/financial/morningstar/morningstar-daily-coverage/index.html",
    "docs/financial/morningstar/morningstar-v3/index.html",
    "docs/financial/eodhd/eodhd-fields/index.html",
}
release.FILES = tuple(name for name in release.FILES if name not in PRESERVE)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=Path)
    parser.add_argument("manifest", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    with open("/srv/leandata-site-public/docs-static-deploy.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.rollback:
            release.rollback(args.release.resolve(), args.manifest.resolve())
        else:
            release.deploy(args.release.resolve(), args.manifest.resolve(), args.apply)
