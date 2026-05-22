const fs = require('fs');
const file = '/home/kai/product-apim/proxy-token-site/claude_design/docs-site.jsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add activeId state and effect to SideNav
content = content.replace(
  /function SideNav\(\{ tab \}\) \{/,
  `function SideNav({ tab }) {
  const [activeId, setActiveId] = React.useState("");
  React.useEffect(() => {
    const onHashChange = () => setActiveId(window.location.hash.slice(1));
    window.addEventListener('hashchange', onHashChange);
    // Intersection observer for scrolling
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if(entry.isIntersecting) {
          setActiveId(entry.target.id);
        }
      });
    }, { rootMargin: '-20% 0px -80% 0px' });
    setTimeout(() => {
      document.querySelectorAll('h2[id], h3[id]').forEach(h => observer.observe(h));
    }, 500);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      observer.disconnect();
    };
  }, [tab]);`
);

// 2. Update SideNav styles to use activeId
content = content.replace(
  /color: "var\(--ink-muted\)",\s*fontWeight: 400,\s*borderLeft: "2px solid transparent",/g,
  `color: activeId === slugify(it) ? "var(--ink-strong)" : "var(--ink-muted)",
                  fontWeight: activeId === slugify(it) ? 500 : 400,
                  borderLeft: activeId === slugify(it) ? "2px solid var(--accent)" : "2px solid transparent",`
);

// 3. Same for OnThisPage
content = content.replace(
  /function OnThisPage\(\{ tab \}\) \{/,
  `function OnThisPage({ tab }) {
  const [activeId, setActiveId] = React.useState("");
  React.useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => { if(entry.isIntersecting) setActiveId(entry.target.id); });
    }, { rootMargin: '-20% 0px -80% 0px' });
    setTimeout(() => document.querySelectorAll('h2[id], h3[id]').forEach(h => observer.observe(h)), 500);
    return () => observer.disconnect();
  }, [tab]);`
);
content = content.replace(
  /color: i === 0 \? "var\(--ink-strong\)" : "var\(--ink-muted\)"/g,
  `color: activeId === slugify(it) ? "var(--ink-strong)" : "var(--ink-muted)"`
);

// 4. Fill out the content for Options Data and Stocks
const newOptionsContent = `<div className="eyebrow" style={{ marginBottom: 10 }}>Options Data</div>
        <h2 id="post-v1-options-contracts" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/contracts</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Retrieve option chains (active contracts) for underlying symbols.</p>
        <pre className="code" style={{ marginBottom: 28 }}>
{\`curl -X POST https://api.alpaca-proxy.io/v1/options/contracts \\\\
  -H "Authorization: Bearer <TOKEN>" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"underlying_symbols": "AAPL", "status": "active", "limit": 100}'\`}
        </pre>

        <h2 id="post-v1-options-snapshots" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/snapshots</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Retrieve realtime option snapshots (greeks, IV, NBBO) for specific contract symbols.</p>
        <pre className="code" style={{ marginBottom: 28 }}>
{\`curl -X POST https://api.alpaca-proxy.io/v1/options/snapshots \\\\
  -H "Authorization: Bearer <TOKEN>" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"symbols": "AAPL240119C00150000"}'\`}
        </pre>

        <h2 id="post-v1-options-snapshots-expiry" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/snapshots/expiry</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Retrieve all option snapshots aggregated by a specific expiration date.</p>
        <pre className="code" style={{ marginBottom: 28 }}>
{\`curl -X POST https://api.alpaca-proxy.io/v1/options/snapshots/expiry \\\\
  -H "Authorization: Bearer <TOKEN>" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"underlying_symbol": "AAPL", "expiration": "2024-01-19"}'\`}
        </pre>

        <h2 id="post-v1-history-options-bars" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/history/options/bars</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Fetch historical options bars for a specific contract.</p>
        <pre className="code" style={{ marginBottom: 28 }}>
{\`curl -X POST https://api.alpaca-proxy.io/v1/history/options/bars \\\\
  -H "Authorization: Bearer <TOKEN>" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"symbol": "AAPL240119C00150000", "timeframe": "1Day", "start": "2023-01-01", "end": "2024-01-01"}'\`}
        </pre>

        <h2 id="post-v1-options-open-interest" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/open_interest</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Retrieve open interest data for option contracts.</p>

        <h2 id="post-v1-options-eod" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/eod</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 48px" }}>Retrieve end-of-day (EOD) options summaries.</p>`;

content = content.replace(
  /<div className="eyebrow" style=\{\{ marginBottom: 10 \}\}>Options Data<\/div>[\s\S]*?<div style=\{\{ marginTop: 48 \}\}>\s*<div className="eyebrow" style=\{\{ marginBottom: 10 \}\}>Crypto Data<\/div>/,
  newOptionsContent + '\n      </div>\n\n      <div style={{ marginTop: 48 }}>\n        <div className="eyebrow" style={{ marginBottom: 10 }}>Crypto Data</div>'
);

const newStocksContent = `<div className="eyebrow" style={{ marginBottom: 10 }}>REST History</div>
        <h2 id="post-v1-history-bars" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/history/bars</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Fetch historical stock bars.</p>
        <pre className="code" style={{ marginBottom: 28 }}>
{\`curl -X POST https://api.alpaca-proxy.io/v1/history/bars \\\\
  -H "Authorization: Bearer <TOKEN>" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{"symbol": "AAPL", "timeframe": "1Day", "start": "2024-01-01", "end": "2024-01-10", "limit": 100}'\`}
        </pre>

        <h2 id="post-v1-history-news" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/history/news</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 48px" }}>Fetch historical market news.</p>`;

content = content.replace(
  /<div className="eyebrow" style=\{\{ marginBottom: 10 \}\}>REST History<\/div>[\s\S]*?<div style=\{\{ marginTop: 48 \}\}>\s*<div className="eyebrow" style=\{\{ marginBottom: 10 \}\}>Options Data<\/div>/,
  newStocksContent + '\n      </div>\n\n      <div style={{ marginTop: 48 }}>\n        <div className="eyebrow" style={{ marginBottom: 10 }}>Options Data</div>'
);

fs.writeFileSync(file, content);
console.log('Patched active state and content examples!');
