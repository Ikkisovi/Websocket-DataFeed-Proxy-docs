const fs = require('fs');
const file = '/home/kai/product-apim/proxy-token-site/claude_design/docs-site.jsx';
let content = fs.readFileSync(file, 'utf8');

// Add Proxy API stubs before "Generate token"
content = content.replace(
  /<div className="eyebrow" style=\{\{ marginBottom: 10 \}\}>Public endpoints<\/div>/,
  `<div>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Getting started</div>
      <h2 id="overview" className="display-title" style={{ fontSize: 38, margin: "0 0 8px" }}>Overview</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px", maxWidth: 620 }}>
        Welcome to the Stock Options Proxy API documentation.
      </p>
      
      <h2 id="authentication" className="display-title" style={{ fontSize: 38, margin: "0 0 8px" }}>Authentication</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 48px", maxWidth: 620 }}>
        Authenticate using your proxy token in the headers.
      </p>
      
      <div className="eyebrow" style={{ marginBottom: 10 }}>Public endpoints</div>
      <h2 id="post-register" className="display-title" style={{ fontSize: 38, margin: "0 0 8px" }}>Register</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 48px", maxWidth: 620 }}>
        Register a new account.
      </p>

      <h2 id="post-check-status" className="display-title" style={{ fontSize: 38, margin: "0 0 8px" }}>Check status</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 48px", maxWidth: 620 }}>
        Check the status of your account.
      </p>
`
);

// Add Proxy API stubs after "Tiers & permissions"
content = content.replace(
  /<\/tbody>\s*<\/table>\s*<\/div>\s*<\/div>/,
  `</tbody>
        </table>
      </div>

      <div style={{ marginTop: 48 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Admin endpoints</div>
        <h2 id="post-admin-login" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Admin login</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Login as admin.</p>

        <h2 id="get-admin-pending" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Get pending</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>List pending approvals.</p>

        <h2 id="post-admin-approve" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Approve</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Approve a user.</p>

        <h2 id="post-admin-reject" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Reject</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 48px" }}>Reject a user.</p>
      </div>

      <div style={{ marginTop: 48, paddingBottom: 100 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Reference</div>
        <h2 id="error-codes" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Error codes</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Common API errors.</p>

        <h2 id="rate-limits" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Rate limits</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Limits on API requests.</p>
      </div>
    </div>`
);

// Add WS API stubs at the end
content = content.replace(
  /<\/div>\s*\);\s*\}\s*window\.DocsSite = DocsSite;/m,
  `      <div style={{ marginTop: 48 }}>
        <h3 id="heartbeat" style={{ fontFamily: "var(--f-sans)", fontWeight: 500, fontSize: 13, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink-muted)", margin: "0 0 12px" }}>Heartbeat</h3>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Server sends ping every 30s.</p>

        <div className="eyebrow" style={{ marginBottom: 10 }}>Channels</div>
        <h2 id="stocks" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Stocks</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Live US equities feed.</p>
        
        <h2 id="options" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Options</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Live OPRA feed.</p>
        
        <h2 id="crypto" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Crypto</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Live cryptocurrency feed.</p>
        
        <h2 id="news" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>News</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Realtime news events.</p>
        
        <h2 id="overnight" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Overnight</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 48px" }}>Extended hours trading.</p>

        <div className="eyebrow" style={{ marginBottom: 10 }}>Messages</div>
        <h2 id="subscribe" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Subscribe</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Format for subscribing.</p>
        
        <h2 id="unsubscribe" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Unsubscribe</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Format for unsubscribing.</p>
        
        <h2 id="trade" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Trade</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Trade event details.</p>
        
        <h2 id="quote" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Quote</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>Quote event details.</p>
        
        <h2 id="bar" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Bar</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 48px" }}>Minute bar event details.</p>

        <div className="eyebrow" style={{ marginBottom: 10, paddingBottom: 100 }}>Operations</div>
        <h2 id="reconnect" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Reconnect</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>How to handle disconnects.</p>

        <h2 id="backpressure" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Backpressure</h2>
        <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>How to handle fast data.</p>
      </div>
    </div>
  );
}

window.DocsSite = DocsSite;`
);

fs.writeFileSync(file, content);
console.log('Patched content!');
