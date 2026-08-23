import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entries = [
  "token-page",
  "register-page",
  "checkout-page",
  "account-page",
  "updates-page",
  "docs-page",
];
const assetsDir = resolve(siteRoot, "public/assets");

await mkdir(assetsDir, { recursive: true });

await Promise.all(entries.map(name => build({
  entryPoints: [resolve(siteRoot, "client-entries", `${name}.jsx`)],
  outfile: resolve(assetsDir, `${name}.js`),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  jsx: "transform",
  minify: true,
  legalComments: "none",
})));
