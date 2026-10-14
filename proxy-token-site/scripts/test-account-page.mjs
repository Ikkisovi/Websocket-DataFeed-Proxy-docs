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
assert.match(form.textContent, /Token sign-in/);
assert.equal(form.querySelector('input[type="password"]').placeholder, "Enter your current account API token");
Array.from(form.querySelectorAll("button")).find(b => b.textContent === "Email verification code").click();
await tick();
assert.equal(form.querySelector('input[maxlength="6"]').placeholder, "6-digit verification code");
Array.from(form.querySelectorAll("button")).find(b => b.textContent === "Send code").click();
await tick();
assert.match(form.textContent, /Enter your username and phone number first\./);
assert.doesNotMatch(form.textContent, /[\u3400-\u9fff]/);
assert.equal(login.dom.window.LeandataI18n.translate("60s 后重试"), "Retry in 60s");
login.dom.window.LeandataI18n.setLanguage("zh");
await tick();
assert.match(form.textContent, /使用当前 API Token 或向绑定邮箱发送一次性验证码进行登录。/);
assert.match(form.textContent, /请先输入用户名和手机号。/);
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

const fingerprint = createHash("sha256").update(bundle).update(language).digest("hex").slice(0, 16);
const html = fs.readFileSync(new URL("account.html", publicRoot), "utf8");
assert.ok(html.includes(`/assets/account-page.js?v=${fingerprint}`));
assert.ok(html.includes(`/language.js?v=${fingerprint}`));
console.log("account compiled UI: login, OTP labels/validation, locale roundtrip, expiry states and asset fingerprint passed");
