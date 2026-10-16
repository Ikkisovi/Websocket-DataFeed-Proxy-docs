# Commercial catalog and subscription clocks

`product-catalog.json` owns sale IDs, integer prices, durations, plan ceilings,
Value scopes and retired products. `publicCatalog()` generates the public
projection without internal test plans or historical Trial definitions.

REST and WS embed exact copies. Before a release, check both copies with:

```sh
node scripts/sync-runtime-catalog.mjs --root <OpenAlice checkout> --check
```

Use `--write` only when intentionally updating the runtime copies. Every account,
checkout bundle and runtime usage response identifies the catalog version/hash.

`subscriptions.market` and `subscriptions.china` have independent RFC3339 expiry
clocks. Paid grants require an expiry; Value requires an explicit scope. A valid
managed credential retains permanent Free rights when its market grant expires.
Top-level `expires_at` is a compatibility display projection only. Updated REST
and WS enforce the individual clocks, including between portal sweeps.

The permission projection is a display/legacy compatibility field. Managed
records use `permission_overrides` for operator denials, bounded by plan ceilings.
Ordinary old plan denials do not revoke newly authorized Free fallback rights.
Explicit WS aliases and topic denials survive migration.

Trial has no new purchase, approval or role-grant path. Historical purchases and
already granted clocks remain readable and valid until their original expiry.
Replacement tokens restore persisted grants; they never start a paid duration.

Deploy compatible REST/cache/WS readers before the portal writer and static UI.
Back up the database and registry before the projection migration. Do not roll a
writer back to pre-subscription code while accepting payments: it cannot update
the two clocks correctly. Preserve the database and fence writer mutations if a
writer rollback is needed. No schema migration is required for these JSON grants.
