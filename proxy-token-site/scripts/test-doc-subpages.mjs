import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const languageScript = fs.readFileSync(new URL("../public/language.js", import.meta.url), "utf8");
const docsBundle = fs.readFileSync(new URL("../public/assets/docs-page.js", import.meta.url), "utf8");

function isVisible(element) {
  for (let node = element; node; node = node.parentElement) {
    if (node.hidden) return false;
  }
  return true;
}

async function render(pathname) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: `https://leandata.uk${pathname}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  dom.window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  dom.window.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ success: false, message: "test response", components: [] }),
  });
  dom.window.eval(languageScript);
  dom.window.eval(docsBundle);
  await new Promise(resolve => setTimeout(resolve, 30));
  return dom;
}

const home = await render("/docs/");
assert.match(home.window.document.body.textContent, /每个主题现在都有独立 URL|Every topic now has its own URL/);
assert(home.window.document.querySelector('a[href="/docs/market/stocks/"]'));
assert(home.window.document.querySelector('a[href="/docs/financial/morningstar/"]'));
home.window.LeandataI18n.destroy();
home.window.close();

const stocks = await render("/docs/market/stocks/");
assert(isVisible(stocks.window.document.getElementById("stock-data-availability")));
assert(isVisible(stocks.window.document.getElementById("post-v1-history-bars")));
assert(!isVisible(stocks.window.document.getElementById("post-v1-options-contracts")));
assert(!isVisible(stocks.window.document.getElementById("get-post-v1-spectral-tick-flow")));
stocks.window.LeandataI18n.destroy();
stocks.window.close();

const options = await render("/docs/market/options/");
assert(isVisible(options.window.document.getElementById("post-v1-options-contracts")));
assert(!isVisible(options.window.document.getElementById("stock-data-availability")));
options.window.LeandataI18n.destroy();
options.window.close();

const statements = await render("/docs/financial/statements/");
assert(isVisible(statements.window.document.getElementById("financial-source-selector")));
assert(isVisible(statements.window.document.getElementById("fmp-income-statement")));
assert(!isVisible(statements.window.document.getElementById("fmp-ratios")));
statements.window.LeandataI18n.destroy();
statements.window.close();

const ratios = await render("/docs/financial/ratios-growth/");
assert(isVisible(ratios.window.document.getElementById("financial-source-selector")));
assert(isVisible(ratios.window.document.getElementById("fmp-ratios")));
assert(!isVisible(ratios.window.document.getElementById("fmp-income-statement")));
ratios.window.LeandataI18n.destroy();
ratios.window.close();

const subscriptions = await render("/docs/realtime/subscriptions/");
assert(isVisible(subscriptions.window.document.getElementById("subscribe")));
assert(!isVisible(subscriptions.window.document.getElementById("endpoint")));
assert(!isVisible(subscriptions.window.document.getElementById("reconnect")));
subscriptions.window.LeandataI18n.destroy();
subscriptions.window.close();

const morningstar = await render("/docs/financial/morningstar/");
assert(isVisible(morningstar.window.document.getElementById("morningstar-overview")));
assert.equal(morningstar.window.document.getElementById("fmp-fundamentals-overview"), null);
morningstar.window.LeandataI18n.destroy();
morningstar.window.close();

process.stdout.write("independent docs subpages render and isolate content\n");
