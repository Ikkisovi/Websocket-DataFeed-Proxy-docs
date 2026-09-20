import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = resolve(siteRoot, "public/docs");
const assetVersion = "20260919-pit-processing-guide";

const pages = {
  "": "Leandata API Documentation",
  "market/overview": "Market API Overview & Authentication",
  "market/stocks": "US Stock Market Data API",
  "market/options": "Options Market Data API",
  "market/indices": "Index Market Data API",
  "market/research-signals": "Research Signals API",
  "market/crypto-news": "Crypto & News API",
  "market/cn": "China Market Data API",
  "financial": "Financial Data Sources",
  "financial/regular": "Regular / FMP Financial API",
  "financial/morningstar": "Morningstar Fundamentals API",
  "financial/statements": "Financial Statements API",
  "financial/ratios-growth": "Financial Ratios & Growth API",
  "bulk/download": "Bulk Data Download",
  "realtime/websocket": "WebSocket Realtime API",
  "realtime/subscriptions": "WebSocket Subscriptions & Messages",
  "status": "Leandata Service Status",
  "usage": "Leandata Usage Statistics",
};

function html(title) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Leandata Docs</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/docs/tokens.css?v=20260919-pit-processing-guide">
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #f0eee9; }
  body { font-family: "IBM Plex Sans", system-ui, sans-serif; }
  #root { height: 100%; }
</style>
</head>
<body>
<div id="root"></div>
<script src="/language.js"></script>
<script defer src="/assets/docs-page.js?v=${assetVersion}"></script>
</body>
</html>
`;
}

await Promise.all(Object.entries(pages).map(async ([relativePath, title]) => {
  const directory = relativePath ? resolve(docsRoot, relativePath) : docsRoot;
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "index.html"), html(title));
}));
