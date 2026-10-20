"""Regression gates for static publication and rollback, using an isolated fake host."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).with_name("deploy_docs_static.py")
spec = importlib.util.spec_from_file_location("static_docs_deploy", SCRIPT)
static = importlib.util.module_from_spec(spec)
spec.loader.exec_module(static)


class StaticDocsDeployTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.public = root / "public"
        self.release_root = root / "releases"
        self.release = self.release_root / ("a" * 40)
        self.files = ("assets/docs-page.js", "docs/new-article/index.html", "index.html")
        self.manifest = {"commit": self.release.name, "files": {}, "dependencies": {}}
        for name in self.files:
            source = self.release / "proxy-token-site/public" / name
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text("new " + name)
            live = self.public / name
            live.parent.mkdir(parents=True, exist_ok=True)
            if name != "docs/new-article/index.html":
                live.write_text("old " + name)
            self.manifest["files"][name] = {
                "before": static.digest(live) if live.exists() else None,
                "after": static.digest(source),
            }
        self.manifest_path = self.release / "manifest.json"
        self.manifest_path.write_text(json.dumps(self.manifest))
        self.calls = []
        self.bad_container_hash = False
        self.identity = (self.public.stat().st_dev, self.public.stat().st_ino)
        self.addCleanup(mock.patch.stopall)
        mock.patch.multiple(static, PUBLIC_ROOT=self.public, RELEASE_ROOT=self.release_root, FILES=self.files).start()
        mock.patch.object(static.subprocess, "check_output", side_effect=self.docker).start()

    def docker(self, args, **kwargs):
        self.calls.append(args)
        if args[:2] == ["docker", "inspect"]:
            return json.dumps([{
                "Id": "original-container",
                "State": {"StartedAt": "original-start"},
                "Mounts": [{"Source": str(self.public), "Destination": "/app/public", "RW": False}],
            }]).encode()
        if args[:2] == ["docker", "exec"]:
            name = args[-1].removeprefix("/app/public/")
            value = "0" * 64 if self.bad_container_hash else static.digest(self.public / name)
            return value + "  " + name
        raise AssertionError("Unexpected container mutation: " + repr(args))

    def apply(self):
        with contextlib.redirect_stdout(io.StringIO()):
            static.deploy(self.release, self.manifest_path, True)

    def assert_original(self):
        for name, hashes in self.manifest["files"].items():
            live = self.public / name
            if hashes["before"] is None:
                self.assertFalse(live.exists())
            else:
                self.assertEqual(static.digest(live), hashes["before"])
        self.assertEqual((self.public.stat().st_dev, self.public.stat().st_ino), self.identity)

    def test_preflight_performs_no_writes(self):
        with contextlib.redirect_stdout(io.StringIO()):
            static.deploy(self.release, self.manifest_path, False)
        self.assert_original()
        self.assertFalse((self.release / "rollback").exists())
        self.assertEqual(len(self.calls), 1)

    def test_apply_and_operator_rollback_preserve_container_and_inode(self):
        self.apply()
        receipt = json.loads((self.release / "deployment.json").read_text())
        self.assertEqual(receipt["container_id"], "original-container")
        for name, hashes in self.manifest["files"].items():
            self.assertEqual(static.digest(self.public / name), hashes["after"])
        with contextlib.redirect_stdout(io.StringIO()):
            static.rollback(self.release, self.manifest_path)
        self.assert_original()
        self.assertEqual(json.loads((self.release / "deployment.json").read_text())["status"], "rolled_back_by_operator")

    def test_container_verification_failure_restores_old_files(self):
        self.bad_container_hash = True
        with self.assertRaises(AssertionError):
            self.apply()
        self.assert_original()
        self.assertEqual(json.loads((self.release / "deployment.json").read_text())["status"], "rolled_back")

    def test_baseline_drift_is_rejected_before_publication(self):
        (self.public / "index.html").write_text("later live edit")
        with self.assertRaises(AssertionError):
            self.apply()
        self.assertFalse((self.release / "rollback").exists())
        self.assertEqual((self.public / "index.html").read_text(), "later live edit")

    def test_rollback_preserves_later_live_edits(self):
        self.apply()
        (self.public / "index.html").write_text("later live edit")
        with self.assertRaises(AssertionError):
            static.rollback(self.release, self.manifest_path)
        self.assertEqual((self.public / "index.html").read_text(), "later live edit")
        self.assertTrue((self.public / "docs/new-article/index.html").exists())


class StaticDocsAllowlistTest(unittest.TestCase):
    def test_every_generated_article_is_explicitly_allowlisted(self):
        public = SCRIPT.parent.parent / "proxy-token-site/public"
        topics = {str(Path(name).parent) for name in static.DOC_PAGE_INDEXES}
        actual = {str(path.relative_to(public)) for topic in topics
                  for path in (public / topic).glob("*/index.html")
                  if str(path.relative_to(public)) not in static.DOC_PAGE_INDEXES}
        self.assertEqual(actual, set(static.DOC_ARTICLE_INDEXES))
        self.assertEqual(len(static.FILES), len(set(static.FILES)))


if __name__ == "__main__":
    unittest.main()
