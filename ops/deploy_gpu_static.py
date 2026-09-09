#!/usr/bin/env python3
"""Deploy the reviewed Alternative Data static slice from one Git commit."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import shlex
import subprocess
import tarfile
import tempfile

FILES = [
    'public/alternative-data/index.html', 'public/gpu-index.css',
    'public/gpu-index-page.jsx', 'public/assets/gpu-index-page.js',
    'public/token-page.jsx', 'public/assets/token-page.js',
    'public/docs/docs-site.jsx', 'public/assets/docs-page.js', 'public/language.js',
]
REMOTE = r'''
import hashlib,json,os,pathlib,shutil,sys,datetime
stage=pathlib.Path(sys.argv[1]);manifest=json.loads((stage/'manifest.json').read_text())
root=pathlib.Path('/srv/leandata/proxy-token-site');public_inode=(root/'public').stat().st_ino
registry=root/'remote_proxy/users.json';registry_hash=hashlib.sha256(registry.read_bytes()).hexdigest()
backup=stage/'rollback';backup.mkdir(exist_ok=False)
changed=[]
try:
    for rel,expected in manifest['files'].items():
        source=stage/rel;target=root/rel
        if not rel.startswith('public/') or '..' in pathlib.Path(rel).parts:raise RuntimeError('invalid path')
        if hashlib.sha256(source.read_bytes()).hexdigest()!=expected:raise RuntimeError('release hash mismatch')
        if target.exists():
            previous=backup/rel;previous.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,previous)
        target.parent.mkdir(parents=True,exist_ok=True)
        next_path=target.with_name(target.name+'.gpu-next')
        shutil.copyfile(source,next_path);os.chmod(next_path,0o644);os.replace(next_path,target)
        changed.append(rel)
    import pwd
    operator=pwd.getpwnam('ubuntu');os.chown(root/'public/alternative-data',operator.pw_uid,operator.pw_gid)
    assert (root/'public').stat().st_ino==public_inode
    assert hashlib.sha256(registry.read_bytes()).hexdigest()==registry_hash
    manifest.update({'deployed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'public_inode_preserved':True,'registry_unchanged':True})
    (stage/'deployment-receipt.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'commit':manifest['commit'],'files':len(changed),'registry_unchanged':True,'public_inode_preserved':True}))
except Exception:
    for rel in reversed(changed):
        target=root/rel;previous=backup/rel
        if previous.exists():shutil.copyfile(previous,target)
        else:target.unlink(missing_ok=True)
    raise
'''


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('commit')
    parser.add_argument('--ssh-target',default='ubuntu@100.88.18.95')
    parser.add_argument('--ssh-key',default='/home/ikkipipi/下载/lol.pem')
    args=parser.parse_args()
    repo=Path(__file__).resolve().parents[1]
    commit=subprocess.check_output(['git','rev-parse',args.commit+'^{commit}'],cwd=repo,text=True).strip()
    manifest={'commit':commit,'files':{}}
    with tempfile.TemporaryDirectory(prefix='leandata-gpu-release-') as tmp:
        archive=Path(tmp)/'static.tar'
        with tarfile.open(archive,'w') as tar:
            for rel in FILES:
                payload=subprocess.check_output(['git','show',commit+':proxy-token-site/'+rel],cwd=repo)
                manifest['files'][rel]=hashlib.sha256(payload).hexdigest()
                info=tarfile.TarInfo(rel);info.size=len(payload);info.mode=0o644;tar.addfile(info,io.BytesIO(payload))
            payload=json.dumps(manifest,indent=2).encode();info=tarfile.TarInfo('manifest.json');info.size=len(payload);tar.addfile(info,io.BytesIO(payload))
        ssh=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15','-o','IdentitiesOnly=yes','-i',args.ssh_key,args.ssh_target]
        stage='/srv/leandata/site-releases/gpu-'+commit
        command='sudo -n mkdir -p '+shlex.quote(stage)+' && sudo -n tar -xf - --no-same-owner -C '+shlex.quote(stage)
        with archive.open('rb') as handle:subprocess.run(ssh+[command],stdin=handle,check=True,timeout=60)
        subprocess.run(ssh+['sudo -n python3 - '+shlex.quote(stage)],input=REMOTE.encode(),check=True,timeout=60)
        print(json.dumps(manifest))

if __name__=='__main__':main()
