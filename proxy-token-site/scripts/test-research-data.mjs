import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const product = {
  id: "spectral-tick-flow", name: "Spectral Tick-Flow Signal", status: "free",
  amount_minor: 0, currency: "CNY", payment_required: false,
  docs_url: "/docs/market/research-signals/",
  endpoints: ["/v1/signals/spectral-tick-flow", "/v1/signals/spectral-tick-flow/coverage"],
};
const tick = () => new Promise(resolve => setTimeout(resolve, 30));
async function page({ signedIn = true, expired = false, catalogFails = false, sessionFails = false, deferSession = false, checkoutUnauthorized = false } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://leandata.uk/research-data", runScripts: "outside-only", pretendToBeVisual: true });
  const requests = [];
  let releaseSession;
  const sessionGate = deferSession ? new Promise(resolve => { releaseSession = resolve; }) : Promise.resolve();
  dom.window.localStorage.setItem("leandata.language", "zh");
  dom.window.fetch = async (url, options = {}) => {
    requests.push([url, options.body ? JSON.parse(options.body) : null]);
    let status = 200;
    let data;
    if (url.endsWith("/products")) { status = catalogFails ? 503 : 200; data = { products: [product] }; }
    else if (url.endsWith("/session")) { await sessionGate; status = sessionFails ? 503 : signedIn ? 200 : 401; data = { account: { user_id: "test-user", role: "free" } }; }
    else if (url === "/api/research-data/checkout") {
      status = checkoutUnauthorized ? 401 : expired ? 403 : 200;
      data = expired ? { code: "token_expired" } : { product, status: "free_access", token_url: "/account", payment_required: false, amount_minor: 0 };
    } else throw new Error(`Unexpected request: ${url}`);
    return { ok: status === 200, status, json: async () => data };
  };
  for (const file of ["language.js", "assets/research-data-page.js"]) dom.window.eval(fs.readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8"));
  await tick();
  await tick();
  return { dom, requests, releaseSession, close() { dom.window.LeandataI18n.destroy(); dom.window.close(); } };
}

const signed = await page();
assert.match(signed.dom.window.document.body.textContent, /当前免费/);
assert.equal(signed.dom.window.document.querySelector('input:not([type="radio"])'), null);
assert.doesNotMatch(signed.dom.window.document.body.textContent, /登录后确认免费访问|注册手机号/);
assert.match(signed.dom.window.document.querySelector('button[type="submit"]').textContent, /确认免费访问/);
signed.dom.window.document.querySelector("form").dispatchEvent(new signed.dom.window.Event("submit", { bubbles: true, cancelable: true }));
await tick();
assert.match(signed.dom.window.document.body.textContent, /免费访问已确认/);
assert.deepEqual(signed.requests.find(([url]) => url.endsWith("/checkout"))[1], { product_id: product.id });
assert.equal(signed.requests.some(([url]) => url.startsWith("/api/payment/")), false);
signed.dom.window.document.querySelector(".research-language").click();
await tick();
assert.match(signed.dom.window.document.body.textContent, /Free access confirmed/);
assert.match(signed.dom.window.document.body.textContent, /No payment · No automatic renewal/);
signed.close();

const guest = await page({ signedIn: false });
assert.equal(guest.dom.window.document.querySelector('a[href="/register?next=research-data"]')?.textContent, "没有账户？免费注册");
assert.ok(guest.dom.window.document.querySelector('a[href="/account?next=research-data"]'));
assert.equal(guest.dom.window.document.querySelector('input:not([type="radio"])'), null);
assert.equal(guest.dom.window.document.querySelector('button[type="submit"]'), null);
assert.equal(guest.requests.some(([url]) => url.endsWith('/checkout') || url.endsWith('/login')), false);
guest.close();

const loading = await page({ deferSession: true });
assert.match(loading.dom.window.document.body.textContent, /正在检查登录状态/);
assert.equal(loading.dom.window.document.querySelector('a[href="/account?next=research-data"]'), null);
assert.equal(loading.dom.window.document.querySelector('button[type="submit"]'), null);
loading.releaseSession();
await tick();
assert.match(loading.dom.window.document.querySelector('button[type="submit"]').textContent, /确认免费访问/);
loading.close();

const sessionFailed = await page({ sessionFails: true });
assert.match(sessionFailed.dom.window.document.querySelector('[role="alert"]').textContent, /暂时无法检查登录状态/);
assert.equal(sessionFailed.dom.window.document.querySelector('a[href="/account?next=research-data"]'), null);
sessionFailed.close();

const signedOut = await page({ checkoutUnauthorized: true });
signedOut.dom.window.document.querySelector("form").dispatchEvent(new signedOut.dom.window.Event("submit", { bubbles: true, cancelable: true }));
await tick();
assert.ok(signedOut.dom.window.document.querySelector('a[href="/account?next=research-data"]'));
assert.equal(signedOut.dom.window.document.querySelector('.research-success'), null);
signedOut.close();

const expired = await page({ expired: true });
expired.dom.window.document.querySelector("form").dispatchEvent(new expired.dom.window.Event("submit", { bubbles: true, cancelable: true }));
await tick();
assert.match(expired.dom.window.document.querySelector('[role="alert"]').textContent, /Token 已过期/);
assert.equal(expired.dom.window.document.querySelector(".research-success"), null);
expired.close();

const failed = await page({ catalogFails: true });
assert.equal(failed.dom.window.document.querySelector('button[type="submit"]').disabled, true);
assert.match(failed.dom.window.document.querySelector('[role="alert"]').textContent, /产品暂时无法加载/);
failed.close();
process.stdout.write("research data checkout interaction checks ok\n");
