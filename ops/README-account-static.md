# Account UI static release

The October 13 commerce image owns payment APIs and PostgreSQL access. Public
account HTML, account JavaScript and language resources are served by PHX Caddy
from `/srv/leandata-site-public/public`, including stale-DNS edge forwarding.
Updating these files does not require a portal or database restart.

Run `npm run test:account` in `proxy-token-site`. It rebuilds the exact account
entry and checks the compiled UI's login translations, locale roundtrip, permanent
Free versus paid/unknown/expired expiry states, and HTML asset fingerprints.
The full public build also runs the account builder. Commit source and generated
assets together. Publish to the currently authorized remote before deployment.

`ops/deploy_account_static.py` restricts the release to four account resources.
It uses the proven v3 static helper from docs commit
`8d6798237430fecc6c1fc67d5f5261103c7e0641`, SHA256
`81e698a339bfd93717cabca56306ec622fd544de6d66d5517bb48ac33092aa3c`.
The helper must be supplied unchanged through `--helper`. This wrapper selects
the current public Caddy mount and the account-only file allowlist, while retaining
the helper's lock, hash guards, symlink checks, rollback custody, directory inode
and all-container identity checks. Never use the legacy portal deployment target.

Materialize committed files under
`/srv/leandata-site-public/releases/account/<full-source-commit>` and retain a
private manifest containing `commit`, per-file `before`/`after` hashes,
`dependencies: {}`, the helper SHA256, and `account_dependencies` hashes for
`tokens.css` and `account.css`. Preserve the exact publication/build evidence.

Dry-run the wrapper, then use `--apply`. Verify release/host/Caddy/public response
hashes, the versioned HTML dependencies and public English login rendering. Free
account browser evidence may use an isolated synthetic account when production
browser authentication is unavailable; label those gates separately. No payment
or account mutation is required for this display fix.

Use `--rollback` only while this release still owns the served bytes. It rejects
later drift. Do not replace public directories or modify runtime feeds, Compose,
credentials, recovery admission, account records or payment database state.
