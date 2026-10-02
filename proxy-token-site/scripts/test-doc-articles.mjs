import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import { JSDOM, VirtualConsole } from "jsdom";
import { DOC_ARTICLES, resolveLegacyDocPath } from "../public/docs/doc-navigation.mjs";

const publicRoot = new URL("../public/", import.meta.url);
const languageScript = fs.readFileSync(new URL("language.js", publicRoot), "utf8");
const bundle = fs.readFileSync(new URL("assets/docs-page.js", publicRoot), "utf8");
const allIds = new Set(Object.values(DOC_ARTICLES).map(article => article.id));
const app = express();
app.use(express.static(publicRoot.pathname));
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function render(article, language = "en") {
  const errors = [];
  const console = new VirtualConsole();
  console.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: `https://leandata.uk${article.path}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: console,
  });
  dom.window.localStorage.setItem("leandata.language", language);
  dom.window.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const copied = [];
  dom.window.navigator.clipboard = { writeText: async text => { copied.push(text); } };
  dom.window.eval(languageScript);
  dom.window.eval(bundle);
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    const document = dom.window.document;
    const main = document.querySelector("main");
    const rail = document.querySelector(".doc-code-rail");
    if (main && rail && (!main.querySelector("pre.code") || rail.querySelector(".doc-rail-code"))) break;
  }
  return { dom, errors, copied };
}

function close(dom) {
  dom.window.LeandataI18n.destroy();
  dom.window.close();
}

try {
  for (const article of Object.values(DOC_ARTICLES)) {
    // A fresh HTTP request and fresh document exercise direct links and refreshes.
    const response = await fetch(base + article.path);
    assert.equal(response.status, 200, article.path);
    const html = await response.text();
    assert.match(html, /\/docs\/doc-layout.css/);
    assert.match(html, /\/assets\/docs-page.js/);
    const { dom, errors } = await render(article);
    try {
      const document = dom.window.document;
      const main = document.querySelector("main");
      assert(main.querySelector(`[id="${article.id}"]`), `Missing article: ${article.path}`);
      assert.deepEqual(errors, [], article.path);
      const active = document.querySelector('.doc-leaf[aria-current="page"]');
      assert.equal(active?.getAttribute("href"), article.path, "Active leaf must match the address");
      assert(!document.querySelector('.doc-leaf[href^="#"]'), "Sidebar leaves must open documents");
      const mountedIds = [...main.querySelectorAll("[id]")].map(node => node.id).filter(id => allIds.has(id));
      assert.deepEqual([...new Set(mountedIds)], [article.id], `Unrelated article mounted at ${article.path}`);
      assert(main.textContent.trim().length > 40, `Empty article: ${article.path}`);
      const rail = document.querySelector(".doc-code-rail");
      assert(rail, article.path);
      const firstCode = main.querySelector("pre.code");
      if (firstCode) assert.equal(rail.querySelector(".doc-rail-code").textContent, firstCode.textContent, "Rail must use this article's original code");
    } finally { close(dom); }
  }

  const article = DOC_ARTICLES["/docs/market/stocks/post-v1-history-bars/"];
  const { dom, copied } = await render(article, "zh");
  try {
    const document = dom.window.document;
    const select = document.querySelector('[aria-label="Select code example"]');
    assert(select.options.length >= 2, "Request and response must be available");
    select.value = "1";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 10));
    const selectedCode = document.querySelector(".doc-rail-code").textContent;
    document.querySelector('[aria-label="Copy selected code example"]').click();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(copied.at(-1), selectedCode, "Copy must preserve the selected example byte for byte");
    assert.match(document.querySelector('[aria-label="Copy selected code example"]').textContent, /Copied/);
    document.querySelector("main .doc-copy").click();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(copied.at(-1), document.querySelector("main pre.code").textContent);

    // Clipboard failure must not report a successful copy.
    dom.window.navigator.clipboard.writeText = async () => { throw new Error("denied"); };
    document.querySelector('[aria-label="Copy selected code example"]').click();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.match(document.querySelector('[aria-label="Copy selected code example"]').textContent, /Copy failed/);

    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(document.activeElement.getAttribute("type"), "search");
    assert(document.querySelector(".docs-search-results a[href^='/docs/']"));
    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(document.querySelector(".docs-search-results"), null);
    const menu = document.querySelector(".docs-menu-button");
    menu.click();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(menu.getAttribute("aria-expanded"), "true");
    assert(document.querySelector(".docs-reference-grid.menu-open"));
  } finally { close(dom); }

  assert.equal(resolveLegacyDocPath("/docs/", "post-v1-history-bars"), article.path);
  assert.equal(resolveLegacyDocPath("/docs/", "options"), "/docs/realtime/websocket/options/");
  assert.equal(resolveLegacyDocPath("/docs/", "get-v1-indices-minute-coverage"), "/docs/market/indices/get-v1-indices-minute-coverage/");
  assert.equal(resolveLegacyDocPath("/docs/market/options/", "post-v1-options-contracts"), "/docs/market/options/post-v1-options-contracts/");
  assert.equal(resolveLegacyDocPath(article.path, "post-v1-history-bars"), null);
  process.stdout.write(`${Object.keys(DOC_ARTICLES).length} article URLs pass direct loading, isolated content, code selection/copy, search, navigation, and legacy-link checks\n`);
} finally { await new Promise(resolve => server.close(resolve)); }
