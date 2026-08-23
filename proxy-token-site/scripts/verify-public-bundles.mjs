import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const bundles = [
  "token-page",
  "register-page",
  "checkout-page",
  "account-page",
  "updates-page",
  "docs-page",
];
const languageScript = fs.readFileSync(
  new URL("../public/language.js", import.meta.url),
  "utf8",
);

for (const name of bundles) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: `https://leandata.uk/${name}`,
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
  dom.window.eval(fs.readFileSync(new URL(`../public/assets/${name}.js`, import.meta.url), "utf8"));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(
    typeof dom.window.React?.createElement,
    "function",
    `${name} bundle did not expose React for the language toggle`,
  );
  assert.notEqual(
    dom.window.document.getElementById("root").innerHTML,
    "",
    `${name} bundle did not render`,
  );
  dom.window.LeandataI18n.destroy();
  await new Promise(resolve => setTimeout(resolve, 0));
  dom.window.close();
}

process.stdout.write("public bundles render check ok\n");
