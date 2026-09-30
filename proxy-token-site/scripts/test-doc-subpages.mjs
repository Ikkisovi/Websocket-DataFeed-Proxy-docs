import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const languageScript = fs.readFileSync(new URL("../public/language.js", import.meta.url), "utf8");
const docsBundle = fs.readFileSync(new URL("../public/assets/docs-page.js", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setTimeout(resolve, 70));
const visible = element => Boolean(element && !element.closest("[hidden]"));
function headingFor(document, id) {
  const node = document.getElementById(id);
  return node?.matches("h2, h3") ? node : node?.querySelector(":scope > h2, :scope > h3");
}
async function render(pathname, language = "zh") {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: `https://leandata.uk${pathname}`, runScripts: "outside-only", pretendToBeVisual: true,
  });
  dom.window.localStorage.setItem("leandata.language", language);
  dom.window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.fetch = async () => ({ ok: false, status: 401, json: async () => ({ components: [] }) });
  dom.window.eval(languageScript);
  dom.window.eval(docsBundle);
  await tick();
  return dom;
}
function close(dom) { dom.window.LeandataI18n.destroy(); dom.window.close(); }

const home = await render("/docs/");
assert(home.window.document.querySelector('a[href="/docs/market/stocks/"]'));
assert(home.window.document.querySelector('a[href="/docs/financial/morningstar/"]'));
close(home);

const cases = [
  ["market/overview", "authentication", "post-admin-login"],
  ["market/stocks", "post-v1-history-bars", "stock-single-bars"],
  ["market/options", "post-v1-options-contracts", "post-v1-options-snapshots-quote"],
  ["market/indices", "get-post-v1-indices-minute", "get-v1-futures-history-bars"],
  ["market/research-signals", "get-post-v1-spectral-tick-flow", "spectral-fields"],
  ["market/crypto-news", "post-v1-history-news", "get-post-v1beta3-crypto-us-snapshots"],
  ["market/cn", "cn-minute-bars", "cn-access"],
  ["financial/regular", "fmp-quote", "fmp-profile"],
  ["financial/statements", "fmp-income-statement", "fmp-balance-sheet-statement"],
  ["financial/ratios-growth", "fmp-ratios", "fmp-financial-growth"],
  ["financial/morningstar", "morningstar-history", "morningstar-fields"],
  ["realtime/websocket", "endpoint", "options"],
  ["realtime/subscriptions", "subscribe", "quote"],
];
let totalPages = 0;
for (const [path, first, second] of cases) {
  const dom = await render(`/docs/${path}/`, "en");
  const doc = dom.window.document;
  assert(visible(doc.querySelector(".reference-index")), `${path} must start with a subpage index`);
  assert.equal([...doc.querySelectorAll("main .tbl")].filter(visible).length, 0, `${path} must not start as a long table page`);
  const ids = [...doc.querySelectorAll("[data-reference-page]")].map(node => node.dataset.referencePage);
  assert(ids.includes(first), `${path}: missing ${first}`);
  assert(ids.includes(second), `${path}: missing ${second}`);
  assert.equal(new Set(ids).size, ids.length, "Subpage IDs must be unique");
  totalPages += ids.length;

  // Exercise every generated page: exactly its own primary heading is visible.
  for (const id of ids) {
    dom.window.location.hash = id;
    await tick();
    assert(visible(headingFor(doc, id)), `${path}#${id}: selected heading must be visible`);
    const otherVisible = ids.filter(other => other !== id && visible(headingFor(doc, other)));
    assert.deepEqual(otherVisible, [], `${path}#${id}: neighboring pages must stay hidden`);
    assert(visible(doc.querySelector(".reference-breadcrumb")));
  }
  dom.window.location.hash = first;
  await tick();
  const copiedSource = [...doc.querySelectorAll("main pre.code")].filter(visible).map(node => node.textContent);
  dom.window.location.hash = second;
  await tick();
  assert(!visible(headingFor(doc, first)));
  doc.querySelector(".reference-breadcrumb a").click();
  await tick();
  assert.equal(dom.window.location.hash, "");
  assert(visible(doc.querySelector(".reference-index")));
  dom.window.location.hash = first;
  await tick();
  assert.deepEqual([...doc.querySelectorAll("main pre.code")].filter(visible).map(node => node.textContent), copiedSource, "Switching subpages must not change examples");
  close(dom);

  const direct = await render(`/docs/${path}/#${second}`, "zh");
  assert(visible(headingFor(direct.window.document, second)), "Reload/deep links must select the subpage");
  assert(!visible(headingFor(direct.window.document, first)));
  close(direct);
}

const options = await render("/docs/market/options/#quote-python-example", "en");
assert(visible(headingFor(options.window.document, "post-v1-options-snapshots-quote")), "An example anchor must select its containing endpoint");
assert(visible(options.window.document.getElementById("quote-python-example")));
close(options);

const indices = await render("/docs/market/indices/#futures-operator-archive");
const indexText = indices.window.document.body.textContent;
assert.match(indexText, /"roots_count": 2/);
assert.match(indexText, /clock=source_naive/);
assert.match(indexText, /"75\.32406843352302"/);
for (const privateTerm of ["/srv/leandata", "18772", "/mnt/data/cache", '"roots_count": 68']) assert(!indexText.includes(privateTerm));
close(indices);

const cn = await render("/docs/market/cn/#cn-minute-bars", "en");
assert.match(cn.window.document.querySelector("main > .provider-note").textContent, /private beta.*explicitly authorized/);
close(cn);

const financial = await render("/docs/financial/regular/", "en");
const statementsGroup = [...financial.window.document.querySelectorAll('.docs-sidenav [role="button"]')].find(node => node.textContent.includes("Financial statements"));
statementsGroup.click();
await tick();
assert.equal(financial.window.document.querySelector('[data-doc-id="fmp-income-statement"]').getAttribute("href"), "/docs/financial/statements/#fmp-income-statement");
close(financial);

const unknown = await render("/docs/market/options/#does-not-exist", "en");
assert(visible(unknown.window.document.querySelector(".reference-index")));
assert(unknown.window.document.querySelector(".reference-missing"));
assert.equal([...unknown.window.document.querySelectorAll("main .tbl")].filter(visible).length, 0);
close(unknown);
const malformed = await render("/docs/market/options/#%ZZ", "en");
assert(visible(malformed.window.document.querySelector(".reference-index")), "Malformed hashes must not crash the reader");
close(malformed);

process.stdout.write(`embedded docs: ${cases.length} categories and ${totalPages} subpages isolated; index/detail, deep links, nested examples, cross-category routing and exact example preservation passed\n`);
