import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const language = fs.readFileSync(new URL("../public/language.js", import.meta.url), "utf8");
const bundle = fs.readFileSync(new URL("../public/assets/docs-page.js", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setTimeout(resolve, 40));

async function render(lang = "zh") {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "https://leandata.uk/docs/market/research-signals/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  dom.window.localStorage.setItem("leandata.language", lang);
  dom.window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  dom.window.fetch = async () => ({ ok: false, status: 401, json: async () => ({ components: [] }) });
  dom.window.eval(language);
  dom.window.eval(bundle);
  await tick();
  return dom;
}

const dom = await render();
const { document, navigator } = dom.window;
const blocks = [...document.querySelectorAll(".code-example")];
assert(blocks.length > 50, "All reference examples must use the shared code component");
assert.equal(document.querySelectorAll("pre.code").length, blocks.length);
assert(document.querySelectorAll('.table-scroll[role="region"][tabindex="0"] > table').length >= 10, "Reference tables need keyboard-accessible scroll regions");
for (const block of blocks) {
  assert(block.querySelector(".code-copy"));
  assert(block.querySelector('button[aria-pressed="true"]'), "Wrapping is on by default");
  assert.equal(block.querySelector("pre").getAttribute("tabindex"), "0");
  assert(block.querySelector("pre > code"));
}

// This is the long URL in the reported clipped Spectral example.
const request = blocks.find(block => block.querySelector("pre").textContent.includes("sid=ARNC%20WF6J1S513QZP"));
assert(request, "Reported example must still exist in full");
const original = request.querySelector("pre").textContent;
assert(original.includes("&limit=10"));
let copied;
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { copied = text; } } });
request.querySelector(".code-copy").click();
await tick();
assert.equal(copied, original, "Copy includes the complete URL, not the rendered toolbar");
assert.match(request.querySelector('[role="status"]').textContent, /完整代码已复制/);
assert.match(request.querySelector(".code-copy").textContent, /已复制/);
const wrap = request.querySelector("button[aria-pressed]");
wrap.click();
await tick();
assert.equal(wrap.getAttribute("aria-pressed"), "false");
assert(!request.querySelector("pre").classList.contains("is-wrapped"));
assert.equal(request.querySelector("pre").textContent, original);

const long = blocks.find(block => block.querySelector(".code-expand"));
assert(long.querySelector("pre").classList.contains("is-collapsed"));
long.querySelector(".code-expand").click();
await tick();
assert.equal(long.querySelector(".code-expand").getAttribute("aria-expanded"), "true");
assert(!long.querySelector("pre").classList.contains("is-collapsed"));
long.querySelector(".code-copy").click();
await tick();
assert.equal(copied, long.querySelector("pre").textContent);

// Permission-denied fallback preserves selection and keyboard focus.
navigator.clipboard.writeText = async () => { throw new Error("permission denied"); };
let fallback;
document.execCommand = command => { assert.equal(command, "copy"); fallback = document.querySelector("textarea").value; return true; };
const button = request.querySelector(".code-copy");
button.focus();
button.click();
await tick();
assert.equal(fallback, original);
assert.equal(document.activeElement, button);
assert.equal(document.querySelector("textarea"), null);
assert.match(button.textContent, /已复制/);
document.execCommand = () => false;
button.click();
await tick();
assert.match(button.textContent, /请手动复制/);
assert.match(request.querySelector('[role="status"]').textContent, /复制失败/);
assert.equal(document.querySelector("textarea"), null);

dom.window.localStorage.setItem("leandata.language", "en");
dom.window.dispatchEvent(new dom.window.CustomEvent("leandata:languagechange", { detail: { language: "en" } }));
await tick();
assert.match(wrap.textContent, /Wrap/);
assert.equal(button.getAttribute("aria-label"), "Copy full code");
assert.equal(request.querySelector("pre").textContent, original);
assert(!document.querySelector("#get-post-v1-spectral-tick-flow + .doc-description")?.textContent.match(/[\u3400-\u9fff]/));
dom.window.LeandataI18n.destroy();
dom.window.close();

const en = await render("en");
assert.match(en.window.document.querySelector(".code-copy").textContent, /Copy/);
assert(en.window.document.querySelector(".docs-reader"));
en.window.LeandataI18n.destroy();
en.window.close();

const generator = fs.readFileSync(new URL("./build-doc-pages.mjs", import.meta.url), "utf8");
assert.match(generator, /\/docs\/reading\.css/);
assert(!generator.includes("Instrument+Serif"), "Docs should load only sans and code fonts");
const style = fs.readFileSync(new URL("../public/docs/reading.css", import.meta.url), "utf8");
assert.match(style, /overflow: auto/);
assert.match(style, /white-space: pre-wrap/);
assert.match(style, /font-size: 16px/);
assert.match(style, /min-width: 640px/);
assert.match(style, /Noto Sans SC/);
const homepage = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
assert.match(homepage, /<body class="leandata-home">/);
assert.match(style, /\.leandata-home \.docs-reader \.docs-hero h1 \{\s*font-family: "Instrument Serif"/);
assert.match(style, /\.leandata-home \.docs-reader \.docs-hero h1 span \{ font-style: italic !important; \}/);
assert(!fs.readFileSync(new URL("../public/docs/index.html", import.meta.url), "utf8").includes('class="leandata-home"'), "Serif exception is homepage-only");
process.stdout.write("docs reading controls, exact copy, failure fallback, expansion and bilingual UI passed\n");
