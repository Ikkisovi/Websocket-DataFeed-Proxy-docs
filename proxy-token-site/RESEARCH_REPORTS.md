# Research reports: access and deployment

Reports are included from the **Basic plan up**. The landing page `/reports/` is public and shows lock state;
everything below the gated prefixes is served only to a signed-in account whose effective plan is allowed.

- Gate: `researchGate` in `server.js`, before `express.static`. Prefixes: `/reports/brain-stock-ranking`, `/reports/factor-stats`.
  Anonymous 401, below Basic or expired 403 (`X-Research-Access: anonymous|insufficient`); browsers get `public/reports/locked.html`, data requests get JSON.
- Plans: `commerce/research-access.cjs` (`basic value standard premium trial test unrestricted`); override with `RESEARCH_ALLOWED_ROLES`.
  The role is the subscription projection's effective role, so an expired plan reads as free.
- Sign-in return: the locked page links `/account?next=<requested /reports/ path and hash>`; the account page follows `next` only for the named targets or a same-site path under `/reports/` (no `//`, no `..`).
- Status for page labels: `GET /api/research/access` -> `{state: anonymous|insufficient|ok|unknown, allowed, plan}`.
- The Brain article ships as its own bundle `reports/brain-stock-ranking/article.js` (gated); the public landing bundle carries only the teaser data (`teaser.json`).
- Factor statistics are generated, not committed. `RESEARCH_PRIVATE_DIR` (default `./private-research`) must hold `factor-stats/data/{index.json,s0..s7.json}`,
  produced by `python -m quantresearch.factor_site.stats` + `build_site` in the OpenAlice repo. This is the retained initial fallback.
- Daily factor statistics are produced by OpenAlice `quantresearch.factor_site.daily` after a verified workstation snapshot. See OpenAlice `docs/factor-site-daily.md` for the owner and date contract.
  Complete immutable versions are mounted read-only at `/app/factor-site`; `current.json` selects the index and lazy shards use `?v=<snapshot_id>`.
  The existing research gate protects both current and previous versions. Responses remain `private, no-store`; daily updates do not restart the portal.
- factor-stats page text (titles, formulas, explanations) comes from saved factors.directory pages: private working reference, not for redistribution.
- Tests: `npx jest research-access.test.js`, `node scripts/test-reports.mjs`.
