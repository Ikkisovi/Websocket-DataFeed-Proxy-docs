import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { JSDOM, VirtualConsole } from "jsdom";
import { DOC_ARTICLES } from "../public/docs/doc-navigation.mjs";

const contractBytes = fs.readFileSync(new URL("../public/docs/public-api-contract.json", import.meta.url));
const contract = JSON.parse(contractBytes);
const contractSource = JSON.parse(fs.readFileSync(new URL("../public/docs/api-contract-source.json", import.meta.url)));
assert.equal(createHash("sha256").update(contractBytes).digest("hex"), contractSource.sha256);
const root = new URL("../public/", import.meta.url);
const bundle = fs.readFileSync(new URL("assets/docs-page.js", root), "utf8");
const language = fs.readFileSync(new URL("language.js", root), "utf8");
const cases = [
  ["/docs/market/overview/api-contract/", [/Live API contract/, /X-Leandata-Contract-SHA256/, /X-Leandata-Data-Tier/, /route_not_migrated/, /endpoint_unavailable/]],
  ["/docs/market/overview/response-delivery/", [/direct=1/, /archive-direct\.leandata\.uk/, /303/, /307/, /without Authorization/, /counts once/]],
  ["/docs/market/options/option-oi-latest/", [/06:30/, /previous trading session/, /retrieval time/, /missing records are not zero/i]],
  ["/docs/market/options/post-v1-options-snapshots-open-interest/", [/not an implemented OI interface/, /v3\/option\/snapshot\/open_interest/]],
  ["/docs/financial/regular/fmp-calendar-support/", [/earnings-calendar/, /dividends-calendar/, /501/, /not a plan-upgrade prompt/]],
  ["/docs/status/", [/measure connectivity/, /not the freshness/, /p50\s*—\s*ms/]],
];
for (const [path, patterns] of cases) {
  assert(DOC_ARTICLES[path] || path === "/docs/status/", path);
  const id = DOC_ARTICLES[path]?.id || "overview";
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
