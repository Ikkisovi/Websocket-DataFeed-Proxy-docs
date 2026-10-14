#!/usr/bin/env python3
"""Publish account assets through the verified v3 static-origin deploy helper."""

import argparse
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path

HELPER_SHA256 = "81e698a339bfd93717cabca56306ec622fd544de6d66d5517bb48ac33092aa3c"
FILES = ("assets/account-page.js", "language.js", "account-page.jsx", "account.html")
DEPENDENCIES = {"tokens.css", "account.css"}
PUBLIC_ROOT = Path("/srv/leandata-site-public/public")
RELEASE_ROOT = Path("/srv/leandata-site-public/releases/account")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--helper", required=True, type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    assert hashlib.sha256(args.helper.read_bytes()).hexdigest() == HELPER_SHA256
    spec = importlib.util.spec_from_file_location("static_origin", args.helper)
    static = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(static)
    static.FILES = FILES
    static.PUBLIC_ROOT = PUBLIC_ROOT
    static.RELEASE_ROOT = RELEASE_ROOT
    static.CONTAINER = "leandata-phx-s4-direct-20261003-v1-compat-1"
    manifest = json.loads(args.manifest.read_text())
    assert set(manifest["account_dependencies"]) == DEPENDENCIES
    assert manifest["helper_sha256"] == HELPER_SHA256
    with open("/srv/leandata-site-public/docs-static-deploy.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for name, expected in manifest["account_dependencies"].items():
            assert static.digest(static.safe_file(PUBLIC_ROOT, name)) == expected, name
        if args.rollback:
            static.rollback(args.release.resolve(), args.manifest.resolve())
        else:
            static.deploy(args.release.resolve(), args.manifest.resolve(), args.apply)


if __name__ == "__main__":
    main()
