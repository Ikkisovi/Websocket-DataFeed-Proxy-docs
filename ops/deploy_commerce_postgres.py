#!/usr/bin/env python3
"""Commit-pinned PHX commerce cutover; private configuration never reaches stdout."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import time
import urllib.request

CONFIG = Path('/etc/leandata/commerce-20261013')
STATE = Path('/srv/leandata-commerce-20261013')
PORTAL_COMPOSE = Path('/etc/leandata/phx-control-plane-20261008/portal-compose.json')
UI = 'leandata-control-plane-20261008-ui-1'
DB = 'leandata-commerce-20261013-postgres-1'
NETWORK = 'leandata-commerce-20261013_database'
RECOVERY = '/srv/leandata-operations/current/servarica_edge_recovery.py'

def run(command, timeout=120):
    result = subprocess.run(command, capture_output=True, timeout=timeout)
    if result.returncode:
        with (STATE / 'private-operation-errors.log').open('ab') as output:
            output.write(result.stdout + result.stderr)
        raise RuntimeError('Operation failed; inspect the root-only private log')
    return result.stdout.decode().strip()

def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]

def limits(name):
    container = inspect(name)
    run(['systemctl', 'set-property', 'docker-' + container['Id'] + '.scope', 'MemorySwapMax=0'])
    cg = next(line[3:] for line in Path('/proc', str(container['State']['Pid']), 'cgroup').read_text().splitlines() if line.startswith('0::'))
    root = Path('/sys/fs/cgroup' + cg)
    if (root / 'memory.swap.max').read_text().strip() != '0':
        raise RuntimeError('Kernel swap gate failed')
    if int((root / 'memory.max').read_text()) != container['HostConfig']['Memory']:
        raise RuntimeError('Kernel memory gate failed')

def portal(*arguments):
    return run(['docker', 'compose', '-f', str(PORTAL_COMPOSE), *arguments])

def recovery(*arguments):
    return run(['python3', RECOVERY, '--site', 'portal', *arguments])

def private_write(path, value, uid=0):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(fd, value.encode())
        os.fchown(fd, uid, uid)
        os.fsync(fd)
    finally:
        os.close(fd)

def maintenance(image, role, *arguments):
    mounts = ['-v', str(CONFIG / (role + '-url')) + ':/run/commerce-url:ro']
    if arguments[0] == 'import':
        mounts += ['-v', str(STATE / 'cutover-orders.json') + ':/run/orders.json:ro']
        arguments = ('import', '/run/orders.json')
    if arguments[0] == 'grant-runtime':
        mounts += ['-v', str(CONFIG / 'runtime-password') + ':/run/runtime-password:ro']
        arguments = ('grant-runtime', '/run/runtime-password')
    if arguments[0] == 'export':
        mounts += ['-v', str(STATE) + ':/run/export']
        arguments = ('export', '/run/export/rollback-orders.json')
    return json.loads(run(['docker', 'run', '--rm', '--network', NETWORK, '--user', '0:0',
        '--memory', '128m', '--memory-swap', '128m', '--cpus', '0.5', '--pids-limit', '64',
        '-e', 'COMMERCE_DATABASE_URL_FILE=/run/commerce-url', *mounts,
        '--entrypoint', 'node', image, 'commerce/admin.cjs', *arguments]))

def prepare(release, sha):
    original = inspect(UI)
    plan = {'source_commit': sha, 'base_image': original['Config']['Image'], 'base_image_id': original['Image'],
            'ui_id': original['Id'], 'base_config_sha256': hashlib.sha256(PORTAL_COMPOSE.read_bytes()).hexdigest(), 'image': 'openalice/phx-commerce:' + sha[:12] + '-arm64'}
    if (STATE / 'plan.json').exists():
        if json.loads((STATE / 'plan.json').read_text()) != plan:
            raise RuntimeError('An incompatible migration plan already exists')
    else:
        (STATE / 'plan.json').write_text(json.dumps(plan))
    if shutil.disk_usage(STATE).free < 10 * 1024**3:
        raise RuntimeError('Insufficient disk reserve')
    if json.loads(run(['docker','image','inspect',plan['base_image']]))[0]['Id'] != plan['base_image_id']:
        raise RuntimeError('Base image tag no longer matches the running portal')
    context = release / 'proxy-token-site'
    run(['docker', 'build', '-f', str(context / 'commerce/Dockerfile'),
         '--build-arg', 'PORTAL_BASE_IMAGE=' + plan['base_image'],
         '--build-arg', 'SOURCE_COMMIT=' + sha, '-t', plan['image'], str(context)], 300)
    built = json.loads(run(['docker', 'image', 'inspect', plan['image']]))[0]
    if built['Config']['Labels'].get('org.opencontainers.image.revision') != sha:
        raise RuntimeError('Image source identity failed')
    run(['docker', 'pull', 'postgres:17'], 180)
    pg = json.loads(run(['docker', 'image', 'inspect', 'postgres:17']))[0]
    uid = int(run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'id', 'postgres:17', '-u', 'postgres']))
    for name, owner in [('owner-password', uid), ('runtime-password', 0)]:
        if not (CONFIG / name).exists():
            private_write(CONFIG / name, secrets.token_hex(32), owner)
    for role, user, owner in [('owner', 'leandata_commerce_owner', 0), ('runtime', 'leandata_commerce_app', 1000)]:
        if not (CONFIG / (role + '-url')).exists():
            password = (CONFIG / (role + '-password')).read_text()
            private_write(CONFIG / (role + '-url'), 'postgresql://' + user + ':' + password + '@commerce-db:5432/leandata_commerce?sslmode=disable', owner)
    compose = json.loads((context / 'commerce/postgres-compose.example.json').read_text())
    compose['services']['postgres']['image'] = pg['RepoDigests'][0]
    (CONFIG / 'postgres-compose.json').write_text(json.dumps(compose))
    run(['docker', 'compose', '-f', str(CONFIG / 'postgres-compose.json'), 'config', '--quiet'])
    run(['docker', 'compose', '-f', str(CONFIG / 'postgres-compose.json'), 'up', '-d', '--wait', 'postgres'])
    limits(DB)
    candidate = json.loads(PORTAL_COMPOSE.read_bytes())
    candidate['services']['ui']['image'] = plan['image']
    candidate['services']['ui']['environment'].update({
        'COMMERCE_BACKEND': 'postgres', 'COMMERCE_DATABASE_URL_FILE': '/run/leandata-commerce/database-url'})
    candidate['services']['ui']['volumes'].append({'type': 'bind', 'source': str(CONFIG / 'runtime-url'),
        'target': '/run/leandata-commerce/database-url', 'read_only': True})
    candidate['networks'][NETWORK] = {'external': True}
    candidate['services']['ui']['networks'][NETWORK] = {}
    (CONFIG / 'portal-compose.candidate.json').write_text(json.dumps(candidate))
    run(['docker', 'compose', '-f', str(CONFIG / 'portal-compose.candidate.json'), 'config', '--quiet'])
    mounts = []
    for mount in candidate['services']['ui']['volumes']:
        mounts += ['-v', mount['source'] + ':' + mount['target'] + ':ro']
    run(['docker', 'run', '--rm', '--network', 'none', '--user', candidate['services']['ui']['user'],
        '--memory', '128m', '--memory-swap', '128m', *mounts, '--entrypoint', 'node', plan['image'],
        '-e', "const f=require('fs');for(const p of ['/app/data','/app/remote_proxy/registry/users.json','/run/leandata-commerce/database-url'])f.accessSync(p,f.constants.R_OK)"])
    maintenance(plan['image'], 'owner', 'migrate')
    role_exists = run(['docker', 'exec', DB, 'psql', '-U', 'leandata_commerce_owner', '-d', 'leandata_commerce', '-Atc',
                     "SELECT count(*) FROM pg_roles WHERE rolname='leandata_commerce_app'"])
    if role_exists == '0':
        maintenance(plan['image'], 'owner', 'grant-runtime')
    plan['image_id'] = built['Id']
    plan['postgres_image_id'] = pg['Id']
    (STATE / 'prepared.json').write_text(json.dumps(plan))
    return {'prepared': True, 'source_commit': sha, 'database_public_ports': inspect(DB)['NetworkSettings']['Ports']}

def backup_and_restore(release):
    backup = json.loads(run(['python3', str(release / 'proxy-token-site/commerce/backup.py')]))
    dump = STATE / 'backups' / backup['file']
    name = 'leandata_commerce_restore_test_20261013'
    run(['docker', 'exec', DB, 'createdb', '-U', 'leandata_commerce_owner', '-T', 'template0', name])
    try:
        with dump.open('rb') as source:
            result = subprocess.run(['docker', 'exec', '-i', DB, 'pg_restore', '-U', 'leandata_commerce_owner',
                                     '-d', name, '--exit-on-error'], stdin=source, capture_output=True, timeout=60)
        if result.returncode:
            raise RuntimeError('Logical restore failed')
        restored = json.loads(run(['docker', 'exec', DB, 'psql', '-U', 'leandata_commerce_owner', '-d', name,
            '-Atc', 'SELECT COALESCE(jsonb_agg(payload ORDER BY ordinal),\'[]\'::jsonb) FROM commerce.orders']))
        original = json.loads((STATE / 'cutover-orders.json').read_bytes())
        if restored != original:
            raise RuntimeError('Logical restore payload readback failed')
        return {'orders': len(restored), 'exact_payload_readback': True, 'dump_sha256': backup['sha256']}
    finally:
        run(['docker', 'exec', DB, 'dropdb', '-U', 'leandata_commerce_owner', name])


def install_backup_timer(release):
    (STATE / 'backups').mkdir(mode=0o700, exist_ok=True)
    unit = Path('/etc/systemd/system/leandata-commerce-backup.service')
    timer = unit.with_suffix('.timer')
    if unit.exists() or timer.exists():
        raise RuntimeError('Backup unit already exists; do not replace a different owner')
    unit.write_text('[Unit]\nDescription=Private LeanData commerce logical backup\nAfter=docker.service\n'
        '[Service]\nType=oneshot\nUser=root\nUMask=0077\nMemoryMax=64M\nMemorySwapMax=0\n'
        'CPUQuota=20%\nNice=15\nIOSchedulingClass=idle\nNoNewPrivileges=true\n'
        'ProtectSystem=strict\nProtectHome=true\nReadWritePaths=' + str(STATE / 'backups') + '\n'
        'ExecStart=/usr/bin/python3 ' + str(release / 'proxy-token-site/commerce/backup.py') + '\n')
    timer.write_text('[Unit]\nDescription=Daily private LeanData commerce backup\n[Timer]\n'
        'OnCalendar=*-*-* 03:35:00 UTC\nPersistent=true\nRandomizedDelaySec=120\n'
        '[Install]\nWantedBy=timers.target\n')
    run(['systemd-analyze', 'verify', str(unit), str(timer)])
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', timer.name])


def accept_portal():
    import tarfile
    from collections import Counter
    config = json.loads(PORTAL_COMPOSE.read_bytes())['services']['ui']['environment']
    data = Path('/srv/leandata-control-plane-20261008/portal/data')
    password = (data / 'admin-password.env').read_text().strip()
    login = urllib.request.Request('http://127.0.0.1:29300/api/admin/login',
        data=json.dumps({'password': password}).encode(), headers={'Content-Type': 'application/json'})
    token = json.loads(urllib.request.urlopen(login, timeout=10).read())['token']
    summaries = []
    for base in ['http://127.0.0.1:29300', 'https://leandata.uk']:
        request = urllib.request.Request(base + '/api/admin/payments/overview', headers={'X-Admin-Token': token})
        response = urllib.request.urlopen(request, timeout=20)
        payload = json.loads(response.read())
        if response.status != 200 or not payload.get('success'):
            raise RuntimeError('Authenticated commerce read failed')
        summaries.append({'public': base.startswith('https'), 'status': response.status,
                          'completed': payload['kpis']['paid_orders_count']})
    with tarfile.open(STATE / 'cutover-state.tar') as snapshot:
        original = json.load(snapshot.extractfile('registry/users.json'))
    current = json.loads(Path('/srv/leandata-control-plane-20261008/registry/users.json').read_bytes())
    tokens = lambda value: Counter((row.get('user_id'),row.get('token')) for row in value.get('users',[]))
    if tokens(original) - tokens(current):
        raise RuntimeError('An existing token identity disappeared')
    return {'authenticated_reads': summaries, 'original_token_identities_preserved': True}


def cutover(release, sha):
    plan = json.loads((STATE / 'prepared.json').read_text())
    if plan['source_commit'] != sha or inspect(UI)['Id'] != plan['ui_id'] or hashlib.sha256(PORTAL_COMPOSE.read_bytes()).hexdigest() != plan['base_config_sha256']:
        raise RuntimeError('Source/portal changed since preparation')
    before = {row['Name']: row['Id'] for row in json.loads(run(['docker', 'inspect', *run(['docker', 'ps', '-aq']).split()]))}
    original_config = PORTAL_COMPOSE.read_bytes()
    config_backup = STATE / 'portal-compose.before.json'
    if config_backup.exists():
        raise RuntimeError('A previous cutover exists; inspect it instead of overwriting')
    config_backup.write_bytes(original_config)
    recovery('--maintenance', 'on')
    receipt = None
    try:
        run(['docker', 'stop', '--time', '20', UI])
        snapshot = STATE / 'cutover-state.tar'
        run(['tar', '--numeric-owner', '-cpf', str(snapshot), '-C', '/srv/leandata-control-plane-20261008', 'portal/data', 'registry'])
        source = Path('/srv/leandata-control-plane-20261008/portal/data/payment-orders.json')
        shutil.copyfile(source, STATE / 'cutover-orders.json')
        receipt = maintenance(plan['image'], 'owner', 'import')
        (STATE / 'import-receipt.json').write_text(json.dumps(receipt))
        PORTAL_COMPOSE.write_bytes((CONFIG / 'portal-compose.candidate.json').read_bytes())
        portal('config', '--quiet')
        backup_receipt = backup_and_restore(release)
        portal('up', '-d', '--no-deps', 'ui')
        limits(UI)
        healthy = False
        for _ in range(30):
            try:
                response = urllib.request.urlopen('http://127.0.0.1:29300/', timeout=3)
                healthy = response.status == 200
                if healthy:
                    break
            except Exception:
                time.sleep(1)
        if not healthy or inspect(UI)['RestartCount']:
            raise RuntimeError('Portal failed startup gate')
        verified = maintenance(plan['image'], 'runtime', 'verify')
        if verified['orders'] < receipt['orders'] or verified['payments'] != verified['orders']:
            raise RuntimeError('Imported order gate failed')
        after = {row['Name']: row['Id'] for row in json.loads(run(['docker', 'inspect', *run(['docker', 'ps', '-aq']).split()]))}
        if any(after.get(name) != identity for name, identity in before.items() if name != '/' + UI):
            raise RuntimeError('An unrelated owner changed')
        acceptance = accept_portal()
        install_backup_timer(release)
        limits(DB)
        limits(UI)
        recovery('--admit')
        recovery('--maintenance', 'off')
        result = {'cutover': True, 'source_commit': sha, 'import': receipt, 'database': verified,
                  'ui_id': inspect(UI)['Id'], 'backup_restore': backup_receipt, 'acceptance': acceptance, 'unrelated_owner_ids_preserved': True}
        (STATE / 'cutover-receipt.json').write_text(json.dumps(result))
        return result
    except Exception:
        # Export latest records even on failed admission; never replay a stale snapshot.
        run(['docker', 'stop', '--time', '20', UI])
        exported = {'exported': 0, 'import_never_accepted': True}
        if receipt is not None:
            exported = maintenance(plan['image'], 'owner', 'export')
            target = Path('/srv/leandata-control-plane-20261008/portal/data/payment-orders.json')
            staging = target.with_suffix('.commerce-rollback')
            shutil.copyfile(STATE / 'rollback-orders.json', staging)
            os.chown(staging, 1000, 1000)
            os.chmod(staging, 0o600)
            staging.replace(target)
        PORTAL_COMPOSE.write_bytes(original_config)
        portal('config', '--quiet')
        portal('up', '-d', '--no-deps', 'ui')
        limits(UI)
        for _ in range(30):
            try:
                if urllib.request.urlopen('http://127.0.0.1:29300/', timeout=3).status == 200:
                    break
            except Exception:
                time.sleep(1)
        recovery('--admit')
        recovery('--maintenance', 'off')
        (STATE / 'rollback-receipt.json').write_text(json.dumps({'rolled_back': True, **exported}))
        raise

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'cutover'])
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}', args.commit):
        raise RuntimeError('Expected full source commit')
    os.umask(0o077)
    CONFIG.mkdir(mode=0o700, parents=True, exist_ok=True)
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    release = Path('/srv/leandata/releases/commerce-' + args.commit)
    if not release.is_dir():
        raise RuntimeError('Missing commit-pinned release')
    result = prepare(release, args.commit) if args.action == 'prepare' else cutover(release, args.commit)
    print(json.dumps(result))

if __name__ == '__main__':
    main()
