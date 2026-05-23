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
        <span className="pill"><span className="live"></span> v2.5 · live</span>
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

  let isEmbedded = false;
  try {
    isEmbedded = window.self !== window.top;
  } catch (e) {
    isEmbedded = true;
  }

  return (
    <div className="proxy-app" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {!isEmbedded && <DocsTopbar active={tab} />}

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
          <Tab id="proxy" tab={tab} setTab={setTab} label="Proxy API" count="45+ endpoints" />
          <Tab id="ws" tab={tab} setTab={setTab} label="WS usage" count="6 channels" />
          <div style={{ flex: 1 }}></div>
          <div style={{ alignSelf: "flex-end", paddingBottom: 10, color: "var(--ink-soft)", fontFamily: "var(--f-mono)", fontSize: 11 }}>
            last sync · 2026-05-23 dual-provider
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
  const [expanded, setExpanded] = React.useState({
    "Stock Data": true,
    "Multi-symbol": true,
    "Metadata": true,
    "Single symbol": true,
    "Options Data": true,
    "Snapshots": true,
  });
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
    { title: "Token API", items: ["register", "check-status", "generate-token"] },
    { title: "REST History", items: ["history/bars", "history/news"] },
    { title: "Stock Data", items: ["overview"], children: [
      { title: "Multi-symbol", items: ["auctions", "multi bars", "multi latest bars", "multi quotes", "multi latest quotes", "multi snapshots", "multi trades", "multi latest trades"] },
      { title: "Metadata", items: ["condition codes", "exchange codes"] },
      { title: "Single symbol", items: ["single bars", "single latest bar", "single quotes", "single latest quote", "single snapshot", "single trades", "single latest trade"] },
    ]},
    { title: "Options Data", items: ["provider model", "contracts"], children: [
      { title: "Snapshots", items: ["snapshots", "quote", "snapshot trade", "open interest", "expiry", "snapshot ohlc"] },
      { title: "History", items: ["bars", "eod", "history open interest", "trades", "history ohlc"] },
      { title: "ThetaData Value", items: ["direct endpoints"] },
    ]},
    { title: "Crypto Data", items: ["orderbooks"] },
    { title: "Admin endpoints", items: ["login", "pending", "approve", "reject"] },
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
    const hasItems    = s.items && s.items.length > 0;
    const isParent    = hasChildren || hasItems;
    const isOpen      = expanded[s.title] !== false;
    const isMono      = s.title.includes("endpoints") || s.title === "Messages";

    const BASE_PAD    = 10;
    const INDENT_STEP = 20;
    const indent      = BASE_PAD + depth * INDENT_STEP;

    // Map sidebar labels to actual document IDs
    const ID_MAP = {'Overview': 'overview', 'Authentication': 'authentication', 'Tiers & permissions': 'tiers-permissions', 'register': 'post-register', 'check-status': 'post-check-status', 'generate-token': 'post-generate-token', 'history/bars': 'post-v1-history-bars', 'history/news': 'post-v1-history-news', 'overview': 'stock-data-availability', 'auctions': 'stock-auctions', 'multi bars': 'stock-bars', 'multi latest bars': 'stock-latest-bars', 'condition codes': 'stock-condition-codes', 'exchange codes': 'stock-exchange-codes', 'multi quotes': 'stock-quotes', 'multi latest quotes': 'stock-latest-quotes', 'multi snapshots': 'stock-snapshots', 'multi trades': 'stock-trades', 'multi latest trades': 'stock-latest-trades', 'single bars': 'stock-single-bars', 'single latest bar': 'stock-single-latest-bar', 'single quotes': 'stock-single-quotes', 'single latest quote': 'stock-single-latest-quote', 'single snapshot': 'stock-single-snapshot', 'single trades': 'stock-single-trades', 'single latest trade': 'stock-single-latest-trade', 'provider model': 'provider-fallback-cache', 'contracts': 'post-v1-options-contracts', 'snapshots': 'post-v1-options-snapshots', 'quote': 'post-v1-options-snapshots-quote', 'snapshot trade': 'post-v1-options-snapshots-trade', 'open interest': 'post-v1-options-snapshots-open-interest', 'expiry': 'post-v1-options-snapshots-expiry', 'snapshot ohlc': 'post-v3-option-direct-value', 'bars': 'post-v1-history-options-bars', 'eod': 'post-v1-history-options-eod', 'history open interest': 'post-v1-options-open-interest', 'trades': 'post-v1-history-options-trades', 'history ohlc': 'post-v3-option-direct-value', 'direct endpoints': 'post-v3-option-direct-value', 'orderbooks': 'post-v1-crypto-us-latest-orderbooks', 'login': 'post-admin-login', 'pending': 'get-admin-pending', 'approve': 'post-admin-approve', 'reject': 'post-admin-reject', 'Error codes': 'error-codes', 'Rate limits': 'rate-limits'};
    const getId = (label) => ID_MAP[label] || slugify(label);

    return (
      <div style={{ marginBottom: hasChildren ? 0 : 8 }}>
        {/* ── header row (chevron right-aligned like the reference) ── */}
        <div
          onClick={() => isParent && toggle(s.title)}
          style={{
            display: "flex", alignItems: "center",
            padding: "5px 10px 5px " + indent,
            cursor: isParent ? "pointer" : "default",
            color: depth === 0 ? "var(--ink-strong)" : "var(--ink-soft)",
            fontSize: 11,
            fontWeight: depth === 0 ? 700 : 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            userSelect: "none",
          }}
        >
          <span style={{ flex: 1 }}>{s.title}</span>
          {isParent && <Chevron open={isOpen} />}
        </div>

        {/* ── children + guide lines ── */}
        {isOpen && (
          <>
            {/* vertical guide line for this group */}
            {isParent && (
              <div style={{
                position: "relative",
                marginLeft: indent + 8,
                paddingLeft: 12,
                borderLeft: "1px solid var(--rule)",
              }}>
                {/* leaf items */}
                {hasItems && (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    {s.items.map((it, j) => (
                      <li key={j}>
                        <a href={"#" + getId(it)} style={{
                          textDecoration: "none", display: "block",
                          padding: "3px 0",
                          color: activeId === getId(it) ? "var(--ink-strong)" : "var(--ink-muted)",
                          fontWeight: activeId === getId(it) ? 500 : 400,
                          fontFamily: isMono ? "var(--f-mono)" : "var(--f-sans)",
                          fontSize: isMono ? 12 : 13,
                        }}>{it}</a>
                      </li>
                    ))}
                  </ul>
                )}

                {/* nested sub-sections */}
                {hasChildren && s.children.map((child, k) => (
                  <Section key={k} s={child} depth={depth + 1} />
                ))}
              </div>
            )}
          </>
        )}
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
        <a href="register.html" className="btn" style={{ width: "100%", justifyContent: "center", fontSize: 12, textDecoration: "none" }}>
          Open portal →
        </a>
      </div>
    </aside>
  );
}

const PROXY_HOST = "52.37.182.24";
const REST_BASE  = `http://${PROXY_HOST}:8768`;
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

const STOCK_COMMON = {
  symbols: { name: "symbols", type: "string", required: true, desc: "Comma-separated symbols, e.g. AAPL,MSFT" },
  symbolPath: { name: "symbol", type: "path", required: true, desc: "Single ticker in the URL path, e.g. AAPL" },
  start: { name: "start", type: "string", required: true, desc: "Inclusive start time/date. ISO 8601 recommended." },
  end: { name: "end", type: "string", required: true, desc: "Exclusive end time/date. ISO 8601 recommended." },
  feed: { name: "feed", type: "string", required: false, desc: "iex is safest by default; sip/delayed_sip/boats/overnight/otc depend on endpoint and entitlement." },
  limit: { name: "limit", type: "integer", required: false, desc: "Page size. Use next_page_token for pagination when returned." },
  pageToken: { name: "page_token", type: "string", required: false, desc: "Pagination token from the previous response." },
  timeframe: { name: "timeframe", type: "string", required: true, desc: "1Min, 5Min, 15Min, 30Min, 1Hour, 1Day, etc." },
  sort: { name: "sort", type: "string", required: false, desc: "asc or desc for historical tick endpoints." },
  tape: { name: "tape", type: "string", required: true, desc: "Tape A, B, or C. Example: tape=C for Nasdaq-listed symbols." },
};

const STOCK_ENDPOINT_GROUPS = [
  {
    title: "Multi-symbol market data",
    intro: "Batch endpoints for querying one or more stock symbols in one request.",
    endpoints: [
      {
        id: "stock-auctions",
        title: "Historical Auctions",
        route: "/v2/stocks/auctions",
        examplePath: "/v2/stocks/auctions?symbols=AAPL&start=2026-05-20&end=2026-05-21&limit=1&feed=sip",
        desc: "Auction prices for one or more stocks. Use this when you need official auction prints rather than continuous trade ticks.",
        zh: "查询一个或多个股票的历史 auction 数据。适合需要开盘/收盘 auction print 的场景。",
        params: [STOCK_COMMON.symbols, STOCK_COMMON.start, STOCK_COMMON.end, { ...STOCK_COMMON.feed, desc: "Alpaca supports SIP feed for auctions." }, STOCK_COMMON.limit, STOCK_COMMON.pageToken],
        keys: ["auctions", "next_page_token"],
        tested: "200 alpaca MISS",
      },
      {
        id: "stock-bars",
        title: "Historical Bars",
        route: "/v2/stocks/bars",
        examplePath: "/v2/stocks/bars?symbols=AAPL&timeframe=1Day&start=2026-05-20&end=2026-05-21&limit=1&feed=iex",
        desc: "Historical OHLCV bars for multiple symbols.",
        zh: "多股票历史 OHLCV K 线。",
        params: [STOCK_COMMON.symbols, STOCK_COMMON.timeframe, STOCK_COMMON.start, STOCK_COMMON.end, STOCK_COMMON.feed, { name: "adjustment", type: "string", required: false, desc: "raw, split, dividend, or all." }, STOCK_COMMON.limit, STOCK_COMMON.pageToken],
        keys: ["bars", "next_page_token"],
        tested: "200 alpaca MISS",
      },
      {
        id: "stock-latest-bars",
        title: "Latest Bars",
        route: "/v2/stocks/bars/latest",
        examplePath: "/v2/stocks/bars/latest?symbols=AAPL&feed=iex",
        desc: "Most recent minute bar for multiple symbols.",
        zh: "多股票最新分钟 K 线。",
        params: [STOCK_COMMON.symbols, STOCK_COMMON.feed],
        keys: ["bars"],
        tested: "200 alpaca MISS",
      },
      {
        id: "stock-quotes",
        title: "Historical Quotes",
        route: "/v2/stocks/quotes",
        examplePath: "/v2/stocks/quotes?symbols=AAPL&start=2026-05-20T13:30:00Z&end=2026-05-20T14:00:00Z&limit=1&feed=iex",
        desc: "Historical bid/ask quote ticks for multiple symbols.",
        zh: "多股票历史 bid/ask quote ticks。",
        params: [STOCK_COMMON.symbols, STOCK_COMMON.start, STOCK_COMMON.end, STOCK_COMMON.feed, STOCK_COMMON.limit, STOCK_COMMON.sort, STOCK_COMMON.pageToken],
        keys: ["quotes", "next_page_token"],
        tested: "200 alpaca MISS",
      },
      {
        id: "stock-latest-quotes",
        title: "Latest Quotes",
        route: "/v2/stocks/quotes/latest",
        examplePath: "/v2/stocks/quotes/latest?symbols=AAPL&feed=iex",
        desc: "Latest quote for multiple symbols.",
        zh: "多股票最新报价。",
        params: [STOCK_COMMON.symbols, STOCK_COMMON.feed],
        keys: ["quotes"],
        tested: "200 alpaca MISS; repeat DISK_HIT",
      },
      {
        id: "stock-snapshots",
        title: "Snapshots",
        route: "/v2/stocks/snapshots",
        examplePath: "/v2/stocks/snapshots?symbols=AAPL&feed=iex",
        desc: "Composite latest state: latest trade, latest quote, minute bar, daily bar, and previous daily bar.",
        zh: "股票综合快照：最新成交、最新报价、分钟 K、日 K、前一日 K。",
        params: [STOCK_COMMON.symbols, STOCK_COMMON.feed],
        keys: ["AAPL"],
        tested: "200 alpaca MISS",
      },
      {
        id: "stock-trades",
        title: "Historical Trades",
        route: "/v2/stocks/trades",
        examplePath: "/v2/stocks/trades?symbols=AAPL&start=2026-05-20T13:30:00Z&end=2026-05-20T14:00:00Z&limit=1&feed=iex",
        desc: "Historical trade ticks for multiple symbols.",
        zh: "多股票历史逐笔成交。",
        params: [STOCK_COMMON.symbols, STOCK_COMMON.start, STOCK_COMMON.end, STOCK_COMMON.feed, STOCK_COMMON.limit, STOCK_COMMON.sort, STOCK_COMMON.pageToken],
        keys: ["trades", "next_page_token"],
        tested: "200 alpaca MISS",
      },
      {
        id: "stock-latest-trades",
        title: "Latest Trades",
        route: "/v2/stocks/trades/latest",
        examplePath: "/v2/stocks/trades/latest?symbols=AAPL&feed=iex",
        desc: "Latest trade for multiple symbols.",
        zh: "多股票最新成交。",
        params: [STOCK_COMMON.symbols, STOCK_COMMON.feed],
        keys: ["trades"],
        tested: "200 alpaca MISS",
      },
    ],
  },
  {
    title: "Reference metadata",
    intro: "Lookup tables for translating stock market data condition and exchange codes.",
    endpoints: [
      {
        id: "stock-condition-codes",
        title: "Condition Codes",
        route: "/v2/stocks/meta/conditions/{ticktype}",
        examplePath: "/v2/stocks/meta/conditions/trade?tape=C",
        desc: "Maps condition code values to readable descriptions for trade or quote ticks.",
        zh: "将成交/报价条件代码映射为可读说明。",
        params: [{ name: "ticktype", type: "path", required: true, desc: "trade or quote." }, STOCK_COMMON.tape],
        keys: ["1", "4", "5", "6", "7", "8", "9", "@"],
        tested: "200 alpaca MISS",
      },
      {
        id: "stock-exchange-codes",
        title: "Exchange Codes",
        route: "/v2/stocks/meta/exchanges",
        examplePath: "/v2/stocks/meta/exchanges",
        desc: "Maps exchange code values to readable venue names.",
        zh: "将交易所代码映射为可读交易场所名称。",
        params: [],
        keys: ["A", "B", "C", "D", "E", "H", "I", "J"],
        tested: "200 alpaca MISS",
      },
    ],
  },
  {
    title: "Single-symbol market data",
    intro: "Same data families as the batch endpoints, but scoped to one ticker in the URL path.",
    endpoints: [
      {
        id: "stock-single-bars",
        title: "Historical Bars, Single Symbol",
        route: "/v2/stocks/{symbol}/bars",
        examplePath: "/v2/stocks/AAPL/bars?timeframe=1Day&start=2026-05-20&end=2026-05-21&limit=1&feed=iex",
        desc: "Historical OHLCV bars for one stock.",
        zh: "单只股票历史 OHLCV K 线。",
        params: [STOCK_COMMON.symbolPath, STOCK_COMMON.timeframe, STOCK_COMMON.start, STOCK_COMMON.end, STOCK_COMMON.feed, STOCK_COMMON.limit, STOCK_COMMON.pageToken],
        keys: ["bars", "next_page_token", "symbol"],
        tested: "200 alpaca MISS",
      },
      {
        id: "stock-single-latest-bar",
        title: "Latest Bar, Single Symbol",
        route: "/v2/stocks/{symbol}/bars/latest",
        examplePath: "/v2/stocks/AAPL/bars/latest?feed=iex",
        desc: "Latest minute bar for one stock.",
        zh: "单只股票最新分钟 K 线。",
        params: [STOCK_COMMON.symbolPath, STOCK_COMMON.feed],
        keys: ["bar", "symbol"],
        tested: "200 alpaca MISS",
      },
      {
        id: "stock-single-quotes",
        title: "Historical Quotes, Single Symbol",
        route: "/v2/stocks/{symbol}/quotes",
        examplePath: "/v2/stocks/AAPL/quotes?start=2026-05-20T13:30:00Z&end=2026-05-20T14:00:00Z&limit=1&feed=iex",
        desc: "Historical quote ticks for one stock.",
        zh: "单只股票历史报价 ticks。",
        params: [STOCK_COMMON.symbolPath, STOCK_COMMON.start, STOCK_COMMON.end, STOCK_COMMON.feed, STOCK_COMMON.limit, STOCK_COMMON.sort, STOCK_COMMON.pageToken],
        keys: ["quotes", "next_page_token", "symbol"],
        tested: "200 alpaca MISS",
      },
      {
        id: "stock-single-latest-quote",
        title: "Latest Quote, Single Symbol",
        route: "/v2/stocks/{symbol}/quotes/latest",
        examplePath: "/v2/stocks/AAPL/quotes/latest?feed=iex",
        desc: "Latest quote for one stock.",
        zh: "单只股票最新报价。",
        params: [STOCK_COMMON.symbolPath, STOCK_COMMON.feed],
        keys: ["quote", "symbol"],
        tested: "200 alpaca MISS",
      },
      {
        id: "stock-single-snapshot",
        title: "Snapshot, Single Symbol",
        route: "/v2/stocks/{symbol}/snapshot",
        examplePath: "/v2/stocks/AAPL/snapshot?feed=iex",
        desc: "Composite latest state for one stock.",
        zh: "单只股票综合快照。",
        params: [STOCK_COMMON.symbolPath, STOCK_COMMON.feed],
        keys: ["dailyBar", "latestQuote", "latestTrade", "minuteBar", "prevDailyBar", "symbol"],
        tested: "200 alpaca MISS",
      },
      {
        id: "stock-single-trades",
        title: "Historical Trades, Single Symbol",
        route: "/v2/stocks/{symbol}/trades",
        examplePath: "/v2/stocks/AAPL/trades?start=2026-05-20T13:30:00Z&end=2026-05-20T14:00:00Z&limit=1&feed=iex",
        desc: "Historical trade ticks for one stock.",
        zh: "单只股票历史逐笔成交。",
        params: [STOCK_COMMON.symbolPath, STOCK_COMMON.start, STOCK_COMMON.end, STOCK_COMMON.feed, STOCK_COMMON.limit, STOCK_COMMON.sort, STOCK_COMMON.pageToken],
        keys: ["trades", "next_page_token", "symbol"],
        tested: "200 alpaca MISS",
      },
      {
        id: "stock-single-latest-trade",
        title: "Latest Trade, Single Symbol",
        route: "/v2/stocks/{symbol}/trades/latest",
        examplePath: "/v2/stocks/AAPL/trades/latest?feed=iex",
        desc: "Latest trade for one stock.",
        zh: "单只股票最新成交。",
        params: [STOCK_COMMON.symbolPath, STOCK_COMMON.feed],
        keys: ["trade", "symbol"],
        tested: "200 alpaca MISS",
      },
    ],
  },
];

function StockEndpointSection({ endpoint }) {
  return (
    <section style={{ marginBottom: 42 }}>
      <h2 id={endpoint.id} className="display-title" style={{ fontSize: 24, margin: "0 0 8px" }}>{endpoint.title}</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        {endpoint.desc}
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>{endpoint.zh}</span>
      </p>
      <EndpointBadge method="GET" path={`${REST_BASE}${endpoint.route}`} />
      {endpoint.params.length > 0 ? <ParamTable rows={endpoint.params} /> : (
        <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 20px" }}>No query parameters are required.</p>
      )}
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}${endpoint.examplePath}"`}
      </pre>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: 0 }}>
        Live test: <code>{endpoint.tested}</code>. Response top-level keys observed: <code>{endpoint.keys.join(", ")}</code>.
      </p>
    </section>
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
        and a <strong style={{ color: "var(--ink-strong)" }}>data proxy</strong> (port 8768 REST / 8767 WS) for market data.
        Once you have a token, use it to call historical and realtime endpoints without managing your own Alpaca / ThetaData credentials.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>股票期权代理包含两个服务面：Token 门户（3000端口）用于注册和签发，数据代理（8768 REST / 8767 WS）用于行情数据。</span>
      </p>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 40 }}>
        <thead><tr><th>Surface</th><th>URL</th><th>Auth</th></tr></thead>
        <tbody>
          <tr><td>Token portal</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{TOKEN_BASE}</td><td style={{ fontSize: 12 }}>username + phone</td></tr>
          <tr><td>REST data proxy</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{REST_BASE}</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>Bearer &lt;token&gt;</td></tr>
          <tr><td>WS data proxy</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{`ws://${PROXY_HOST}:8767`}</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>auth message</td></tr>
        </tbody>
      </table>

      <h2 id="authentication" className="display-title" style={{ fontSize: 28, margin: "0 0 12px" }}>Authentication</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        All data endpoints (REST and WS) require a UUID token. Pass it as an HTTP header or in the JSON body:
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>所有数据接口（REST 和 WS）都需要 UUID Token，可通过 HTTP Header 或 JSON Body 传递。</span>
      </p>
      <pre className="code" style={{ marginBottom: 12 }}>
{`# Option A — Authorization header (preferred)
Authorization: Bearer c88662...720a

# Option B — token field in request body
{ "token": "c886624f-232d-4803-99fa-f8b970e4720a", "symbol": "AAPL", ... }`}
      </pre>
      <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: "0 0 40px" }}>
        Tokens expire 30 days after issuance. The proxy returns <code>401</code> for invalid or expired tokens and <code>403</code> if your tier lacks permission for the endpoint.
      </p>

      <h2 id="tiers-permissions" className="display-title" style={{ fontSize: 28, margin: "0 0 16px" }}>Tiers &amp; permissions</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Four plans control access to channels, symbols, rate limits, and REST endpoints.
        <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>四个套餐等级控制通道、标的、限速和接口权限。</span>
      </p>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 12 }}>
        <thead>
          <tr><th style={{ width: 120 }}>Plan</th><th>Price</th><th>WS channels</th><th>WS symbols</th><th>REST req/min</th><th>REST endpoints</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="tier premium">Premium</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>$130/mo</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>stocks · options · contract · crypto · news · overnight</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>500</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>300</td>
            <td style={{ fontSize: 12 }}>All endpoints including crypto orderbooks</td>
          </tr>
          <tr>
            <td><span className="tier standard">Standard</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>$80/mo</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>stocks · options · contract</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>50</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>60</td>
            <td style={{ fontSize: 12 }}>history/bars, options/*, news history excluded, no crypto</td>
          </tr>
          <tr>
            <td><span className="tier trial">Trial</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>$30/3 days</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>stocks · options · contract</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>50</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>60</td>
            <td style={{ fontSize: 12 }}>Same as Standard · 3-day token · non-renewable</td>
          </tr>
          <tr>
            <td><span className="tier basic">Basic</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>$40/mo</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>— (REST only)</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>—</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>10</td>
            <td style={{ fontSize: 12 }}>Bulk download · history · snapshots · no realtime</td>
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 40px" }}>
        Rate limits tighten automatically under load: limits halve when server is overloaded and quarter under critical load. WebSocket delivery is always prioritised over REST.
      </p>

      {/* ── Token API ── */}
      <div className="eyebrow" style={{ marginBottom: 10, marginTop: 48 }}>Token API</div>

      <h2 id="post-register" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /api/register</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>Submit a new account registration. The request enters a pending queue until approved by an admin.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>提交新账户注册申请，请求将进入待审核队列等待管理员审批。</span>
      </p>
      <EndpointBadge method="POST" path={`${TOKEN_BASE}/api/register`} />
      <ParamTable rows={[
        { name: "username", type: "string", required: true, desc: "Unique display name (must not exist in approved users)" },
        { name: "phone",    type: "string", required: true, desc: "Mobile number used to verify identity on token generation" },
        { name: "tier",     type: "string", required: false, desc: "premium | standard | trial | basic (default: premium)." },
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
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>Poll approval status before attempting token generation.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>在尝试生成 Token 前查询账户审批状态。</span>
      </p>
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
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>用已审批的凭据换取 30 天有效期的 UUID Token。若该用户已有 Token 则直接返回，不会重新生成。</span>
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
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>获取美股历史 OHLCV K线数据。支持自动分页，结果缓存 5 分钟。数据源：Alpaca SIP。</span>
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
  -H "Authorization: Bearer *** \\
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
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>获取历史新闻文章。来源：Benzinga via Alpaca。所有套餐可用。支持自动分页，每页最多 50 篇。</span>
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
  -H "Authorization: Bearer *** \\
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

      {/* ── Stock Data ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Stock Data</div>

      <h2 id="stock-data-availability" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Alpaca stock data availability</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        All native Alpaca stock market-data endpoints below are exposed as authenticated <code>GET</code> routes under <code>{REST_BASE}/v2/stocks/*</code>.
        The proxy keeps the Alpaca response shape, strips proxy credentials from cache keys, and returns <code>X-Provider: alpaca</code>.
        Feed availability still follows the upstream entitlement: <code>iex</code> is the safest default; <code>sip</code>, <code>delayed_sip</code>, <code>boats</code>, <code>overnight</code>, and <code>otc</code> depend on the requested endpoint and subscription.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>以下股票数据接口均按 Alpaca native GET 路径开放。响应结构保持 Alpaca 原样，鉴权和服务端缓存由代理统一处理。</span>
      </p>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 28px" }}>
        Live smoke-tested on 2026-05-23: every endpoint in this section returned <code>200</code> through the native provider path. Repeated latest/snapshot calls return <code>X-Cache: DISK_HIT</code> when served from cache.
      </p>

      {STOCK_ENDPOINT_GROUPS.map((group, gi) => (
        <div key={group.title} style={{ marginBottom: gi === STOCK_ENDPOINT_GROUPS.length - 1 ? 48 : 28 }}>
          <h3 id={slugify(group.title)} style={{ fontSize: 17, fontWeight: 500, margin: "0 0 8px", color: "var(--ink-strong)" }}>{group.title}</h3>
          <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: "0 0 20px" }}>{group.intro}</p>
          {group.endpoints.map(endpoint => <StockEndpointSection key={endpoint.id} endpoint={endpoint} />)}
        </div>
      ))}

      {/* ── Provider Data ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Provider Data</div>

      <h2 id="provider-fallback-cache" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Provider routes and server-side cache</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Native provider routes share one proxy layer for auth, permissions, rate limits, credential stripping, and server-side caching.
        Alpaca data routes are available as native HTTP endpoints; ThetaData Value option routes are exposed only for the covered Value endpoints.
        Wrapper endpoints such as <code>/v1/history/options/bars</code> still provide higher-level fallback behavior.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>原生数据源路径统一走同一层代理：鉴权、权限、限流、参数清洗和服务端缓存一致；业务友好接口继续提供 fallback。</span>
      </p>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 20 }}>
        <thead><tr><th>Provider surface</th><th>Route family</th><th>Behavior</th></tr></thead>
        <tbody>
          {[
            ["Alpaca stocks", "/v2/stocks/*", "Native stock auctions, bars, trades, quotes, latest data, snapshots, and metadata."],
            ["Alpaca crypto", "/v1beta3/crypto/* and /v1beta1/crypto-perps/*", "Native crypto bars, trades, quotes, latest data, and orderbooks."],
            ["Alpaca options", "/v1beta1/options/*", "Native option bars, historical trades, latest quotes/trades, snapshots, and option-chain snapshots. Historical option data starts 2024-02-01."],
            ["Alpaca news", "/v1beta1/news*", "Native news endpoint family."],
            ["Alpaca option contracts", "/v2/options/contracts*", "Native option contract metadata."],
            ["Option bars", "/v1/history/options/bars", "ThetaData OHLC first, Alpaca bars fallback. provider=thetadata disables Alpaca fallback; provider=alpaca skips ThetaData."],
            ["Contracts", "/v1/options/contracts", "Alpaca contracts first, ThetaData Value contracts fallback when Alpaca is unavailable. provider=thetadata requires underlying_symbols."],
            ["Full snapshots / greeks / IV", "/v1/options/snapshots", "Alpaca only because ThetaData Value does not include greeks, IV, or market value."],
            ["Quote / trade snapshots", "/v1/options/snapshots/quote and /v1/options/snapshots/trade", "Alpaca latest quote/trade first; response is normalized under snapshots[OCC].latestQuote/latestTrade."],
            ["OI / OHLC snapshots", "/v1/options/snapshots/open_interest and /v3/option/snapshot/*", "ThetaData-backed where Value permits open_interest and OHLC snapshots."],
            ["ThetaData Value options", "/v3/option/*", "Exact ThetaData Value whitelist only, JSON response, no Alpaca fallback."],
          ].map(([area, route, behavior], i) => (
            <tr key={i}>
              <td style={{ fontSize: 12, color: "var(--ink-strong)" }}>{area}</td>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>{route}</td>
              <td style={{ fontSize: 12, color: "var(--ink-muted)" }}>{behavior}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 40px" }}>
        Successful REST responses are cached server-side.
        Cache keys strip proxy credentials, return <code>X-Cache: DISK_HIT</code> on repeat, and use tiered TTLs: historical 7 days, intraday/latest 60 seconds, snapshots 5 minutes, contracts/lists 1 hour.
        ThetaData Value does <strong>not</strong> expose direct option trades, trade_quote, market value, implied volatility, or greeks.
      </p>
      <h3 id="alpaca-native-examples" style={{ fontSize: 16, fontWeight: 500, margin: "0 0 8px", color: "var(--ink-strong)" }}>Native Alpaca examples</h3>
      <pre className="code" style={{ marginBottom: 40 }}>
{`# Latest stock quote (Alpaca native)
curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}/v2/stocks/quotes/latest?symbols=AAPL&feed=iex"

# Latest crypto quote (Alpaca native)
curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}/v1beta3/crypto/us/latest/quotes?symbols=BTC%2FUSD"

# Historical stock quotes (Alpaca native)
curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}/v2/stocks/quotes?symbols=AAPL&start=2026-05-20T13:30:00Z&end=2026-05-20T14:00:00Z&feed=iex"`}
      </pre>

      <h2 id="post-v1-options-contracts" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/contracts</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        List active option contracts for one or more underlying symbols. Default provider mode is <code>auto</code>: Alpaca contract metadata first, then ThetaData Value contract lists as fallback.
        Returns OCC symbol, strike, expiration, option type, open interest where available, and a <code>source</code> field.
        Use the returned <code>symbol</code> field as input to <code>/v1/options/snapshots</code> or <code>/v1/history/options/bars</code>.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>列出指定标的的活跃期权合约。默认 Alpaca，失败时回退到 ThetaData Value 合约列表。</span>
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
        { name: "provider",            type: "string",  required: false, desc: "auto | alpaca | thetadata (default: auto)" },
        { name: "date",                type: "string",  required: false, desc: "ThetaData contract-list date when provider uses ThetaData (YYYY-MM-DD or YYYYMMDD)" },
        { name: "request_type",        type: "string",  required: false, desc: "quote | trade for ThetaData list/contracts (default: quote; Value subscription supports list metadata)" },
        { name: "max_dte",             type: "integer", required: false, desc: "ThetaData fallback filter for max days to expiration" },
        { name: "limit",               type: "integer", required: false, desc: "1–10000 (default: 1000)" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/options/contracts \\
  -H "Authorization: Bearer *** \\
  -H "Content-Type: application/json" \\
  -d '{"underlying_symbols":"AAPL","limit":2,"provider":"auto"}'`}
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
  "next_page_token": null,
  "source": "alpaca"
}`}
      </pre>

      <h2 id="post-v1-history-options-bars" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/history/options/bars</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Historical OHLCV bars for option contracts. Default <code>provider: "auto"</code> routes to <strong style={{ color: "var(--ink-strong)" }}>ThetaData Value</strong> first and falls back to Alpaca bars only when ThetaData has no usable data.
        You can pass either OCC symbols directly (<code>AAPL260620C00200000</code>) or a plain stock ticker — the proxy will auto-resolve it to the option chain active on the <code>start</code> date.
        Supports in-flight coalescing and server-side cache; repeat historical calls return <code>X-Cache: DISK_HIT</code>.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>期权合约历史 OHLCV K线。默认 ThetaData Value，必要时回退 Alpaca。支持 OCC 或股票代码自动解析，并写入服务端缓存。</span>
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/history/options/bars`} />
      <ParamTable rows={[
        { name: "symbols",   type: "string",  required: true,  desc: "OCC symbol(s) comma-separated, or a stock ticker for auto-resolution" },
        { name: "start",     type: "string",  required: true,  desc: "ISO 8601 date" },
        { name: "end",       type: "string",  required: true,  desc: "ISO 8601 date" },
        { name: "timeframe", type: "string",  required: false, desc: "1Min | 5Min | 15Min | 30Min | 1Hour | 1Day (default: 1Min)" },
        { name: "provider",  type: "string",  required: false, desc: "auto | thetadata | alpaca (default: auto). thetadata disables Alpaca fallback; alpaca skips ThetaData." },
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
  -H "Authorization: Bearer *** \\
  -H "Content-Type: application/json" \\
  -d '{"symbols":"AAPL260620C00200000","start":"2025-05-01","end":"2025-05-15","timeframe":"1Day","provider":"auto"}'

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
  "provider": "thetadata",
  "pages": 1
}`}
      </pre>

      <h2 id="post-v1-options-open-interest" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>GET/POST /v1/options/open_interest</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Historical open interest by date range and strike/expiry filter. Data source: <strong style={{ color: "var(--ink-strong)" }}>ThetaData Value</strong> (returns 503 if ThetaData unavailable).
        Supports GET query parameters or POST JSON and writes successful responses to the server-side cache.
        Requires a tier with options history access (Trial, Standard, or Premium).
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>按日期范围和行权价/到期日筛选历史持仓量。支持 GET/POST，并写入服务端缓存。</span>
      </p>
      <EndpointBadge method="GET/POST" path={`${REST_BASE}/v1/options/open_interest`} />
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
  -H "Authorization: Bearer *** \\
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
        This is the primary endpoint for daily option OHLC summaries. Data source: <strong style={{ color: "var(--ink-strong)" }}>ThetaData Value</strong> with server-side cache.
        Accepts the same filter parameters as <code>/v1/options/open_interest</code>.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>期权合约的日终 OHLC 汇总，数据源为 ThetaData Value，并写入服务端缓存。</span>
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
  -H "Authorization: Bearer *** \\
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

      <h2 id="post-v1-history-options-eod" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/history/options/eod</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Preferred route for EOD option data. Same response shape as <code>/v1/options/eod</code> above but located under the history namespace for API consistency.
        Supports both <code>GET</code> (query params) and <code>POST</code> (JSON body). Successful responses are cached server-side.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>EOD 期权数据的首选路由。支持 GET 和 POST，成功响应会写入服务端缓存。</span>
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/history/options/eod`} />
      <pre className="code" style={{ marginBottom: 40 }}>
{`# GET with query parameters
curl "${REST_BASE}/v1/history/options/eod?symbol=AAPL&start=2025-01-02&end=2025-01-03&right=call"

# POST with JSON body (same parameters)
curl -X POST ${REST_BASE}/v1/history/options/eod \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbol":"AAPL","start":"2025-01-02","end":"2025-01-03","right":"call"}'`}
      </pre>

      <h2 id="post-v1-history-options-trades" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/history/options/trades</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Historical option trades from Alpaca. Maps to Alpaca's <code>/v1beta1/options/trades</code> endpoint, which is also available directly as a native <code>GET</code> route.
        Alpaca historical option data starts on <strong style={{ color: "var(--ink-strong)" }}>2024-02-01</strong>; earlier requests return empty data plus a warning on this wrapper route.
        <strong>No ThetaData fallback</strong> — if queried too early or on an empty dataset, returns a standard empty response.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>Alpaca 历史期权逐笔成交数据。Alpaca 历史期权数据从 2024-02-01 开始；无 ThetaData 备用源。若查询时间过早或数据集为空，返回标准空响应。</span>
      </p>
      <EndpointBadge method="GET/POST" path={`${REST_BASE}/v1/history/options/trades`} />
      <ParamTable rows={[
        { name: "symbols",   type: "string",  required: true,  desc: "Comma-separated OCC option symbols" },
        { name: "start",     type: "string",  required: true,  desc: "ISO 8601 datetime" },
        { name: "end",       type: "string",  required: true,  desc: "ISO 8601 datetime" },
        { name: "limit",     type: "integer", required: false, desc: "1–10000 (default: 1000)" },
        { name: "page_token",type: "string",  required: false, desc: "Pagination token from previous response" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/history/options/trades \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbols":"AAPL260620C00200000","start":"2025-01-02T09:30:00Z","end":"2025-01-02T16:00:00Z"}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 40 }}>
{`// Response — trades keyed by OCC symbol
{
  "trades": {
    "AAPL260620C00200000": [
      { "t": "2025-01-02T14:30:00Z", "x": "A", "p": 15.70, "s": 5, "c": ["@"] }
    ]
  },
  "next_page_token": null
}

// Empty response (too early or no data)
{
  "trades": {},
  "next_page_token": null,
  "data_availability": {
    "provider": "alpaca",
    "historical_options_since": "2024-02-01"
  },
  "warning": "Alpaca historical option data is available from 2024-02-01 onward."
}`}
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
          Alpaca historical option data is available from <strong>2024-02-01</strong> onward. Historical option trades are available through <code>/v1beta1/options/trades</code> or the alias <code>/v1/history/options/trades</code>; historical option quotes are still not exposed as a wrapper endpoint.
          Use the realtime cached snapshot endpoints for current quote/trade analysis.
        </div>
      </div>

      <h2 id="post-v1-options-snapshots" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/snapshots</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Full realtime snapshot for each contract: latest trade, latest quote, and greeks (delta, gamma, theta, vega, rho) plus implied volatility.
        This is the most comprehensive snapshot — use the sub-endpoints below if you only need quotes, trades, or open interest.
        Data source: Alpaca option chain API. Returns <code>403</code> if your tier lacks options permission.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>每个合约的完整实时快照：最新成交、最新报价、希腊值（delta, gamma, theta, vega, rho）及隐含波动率。数据源：Alpaca。权限不足返回 403。</span>
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/options/snapshots`} />
      <ParamTable rows={[
        { name: "symbols", type: "string",  required: true,  desc: "Comma-separated OCC option symbols (max 1000 per request)" },
        { name: "feed",    type: "string",  required: false, desc: "opra | indicative (default: opra for pro, indicative otherwise)" },
        { name: "limit",   type: "integer", required: false, desc: "1–1000 (default: 100)" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/options/snapshots \\
  -H "Authorization: Bearer *** \\
  -H "Content-Type: application/json" \\
  -d '{"symbols":"AAPL260620C00200000","feed":"indicative"}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 40 }}>
{`// Response — snapshots keyed by OCC symbol
{
  "snapshots": {
    "AAPL260620C00200000": {
      "greeks": {
        "delta": 0.7521,
        "gamma": 0.0624,
        "theta": -0.2848,
        "vega": 0.0475,
        "rho": 0.0099
      },
      "impliedVolatility": 0.3372,
      "latestQuote": {
        "ap": 4.30, "as": 91, "ax": "B",
        "bp": 4.15, "bs": 16, "bx": "C",
        "c": "A",
        "t": "2024-04-22T19:59:59.992734208Z"
      },
      "latestTrade": {
        "p": 4.10, "s": 1, "t": "2024-04-22T19:57:32.589554432Z",
        "c": "I", "x": "A"
      }
    }
  },
  "next_page_token": null
}`}
      </pre>

      <h2 id="post-v1-options-snapshots-quote" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/snapshots/quote</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Latest NBBO quote for option contracts. Default source is Alpaca's <code>/v1beta1/options/quotes/latest</code>; set <code>feed: "thetadata"</code> only when you explicitly want the ThetaData Value quote snapshot.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>期权合约最新 NBBO 报价。默认走 Alpaca latest quotes；只有明确需要 ThetaData Value quote snapshot 时才设置 feed: "thetadata"。</span>
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/options/snapshots/quote`} />
      <ParamTable rows={[
        { name: "symbols", type: "string",  required: true,  desc: "Comma-separated OCC option symbols (max 1000 per request)" },
        { name: "feed",    type: "string",  required: false, desc: "opra | indicative | thetadata (default follows account entitlement)" },
        { name: "limit",   type: "integer", required: false, desc: "1–1000 (default: 100)" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/options/snapshots/quote \\
  -H "Authorization: Bearer *** \\
  -H "Content-Type: application/json" \\
  -d '{"symbols":"AAPL260522C00110000","feed":"indicative"}'`}
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
    json={"symbols": "AAPL260620C00200000", "feed": "indicative"}
)
for sym, snap in resp.json()["snapshots"].items():
    q = snap["latestQuote"]
    spread = q["ap"] - q["bp"]
    print(f"{sym}  bid={q['bp']}  ask={q['ap']}  spread={spread:.2f}")`}
      </pre>

      <h2 id="post-v1-options-snapshots-trade" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/snapshots/trade</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Latest trade for option contracts. Default source is Alpaca's <code>/v1beta1/options/trades/latest</code>; responses are normalized under <code>snapshots[OCC].latestTrade</code>.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>期权合约最新成交。默认走 Alpaca latest trades，响应归一化到 snapshots[OCC].latestTrade。</span>
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/options/snapshots/trade`} />
      <ParamTable rows={[
        { name: "symbols", type: "string",  required: true,  desc: "Comma-separated OCC option symbols (max 100 per Alpaca latest endpoint)" },
        { name: "feed",    type: "string",  required: false, desc: "opra | indicative | thetadata (default follows account entitlement)" },
      ]} />
      <pre className="code" style={{ marginBottom: 40 }}>
{`curl -X POST ${REST_BASE}/v1/options/snapshots/trade \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbols":"AAPL260522C00110000","feed":"indicative"}'`}
      </pre>

      <h2 id="post-v1-options-snapshots-open-interest" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/snapshots/open_interest</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        ThetaData-only snapshot for the latest open interest of an option contract. Returns OI count and timestamp. Use <code>feed: "thetadata"</code>.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>ThetaData 独家快照：期权合约的最新持仓量，返回持仓量数值和时间戳。需设置 feed: "thetadata"。</span>
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/options/snapshots/open_interest`} />
      <ParamTable rows={[
        { name: "symbols", type: "string",  required: true,  desc: "Comma-separated OCC option symbols (max 1000 per request)" },
        { name: "feed",    type: "string",  required: false, desc: "thetadata (default: opra — must set to thetadata for this endpoint)" },
        { name: "limit",   type: "integer", required: false, desc: "1–1000 (default: 100)" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/options/snapshots/open_interest \\
  -H "Authorization: Bearer *** \\
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
        Resolves the contract list and batches snapshot requests (100 symbols per batch).
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>便捷接口：一次性获取指定标的在特定到期日的所有合约快照。会先解析合约列表，再批量请求快照（每批 100 个标的）。</span>
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/options/snapshots/expiry`} />
      <ParamTable rows={[
        { name: "underlying", type: "string", required: true,  desc: "Root ticker (e.g. AAPL)" },
        { name: "expiry",     type: "string", required: true,  desc: "Expiration date YYYY-MM-DD" },
        { name: "feed",       type: "string", required: false, desc: "opra | indicative (default: opra)" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/options/snapshots/expiry \\
  -H "Authorization: Bearer *** \\
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
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>美国加密货币对的最新 L2 订单簿快照。仅限 Premium 套餐。每侧订单簿为按价格排序的 {"{ p: price, s: size }"} 对象数组。</span>
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/crypto/us/latest/orderbooks`} />
      <ParamTable rows={[
        { name: "symbols", type: "string", required: true, desc: "Comma-separated crypto pairs (e.g. BTC/USD,ETH/USD)" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/crypto/us/latest/orderbooks \\
  -H "Authorization: Bearer *** \\
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
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>Receive a session token for the admin panel. Password set via <code>ADMIN_PASSWORD</code> environment variable.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>获取管理员面板的会话 Token。密码通过 ADMIN_PASSWORD 环境变量设置。</span>
      </p>
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
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>List registrations awaiting approval.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>列出待审批的注册申请。</span>
      </p>
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
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>审批通过待处理的注册申请。自动写入用户数据库并签发 Token，可直接将 Token 分享给用户。</span>
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
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>Reject a pending registration with an optional reason.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>拒绝待处理的注册申请，可附带拒绝原因。</span>
      </p>
      <EndpointBadge method="POST" path={`${TOKEN_BASE}/api/admin/reject`} />
      <pre className="code" style={{ marginBottom: 48 }}>
{`// Request
{ "id": "61ce4f82-...", "reason": "信息不完整" }

// Response 200
{ "success": true, "message": "已拒绝 tonnysun。" }`}
      </pre>

      <h2 id="post-v3-option-direct-value" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>GET/POST /v3/option/* (ThetaData Value)</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Authenticated proxy for ThetaData Value option endpoints included in the subscription.
        Supports both <code>GET</code> query parameters and <code>POST</code> JSON bodies, strips proxy credentials before execution, and caches successful JSON responses server-side.
        Unsupported Standard/Pro-only routes such as option trades, trade_quote, market value, implied volatility, and greeks are intentionally not exposed here.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>ThetaData Value 期权白名单代理，仅开放 Value 订阅允许的端点。支持 GET/POST，成功 JSON 响应写入服务端缓存。</span>
      </p>
      <EndpointBadge method="GET/POST" path={`${REST_BASE}/v3/option/...`} />
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 20 }}>
        <thead><tr><th>Endpoint</th><th>Required access</th><th>Notes</th></tr></thead>
        <tbody>
          {[
            ["/v3/option/list/symbols", "Options contracts", "List option root symbols"],
            ["/v3/option/list/dates/quote", "Options contracts", "Available quote dates"],
            ["/v3/option/list/dates/trade", "Options contracts", "Available trade dates as list metadata"],
            ["/v3/option/list/expirations", "Options contracts", "Expirations for a root"],
            ["/v3/option/list/strikes", "Options contracts", "Strikes for root/expiration"],
            ["/v3/option/list/contracts/quote", "Options contracts", "Contract list by quote availability"],
            ["/v3/option/list/contracts/trade", "Options contracts", "Contract list by trade availability"],
            ["/v3/option/snapshot/ohlc", "Options snapshots", "Latest OHLC snapshot"],
            ["/v3/option/snapshot/quote", "Options snapshots", "Latest NBBO quote snapshot"],
            ["/v3/option/snapshot/open_interest", "Options snapshots", "Latest open-interest snapshot"],
            ["/v3/option/history/eod", "Options history", "Daily EOD summary"],
            ["/v3/option/history/ohlc", "Options history", "Historical OHLC bars"],
            ["/v3/option/history/quote", "Options history", "Historical quotes"],
            ["/v3/option/history/open_interest", "Options history", "Historical open interest"],
            ["/v3/option/at_time/quote", "Options history", "Quote at a timestamp"],
          ].map(([endpoint, access, notes], i) => (
            <tr key={i}>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>{endpoint}</td>
              <td style={{ fontSize: 12, color: "var(--ink-muted)" }}>{access}</td>
              <td style={{ fontSize: 12, color: "var(--ink-muted)" }}>{notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 id="post-v3-option-history-ohlc" style={{ fontSize: 16, fontWeight: 500, margin: "20px 0 8px", color: "var(--ink-strong)" }}>Historical OHLC example</h3>
      <pre className="code" style={{ marginBottom: 12 }}>
{`# GET — query parameters forwarded to ThetaData
curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}/v3/option/history/ohlc?root=AAPL&exp=260620&strike=200000&right=C&start_date=20250102&end_date=20250103"

# POST — JSON body forwarded to ThetaData
curl -X POST ${REST_BASE}/v3/option/history/ohlc \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"root":"AAPL","exp":260620,"strike":200000,"right":"C","start_date":20250102,"end_date":20250103}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 40 }}>
{`// Response — ThetaData native format
{
  "ohlc": [
    { "date": 20250102, "open": 14.50, "high": 15.20, "low": 14.10, "close": 14.85, "volume": 320 }
  ]
}`}
      </pre>

      <h3 id="post-v3-option-snapshot-ohlc" style={{ fontSize: 16, fontWeight: 500, margin: "20px 0 8px", color: "var(--ink-strong)" }}>Snapshot OHLC example</h3>
      <pre className="code" style={{ marginBottom: 40 }}>
{`curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}/v3/option/snapshot/ohlc?root=AAPL&exp=260620&strike=200000&right=C"

// Response — ThetaData native format
{
  "ohlc": { "open": 14.50, "high": 15.20, "low": 14.10, "close": 14.85, "volume": 320 }
}`}
      </pre>

      {/* ── Reference ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Reference</div>

      <h2 id="error-codes" className="display-title" style={{ fontSize: 28, margin: "0 0 12px" }}>Error codes</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>Common HTTP status codes returned by the proxy and when they occur.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>代理返回的常见 HTTP 状态码及其触发场景。</span>
      </p>
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
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>REST 限速按用户、按 60 秒滚动窗口计算。AdaptiveRateLimiter 在 CPU&gt;80% 或内存&gt;85% 时自动收紧，在 CPU&gt;95% 或内存&gt;92% 时进一步收紧。WS 标订阅数单独计算，重连不重置。</span>
      </p>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 12 }}>
        <thead>
          <tr><th style={{ width: 150 }}>Tier</th><th>REST req/min</th><th>Under load</th><th>Critical</th><th>WS symbols</th></tr>
        </thead>
        <tbody>
          {[
            ["Premium",       "300", "150", "75",  "500"],
            ["Standard",      "60",  "30",  "15",  "50"],
            ["Trial",         "60",  "30",  "15",  "50"],
            ["Basic",         "10",  "5",   "2",   "—"],
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
  const WS_BASE = `ws://${PROXY_HOST}:8767`;
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
        <thead><tr><th>Channel</th><th>Path</th><th>Format</th><th>Basic</th><th>Trial</th><th>Standard</th><th>Premium</th></tr></thead>
        <tbody>
          {[
            ["stocks",    "/stream",           "msgpack", "—", "✓", "✓", "✓"],
            ["options",   "/stream/options",   "msgpack", "—", "✓", "✓", "✓"],
            ["contract",  "/stream/contract",  "msgpack", "—", "✓", "✓", "✓"],
            ["overnight", "/stream/overnight", "msgpack", "—", "—", "—", "✓"],
            ["crypto",    "/stream/crypto",    "JSON",    "—", "—", "—", "✓"],
            ["news",      "/stream/news",      "JSON",    "—", "—", "—", "✓"],
          ].map(([ch, path, fmt, b, tr, s, p], i) => (
            <tr key={i}>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 600 }}>{ch}</td>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>{path}</td>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)" }}>{fmt}</td>
              <td style={{ color: b === "✓" ? "var(--ok)" : "var(--ink-soft)", fontFamily: "var(--f-mono)", textAlign: "center" }}>{b}</td>
              <td style={{ color: tr === "✓" ? "var(--ok)" : "var(--ink-soft)", fontFamily: "var(--f-mono)", textAlign: "center" }}>{tr}</td>
              <td style={{ color: s === "✓" ? "var(--ok)" : "var(--ink-soft)", fontFamily: "var(--f-mono)", textAlign: "center" }}>{s}</td>
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
      <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: "0 0 12px" }}>basic: — · trial/standard: 50 · premium: 500. Exceeding the limit returns an error message and the subscribe is rejected.</p>

      <h2 id="options" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>options</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Live OPRA options feed. Subscribe using OCC symbols in the <code>trades</code> and <code>quotes</code> lists.
        Standard, Trial and Premium only.
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
        Messages are plain JSON. Available to Basic (REST only) and Premium. Standard/Trial get news via REST history, not realtime WS.
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
                await ws.recv()                          // auth response
                await ws.send(json.dumps({               // re-subscribe
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
