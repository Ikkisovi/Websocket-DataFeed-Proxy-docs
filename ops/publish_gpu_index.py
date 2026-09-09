#!/usr/bin/env python3
"""Publish only the validated aggregate GPU feed; never transfer capture roots."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile

REMOTE_WRITER = r'''
import hashlib,json,os,pathlib,sys,tempfile
payload=sys.stdin.buffer.read(8*1024*1024+1)
if len(payload)>8*1024*1024: raise SystemExit('feed exceeds size limit')
data=json.loads(payload)
if data.get('schema_version')!=1 or not data.get('captures') or data.get('warnings'):
    raise SystemExit('invalid aggregate feed')
root=pathlib.Path('/srv/leandata/proxy-token-site/public/alternative-data')
if not (root/'index.html').is_file(): raise SystemExit('alternative data page is not deployed')
fd,name=tempfile.mkstemp(prefix='.gpu-index-',dir=root)
try:
    with os.fdopen(fd,'wb') as out:
        out.write(payload);out.flush();os.fsync(out.fileno())
    os.chmod(name,0o644)
    os.replace(name,root/'gpu-index.json')
    print(hashlib.sha256(payload).hexdigest())
finally:
    if os.path.exists(name):os.unlink(name)
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('/home/ikkipipi/openalice/data/quant-research/market-indices/vastai-gpu'))
    parser.add_argument('--ssh-target', default='ubuntu@100.88.18.95')
    parser.add_argument('--ssh-key', type=Path, default=Path('/home/ikkipipi/下载/lol.pem'))
    parser.add_argument('--state-dir', type=Path, default=Path.home()/'.local/state/leandata-gpu-publisher')
    parser.add_argument('--output', type=Path, help='Write a local preview instead of publishing')
    args = parser.parse_args()
    canonical = Path('/home/ikkipipi/openalice')
    if canonical.resolve() != Path('/mnt/intel_ssd/ikkipipi_data/home-offload/openalice'):
        raise RuntimeError('canonical storage mismatch')
    mount = subprocess.check_output(['findmnt','-n','-o','TARGET','-T',str(canonical)],text=True).strip()
    if mount != '/mnt/intel_ssd': raise RuntimeError('backing mount mismatch')
    args.state_dir.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (args.state_dir/'publish.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        exporter = Path(__file__).resolve().parents[1]/'proxy-token-site/scripts/vastai_gpu_index_feed.py'
        result = subprocess.run([sys.executable,str(exporter),'--root',str(args.root)],capture_output=True,timeout=180,check=True)
        data=json.loads(result.stdout)
        if data.get('warnings') or not data.get('captures'):raise RuntimeError('capture validation failed; previous publication retained')
        payload=json.dumps(data,separators=(',',':'),allow_nan=False).encode()+b'\n'
        digest=hashlib.sha256(payload).hexdigest()
        if args.output:
            args.output.parent.mkdir(parents=True,exist_ok=True)
            fd,name=tempfile.mkstemp(prefix='.gpu-feed-',dir=args.output.parent)
            try:
                with os.fdopen(fd,'wb') as out:out.write(payload)
                os.replace(name,args.output)
            finally:
                if os.path.exists(name):os.unlink(name)
        else:
            command=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15','-o','IdentitiesOnly=yes','-i',str(args.ssh_key),args.ssh_target,'python3 -c '+shlex.quote(REMOTE_WRITER)]
            remote=subprocess.run(command,input=payload,capture_output=True,timeout=60,check=True)
            if remote.stdout.decode().strip()!=digest:raise RuntimeError('remote hash mismatch')
        receipt={'sha256':digest,'latest_slot':data['latest_slot'],'capture_count':data['capture_count'],'formal_capture_count':data['formal_capture_count'],'generated_at':data['generated_at'],'destination':'local-preview' if args.output else 'leandata.uk/alternative-data/gpu-index.json'}
        (args.state_dir/'last-publish.json').write_text(json.dumps(receipt,indent=2)+'\n')
        print(json.dumps(receipt))

if __name__=='__main__':
    try:main()
    except Exception as error:
        print('GPU aggregate publication failed ('+type(error).__name__+'); previous remote feed retained',file=sys.stderr)
        sys.exit(1)
