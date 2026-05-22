const fs = require('fs');
const file = '/home/kai/product-apim/proxy-token-site/public/token-page.jsx';
let content = fs.readFileSync(file, 'utf8');

// Update TokenTopbar
content = content.replace(
  /function TokenTopbar\(\) {/,
  `function TokenTopbar({ portalOpen, setPortalOpen }) {`
);

content = content.replace(
  /<div className="meta">/,
  `<div className="meta">
        {!portalOpen && (
          <button className="btn ghost" onClick={() => setPortalOpen(true)} style={{ marginRight: 12, padding: "6px 10px", fontSize: 12 }}>
            Open Portal
          </button>
        )}`
);

// Update TokenPage state
content = content.replace(
  /function TokenPage\(\) {/,
  `function TokenPage() {
  const [portalOpen, setPortalOpen] = useState(true);`
);

// Pass props to Topbar
content = content.replace(
  /<TokenTopbar \/>/,
  `<TokenTopbar portalOpen={portalOpen} setPortalOpen={setPortalOpen} />`
);

// Update Grid
content = content.replace(
  /gridTemplateColumns: "minmax\(420px, 440px\) 1fr"/,
  `gridTemplateColumns: portalOpen ? "minmax(420px, 440px) 1fr" : "1fr"`
);

// Wrap left side in portalOpen check and add close button
content = content.replace(
  /<div style={{ padding: "56px 48px", background: "var\(--bg-paper\)", borderRight: "1px solid var\(--rule\)", overflow: "auto" }}>/,
  `{portalOpen && (
        <div style={{ position: "relative", padding: "56px 48px", background: "var(--bg-paper)", borderRight: "1px solid var(--rule)", overflow: "auto" }}>
          <button onClick={() => setPortalOpen(false)} style={{ position: "absolute", top: 16, right: 16, background: "transparent", border: "none", cursor: "pointer", fontSize: 20, color: "var(--ink-muted)" }}>✕</button>`
);

content = content.replace(
  /\{\/\* Right: real docs iframe \*\/\}/,
  `)}
        {/* Right: real docs iframe */}`
);

fs.writeFileSync(file, content);
console.log('Patched token-page.jsx');
