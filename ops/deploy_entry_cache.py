#!/usr/bin/env python3
"""Preflight or apply entry cache headers with strict, order-independent guards.

The release directory contains release.json with source_commit and homepage_sha256.
An already-converged deployment is checked without restarting any container.
"""
import argparse, copy, datetime, fcntl, hashlib, json, os, pathlib, re, subprocess, time, urllib.request
from static_entry_cache import POLICY, with_entry_cache_policy, with_public_entry_cache_policy
os.umask(0o077)
ROOT=pathlib.Path(__file__).resolve().parent
CONFIG=pathlib.Path('/etc/leandata/phx-control-plane-20261008/phx-private-caddy.json')
COMPOSE=CONFIG.with_name('phx-compose.json')
NAME='leandata-phx-s4-direct-20261003-v1-caddy-1'
RECOVERY='/srv/leandata-operations/current/servarica_edge_recovery.py'
def run(args, data=None, timeout=45):
    r=subprocess.run(args,input=data,capture_output=True,timeout=timeout)
    if r.returncode:
        raise RuntimeError('Command failed: '+args[0]+' '+str(r.returncode)+' '+r.stderr.decode(errors='replace')[:300])
    return r.stdout
def inspect():
    return json.loads(run(['docker','inspect',NAME]))[0]
def identity():
    ids=run(['docker','ps','-q']).decode().split()
    return {x['Id']:(x['State']['StartedAt'],x['State']['Running']) for x in json.loads(run(['docker','inspect',*ids]))}
def digest(b):return hashlib.sha256(b).hexdigest()
def recover(*args):
    for attempt in range(8):
        r=subprocess.run(['python3',RECOVERY,'--site','phx',*args],capture_output=True,timeout=40)
        if r.returncode==0:return json.loads(r.stdout)
        if b'BlockingIOError' not in r.stderr:raise RuntimeError('Recovery control refused: '+r.stderr.decode(errors='replace')[-600:])
        time.sleep(1)
    raise RuntimeError('Recovery lock remained busy')
def write_existing(p,b):
    with p.open('r+b') as f:
        f.seek(0);f.write(b);f.truncate();f.flush();os.fsync(f.fileno())
def limits(x):return {k:x['HostConfig'][k] for k in ['Memory','MemorySwap','NanoCpus','PidsLimit','ReadonlyRootfs','SecurityOpt','PortBindings']}
def mounts(x):return sorted(json.dumps(m,sort_keys=True) for m in x['Mounts'])
def no_swap(x):
    cg=pathlib.Path('/proc/'+str(x['State']['Pid'])+'/cgroup').read_text().strip().split('::',1)[1]
    assert (pathlib.Path('/sys/fs/cgroup')/cg.lstrip('/')/'memory.swap.max').read_text().strip()=='0'
def validate(raw):
    run(['docker','exec','-i',NAME,'caddy','validate','--config','/dev/stdin'],raw)
def health():
    for _ in range(35):
        try:
            with urllib.request.urlopen('http://127.0.0.1:29085/site-health',timeout=2) as r:
                if r.status==200:return
        except Exception:pass
        time.sleep(1)
    raise RuntimeError('Static origin did not recover')
def public_checks(expected_homepage_sha256):
    rows=[]
    for path,expected in [('/','no-store, max-age=0'),('/docs/','no-store, max-age=0'),('/assets/token-page.js','no-cache, max-age=0, must-revalidate'),('/assets/docs-page.js','no-cache, max-age=0, must-revalidate')]:
        with urllib.request.urlopen('https://leandata.uk'+path,timeout=12) as r:
            raw=r.read(2*1024*1024);
            if r.status!=200 or r.headers.get('Cache-Control')!=expected:
                raise DeploymentInvariantError('public_cache_policy_mismatch', {'path':path,'status':r.status,'expected':expected,'actual':r.headers.get('Cache-Control')})
            etag=r.headers.get('ETag')
            rows.append({'path':path,'status':r.status,'cache_control':r.headers.get('Cache-Control'),'sha256':digest(raw)})
        if path=='/':
            if digest(raw)!=expected_homepage_sha256:
                raise DeploymentInvariantError('public_homepage_hash_mismatch', {'expected':expected_homepage_sha256,'actual':digest(raw)})
            req=urllib.request.Request('https://leandata.uk/',headers={'If-None-Match':etag,'If-Modified-Since':'Wed, 31 Dec 2099 23:59:59 GMT'})
            with urllib.request.urlopen(req,timeout=12) as r:
                assert r.status==200 and digest(r.read())==digest(raw)
    return rows

class DeploymentInvariantError(RuntimeError):
    def __init__(self, reason, details=None):
        self.reason = reason
        self.details = details or {}
        super().__init__(reason)


def assert_container_invariants(before, after):
    # Docker may reorder Mounts on restart; every mount value still matters.
    checks = [
        ('container_identity_changed', before['Id'] == after['Id']),
        ('container_image_changed', before['Image'] == after['Image']),
        ('container_configuration_changed', before['Config'] == after['Config']),
        ('container_mount_changed', mounts(before) == mounts(after)),
        ('container_limits_changed', limits(before) == limits(after)),
    ]
    for reason, valid in checks:
        if not valid:
            raise DeploymentInvariantError(reason)


def main(argv=None):
    global ROOT, NAME
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('release',type=pathlib.Path);p.add_argument('--apply',action='store_true');args=p.parse_args(argv)
    ROOT=args.release.resolve()
    release=json.loads((ROOT/'release.json').read_text());SOURCE=release['source_commit']
    if not re.fullmatch('[0-9a-f]{40}',SOURCE):raise ValueError('Invalid source commit')
    expected_homepage_sha256=release['homepage_sha256']
    if not re.fullmatch('[0-9a-f]{64}',expected_homepage_sha256):raise ValueError('Invalid homepage hash')
    owners=[
        ('caddy',pathlib.Path('/etc/leandata/phx-control-plane-20261008/phx-private-caddy.json'),with_entry_cache_policy),
        ('compat',pathlib.Path('/etc/leandata/phx-control-plane-20261008/phx-public-caddy.json'),with_public_entry_cache_policy),
    ]
    with open('/srv/leandata-site-public/entry-cache-deploy.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        prepared=[]
        merged=json.loads(run(['docker','compose','-p','leandata-phx-s4-direct-20261003-v1','-f',str(COMPOSE),'config','--format','json']))
        for role,config,transform in owners:
            NAME='leandata-phx-s4-direct-20261003-v1-'+role+'-1'
            original=config.read_bytes();before=inspect();no_swap(before)
            assert not config.is_symlink() and before['Image']=='sha256:dfcc7bc583dfd43060f41f87889f91f73259fd71793bbc9c9eb7b852a6a3b0af'
            mapped=next(m for m in before['Mounts'] if m['Destination']=='/etc/caddy/caddy.json')
            assert mapped['Source']==str(config) and not mapped['RW']
            candidate=(json.dumps(transform(json.loads(original)),indent=2)+'\n').encode()
            validate(candidate)
            prepared.append({'role':role,'path':config,'name':NAME,'original':original,'candidate':candidate,'before':before,'changed':candidate!=original})
        sample=recover('--once');assert not sample.get('blocked') and not sample.get('action'),sample
        if not any(row['changed'] for row in prepared):
            checks=public_checks(expected_homepage_sha256)
            result={'status':'already_applied','source_commit':SOURCE,'checks':checks,'restarts':0}
            (ROOT/'check.json').write_text(json.dumps(result,indent=2)+'\n')
            print(json.dumps(result));return 0
        metadata={row['role']:{'before_sha256':digest(row['original']),'candidate_sha256':digest(row['candidate']),'container_id':row['before']['Id']} for row in prepared}
        if not args.apply:
            preflight={'source':SOURCE,'owners':metadata,'compose_sha256':digest(COMPOSE.read_bytes()),'validated':True}
            (ROOT/'preflight.json').write_text(json.dumps(preflight,indent=2)+'\n')
            for row in prepared:(ROOT/(row['role']+'-candidate.json')).write_bytes(row['candidate'])
            print(json.dumps(preflight));return 0
        preflight=json.loads((ROOT/'preflight.json').read_text())
        assert preflight['owners']==metadata and preflight['compose_sha256']==digest(COMPOSE.read_bytes())
        backup=ROOT/'rollback';backup.mkdir(mode=0o700)
        for row in prepared:
            (backup/row['path'].name).write_bytes(row['original'])
            (backup/(row['role']+'-before.private.json')).write_text(json.dumps(row['before']))
        for path in [COMPOSE,pathlib.Path('/etc/leandata/direct-phx-recovery.json')]:
            (backup/path.name).write_bytes(path.read_bytes())
        state=identity();maintained=False;changed=[];phase='maintenance'
        try:
            recover('--maintenance','on');maintained=True
            for row in prepared:
                if not row['changed']:continue
                phase='apply:'+row['role']
                write_existing(row['path'],row['candidate']);changed.append(row)
                run(['docker','restart','--time','10',row['name']],timeout=35)
                NAME=row['name'];after=inspect();no_swap(after);before=row['before']
                phase='container_invariants:'+row['role']
                assert_container_invariants(before,after)
            health()
            for attempt in range(20):
                try:
                    with urllib.request.urlopen('https://leandata.uk/',timeout=3) as r:assert r.status==200
                    break
                except (OSError,TimeoutError):time.sleep(1)
            phase='public_acceptance'
            checks=public_checks(expected_homepage_sha256)
            newstate=identity();ids={row['before']['Id'] for row in prepared}
            assert set(newstate)==set(state) and all(newstate[k]==v for k,v in state.items() if k not in ids)
            assert json.loads(run(['docker','compose','-p','leandata-phx-s4-direct-20261003-v1','-f',str(COMPOSE),'config','--format','json']))==merged
            phase='recovery_admission'
            recover('--admit');recover('--maintenance','off');maintained=False
            status=recover('--once');assert not status.get('blocked') and not status.get('action'),status
            result={'source_commit':SOURCE,'status':'accepted','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'owners':metadata,'website_proxies_restarted':[r['name'] for r in prepared],'other_owners_unchanged':True,'kernel_no_swap':True,'checks':checks,'recovery':status,'rollback':str(backup)}
            (ROOT/'acceptance.json').write_text(json.dumps(result,indent=2)+'\n')
            print(json.dumps({k:v for k,v in result.items() if k!='recovery'}))
        except BaseException as error:
            failure={'status':'rollback_started','phase':phase,'reason':getattr(error,'reason',type(error).__name__),'details':getattr(error,'details',{}),'source_commit':SOURCE}
            (ROOT/'failure.json').write_text(json.dumps(failure,indent=2)+'\n')
            try:
                for row in reversed(changed):
                    write_existing(row['path'],row['original']);run(['docker','restart','--time','10',row['name']],timeout=35)
                if changed:health();recover('--admit')
                if maintained:recover('--maintenance','off')
                failure['status']='rolled_back'
            except BaseException as rollback_error:
                failure['status']='rollback_failed'
                failure['rollback_error']=type(rollback_error).__name__
                raise
            finally:
                (ROOT/'failure.json').write_text(json.dumps(failure,indent=2)+'\n')
            raise


if __name__ == "__main__":
    raise SystemExit(main())
