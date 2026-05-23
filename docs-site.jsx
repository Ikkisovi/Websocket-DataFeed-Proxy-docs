// DocsSite.jsx — Public Docs Site redesign
// Top bar · hero · tabs (Proxy API / WS usage — Reports removed) · 3-col docs layout

const { useState } = React;

function DocsTopbar({ active = "proxy" }) {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="dot"></span>
        <span><strong>Public Docs Site</strong></span>
      </div>
      <div className="divider"></div>
      <div className="nav">
        <a className={active === "proxy" ? "active" : ""}>Proxy API</a>
        <a className={active === "ws" ? "active" : ""}>WS usage</a>
      </div>
      <div className="spacer"></div>
      <div className="meta">
        <span className="pill"><span className="live"></span> v2.4 · live</span>
        <a className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.34c-2.22.48-2.69-1.07-2.69-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.7 7.7 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.74.54 1.49v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0z"/></svg>
          ikkisovi/Websocket-DataFeed-Proxy-docs
        </a>
      </div>
    </div>
  );
}

function DocsSite() {
  const [tab, setTab] = useState("proxy");
  return (
    <div className="proxy-app" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <DocsTopbar active={tab} />

      {/* Hero */}
      <div style={{
        padding: "44px 64px 28px",
        borderBottom: "1px solid var(--rule)",
        background: "var(--bg-paper)",
        position: "relative",
        overflow: "hidden",
      }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Reference · static site</div>
        <h1 className="display-title" style={{ fontSize: 64, margin: "0 0 14px" }}>
          Stock Options Proxy <span style={{ fontStyle: "italic", color: "var(--accent-ink)" }}>API</span>
        </h1>
        <p style={{ color: "var(--ink-muted)", maxWidth: 640, fontSize: 15, margin: 0 }}>
          Rendered from the repository markdown sources and published as a static GitHub Pages site.
          Two surfaces: the <strong style={{ color: "var(--ink-strong)" }}>Proxy API</strong> covers token
          provisioning and tier management; <strong style={{ color: "var(--ink-strong)" }}>WS usage</strong> covers
          the realtime feed contract.
        </p>

        {/* Tab strip */}
        <div style={{ marginTop: 32, display: "flex", gap: 0, borderBottom: "1px solid var(--rule)", marginInline: -64, paddingInline: 64 }}>
          <Tab id="proxy" tab={tab} setTab={setTab} label="Proxy API" count="15 endpoints" />
          <Tab id="ws" tab={tab} setTab={setTab} label="WS usage" count="6 channels" />
          <div style={{ flex: 1 }}></div>
          <div style={{ alignSelf: "flex-end", paddingBottom: 10, color: "var(--ink-soft)", fontFamily: "var(--f-mono)", fontSize: 11 }}>
            last sync · 2026-05-22 verified live
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 220px", flex: 1 }}>
        <SideNav tab={tab} />
        <main style={{ padding: "40px 56px", background: "var(--bg-canvas)" }}>
          {tab === "proxy" ? <ProxyApiBody /> : <WsUsageBody />}
        </main>
        <OnThisPage tab={tab} />
      </div>
    </div>
  );
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function Tab({ id, tab, setTab, label, count }) {
  const active = tab === id;
  return (
    <button
      onClick={() => setTab(id)}
      style={{
        background: "transparent",
        border: "none",
        padding: "12px 0",
        marginRight: 28,
        cursor: "pointer",
        fontFamily: "var(--f-sans)",
        fontSize: 14,
        fontWeight: 500,
        color: active ? "var(--ink-strong)" : "var(--ink-muted)",
        borderBottom: `2px solid ${active ? "var(--ink-strong)" : "transparent"}`,
        marginBottom: -1,
        display: "flex",
        alignItems: "baseline",
        gap: 8,
      }}
    >
      {label}
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)", fontWeight: 400 }}>{count}</span>
    </button>
  );
}

function SideNav({ tab }) {
  const [activeId, setActiveId] = React.useState("");
  const [expanded, setExpanded] = React.useState({ "Options Data": true, "Snapshots": true });
  React.useEffect(() => {
    const onHashChange = () => setActiveId(window.location.hash.slice(1));
    window.addEventListener('hashchange', onHashChange);
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => { if(entry.isIntersecting) setActiveId(entry.target.id); });
    }, { rootMargin: '-20% 0px -80% 0px' });
    setTimeout(() => document.querySelectorAll('h2[id], h3[id]').forEach(h => observer.observe(h)), 500);
    return () => { window.removeEventListener('hashchange', onHashChange); observer.disconnect(); };
  }, [tab]);

  const toggle = (title) => setExpanded(prev => ({ ...prev, [title]: !prev[title] }));

  const sections = tab === "proxy" ? [
    { title: "Getting started", items: ["Overview", "Authentication", "Tiers & permissions"] },
    { title: "Token API", items: ["POST /register", "POST /check-status", "POST /generate-token"] },
    { title: "REST History", items: ["POST /v1/history/bars", "POST /v1/history/news"] },
    { title: "Options Data", items: ["POST /v1/options/contracts"], children: [
      { title: "Snapshots", items: ["POST /v1/options/snapshots", "POST /v1/options/snapshots/quote", "POST /v1/options/snapshots/open_interest", "POST /v1/options/snapshots/expiry"] },
      { title: "History", items: ["POST /v1/history/options/bars"] },
      { title: "Open Interest", items: ["POST /v1/options/open_interest"] },
      { title: "EOD", items: ["POST /v1/options/eod"] },
    ]},
    { title: "Crypto Data", items: ["POST /v1/crypto/us/latest/orderbooks"] },
    { title: "Admin endpoints", items: ["POST /admin/login", "GET /admin/pending", "POST /admin/approve", "POST /admin/reject"] },
    { title: "Reference", items: ["Error codes", "Rate limits"] },
  ] : [
    { title: "Connecting", items: ["Endpoint", "Auth message", "Heartbeat"] },
    { title: "Channels", items: ["stocks", "options", "crypto", "news", "overnight"] },
    { title: "Messages", items: ["Subscribe", "Unsubscribe", "Trade", "Quote", "Bar"] },
    { title: "Operations", items: ["Reconnect", "Backpressure"] },
  ];

  function Chevron({ open }) {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', marginLeft: 'auto', opacity: 0.5 }}>
        <path d="M3 1 L7 5 L3 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }

  function Section({ s, depth = 0 }) {
    const hasChildren = s.children && s.children.length > 0;
    const isOpen = expanded[s.title] !== false;
    const isMono = s.title.includes("endpoints") || s.title === "Messages";
    const basePad = 12;
    const indent = basePad + depth * 14;
    return (
      <div style={{ marginBottom: hasChildren ? 2 : 6 }}>
        <div
          onClick={() => hasChildren && toggle(s.title)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 10px 4px " + (indent + (hasChildren ? 0 : 16)),
            cursor: hasChildren ? "pointer" : "default",
            color: "var(--ink-soft)", fontSize: 11, fontWeight: 600,
            letterSpacing: "0.08em", textTransform: "uppercase",
            userSelect: "none",
          }}
        >
          {hasChildren && <Chevron open={isOpen} />}
          {s.title}
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          {s.items && s.items.map((it, j) => (
            <li key={j} style={{ position: "relative" }}>
              {depth > 0 && (
                <span style={{ position: "absolute", left: indent - 4, top: 0, bottom: 0, width: 1, background: "var(--rule)" }} />
              )}
              <a href={"#" + slugify(it)} style={{
                textDecoration: "none", display: "block",
                padding: "3px 10px 3px " + (indent + 14),
                color: activeId === slugify(it) ? "var(--ink-strong)" : "var(--ink-muted)",
                fontWeight: activeId === slugify(it) ? 500 : 400,
                borderLeft: activeId === slugify(it) ? "2px solid var(--accent)" : "2px solid transparent",
                marginLeft: 0,
                fontFamily: isMono ? "var(--f-mono)" : "var(--f-sans)",
                fontSize: isMono ? 12 : 13,
              }}>{it}</a>
            </li>
          ))}
        </ul>
        {hasChildren && isOpen && s.children.map((child, k) => (
          <Section key={k} s={child} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <nav style={{
      padding: "32px 0 32px 32px",
      borderRight: "1px solid var(--rule)",
      background: "var(--bg-canvas)",
      fontSize: 13, position: "sticky", top: 0, height: "100vh", overflow: "auto"
    }}>
      {sections.map((s, i) => <Section key={i} s={s} />)}
    </nav>
  );
}

function OnThisPage({ tab }) {
  const [activeId, setActiveId] = React.useState("");
  React.useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => { if(entry.isIntersecting) setActiveId(entry.target.id); });
    }, { rootMargin: '-20% 0px -80% 0px' });
    setTimeout(() => document.querySelectorAll('h2[id], h3[id]').forEach(h => observer.observe(h)), 500);
    return () => observer.disconnect();
  }, [tab]);
  const items = tab === "proxy"
    ? ["Request", "Response", "Validation", "Examples", "Errors"]
    : ["Connect", "Authenticate", "Subscribe", "Message shapes", "Reconnect"];
  return (
    <aside style={{
      padding: "40px 24px",
      borderLeft: "1px solid var(--rule)",
      background: "var(--bg-canvas)", fontSize: 12.5, position: "sticky", top: 0, height: "100vh", overflow: "auto"
    }}>
      <div className="eyebrow" style={{ marginBottom: 12, color: "var(--ink-soft)" }}>On this page</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((it, i) => (
          <li key={i}>
            <a href={"#" + slugify(it)} style={{textDecoration: "none",  color: activeId === slugify(it) ? "var(--ink-strong)" : "var(--ink-muted)" }}>{it}</a>
          </li>
        ))}
      </ul>

      <div style={{
        marginTop: 28,
        padding: 14,
        borderRadius: 8,
        background: "var(--bg-paper)",
        border: "1px solid var(--rule)",
      }}>
        <div className="eyebrow" style={{ marginBottom: 6, color: "var(--ink-soft)" }}>Try it</div>
        <p style={{ margin: "0 0 10px", color: "var(--ink-muted)", fontSize: 12 }}>
          Open the live token portal to test your credentials.
        </p>
        <button className="btn" style={{ width: "100%", justifyContent: "center", fontSize: 12 }}>
          Open portal →
        </button>
      </div>
    </aside>
  );
}

const PROXY_HOST = "52.37.182.24";
const REST_BASE  = `http://${PROXY_HOST}:8766`;
const TOKEN_BASE = `http://${PROXY_HOST}:3000`;

function ParamRow({ name, type, required, desc }) {
  return (
    <tr>
      <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-strong)", whiteSpace: "nowrap" }}>{name}</td>
      <td style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)" }}>{type}</td>
      <td style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: required ? "var(--accent)" : "var(--ink-soft)" }}>{required ? "required" : "optional"}</td>
      <td style={{ fontSize: 12, color: "var(--ink-muted)" }}>{desc}</td>
    </tr>
  );
}

function ParamTable({ rows }) {
  return (
    <table className="tbl" style={{ marginBottom: 20, width: "100%", fontSize: 13 }}>
      <thead>
        <tr>
          <th style={{ width: 180 }}>Parameter</th>
          <th style={{ width: 90 }}>Type</th>
          <th style={{ width: 90 }}>Required</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => <ParamRow key={i} {...r} />)}
      </tbody>
    </table>
  );
}

function EndpointBadge({ method, path }) {
  const colors = { POST: "var(--accent)", GET: "var(--ok)", WSS: "#8b5cf6" };
  return (
    <div className="card" style={{ padding: "10px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
      <span className="method" style={{ background: colors[method] || "var(--accent)", color: "#fff", padding: "2px 8px", borderRadius: 4, fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700 }}>{method}</span>
      <code style={{ fontFamily: "var(--f-mono)", fontSize: 13 }}>{path}</code>
    </div>
  );
}

function ProxyApiBody() {
  return (
    <div style={{ maxWidth: 760 }}>

      {/* ── Getting started ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Getting started</div>
      <h2 id="overview" className="display-title" style={{ fontSize: 38, margin: "0 0 8px" }}>Overview</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 16px", maxWidth: 640 }}>
        The Stock Options Proxy has two surfaces: a <strong style={{ color: "var(--ink-strong)" }}>token portal</strong> (port 3000) for registration and token issuance,
        and a <strong style={{ color: "var(--ink-strong)" }}>data proxy</strong> (port 8766 REST / 8765 WS) for market data.
        Once you have a token, use it to call historical and realtime endpoints without managing your own Alpaca / ThetaData credentials.
      </p>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 40 }}>
        <thead><tr><th>Surface</th><th>URL</th><th>Auth</th></tr></thead>
        <tbody>
          <tr><td>Token portal</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{TOKEN_BASE}</td><td style={{ fontSize: 12 }}>username + phone</td></tr>
          <tr><td>REST data proxy</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{REST_BASE}</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>Bearer &lt;token&gt;</td></tr>
          <tr><td>WS data proxy</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{`ws://${PROXY_HOST}:8765`}</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>auth message</td></tr>
        </tbody>
      </table>

      <h2 id="authentication" className="display-title" style={{ fontSize: 28, margin: "0 0 12px" }}>Authentication</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        All data endpoints (REST and WS) require a UUID token. Pass it as an HTTP header or in the JSON body:
      </p>
      <pre className="code" style={{ marginBottom: 12 }}>
{`# Option A — Authorization header (preferred)
Authorization: Bearer c886624f-232d-4803-99fa-f8b970e4720a

# Option B — token field in request body
{ "token": "c886624f-232d-4803-99fa-f8b970e4720a", "symbol": "AAPL", ... }`}
      </pre>
      <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: "0 0 40px" }}>
        Tokens expire 30 days after issuance. The proxy returns <code>401</code> for invalid or expired tokens and <code>403</code> if your tier lacks permission for the endpoint.
      </p>

      <h2 id="tiers-permissions" className="display-title" style={{ fontSize: 28, margin: "0 0 16px" }}>Tiers &amp; permissions</h2>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 12 }}>
        <thead>
          <tr><th style={{ width: 150 }}>Tier</th><th>WS channels</th><th>WS symbols</th><th>REST req/min</th><th>REST endpoints</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="tier premium">Premium</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>stocks · options · overnight · crypto · news · boats</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>500</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>300</td>
            <td style={{ fontSize: 12 }}>All endpoints including crypto orderbooks</td>
          </tr>
          <tr>
            <td><span className="tier standard">Limited Premium</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>stocks · options</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>20</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>60</td>
            <td style={{ fontSize: 12 }}>history/bars, options/*, news history excluded, no crypto</td>
          </tr>
          <tr>
            <td><span className="tier basic">Basic</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>stocks · news</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>10</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>10</td>
            <td style={{ fontSize: 12 }}>stocks_history and news_history only</td>
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 40px" }}>
        Rate limits tighten automatically under load: limits halve when server is overloaded and quarter under critical load. WebSocket delivery is always prioritised over REST.
      </p>

      {/* ── Token API ── */}
      <div className="eyebrow" style={{ marginBottom: 10, marginTop: 48 }}>Token API</div>

      <h2 id="post-register" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /api/register</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>Submit a new account registration. The request enters a pending queue until approved by an admin.</p>
      <EndpointBadge method="POST" path={`${TOKEN_BASE}/api/register`} />
      <ParamTable rows={[
        { name: "username", type: "string", required: true, desc: "Unique display name (must not exist in approved users)" },
        { name: "phone",    type: "string", required: true, desc: "Mobile number used to verify identity on token generation" },
        { name: "tier",     type: "string", required: false, desc: "premium | limited_premium | basic (default: premium)" },
      ]} />
      <pre className="code" style={{ marginBottom: 28 }}>
{`// Request
{ "username": "tonnysun", "phone": "18717931119", "tier": "premium" }

// Response 200
{ "success": true, "message": "注册成功！请等待卖家确认订单后即可生成 Token。", "id": "61ce4f82-..." }

// Error 409 — username already taken
{ "success": false, "message": "该用户名已被使用，请换一个。" }`}
      </pre>

      <h2 id="post-check-status" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /api/check-status</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>Poll approval status before attempting token generation.</p>
      <EndpointBadge method="POST" path={`${TOKEN_BASE}/api/check-status`} />
      <ParamTable rows={[
        { name: "username", type: "string", required: true, desc: "The username submitted at registration" },
        { name: "phone",    type: "string", required: true, desc: "The phone number submitted at registration" },
      ]} />
      <pre className="code" style={{ marginBottom: 28 }}>
{`// Request
{ "username": "tonnysun", "phone": "18717931119" }

// Response — status values: "pending" | "approved" | "rejected" | "not_found"
{ "success": true, "status": "pending", "message": "审核中，请耐心等待。" }`}
      </pre>

      <h2 id="post-generate-token" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /api/generate-token</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Exchange approved credentials for a 30-day UUID token. If a token already exists for this user in the proxy registry it is returned as-is (not regenerated).
      </p>
      <EndpointBadge method="POST" path={`${TOKEN_BASE}/api/generate-token`} />
      <ParamTable rows={[
        { name: "username", type: "string", required: true, desc: "Must match an entry in the approved users database" },
        { name: "phone",    type: "string", required: true, desc: "Must match the phone number on record" },
      ]} />
      <pre className="code" style={{ marginBottom: 48 }}>
{`// Request
{ "username": "ikkipipi", "phone": "15213285787" }

// Response 200
{
  "success": true,
  "token":  "c886624f-232d-4803-99fa-f8b970e4720a",
  "expiry": "2026-06-19T14:15:57.059704+00:00",
  "role":   "premium"
}

// Error 401 — credentials not found or not approved
{ "success": false, "message": "User not found or payment pending." }`}
      </pre>

      {/* ── REST History ── */}
      <div className="eyebrow" style={{ marginBottom: 10, marginTop: 0 }}>REST History</div>

      <h2 id="post-v1-history-bars" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/history/bars</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Fetch historical OHLCV bars for US equities. Paginates automatically up to <code>max_pages</code>. Results are cached for 5 minutes; check the <code>X-Cache</code> response header for <code>HIT</code> / <code>MISS</code>.
        Data source: Alpaca SIP feed (pro account, split/dividend adjusted).
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/history/bars`} />
      <ParamTable rows={[
        { name: "symbol",    type: "string",  required: true,  desc: "Ticker (e.g. AAPL). Comma-separated for multi-symbol." },
        { name: "start",     type: "string",  required: true,  desc: "ISO 8601 date or datetime (e.g. 2024-01-02)" },
        { name: "end",       type: "string",  required: true,  desc: "ISO 8601 date or datetime" },
        { name: "timeframe", type: "string",  required: false, desc: "1Min | 5Min | 15Min | 30Min | 1Hour | 1Day (default: 1Min)" },
        { name: "feed",      type: "string",  required: false, desc: "sip | iex (default: sip)" },
        { name: "limit",     type: "integer", required: false, desc: "Bars per page, 1–10000 (default: 10000)" },
        { name: "max_pages", type: "integer", required: false, desc: "Max pagination pages (default: 100)" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/history/bars \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbol":"AAPL","timeframe":"1Day","start":"2024-01-02","end":"2024-01-05","limit":5}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 40 }}>
{`// Response  (X-Cache: MISS on first call, HIT on repeat)
{
  "bars": {
    "AAPL": [
      { "o": 185.06, "h": 186.33, "l": 181.83, "c": 183.56,
        "v": 82496943, "vw": 183.77, "n": 1009074,
        "t": "2024-01-02T05:00:00Z" },
      { "o": 182.16, "h": 183.80, "l": 181.38, "c": 182.19,
        "v": 58418916, "vw": 182.26, "n": 656956,
        "t": "2024-01-03T05:00:00Z" }
    ]
  },
  "pages": 1
}`}
      </pre>

      <h2 id="post-v1-history-news" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/history/news</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Fetch historical news articles. Source: Benzinga via Alpaca. Available to all tiers including Basic.
        Pass <code>max_pages</code> greater than 1 to auto-paginate; each page contains up to 50 articles.
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/history/news`} />
      <ParamTable rows={[
        { name: "symbols",            type: "string",  required: false, desc: "Comma-separated tickers; omit for market-wide news" },
        { name: "start",              type: "string",  required: false, desc: "ISO 8601 start date" },
        { name: "end",                type: "string",  required: false, desc: "ISO 8601 end date" },
        { name: "limit",              type: "integer", required: false, desc: "Articles per page, 1–50 (default: 50)" },
        { name: "sort",               type: "string",  required: false, desc: "asc | desc (default: asc)" },
        { name: "max_pages",          type: "integer", required: false, desc: "Max pages to auto-fetch (default: 1)" },
        { name: "include_content",    type: "boolean", required: false, desc: "Include full article body" },
        { name: "exclude_contentless",type: "boolean", required: false, desc: "Skip articles with empty content" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/history/news \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbols":"AAPL","start":"2024-01-02","end":"2024-01-03","limit":3}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 48 }}>
{`// Response
{
  "news": [
    {
      "id": 36445586,
      "headline": "Wedbush's Dan Ives Says, 'Tech Stocks Will Be Up 25% In 2024'",
      "author": "Benzinga Neuro",
      "source": "benzinga",
      "summary": "...",
      "url": "https://www.benzinga.com/...",
      "symbols": ["AAPL", "GOOG", "MSFT"],
      "created_at": "2024-01-02T02:00:46Z",
      "updated_at": "2024-01-02T02:00:46Z",
      "images": [
        { "size": "large", "url": "https://cdn.benzinga.com/..." }
      ]
    }
  ],
  "pages": 1
}`}
      </pre>

      {/* ── Options Data ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Options Data</div>

      <h2 id="post-v1-options-contracts" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/contracts</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        List active option contracts for one or more underlying symbols. Returns Alpaca contract metadata including OCC symbol, strike, expiration, open interest, and last close price.
        Use the returned <code>symbol</code> field as input to <code>/v1/options/snapshots</code> or <code>/v1/history/options/bars</code>.
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/options/contracts`} />
      <ParamTable rows={[
        { name: "underlying_symbols",  type: "string",  required: false, desc: "Comma-separated underlyings (e.g. AAPL,TSLA). Required if symbol_or_id not set." },
        { name: "symbol_or_id",        type: "string",  required: false, desc: "Lookup a single OCC symbol or contract ID directly" },
        { name: "expiration_date",     type: "string",  required: false, desc: "Exact expiry YYYY-MM-DD" },
        { name: "expiration_date_gte", type: "string",  required: false, desc: "Expiry on or after date" },
        { name: "expiration_date_lte", type: "string",  required: false, desc: "Expiry on or before date" },
        { name: "strike_price_gte",    type: "number",  required: false, desc: "Minimum strike price" },
        { name: "strike_price_lte",    type: "number",  required: false, desc: "Maximum strike price" },
        { name: "type",                type: "string",  required: false, desc: "call | put" },
        { name: "limit",               type: "integer", required: false, desc: "1–10000 (default: 1000)" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/options/contracts \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"underlying_symbols":"AAPL","limit":2}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 40 }}>
{`// Response
{
  "option_contracts": [
    {
      "symbol":           "AAPL260522C00110000",
      "name":             "AAPL May 22 2026 110 Call",
      "status":           "active",
      "tradable":         true,
      "type":             "call",
      "style":            "american",
      "strike_price":     "110",
      "expiration_date":  "2026-05-22",
      "root_symbol":      "AAPL",
      "underlying_symbol":"AAPL",
      "multiplier":       "100",
      "open_interest":    "3",
      "open_interest_date":"2026-05-20",
      "close_price":      "192.05",
      "close_price_date": "2026-05-21"
    }
  ],
  "next_page_token": null
}`}
      </pre>

      <h2 id="post-v1-history-options-bars" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/history/options/bars</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Historical OHLCV bars for option contracts. Primary data source: <strong style={{ color: "var(--ink-strong)" }}>ThetaData</strong> with Alpaca as fallback.
        You can pass either OCC symbols directly (<code>AAPL260620C00200000</code>) or a plain stock ticker — the proxy will auto-resolve it to the option chain active on the <code>start</code> date.
        Supports in-flight coalescing: duplicate concurrent requests share one upstream fetch.
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/history/options/bars`} />
      <ParamTable rows={[
        { name: "symbols",   type: "string",  required: true,  desc: "OCC symbol(s) comma-separated, or a stock ticker for auto-resolution" },
        { name: "start",     type: "string",  required: true,  desc: "ISO 8601 date" },
        { name: "end",       type: "string",  required: true,  desc: "ISO 8601 date" },
        { name: "timeframe", type: "string",  required: false, desc: "1Min | 5Min | 15Min | 30Min | 1Hour | 1Day (default: 1Min)" },
        { name: "limit",     type: "integer", required: false, desc: "Bars per page, 1–10000 (default: 10000)" },
        { name: "max_pages", type: "integer", required: false, desc: "Max pagination pages (default: 100)" },
      ]} />
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 12px" }}>
        OCC symbol format: <code>{"<ROOT><YYMMDD><C|P><8-digit-strike>"}</code> — strike is in thousandths of a dollar, zero-padded to 8 digits.
        Example: AAPL $200 call expiring 2026-06-20 → <code>AAPL260620C00200000</code>
      </p>
      <pre className="code" style={{ marginBottom: 12 }}>
{`// With explicit OCC symbol
curl -X POST ${REST_BASE}/v1/history/options/bars \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbols":"AAPL260620C00200000","start":"2025-05-01","end":"2025-05-15","timeframe":"1Day"}'

// With stock ticker (auto-resolves to chain active on start date)
  -d '{"symbols":"AAPL","start":"2025-01-02","end":"2025-01-10","timeframe":"1Hour"}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 40 }}>
{`// Response
{
  "bars": {
    "AAPL260620C00200000": [
      { "o": 14.50, "h": 15.20, "l": 14.10, "c": 14.85, "v": 320, "t": "2025-05-01T..." }
    ]
  },
  "pages": 1
}`}
      </pre>

      <h2 id="post-v1-options-open-interest" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/open_interest</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Historical open interest by date range and strike/expiry filter. Data source: <strong style={{ color: "var(--ink-strong)" }}>ThetaData</strong> (returns 503 if ThetaData unavailable).
        Requires <em>limited_premium</em> or higher (mapped to <code>options_history</code> permission).
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/options/open_interest`} />
      <ParamTable rows={[
        { name: "symbol",       type: "string",  required: true,  desc: "Root ticker (e.g. AAPL)" },
        { name: "start",        type: "string",  required: true,  desc: "ISO 8601 date" },
        { name: "end",          type: "string",  required: true,  desc: "ISO 8601 date" },
        { name: "expiration",   type: "string",  required: false, desc: "Specific expiry date or * for all (default: *)" },
        { name: "strike",       type: "number",  required: false, desc: "Specific strike or * for all (default: *)" },
        { name: "right",        type: "string",  required: false, desc: "call | put | both (default: both)" },
        { name: "max_dte",      type: "integer", required: false, desc: "Max days-to-expiry filter" },
        { name: "strike_range", type: "integer", required: false, desc: "ATM ± N strikes filter" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/options/open_interest \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbol":"AAPL","start":"2025-01-02","end":"2025-01-05"}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 40 }}>
{`// Response
{
  "count": 1840,
  "data": [
    {
      "symbol":        "AAPL",
      "expiration":    "2025-04-17",
      "strike":        170.0,
      "right":         "CALL",
      "timestamp":     "2025-01-02T06:30:15-05:00",
      "open_interest": 116
    }
  ]
}`}
      </pre>

      <h2 id="post-v1-options-eod" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/eod</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        End-of-day OHLC summary for option contracts: open/high/low/close, volume, bid/ask, and trade count per contract per day.
        This is the primary endpoint for historical options OHLC data. Data source: <strong style={{ color: "var(--ink-strong)" }}>ThetaData</strong>.
        Accepts the same filter parameters as <code>/v1/options/open_interest</code>.
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/options/eod`} />
      <ParamTable rows={[
        { name: "symbol",       type: "string",  required: true,  desc: "Root ticker (e.g. AAPL)" },
        { name: "start",        type: "string",  required: true,  desc: "ISO 8601 date" },
        { name: "end",          type: "string",  required: true,  desc: "ISO 8601 date" },
        { name: "expiration",   type: "string",  required: false, desc: "Specific expiry or * for all (default: *)" },
        { name: "strike",       type: "number",  required: false, desc: "Specific strike or * for all (default: *)" },
        { name: "right",        type: "string",  required: false, desc: "call | put | both (default: both)" },
        { name: "max_dte",      type: "integer", required: false, desc: "Max days-to-expiry filter" },
        { name: "strike_range", type: "integer", required: false, desc: "ATM ± N strikes filter" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/options/eod \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbol":"AAPL","start":"2025-01-02","end":"2025-01-03","right":"call","max_dte":30}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 12 }}>
{`// Response — each record is one contract on one trading day
{
  "count": 820,
  "data": [
    {
      "symbol":     "AAPL",
      "expiration": "2025-04-17",
      "strike":     170.0,
      "right":      "CALL",
      "open":  75.21, "high":  75.21, "low":  75.21, "close": 75.21,
      "volume": 2,  "count": 1,
      "bid": 75.45, "bid_size": 83,
      "ask": 75.70, "ask_size": 30,
      "created":    "2025-01-02T17:15:44-05:00",
      "last_trade": "2025-01-02T14:43:52-05:00"
    }
  ]
}`}
      </pre>
      <h3 id="eod-python-example" style={{ fontSize: 16, fontWeight: 500, margin: "20px 0 8px", color: "var(--ink-strong)" }}>Python example — fetch OHLC for near-term calls</h3>
      <pre className="code" style={{ marginBottom: 48 }}>
{`import requests

resp = requests.post(
    "${REST_BASE}/v1/options/eod",
    headers={"Authorization": "Bearer <TOKEN>"},
    json={
        "symbol": "AAPL",
        "start":  "2025-01-02",
        "end":    "2025-01-10",
        "right":  "call",
        "max_dte": 30,
        "strike_range": 5      # ATM ± 5 strikes
    }
)
data = resp.json()
print(f"{data['count']} records")
for row in data["data"][:5]:
    print(f"  {row['expiration']} {row['strike']}C  "
          f"O={row['open']} H={row['high']} L={row['low']} C={row['close']}  "
          f"vol={row['volume']}")`}
      </pre>

      {/* ── Snapshots ── */}
      <div className="eyebrow" style={{ marginBottom: 6, marginTop: 48, fontSize: 11, color: "var(--ink-soft)" }}>Options Data · Snapshots</div>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 24px" }}>
        Realtime snapshot endpoints return the <em>latest</em> state of option contracts — greeks, quotes, open interest — with a 60-second in-memory cache.
        All snapshot endpoints accept OCC symbols from <code>/v1/options/contracts</code>.
      </p>

      <div style={{
        background: "rgba(245, 158, 11, 0.08)",
        border: "1px solid rgba(245, 158, 11, 0.25)",
        borderRadius: "8px",
        padding: "16px 20px",
        marginBottom: "24px",
        display: "flex",
        gap: "14px",
        alignItems: "flex-start",
      }}>
        <div style={{ color: "#f59e0b", fontSize: 18, lineHeight: 1 }}>
          ⚠️
        </div>
        <div style={{ fontSize: 14, color: "var(--ink-muted)", lineHeight: 1.5 }}>
          <strong style={{ color: "var(--ink-strong)", display: "block", marginBottom: 4 }}>Notice: Options Caching & Availability</strong>
          To protect upstream limits and ensure ultra-low latency performance, in-memory caching is active on all option snapshot endpoints with a <strong>60-second TTL</strong>.
          Please note that historical tick-level options trades/quotes (e.g. <code>/v1/history/options/trade_quote</code>) are <strong>not supported</strong> due to strict upstream provider rate restrictions.
          Use these real-time cached snapshot endpoints for your option analysis.
        </div>
      </div>

      <h2 id="post-v1-options-snapshots" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/snapshots</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Full realtime snapshot: greeks, implied volatility, NBBO bid/ask, and last trade for each contract.
        This is the most comprehensive snapshot — use the sub-endpoints below if you only need quotes or open interest.
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/options/snapshots`} />
      <ParamTable rows={[
        { name: "symbols", type: "string",  required: true,  desc: "Comma-separated OCC option symbols (max 1000 per request)" },
        { name: "feed",    type: "string",  required: false, desc: "opra | indicative (default: opra for pro, indicative otherwise)" },
        { name: "limit",   type: "integer", required: false, desc: "1–1000 (default: 100)" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/options/snapshots \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbols":"AAPL260620C00200000","feed":"indicative"}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 40 }}>
{`// Response — snapshots keyed by OCC symbol
{
  "snapshots": {
    "AAPL260620C00200000": {
      "greeks": { "delta": 0.72, "gamma": 0.01, "theta": -0.05, "vega": 0.18, "rho": 0.09 },
      "impliedVolatility": 0.26,
      "latestQuote": { "ap": 15.80, "as": 5, "bp": 15.60, "bs": 10, "t": "2026-05-22T..." },
      "latestTrade": { "p": 15.70, "s": 1, "t": "2026-05-22T..." }
    }
  }
}`}
      </pre>

      <h2 id="post-v1-options-snapshots-quote" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/snapshots/quote</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        ThetaData-only snapshot for the latest NBBO quote of an option contract. Returns bid/ask prices, sizes, and exchanges. Use <code>feed: "thetadata"</code>.
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/options/snapshots/quote`} />
      <ParamTable rows={[
        { name: "symbols", type: "string",  required: true,  desc: "Comma-separated OCC option symbols (max 1000 per request)" },
        { name: "feed",    type: "string",  required: false, desc: "thetadata (default: opra — must set to thetadata for this endpoint)" },
        { name: "limit",   type: "integer", required: false, desc: "1–1000 (default: 100)" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/options/snapshots/quote \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbols":"AAPL260522C00110000","feed":"thetadata"}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 12 }}>
{`// Response
{
  "snapshots": {
    "AAPL260522C00110000": {
      "latestQuote": {
        "ap": 200.10, "as": 101, "ax": "9",
        "bp": 197.35, "bs": 101, "bx": "9",
        "t": "2026-05-22T15:59:59.965Z"
      }
    }
  }
}`}
      </pre>
      <h3 id="quote-python-example" style={{ fontSize: 16, fontWeight: 500, margin: "20px 0 8px", color: "var(--ink-strong)" }}>Python example — bid/ask spread</h3>
      <pre className="code" style={{ marginBottom: 40 }}>
{`import requests

resp = requests.post(
    "${REST_BASE}/v1/options/snapshots/quote",
    headers={"Authorization": "Bearer <TOKEN>"},
    json={"symbols": "AAPL260620C00200000", "feed": "thetadata"}
)
for sym, snap in resp.json()["snapshots"].items():
    q = snap["latestQuote"]
    spread = q["ap"] - q["bp"]
    print(f"{sym}  bid={q['bp']}  ask={q['ap']}  spread={spread:.2f}")`}
      </pre>

      <h2 id="post-v1-options-snapshots-open-interest" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/snapshots/open_interest</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        ThetaData-only snapshot for the latest open interest of an option contract. Returns OI count and timestamp. Use <code>feed: "thetadata"</code>.
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/options/snapshots/open_interest`} />
      <ParamTable rows={[
        { name: "symbols", type: "string",  required: true,  desc: "Comma-separated OCC option symbols (max 1000 per request)" },
        { name: "feed",    type: "string",  required: false, desc: "thetadata (default: opra — must set to thetadata for this endpoint)" },
        { name: "limit",   type: "integer", required: false, desc: "1–1000 (default: 100)" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/options/snapshots/open_interest \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbols":"AAPL260522C00110000","feed":"thetadata"}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 12 }}>
{`// Response
{
  "snapshots": {
    "AAPL260522C00110000": {
      "openInterest": {
        "oi": 5,
        "t": "2026-05-22T06:30:30.000Z"
      }
    }
  }
}`}
      </pre>
      <h3 id="oi-snapshot-python-example" style={{ fontSize: 16, fontWeight: 500, margin: "20px 0 8px", color: "var(--ink-strong)" }}>Python example — check OI for multiple contracts</h3>
      <pre className="code" style={{ marginBottom: 40 }}>
{`import requests

symbols = "AAPL260620C00200000,AAPL260620P00200000"
resp = requests.post(
    "${REST_BASE}/v1/options/snapshots/open_interest",
    headers={"Authorization": "Bearer <TOKEN>"},
    json={"symbols": symbols, "feed": "thetadata"}
)
for sym, snap in resp.json()["snapshots"].items():
    oi = snap["openInterest"]
    print(f"{sym}  OI={oi['oi']}  as_of={oi['t']}")`}
      </pre>

      <h2 id="post-v1-options-snapshots-expiry" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/snapshots/expiry</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Convenience endpoint: fetches <em>all</em> contracts for an underlying on a specific expiry date and returns their snapshots in one call.
        Internally runs <code>/v1/options/contracts</code> then batches snapshot requests (100 symbols per batch).
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/options/snapshots/expiry`} />
      <ParamTable rows={[
        { name: "underlying", type: "string", required: true,  desc: "Root ticker (e.g. AAPL)" },
        { name: "expiry",     type: "string", required: true,  desc: "Expiration date YYYY-MM-DD" },
        { name: "feed",       type: "string", required: false, desc: "opra | indicative (default: opra)" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/options/snapshots/expiry \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"underlying":"AAPL","expiry":"2026-05-22","feed":"indicative"}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 12 }}>
{`// Response
{
  "count": 42,
  "contracts": [ { "symbol": "AAPL260522C00110000", ... } ],
  "snapshots": {
    "AAPL260522C00110000": { "greeks": {...}, "latestQuote": {...} }
  }
}`}
      </pre>
      <h3 id="expiry-python-example" style={{ fontSize: 16, fontWeight: 500, margin: "20px 0 8px", color: "var(--ink-strong)" }}>Python example — scan all contracts for a Friday expiry</h3>
      <pre className="code" style={{ marginBottom: 48 }}>
{`import requests

resp = requests.post(
    "${REST_BASE}/v1/options/snapshots/expiry",
    headers={"Authorization": "Bearer <TOKEN>"},
    json={"underlying": "AAPL", "expiry": "2026-05-29", "feed": "indicative"}
)
data = resp.json()
print(f"{data['count']} contracts for AAPL 2026-05-29")
for sym, snap in data["snapshots"].items():
    g = snap.get("greeks", {})
    q = snap.get("latestQuote", {})
    print(f"  {sym}  delta={g.get('delta','—')}  bid={q.get('bp','—')}  ask={q.get('ap','—')}")`}
      </pre>

      {/* ── Crypto ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Crypto Data</div>

      <h2 id="post-v1-crypto-us-latest-orderbooks" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/crypto/us/latest/orderbooks</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Latest L2 order book snapshot for US crypto pairs. Premium tier only.
        Each side of the book is an array of <code>{"{ p: price, s: size }"}</code> objects sorted by price.
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/crypto/us/latest/orderbooks`} />
      <ParamTable rows={[
        { name: "symbols", type: "string", required: true, desc: "Comma-separated crypto pairs (e.g. BTC/USD,ETH/USD)" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/crypto/us/latest/orderbooks \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbols":"BTC/USD,ETH/USD"}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 48 }}>
{`// Response
{
  "orderbooks": {
    "BTC/USD": {
      "a": [
        { "p": 76692.1,  "s": 0.774207 },
        { "p": 76705.84, "s": 1.5678 }
      ],
      "b": [
        { "p": 76680.0,  "s": 0.5 },
        { "p": 76670.5,  "s": 1.2 }
      ]
    }
  }
}`}
      </pre>

      {/* ── Admin endpoints ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Admin endpoints</div>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 20px" }}>
        Token portal admin API. Auth uses <code>X-Admin-Token</code> header (obtained from <code>POST /api/admin/login</code>). Sessions are in-memory and reset on server restart.
      </p>

      <h2 id="post-admin-login" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /api/admin/login</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>Receive a session token for the admin panel. Password set via <code>ADMIN_PASSWORD</code> environment variable.</p>
      <EndpointBadge method="POST" path={`${TOKEN_BASE}/api/admin/login`} />
      <pre className="code" style={{ marginBottom: 28 }}>
{`// Request
{ "password": "admin123" }

// Response 200
{ "success": true, "token": "a3f9c2...64b" }

// Use in subsequent admin requests:
// X-Admin-Token: a3f9c2...64b`}
      </pre>

      <h2 id="get-admin-pending" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>GET /api/admin/pending</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>List registrations awaiting approval.</p>
      <EndpointBadge method="GET" path={`${TOKEN_BASE}/api/admin/pending`} />
      <pre className="code" style={{ marginBottom: 28 }}>
{`// Response
{ "success": true, "items": [
  { "id": "61ce4f82-...", "username": "tonnysun", "phone": "18717931119",
    "tier": "premium", "registered_at": "2026-05-19T...", "status": "pending" }
]}`}
      </pre>

      <h2 id="post-admin-approve" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /api/admin/approve</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Approve a pending registration. Writes the user to both <code>data/users.json</code> and <code>cloud-proxy/users.json</code>, issuing a token automatically.
        Returns the generated token so you can share it directly with the user.
      </p>
      <EndpointBadge method="POST" path={`${TOKEN_BASE}/api/admin/approve`} />
      <pre className="code" style={{ marginBottom: 28 }}>
{`// Request
{ "id": "61ce4f82-8b16-4e7e-be01-282730e53cc8" }

// Response 200
{
  "success": true,
  "message": "已批准 tonnysun，Token 已自动注册到 proxy。",
  "token":  "c886624f-232d-4803-99fa-f8b970e4720a",
  "expiry": "2026-06-19T14:15:57.059Z"
}`}
      </pre>

      <h2 id="post-admin-reject" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /api/admin/reject</h2>
      <EndpointBadge method="POST" path={`${TOKEN_BASE}/api/admin/reject`} />
      <pre className="code" style={{ marginBottom: 48 }}>
{`// Request
{ "id": "61ce4f82-...", "reason": "信息不完整" }

// Response 200
{ "success": true, "message": "已拒绝 tonnysun。" }`}
      </pre>

      {/* ── Reference ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Reference</div>

      <h2 id="error-codes" className="display-title" style={{ fontSize: 28, margin: "0 0 12px" }}>Error codes</h2>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 40 }}>
        <thead><tr><th style={{ width: 80 }}>Status</th><th>Body</th><th>When</th></tr></thead>
        <tbody>
          {[
            ["400", '{"error":"Missing required fields"}', "Required parameter absent or malformed JSON"],
            ["401", '{"error":"Invalid token"}', "Token missing, expired, or not in registry"],
            ["403", '{"error":"Forbidden"}', "Token valid but tier lacks permission for this endpoint"],
            ["404", '{"error":"Token not found"}', "Admin lookup: user_id not in registry"],
            ["409", '{"success":false,"message":"..."}', "Duplicate username on registration"],
            ["429", "Rate limit exceeded: N/M req/min", "REST rate limit hit; retry after 60 s"],
            ["500", '{"error":"Cloud missing Alpaca master keys"}', "Proxy misconfiguration"],
            ["503", '{"error":"ThetaData not available"}', "ThetaData client offline (open_interest / eod)"],
            ["503", '{"error":"Server overloaded, stream priority active."}', "High load; WS streams take priority"],
          ].map(([s, b, w], i) => (
            <tr key={i}>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 600 }}>{s}</td>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-base)" }}>{b}</td>
              <td style={{ fontSize: 12, color: "var(--ink-muted)" }}>{w}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="rate-limits" className="display-title" style={{ fontSize: 28, margin: "0 0 12px" }}>Rate limits</h2>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        REST limits are per-user, per rolling 60-second window. The <code>AdaptiveRateLimiter</code> tightens limits automatically when CPU &gt;80% or memory &gt;85% (overloaded) and tightens further at CPU &gt;95% or mem &gt;92% (critical).
        WebSocket symbol subscriptions are counted separately and do not reset on reconnect.
      </p>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 12 }}>
        <thead>
          <tr><th style={{ width: 150 }}>Tier</th><th>REST req/min</th><th>Under load</th><th>Critical</th><th>WS symbols</th></tr>
        </thead>
        <tbody>
          {[
            ["Premium",       "300", "150", "75",  "500"],
            ["Limited Premium","60", "30",  "15",  "20"],
            ["Basic",          "10", "5",   "2",   "10"],
          ].map(([t, r, l, c, w], i) => (
            <tr key={i}>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{t}</td>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>{r}</td>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center", color: "var(--ink-soft)" }}>{l}</td>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center", color: "var(--ink-soft)" }}>{c}</td>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>{w}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 12px" }}>
        Cached responses (X-Cache: HIT) do not count against REST rate limits. Check the <code>X-Cache</code> header — cache TTL is 5 minutes (300 s).
      </p>
      <pre className="code" style={{ marginBottom: 40 }}>
{`// 429 response body (plain text)
Rate limit exceeded: 301/300 req/min

// 503 response body (JSON) — backpressure under load
{
  "error": "Server overloaded, stream priority active. Retry later."
}
// With headers: Retry-After: 5, X-Load: high | critical, X-Priority: stream`}
      </pre>

    </div>
  );
}

function WsUsageBody() {
  const WS_BASE = `ws://${PROXY_HOST}:8765`;
  const H3 = ({ children }) => (
    <h3 style={{ fontFamily: "var(--f-sans)", fontWeight: 500, fontSize: 13, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink-muted)", margin: "32px 0 12px" }}>{children}</h3>
  );
  return (
    <div style={{ maxWidth: 760 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Realtime</div>
      <h2 id="endpoint" className="display-title" style={{ fontSize: 38, margin: "0 0 8px" }}>WebSocket connection</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 20px", maxWidth: 640 }}>
        Each channel has a dedicated path. Connect to the appropriate URL, send an <code>auth</code> message with your token, then send <code>subscribe</code> messages.
        Stocks/options/overnight/boats messages are binary MessagePack; crypto and news channels use JSON.
      </p>

      <table className="tbl card" style={{ marginBottom: 28, overflow: "hidden" }}>
        <thead><tr><th>Channel</th><th>Path</th><th>Format</th><th>Basic</th><th>Lim. Premium</th><th>Premium</th></tr></thead>
        <tbody>
          {[
            ["stocks",    "/stream",           "msgpack", "✓", "✓", "✓"],
            ["options",   "/stream/options",   "msgpack", "—", "✓", "✓"],
            ["overnight", "/stream/overnight", "msgpack", "—", "—", "✓"],
            ["crypto",    "/stream/crypto",    "JSON",    "—", "—", "✓"],
            ["news",      "/stream/news",      "JSON",    "✓", "—", "✓"],
            ["boats",     "/stream/boats",     "msgpack", "—", "—", "✓"],
          ].map(([ch, path, fmt, b, l, p], i) => (
            <tr key={i}>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 600 }}>{ch}</td>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>{path}</td>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)" }}>{fmt}</td>
              <td style={{ color: b === "✓" ? "var(--ok)" : "var(--ink-soft)", fontFamily: "var(--f-mono)", textAlign: "center" }}>{b}</td>
              <td style={{ color: l === "✓" ? "var(--ok)" : "var(--ink-soft)", fontFamily: "var(--f-mono)", textAlign: "center" }}>{l}</td>
              <td style={{ color: p === "✓" ? "var(--ok)" : "var(--ink-soft)", fontFamily: "var(--f-mono)", textAlign: "center" }}>{p}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Connecting ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Connecting</div>
      <h2 id="auth-message" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Auth message</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        After opening the WebSocket, send an <code>auth</code> action. Authentication happens in the message body — no HTTP headers are needed.
      </p>
      <pre className="code" style={{ marginBottom: 12 }}>
{`import asyncio, websockets, json, msgpack

async def stream_stocks(token):
    uri = "${WS_BASE}/stream"        # stocks channel
    async with websockets.connect(uri) as ws:

        # 1. Authenticate
        await ws.send(json.dumps({"action": "auth", "token": token}))
        auth_resp = msgpack.unpackb(await ws.recv())
        # auth_resp → [{"T": "success", "msg": "authenticated"}]

        # 2. Subscribe
        await ws.send(json.dumps({
            "action": "subscribe",
            "trades": ["AAPL", "TSLA", "NVDA"],
            "quotes": ["AAPL"],
            "bars":   []
        }))

        # 3. Receive
        async for raw in ws:
            msgs = msgpack.unpackb(raw)   # list of message dicts
            for msg in msgs:
                print(msg)

asyncio.run(stream_stocks("YOUR_TOKEN"))`}
      </pre>
      <pre className="code" style={{ marginBottom: 28 }}>
{`# For crypto/news channels — same pattern but JSON instead of msgpack
uri = "${WS_BASE}/stream/news"
await ws.send(json.dumps({"action": "auth", "token": token}))
auth_resp = json.loads(await ws.recv())   # JSON response

await ws.send(json.dumps({
    "action": "subscribe",
    "news": ["AAPL", "*"]    # "*" subscribes to all symbols
}))`}
      </pre>

      <h2 id="heartbeat" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Heartbeat</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>
        The server sends WebSocket ping frames automatically. Most client libraries respond to pings automatically. If your client does not, call <code>pong()</code> on receipt to stay connected.
        The server will close connections that exceed the send queue limit (200 messages).
      </p>

      {/* ── Channels ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Channels</div>

      <h2 id="stocks" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>stocks</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Live US equities: trades, quotes, and minute bars from the SIP feed (pro account). Subscribe to <code>trades</code>, <code>quotes</code>, and/or <code>bars</code> lists.
        Use <code>"*"</code> to subscribe to all symbols.
      </p>
      <H3>Symbol limit</H3>
      <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: "0 0 12px" }}>basic: 10 · limited_premium: 20 · premium: 500. Exceeding the limit returns an error message and the subscribe is rejected.</p>

      <h2 id="options" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>options</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Live OPRA options feed. Subscribe using OCC symbols in the <code>trades</code> and <code>quotes</code> lists.
        Limited Premium and Premium only.
      </p>

      <h2 id="crypto" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>crypto</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Live US crypto orderbooks and trades. Subscribe using <code>orderbooks</code> and/or <code>trades</code> lists with pairs like <code>BTC/USD</code>.
        Messages are plain JSON (not msgpack). Premium only.
      </p>
      <pre className="code" style={{ marginBottom: 24 }}>
{`await ws.send(json.dumps({
    "action": "subscribe",
    "orderbooks": ["BTC/USD", "ETH/USD"],
    "trades":     ["BTC/USD"]
}))`}
      </pre>

      <h2 id="news" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>news</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Realtime news events from Benzinga. Subscribe with a <code>news</code> list of tickers or <code>"*"</code> for all.
        Messages are plain JSON. Available to Basic and Premium (not Limited Premium).
      </p>

      <h2 id="overnight" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>overnight</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>
        Extended-hours equity data. Same subscribe format as stocks (trades + quotes). Premium only.
      </p>

      {/* ── Messages ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Messages</div>

      <h2 id="subscribe" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Subscribe / Unsubscribe</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Subscribe and unsubscribe actions share the same shape — only the <code>action</code> field differs.
        You can update subscriptions incrementally; each call adds or removes the listed symbols.
      </p>
      <pre className="code" style={{ marginBottom: 24 }}>
{`// Subscribe
{ "action": "subscribe",   "trades": ["AAPL"], "quotes": ["AAPL", "TSLA"], "bars": [] }

// Unsubscribe
{ "action": "unsubscribe", "trades": ["AAPL"], "quotes": [], "bars": [] }

// Subscription confirmation (returned after each subscribe/unsubscribe)
[{ "T": "subscription", "trades": ["AAPL"], "quotes": ["AAPL","TSLA"], "bars": [] }]`}
      </pre>

      <h2 id="trade" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Trade</h2>
      <pre className="code" style={{ marginBottom: 24 }}>
{`{
  "T": "t",                         // message type: trade
  "S": "AAPL",                      // symbol
  "p": 214.37,                      // price
  "s": 100,                         // size (shares)
  "t": "2026-05-22T14:08:12.482Z",  // timestamp
  "x": "NASDAQ",                    // exchange
  "c": ["@", "T"],                  // trade conditions
  "z": "C"                          // tape
}`}
      </pre>

      <h2 id="quote" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Quote</h2>
      <pre className="code" style={{ marginBottom: 24 }}>
{`{
  "T":  "q",                         // message type: quote
  "S":  "AAPL",
  "ax": "NASDAQ", "ap": 214.40, "as": 200,   // ask exchange, price, size
  "bx": "NYSE",   "bp": 214.35, "bs": 500,   // bid exchange, price, size
  "t":  "2026-05-22T14:08:12.522Z",
  "c":  ["R"],                       // quote conditions
  "z":  "C"
}`}
      </pre>

      <h2 id="bar" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Bar</h2>
      <pre className="code" style={{ marginBottom: 48 }}>
{`{
  "T":  "b",                         // message type: bar (minute)
  "S":  "AAPL",
  "o":  214.20,  "h": 214.50,  "l": 214.10,  "c": 214.37,
  "v":  128400,                      // volume
  "vw": 214.33,                      // VWAP
  "n":  843,                         // trade count
  "t":  "2026-05-22T14:08:00Z"       // bar open time
}`}
      </pre>

      {/* ── Operations ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Operations</div>

      <h2 id="reconnect" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Reconnect</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        The server may close the connection on overload (<code>code 1013</code>) or policy violation (<code>code 1008</code>).
        Implement exponential backoff. Subscriptions are not persisted — re-auth and re-subscribe after every reconnect.
      </p>
      <pre className="code" style={{ marginBottom: 28 }}>
{`import asyncio, websockets, json, msgpack

async def with_reconnect(token, uri, handler, backoff=1):
    while True:
        try:
            async with websockets.connect(uri) as ws:
                await ws.send(json.dumps({"action": "auth", "token": token}))
                await ws.recv()                          # auth response
                await ws.send(json.dumps({               # re-subscribe
                    "action": "subscribe",
                    "trades": ["AAPL", "TSLA"]
                }))
                await handler(ws)
        except (websockets.ConnectionClosed, OSError):
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)`}
      </pre>

      <h2 id="backpressure" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Backpressure</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Each client has an outbound queue of 200 messages. If your consumer is too slow to drain it, newer messages are dropped and a drop counter is incremented server-side (visible in admin stats).
        Under system load (<code>X-Load: high</code>), REST endpoints are throttled or rejected to protect stream delivery — WS is always served first.
      </p>
      <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 40px" }}>
        Best practice: process each message quickly (or offload to a queue) rather than doing heavy work inside the receive loop.
      </p>
    </div>
  );
}

window.DocsSite = DocsSite;
