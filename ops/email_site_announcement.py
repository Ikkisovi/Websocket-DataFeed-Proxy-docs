#!/usr/bin/env python3
"""Email a published site announcement through the existing admin API, over SSH."""

import argparse
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request


SITE = Path('/srv/leandata/proxy-token-site')
STATE = SITE / 'data/announcement-email-jobs'
CONTAINER = 'leandata-v2-leandata-ui-1'
SEND_PATH = '/api/admin/announce/send'


class OperationError(Exception):
    """An operator-readable error that contains no credentials or recipients."""


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def job_key(announcement_id):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,159}', announcement_id):
        raise OperationError('Invalid announcement ID.')
    return hashlib.sha256(announcement_id.encode()).hexdigest()[:24]


def atomic_write(path, value):
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.next-')
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


@contextmanager
def job_lock(key):
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    if STATE.is_symlink() or stat.S_IMODE(STATE.stat().st_mode) != 0o700:
        raise OperationError('Job directory must be private (0700) and not a symlink.')
    fd = os.open(STATE / (key + '.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield STATE / (key + '.json')


class AdminAPI:
    def __init__(self):
        container = json.loads(subprocess.check_output(
            ['docker', 'inspect', CONTAINER], stderr=subprocess.DEVNULL))[0]
        app_mount = next((m for m in container['Mounts'] if m['Destination'] == '/app'), {})
        if not container['State']['Running'] or app_mount.get('Source') != str(SITE):
            raise OperationError('Production portal container or mount does not match.')
        data_mount = next((m for m in container['Mounts'] if m['Destination'] == '/app/data'), None)
        if data_mount and data_mount['Source'] != str(SITE / 'data'):
            raise OperationError('Production portal data mount does not match.')
        ip = next(iter(container['NetworkSettings']['Networks'].values()))['IPAddress']
        self.base = 'http://' + ip + ':3000'
        self.token = None
        credential = SITE / 'data/admin-password.env'
        if credential.is_symlink() or stat.S_IMODE(credential.stat().st_mode) != 0o600:
            raise OperationError('Admin credential must be a regular private file (0600).')
        self.token = self.call('/api/admin/login', {'password': credential.read_text().strip()})['token']

    def call(self, path, payload=None):
        headers = {'Content-Type': 'application/json'}
        if self.token:
            headers['X-Admin-Token'] = self.token
        request = urllib.request.Request(self.base + path, headers=headers,
            data=json.dumps(payload).encode() if payload is not None else None)
        try:
            # A confirmed send is sequential; never automatically retry this request.
            timeout = 3300 if payload and payload.get('confirm') else 30
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise OperationError('Admin API returned HTTP ' + str(error.code)) from None
        except (urllib.error.URLError, TimeoutError, ValueError, OSError):
            raise OperationError('Admin API response unavailable; do not retry a send blindly.') from None


def announcement(api, selector):
    rows = api.call('/api/admin/product-updates')['updates']
    if selector == 'latest':
        # Use the public ordering, which is also used by the homepage banner.
        public = api.call('/api/product-updates')['updates']
        if not public:
            raise OperationError('There are no published announcements.')
        selector = public[0]['id']
    row = next((row for row in rows if row['id'] == selector), None)
    if not row or row['status'] != 'published':
        raise OperationError('Announcement must exist and be published.')
    return row


def message(row):
    title = row['title'].strip()
    body = row['body'].strip()
    if not title or not body:
        raise OperationError('Announcement needs a title and plain-text body.')
    parts = [title, row['date'], body]
    if row.get('body_en', '').strip():
        parts += [row.get('title_en', '').strip() or title, row['body_en'].strip()]
    parts += ['查看公告 / View updates: https://leandata.uk/updates', '恺 Kai · leandata.uk']
    payload = {'subject': 'Leandata · ' + title, 'body': '\n\n'.join(parts)}
    if len(payload['subject']) > 200 or re.search(r'[\r\n]', payload['subject']):
        raise OperationError('Email subject is too long or contains a line break.')
    if len(payload['body']) > 100000:
        raise OperationError('Email body is too long.')
    return payload


def preview(api, selector):
    row = announcement(api, selector)
    payload = message(row)
    recipients = api.call(SEND_PATH, payload)
    if not recipients.get('success') or recipients.get('dry_run') is not True:
        raise OperationError('Recipient preview failed.')
    smtp = api.call('/api/admin/announce/recipients')['smtp_configured']
    summary = {
        'announcement_id': row['id'], 'version': row['version'], 'title': row['title'],
        'subject': payload['subject'], 'body': payload['body'], 'content_sha256': digest(payload),
        'recipient_count': len(recipients['reachable']),
        'recipient_snapshot': recipients['recipient_snapshot'],
        'skipped': dict(Counter(r['reason'] for r in recipients['skipped'])),
        'duplicates': len(recipients['duplicate_recipients']), 'smtp_configured': smtp,
    }
    return summary, payload


def previous_sends(subject):
    log = SITE / 'data/announce-log.jsonl'
    if not log.exists():
        return False
    with log.open() as stream:
        for line in stream:
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except ValueError:
                raise OperationError('Email history is unreadable; inspect it before sending.') from None
            if record.get('subject') == subject and not record.get('test_to'):
                return True
    return False


def public_receipt(job):
    return {key: value for key, value in job.items() if key not in {'payload', 'body'}}


def launch(key):
    source = globals().get('SOURCE_BYTES')
    if source is None:
        source = Path(__file__).read_bytes()
    source_hash = hashlib.sha256(source).hexdigest()
    script = STATE / ('runner-' + source_hash + '.py')
    if not script.exists():
        fd = os.open(script, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(source)
            stream.flush()
            os.fsync(stream.fileno())
    elif hashlib.sha256(script.read_bytes()).hexdigest() != source_hash:
        raise OperationError('Stored runner hash does not match.')
    result = subprocess.run([
        'systemd-run', '--quiet', '--collect', '--unit=leandata-announcement-' + key,
        '--property=RuntimeMaxSec=3600', '--property=MemoryMax=128M',
        '--property=TasksMax=16', '--property=UMask=0077',
        '/usr/bin/python3', str(script), '--remote', '_deliver', key,
    ], capture_output=True)
    if result.returncode:
        raise OperationError('Could not start the durable mail job; inspect status before retrying.')
    return source_hash


def queue_send(api, selector):
    if selector == 'latest':
        raise OperationError('Preview latest first; send requires its exact announcement ID.')
    key = job_key(selector)
    with job_lock(key) as path:
        if path.exists():
            return {**public_receipt(json.loads(path.read_text())), 'already_submitted': True}
        summary, payload = preview(api, selector)
        if not summary['smtp_configured']:
            raise OperationError('SMTP is not configured.')
        if previous_sends(payload['subject']):
            raise OperationError('A previous send has this subject; inspect mail history before proceeding.')
        job = {**summary, 'state': 'queued', 'created_at': timestamp(), 'payload': {
            **payload, 'confirm': True, 'recipient_snapshot': summary['recipient_snapshot'],
        }}
        job.pop('body')
        atomic_write(path, job)
        # Persist before launch. Any interruption remains blocked against a duplicate send.
        job['runner_sha256'] = launch(key)
        atomic_write(path, job)
        return public_receipt(job)


def deliver(key, api_factory=AdminAPI):
    if not re.fullmatch(r'[0-9a-f]{24}', key):
        raise OperationError('Invalid job key.')
    with job_lock(key) as path:
        job = json.loads(path.read_text())
        if job['state'] != 'queued':
            return public_receipt(job)
        try:
            api = api_factory()
            current = announcement(api, job['announcement_id'])
            if current['version'] != job['version'] or digest(message(current)) != job['content_sha256']:
                raise OperationError('Announcement changed after queueing; no email was sent.')
            if previous_sends(job['subject']):
                raise OperationError('Email history now contains this subject; no email was sent.')
        except Exception:
            job.update(state='blocked_before_send', finished_at=timestamp())
            atomic_write(path, job)
            return public_receipt(job)
        job.update(state='sending', started_at=timestamp())
        atomic_write(path, job)
        try:
            response = api.call(SEND_PATH, job['payload'])
            results = response['results']
            sent = sum(r['status'] == 'sent' for r in results)
            failed = sum(r['status'] == 'failed' for r in results)
            if sent + failed != len(results) or len(results) != job['recipient_count']:
                raise OperationError('Incomplete send response.')
            job.update(state='completed' if sent == len(results) and response.get('success') else 'partial',
                smtp_accepted=sent, failed=failed, finished_at=timestamp())
        except Exception:
            # SMTP might already have accepted messages. Recovery must inspect the server log.
            job.update(state='unknown', finished_at=timestamp())
        atomic_write(path, job)
        return public_receipt(job)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='leandata', help='SSH alias (default: leandata)')
    parser.add_argument('--remote', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('action', choices=['preview', 'send', 'status', '_deliver'])
    parser.add_argument('announcement', nargs='?', default='latest')
    args = parser.parse_args()
    if not args.remote:
        if args.action == '_deliver':
            raise OperationError('Internal action is not available locally.')
        bootstrap = "import sys; s=sys.stdin.buffer.read(); exec(compile(s,'<ssh>','exec'), {'__name__':'__main__','SOURCE_BYTES':s})"
        command = shlex.join(['sudo', '-n', 'python3', '-c', bootstrap,
            '--remote', args.action, args.announcement])
        result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '--', args.host, command],
            input=Path(__file__).read_bytes())
        return result.returncode
    if args.action == '_deliver':
        result = deliver(args.announcement)
    elif args.action == 'status':
        path = STATE / (job_key(args.announcement) + '.json')
        result = public_receipt(json.loads(path.read_text())) if path.exists() else {'state': 'not_submitted'}
    else:
        api = AdminAPI()
        result = preview(api, args.announcement)[0] if args.action == 'preview' else queue_send(api, args.announcement)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get('state') not in {'partial', 'unknown', 'blocked_before_send'} else 2


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        # Unexpected exceptions can contain HTTP bodies or addresses. Never print them.
        text = str(error) if isinstance(error, OperationError) else 'Operation failed; inspect host state without retrying a send.'
        print(json.dumps({'success': False, 'error': text}), file=sys.stderr)
        sys.exit(1)
