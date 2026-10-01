# Scoped static documentation release

The PHX portal serves precompiled `assets/docs-page.js` and `assets/token-page.js`.
The canonical document is `public/docs/docs-site.jsx`; the root `docs-site.jsx`
is a compatibility loader. Do not overwrite the compiled HTML entries with the
older Babel/CDN shells from `240249a37`.

The reading-experience layer uses `public/docs/reading.css` (scoped to
`.docs-reader`) and `public/docs/code-block.jsx` (compiled into both docs and
portal bundles). Publish the reading stylesheet before the HTML entries. The
page generator versions its CSS and JavaScript together. Existing account,
checkout, announcement and backend files are not part of this overlay.
The branded masthead uses the supplied 200×200 mark at
`public/assets/brand/leandata-mark.png`. Preserve its source bytes; an inline
SVG color matrix maps its blue gradient to the site's teal/slate palette while
preserving white and alpha. Include that asset in the hash-bound manifest.
The display wordmark is capitalized `LeanData` and remains serif; the subtitle
is `Stock & Options API`. Reference headings, body copy and code controls keep
the reading-layer fonts.

`public/docs/embedded-docs.jsx` projects the canonical reference into focused
endpoint/topic subpages inside 13 existing category URLs. An empty hash opens
the searchable index; `#<endpoint-id>` selects only that endpoint and its
examples. Breadcrumbs, previous/next links, the sidebar, nested example links
and browser history all use the same hash routing. Existing content remains
React-owned and parameter/example bytes are unchanged. New modules and the
mark are allowlisted static assets, not new backend routes. Unknown hashes
show the index with a notice rather than exposing a giant reference table.

Run `npm ci --ignore-scripts && npm test` from `proxy-token-site/` and
`python3 ops/test_deploy_docs_static.py` from the repository root before a
release. The reading regression checks cover exact full-text copying, denied
Clipboard API fallback, visible failure feedback, wrap/expand controls,
keyboard-accessible scroll regions, and Chinese/English switching. The subpage
suite additionally checks all 195 generated endpoint/topic pages, neighboring
content isolation, direct/nested links, index return and cross-category links. Before
acceptance, also inspect real-browser desktop and mobile rendering: JSDOM
cannot prove widths, scrolling, font metrics or real clipboard behavior.

The 2026-09-19 host inspection found no installed forced-command site wrapper.
The existing `ubuntu@100.88.18.95` administrator can use `sudo -n`; an absent
`deploy-site` command is not evidence that administrator access is unavailable.
This scoped administrator workflow is independent of automatic GitLab deployment.
It does not add SSH keys, broaden sudo rules, or enable CI runners.

1. Build and test an isolated docs checkout; commit and mirror the source to both
   remotes. Preserve the source commit, baseline commit and exact file hashes.
2. Compare the live canonical docs, homepage source, usage source and language
   script with the selected baseline. Preserve newer backend/account changes.
3. Validate the live Compose file list with the host deployment environment.
   Record container identity, mounts, runtime release and public directory inode.
4. Materialize only the public files allowlisted in `deploy_docs_static.py`—the
   compiled bundles, provider logo assets, shared styles/source, root entries, and
   independent docs-page `index.html` files—plus that reviewed script from the committed Git archive into
   `/srv/leandata/site-releases/docs-nav/<full-commit>`.
5. Write a private deployment manifest with `commit`, a `files` mapping of each
   selected allowlisted relative path to its `before` and `after` SHA-256, and `dependencies`
   mapping unchanged `token-page.jsx`, `language.js`, `docs/usage-page.jsx` and
   `docs-site.jsx` to baseline SHA-256. Retain it outside the public directory.
6. Run through the existing administrator channel:

   ```sh
   sudo -n python3 <release>/ops/deploy_docs_static.py <release> <manifest>
   sudo -n python3 <release>/ops/deploy_docs_static.py <release> <manifest> --apply
   ```

A scoped subset must include the canonical docs source, both docs/homepage bundles,
and both root/docs HTML entries. Keep unrelated registration, language, skill and
account assets out of the selected file set; do not overwrite a newer live overlay
merely because the source checkout contains a different unselected file.

The helper locks deployment, fails on baseline drift, retains rollback copies,
creates only allowlisted page directories, replaces files inside the existing
mounted tree, and compares host/container hashes. It neither replaces the mounted
public directory nor restarts services. A failed local verification restores prior
files and removes newly created page files. A repeated apply fails closed.

7. Compare release, host, container and public response hashes for every allowlisted file.
   Check the docs, portal, account, alternative-data and API health routes; run
   a token-masked authenticated smoke. Verify rendered navigation, CN access
   wording, language switch and mobile menu. Retain public acceptance separately
   from `deployment.json`, which records only host/container acceptance.

If public acceptance fails, restore the prior allowlisted files from `<release>/rollback`
in place and verify the baseline hashes. Never change the backend runtime pointer,
replace the public directory, or deploy the older server as part of this workflow.
