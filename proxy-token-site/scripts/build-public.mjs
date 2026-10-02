import { build } from "esbuild";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entries = [
  "token-page",
  "register-page",
  "checkout-page",
  "research-data-page",
  "account-page",
  "updates-page",
  "docs-page",
  "gpu-index-page",
  "site-announcements",
  "chart-page",
];
const assetsDir = resolve(siteRoot, "public/assets");

await mkdir(assetsDir, { recursive: true });

const clientBuilds = await Promise.all(entries.map(name => build({
  entryPoints: [resolve(siteRoot, "client-entries", `${name}.jsx`)],
  outfile: resolve(assetsDir, `${name}.js`),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  jsx: "transform",
  minify: true,
  legalComments: ["site-announcements", "chart-page"].includes(name) ? "eof" : "none",
  metafile: ["site-announcements", "chart-page"].includes(name),
})));

// The commit-pinned portal release ships server.js and public/. Bundle the
// server sanitizer with those artifacts so deployment needs no new runtime npm install.
const serverBuild = await build({
  entryPoints: [resolve(siteRoot, "shared/announcement-sanitize.cjs")],
  outfile: resolve(assetsDir, "announcement-sanitize.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: ["node22"],
  minify: true,
  legalComments: "eof",
  metafile: true,
});

await build({
  entryPoints: [resolve(siteRoot, 'shared/chart-proxy.cjs')],
  outfile: resolve(assetsDir, 'chart-proxy.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: ['node22'], minify: true,
});

// Keep licenses for the exact dependency files that were bundled, including
// nested package versions, rather than relying on minifier comment retention.
const packageDirs = new Set();
for (const result of [...clientBuilds.filter((result, i) => entries[i] === 'site-announcements'), serverBuild]) {
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.includes('node_modules/')) continue;
    let directory = dirname(resolve(input));
    while (directory.includes('node_modules')) {
      try {
        const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
        if (pkg.name) {
          packageDirs.add(directory);
          break;
        }
        directory = dirname(directory);
      } catch { directory = dirname(directory); }
    }
  }
}
const notices = [];
for (const directory of [...packageDirs].sort()) {
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  const license = (await readdir(directory)).find(name => /^licen[cs]e(?:\.(?:md|txt))?$/i.test(name));
  if (!license && !pkg.license) throw new Error(`Missing bundled dependency license: ${pkg.name}`);
  const notice = license ? await readFile(resolve(directory, license), 'utf8')
    : `License: ${pkg.license}\nAuthor: ${typeof pkg.author === 'string' ? pkg.author : pkg.author?.name || ''}\nSource: ${pkg.repository?.url || pkg.homepage || ''}\nThis npm package provides its license declaration in package.json.`;
  notices.push(`${pkg.name} ${pkg.version}\n${notice}`);
}
await mkdir(resolve(siteRoot, 'public/vendor'), { recursive: true });
await writeFile(resolve(siteRoot, 'public/vendor/announcement-licenses.txt'), notices.join('\n\n========================================\n\n'));

const chartNotices = [];
for (const name of ['lightweight-charts', 'fancy-canvas', '@msgpack/msgpack']) {
  const directory = resolve(siteRoot, 'node_modules', name);
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  const files = (await readdir(directory)).filter(name => /^(?:licen[cs]e|notice)(?:\.(?:md|txt))?$/i.test(name));
  for (const file of files) chartNotices.push(`${pkg.name} ${pkg.version}\n${await readFile(resolve(directory, file), 'utf8')}`);
}
await writeFile(resolve(siteRoot, 'public/vendor/chart-licenses.txt'), chartNotices.join('\n\n========================================\n\n'));

await import("./build-doc-pages.mjs");
