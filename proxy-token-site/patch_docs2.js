const fs = require('fs');
const file = '/home/kai/product-apim/proxy-token-site/claude_design/docs-site.jsx';
let content = fs.readFileSync(file, 'utf8');

// Replace SideNav sections
content = content.replace(
  /const sections = tab === "proxy" \? \[[\s\S]*?\] : \[/,
  `const sections = tab === "proxy" ? [
    { title: "Getting started", items: ["Overview", "Authentication", "Tiers & permissions"] },
    { title: "Token API", items: ["POST /register", "POST /check-status", "POST /generate-token"] },
    { title: "REST History", items: ["POST /v1/history/bars", "POST /v1/history/news"] },
    { title: "Options Data", items: ["POST /v1/options/contracts", "POST /v1/options/snapshots", "POST /v1/options/snapshots/expiry", "POST /v1/history/options/bars", "POST /v1/options/open_interest", "POST /v1/options/eod"] },
    { title: "Crypto Data", items: ["POST /v1/crypto/us/latest/orderbooks"] },
    { title: "Admin endpoints", items: ["POST /admin/login", "GET /admin/pending", "POST /admin/approve", "POST /admin/reject"] },
    { title: "Reference", items: ["Error codes", "Rate limits"] },
  ] : [`
);

// Remove hardcoded green highlight from SideNav links
content = content.replace(
  /color: i === 1 && j === 2 \? "var\(--ink-strong\)" : "var\(--ink-muted\)",/g,
  `color: "var(--ink-muted)",`
);
content = content.replace(
  /fontWeight: i === 1 && j === 2 \? 500 : 400,/g,
  `fontWeight: 400,`
);
content = content.replace(
  /borderLeft: i === 1 && j === 2 \? "2px solid var\(--accent\)" : "2px solid transparent",/g,
  `borderLeft: "2px solid transparent",`
);

// Replace the entire ProxyApiBody component
const proxyApiBodyReplacement = `function ProxyApiBody() {
  return (
    <div style={{ maxWidth: 760 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Getting started</div>
        <h2 id="overview" className="display-title" style={{ fontSize: 38, margin: "0 0 8px" }}>Overview</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px", maxWidth: 620 }}>
          Welcome to the Stock Options Proxy API documentation. This API provides both token management and realtime/historical data access.
        </p>
        
        <h2 id="authentication" className="display-title" style={{ fontSize: 38, margin: "0 0 8px" }}>Authentication</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 48px", maxWidth: 620 }}>
          Authenticate using your proxy token via the <code>Authorization: Bearer &lt;token&gt;</code> header for data endpoints.
        </p>

        <h2 id="tiers-permissions" className="display-title" style={{ fontSize: 28, margin: "0 0 16px" }}>Tiers & permissions</h2>
        <table className="tbl card" style={{ overflow: "hidden", marginBottom: 48 }}>
          <thead>
            <tr><th style={{ width: 160 }}>Tier</th><th>WebSocket channels</th><th>REST endpoints</th></tr>
          </thead>
          <tbody>
            <tr><td><span className="tier premium">Premium</span></td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-base)" }}>stocks · options · overnight · crypto · news</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-base)" }}>all history + snapshots + orderbooks</td></tr>
            <tr><td><span className="tier standard">Limited&nbsp;Premium</span></td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-base)" }}>stocks · options</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-base)" }}>history · contracts · snapshots</td></tr>
            <tr><td><span className="tier basic">Basic</span></td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-base)" }}>stocks · news</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-base)" }}>stocks_history · news_history</td></tr>
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 48 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Token API</div>
        <h2 id="post-register" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /register</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Register a new account for proxy access.</p>

        <h2 id="post-check-status" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /check-status</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Check the approval status of your account.</p>

        <h2 id="post-generate-token" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /generate-token</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 48px" }}>Exchange an approved username + phone pair for a 30‑day UUID token.</p>
      </div>

      <div style={{ marginTop: 48 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>REST History</div>
        <h2 id="post-v1-history-bars" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/history/bars</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Fetch historical stock bars.</p>

        <h2 id="post-v1-history-news" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/history/news</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 48px" }}>Fetch historical market news.</p>
      </div>

      <div style={{ marginTop: 48 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Options Data</div>
        <h2 id="post-v1-options-contracts" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/contracts</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Retrieve option chains (active contracts) for underlying symbols.</p>

        <h2 id="post-v1-options-snapshots" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/snapshots</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Retrieve realtime option snapshots (greeks, IV, NBBO).</p>

        <h2 id="post-v1-options-snapshots-expiry" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/snapshots/expiry</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Retrieve option snapshots aggregated by expiration date.</p>

        <h2 id="post-v1-history-options-bars" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/history/options/bars</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Fetch historical options bars.</p>

        <h2 id="post-v1-options-open-interest" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/open_interest</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Retrieve open interest data for option contracts.</p>

        <h2 id="post-v1-options-eod" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/eod</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 48px" }}>Retrieve end-of-day (EOD) options summaries.</p>
      </div>

      <div style={{ marginTop: 48 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Crypto Data</div>
        <h2 id="post-v1-crypto-us-latest-orderbooks" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/crypto/us/latest/orderbooks</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 48px" }}>Retrieve L2 orderbooks for US crypto markets.</p>
      </div>

      <div style={{ marginTop: 48 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Admin endpoints</div>
        <h2 id="post-admin-login" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /admin/login</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Login to receive a temporary JWT for admin endpoints.</p>

        <h2 id="get-admin-pending" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>GET /admin/pending</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>List all pending user registrations.</p>

        <h2 id="post-admin-approve" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /admin/approve</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Approve a pending user registration.</p>

        <h2 id="post-admin-reject" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /admin/reject</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 48px" }}>Reject a pending user registration.</p>
      </div>

      <div style={{ marginTop: 48, paddingBottom: 100 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Reference</div>
        <h2 id="error-codes" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Error codes</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Standard JSON error shapes and HTTP status codes.</p>

        <h2 id="rate-limits" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Rate limits</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Documentation on API throttling limits based on tiers.</p>
      </div>
    </div>
  );
}`;

content = content.replace(/function ProxyApiBody\(\) \{[\s\S]*?\}\n\nfunction WsUsageBody\(\) \{/, proxyApiBodyReplacement + '\n\nfunction WsUsageBody() {');

fs.writeFileSync(file, content);
console.log('Patched docs-site.jsx again');
