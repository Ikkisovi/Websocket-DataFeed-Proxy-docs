# Announcement email CLI

Use the existing authenticated portal API through administrative SSH. No browser,
local credential copy, Python package installation, or server restart is needed.
Run these commands from the portal repository with Python 3.10 or later:

```bash
python3 ops/email_site_announcement.py preview latest
python3 ops/email_site_announcement.py send <announcement-id>
python3 ops/email_site_announcement.py status <announcement-id>
```

`preview` sends nothing. It returns the HTML email and plain-text alternative,
announcement version, content/HTML hashes, unique recipient count, exclusions,
and recipient snapshot. It preserves the published rich body (bold, headings,
lists and links), includes authored English content when present, and adds the
updates link and site signature. The server applies the registration email's
font/color/footer style and safe inline email styles. It does not generate
translations or include a draft. An older API without HTML support fails closed.

To save the actual server-rendered HTML for inspection without sending mail:

```bash
python3 ops/email_site_announcement.py preview latest > /tmp/announcement-preview.json
python3 -c 'import json,pathlib; p=json.loads(pathlib.Path("/tmp/announcement-preview.json").read_text()); pathlib.Path("/tmp/announcement-preview.html").write_text(p["html"])'
```

`send` immediately submits the announcement to all eligible registry users with
valid email addresses, including expired human accounts. The existing server
excludes test/service accounts and deduplicates emails case-insensitively. It
rechecks the recipient snapshot before dispatch, then sends an individual mail
to each recipient.
Use the exact ID from `preview`; `send latest` is deliberately unavailable.

The default SSH alias is `leandata` (override with `--host`). The remote host must
have passwordless administrative sudo, Python 3.10+, Docker, and systemd. The
helper verifies the portal container/mount, then reads the host-only mode-0600
admin password and authenticates to the existing admin API inside the host.
Credentials and recipient addresses are never printed or copied locally.

Sending runs as a one-shot systemd job, so closing SSH does not cancel delivery.
Private, atomic receipts and the hash-pinned runner are stored under
`/srv/leandata/proxy-token-site/data/announcement-email-jobs/`. `status` reports
`queued`, `sending`, `completed`, `partial`, `blocked_before_send`, or `unknown`.
`smtp_accepted` means the SMTP server accepted the messages, not confirmed inbox
delivery. Detailed existing server receipts remain in `data/announce-log.jsonl`.

Each announcement ID can be submitted only once through this tool, including
after edits. A lock serializes concurrent submissions; repeated calls return the
existing receipt. A content/version or rendered HTML change before dispatch blocks the job. A
previous non-test server send with the same subject also blocks it. This is a CLI
guard; independently initiated admin UI/API sends do not share its lock.

There is no automatic retry or force-resend switch. After a timeout, partial
failure, interrupted worker, failed launch, or stale `queued`/`sending` state,
inspect the systemd unit `leandata-announcement-<job-key>` and private server log
before any recovery. Do not delete a receipt and resend: SMTP acceptance may have
occurred even when the client did not receive a response. The job key is the first
24 characters of SHA-256 of the announcement ID. Authentication, SMTP, recipient
selection, and normal site content stay owned by the portal.

Run isolated tests (no network or email):

```bash
python3 -B -m unittest discover -s ops -p 'test_email_site_announcement.py' -v
```
