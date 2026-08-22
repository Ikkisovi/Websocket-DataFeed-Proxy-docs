import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(scriptDir, "..", "public");
// Public contract terms such as cache status and the legacy /v1/pit/fmp route
// are valid documentation. Reject supplier and private-infrastructure branding
// without treating stable route names or implementation identifiers as prose.
const disallowed = /\b(?:ThinkCentre|EC2|Tailscale|Cloudflare|Alpaca|ThetaData)\b/g;

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
assert.match(docsSource, /[\u3400-\u9fff]/, "Docs must include Chinese copy.");
assert.match(docsSource, /market: \{ en: "Market data", zh: "行情数据" \}/, "Docs must use the neutral market-data category.");
assert.match(docsSource, /financial: \{ en: "Financial data", zh: "财务数据" \}/, "Docs must use the neutral financial-data category.");
assert.doesNotMatch(docsSource, />FMP(?:\s|<)/, "Rendered headings and labels must not expose supplier branding.");
assert.doesNotMatch(docsSource, /No FMP/, "Credential guidance must remain supplier-neutral.");

const compatibilitySource = fs.readFileSync(path.join(publicDir, "docs-site.jsx"), "utf8");
assert.match(compatibilitySource, /\/docs\/docs-site\.jsx\?v=public-docs-v2/, "The compatibility entry must load the canonical docs source.");

process.stdout.write("public documentation language check ok\n");
