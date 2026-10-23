import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const publicRoot = new URL("../public/", import.meta.url);
const language = fs.readFileSync(new URL("language.js", publicRoot), "utf8");
const bundle = fs.readFileSync(new URL("assets/account-page.js", publicRoot), "utf8");
const tick = () => new Promise(resolve => setTimeout(resolve, 30));
async function page(locale, account = null) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "https://leandata.uk/account", runScripts: "outside-only", pretendToBeVisual: true,
  });
  dom.window.localStorage.setItem("leandata.language", locale);
  dom.window.fetch = async url => {
    assert.equal(url, "/api/account/overview");
    return { ok: Boolean(account), status: account ? 200 : 401,
      json: async () => ({ success: Boolean(account), account, usage: {} }) };
  };
  dom.window.eval(language);
  dom.window.eval(bundle);
  await tick(); await tick();
  return { dom, document: dom.window.document, async close() {
    dom.window.LeandataI18n.destroy(); dom.window.close();
  } };
}

const login = await page("en");
const form = login.document.querySelector("form");
assert.doesNotMatch(form.textContent, /[\u3400-\u9fff]/, "English login contains untranslated prose");
for (const input of form.querySelectorAll("input")) assert.doesNotMatch(input.placeholder, /[\u3400-\u9fff]/);
assert.doesNotMatch(form.textContent, /Token sign-in/);
const keep = form.querySelector('input[type="checkbox"]');
assert.ok(keep && keep.checked === false, "keep-me-signed-in is opt-in");
assert.match(keep.closest("label").textContent, /Keep me signed in for 30 days/);
assert.equal(form.querySelector('input[type="password"]'), null);
assert.equal(form.querySelector('input[type="email"]').placeholder, "Email address");
assert.equal(form.querySelector('input[autocomplete="username"]').required, false);
assert.equal(form.querySelector('input[autocomplete="username"]').closest('details').open, false);
assert.equal(form.querySelector('input[type="tel"]'), null);
assert.doesNotMatch(form.textContent, /老账号|老用户|手机号即可/);
assert.equal(form.querySelector('input[maxlength="6"]').placeholder, "6-digit verification code");
Array.from(form.querySelectorAll("button")).find(b => b.textContent === "Send code").click();
await tick();
assert.match(form.textContent, /Enter your email or phone number first\./);
assert.doesNotMatch(form.textContent, /[\u3400-\u9fff]/);
assert.equal(login.dom.window.LeandataI18n.translate("60s 后重试"), "Retry in 60s");
for (const message of [
  "缺少验证码 ID 或验证码。", "验证码无效或已过期，请重新获取。",
  "验证码已使用，请重新获取。", "验证码与当前账户不匹配。", "验证码用途不匹配。",
  "验证码已过期，请重新获取。", "验证码尝试次数过多，请重新获取。",
  "验证码错误次数过多，请重新获取。", "验证码错误，请重试。",
]) assert.doesNotMatch(login.dom.window.LeandataI18n.translate(message), /[\u3400-\u9fff]/);
login.dom.window.LeandataI18n.setLanguage("zh");
await tick();
assert.match(form.textContent, /使用邮箱验证码验证身份。/);
assert.match(form.textContent, /请先输入邮箱或手机号。/);
await login.close();

for (const locale of ["zh", "en"]) {
  const free = await page(locale, { user_id: "fixture", role: "free", tier: "free", expiry: null, days_remaining: null });
  assert.match(free.document.querySelector("main").textContent, locale === "zh" ? /长期有效/ : /No expiry/);
  assert.doesNotMatch(free.document.querySelector("main").textContent, /到期时间不可用|Expiry unavailable/);
  await free.close();
}
for (const [account, expected] of [
  [{ role: "standard", tier: "standard", expiry: "2030-01-01T00:00:00Z", days_remaining: 30 }, /30 days remaining/],
  [{ role: "standard", tier: "standard", expiry: null, days_remaining: null }, /Expiry unavailable/],
  [{ role: "free", tier: "free", expiry: "2000-01-01T00:00:00Z", days_remaining: 0 }, /Expired/],
]) {
  const paid = await page("en", { user_id: "fixture", ...account });
  assert.match(paid.document.querySelector("main").textContent, expected);
  assert.doesNotMatch(paid.document.querySelector("main").textContent, /No expiry/);
  await paid.close();
}

for (const locale of ["en", "zh"]) {
  const account = await page(locale, {
    user_id: "dual-market", role: "premium", tier: "premium",
    expiry: "2040-01-01T00:00:00Z", days_remaining: 999,
    market_expiry: "2030-03-15T00:00:00Z", china_expiry: "2031-09-20T00:00:00Z",
    capabilities: { ws: { stocks: true, options: false, test: true }, rest: { news_history: true, cn_archive: false, admin_token_lookup: false } },
    catalog_version: "fixture-catalog",
  });
  const main = account.document.querySelector("main");
  assert.match(main.querySelector('[data-expiry="market"]').textContent, /2030/);
  assert.match(main.querySelector('[data-expiry="china"]').textContent, /2031/);
  assert.doesNotMatch(main.querySelector('[data-subscription-expiries]').textContent, /2040/);
  assert.equal(main.querySelector('[data-capability="ws.stocks"]').dataset.enabled, "true");
  assert.equal(main.querySelector('[data-capability="ws.options"]').dataset.enabled, "false");
  assert.equal(main.querySelector('[data-capability="rest.news_history"]').dataset.enabled, "true");
  assert.equal(main.querySelector('[data-capability="rest.cn_archive"]').dataset.enabled, "false");
  assert.equal(main.querySelector('[data-capability="ws.test"]'), null);
  assert.equal(main.querySelector('[data-capability="rest.admin_token_lookup"]'), null);
  await account.close();
}
const freeWithChina = await page("en", { user_id: "free-cn", role: "free", tier: "free", market_expiry: null, china_expiry: "2031-09-20T00:00:00Z" });
assert.match(freeWithChina.document.querySelector('[data-expiry="market"]').textContent, /Permanent Free baseline/);
assert.match(freeWithChina.document.querySelector('[data-expiry="china"]').textContent, /2031/);
await freeWithChina.close();

const noEmail = await page("en", { user_id: "legacy", role: "standard", tier: "standard", email: null });
const bind = noEmail.document.querySelector('[data-bind-email="true"]');
assert.ok(bind, "accounts without an email are offered email binding");
assert.doesNotMatch(bind.textContent, /[\u3400-\u9fff]/);
assert.equal(bind.querySelector('input[type="email"]').placeholder, "Email address");
await noEmail.close();
const withEmail = await page("en", { user_id: "bound", role: "standard", tier: "standard", email: "bound@example.com" });
assert.equal(withEmail.document.querySelector('[data-bind-email="true"]'), null);
await withEmail.close();
const tokenLogin = await page("en");
const tokenForm = tokenLogin.document.querySelector("form");
Array.from(tokenForm.querySelectorAll("button")).find(b => b.textContent === "Verify with a token").click();
await tick();
assert.ok(tokenForm.querySelector('input[type="password"]'), "token mode shows the token field");
assert.doesNotMatch(tokenForm.textContent, /[\u3400-\u9fff]/);
await tokenLogin.close();

const fingerprint = createHash("sha256").update(bundle).update(language).digest("hex").slice(0, 16);
const html = fs.readFileSync(new URL("account.html", publicRoot), "utf8");
assert.ok(html.includes(`/assets/account-page.js?v=${fingerprint}`));
assert.ok(html.includes(`/language.js?v=${fingerprint}`));
console.log("account compiled UI: login, OTP labels/validation, locale roundtrip, expiry states and asset fingerprint passed");
