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

for (const name of bundles) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: `https://leandata.uk/${name}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  dom.window.LanguageToggle = () => null;
  dom.window.LeandataI18n = {
    translate: value => value,
    getLanguage: () => "zh",
  };
  dom.window.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ success: false, message: "test response", components: [] }),
  });
  dom.window.eval(fs.readFileSync(new URL(`../public/assets/${name}.js`, import.meta.url), "utf8"));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.notEqual(
    dom.window.document.getElementById("root").innerHTML,
    "",
    `${name} bundle did not render`,
  );
  dom.window.close();
}

process.stdout.write("public bundles render check ok\n");
