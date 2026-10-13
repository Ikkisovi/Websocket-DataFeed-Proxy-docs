# Commerce PostgreSQL migration — phase 1

PHX remains the sole portal/account writer and registry signer. The data edge
continues local signed authorization. This migration moves payment orders,
provider receipts, audit events and durable fulfillment jobs into a dedicated
PostgreSQL instance. Account, pending registration, bulk-download orders and
registry files retain their existing owners; front-end contracts are unchanged.
The implementation adopts transactional commerce patterns reviewed in GPTibo
`98bd8150cb259c23486d4e9d9fa299836e22dd21`; no external source or anonymized
provider adapter is copied.

## Transaction and recovery contract

- Frozen order JSONB preserves all legacy fields, price/FX snapshots, CAD/USD/CNY,
  checkout/resume hashes and existing fulfillment markers. Typed payment rows
  store integer minor units and unique confirmed provider transaction identities.
- A confirmed payment, audit event and queued fulfillment job commit together.
  Row locks serialize updates. Application checks and a database trigger preserve
  original purchase bindings and prevent confirmed/completed state regression.
- The sole portal process performs registry/account projection under a shared
  database advisory lock and expiring job lease. Existing order markers prevent
  a second token issue or expiry extension after interrupted publication.
  Database and registry files are not one distributed transaction: completion is
  a separate receipt, and retry repairs partial projection.
- The resident loop resumes up to ten paid jobs every 15 seconds. Failed jobs
  back off to at most one hour. Up to three unpaid provider queries per batch
  use persistent five-minute cooldowns and 30-second leases. Stripe and Z-Pay
  queries are GET-only, bounded to eight seconds, deny redirects, and reuse
  merchant/order/amount/currency/bundle binding checks. No query creates a charge.
- Runtime role cannot delete orders, alter schema, forge import receipts or edit
  audit rows. Migration/import use an independent owner connection.
- Production explicitly sets `COMMERCE_BACKEND=postgres`; database/schema/import
  failure prevents startup. No silent file fallback or zero-revenue fallback.

## Local verification

Create a dedicated loopback database whose name ends `_test`. Save its URL in a
mode-0600 file. Do not run the tests against a business database: they reset only
that test schema and create a fixture runtime role.

```sh
COMMERCE_TEST_DATABASE_URL_FILE=/private/test-url node --test commerce/store.test.cjs
COMMERCE_TEST_DATABASE_URL_FILE=/private/test-url node --test commerce/payment.test.cjs
npx jest server.test.js --runInBand --testNamePattern 'Payment bundles and automatic fulfillment'
```

The two database suites run sequentially because they share the dedicated test
schema. Cases cover exact import/export, receipt collisions, concurrent updates,
lease exclusion, expired crash leases, startup recovery after partial projection,
original token/expiry preservation, restricted roles, checkout ownership and
provider-query recovery. Mocks never exercise a real charge.

## Cutover

1. Verify the current PHX source/image, exact Compose, mounts, no-swap limits,
   registry metadata, free disk and exclusive writer. Preserve private backups.
2. Test, commit and publish the docs-repository branch. Build the commerce image
   from the clean commit and exact existing portal base image. This retains the
   deployed public assets and runtime helpers; image/base identities are separate
   release evidence. A rebuilt docs/static site is not part of this migration.
3. Create a separate 256-MiB/no-swap PostgreSQL owner and internal network with
   no published port. Pin the resolved official image digest. Do not revive the
   retired shared PostgreSQL or use another application's database.
4. Run `admin.cjs migrate`, then `grant-runtime PASSWORD_FILE` with a private
   owner URL. Runtime URL is a separate mode-0600 file readable only by the portal
   runtime UID. Keep all existing provider keys in their current mounts.
5. Pause portal recovery, fence the old portal writer, then take the final order
   snapshot and account/registry backup. `admin.cjs import FILE` validates every
   order and reads every payload back inside the import transaction. A nonempty
   differing database is rejected. Preserve the import SHA256/count receipt.
6. Add the database network and runtime URL mount to the existing portal Compose,
   preserving all existing volumes, user, environment, auth and networks. Validate
   the merged Compose; recreate only UI, enforce actual cgroup no-swap, verify
   authenticated order/CRM reads and negative callbacks, then readmit recovery.
7. Check unchanged account/registry hashes, unrelated container IDs, public pages,
   signed authorization and database import counts. Real provider charges are a
   distinct acceptance gate, never implied by HTTP 200 or mock completion.
8. Install `backup.py` daily with private root-only output. The 64-backup/disk
   reserve guard stops further backups without deleting retained custody.
   The cutover also restores the backup into a new dedicated temporary database and
   compares every order payload with the fenced source before starting the portal.
   Only that newly created restoration fixture is dropped afterward.

## Rollback

Fence the PostgreSQL portal writer before rollback. Export **latest** accepted
orders to a new mode-0600 file with `admin.cjs export NEW_FILE`; it refuses
replacement. Preserve the current account/registry files, including any new
fulfillment markers. Atomically publish the export as `payment-orders.json`,
restore the exact previous image/Compose, enforce cgroup limits and re-admit the
old sole writer. Never restore stale pre-cutover account/order snapshots over
new payments, run two portal writers, or drop PostgreSQL custody.

Account relationalization, refunds/chargebacks, reseller settlement and a new
storefront are subsequent phases. This release preserves current billing and
entitlement policy; it does not enable any new payment channel.
