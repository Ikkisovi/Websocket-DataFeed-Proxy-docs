"""Publication integrity contracts with synthetic, non-provider fixtures."""
import gzip
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

    def add_nebius(self, slot, *, status='complete', points=(), price=1.7):
        pointer=json.loads((self.root/'slots'/(slot+'.json')).read_text())
        rp=self.root/pointer['receipt'];receipt=json.loads(rp.read_text())
        if status!='complete':
            receipt['sources']={'nebius_spot':{'status':status,'spec_sha256':'fixture'}}
        else:
            run=self.root/'runs'/slot;identity={'capture_slot':slot,'capture_id':slot+'-fixture'}
            snapshot=pd.DataFrame([{**identity,'sku_id':'sku-1','gpu_name':'H200','gpu_name_raw':'Preemptible NVIDIA® H200 NVLink','platform_raw':'gpu-h200-sxm','region':'eu-north1','price_usd_per_gpu_hour':price,'currency':'usd','unit_title':'GPU hour','effective_time':'2026-10-19T21:51:00Z','snapshot_time':'2026-10-19T22:01:43Z'}])
            series=pd.DataFrame([{**identity,'window':'1d','granularity':'GRANULARITY_MINUTE_15','sku_id':'sku-1','gpu_name':'H200','region':'eu-north1','timestamp':ts,'price_usd_per_gpu_hour':value} for ts,value in points])
            artifacts={}
            for name,frame in [('nebius_spot',snapshot),('nebius_spot_series',series)]:
                path=run/(name+'.parquet');frame.to_parquet(path,index=False)
                artifacts[name]={'path':str(path.relative_to(self.root)),'rows':len(frame),'sha256':feed.sha256_file(path)}
            raw=run/'raw';raw.mkdir(exist_ok=True)
            segment=raw/'nebius-spot-snapshot.json.gz';segment.write_bytes(gzip.compress(b'{}'))
            receipt['sources']={'nebius_spot':{'status':'complete','spec_sha256':'fixture','snapshot_time':'2026-10-19T22:01:43Z','segments':[{'segment':'nebius-spot-snapshot.json.gz','raw_sha256':feed.sha256_file(segment)}],'artifacts':artifacts}}
        rp.write_text(json.dumps(receipt));pointer['receipt_sha256']=feed.sha256_file(rp)
        (self.root/'slots'/(slot+'.json')).write_text(json.dumps(pointer))

    def test_nebius_series_merge_counts_revisions(self):
        self.add_nebius('20260909T000000Z',points=[('2026-09-08T23:00:00Z',2.0),('2026-09-08T23:15:00Z',1.7)],price=1.7)
        self.add_nebius('20260909T120000Z',points=[('2026-09-08T23:15:00Z',1.9),('2026-09-08T23:30:00Z',1.5)],price=1.5)
        section=feed.build_feed(self.root)['nebius_spot']
        self.assertEqual(section['status'],'ok')
        self.assertEqual(section['capture_count'],2)
        self.assertEqual(section['gaps'],[])
        self.assertEqual(len(section['snapshots']),2)
        self.assertEqual(section['latest'][0]['price_usd_per_gpu_hour'],1.5)
        self.assertEqual(section['snapshot_time'],'2026-10-19T22:01:43Z')
        self.assertEqual(section['series_revisions'],1)
        points=section['series'][0]['points']
        self.assertEqual([point['time'] for point in points],['2026-09-08T23:00:00Z','2026-09-08T23:15:00Z','2026-09-08T23:30:00Z'])
        self.assertEqual(points[1]['value'],1.9)

    def test_failed_nebius_source_is_reported_as_gap_without_blocking(self):
        self.add_nebius('20260909T000000Z',points=[('2026-09-08T23:00:00Z',2.0)])
        self.add_nebius('20260909T120000Z',status='failed')
        result=feed.build_feed(self.root)
        section=result['nebius_spot']
        self.assertEqual(result['warnings'],[])
        self.assertEqual(result['capture_count'],2)
        self.assertEqual(section['status'],'ok')
        self.assertEqual(section['gaps'],[{'slot':'2026-09-09T12:00:00Z','reason':'nebius source is failed'}])

    def test_corrupt_nebius_artifact_degrades_to_gap(self):
        self.add_nebius('20260909T000000Z',points=[('2026-09-08T23:00:00Z',2.0)])
        self.add_nebius('20260909T120000Z',points=[('2026-09-08T23:00:00Z',2.0)])
        (self.root/'runs/20260909T120000Z/nebius_spot_series.parquet').write_bytes(b'corrupt')
        result=feed.build_feed(self.root)
        self.assertEqual(result['warnings'],[])
        self.assertEqual(result['capture_count'],2)
        self.assertEqual([gap['slot'] for gap in result['nebius_spot']['gaps']],['2026-09-09T12:00:00Z'])

    def test_pre_source_slots_are_not_reported_as_gaps(self):
        section=feed.build_feed(self.root)['nebius_spot']
        self.assertEqual(section['status'],'no_data')
        self.assertEqual(section['gaps'],[])
        self.assertEqual(section['pre_source_slots'],2)

if __name__=='__main__':unittest.main()
