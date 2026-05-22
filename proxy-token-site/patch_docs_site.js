const fs = require('fs');
const file = '/home/kai/product-apim/proxy-token-site/claude_design/docs-site.jsx';
let content = fs.readFileSync(file, 'utf8');

// Add slugify
content = content.replace(
  /function Tab\(\{ id/,
  `function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function Tab({ id`
);

// Fix layout: DocsSite outer div
content = content.replace(
  /className="proxy-app" style=\{\{ display: "flex", flexDirection: "column", height: "100%" \}\}/,
  `className="proxy-app" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}`
);

// Fix layout: Content grid
content = content.replace(
  /<div style=\{\{ display: "grid", gridTemplateColumns: "220px 1fr 220px", flex: 1, minHeight: 0 \}\}>/,
  `<div style={{ display: "grid", gridTemplateColumns: "220px 1fr 220px", flex: 1 }}>`
);

// Fix layout: main
content = content.replace(
  /<main style=\{\{ padding: "40px 56px", overflow: "auto", background: "var\(--bg-canvas\)" \}\}>/,
  `<main style={{ padding: "40px 56px", background: "var(--bg-canvas)" }}>`
);

// Fix layout: SideNav
content = content.replace(
  /overflow: "auto",\s*fontSize: 13,/,
  `fontSize: 13, position: "sticky", top: 0, height: "100vh", overflow: "auto"`
);

// Fix SideNav links
content = content.replace(
  /<a style=\{\{/g,
  `<a href={"#" + slugify(it)} style={{textDecoration: "none", `
);

// Fix layout: OnThisPage
content = content.replace(
  /background: "var\(--bg-canvas\)",\s*fontSize: 12\.5,/,
  `background: "var(--bg-canvas)", fontSize: 12.5, position: "sticky", top: 0, height: "100vh", overflow: "auto"`
);

// Add IDs to ProxyApiBody
content = content.replace(
  /<h2 className="display-title" style=\{\{ fontSize: 38, margin: "0 0 8px" \}\}>Generate token<\/h2>/,
  `<h2 id="post-generate-token" className="display-title" style={{ fontSize: 38, margin: "0 0 8px" }}>Generate token</h2>`
);

content = content.replace(
  /<h2 className="display-title" style=\{\{ fontSize: 28, margin: "0 0 16px" \}\}>Tiers & permissions<\/h2>/,
  `<h2 id="tiers-permissions" className="display-title" style={{ fontSize: 28, margin: "0 0 16px" }}>Tiers & permissions</h2>`
);

// Add IDs to WsUsageBody
content = content.replace(
  /<h2 className="display-title" style=\{\{ fontSize: 38, margin: "0 0 8px" \}\}>WebSocket connection<\/h2>/,
  `<h2 id="endpoint" className="display-title" style={{ fontSize: 38, margin: "0 0 8px" }}>WebSocket connection</h2>`
);

fs.writeFileSync(file, content);
console.log('Patched docs-site.jsx');
