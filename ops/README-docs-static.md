# Scoped static documentation release (v3 static origin, current)

Production docs (`https://leandata.uk/docs`) are served from the PHX v3 static
origin `/srv/leandata-site-public/public` (Caddy `file_server`), NOT from the
retired `leandata-v2-*` portal stack (down since 2026-10-04; its
`/srv/leandata/proxy-token-site/public` path and `leandata-v2-leandata-ui-1`
container checks are obsolete — do not use the old portal flow below for live
deploys).

The canonical document is `public/docs/docs-site.jsx`; the root `docs-site.jsx`
is a compatibility loader. Do not overwrite the compiled HTML entries with the
older Babel/CDN shells from `240249a37`.

`build-doc-pages.mjs` stamps `?v=` from
`sha256(docs-page.js + doc-layout.css + tokens.css)[:16]` (content fingerprint,
not a date string). Every rebuild rewrites all article shells; commit the
regenerated HTML together with the bundles.

The existing `ubuntu@100.88.18.95` administrator can use `sudo -n`. This scoped
administrator workflow is independent of automatic GitLab deployment. It does
not add SSH keys, broaden sudo rules, or enable CI runners.

1. Build and test an isolated docs checkout (`npm run build:public` plus the
   `test-doc-*.mjs` suites); commit and mirror the source to both remotes.
   Preserve the source commit, baseline commit and exact file hashes.
2. Identify the live bundle: `sha256sum` the live `assets/docs-page.js` and
   match it against a committed blob. If live matches no commit, STOP — the
   previous deploy left uncommitted content; resolve before proceeding.
   (2026-10-02 bundle was live on 2026-10-06, 23 commits behind: correct
   direction is a forward deploy, not a rollback.)
3. Build the manifest: for every path in the script's `FILES` allowlist, record
   `before` (live SHA-256, or null when absent) and `after` (SHA-256 of the same
   path in the release commit). Record the four dependency guards
   (`token-page.jsx`, `language.js`, `docs/usage-page.jsx`, `docs-site.jsx`)
   with live hashes. Retain the manifest outside the public directory.
   Beware shell `while read` loops silently skipping a final line without a
   trailing newline — verify the entry count (currently 222).
4. Materialize the release from the committed Git archive into
   `/srv/leandata-site-public/releases/docs-nav/<full-commit>`:
   `proxy-token-site/public` content plus the reviewed
   `ops/deploy_docs_static.py` (site-public profile: `RELEASE_ROOT` under
   `site-public`, `PUBLIC_ROOT=/srv/leandata-site-public/public`, container
   `leandata-phx-s4-direct-20261003-v1-caddy-1`). Record the ops script SHA;
   it must be byte-identical to a production-proven version.
5. Dry-run, then apply, through the administrator channel:

   ```sh
   sudo -n python3 <release>/ops/deploy_docs_static.py <release> <manifest>
   sudo -n python3 <release>/ops/deploy_docs_static.py <release> <manifest> --apply
   ```

The helper locks deployment, fails on baseline drift, retains rollback copies,
verifies the Caddy mount (read-only `/srv/site-public`), records all container
runtime identities, publishes bundles/styles before HTML, and compares
host/container hashes. It neither replaces the public directory nor restarts
services. A failed verification restores prior files. A repeated apply fails
closed.

6. Public acceptance (separate from `deployment.json`, which records only
   host/container acceptance): hash-compare release, host and public responses;
   check docs routes and rendered navigation; run a token-masked authenticated
   API smoke. When grepping a served bundle, test the CURRENT response strings —
   a zero match may mean the wording evolved, not that the deploy failed.

If public acceptance fails, restore from `<release>/rollback` with `--rollback`,
then verify baseline hashes. Rollback refuses to overwrite a later release or
modified live files. Never change the backend runtime pointer or replace the
public directory as part of this workflow.
