#!/usr/bin/env python3
"""Publish a commit-pinned chart overlay and restart only the existing portal."""
import argparse
import fcntl
import hashlib
import json
import re
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

SITE = Path('/srv/leandata/proxy-token-site')
ROOT = Path('/srv/leandata/site-releases/chart')
CONTAINER = 'leandata-v2-leandata-ui-1'
FILES = (
    'public/assets/chart-page.js', 'public/assets/chart-proxy.cjs',
    'public/assets/token-page.js', 'public/assets/account-page.js', 'public/assets/gpu-index-page.js', 'public/assets/docs-page.js',
    'public/vendor/chart-licenses.txt', 'public/chart/chart-data.mjs',
    'public/chart/chart-page.jsx', 'public/chart/chart.css', 'public/chart/index.html',
    'public/token-page.jsx', 'public/account-page.jsx', 'public/gpu-index-page.jsx',
    'public/language.js', 'public/index.html', 'public/account.html', 'server.js',
)
DEPENDENCIES = ('public/tokens.css', 'public/gpu-index.css', 'public/docs/docs-site.jsx')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(*args):
    return subprocess.check_output(args, text=True)


def inspect():
    names = run('docker', 'ps', '--format', '{{.Names}}').splitlines()
    return {item['Name'].lstrip('/'): item for item in json.loads(run('docker', 'inspect', *names))}


def state(items):
    return {name: (item['Id'], item['State']['StartedAt'], item['RestartCount']) for name, item in items.items() if name != CONTAINER}


def copy_in_place(source, target):
    # Preserve the server file inode as well as mounted public directory inodes.
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('wb') as output:
        output.write(source.read_bytes())
    target.chmod(0o644)


def compose_file(path):
    candidate = Path(path)
    if candidate.is_file():
        return str(candidate)
    # Long-lived containers may retain labels naming a cleaned old release.
    assert candidate.is_relative_to('/srv/leandata/releases')
    assert candidate.name in {'docker-compose.aliyun.yml', 'docker-compose.aliyun.archive.yml'}
    active = Path('/srv/leandata/current/services/leandata-v2') / candidate.name
    assert active.is_file(), 'active runtime Compose file is unavailable'
    return str(active)


def verify_health():
    item = json.loads(run('docker', 'inspect', CONTAINER))[0]
    address = next(network['IPAddress'] for network in item['NetworkSettings']['Networks'].values() if network['IPAddress'])
    for attempt in range(45):
        try:
            with urllib.request.urlopen(f'http://{address}:3000/', timeout=3) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(1)
    raise RuntimeError('portal health did not recover')


def deploy(release, manifest_path, apply):
    manifest = json.loads(manifest_path.read_text())
    assert re.fullmatch('[0-9a-f]{40}', manifest['commit'])
    assert release.parent == ROOT and release.name == manifest['commit']
    assert set(manifest['files']) == set(FILES)
    assert set(manifest['dependencies']) == set(DEPENDENCIES)
    source = release / 'proxy-token-site'
    before = inspect()
    ui = before[CONTAINER]
    public_mount = next(m for m in ui['Mounts'] if m['Destination'] == '/app/public')
    server_mount = next(m for m in ui['Mounts'] if m['Destination'] == '/app/server.js')
    assert public_mount['Source'] == str(SITE / 'public') and not public_mount['RW']
    assert server_mount['Source'] == str(SITE / 'server.js') and not server_mount['RW']
    for name in FILES:
        target = SITE / name
        assert not target.is_symlink()
        assert sha(source / name) == manifest['files'][name]['after'], name
        expected = manifest['files'][name]['before']
        assert (sha(target) if target.is_file() else None) == expected, name
    for name, expected in manifest['dependencies'].items():
        assert sha(SITE / name) == expected, name
    labels = ui['Config']['Labels']
    compose = ['docker', 'compose', '-p', labels['com.docker.compose.project']]
    configs = [compose_file(path) for path in labels['com.docker.compose.project.config_files'].split(',')]
    for path in configs:
        compose += ['-f', path]
    for path in labels.get('com.docker.compose.project.environment_file', '').split(','):
        if path:
            compose += ['--env-file', path]
    subprocess.run(compose + ['config', '--quiet'], check=True, stdout=subprocess.DEVNULL)
    merged = json.loads(run(*compose, 'config', '--format', 'json'))['services']['leandata-ui']
    assert any(v['target'] == '/app/public' and v['source'] == str(SITE / 'public') and v.get('read_only') for v in merged['volumes'])
    public_inode = (SITE / 'public').stat().st_ino
    server_inode = (SITE / 'server.js').stat().st_ino
    registry = SITE / 'remote_proxy/users.json'
    registry_hash = sha(registry)
    runtime = str(Path('/srv/leandata/current').resolve())
    if not apply:
        print('Chart overlay preflight passed; live files unchanged.')
        return
    backup = release / 'rollback'
    backup.mkdir(mode=0o700)
    for name in FILES:
        if (SITE / name).is_file():
            target = backup / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(SITE / name, target)
    for index, path in enumerate(configs):
        shutil.copy2(path, backup / f'compose-{index}')
    receipt = {**manifest, 'runtime': runtime, 'protected_before': state(before), 'public_inode': public_inode, 'server_inode': server_inode, 'registry_before': registry_hash}
    try:
        for name in FILES:
            copy_in_place(source / name, SITE / name)
        subprocess.run(['docker', 'restart', '--time', '15', CONTAINER], check=True, stdout=subprocess.DEVNULL)
        verify_health()
        for name in FILES:
            expected = manifest['files'][name]['after']
            assert sha(SITE / name) == expected, name
            assert run('docker', 'exec', CONTAINER, 'sha256sum', '/app/' + name).split()[0] == expected, name
        after = inspect()
        assert state(before) == state(after), 'another service changed during deployment'
        assert public_inode == (SITE / 'public').stat().st_ino
        assert server_inode == (SITE / 'server.js').stat().st_ino
        assert runtime == str(Path('/srv/leandata/current').resolve())
        receipt.update(status='host_container_verified_public_acceptance_pending', protected_after=state(after), registry_after=sha(registry), portal_started_at=after[CONTAINER]['State']['StartedAt'])
    except BaseException:
        for name in FILES:
            if (backup / name).is_file():
                copy_in_place(backup / name, SITE / name)
            elif (SITE / name).exists():
                (SITE / name).unlink()
        subprocess.run(['docker', 'restart', '--time', '15', CONTAINER], check=True, stdout=subprocess.DEVNULL)
        verify_health()
        receipt['status'] = 'rolled_back'
        raise
    finally:
        (release / 'deployment.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'commit': manifest['commit'], 'status': receipt['status'], 'registry_unchanged': receipt['registry_after'] == registry_hash}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('release', type=Path)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    with open('/srv/leandata/chart-deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        deploy(args.release.resolve(), args.manifest.resolve(), args.apply)
