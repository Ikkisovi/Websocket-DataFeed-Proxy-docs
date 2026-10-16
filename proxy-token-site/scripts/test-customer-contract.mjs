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
const cases = [
  ["/docs/realtime/websocket/", [/original JSON in binary WebSocket frames/, /MessagePack control acknowledgements only/, /json.loads/, /frame and byte budgets/]],
  ["/docs/realtime/subscriptions/", [/replaces the full subscription set/, /Unsubscribe clears all subscriptions without an acknowledgement/, /bars subscriptions/]],
  ["/docs/market/overview/api-contract/", [/Live API contract/, /X-Leandata-Contract-SHA256/, /X-Leandata-Data-Tier/, /route_not_migrated/, /endpoint_unavailable/]],
  ["/docs/market/overview/response-delivery/", [/direct=1/, /archive-direct\.leandata\.uk/, /303/, /307/, /without Authorization/, /counts once/]],
  ["/docs/market/options/option-oi-latest/", [/06:30/, /previous trading session/, /retrieval time/, /missing records are not zero/i]],
  ["/docs/market/options/post-v1-options-snapshots-open-interest/", [/not an implemented OI interface/, /v3\/option\/snapshot\/open_interest/]],
  ["/docs/financial/regular/fmp-calendar-support/", [/earnings-calendar/, /dividends-calendar/, /501/, /not a plan-upgrade prompt/, /events\/eodhd\/history/, /events\/eodhd\/coverage/, /snapshot_date/, /report_date/, /dividend_date/, /observed captures only/, /research_admission=false/, /without an Authorization header/]],
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
  dom.window.LeandataI18n.destroy(); dom.window.close();
}
assert.doesNotMatch(bundle, /\/api\/admin\/(?:login|approve|reject|pending)|ADMIN_PASSWORD|admin123/);
for (const id of ["post-admin-login", "get-admin-pending", "post-admin-approve", "post-admin-reject"]) {
  const html = fs.readFileSync(new URL(`docs/market/overview/${id}/index.html`, root), "utf8");
  assert.match(html, /page retired/);
  assert.doesNotMatch(html, /\/api\/admin\/|ADMIN_PASSWORD/);
}
console.log("Customer delivery, OI clocks, calendar availability and retired operator pages pass");
