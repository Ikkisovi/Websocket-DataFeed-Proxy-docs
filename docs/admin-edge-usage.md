# Administrator edge-download usage

The existing usage tab now contains a separate per-user Edge download table.
It is not added to OCI control-plane byte totals. Only redeemed transfers are
counted; issued tickets and rejected replays are not downloads.

Configure `EDGE_USAGE_BASE_URL` as the exact private gateway origin, and
`EDGE_USAGE_TOKEN_FILE` as a read-only container-mounted, dedicated reader
credential. Never reuse an end-user, prepare, signing or archive credential.
The administrator browser receives only aggregated counters, not that secret.
The helper remains inline in `server.js`, preserving the existing single-file
server/public-directory deployment contract.

`GET /api/admin/usage/edge?days=7` uses the existing `requireAdmin` gate. Allowed
windows are 1, 7, 30, 90 UTC days including today. The backend rejects redirects,
unexpected schema, unsafe counters and responses over 1 MiB; network timeout is
5 seconds. Failure returns 503/available=false, never a misleading zero total.

Counters distinguish gateway-completed 2xx, error responses, interrupted,
restart-unknown and pending/unconfirmed transfers. Bytes are successfully
awaited object-body writes, not end-user receipt, disk persistence, protocol
traffic or independently certified billing. Interrupted/unknown/pending traffic
makes known bytes a lower bound. Window attribution uses transfer start date.
The page marks the actual collection start and incomplete historical coverage.
User identities are HTML-escaped. Responses are private/no-store.

Keep original account registry, environment values, live public directory inode
and unrelated assets. Install the dedicated read-only credential/Compose
extension separately from source. An account-server restart may invalidate
administrator sessions; it must not rotate market-data user tokens. Preserve
the gateway ledger/replay database on rollback.

Validation covers the real administrator middleware and a bounded real HTTP
hop, plus rendering/XSS, failure states, response bounds and existing account
server tests. There is no independent subagent review or claim that a Git push
is a successful CI/deployment run.
