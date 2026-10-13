#!/usr/bin/env python3
"""Private logical backups for the dedicated commerce database; never delete custody."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path('/srv/leandata-commerce-20261013/backups')
CONTAINER = 'leandata-commerce-20261013-postgres-1'

def main():
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    if shutil.disk_usage(ROOT).free < 8 * 1024**3 or len(list(ROOT.glob('*.dump'))) >= 64:
        raise RuntimeError('backup reserve exhausted; retained backups require an explicit policy')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    pending = ROOT / (stamp + '.pending')
    destination = ROOT / (stamp + '.dump')
    with pending.open('xb') as output:
        subprocess.run(['docker', 'exec', CONTAINER, 'pg_dump', '-U', 'leandata_commerce_owner',
                        '-d', 'leandata_commerce', '-Fc'], stdout=output, stderr=subprocess.PIPE,
                       check=True, timeout=60)
        output.flush()
        os.fsync(output.fileno())
    with pending.open('rb') as source:
        subprocess.run(['docker', 'exec', '-i', CONTAINER, 'pg_restore', '--list'],
                       stdin=source, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                       check=True, timeout=30)
    pending.rename(destination)
    content = destination.read_bytes()
    receipt = {'schema': 1, 'file': destination.name, 'bytes': len(content),
               'sha256': hashlib.sha256(content).hexdigest(), 'archive_catalog_readback': True}
    manifest = destination.with_suffix('.json')
    with manifest.open('x') as output:
        json.dump(receipt, output)
        output.flush()
        os.fsync(output.fileno())
    directory = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    print(json.dumps(receipt))

if __name__ == '__main__':
    main()
