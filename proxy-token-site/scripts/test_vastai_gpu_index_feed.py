"""Publication integrity contracts with synthetic, non-provider fixtures."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

spec = importlib.util.spec_from_file_location('gpu_feed', Path(__file__).with_name('vastai_gpu_index_feed.py'))
feed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(feed)


class PublicationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'slots').mkdir()
        self.add_slot('20260909T000000Z')
        self.add_slot('20260909T120000Z')
        self.vram = patch.object(feed, 'read_market_vram', return_value={})
        self.vram.start()
        self.addCleanup(self.vram.stop)

    def add_slot(self, slot):
        run=self.root/'runs'/slot
        run.mkdir(parents=True)
        frame=pd.DataFrame([{'capture_slot':slot,'capture_id':slot+'-fixture','rental_type':'on-demand','gpu_name':'RTX 4090','available_gpus':4,'dph_total_per_gpu':value,'usd_per_100_dlperf':0.1} for value in [0.2,0.3,3.0]])
        artifacts={}
        for name in ['offers','machines','index']:
            path=run/(name+'.parquet');frame.to_parquet(path,index=False)
            artifacts[name]={'path':str(path.relative_to(self.root)),'rows':len(frame),'sha256':feed.sha256_file(path)}
        receipt={'capture_slot':slot,'capture_id':slot+'-fixture','status':'complete','source':{'source_dirty':False},'segments':[{'schema_sha256':'fixture'}],'artifacts':artifacts,'counts':{'invalid_machine_groups':2}}
        rp=run/'receipt.json';rp.write_text(json.dumps(receipt))
        pointer={'capture_slot':slot,'capture_id':receipt['capture_id'],'receipt':str(rp.relative_to(self.root)),'receipt_sha256':feed.sha256_file(rp)}
        (self.root/'slots'/(slot+'.json')).write_text(json.dumps(pointer))

    def test_gap_and_tail_are_preserved(self):
        result=feed.build_feed(self.root)
        self.assertEqual(result['coverage']['missing_slots'],['2026-09-09T06:00:00Z'])
        point=result['series'][0]['points'][0]
        self.assertAlmostEqual(point['raw_mean'],(0.2+0.3+3)/3)
        self.assertEqual(point['number'],12)
        self.assertEqual(point['raw_high'],3)
        self.assertEqual(result['captures'][0]['excluded_machine_groups'],2)

    def test_corrupt_consolidated_is_rejected_even_if_machines_are_valid(self):
        (self.root/'runs/20260909T120000Z/index.parquet').write_bytes(b'corrupt')
        result=feed.build_feed(self.root)
        self.assertEqual(result['capture_count'],1)
        self.assertEqual(len(result['warnings']),1)
        self.assertNotIn(str(self.root),json.dumps(result))

    def test_receipt_hash_is_mandatory(self):
        p=self.root/'slots/20260909T120000Z.json';value=json.loads(p.read_text());value.pop('receipt_sha256');p.write_text(json.dumps(value))
        self.assertEqual(feed.build_feed(self.root)['capture_count'],1)

    def test_mismatched_pointer_owner_is_rejected(self):
        p=self.root/'slots/20260909T120000Z.json';value=json.loads(p.read_text());value['capture_id']='wrong';p.write_text(json.dumps(value))
        self.assertEqual(feed.build_feed(self.root)['capture_count'],1)

    def test_bootstrap_remains_visible_but_provisional(self):
        p=self.root/'slots/20260909T120000Z.json';pointer=json.loads(p.read_text());rp=self.root/pointer['receipt'];receipt=json.loads(rp.read_text());receipt['segments']=[{}];rp.write_text(json.dumps(receipt));pointer['receipt_sha256']=feed.sha256_file(rp);p.write_text(json.dumps(pointer))
        result=feed.build_feed(self.root)
        self.assertEqual(result['capture_count'],2)
        self.assertEqual(result['formal_capture_count'],1)

if __name__=='__main__':unittest.main()
