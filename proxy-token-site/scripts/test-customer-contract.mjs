import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { JSDOM, VirtualConsole } from "jsdom";
import { DOC_ARTICLES } from "../public/docs/doc-navigation.mjs";
const require = createRequire(import.meta.url);
const { publicCatalog } = require("../commerce/product-catalog.cjs");
const commercialCatalog = JSON.parse(fs.readFileSync(new URL("../public/product-catalog.json", import.meta.url)));
assert.deepEqual(commercialCatalog, publicCatalog(), "Generated public catalog must exactly match checkout commercial definitions");
assert.equal(commercialCatalog.tiers.trial, undefined);
assert.equal(commercialCatalog.tiers.test, undefined);
assert.equal(commercialCatalog.free_baseline_permanent, true);

const contractBytes = fs.readFileSync(new URL("../public/docs/public-api-contract.json", import.meta.url));
const contract = JSON.parse(contractBytes);
const contractSource = JSON.parse(fs.readFileSync(new URL("../public/docs/api-contract-source.json", import.meta.url)));
assert.equal(createHash("sha256").update(contractBytes).digest("hex"), contractSource.sha256);
const root = new URL("../public/", import.meta.url);
const bundle = fs.readFileSync(new URL("assets/docs-page.js", root), "utf8");
const language = fs.readFileSync(new URL("language.js", root), "utf8");
for (const schedule of Object.values(contract.refresh_schedules)) {
  assert.equal(schedule.expected_start_time, "06:00");
  assert.equal(schedule.time_zone, "America/Los_Angeles");
  assert.equal(schedule.frequency, "daily");
}
const cases = [
  ["/docs/market/research-signals/brain-overview/", [/Private preview/, /2220/, /947/, /historical union/, /security_id/, /rank2days/, /rank3days/, /rank5days/, /rank10days/, /rank21days/]],
  ["/docs/market/research-signals/brain-universe-snapshot/", [/Private preview/, /date=latest/, /947/, /brain_snapshot_not_found/, /10000/, /403/, /publication-time/]],
  ["/docs/market/research-signals/brain-history/", [/Planned API/, /366/, /seven/, /default all five horizons/, /next_cursor/, /missing scores are not zero/]],
  ["/docs/market/research-signals/brain-latest/", [/Planned API/, /resolved_date/, /not carried forward/, /not a live/]],
  ["/docs/market/research-signals/brain-securities/", [/Planned API/, /not Brain's official constituent list/, /first_observed_date/, /continuous membership/]],
  ["/docs/market/research-signals/brain-coverage/", [/Planned API/, /historical_security_count/, /latest_date_security_count/, /update time has not been announced/]],
  ["/docs/market/options/post-v1-options-contracts/", [/Alpaca/, /show_deliverables/, /page_token/, /stale/, /settlement delay, not data latency/, /historical contract master/]],
  ["/docs/financial/eodhd/eodhd-fields/", [/shareholder record date/, /currency/, /source_updated_at/, /per share/]],
  ["/docs/financial/eodhd/eodhd-history/", [/snapshot_date/, /not event dates/, /symbols=PG,MSFT/, /no separate event-date filter/]],
  ["/docs/financial/eodhd/eodhd-coverage/", [/pagination ended/, /not completion/]],

  ["/docs/financial/morningstar/morningstar-overview/", [/06:00/, /PST\/PDT/, /Morningstar/]],
  ["/docs/financial/morningstar/morningstar-daily-history/", [/daily\/history/, /one row per stock and day/, /snapshot/, /source_dates/]],
  ["/docs/financial/morningstar/morningstar-daily-coverage/", [/unobserved_weekdays/, /missing_by_field/, /stock_coverage_ratio/]],
  ["/docs/financial/eodhd/eodhd-overview/", [/Premium/, /earnings/, /dividends/, /splits/, /near-term US earnings/i, /Morningstar/, /06:00/]],
  ["/docs/financial/eodhd/eodhd-fields/", [/snapshot_date/, /report_time/, /dividend_date/, /row_id/, /not zero/]],
  ["/docs/financial/eodhd/eodhd-history/", [/start\/end filter snapshot_date/, /next_offset/, /100000/, /Response example/, /ABT/]],
  ["/docs/financial/eodhd/eodhd-coverage/", [/latest_capture_date/, /Coverage is not paginated/, /data\[\].rows/]],
  ["/docs/realtime/websocket/", [/original JSON in binary WebSocket frames/, /MessagePack control acknowledgements only/, /json.loads/, /frame and byte budgets/]],
  ["/docs/realtime/subscriptions/", [/replaces the full subscription set/, /Unsubscribe clears all subscriptions without an acknowledgement/, /bars subscriptions/]],
  ["/docs/market/overview/api-contract/", [/Live API contract/, /X-Leandata-Contract-SHA256/, /X-Leandata-Data-Tier/, /route_not_migrated/, /endpoint_unavailable/]],
  ["/docs/market/overview/response-delivery/", [/direct=1/, /archive-direct\.leandata\.uk/, /303/, /307/, /without Authorization/, /counts once/]],
  ["/docs/market/options/option-oi-latest/", [/06:30/, /previous trading session/, /retrieval time/, /missing records are not zero/i]],
  ["/docs/market/options/post-v1-options-snapshots-open-interest/", [/not an implemented OI interface/, /v3\/option\/snapshot\/open_interest/]],
  ["/docs/financial/regular/fmp-fundamentals-overview/", [/fixed snapshot/i, /do not update automatically/i]],
  ["/docs/financial/regular/fmp-snapshot-boundary/", [/Fixed snapshot, no automatic updates/, /not current values/, /Morningstar/, /EODHD/]],
  ["/docs/financial/regular/fmp-quote/", [/Fixed snapshot/, /No automatic updates/, /does not automatically receive/]],
  ["/docs/financial/statements/fmp-income-statement/", [/Fixed snapshot/, /No automatic updates/, /does not automatically receive/]],
  ["/docs/financial/regular/fmp-calendar-support/", [/earnings-calendar/, /dividends-calendar/, /501/, /EODHD/, /Morningstar/, /06:00/]],
  ["/docs/market/overview/tiers-permissions/", [/GET \/api\/product-catalog/, /Permanent/, /independent.*expiry/i, /Trial is retired/, /31 days/, /nearest 2 upcoming expiries/]],
  ["/docs/market/overview/free-plan-usage/", [/31 calendar days/, /nearest 2 upcoming expiration/, /All six channels/, /boats/]],
  ["/docs/market/crypto-news/post-v1-history-news/", [/Premium only/]],
  ["/docs/market/crypto-news/post-v1-crypto-us-latest-orderbooks/", [/Premium/]],
  ["/docs/status/", [/measure connectivity/, /not the freshness/, /p50\s*—\s*ms/]],
];
for (const [path, patterns] of cases) {
  assert(DOC_ARTICLES[path] || ["/docs/status/", "/docs/realtime/websocket/", "/docs/realtime/subscriptions/"].includes(path), path);
  const id = DOC_ARTICLES[path]?.id || (path.includes("/realtime/") ? path.includes("/websocket/") ? "endpoint" : "subscribe" : "overview");
  const errors = [];
  const console = new VirtualConsole();
  console.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: `https://leandata.uk${path}`, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: console,
  });
  dom.window.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  dom.window.localStorage.setItem("leandata.language", "en");
  dom.window.eval(language); dom.window.eval(bundle);
  for (let i = 0; i < 40 && !dom.window.document.querySelector(`main #${id}`); i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const main = dom.window.document.querySelector("main");
  assert(main, path); assert.deepEqual(errors, []);
  for (const pattern of patterns) assert.match(main.textContent, pattern, path);
  if (path.includes("/brain-")) {
    assert(main.querySelector(`[data-brain-status="${/brain-(overview|universe-snapshot)/.test(path) ? 'private-preview' : 'planned'}"]`), path);
    for (const url of ["https://braincompany.co/bsr.html", "https://www.braincompany.co/assets/files/BSR_summary.pdf"]) {
      const link = main.querySelector(`a[href="${url}"]`);
      assert(link, `${path}: Brain official link`);
      assert.equal(link.target, "_blank");
      assert(link.rel.includes("noopener") && link.rel.includes("noreferrer"));
    }
    assert.doesNotMatch(main.textContent, /original five-day score|原始五日评分|brain-stock-ranking-5day/);
    assert.doesNotMatch(main.textContent, /upstream_completeness_verified|source_sha256|research_admission|ClickHouse|loaded_at/);
  }
  if (/\/fmp-(?:fundamentals-overview|snapshot-boundary|quote|income-statement)\/$/.test(path)) {
    assert.doesNotMatch(main.textContent, /we update our data accordingly|我们会定期更新|Publish regularly updated|Ultimate Plan/);
  }
  if (path.endsWith("/tiers-permissions/")) {
    const rows = [...main.querySelectorAll("[data-product-catalog] tbody tr")];
    assert.equal(rows.length, Object.keys(commercialCatalog.tiers).length);
    assert(rows.every(row => !/Trial|\btest\b/.test(row.cells[0].textContent)));
    assert.doesNotMatch(main.textContent, /500 \/ connection|100 WebSocket connections|Free \(30 days\)/);
    for (const [name, tier] of Object.entries(commercialCatalog.tiers)) {
      const row = rows.find(row => row.cells[0].querySelector(`.tier.${name}`));
      assert(row, name);
      for (const channel of ["stocks", "options", "boats", "overnight", "crypto", "news"]) {
        assert.equal(row.cells[2].textContent.includes(channel), tier.permissions.ws[channel], `${name}.${channel}`);
      }
      for (const [mode, permissions] of Object.entries(tier.modes || {})) {
        const scope = [...row.cells[3].querySelectorAll("div")].find(value => value.querySelector("strong")?.textContent === `${mode}:`);
        assert(scope, `${name}.${mode}`);
        for (const capability of ["stocks_history", "options_history", "options_contracts", "options_snapshots"]) {
          assert.equal(scope.textContent.split(/[:,]\s*/).includes(capability), permissions.rest[capability], `${name}.${mode}.${capability}`);
        }
      }
    }
  }
  if (path.endsWith("/eodhd-overview/") || path.endsWith("/morningstar-overview/") || path.endsWith("/fmp-calendar-support/")) {
    const schedule = main.querySelector("[data-financial-refresh-schedule]");
    assert(schedule, path);
    assert.match(schedule.textContent, /06:00 Pacific time/);
    assert.match(schedule.textContent, /latest data date/);
    assert(schedule.textContent.length < 220, "Refresh guidance should be one short sentence");
    assert.doesNotMatch(schedule.textContent, /UTC-8|UTC-7/);
  }
  if (path.endsWith("/eodhd-overview/")) {
    assert.doesNotMatch(main.textContent, /research_admission|source_sha256|upstream_completeness|303|307|PIT|cookies/i);
    assert(main.querySelector('a[href="/docs/financial/morningstar/"]'));
  }
  if (path.endsWith("/morningstar-daily-history/") || path.endsWith("/morningstar-daily-coverage/")) {
    const code = [...main.querySelectorAll("pre.code")].find(n => n.textContent.startsWith("curl "))?.textContent;
    assert(code && code.includes("\\\n"), "Financial curl examples must preserve line continuations");
    assert.equal(spawnSync("bash", ["-n"], {input: code, encoding: "utf8"}).status, 0);
    assert.doesNotMatch(main.textContent, /Morningstar v3 Dataset|legacy_direct admitted/);
  }
  if (path.endsWith("/eodhd-history/")) {
    const examples = [...main.querySelectorAll("pre.code")].map(node => node.textContent);
    const curl = examples.find(code => code.includes("curl "));
    assert(curl.includes("\\\n"), "Multiline curl must preserve shell continuations");
    assert(curl.includes('"start=2026-10-14"'));
    assert.doesNotMatch(curl, /--location|start_date=/);
    assert.equal(spawnSync("bash", ["-n"], { input: curl, encoding: "utf8" }).status, 0);
    const response = JSON.parse(examples.find(code => code.startsWith("{")));
    assert.equal(response.data[0].payload.report_date, "2026-10-21");
    assert.equal(response.data[0].payload.snapshot_date, "2026-10-14");
    assert.equal(response.next_offset, null);
    assert(main.querySelector("details"), "Advanced delivery details stay collapsed by default");
  }
  if (path.endsWith("/websocket/")) {
    assert.doesNotMatch(main.textContent, /msgpack.unpackb|200 messages|50–80%/);
    const examples = [...main.querySelectorAll("pre.code")].map(node => node.textContent).filter(code => code.startsWith("import asyncio"));
    assert.equal(examples.length, 2);
    for (const example of examples) {
      const result = spawnSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: example, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
  }
  if (path.endsWith("/free-plan-usage/")) assert.doesNotMatch(main.textContent, /10 calendar days/);
  if (path.endsWith("/api-contract/")) {
    for (const op of contract.operations) assert(main.textContent.includes(op.path), op.path);
    assert(main.textContent.includes(contractSource.sha256));
    for (const code of main.querySelectorAll("pre.code")) {
      const text = code.textContent;
      if (text.startsWith("curl ")) {
        assert(text.includes("Authorization: Bearer $LEANDATA_TOKEN"));
        assert(!text.includes("undefined"));
      }
    }
  }
  if (path.endsWith("/post-v1-options-contracts/")) {
    const note = main.querySelector("[data-option-reference-note]");
    assert(note);
    for (const host of ["docs.alpaca.markets", "infomemo.theocc.com", "www.theocc.com"]) {
      const link = [...note.querySelectorAll("a")].find(a => new URL(a.href).hostname === host);
      assert(link, host); assert.equal(link.style.color, "rgb(37, 99, 235)");
      assert.equal(link.target, "_blank"); assert.match(link.rel, /noopener/);
    }
  }
  if (path.endsWith("/eodhd-history/")) {
    const example = [...main.querySelectorAll("pre.code")].find(n => n.textContent.includes("symbols=PG,MSFT"));
    assert(example.textContent.includes("\\\n"), "Copied curl must preserve shell line continuations");
  }
  dom.window.LeandataI18n.destroy(); dom.window.close();
}
assert.doesNotMatch(bundle, /\/api\/admin\/(?:login|approve|reject|pending)|ADMIN_PASSWORD|admin123/);
for (const id of ["post-admin-login", "get-admin-pending", "post-admin-approve", "post-admin-reject"]) {
  const html = fs.readFileSync(new URL(`docs/market/overview/${id}/index.html`, root), "utf8");
  assert.match(html, /page retired/);
  assert.doesNotMatch(html, /\/api\/admin\/|ADMIN_PASSWORD/);
}
console.log("Customer delivery, OI clocks, calendar availability and retired operator pages pass");

const marketSkill = fs.readFileSync(new URL("skills/leandata-market-data/SKILL.md", root), "utf8");
for (const pattern of [/events\/eodhd\/coverage/, /events\/eodhd\/history/, /next_offset/, /start_date.*not supported aliases/, /06:00 Pacific time/, /America\/Los_Angeles/]) assert.match(marketSkill, pattern);

assert.match(marketSkill, /fixed snapshot and do not update automatically/);

for (const file of ["docs/docs-site.jsx", "docs/public-api-contract.json", "skills/leandata-market-data/SKILL.md"]) {
  const source=fs.readFileSync(new URL(file,root),"utf8");
  assert.doesNotMatch(source,/upstream_completeness_verified|research_admission|source_csv_sha256|archive_bundle_sha256|source_sha256/,file);
}
