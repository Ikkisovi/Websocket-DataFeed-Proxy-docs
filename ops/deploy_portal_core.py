#!/usr/bin/env python3
"""Move PHX portal identity storage into its existing private commerce database."""

import argparse
import fcntl
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time
import urllib.request

import deploy_commerce_postgres as commerce

STATE = Path('/srv/leandata-portal-core-20261013')
DATA_ROOT = Path('/srv/leandata-control-plane-20261008')
FILES = {'accounts': 'portal/data/users.json', 'pending': 'portal/data/pending.json',
         'bulk_orders': 'portal/data/bulk-orders.json', 'registry': 'registry/users.json'}
commerce.STATE = STATE


def maintenance(image, role, action, file=None):
    mounts = ['-v', str(commerce.CONFIG / (role + '-url')) + ':/run/database-url:ro']
    args = [action]
    if action == 'import':
        mounts += ['-v', str(STATE / 'snapshot.json') + ':/run/snapshot.json:ro']
        args += ['/run/snapshot.json']
    elif action == 'export':
        mounts += ['-v', str(STATE) + ':/run/export']
        args += ['/run/export/' + file]
    return json.loads(commerce.run(['docker','run','--rm','--network',commerce.NETWORK,
        '--user','0:0','--memory','128m','--memory-swap','128m','--cpus','0.5','--pids-limit','64',
        '-e','COMMERCE_DATABASE_URL_FILE=/run/database-url',*mounts,'--entrypoint','node',
        image,'commerce/portal-admin.cjs',*args]))


def healthy():
    for _ in range(30):
        try:
            if urllib.request.urlopen('http://127.0.0.1:29300/',timeout=3).status == 200:
                return
        except Exception:
            time.sleep(1)
    raise RuntimeError('Portal startup did not pass')


def accept_accounts(expected):
    principals = expected['registry']['users']
    candidates = [row for row in expected['accounts'] if str(row.get('username','')).startswith('site-smoke-') and row.get('phone')]
    for account in candidates:
        matches = [row for row in expected['accounts'] if str(row.get('username','')).strip().lower()==str(account['username']).strip().lower()
                   and str(row.get('phone','')).strip()==str(account['phone']).strip()]
        if len(matches)!=1:
            continue
        uid = str(account.get('account_id') or account['username']).strip()
        principal = next((row for row in principals if row.get('user_id') == uid and row.get('token')), None)
        if principal:
            break
    else:
        raise RuntimeError('No existing smoke identity is available for live acceptance')
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def request(path, body=None):
        req = urllib.request.Request('https://leandata.uk'+path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Content-Type':'application/json'})
        with client.open(req,timeout=20) as response:
            return response.status,json.load(response)
    status, login = request('/api/account/login',{'credential':{'username':account['username'],
        'phone':account['phone'],'token':principal['token']}})
    if status!=200 or not login.get('success'):
        raise RuntimeError('Canonical database account login failed')
    summaries = {'login_http':status}
    try:
        for path in ['/api/account/session','/api/account/overview','/api/payment/checkout-info']:
            status, payload = request(path)
            if status!=200 or not payload.get('success'):
                raise RuntimeError('Public account readback failed')
            summaries[path] = {'http':status}
            if path.endswith('checkout-info'):
                summaries[path]['bundles'] = len(payload['bundles'])
    finally:
        summaries['logout_http'] = request('/api/account/logout',{})[0]
    return summaries


def prepare(release, sha):
    ui = commerce.inspect(commerce.UI)
    config_bytes = commerce.PORTAL_COMPOSE.read_bytes()
    image = 'openalice/phx-portal-core:' + sha[:12] + '-arm64'
    plan = {'source_commit':sha,'image':image,'base_image':ui['Config']['Image'],
            'base_image_id':ui['Image'],'ui_id':ui['Id'],
            'database_id':commerce.inspect(commerce.DB)['Id'],
            'compose_sha256':hashlib.sha256(config_bytes).hexdigest()}
    if (STATE/'prepared.json').exists():
        raise RuntimeError('A preparation already exists; preserve its custody')
    if shutil.disk_usage(STATE).free < 10*1024**3:
        raise RuntimeError('Portal release disk reserve failed')
    context = release/'proxy-token-site'
    base_tag = 'openalice/phx-portal-core-base:' + sha[:12]
    commerce.run(['docker','tag',ui['Image'],base_tag])
    commerce.run(['docker','build','-f',str(context/'commerce/Dockerfile'),
        '--build-arg','PORTAL_BASE_IMAGE='+base_tag,'--build-arg','SOURCE_COMMIT='+sha,
        '-t',image,str(context)],300)
    plan['image_id'] = json.loads(commerce.run(['docker','image','inspect',image]))[0]['Id']
    candidate = json.loads(config_bytes)
    if candidate['services']['ui']['environment'].get('COMMERCE_BACKEND') != 'postgres':
        raise RuntimeError('Existing commerce ownership is not admitted')
    candidate['services']['ui']['image'] = image
    candidate['services']['ui']['environment']['PORTAL_BACKEND'] = 'postgres'
    candidate_path = STATE/'portal-compose.candidate.json'
    candidate_path.write_text(json.dumps(candidate))
    commerce.run(['docker','compose','-f',str(candidate_path),'config','--quiet'])
    # Only schema creation and grants occur while the old file writer is active.
    maintenance(image,'owner','migrate')
    maintenance(image,'owner','grant-runtime')
    (STATE/'prepared.json').write_text(json.dumps(plan))
    return plan


def snapshot():
    value = {}
    for name, filename in FILES.items():
        file = DATA_ROOT/filename
        if not file.is_file() or file.is_symlink():
            raise RuntimeError('A required fenced portal source is missing or indirect')
        value[name] = json.loads(file.read_bytes())
    (STATE/'snapshot.json').write_text(json.dumps(value,indent=2))
    return value


def restore_backup(release, expected):
    receipt = json.loads(commerce.run(['python3',str(release/'proxy-token-site/commerce/backup.py')]))
    dump = Path('/srv/leandata-commerce-20261013/backups')/receipt['file']
    database = 'leandata_portal_restore_20261013_test'
    commerce.run(['docker','exec',commerce.DB,'createdb','-U','leandata_commerce_owner','-T','template0',database])
    try:
        with dump.open('rb') as stream:
            result = subprocess.run(['docker','exec','-i',commerce.DB,'pg_restore','-U',
                'leandata_commerce_owner','-d',database,'--exit-on-error'],stdin=stream,
                stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
        if result.returncode:
            raise RuntimeError('Full commerce/portal backup restore failed')
        tables = {'accounts':'accounts','pending':'registrations','bulk_orders':'bulk_orders','registry':'principals'}
        actual = {}
        for name, table in tables.items():
            rows = json.loads(commerce.run(['docker','exec',commerce.DB,'psql','-U',
                'leandata_commerce_owner','-d',database,'-Atc',
                "SELECT COALESCE(jsonb_agg(payload ORDER BY ordinal),'[]'::jsonb) FROM portal."+table]))
            if name == 'registry':
                extra = json.loads(commerce.run(['docker','exec',commerce.DB,'psql','-U',
                    'leandata_commerce_owner','-d',database,'-Atc',"SELECT extra FROM portal.documents WHERE name='registry'"]))
                actual[name] = {**extra,'users':rows}
            else:
                actual[name] = rows
        if actual != expected:
            raise RuntimeError('Restored portal payloads differ from the fenced source')
        orders = commerce.run(['docker','exec',commerce.DB,'psql','-U','leandata_commerce_owner',
            '-d',database,'-Atc',"SELECT COALESCE(jsonb_agg(payload ORDER BY ordinal),'[]'::jsonb) FROM commerce.orders"])
        live = commerce.run(['docker','exec',commerce.DB,'psql','-U','leandata_commerce_owner',
            '-d','leandata_commerce','-Atc',"SELECT COALESCE(jsonb_agg(payload ORDER BY ordinal),'[]'::jsonb) FROM commerce.orders"])
        if json.loads(orders) != json.loads(live):
            raise RuntimeError('Restored payment custody differs')
        return {**receipt,'portal_exact_readback':True,'payment_exact_readback':True}
    finally:
        commerce.run(['docker','exec',commerce.DB,'dropdb','-U','leandata_commerce_owner',database])


def export_latest(image):
    receipt = maintenance(image,'owner','export','rollback-latest.json')
    value = json.loads((STATE/'rollback-latest.json').read_bytes())
    for name, filename in FILES.items():
        target = DATA_ROOT/filename
        stat = target.stat() if target.exists() else None
        staging = target.with_name(target.name+'.portal-core-rollback')
        with staging.open('x') as stream:
            json.dump(value[name],stream,indent=2);stream.flush();os.fsync(stream.fileno())
        os.chown(staging,stat.st_uid if stat else 1000,stat.st_gid if stat else 1000)
        os.chmod(staging,stat.st_mode & 0o777 if stat else 0o600)
        staging.replace(target)
    return receipt


def cutover(release, sha):
    plan = json.loads((STATE/'prepared.json').read_text())
    if plan['source_commit'] != sha or commerce.inspect(commerce.UI)['Id'] != plan['ui_id'] or commerce.inspect(commerce.DB)['Id'] != plan['database_id']:
        raise RuntimeError('A portal or database owner changed after preparation')
    original = commerce.PORTAL_COMPOSE.read_bytes()
    if hashlib.sha256(original).hexdigest() != plan['compose_sha256']:
        raise RuntimeError('Portal Compose drift')
    before = {r['Name']:r['Id'] for r in json.loads(commerce.run(['docker','inspect',*commerce.run(['docker','ps','-aq']).split()]))}
    backup = STATE/'portal-compose.before.json'
    if backup.exists():
        raise RuntimeError('Do not overwrite an attempted cutover')
    backup.write_bytes(original)
    commerce.recovery('--maintenance','on')
    imported = None
    try:
        commerce.run(['docker','stop','--time','20',commerce.UI])
        commerce.run(['tar','--numeric-owner','-cpf',str(STATE/'cutover-state.tar'),'-C',str(DATA_ROOT),'portal/data','registry'])
        expected = snapshot()
        imported = maintenance(plan['image'],'owner','import')
        (STATE/'import-receipt.json').write_text(json.dumps(imported))
        restored = restore_backup(release,expected)
        # Exact bytes and metadata survive import when no business mutation occurs.
        unchanged = {}
        with tarfile.open(STATE/'cutover-state.tar') as source:
            for filename in [*FILES.values(),'portal/data/stripe-payment.env','portal/data/zpay-payment.env']:
                current = DATA_ROOT/filename
                unchanged[filename] = hashlib.sha256(current.read_bytes()).digest() == hashlib.sha256(source.extractfile(filename).read()).digest()
        if not all(unchanged.values()):
            raise RuntimeError('A fenced identity/provider file unexpectedly changed')
        commerce.PORTAL_COMPOSE.write_bytes((STATE/'portal-compose.candidate.json').read_bytes())
        commerce.portal('config','--quiet')
        commerce.portal('up','-d','--no-deps','ui');commerce.limits(commerce.UI);healthy()
        verified = maintenance(plan['image'],'runtime','verify')
        if any(verified['counts'][name] < imported['counts'][name] for name in FILES) or verified['pending_projections']:
            raise RuntimeError('Portal import/projection admission failed')
        acceptance = commerce.accept_portal()
        acceptance['accounts'] = accept_accounts(expected)
        after = {r['Name']:r['Id'] for r in json.loads(commerce.run(['docker','inspect',*commerce.run(['docker','ps','-aq']).split()]))}
        if any(after.get(n)!=identity for n,identity in before.items() if n!='/'+commerce.UI):
            raise RuntimeError('An unrelated owner changed')
        commerce.limits(commerce.DB);commerce.limits(commerce.UI)
        commerce.recovery('--admit');commerce.recovery('--maintenance','off')
        result = {'cutover':True,'source_commit':sha,'import':imported,'database':verified,
            'backup_restore':restored,'acceptance':acceptance,'unchanged_files':unchanged,
            'ui_id':commerce.inspect(commerce.UI)['Id'],'unrelated_owner_ids_preserved':True}
        (STATE/'cutover-receipt.json').write_text(json.dumps(result))
        return result
    except Exception:
        commerce.run(['docker','stop','--time','20',commerce.UI])
        exported = export_latest(plan['image']) if imported is not None else {'import_never_accepted':True}
        commerce.PORTAL_COMPOSE.write_bytes(original);commerce.portal('config','--quiet')
        commerce.portal('up','-d','--no-deps','ui');commerce.limits(commerce.UI);healthy()
        commerce.recovery('--admit');commerce.recovery('--maintenance','off')
        (STATE/'rollback-receipt.json').write_text(json.dumps({'rolled_back':True,**exported}))
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['prepare','cutover']);parser.add_argument('--commit',required=True)
    args = parser.parse_args()
    if not commerce.re.fullmatch('[a-f0-9]{40}',args.commit):
        raise RuntimeError('Expected full source SHA')
    os.umask(0o077);STATE.mkdir(mode=0o700,parents=True,exist_ok=True)
    release = Path('/srv/leandata/releases/portal-core-'+args.commit)
    with (STATE/'deployment.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        print(json.dumps(prepare(release,args.commit) if args.action=='prepare' else cutover(release,args.commit)))
