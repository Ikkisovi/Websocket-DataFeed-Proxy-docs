import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0,str(Path(__file__).parent))
spec=importlib.util.spec_from_file_location('portal_cutover',Path(__file__).with_name('deploy_portal_core.py'))
core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core)


class PortalCutoverTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name);self.state=root/'state';self.state.mkdir();self.data=root/'data';self.data.mkdir()
        self.compose=root/'compose.json';self.compose.write_text('{"original":true}')
        self.snapshot={'accounts':[{'username':'fixture','unknown':None}], 'pending':[],
            'bulk_orders':[], 'registry':{'users':[{'user_id':'fixture','token':'fixture-only-token'}]}}
        for name,file in core.FILES.items():
            path=self.data/file;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(self.snapshot[name]));path.chmod(0o640)
        self.addCleanup(mock.patch.stopall)
        mock.patch.multiple(core,STATE=self.state,DATA_ROOT=self.data).start()
        mock.patch.multiple(core.commerce,STATE=self.state,PORTAL_COMPOSE=self.compose).start()

    def prepare_plan(self):
        sha='a'*40;plan={'source_commit':sha,'ui_id':'old-ui','database_id':'db','image':'fixture-image',
            'compose_sha256':hashlib.sha256(self.compose.read_bytes()).hexdigest()}
        (self.state/'prepared.json').write_text(json.dumps(plan))
        mock.patch.object(core.commerce,'inspect',side_effect=lambda n:{'Id':'db' if n==core.commerce.DB else 'old-ui'}).start()
        mock.patch.object(core.commerce,'run',side_effect=lambda args,*rest:
            json.dumps([{'Name':'/'+core.commerce.UI,'Id':'old-ui'},{'Name':'/db','Id':'db'}]) if args[:2]==['docker','inspect'] else 'old-ui db' if args[:2]==['docker','ps'] else '').start()
        mock.patch.object(core.commerce,'portal').start();mock.patch.object(core.commerce,'recovery').start()
        mock.patch.object(core.commerce,'limits').start();mock.patch.object(core,'healthy').start()
        return sha

    def test_snapshot_is_exact_and_missing_source_is_rejected(self):
        self.assertEqual(core.snapshot(),self.snapshot)
        (self.data/core.FILES['accounts']).unlink()
        with self.assertRaises(RuntimeError):core.snapshot()

    def test_rollback_uses_latest_export_and_preserves_file_metadata(self):
        latest={**self.snapshot,'accounts':[{'username':'newly-accepted'}]}
        (self.state/'rollback-latest.json').write_text(json.dumps(latest))
        with mock.patch.object(core,'maintenance',return_value={'exported':True}) as exporter:
            core.export_latest('fixture-image')
        exporter.assert_called_once_with('fixture-image','owner','export','rollback-latest.json')
        self.assertEqual(json.loads((self.data/core.FILES['accounts']).read_text()),latest['accounts'])
        self.assertEqual((self.data/core.FILES['registry']).stat().st_mode & 0o777,0o640)

    def test_owner_drift_is_rejected_before_fencing(self):
        sha=self.prepare_plan()
        with mock.patch.object(core.commerce,'inspect',return_value={'Id':'changed-owner'}):
            with self.assertRaises(RuntimeError):core.cutover(Path('/fixture-release'),sha)
        core.commerce.recovery.assert_not_called()

    def test_failure_after_import_exports_latest_before_restoring_old_writer(self):
        sha=self.prepare_plan();original=self.compose.read_bytes()
        with mock.patch.object(core,'maintenance',return_value={'counts':{}}), \
             mock.patch.object(core,'restore_backup',side_effect=RuntimeError('fixture restore failure')), \
             mock.patch.object(core,'export_latest',return_value={'exported':True}) as exporter:
            with self.assertRaises(RuntimeError):core.cutover(Path('/fixture-release'),sha)
        exporter.assert_called_once_with('fixture-image')
        self.assertEqual(self.compose.read_bytes(),original)
        self.assertTrue(json.loads((self.state/'rollback-receipt.json').read_text())['rolled_back'])
        core.commerce.portal.assert_any_call('up','-d','--no-deps','ui')


if __name__=='__main__':unittest.main()
