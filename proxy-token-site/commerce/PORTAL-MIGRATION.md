# Portal core PostgreSQL migration — phase 2

Phase 1 moved payments and fulfillment jobs to the private PHX commerce database.
Phase 2 moves accounts, principals/entitlements, pending registrations/renewals,
bulk order requests and account sessions into the same database. PHX remains the
sole website/account writer and registry signer; data-edge services keep their
existing local signed authorization contract. No merchant, price or upstream
data-routing policy changes.

## Source and transaction boundary

`portal` is an independently checksum-admitted schema beside `commerce`.
Separate account, principal, registration and bulk-order tables expose generated
identity/status columns and retain each complete legacy JSON payload. Ordinal
keys preserve source ordering and historical duplicate account identities; import
does not merge, normalize or silently delete records. Registry envelope metadata,
missing versus null expiry, unknown fields and existing fulfillment markers survive.

All production reads go to PostgreSQL. Four JSON files remain generated
compatibility outputs; they are no longer authoritative inputs. The sole portal
holds a database session advisory lock. A lost connection fails closed; startup
requires the schema checksum and a verified fenced import. Runtime has no schema
DDL, import-receipt write or audit-history rewrite privilege.

Identity mutations serialize under a database advisory transaction lock. The
account/registry/pending mutation and payment completion share one database
transaction. HTTP success is buffered until commit and compatibility publication.
A failed HTTP mutation rolls back its identity changes. Bulk estimation happens
before acquiring the identity transaction, so upstream latency does not hold the
account write lock.

Document generations form a durable projection outbox. Atomic file publication,
preserved registry reader group and exact parsed readback precede acknowledgment.
An interrupted/failed publication remains due and retries from committed state;
the completed payment cannot cause a second token issue or expiry extension.
Startup and the existing 15-second recovery loop verify/rebuild compatibility
outputs. Completed order reads and account access do not publish success while
an outstanding entitlement projection cannot be synchronized.

Session cookies retain their existing security/TTL settings. PostgreSQL stores
only SHA256 cookie digests, identity and expiry. Sessions created after cutover
survive process restarts; logout removes the stored digest, and expiry pruning is
bounded. Existing pre-cutover in-memory sessions require one new sign-in. Email
verification challenges/templates and non-commerce research/paper files keep
their existing owners and authentication behavior.

## Local gates

Use a dedicated loopback database whose name ends `_test` and a mode-0600 owner
URL file. Tests reset only that admitted test schema and use synthetic identities
and mock payment/email providers:

```sh
PORTAL_TEST_DATABASE_URL_FILE=/private/test-url npm run test:portal
COMMERCE_TEST_DATABASE_URL_FILE=/private/test-url npm run test:commerce
```

Run sequentially: the suites share a resettable database. Portal tests cover exact
import/export, duplicates/nulls/envelopes, writer exclusion, concurrent updates,
rollback, committed-state projection recovery, atomic payment entitlement,
runtime privileges, database outage rejection, free registration, and restart
with persistent sessions and stale generated files. Existing server/API and
announcement/usage/chart suites remain separate gates.

## Production cutover and rollback

Publish a clean docs-repository commit to the authorized remote. Materialize it
under `/srv/leandata/releases/portal-core-<sha>`. The reviewed
`ops/deploy_portal_core.py` builds from the exact running portal image, retaining
its dependencies/public helpers, and reuses the existing database, network,
runtime/owner URL files, merchant credentials, mounts and limits. Preparation
adds the portal schema and extends the existing runtime role; it creates no
database service or replacement credentials. Compose adds only the image and
explicit `PORTAL_BACKEND=postgres` setting.

Cutover pauses the portal recovery profile, fences the file writer and snapshots
the latest four documents plus private portal/registry custody. Exact import is
transactional. A full `pg_dump` is restored into a dedicated temporary database
and every account/registry/pending/bulk payload and payment order compared with
the fenced source. Only that newly created restoration fixture is dropped.
The existing daily full-database backup already includes both schemas.

Only UI is recreated. Enforce its real no-swap cgroup, verify schema/import and
projection counts, authenticated local/public billing/account reads, unchanged
identity/provider bytes and all unrelated container IDs, then re-admit recovery.
Static site releases and data-edge/archive/collector lifecycles are separate.

On failure, fence the new writer and export **latest** database identity state to
an exclusive private file before restoring the previous image and Compose.
Publish those latest compatibility outputs with preserved ownership/group/mode;
never restore stale pre-cutover identity snapshots. Payment storage remains
PostgreSQL throughout. Keep portal schema, sessions, imports, dumps and receipts
as custody. A later file-writer drift requires a fresh reviewed admission;
`import` rejects a differing nonempty database. Runtime data and secrets stay
outside Git. Do not assert real payment acceptance from mocks or database reads.
