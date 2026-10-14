import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
await build({
  entryPoints: [new URL("client-entries/account-page.jsx", root).pathname],
  outfile: new URL("public/assets/account-page.js", root).pathname,
  bundle: true, format: "iife", platform: "browser", target: ["es2020"],
  jsx: "transform", minify: true, legalComments: "none",
});
const fingerprint = createHash("sha256")
  .update(await readFile(new URL("public/assets/account-page.js", root)))
  .update(await readFile(new URL("public/language.js", root))).digest("hex").slice(0, 16);
const htmlPath = new URL("public/account.html", root);
const html = await readFile(htmlPath, "utf8");
await writeFile(htmlPath, html
  .replace(/src="\/language\.js(?:\?v=[^"]*)?"/, `src="/language.js?v=${fingerprint}"`)
  .replace(/src="\/assets\/account-page\.js(?:\?v=[^"]*)?"/, `src="/assets/account-page.js?v=${fingerprint}"`));
