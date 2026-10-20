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
