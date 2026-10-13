import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('commerce_deploy', Path(__file__).with_name('deploy_commerce_postgres.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

class RecoveryLockTests(unittest.TestCase):
    def test_only_busy_lock_is_retried(self):
        busy = subprocess.CompletedProcess([], 1, b'', b'BlockingIOError: lock busy')
        ok = subprocess.CompletedProcess([], 0, b'{"admitted":true}', b'')
        with patch.object(deploy.subprocess, 'run', side_effect=[busy, ok]) as run, patch.object(deploy.time, 'sleep'):
            self.assertEqual(deploy.recovery('--admit'), '{"admitted":true}')
            self.assertEqual(run.call_count, 2)

    def test_other_admission_failures_are_not_retried(self):
        with tempfile.TemporaryDirectory() as directory:
            bad = subprocess.CompletedProcess([], 1, b'', b'admission requires healthy owners')
            with patch.object(deploy, 'STATE', Path(directory)), patch.object(deploy.subprocess, 'run', return_value=bad) as run:
                with self.assertRaises(RuntimeError):
                    deploy.recovery('--admit')
                self.assertEqual(run.call_count, 1)

if __name__ == '__main__':
    unittest.main()
