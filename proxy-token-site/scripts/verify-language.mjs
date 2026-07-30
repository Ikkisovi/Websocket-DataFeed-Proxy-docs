import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(scriptDir, "..", "public");
const languageSource = fs.readFileSync(path.join(publicDir, "language.js"), "utf8");
const dom = new JSDOM(
  "<!doctype html><html lang=\"zh-CN\"><head><title>配置套餐 — Leandata</title></head><body>"
    + "<h1>新用户 <span>注册</span></h1>"
    + "<input placeholder=\"用于账户绑定与服务通知\">"
    + "<p id=\"dynamic\"></p>"
    + "</body></html>",
  { url: "http://127.0.0.1:3317/register", runScripts: "outside-only" }
);

dom.window.eval(languageSource);
dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
dom.window.document.querySelector('button[data-language="en"]').click();

assert.equal(dom.window.document.documentElement.lang, "en");
assert.equal(dom.window.document.title, "Choose a plan — Leandata");
assert.equal(dom.window.document.querySelector("h1").textContent, "Create your account");
assert.equal(
  dom.window.document.querySelector("input").placeholder,
  "Used for account linking and service notices"
);
assert.equal(dom.window.localStorage.getItem("leandata.language"), "en");

dom.window.document.getElementById("dynamic").textContent = "剩余 12 天";
await new Promise(resolve => dom.window.setTimeout(resolve, 0));
assert.equal(dom.window.document.getElementById("dynamic").textContent, "12 days remaining");

dom.window.document.querySelector('button[data-language="zh"]').click();
assert.equal(dom.window.document.documentElement.lang, "zh-CN");
assert.equal(dom.window.document.querySelector("h1").textContent, "新用户 注册");

dom.window.LeandataI18n.destroy();
dom.window.close();
process.stdout.write("language switcher ok\n");
