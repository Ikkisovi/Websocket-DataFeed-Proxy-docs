# Universe public documentation review (preview only)

- Initial isolated branch: freshly fetched origin/main `60d91229110af810783e05ff46c1a77b75dd2c0e` (2026-10-12).
- Safe fast-forward of this isolated branch: committed local main `ae998c26cfc3d03275484263fb892e358c3a473c` (2026-10-19).
- Public docs bundle checked on 2026-10-20: SHA256 `447693045ccd0197a285e0bdb4ecdc0b1dc2034811ded89555131a2b8d61fd7a`, matching committed main. Main and its dirty GPU files were never edited.
- Newer committed financial/BRAIN docs carried from `375d9aca721006a518f04b1bbc7f184ef6135d2e` in separate baseline commit `5fb65e0a87c59babe37a02bd904413187a8c6cab`; public product-catalog.json is its required bundle input. This does not claim those source changes were deployed.
- Universe implementation / API contract source: `eebd10d0b30231462c9a65f74fc13ff367506cf3`. Read-only acceptance receipt: 2026-10-20T08:36:05.617299+00:00, all_passed=true. Existing API deployment/acceptance is prior evidence; this task does not deploy or revalidate authenticated API calls.
- Dated snapshot example: `ca3a6c3e75980b9a66f9d71e250b37258e6713b1839e47dbdfde3163bdbc3bdd`, 519 members, ETF proxy, non-exact index membership. Only selected actual fields and AAPL member appear publicly. Producer identifiers/hashes are described, not copied into the short example.

Four bilingual articles under `/docs/universes/`: overview/limitations, current/pinned GET requests and aliases, schema/clocks, availability/errors. Navigation, contract catalog/source binding, build-page map, static manifest and generated content-fingerprinted HTML updated. Morningstar/EODHD cross-links clarify membership versus source dates and event coverage.

Validation: public build, public documentation language checks, all existing docs subpage checks, 205 direct article render/navigation/code-copy/search/legacy-link checks, eight static-manifest tests, source-example equality/hash verification. Desktop/mobile browser evidence and transport receipt are retained outside the public package.

The preview commit is the commit containing this document. Its static package is extracted from Git, including the complete docs tree and every referenced image/style/script. No push, merge, production publication, API restart or collector/account mutation is authorized or performed. Preview status is independent of production acceptance.

## Premium wording follow-up

Continues from preview `8a8cd0693eb9826fc92f0d600b6492ed46947622`; its independent service/release/port is retained.

Verified implementation at accepted source commit `eebd10d0b30231462c9a65f74fc13ff367506cf3` (working files match the committed bytes):

- `rest-rs/src/product-catalog.json`: `tiers.premium.permissions.rest.financial=true`; Premium does not imply `cn_archive`.
- `main.rs:4794` commercial capability resolves active market grants and explicit denials; `has_fmp_access` uses `financial`. `required_commercial_capability` maps universe, fundamental and EODHD routes to that capability.
- `universe.rs:32`, Morningstar handlers and `qc_native_archive` use that same entitlement; private coordinator admission rechecks it. There is no separate universe subscription gate. Existing account/token validity and explicit denials still apply.
- The docs public financial catalog agrees on Premium financial inclusion. No discrepancy found for standard active Premium access. Brain retains its separate account restriction; China retains its independently expiring grant.

Six direct articles now explicitly say, in both languages: an existing active Premium account includes Morningstar, EODHD and general universe snapshots; reuse the existing valid token, with no separate universe plan, extra data purchase or new token. Universe cURL placeholders now say Premium. No catalog entitlement, China/Brain content, API implementation or production service was changed.

Focused verification caught automatic word replacement inside the new authored bilingual notice; that notice now opts out of the legacy text translator so both languages retain their exact text. Public build/language checks; 12 bilingual article renders checking the exact inclusion/no-add-on wording, direct navigation and absence of page errors; byte comparisons preserve China/Brain source blocks and both implementation-bound API catalog files. A new commit-pinned private preview is used for this revision, preserving the original preview.


## Customer-facing rewrite

Continues from `4f96317136633a05f3ca674d49fbe52e6386078a`. This revision supersedes the earlier draft's broader baseline carry-forward. All unrelated site bodies are taken from the previously verified live docs source `ae998c26cfc3d03275484263fb892e358c3a473c`; this is a preview source decision, not a production rollback.

- Withdraw the carried Brain pages, research illustrations, API catalog/source metadata, option/FMP/WS wording changes and other unrelated additions. Those files are absent from the new docs tree/package. Existing live China, stock/research signal and Regular financial bodies remain byte-identical to that baseline.
- Universe is now two customer articles: what the member list contains, and how to query/save/reuse it. The text covers Premium inclusion, the existing token, a small true example, fixed versions, ETag, errors and short coverage limits. No producer, script/config hashes, fingerprints, infrastructure or research-process explanation is added.
- Morningstar daily and EODHD pages are rewritten around the actual request fields, available dates, pagination, missing values and useful response fields. Legacy live Morningstar article routes remain available; this revision does not rewrite those unrelated existing articles.
- Public content lives in `customer-financial.jsx`; this review file and all validation receipts stay outside the docroot. The package contains static reader assets only, excluding JSX/MJS sources, JSON source catalogs, review documents and research/report directories.
- Validation checks new copy and built bundle for the withdrawn implementation/research markers, compares unrelated bodies against the verified live source, verifies the short example against the supplied actual snapshot, and exercises customer pages in both languages and desktop/mobile layouts.

No API schema or data, production services, main checkout, unrelated dirty GPU files, account permissions or remote Git branches are changed. Older private preview releases remain untouched; this revision receives its own commit-pinned release, service and port.
