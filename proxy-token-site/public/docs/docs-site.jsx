const { useState } = React;

const REST_BASE = "https://api.leandata.uk";
const RT_BASE = "https://rt-api.leandata.uk";
const WS_BASE = "wss://leandata.uk";

const endpointGroups = [
  {
    id: "market",
    en: "Market data",
    zh: "行情数据",
    introEn: "Use these endpoints for historical and latest market data. Select the endpoint that matches the data type you need.",
    introZh: "这些接口用于历史与最新行情数据。请按所需数据类型选择对应接口。",
    endpoints: [
      ["POST", "/v1/history/bars", "Historical OHLCV bars", "历史 OHLCV K 线"],
      ["GET/POST", "/v1/indices/history", "Index history", "指数历史数据"],
      ["POST", "/v1/history/news", "Historical news", "历史新闻"],
      ["POST", "/v1/stock/history/trade_quote", "Historical trades and quotes", "历史成交与报价"],
      ["GET", "/v2/stocks/*", "Stock data", "股票数据"],
      ["GET/POST", "/v1/options/*", "Options data", "期权数据"],
      ["GET", "/v1beta3/crypto/*", "Crypto data", "加密货币数据"],
    ],
  },
  {
    id: "financial",
    en: "Financial data",
    zh: "财务数据",
    introEn: "Premium access includes company statements, ratios, metrics, profiles, and reference data.",
    introZh: "Premium 账户可访问公司财报、财务比率、关键指标、公司资料及参考数据。",
    endpoints: [
      ["GET", "/stable/income-statement", "Income statements", "利润表"],
      ["GET", "/stable/balance-sheet-statement", "Balance sheets", "资产负债表"],
      ["GET", "/stable/cash-flow-statement", "Cash-flow statements", "现金流量表"],
      ["GET", "/stable/ratios", "Financial ratios", "财务比率"],
      ["GET", "/stable/key-metrics", "Key metrics", "关键指标"],
      ["GET", "/stable/profile", "Company profiles", "公司资料"],
    ],
  },
];

function Bilingual({ en, zh, muted = false }) {
  const color = muted ? "var(--ink-soft)" : "var(--ink-muted)";
  return (
    <>
      <p style={{ color, lineHeight: 1.65, margin: "0 0 6px" }}>{en}</p>
      <p lang="zh-CN" style={{ color, lineHeight: 1.65, margin: 0 }}>{zh}</p>
    </>
  );
}

function DocsTopbar({ tab, setTab }) {
  const items = [
    ["overview", "Overview", "概览"],
    ["market", "Market data", "行情数据"],
    ["financial", "Financial data", "财务数据"],
    ["stream", "Streaming", "实时流"],
    ["status", "Status", "状态"],
    ["usage", "Usage", "用量"],
  ];
  return (
    <div className="topbar">
      <div className="brand"><span className="dot"></span><strong>Leandata Docs / 文档</strong></div>
      <div className="divider"></div>
      <div className="nav">
        {items.map(([id, en, zh]) => (
          <a key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)} style={{ cursor: "pointer" }}>
            {en} / {zh}
          </a>
        ))}
      </div>
      <div className="spacer"></div>
      <div className="meta">
        <LanguageToggle />
        <a href="/" className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }}>Token portal / Token 门户 →</a>
      </div>
    </div>
  );
}

function EndpointTable({ endpoints, base = REST_BASE }) {
  return (
    <table className="tbl card" style={{ overflow: "hidden", marginTop: 18 }}>
      <thead><tr><th>Method</th><th>Endpoint</th><th>Purpose / 用途</th></tr></thead>
      <tbody>
        {endpoints.map(([method, path, en, zh]) => (
          <tr key={path}>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>{method}</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>{base}{path}</td>
            <td style={{ fontSize: 12 }}><div>{en}</div><div lang="zh-CN" style={{ color: "var(--ink-muted)", marginTop: 3 }}>{zh}</div></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Overview() {
  return (
    <div style={{ maxWidth: 820 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Getting started / 开始使用</div>
      <h2 className="display-title" style={{ fontSize: 42, margin: "0 0 14px" }}>One token, clear endpoints / 一个 Token，清晰的接口</h2>
      <Bilingual
        en="Use one token to access historical data, real-time data, streaming, and financial data through the documented public domains."
        zh="使用一个 Token，即可通过文档中的公共域名访问历史数据、实时数据、实时流与财务数据。"
      />

      <div className="card" style={{ padding: 20, margin: "24px 0" }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 18 }}>Public endpoints / 公共端点</h3>
        <table className="tbl" style={{ margin: 0 }}>
          <thead><tr><th>Service / 服务</th><th>URL</th><th>Use / 用途</th></tr></thead>
          <tbody>
            <tr><td>Historical data / 历史数据</td><td><code>{REST_BASE}</code></td><td>Research and time-range queries / 研究与时间范围查询</td></tr>
            <tr><td>Real-time data / 实时数据</td><td><code>{RT_BASE}</code></td><td>Latest values and live lookups / 最新值与实时查询</td></tr>
            <tr><td>Streaming / 实时流</td><td><code>{WS_BASE}/stream/*</code></td><td>Authenticated streaming connections / 需要认证的实时连接</td></tr>
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 24, margin: "32px 0 10px" }}>Authentication / 认证</h3>
      <Bilingual
        en="REST requests use a Bearer token. Streaming connections authenticate with an initial JSON message. Keep tokens private and rotate them from the account portal when needed."
        zh="REST 请求使用 Bearer Token。实时流连接通过首条 JSON 消息完成认证。请妥善保管 Token，并可在账户门户中按需更换。"
      />
      <pre className="code" style={{ marginTop: 14 }}>{`curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}/v1/history/bars?symbol=AAPL&start=2025-01-01&end=2025-01-31&timeframe=1Day"`}</pre>

      <h3 style={{ fontSize: 24, margin: "32px 0 10px" }}>Choose by endpoint / 按端点选择</h3>
      <Bilingual
        en="Each endpoint defines its own fields, timeframes, limits, and availability. Use the endpoint description and response schema as the source of truth for your integration."
        zh="每个端点均定义自己的字段、时间周期、限制与可用范围。集成时请以端点说明和响应结构为准。"
      />
    </div>
  );
}

function DataGroup({ group }) {
  return (
    <div style={{ maxWidth: 900 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>{group.en} / {group.zh}</div>
      <h2 className="display-title" style={{ fontSize: 42, margin: "0 0 12px" }}>{group.en} / {group.zh}</h2>
      <Bilingual en={group.introEn} zh={group.introZh} />
      <EndpointTable endpoints={group.endpoints} />
      <p style={{ color: "var(--ink-soft)", fontSize: 13, marginTop: 14 }}>
        Endpoint examples use <code>Authorization: Bearer &lt;TOKEN&gt;</code>. / 示例使用 <code>Authorization: Bearer &lt;TOKEN&gt;</code>。
      </p>
    </div>
  );
}

function Streaming() {
  return (
    <div style={{ maxWidth: 820 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Streaming / 实时流</div>
      <h2 className="display-title" style={{ fontSize: 42, margin: "0 0 12px" }}>Connect, authenticate, subscribe / 连接、认证、订阅</h2>
      <Bilingual
        en="Connect to the channel that matches your data type. Authenticate before subscribing, then send arrays of symbols for the channels you need."
        zh="连接与所需数据类型对应的频道。请先完成认证，再为所需频道发送标的代码数组。"
      />
      <pre className="code" style={{ marginTop: 16 }}>{`// Connect to ${WS_BASE}/stream
{ "action": "auth", "token": "<TOKEN>" }
{ "action": "subscribe", "trades": ["AAPL"], "quotes": ["AAPL"] }`}</pre>
      <h3 style={{ fontSize: 24, margin: "32px 0 10px" }}>Reliable clients / 可靠的客户端</h3>
      <Bilingual
        en="Handle reconnects with backoff. After reconnecting, authenticate again and send a new subscription message. Validate every message against the documented channel schema."
        zh="请使用退避策略处理重连。重连后需要再次认证并重新发送订阅消息。请按文档中的频道结构校验每一条消息。"
      />
      <h3 style={{ fontSize: 24, margin: "32px 0 10px" }}>Service limits / 服务限制</h3>
      <Bilingual
        en="Plan limits apply to requests and subscriptions. When a request is declined, follow the returned status code and retry guidance."
        zh="套餐限制适用于请求与订阅。当请求被拒绝时，请根据返回的状态码和重试建议处理。"
      />
    </div>
  );
}

function Status() {
  return (
    <div style={{ maxWidth: 820 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Service status / 服务状态</div>
      <h2 className="display-title" style={{ fontSize: 42, margin: "0 0 12px" }}>Check before you integrate / 集成前先检查状态</h2>
      <Bilingual
        en="The status view reports the availability of historical data, real-time data, and streaming. It is a customer-facing health summary, not an implementation report."
        zh="状态页展示历史数据、实时数据与实时流的可用性。这是面向用户的服务健康摘要，而非实现细节报告。"
      />
      <div className="card" style={{ padding: 20, marginTop: 18 }}>
        <strong>Operational guidance / 使用建议</strong>
        <p style={{ color: "var(--ink-muted)", margin: "10px 0 4px", lineHeight: 1.65 }}>Use the documented domains, avoid hard-coded IP addresses, and retry only according to the returned status code.</p>
        <p lang="zh-CN" style={{ color: "var(--ink-muted)", margin: 0, lineHeight: 1.65 }}>请使用文档中的服务域名，不要写死 IP 地址，并仅按返回状态码的建议重试。</p>
      </div>
    </div>
  );
}

function DocsSite() {
  const [tab, setTab] = useState("overview");
  const group = endpointGroups.find(item => item.id === tab);
  return (
    <div className="proxy-app" style={{ minHeight: "100vh", background: "var(--bg-canvas)" }}>
      <DocsTopbar tab={tab} setTab={setTab} />
      <header className="docs-hero" style={{ padding: "44px 64px 30px", background: "var(--bg-paper)", borderBottom: "1px solid var(--rule)" }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Reference / 接口文档</div>
        <h1 className="display-title" style={{ fontSize: 56, margin: "0 0 12px" }}>Market data API / 市场数据 API</h1>
        <div style={{ maxWidth: 720 }}>
          <Bilingual en="Clear public endpoints for market data, financial data, and streaming." zh="为行情数据、财务数据与实时流提供清晰的公共端点。" />
        </div>
      </header>
      <main style={{ padding: "42px clamp(24px, 7vw, 88px) 72px" }}>
        {tab === "overview" ? <Overview /> : group ? <DataGroup group={group} /> : tab === "stream" ? <Streaming /> : tab === "status" ? <Status /> : typeof UsagePage !== "undefined" ? <UsagePage /> : null}
      </main>
    </div>
  );
}

window.DocsSite = DocsSite;
