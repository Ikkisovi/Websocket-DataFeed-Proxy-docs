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

async function render(pathname, language = "zh") {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: `https://leandata.uk${pathname}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  dom.window.localStorage.setItem("leandata.language", language);
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
assert(isVisible(morningstar.window.document.getElementById("morningstar-pit")));
assert(isVisible(morningstar.window.document.getElementById("morningstar-processing")));
assert(isVisible(morningstar.window.document.getElementById("morningstar-fields")));
assert.equal(morningstar.window.document.querySelector('#morningstar-overview img').getAttribute('src'), "/assets/providers/morningstar.png");
assert.match(morningstar.window.document.body.textContent, /Morningstar 财务基本面|Morningstar Fundamentals/);
assert.match(morningstar.window.document.body.textContent, /dividend_yield/);
assert.equal(morningstar.window.document.getElementById("fmp-fundamentals-overview"), null);
morningstar.window.LeandataI18n.destroy();
morningstar.window.close();

const research = await render("/docs/market/research-signals/");
assert(isVisible(research.window.document.getElementById("spectral-overview")));
assert(isVisible(research.window.document.getElementById("spectral-methodology")));
assert(isVisible(research.window.document.getElementById("spectral-processing")));
assert(isVisible(research.window.document.getElementById("spectral-fields")));
assert(isVisible(research.window.document.getElementById("get-post-v1-spectral-tick-flow")));
assert.equal(research.window.document.querySelector('#spectral-overview img'), null);
assert(research.window.document.querySelector('#spectral-overview .provider-logo-frame svg'));
assert(!research.window.document.body.textContent.includes('quantconnect.png'));
assert.match(research.window.document.body.textContent, /executionperiodseconds/);
assert.match(research.window.document.body.textContent, /oa_underlying_sid/);
assert(!isVisible(research.window.document.getElementById("get-post-v1-indices-history")));
research.window.LeandataI18n.destroy();
research.window.close();

const researchEn = await render("/docs/market/research-signals/", "en");
assert.match(researchEn.window.document.querySelector("#spectral-overview h2").textContent, /Spectral Tick-Flow Signal/);
assert.match(researchEn.window.document.body.textContent, /Composite execution-flow signal score/);
researchEn.window.LeandataI18n.destroy();
researchEn.window.close();

const morningstarEn = await render("/docs/financial/morningstar/", "en");
assert.match(morningstarEn.window.document.querySelector("#morningstar-overview h2").textContent, /Morningstar Fundamentals/);
assert.match(morningstarEn.window.document.body.textContent, /What is point-in-time data/);
assert.match(morningstarEn.window.document.body.textContent, /Deduplication and processing/);
morningstarEn.window.LeandataI18n.destroy();
morningstarEn.window.close();

const stocksPage = await render("/docs/market/stocks/");
assert(stocksPage.window.document.querySelector('img[src="/assets/providers/alpaca.png"]'));
assert.match(stocksPage.window.document.body.textContent, /US Equities Market Data API/);
stocksPage.window.LeandataI18n.destroy();
stocksPage.window.close();

const financial = await render("/docs/financial/");
assert(financial.window.document.querySelector('img[src="/assets/providers/fmp-data.png"]'));
assert(financial.window.document.querySelector('img[src="/assets/providers/morningstar.png"]'));
financial.window.LeandataI18n.destroy();
financial.window.close();

process.stdout.write("independent docs subpages render, isolate content, and show provider branding\n");
