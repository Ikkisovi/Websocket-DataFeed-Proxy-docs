# Website entry cache releases

`static_entry_cache.py` updates both the private static origin and the public
website host. Updating only the private origin does not cover the public PHX
website response. REST, WS and portal API routes remain unchanged.

Package the clean commit's `deploy_entry_cache.py` and `static_entry_cache.py`
into an immutable private release directory, with `release.json` containing
`source_commit` and the expected current `homepage_sha256`. Retain the package
hash. Do not include host configuration or credentials in Git.

Run `python3 deploy_entry_cache.py <release>` for preflight. Apply only the exact
prepared package with `--apply`. A converged policy reports `already_applied`
with zero restarts. Apply pauses PHX recovery, preserves configuration backups,
validates the loaded Caddy image, restarts only changed website proxies, checks
ordinary query-free public addresses, re-admits fingerprints and resumes recovery.

Docker can reorder its `Mounts` list on restart. Compare full normalized mount
records; never skip checking source, destination, write permissions or added and
removed mounts. Image, container configuration and resource/security limits must
still match. A true invariant or public-response failure retains automatic rollback.

`failure.json` records the phase, reason and rollback result, distinguishing
`rolled_back` from `rollback_failed`. If restoring the original configuration
fails, maintenance remains enabled for operator recovery. Keep failed attempt
directories and use a new attempt directory rather than overwriting receipts.

Validation: `python3 -B -m unittest discover -s ops -p 'test_*entry_cache.py' -v`.
