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

FILES = (
    "assets/docs-page.js", "assets/token-page.js",
    "assets/providers/fmp-data.png", "assets/providers/morningstar.png", "assets/providers/alpaca.png",
    "docs/docs-site.jsx", "docs/tokens.css", "tokens.css", *DOC_PAGE_INDEXES, "index.html",
)


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
    assert release.parent == Path("/srv/leandata/site-releases/docs-nav")
    assert set(manifest["files"]) == set(FILES)
    public = Path("/srv/leandata/proxy-token-site/public")
    source = release / "proxy-token-site/public"
    container = "leandata-v2-leandata-ui-1"
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    with open("/srv/leandata/docs-static-deploy.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        deploy(args.release.resolve(), args.manifest.resolve(), args.apply)
