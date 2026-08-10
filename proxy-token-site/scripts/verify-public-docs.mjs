import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(scriptDir, "..", "public");
const disallowed = /\b(?:thinkcentre|ec2|tailscale|cloudflare|fmp|alpaca|thetadata|cache(?:[ _-]?(?:hit|miss|layer|warm|cold))?|forward(?:ing|ed)?|relay|upstream)\b/gi;

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

const publicSources = walk(publicDir).filter(file => /\.(?:jsx|html)$/i.test(file));
const findings = [];

for (const file of publicSources) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(disallowed)) {
    const line = source.slice(0, match.index).split("\n").length;
    findings.push(`${path.relative(publicDir, file)}:${line} (${match[0]})`);
  }
}

assert.deepEqual(
  findings,
  [],
  `Public documentation contains implementation or supplier language:\n${findings.join("\n")}`
);

const docsSource = fs.readFileSync(path.join(publicDir, "docs", "docs-site.jsx"), "utf8");
assert.match(docsSource, /function Bilingual/, "Docs must retain the bilingual copy helper.");
assert.match(docsSource, /lang="zh-CN"/, "Docs must include Chinese copy.");
assert.match(docsSource, /Market data API \/ 市场数据 API/, "Docs must use the neutral public title.");

process.stdout.write("public documentation language check ok\n");
