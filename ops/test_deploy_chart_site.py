import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('chart_deploy', Path(__file__).with_name('deploy_chart_site.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ChartReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.site, self.root = base / 'site', base / 'releases'
        self.release = self.root / ('a' * 40)
        self.source = self.release / 'proxy-token-site'
        self.manifest = {'commit': 'a' * 40, 'files': {}, 'dependencies': {}}
        for name in module.FILES:
            target, source = self.site / name, self.source / name
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text('new-' + name)
            old = None
            if not name.startswith('public/chart/') and 'chart-' not in name:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('old-' + name)
                old = module.sha(target)
            self.manifest['files'][name] = {'before': old, 'after': module.sha(source)}
        for name in module.DEPENDENCIES:
            target = self.site / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('protected-' + name)
            self.manifest['dependencies'][name] = module.sha(target)
        registry = self.site / 'remote_proxy/users.json'
        registry.parent.mkdir(parents=True)
        registry.write_text('{}')
        self.manifest_path = self.release / 'manifest.json'
        self.manifest_path.write_text(json.dumps(self.manifest))
        compose = base / 'compose.yml'
        compose.write_text('services: {}')
        self.ui = {'Id': 'portal', 'State': {'StartedAt': 'before'}, 'RestartCount': 0, 'Mounts': [
            {'Source': str(self.site / 'public'), 'Destination': '/app/public', 'RW': False},
            {'Source': str(self.site / 'server.js'), 'Destination': '/app/server.js', 'RW': False}],
            'Config': {'Labels': {'com.docker.compose.project': 'leandata', 'com.docker.compose.project.config_files': str(compose)}}}
        self.other = {'Id': 'rest', 'State': {'StartedAt': 'unchanged'}, 'RestartCount': 0}
        self.patches = [patch.object(module, 'SITE', self.site), patch.object(module, 'ROOT', self.root),
            patch.object(module, 'inspect', return_value={module.CONTAINER: self.ui, 'rest': self.other}),
            patch.object(module, 'verify_health'), patch.object(module.subprocess, 'run'), patch.object(module, 'run', side_effect=self.fake_run)]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def fake_run(self, *args):
        if 'compose' in args:
            return json.dumps({'services': {'leandata-ui': {'volumes': [{'source': str(self.site / 'public'), 'target': '/app/public', 'read_only': True}]}}})
        if 'sha256sum' in args:
            name = args[-1].removeprefix('/app/')
            return module.sha(self.site / name) + ' ' + args[-1]
        raise AssertionError(args)

    def test_preflight_never_writes_live_files(self):
        module.deploy(self.release, self.manifest_path, False)
        self.assertEqual((self.site / 'server.js').read_text(), 'old-server.js')
        self.assertFalse((self.release / 'rollback').exists())

    def test_removed_release_uses_only_allowlisted_current_compose_file(self):
        old = '/srv/leandata/releases/old/services/leandata-v2/docker-compose.aliyun.yml'
        with patch.object(module.Path, 'is_file', side_effect=[False, True]):
            self.assertEqual(module.compose_file(old), '/srv/leandata/current/services/leandata-v2/docker-compose.aliyun.yml')
        with patch.object(module.Path, 'is_file', return_value=False):
            with self.assertRaises(AssertionError):
                module.compose_file('/etc/unrelated-missing.yml')
            with self.assertRaises(AssertionError):
                module.compose_file('/srv/leandata/releases/old/unrelated.yml')

    def test_drift_rejected_before_mutation(self):
        (self.site / 'server.js').write_text('another release')
        with self.assertRaises(AssertionError):
            module.deploy(self.release, self.manifest_path, True)
        self.assertFalse((self.release / 'rollback').exists())

    def test_success_preserves_server_and_directory_inodes(self):
        server_inode, public_inode = (self.site / 'server.js').stat().st_ino, (self.site / 'public').stat().st_ino
        module.deploy(self.release, self.manifest_path, True)
        self.assertEqual(server_inode, (self.site / 'server.js').stat().st_ino)
        self.assertEqual(public_inode, (self.site / 'public').stat().st_ino)
        self.assertEqual((self.site / 'server.js').read_text(), 'new-server.js')
        self.assertEqual(json.loads((self.release / 'deployment.json').read_text())['status'], 'host_container_verified_public_acceptance_pending')

    def test_failed_container_readback_restores_old_files(self):
        with patch.object(module, 'run', side_effect=lambda *args: self.fake_run(*args) if 'compose' in args else 'wronghash'):
            with self.assertRaises(AssertionError):
                module.deploy(self.release, self.manifest_path, True)
        self.assertEqual((self.site / 'server.js').read_text(), 'old-server.js')
        self.assertFalse((self.site / 'public/chart/index.html').exists())
        self.assertEqual(json.loads((self.release / 'deployment.json').read_text())['status'], 'rolled_back')

    def test_static_followup_does_not_restart_portal(self):
        (self.source / 'server.js').write_bytes((self.site / 'server.js').read_bytes())
        self.manifest['files']['server.js']['after'] = self.manifest['files']['server.js']['before']
        self.manifest_path.write_text(json.dumps(self.manifest))
        module.deploy(self.release, self.manifest_path, True)
        self.assertFalse(any(call.args[0][:2] == ['docker', 'restart'] for call in module.subprocess.run.call_args_list))


if __name__ == '__main__':
    unittest.main()
