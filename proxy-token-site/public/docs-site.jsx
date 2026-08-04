// ── StatusBody component ──
// Fetches live data from /api/status, /api/uptime, /api/latency, /api/incidents.
// Auto-refreshes every 30 s.

const { useState: useStatusState, useEffect: useStatusEffect, useCallback: useStatusCallback, useRef: useStatusRef } = React;

function pctUp(arr) {
  if (!arr || arr.length === 0) return "—";
  const good = arr.filter(v => v === 0).length;
  return ((good / arr.length) * 100).toFixed(2);
}

// ── tiny sparkline ──────────────────────────────────────────────────────
function Sparkline({ values, width = 220, height = 44, color = "var(--accent-ink)", fill = "var(--accent-soft)" }) {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => [i * stepX, height - 4 - ((v - min) / range) * (height - 12)]);
  const path = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <path d={area} fill={fill} opacity="0.5"/>
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r="2.5" fill={color}/>
    </svg>
  );
}

// ── 90-day uptime grid ───────────────────────────────────────────────────
function UptimeGrid({ data }) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {data.map((v, i) => (
        <div key={i} title={`${90 - i}d ago · ${v === 0 ? "operational" : v === 1 ? "degraded" : "outage"}`}
          style={{
            flex: 1, height: 32,
            borderRadius: 2,
            background: v === 0 ? "var(--ok)" : v === 1 ? "var(--warn)" : "var(--danger)",
            opacity: v === 0 ? 0.85 : 1,
          }}
        />
      ))}
    </div>
  );
}

// ── stats / quantiles helper ────────────────────────────────────────────
function quantile(arr, q) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? Math.round(sorted[base] + rest * (sorted[base + 1] - sorted[base])) : sorted[base];
}

// ── component cards ──────────────────────────────────────────────────────
function ComponentCard({ name, route, status, uptime90, latency24h, unit = "ms", color = "var(--accent-ink)" }) {
  const p50 = quantile(latency24h, 0.5);
  const p95 = quantile(latency24h, 0.95);
  const p99 = quantile(latency24h, 0.99);
  const last30 = uptime90.slice(-30);
  const last7 = uptime90.slice(-7);
  const last1 = uptime90.slice(-1);

  const statusLabel = status === "operational" ? "Operational" : status === "degraded" ? "Degraded" : status === "loading" ? "Loading…" : "Outage";
  const statusColor = status === "operational" ? "var(--ok)" : status === "loading" ? "var(--ink-muted)" : status === "degraded" ? "var(--warn)" : "var(--danger)";
  const statusBg    = status === "operational" ? "var(--ok-soft)" : status === "loading" ? "var(--bg-canvas)" : status === "degraded" ? "var(--warn-soft)" : "var(--danger-soft)";

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: statusColor,
              boxShadow: `0 0 0 3px ${statusBg}`,
            }}/>
            <h3 style={{ fontFamily: "var(--f-sans)", fontWeight: 500, fontSize: 16, margin: 0, color: "var(--ink-strong)" }}>{name}</h3>
          </div>
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)", paddingLeft: 16 }}>{route}</div>
        </div>
        <span style={{
          padding: "3px 8px",
          background: statusBg,
          color: statusColor,
          fontFamily: "var(--f-mono)",
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: ".08em",
          borderRadius: 3,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}>{statusLabel}</span>
      </div>

      {/* Latency row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 16, alignItems: "end", marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid var(--rule)" }}>
        <Stat label="p50" value={p50} unit={unit}/>
        <Stat label="p95" value={p95} unit={unit}/>
        <Stat label="p99" value={p99} unit={unit}/>
        <Sparkline values={latency24h} width={120} height={36} color={color} fill={color === "var(--accent-ink)" ? "var(--accent-soft)" : "oklch(0.95 0.06 295)"}/>
      </div>

      {/* Uptime row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <Stat label="24h uptime" value={pctUp(last1)} unit="%" size="sm"/>
        <Stat label="7d uptime" value={pctUp(last7)} unit="%" size="sm"/>
        <Stat label="30d uptime" value={pctUp(last30)} unit="%" size="sm"/>
      </div>
    </div>
  );
}

function Stat({ label, value, unit, size = "md" }) {
  return (
    <div>
      <div style={{
        fontFamily: "var(--f-mono)",
        fontSize: 10,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        color: "var(--ink-soft)",
        marginBottom: 2,
      }}>{label}</div>
      <div style={{ fontFamily: "var(--f-mono)", color: "var(--ink-strong)" }}>
        <span style={{ fontSize: size === "sm" ? 16 : 20, fontWeight: 500 }}>{value}</span>
        <span style={{ fontSize: 11, color: "var(--ink-muted)", marginLeft: 2 }}>{unit}</span>
      </div>
    </div>
  );
}

// ── multi-series latency chart ──────────────────────────────────────────
function LatencyChart({ range }) {
  const [chartData, setChartData] = useStatusState({ rest: [], rt: [], ws: [] });

  useStatusEffect(() => {
    let cancelled = false;
    fetch(`/api/latency?range=${range}`)
      .then(r => r.json())
      .then(d => {
        if (!cancelled) setChartData({
          rest: (d.rest || []).map(v => v ?? 0),
          rt: (d.rt || []).map(v => v ?? 0),
          ws: (d.ws || []).map(v => v ?? 0),
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [range]);

  const restSeries = chartData.rest;
  const rtSeries = chartData.rt;
  const wsSeries = chartData.ws;

  if (restSeries.length === 0 && rtSeries.length === 0 && wsSeries.length === 0) {
    return (
      <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-soft)", fontFamily: "var(--f-mono)", fontSize: 12 }}>
        Collecting latency data…
      </div>
    );
  }

  const W = 720, H = 200, PAD_L = 44, PAD_R = 12, PAD_T = 16, PAD_B = 28;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const allVals = [...restSeries, ...rtSeries, ...wsSeries].filter(v => v > 0);
  const max = allVals.length > 0 ? Math.max(...allVals) * 1.15 : 100;

  function makePath(series) {
    if (series.length < 2) return "";
    const step = plotW / (series.length - 1);
    return series.map((v, i) => `${i === 0 ? "M" : "L"}${PAD_L + i * step},${PAD_T + plotH - (v / max) * plotH}`).join(" ");
  }

  const gridStep = max <= 20 ? 5 : max <= 100 ? 25 : max <= 500 ? 100 : 250;
  const gridLines = [];
  for (let g = 0; g <= max; g += gridStep) gridLines.push(g);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {gridLines.map(g => (
        <g key={g}>
          <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH - (g / max) * plotH} y2={PAD_T + plotH - (g / max) * plotH} stroke="var(--rule)" strokeDasharray="2 3"/>
          <text x={PAD_L - 6} y={PAD_T + plotH - (g / max) * plotH + 3} textAnchor="end" fontSize="9" fontFamily="var(--f-mono)" fill="var(--ink-soft)">{g}ms</text>
        </g>
      ))}
      <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="var(--rule-strong)"/>
      {[0, 0.25, 0.5, 0.75, 1].map(p => {
        const x = PAD_L + plotW * p;
        const label = range === "24h" ? `${Math.round(p * 24)}h` : range === "7d" ? `${Math.round(p * 7)}d` : `${Math.round(p * 30)}d`;
        return (
          <g key={p}>
            <line x1={x} x2={x} y1={PAD_T + plotH} y2={PAD_T + plotH + 3} stroke="var(--rule-strong)"/>
            <text x={x} y={PAD_T + plotH + 14} textAnchor="middle" fontSize="9" fontFamily="var(--f-mono)" fill="var(--ink-soft)">−{label}</text>
          </g>
        );
      })}
      <path d={makePath(restSeries)} fill="none" stroke="var(--accent-ink)" strokeWidth="1.5"/>
      <path d={makePath(rtSeries)} fill="none" stroke="oklch(0.65 0.18 160)" strokeWidth="1.5"/>
      <path d={makePath(wsSeries)} fill="none" stroke="oklch(0.55 0.16 295)" strokeWidth="1.5"/>
    </svg>
  );
}

// ── data hook (live) ──────────────────────────────────────────────────
const EMPTY_STATUS = {
  rest: { name: "Historical REST API", route: "https://api.leandata.uk", status: "loading", uptime90: [], latency24h: [] },
  rt:   { name: "Realtime REST API", route: "https://rt-api.leandata.uk", status: "loading", uptime90: [], latency24h: [] },
  ws:   { name: "WebSocket stream", route: "wss://leandata.uk/stream/*", status: "loading", uptime90: [], latency24h: [] },
  incidents: [],
  timestamp: null,
};

function uptimePctToGrid(pcts) {
  return (pcts || []).map(p => p >= 99.9 ? 0 : p >= 95 ? 1 : 2);
}

function useStatusData() {
  const [data, setData] = useStatusState(EMPTY_STATUS);

  const fetchAll = useStatusCallback(async () => {
    try {
      const [statusRes, uptimeRes, latencyRes, incidentsRes] = await Promise.all([
        fetch("/api/status").then(r => r.json()),
        fetch("/api/uptime").then(r => r.json()),
        fetch("/api/latency?range=24h").then(r => r.json()),
        fetch("/api/incidents").then(r => r.json()),
      ]);
      const filterNull = arr => (arr || []).filter(v => v !== null);
      const mapComponent = (key) => ({
        name: EMPTY_STATUS[key]?.name || statusRes.components[key]?.name || key,
        route: EMPTY_STATUS[key]?.route || "",
        status: statusRes.components[key]?.status || "loading",
        uptime90: uptimePctToGrid(uptimeRes[key]),
        latency24h: filterNull(latencyRes[key]),
      });
      setData({
        rest: mapComponent("rest"),
        rt: mapComponent("rt"),
        ws: mapComponent("ws"),
        incidents: (incidentsRes.incidents || []).map(inc => ({
          ...inc,
          date: inc.date ? inc.date.slice(0, 10) : "",
        })),
        timestamp: statusRes.timestamp,
      });
    } catch (e) {
      console.error("Status fetch error:", e);
    }
  }, []);

  useStatusEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30000);
    return () => clearInterval(id);
  }, [fetchAll]);

  return data;
}

function SeverityChip({ s }) {
  const map = {
    minor:    { bg: "var(--warn-soft)",   fg: "var(--warn)",   label: "Minor" },
    major:    { bg: "var(--danger-soft)", fg: "var(--danger)", label: "Major" },
    resolved: { bg: "var(--ok-soft)",     fg: "var(--ok)",     label: "Resolved" },
  };
  const m = map[s] || map.minor;
  return (
    <span style={{
      padding: "2px 7px",
      background: m.bg,
      color: m.fg,
      fontFamily: "var(--f-mono)",
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: ".08em",
      borderRadius: 3,
      fontWeight: 600,
    }}>{m.label}</span>
  );
}

// ── main component ──────────────────────────────────────────────────────
function StatusBody() {
  const data = useStatusData();
  const [range, setRange] = useStatusState("24h");

  const isLoading = data.rest.status === "loading" || data.rt.status === "loading" || data.ws.status === "loading";
  const allOp = data.rest.status === "operational" && data.rt.status === "operational" && data.ws.status === "operational";
  const anyOutage = data.rest.status === "outage" || data.rt.status === "outage" || data.ws.status === "outage";
  const overall = isLoading ? "loading" : allOp ? "operational" : anyOutage ? "outage" : "degraded";

  const overallLabel = overall === "loading" ? "Checking systems…" : overall === "operational" ? "All systems operational" : overall === "outage" ? "Service disruption" : "Partial degradation";
  const overallColor = overall === "loading" ? "var(--ink-muted)" : overall === "operational" ? "var(--ok)" : overall === "outage" ? "var(--danger)" : "var(--warn)";
  const overallBg    = overall === "loading" ? "var(--bg-canvas)" : overall === "operational" ? "var(--ok-soft)" : overall === "outage" ? "var(--danger-soft)" : "var(--warn-soft)";

  const lastUpdated = data.timestamp
    ? data.timestamp.replace("T", " ").slice(0, 16) + " UTC"
    : "loading…";

  return (
    <div>
      {/* ── Overview ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>System</div>
      <h2 id="overview" className="display-title" style={{ fontSize: 38, margin: "0 0 8px" }}>Status</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 24px" }}>
        Live health of the historical REST API, realtime REST API, and secure WebSocket stream on the public leandata.uk domains.
        Uptime is sampled every minute; latency percentiles are computed over a rolling 60-minute window.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>这里展示 leandata.uk 公共域名下历史 REST、实时 REST 与安全 WebSocket 的健康状态。可用性按分钟采样，延迟分位数按 60 分钟滚动窗口计算。</span>
      </p>

      {/* Hero status banner */}
      <div className="card" style={{
        padding: "18px 20px",
        marginBottom: 32,
        borderLeft: `3px solid ${overallColor}`,
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}>
        <span style={{
          width: 12, height: 12, borderRadius: "50%",
          background: overallColor,
          boxShadow: `0 0 0 4px ${overallBg}`,
        }}/>
        <div style={{ flex: 1 }}>
          <div className="display-title" style={{ fontSize: 22, color: "var(--ink-strong)" }}>{overallLabel}</div>
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)", marginTop: 2 }}>
            Last updated · {lastUpdated} · refreshes every 30 s
          </div>
        </div>
        <button className="btn" style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => window.location.reload()}>
          ↻ Refresh
        </button>
      </div>

      {/* ── Components ── */}
      <h2 id="components" className="display-title" style={{ fontSize: 28, margin: "0 0 16px" }}>Components</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 40 }}>
        <ComponentCard {...data.rest} unit="ms" color="var(--accent-ink)"/>
        <ComponentCard {...data.rt} unit="ms" color="oklch(0.65 0.18 160)"/>
        <ComponentCard {...data.ws} unit="ms" color="oklch(0.55 0.16 295)"/>
      </div>

      {/* ── Latency chart ── */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 id="latency" className="display-title" style={{ fontSize: 28, margin: 0 }}>Latency</h2>
        <div style={{ display: "flex", gap: 0, border: "1px solid var(--rule-strong)", borderRadius: 6, overflow: "hidden", fontFamily: "var(--f-mono)" }}>
          {["24h", "7d", "30d"].map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                padding: "6px 12px",
                fontSize: 11,
                fontFamily: "inherit",
                border: "none",
                background: range === r ? "var(--ink-strong)" : "transparent",
                color: range === r ? "var(--ink-inverse)" : "var(--ink-muted)",
                cursor: "pointer",
              }}
            >{r}</button>
          ))}
        </div>
      </div>
      <div className="card" style={{ padding: 20, marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 12 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--ink-muted)" }}>
            <span style={{ width: 12, height: 2, background: "var(--accent-ink)" }}/> REST API
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--ink-muted)" }}>
            <span style={{ width: 12, height: 2, background: "oklch(0.65 0.18 160)" }}/> RT API
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--ink-muted)" }}>
            <span style={{ width: 12, height: 2, background: "oklch(0.55 0.16 295)" }}/> WebSocket
          </span>
          <span style={{ flex: 1 }}/>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)" }}>
            {range} · ms · client → response
          </span>
        </div>
        <LatencyChart range={range}/>
      </div>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 40px" }}>
        REST latency includes public TLS routing, cache or upstream resolution, and server processing.
        WebSocket latency is the auth-response round-trip after socket open; message delivery has near-zero added latency once the stream is warm.
      </p>

      {/* ── Uptime grid ── */}
      <h2 id="uptime" className="display-title" style={{ fontSize: 28, margin: "0 0 16px" }}>90-day uptime</h2>
      <div className="card" style={{ padding: 20, marginBottom: 12 }}>
        <UptimeBlock label="REST API" data={data.rest.uptime90} />
        <hr style={{ border: 0, borderTop: "1px solid var(--rule)", margin: "18px 0" }}/>
        <UptimeBlock label="WebSocket stream" data={data.ws.uptime90} />
      </div>
      <div style={{ display: "flex", gap: 18, fontSize: 11, color: "var(--ink-muted)", marginBottom: 40, fontFamily: "var(--f-mono)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, background: "var(--ok)", borderRadius: 2 }}/> operational
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, background: "var(--warn)", borderRadius: 2 }}/> degraded
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, background: "var(--danger)", borderRadius: 2 }}/> outage
        </span>
      </div>

      {/* ── Incidents ── */}
      <h2 id="incidents" className="display-title" style={{ fontSize: 28, margin: "0 0 16px" }}>Recent incidents</h2>
      {data.incidents.length === 0 ? (
        <p style={{ color: "var(--ink-soft)", fontFamily: "var(--f-mono)", fontSize: 12 }}>No incidents recorded.</p>
      ) : (
        <div style={{ borderTop: "1px solid var(--rule)" }}>
          {data.incidents.map((inc, i) => (
            <div key={inc.id || i} style={{ padding: "16px 0", borderBottom: "1px solid var(--rule)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)" }}>{inc.date}</span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>·</span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>{inc.component}</span>
                <span style={{ flex: 1 }}/>
                {inc.duration && <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)" }}>{inc.duration}</span>}
                <SeverityChip s={inc.severity}/>
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-strong)", marginBottom: 4 }}>{inc.title}</div>
              {inc.summary && <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: 0, lineHeight: 1.55 }}>{inc.summary}</p>}
            </div>
          ))}
        </div>
      )}

      {/* ── Methodology ── */}
      <h2 id="methodology" className="display-title" style={{ fontSize: 28, margin: "40px 0 12px" }}>Methodology</h2>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Probes run on-demand from the token portal when the status page is viewed, and sample on each page refresh (every 30 s).
        REST checks use the service health endpoints; WebSocket checks use the public <code className="ic">wss://leandata.uk/stream</code> route.
        Uptime is the fraction of probes that returned success within the timeout window, aggregated daily over 90 days.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>
          探针在状态页浏览时按需运行，每 30 秒自动刷新。REST 检查服务健康端点，WS 检查公开安全 WebSocket 路由。可用性按天聚合，展示 90 天。
        </span>
      </p>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 48px" }}>
        SLO: REST p95 ≤ 250 ms · WS auth ≤ 50 ms · monthly uptime ≥ 99.9 %.
      </p>
    </div>
  );
}

function UptimeBlock({ label, data }) {
  const pct = pctUp(data);
  const num = parseFloat(pct);
  const color = num >= 99.9 ? "var(--ok)" : num >= 99 ? "var(--warn)" : "var(--danger)";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-strong)" }}>{label}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 18, fontWeight: 500, color }}>{pct}</span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>% uptime · 90 days</span>
        </div>
      </div>
      <UptimeGrid data={data}/>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--ink-soft)" }}>
        <span>90 days ago</span>
        <span>today</span>
      </div>
    </div>
  );
}


// ── DocsSite component ──

// DocsSite.jsx — Public Docs Site redesign
// Top bar · hero · tabs (Proxy API / WS usage — Reports removed) · 3-col docs layout

const { useState } = React;

function DocsTopbar({ active = "proxy", onNav }) {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="dot"></span>
        <span><strong>Proxy Docs</strong></span>
      </div>
      <div className="divider"></div>
      <div className="nav">
        <a className={active === "proxy" ? "active" : ""} onClick={() => onNav && onNav("proxy")} style={{ cursor: "pointer" }}>Proxy API</a>
        <a className={active === "fmp" ? "active" : ""} onClick={() => onNav && onNav("fmp")} style={{ cursor: "pointer" }}>FMP data</a>
        <a className={active === "bulk" ? "active" : ""} onClick={() => onNav && onNav("bulk")} style={{ cursor: "pointer" }}>Bulk Download</a>
        <a className={active === "ws" ? "active" : ""} onClick={() => onNav && onNav("ws")} style={{ cursor: "pointer" }}>WS usage</a>
        <a className={active === "status" ? "active" : ""} onClick={() => onNav && onNav("status")} style={{ cursor: "pointer" }}>Status</a>
        <a className={active === "usage" ? "active" : ""} onClick={() => onNav && onNav("usage")} style={{ cursor: "pointer" }}>Usage</a>
        <a href="/updates" style={{ cursor: "pointer" }}>更新 / Updates</a>
      </div>
      <div className="spacer"></div>
      <div className="meta">
        <a href="/" className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }}>Token portal →</a>
      </div>
    </div>
  );
}

function IndexOptionsBanner() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      flexWrap: "wrap",
      padding: "10px 18px",
      borderBottom: "1px solid var(--accent-rule)",
      background: "var(--accent-soft)",
      color: "var(--accent-ink)",
      fontSize: 13,
    }}>
      <span style={{
        padding: "2px 7px",
        borderRadius: 999,
        background: "var(--accent-ink)",
        color: "var(--ink-inverse)",
        fontFamily: "var(--f-mono)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: ".08em",
        textTransform: "uppercase",
      }}>New</span>
      <strong>Alpaca supports index options now.</strong>
      <span>
        Proxy contract discovery and realtime option streams are live for SPX/SPXW, VIX/VIXW, DJX and XSP.
        <span style={{ color: "var(--ink-muted)" }}> 指数期权合约查询与实时行情现已支持。</span>
      </span>
    </div>
  );
}

function DocsSite({ initialTab = "proxy", hideTopbar = false } = {}) {
  const validTabs = ["proxy", "fmp", "fmp-fundamentals", "bulk", "ws", "status", "usage"];
  const fmpOverviewIds = ["fmp-data-overview", "fmp-snapshot-boundary", "fmp-future-data-families"];
  const hashTab = typeof window !== "undefined" && window.location.hash ? window.location.hash.slice(1) : "";
  const startTab = validTabs.includes(hashTab)
    ? hashTab
    : fmpOverviewIds.includes(hashTab)
      ? "fmp"
      : hashTab.startsWith("fmp-")
        ? "fmp-fundamentals"
        : initialTab;
  const [tab, setTab] = useState(startTab);

  React.useEffect(() => {
    const scrollToHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id || validTabs.includes(id)) return;
      window.requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ block: "start" });
      });
    };
    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, [tab]);

  const showTopbar = !hideTopbar;
  const visibleTab = tab === "fmp-fundamentals" ? "fmp" : tab;
  const threeColumnTab = tab === "proxy" || tab === "ws" || tab === "fmp-fundamentals";

  return (
    <div className="proxy-app" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {showTopbar && <DocsTopbar active={visibleTab} onNav={setTab} />}
      <IndexOptionsBanner />

      {/* Hero */}
      <div className="docs-hero" style={{
        padding: "44px 64px 28px",
        borderBottom: "1px solid var(--rule)",
        background: "var(--bg-paper)",
        position: "relative",
        overflow: "hidden",
      }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Reference · live docs</div>
        <h1 className="display-title" style={{ fontSize: 64, margin: "0 0 14px" }}>
          Stock Options Proxy <span style={{ fontStyle: "italic", color: "var(--accent-ink)" }}>API</span>
        </h1>
        <p style={{ color: "var(--ink-muted)", maxWidth: 640, fontSize: 15, margin: 0 }}>
          Real-time US equities, options, crypto and news — one token, no Alpaca key needed.
          The <strong style={{ color: "var(--ink-strong)" }}>Proxy API</strong> covers REST endpoints and tier management;
          <strong style={{ color: "var(--ink-strong)" }}>WS usage</strong> covers the 6 realtime streaming channels.
        </p>

        {/* Tab strip */}
        <div className="docs-tabs" style={{ marginTop: 32, display: "flex", gap: 0, borderBottom: "1px solid var(--rule)", marginInline: -64, paddingInline: 64 }}>
          <Tab id="proxy" tab={visibleTab} setTab={setTab} label="Proxy API" count="45+ endpoints" />
          <Tab id="fmp" tab={visibleTab} setTab={setTab} label="FMP data" count="overview" />
          <Tab id="bulk" tab={visibleTab} setTab={setTab} label="Bulk Download" count="¥50 / 50GB" />
          <Tab id="ws" tab={visibleTab} setTab={setTab} label="WS usage" count="6 channels" />
          <Tab id="status" tab={visibleTab} setTab={setTab} label="Status" count="live" />
          <Tab id="usage" tab={visibleTab} setTab={setTab} label="Usage" count="30d" />
          <div style={{ flex: 1 }}></div>
          <div className="docs-last-sync" style={{ alignSelf: "flex-end", paddingBottom: 10, color: "var(--ink-soft)", fontFamily: "var(--f-mono)", fontSize: 11 }}>
            last sync · 2026-07-29 · public REST / RT / WSS
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="docs-content-grid" style={{ display: "grid", gridTemplateColumns: threeColumnTab ? "220px 1fr 220px" : "1fr", flex: 1 }}>
        {threeColumnTab && <SideNav tab={tab} />}
        <main className={tab === "bulk" ? "bulk-main" : ""} style={{ padding: threeColumnTab ? "40px 56px" : "36px 32px", background: "var(--bg-canvas)" }}>
          {tab === "proxy" ? <ProxyApiBody /> : tab === "fmp" ? <FmpDataOverview openFundamentals={() => setTab("fmp-fundamentals")} /> : tab === "fmp-fundamentals" ? <FmpFundamentalsBody /> : tab === "bulk" ? <BulkOrderBody /> : tab === "ws" ? <WsUsageBody /> : tab === "usage" ? (typeof UsagePage !== "undefined" ? React.createElement(UsagePage) : React.createElement("div", null, "Loading usage…")) : (React.createElement(StatusBody))}
        </main>
        {threeColumnTab && <OnThisPage tab={tab} />}
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
    { title: "REST History", items: ["history/bars", "history/news", "stock trade+quote"] },
    { title: "Index Data", items: ["index history"] },
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
  ] : tab === "fmp-fundamentals" ? [
    { title: "FMP Fundamentals", items: ["FMP fundamentals overview", "Request contract", "Response metadata"] },
    { title: "Market history", items: ["historical-price-eod/full"] },
    { title: "Market snapshots", items: ["quote", "quote-short", "aftermarket-quote", "aftermarket-trade", "stock-price-change", "market-capitalization", "historical-market-capitalization", "batch-quote", "batch-quote-short", "batch-aftermarket-quote", "batch-aftermarket-trade", "market-capitalization-batch"] },
    { title: "Company reference", items: ["profile", "stock-peers", "key-executives", "company-notes", "financial-reports-dates", "employee-count", "historical-employee-count", "shares-float", "shares-float-all", "dividends", "splits"] },
    { title: "Financial statements", items: ["income-statement", "balance-sheet-statement", "cash-flow-statement", "PIT statements"] },
    { title: "Ratios & metrics", items: ["ratios", "ratios-ttm", "key-metrics", "key-metrics-ttm"] },
    { title: "Growth & valuation", items: ["income-statement-growth", "balance-sheet-statement-growth", "cash-flow-statement-growth", "financial-growth", "enterprise-values", "financial-scores"] },
    { title: "Research & valuation", items: ["analyst-estimates", "price-target-summary", "price-target-consensus", "discounted-cash-flow", "custom-discounted-cash-flow", "levered-discounted-cash-flow", "custom-levered-discounted-cash-flow", "owner-earnings", "earnings", "grades", "grades-consensus", "grades-historical", "ratings-snapshot", "ratings-historical"] },
    { title: "Revenue & directories", items: ["revenue-geographic-segmentation", "revenue-product-segmentation", "available-countries", "available-exchanges", "available-industries", "available-sectors", "cik-list", "delisted-companies", "financial-statement-symbol-list", "stock-list", "symbol-change"] },
    { title: "Coverage", items: ["Snapshot boundary", "Future data families"] },
  ] : tab === "ws" ? [
    { title: "Connecting", items: ["Endpoint", "Auth message", "Heartbeat"] },
    { title: "Channels", items: ["stocks", "options", "crypto", "news", "overnight"] },
    { title: "Messages", items: ["Subscribe", "Unsubscribe", "Trade", "Quote", "Bar"] },
    { title: "Operations", items: ["Reconnect", "Backpressure"] },
  ] : [
    { title: "System", items: ["Overview", "Components", "Latency"] },
    { title: "History", items: ["Uptime", "Incidents", "Methodology"] },
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
    const FMP_ID_MAP = {
      "FMP fundamentals overview": "fmp-fundamentals-overview",
      "Request contract": "fmp-request-contract",
      "Response metadata": "fmp-response-metadata",
      "historical-price-eod/full": "fmp-historical-price-eod",
      "income-statement": "fmp-income-statement",
      "balance-sheet-statement": "fmp-balance-sheet-statement",
      "cash-flow-statement": "fmp-cash-flow-statement",
      "PIT statements": "fmp-pit-statements",
      "ratios": "fmp-ratios",
      "ratios-ttm": "fmp-ratios-ttm",
      "key-metrics": "fmp-key-metrics",
      "key-metrics-ttm": "fmp-key-metrics-ttm",
      "income-statement-growth": "fmp-income-statement-growth",
      "balance-sheet-statement-growth": "fmp-balance-sheet-statement-growth",
      "cash-flow-statement-growth": "fmp-cash-flow-statement-growth",
      "financial-growth": "fmp-financial-growth",
      "enterprise-values": "fmp-enterprise-values",
      "financial-scores": "fmp-financial-scores",
    };
    const ID_MAP = {'Overview': 'overview', 'Authentication': 'authentication', 'Tiers & permissions': 'tiers-permissions', 'register': 'post-register', 'check-status': 'post-check-status', 'generate-token': 'post-generate-token', 'history/bars': 'post-v1-history-bars', 'index history': 'get-post-v1-indices-history', 'history/news': 'post-v1-history-news', 'stock trade+quote': 'post-v1-stock-history-trade-quote', 'overview': 'stock-data-availability', 'auctions': 'stock-auctions', 'multi bars': 'stock-bars', 'multi latest bars': 'stock-latest-bars', 'condition codes': 'stock-condition-codes', 'exchange codes': 'stock-exchange-codes', 'multi quotes': 'stock-quotes', 'multi latest quotes': 'stock-latest-quotes', 'multi snapshots': 'stock-snapshots', 'multi trades': 'stock-trades', 'multi latest trades': 'stock-latest-trades', 'single bars': 'stock-single-bars', 'single latest bar': 'stock-single-latest-bar', 'single quotes': 'stock-single-quotes', 'single latest quote': 'stock-single-latest-quote', 'single snapshot': 'stock-single-snapshot', 'single trades': 'stock-single-trades', 'single latest trade': 'stock-single-latest-trade', 'provider model': 'provider-fallback-cache', 'contracts': 'post-v1-options-contracts', 'snapshots': 'post-v1-options-snapshots', 'quote': 'post-v1-options-snapshots-quote', 'snapshot trade': 'post-v1-options-snapshots-trade', 'open interest': 'post-v1-options-snapshots-open-interest', 'expiry': 'post-v1-options-snapshots-expiry', 'snapshot ohlc': 'post-v3-option-direct-value', 'bars': 'post-v1-history-options-bars', 'eod': 'post-v1-history-options-eod', 'history open interest': 'post-v1-options-open-interest', 'trades': 'post-v1-history-options-trades', 'history ohlc': 'post-v3-option-direct-value', 'direct endpoints': 'post-v3-option-direct-value', 'orderbooks': 'post-v1-crypto-us-latest-orderbooks', 'login': 'post-admin-login', 'pending': 'get-admin-pending', 'approve': 'post-admin-approve', 'reject': 'post-admin-reject', 'Error codes': 'error-codes', 'Rate limits': 'rate-limits', 'FMP fundamentals overview': 'fmp-fundamentals-overview', 'Request contract': 'fmp-request-contract', 'Response metadata': 'fmp-response-metadata', 'historical-price-eod/full': 'fmp-historical-price-eod', 'income-statement': 'fmp-income-statement', 'balance-sheet-statement': 'fmp-balance-sheet-statement', 'cash-flow-statement': 'fmp-cash-flow-statement', 'PIT statements': 'fmp-pit-statements', 'ratios': 'fmp-ratios', 'ratios-ttm': 'fmp-ratios-ttm', 'key-metrics': 'fmp-key-metrics', 'key-metrics-ttm': 'fmp-key-metrics-ttm', 'income-statement-growth': 'fmp-income-statement-growth', 'balance-sheet-statement-growth': 'fmp-balance-sheet-statement-growth', 'cash-flow-statement-growth': 'fmp-cash-flow-statement-growth', 'financial-growth': 'fmp-financial-growth', 'enterprise-values': 'fmp-enterprise-values', 'financial-scores': 'fmp-financial-scores', 'Snapshot boundary': 'fmp-snapshot-boundary', 'Future data families': 'fmp-future-data-families'};
    const getId = (label) => tab === "fmp-fundamentals"
      ? FMP_ID_MAP[label] || `fmp-${slugify(label)}`
      : ID_MAP[label] || slugify(label);

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
    : tab === "fmp-fundamentals"
    ? [
      ["FMP overview", "fmp-fundamentals-overview"],
      ["Request examples", "fmp-request-examples"],
      ["Endpoint sections", "fmp-endpoint-subsections"],
      ["Request contract", "fmp-request-contract"],
      ["Response metadata", "fmp-response-metadata"],
    ]
    : tab === "ws"
    ? ["Connect", "Authenticate", "Subscribe", "Message shapes", "Reconnect"]
    : ["Overview", "Components", "Latency", "Uptime", "Incidents"];
  return (
    <aside style={{
      padding: "40px 24px",
      borderLeft: "1px solid var(--rule)",
      background: "var(--bg-canvas)", fontSize: 12.5, position: "sticky", top: 0, height: "100vh", overflow: "auto"
    }}>
      <div className="eyebrow" style={{ marginBottom: 12, color: "var(--ink-soft)" }}>On this page</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((item, i) => {
          const label = Array.isArray(item) ? item[0] : item;
          const id = Array.isArray(item) ? item[1] : slugify(item);
          return (
          <li key={i}>
            <a href={"#" + id} style={{textDecoration: "none",  color: activeId === id ? "var(--ink-strong)" : "var(--ink-muted)" }}>{label}</a>
          </li>
          );
        })}
      </ul>

      <TokenCard />
    </aside>
  );
}

function TokenCard() {
  const [user, setUser] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState("");
  const [tokenData, setTokenData] = React.useState(null);

  const handleGenerate = async () => {
    if (!user || !phone) { setErrorMsg("Please enter both fields."); return; }
    setLoading(true); setErrorMsg(""); setTokenData(null);
    try {
      const res = await fetch('/api/generate-token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, phone })
      });
      const data = await res.json();
      if (data.success) {
        setTokenData({ token: data.token, expiry: new Date(data.expiry).toLocaleString(), role: data.role || "standard" });
      } else { setErrorMsg(data.message); }
    } catch (e) { setErrorMsg("Network error."); }
    finally { setLoading(false); }
  };

  const handleCopy = () => { navigator.clipboard.writeText(tokenData.token); };

  return (
    <div style={{ marginTop: 28, padding: 14, borderRadius: 8, background: "var(--bg-paper)", border: "1px solid var(--rule)" }}>
      <div className="eyebrow" style={{ marginBottom: 8, color: "var(--ink-soft)" }}>Generate token</div>
      {!tokenData ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input className="input mono" placeholder="Username" value={user} onChange={e => setUser(e.target.value)}
              style={{ fontSize: 12, padding: "8px 10px" }} />
            <input className="input mono" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)}
              style={{ fontSize: 12, padding: "8px 10px" }} />
            <button className="btn" onClick={handleGenerate} disabled={loading}
              style={{ width: "100%", justifyContent: "center", fontSize: 12, padding: "8px 10px" }}>
              {loading ? "..." : "Generate →"}
            </button>
          </div>
          {errorMsg && <p style={{ margin: "8px 0 0", color: "#d9534f", fontSize: 11 }}>{errorMsg}</p>}
          <div style={{ marginTop: 12, fontSize: 11, color: "var(--ink-muted)", display: "flex", justifyContent: "space-between" }}>
            <span>New user?</span>
            <a href="/register" style={{ color: "var(--accent-ink)", textDecoration: "none" }}>Register →</a>
          </div>
        </>
      ) : (
        <>
          <div style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-rule)", borderRadius: 6, padding: "6px 10px", fontSize: 11, color: "var(--accent-ink)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--ok)" }}></span>
            Token issued
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
            <input className="input mono" readOnly value={tokenData.token} style={{ fontSize: 10, flex: 1, padding: "6px 8px" }} />
            <button className="btn" style={{ padding: "0 10px", fontSize: 11 }} onClick={handleCopy}>Copy</button>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--ink-muted)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Expires</span><span style={{ fontFamily: "var(--f-mono)" }}>{tokenData.expiry}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span>Role</span><span className={"tier " + tokenData.role}>{tokenData.role}</span>
            </div>
          </div>
          <button className="btn ghost" onClick={() => { setTokenData(null); setUser(""); setPhone(""); }}
            style={{ width: "100%", justifyContent: "center", fontSize: 11, padding: "6px", marginTop: 8 }}>
            Generate another
          </button>
        </>
      )}
    </div>
  );
}

// Stable public endpoints. Origin routing can move during failover.
const REST_BASE  = "https://api.leandata.uk";
const RT_BASE    = "https://rt-api.leandata.uk";
const TOKEN_BASE = "https://leandata.uk";
const WS_BASE    = "wss://leandata.uk/stream";

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
        examplePath: "/v2/stocks/bars?symbols=AAPL&timeframe=1Day&start=2026-05-20&end=2026-05-21&limit=1&feed=sip",
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
        examplePath: "/v2/stocks/bars/latest?symbols=AAPL&feed=sip",
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
        examplePath: "/v2/stocks/quotes?symbols=AAPL&start=2026-05-20T13:30:00Z&end=2026-05-20T14:00:00Z&limit=1&feed=sip",
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
        examplePath: "/v2/stocks/quotes/latest?symbols=AAPL&feed=sip",
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
        examplePath: "/v2/stocks/snapshots?symbols=AAPL&feed=sip",
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
        examplePath: "/v2/stocks/trades?symbols=AAPL&start=2026-05-20T13:30:00Z&end=2026-05-20T14:00:00Z&limit=1&feed=sip",
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
        examplePath: "/v2/stocks/trades/latest?symbols=AAPL&feed=sip",
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
        examplePath: "/v2/stocks/AAPL/bars?timeframe=1Day&start=2026-05-20&end=2026-05-21&limit=1&feed=sip",
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
        examplePath: "/v2/stocks/AAPL/bars/latest?feed=sip",
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
        examplePath: "/v2/stocks/AAPL/quotes?start=2026-05-20T13:30:00Z&end=2026-05-20T14:00:00Z&limit=1&feed=sip",
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
        examplePath: "/v2/stocks/AAPL/quotes/latest?feed=sip",
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
        examplePath: "/v2/stocks/AAPL/snapshot?feed=sip",
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
        examplePath: "/v2/stocks/AAPL/trades?start=2026-05-20T13:30:00Z&end=2026-05-20T14:00:00Z&limit=1&feed=sip",
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
        examplePath: "/v2/stocks/AAPL/trades/latest?feed=sip",
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
    </section>
  );
}

const BULK_SCHEMA_OPTIONS = [
  {
    id: "stock_minute",
    category: "Stocks",
    label: "Stock bars · 1 minute",
    detail: "SIP minute OHLCV · measured average ~49 MB per ticker for the reference archive",
  },
  {
    id: "stock_daily",
    category: "Stocks",
    label: "Stock bars · daily",
    detail: "SIP daily OHLCV · measured average ~0.4 MB per ticker",
  },
  {
    id: "options_eod_theta",
    category: "Options",
    label: "Option EOD · complete chain",
    detail: "ThetaData complete-chain EOD · measured average ~360 MB per underlying",
  },
  {
    id: "options_eod_alpaca",
    category: "Options",
    label: "Option EOD · traded contracts",
    detail: "Alpaca traded-contract EOD · measured average ~76 MB per underlying",
  },
  {
    id: "options_oi",
    category: "Options",
    label: "Option open interest",
    detail: "Historical contract-level OI · measured average ~167 MB per underlying",
  },
  {
    id: "options_contracts",
    category: "Options",
    label: "Option contracts",
    detail: "Contract reference rows · measured average ~27 MB per underlying",
  },
];

function formatBulkBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(2)} ${units[unit]}`;
}

function BulkOrderBody() {
  const [tickerText, setTickerText] = React.useState("AAPL, MSFT, NVDA");
  const [schemas, setSchemas] = React.useState(["options_eod_theta", "options_oi", "stock_minute"]);
  const [start, setStart] = React.useState("2021-01-01");
  const [end, setEnd] = React.useState("2026-07-22");
  const [estimate, setEstimate] = React.useState(null);
  const [username, setUsername] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [customRequest, setCustomRequest] = React.useState("");
  const [note, setNote] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [messageType, setMessageType] = React.useState("");

  const tickers = [...new Set(
    tickerText.split(/[\s,]+/).map(value => value.trim().toUpperCase()).filter(Boolean)
  )];

  const invalidateEstimate = () => {
    setEstimate(null);
    setMessage("");
    setMessageType("");
  };

  const toggleSchema = id => {
    setSchemas(current => current.includes(id)
      ? current.filter(value => value !== id)
      : [...current, id]);
    invalidateEstimate();
  };

  const requestEstimate = async () => {
    setLoading(true);
    setMessage("");
    setMessageType("");
    try {
      const response = await fetch("/api/bulk/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers, schemas, start, end }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Estimate failed.");
      setEstimate(data);
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  const submitOrder = async () => {
    if (schemas.length === 0 && !customRequest.trim()) {
      setMessage("请选择至少一个数据集，或填写自定义 endpoint / 数据需求。");
      setMessageType("error");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setMessage("请输入有效邮箱。");
      setMessageType("error");
      return;
    }
    setLoading(true);
    setMessage("");
    setMessageType("");
    try {
      const response = await fetch("/api/bulk/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickers,
          schemas,
          start,
          end,
          username: username.trim(),
          phone: phone.trim(),
          email: email.trim(),
          custom_request: customRequest.trim(),
          note,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Order request failed.");
      setMessage(
        data.manual_quote_required
          ? `申请 ${data.order_id.slice(0, 8)} 已提交 · Kai 会根据联系方式与你确认并人工报价`
          : `订单 ${data.order_id.slice(0, 8)} 已提交 · 当前估价 ¥${data.estimated_price ?? "待确认"}`
      );
      setMessageType("success");
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>One-off product · manual fulfillment</div>
      <h2 className="display-title" style={{ fontSize: 44, margin: "0 0 10px" }}>Bulk Download</h2>
      <p style={{ color: "var(--ink-muted)", maxWidth: 780, margin: "0 0 28px", lineHeight: 1.65 }}>
        Bulk Download 是一次性数据导出，不再作为 Basic REST 月度套餐销售。
        当前估价基于已测量的 2021-01-01 至 2026-07-22 完整归档窗口：
        前 50 GB 为 ¥50，之后每开始 1 GB 加 ¥1。最终价格按实际交付切片的未压缩字节计算。
      </p>

      <div className="bulk-layout" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(300px, .75fr)", gap: 20, alignItems: "start" }}>
        <div>
          <div className="card" style={{ padding: 22, marginBottom: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>1 · Tickers</div>
            <textarea
              className="input mono"
              value={tickerText}
              onChange={event => { setTickerText(event.target.value); invalidateEstimate(); }}
              rows={4}
              placeholder="AAPL, MSFT, NVDA"
              style={{ width: "100%", resize: "vertical", lineHeight: 1.6 }}
            />
            <div style={{ marginTop: 8, color: "var(--ink-soft)", fontSize: 12 }}>
              {tickers.length} unique ticker{tickers.length === 1 ? "" : "s"} · 最多 1,000 个
            </div>
          </div>

          <div className="card" style={{ padding: 22, marginBottom: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>2 · Requested range</div>
            <div className="bulk-date-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ color: "var(--ink-muted)", fontSize: 12 }}>Start
                <input className="input mono" type="date" value={start} onChange={event => { setStart(event.target.value); invalidateEstimate(); }} style={{ width: "100%", marginTop: 6 }} />
              </label>
              <label style={{ color: "var(--ink-muted)", fontSize: 12 }}>End
                <input className="input mono" type="date" value={end} onChange={event => { setEnd(event.target.value); invalidateEstimate(); }} style={{ width: "100%", marginTop: 6 }} />
              </label>
            </div>
            <div style={{ marginTop: 8, color: "var(--ink-soft)", fontSize: 12 }}>
              当前自动估价使用完整参考窗口；日期范围会保存在订单中，由交付时按实际切片结算。
            </div>
          </div>

          <div className="card" style={{ padding: 22 }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>3 · Measured datasets</div>
            <div className="bulk-dataset-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              {BULK_SCHEMA_OPTIONS.map(option => {
                const active = schemas.includes(option.id);
                return (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => toggleSchema(option.id)}
                    style={{
                      textAlign: "left",
                      padding: 14,
                      borderRadius: 8,
                      cursor: "pointer",
                      border: `1px solid ${active ? "var(--accent)" : "var(--rule)"}`,
                      background: active ? "var(--accent-soft)" : "var(--bg-paper)",
                      color: "var(--ink-base)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
                      <strong>{option.label}</strong>
                      <span className="mono" style={{ fontSize: 10, color: "var(--accent-ink)" }}>{active ? "SELECTED" : ""}</span>
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--ink-soft)", marginBottom: 6 }}>{option.category} · {option.id}</div>
                    <div style={{ color: "var(--ink-muted)", fontSize: 12, lineHeight: 1.45 }}>{option.detail}</div>
                  </button>
                );
              })}
            </div>
            <div style={{ borderTop: "1px solid var(--rule)", marginTop: 18, paddingTop: 18 }}>
              <label style={{ color: "var(--ink-strong)", fontSize: 13, fontWeight: 600 }}>
                没找到需要的 endpoint / dataset？
              </label>
              <textarea
                className="input"
                value={customRequest}
                onChange={event => {
                  setCustomRequest(event.target.value);
                  setMessage("");
                  setMessageType("");
                }}
                maxLength={2000}
                rows={5}
                placeholder={"可直接描述需求，例如：\n需要 /v1/options/snapshot/gex 的历史每日快照，标的为 SPY、QQQ，日期 2024-01-01 至今，希望 CSV 交付。"}
                style={{ width: "100%", resize: "vertical", lineHeight: 1.55, marginTop: 8 }}
              />
              <div style={{ marginTop: 7, color: "var(--ink-soft)", fontSize: 12 }}>
                可以不选择上面的标准数据集。提交后会进入 admin，由 Kai 根据你留下的电话和邮箱人工联系报价。
              </div>
            </div>
          </div>
        </div>

        <div className="card bulk-estimate-panel" style={{ padding: 22, position: "sticky", top: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Estimate & order</div>
          {estimate ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                <div style={{ padding: 12, background: "var(--bg-canvas)", borderRadius: 7 }}>
                  <div className="eyebrow">Billable raw</div>
                  <div className="display-title" style={{ fontSize: 24 }}>{formatBulkBytes(estimate.estimated_raw_bytes)}</div>
                </div>
                <div style={{ padding: 12, background: "var(--bg-canvas)", borderRadius: 7 }}>
                  <div className="eyebrow">Expected transfer</div>
                  <div className="display-title" style={{ fontSize: 24 }}>{formatBulkBytes(estimate.estimated_transfer_bytes)}</div>
                </div>
              </div>
              <div style={{ borderTop: "1px solid var(--rule)", borderBottom: "1px solid var(--rule)", padding: "14px 0", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ color: "var(--ink-muted)" }}>Reference-window estimate</span>
                <strong className="display-title" style={{ fontSize: 34 }}>¥{estimate.pricing?.estimated_price ?? "—"}</strong>
              </div>
            </>
          ) : (
            <p style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55, margin: "0 0 18px" }}>
              标准数据集可生成参考估价；自定义 endpoint 申请会直接进入人工报价队列。
              订单提交时服务器会重新计算标准数据集价格，不能使用浏览器篡改后的价格。
            </p>
          )}

          <button
            type="button"
            className="btn"
            onClick={requestEstimate}
            disabled={loading || tickers.length === 0 || schemas.length === 0}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {loading ? "Calculating…" : "Calculate size & price"}
          </button>

          <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--rule)", display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ color: "var(--ink-muted)", fontSize: 12, lineHeight: 1.5 }}>
              联系方式用于确认数据范围、交付格式和最终报价。
            </div>
            <input className="input" placeholder="Username · required" value={username} onChange={event => setUsername(event.target.value)} />
            <input className="input" placeholder="Phone · required" value={phone} onChange={event => setPhone(event.target.value)} />
            <input className="input" type="email" placeholder="Email · required" value={email} onChange={event => setEmail(event.target.value)} />
            <textarea className="input" rows={3} placeholder="Delivery format or additional notes · optional" value={note} onChange={event => setNote(event.target.value)} />
            <button
              type="button"
              className="btn primary"
              onClick={submitOrder}
              disabled={
                loading
                || !username.trim()
                || !phone.trim()
                || !email.trim()
                || (schemas.length === 0 && !customRequest.trim())
                || (schemas.length > 0 && tickers.length === 0)
              }
              style={{ width: "100%", justifyContent: "center" }}
            >
              Submit request →
            </button>
          </div>

          {message && (
            <div style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 6,
              color: messageType === "success" ? "var(--ok)" : "var(--danger)",
              background: messageType === "success" ? "var(--ok-soft)" : "var(--danger-soft)",
              fontSize: 12,
            }}>{message}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function FmpDataOverview({ openFundamentals }) {
  const panel = {
    background: "var(--bg-paper)",
    border: "1px solid var(--rule)",
    borderRadius: 10,
    padding: "18px 20px",
  };
  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>FMP-compatible archive data · Premium</div>
      <h2 id="fmp-data-overview" className="display-title" style={{ fontSize: 42, margin: "0 0 10px" }}>FMP data / FMP 数据说明</h2>
      <p style={{ fontSize: 16, color: "var(--ink-muted)", lineHeight: 1.65, margin: "0 0 24px", maxWidth: 820 }}>
        这是 Leandata 的 FMP-compatible immutable archive surface：使用 Leandata Bearer token，返回保留的原始 FMP-shaped JSON。
        详细 request、response 和每条 route 不放在这一页；请进入左侧 API reference 的 <strong style={{ color: "var(--ink-strong)" }}>FMP Fundamentals</strong> session。
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 22 }}>
        <div style={panel}>
          <div className="eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>Access</div>
          <div style={{ color: "var(--ink-strong)", fontWeight: 600, marginBottom: 6 }}>Premium</div>
          <div style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55 }}>Use <code>Authorization: Bearer TOKEN</code>. Do not pass an FMP <code>apikey</code>.</div>
        </div>
        <div style={panel}>
          <div className="eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>Package identity</div>
          <div style={{ color: "var(--ink-strong)", fontWeight: 600, marginBottom: 6 }}>Immutable snapshot</div>
          <div style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55 }}>Responses identify the captured package. A later upstream revision does not rewrite that package.</div>
        </div>
        <div style={panel}>
          <div className="eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>PIT boundary</div>
          <div style={{ color: "var(--ink-strong)", fontWeight: 600, marginBottom: 6 }}>Not universal</div>
          <div style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55 }}>Only statement PIT routes have an explicit visibility policy. Snapshot families are not strict PIT.</div>
        </div>
      </div>
      <div style={{ ...panel, borderColor: "var(--accent-rule)", background: "var(--accent-soft)", marginBottom: 22 }}>
        <strong style={{ color: "var(--accent-ink)" }}>Endpoint reference moved.</strong>
        <span style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.6 }}> Use the FMP Fundamentals sidebar session for individual endpoint sections, exact parameters, response metadata and coverage.</span>
        <button onClick={openFundamentals} className="btn" style={{ marginLeft: 12, padding: "7px 11px", fontSize: 12 }}>Open FMP Fundamentals →</button>
      </div>
      <h3 id="fmp-snapshot-boundary" className="display-title" style={{ fontSize: 26, margin: "0 0 8px" }}>Snapshot, revisions and future vintages</h3>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.7, margin: "0 0 22px" }}>
        This package is a captured bulk snapshot. Upstream filings, amendments and normalization can revise historical values later. Package pinning reproduces one captured vintage, but does not alone prove what was knowable on every historical date. We will add independent versioned PIT-like refreshes with capture and visibility timestamps; native FMP forwarding remains a separate future surface.
      </p>
      <h3 id="fmp-future-data-families" className="display-title" style={{ fontSize: 26, margin: "0 0 8px" }}>Future data families</h3>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.7, margin: 0 }}>
        Revision-heavy families such as estimates, earnings, ratings and DCF need their own contract before any PIT claim. Ultimate will separately add institutional and ETF holdings, with the same immutable-vintage discipline.
      </p>
    </div>
  );
}

function FmpEndpointSection({ id, route, title, params, note }) {
  return (
    <section style={{ padding: "20px 0", borderTop: "1px solid var(--rule)" }}>
      <h3 id={id} className="display-title" style={{ fontSize: 25, margin: "0 0 7px" }}>{title}</h3>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 13, color: "var(--accent-ink)", marginBottom: 8 }}>{route}</div>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.65, margin: "0 0 10px" }}>
        <code>GET</code> or <code>POST</code> with <code>Authorization: Bearer TOKEN</code>. Parameters: {params}.
      </p>
      <p style={{ color: "var(--ink-soft)", fontSize: 13, lineHeight: 1.55, margin: 0 }}>{note}</p>
    </section>
  );
}

function FmpFundamentalsBody() {
  const panel = {
    background: "var(--bg-paper)",
    border: "1px solid var(--rule)",
    borderRadius: 10,
    padding: "18px 20px",
  };
  const mono = { fontFamily: "var(--f-mono)", fontSize: 12 };
  const rawSnapshotEndpoints = [
    ["/stable/quote", "最新报价 / Quote", "symbol; optional limit", "当前 package 内的原始报价快照。不是实时行情，也不会走上游补数。"],
    ["/stable/quote-short", "简版报价 / Quote short", "symbol; optional limit", "简版字段按 source 原样返回。"],
    ["/stable/aftermarket-quote", "盘后报价 / Aftermarket quote", "symbol; optional limit", "仅代表已捕获的盘后快照。"],
    ["/stable/aftermarket-trade", "盘后成交 / Aftermarket trade", "symbol; optional limit", "仅代表已捕获的盘后成交快照。"],
    ["/stable/stock-price-change", "价格变化 / Stock price change", "symbol; optional limit", "源端计算字段作为 package snapshot 返回。"],
    ["/stable/market-capitalization", "市值快照 / Market capitalization", "symbol; optional limit", "当前捕获市值，不是严格历史 PIT。"],
    ["/stable/historical-market-capitalization", "历史市值 / Historical market capitalization", "symbol; optional from, to, limit", "日期筛选只作用于 source row 的 date 字段；没有匹配数据时返回完整导入语义下的空数组。"],
    ["/stable/batch-quote", "批量报价 / Batch quote", "optional symbols, limit", "只查询 package 中已捕获的 batch response；可用 symbols 缩小其中的记录。"],
    ["/stable/batch-quote-short", "批量简版报价 / Batch quote short", "optional symbols, limit", "只查询 package 中已捕获的 batch response。"],
    ["/stable/batch-aftermarket-quote", "批量盘后报价 / Batch aftermarket quote", "optional symbols, limit", "只查询 package 中已捕获的 batch response。"],
    ["/stable/batch-aftermarket-trade", "批量盘后成交 / Batch aftermarket trade", "optional symbols, limit", "只查询 package 中已捕获的 batch response。"],
    ["/stable/market-capitalization-batch", "批量市值 / Market capitalization batch", "optional symbols, limit", "只查询 package 中已捕获的 batch response。"],
    ["/stable/profile", "公司资料 / Profile", "exactly one of symbol or cik; optional limit", "symbol 和 CIK 是两个独立的已捕获 source member；不把它当作实时 company master。"],
    ["/stable/stock-peers", "同业公司 / Stock peers", "symbol; optional limit", "上游识别的 peers snapshot。"],
    ["/stable/key-executives", "管理层 / Key executives", "symbol; optional limit", "公司资料快照；人员信息可能随后变化。"],
    ["/stable/company-notes", "公司备注 / Company notes", "symbol; optional limit", "原始 source notes，不进行本地解释或归一化。"],
    ["/stable/financial-reports-dates", "财报日期 / Financial reports dates", "symbol; optional limit", "披露日历快照，不构成可见性时间线。"],
    ["/stable/employee-count", "员工数 / Employee count", "symbol; optional limit", "当前 source snapshot。"],
    ["/stable/historical-employee-count", "员工数历史 / Historical employee count", "symbol; optional limit", "历史字段的已捕获 package vintage。"],
    ["/stable/shares-float", "流通股 / Shares float", "symbol; optional limit", "当前 source snapshot。"],
    ["/stable/shares-float-all", "全部流通股列表 / Shares float all", "optional limit", "只包含本 package 捕获到的分页。"],
    ["/stable/dividends", "分红 / Dividends", "symbol; optional from, to, limit", "事件行按 source 原样返回；修订不会回写本 package。"],
    ["/stable/splits", "拆股 / Splits", "symbol; optional from, to, limit", "事件行按 source 原样返回。"],
    ["/stable/analyst-estimates", "分析师预期 / Analyst estimates", "symbol; optional limit", "目前仅是已捕获的 annual source snapshot；绝不宣称为 estimates PIT。"],
    ["/stable/price-target-summary", "目标价摘要 / Price target summary", "symbol; optional limit", "当前 package snapshot。"],
    ["/stable/price-target-consensus", "目标价共识 / Price target consensus", "symbol; optional limit", "当前 package snapshot。"],
    ["/stable/discounted-cash-flow", "DCF / Discounted cash flow", "symbol; optional limit", "源端 DCF 结果；模型输入与修订历史未在此 endpoint 重建。"],
    ["/stable/custom-discounted-cash-flow", "自定义 DCF / Custom DCF", "symbol; optional limit", "源端自定义 DCF snapshot。"],
    ["/stable/levered-discounted-cash-flow", "杠杆 DCF / Levered DCF", "symbol; optional limit", "源端 leverage-aware DCF snapshot。"],
    ["/stable/custom-levered-discounted-cash-flow", "自定义杠杆 DCF / Custom levered DCF", "symbol; optional limit", "源端自定义 leverage-aware DCF snapshot。"],
    ["/stable/owner-earnings", "Owner earnings", "symbol; optional limit", "源端计算字段的 immutable snapshot。"],
    ["/stable/earnings", "业绩事件 / Earnings", "symbol; optional from, to, limit", "事件行已捕获但没有独立 revision/PIT contract。"],
    ["/stable/grades", "评级 / Grades", "symbol; optional limit", "原始评级记录 snapshot。"],
    ["/stable/grades-consensus", "评级共识 / Grades consensus", "symbol; optional limit", "当前共识 snapshot。"],
    ["/stable/grades-historical", "评级历史 / Grades historical", "symbol; optional limit", "已捕获历史 rows，不等于历史每时点可见性。"],
    ["/stable/ratings-snapshot", "评分 / Ratings snapshot", "symbol; optional limit", "当前评分 snapshot。"],
    ["/stable/ratings-historical", "评分历史 / Ratings historical", "symbol; optional limit", "已捕获历史 rows，不等于 revision timeline。"],
    ["/stable/revenue-geographic-segmentation", "地域收入 / Revenue geographic segmentation", "symbol; optional limit", "公司披露的地域收入 source rows。"],
    ["/stable/revenue-product-segmentation", "产品收入 / Revenue product segmentation", "symbol; optional limit", "公司披露的产品收入 source rows。"],
    ["/stable/available-countries", "可用国家 / Available countries", "optional limit", "仅当前 package captured catalog。"],
    ["/stable/available-exchanges", "可用交易所 / Available exchanges", "optional limit", "仅当前 package captured catalog。"],
    ["/stable/available-industries", "可用行业 / Available industries", "optional limit", "仅当前 package captured catalog。"],
    ["/stable/available-sectors", "可用板块 / Available sectors", "optional limit", "仅当前 package captured catalog。"],
    ["/stable/cik-list", "CIK 列表 / CIK list", "optional limit", "只包含当前 package 捕获的分页。"],
    ["/stable/delisted-companies", "退市公司 / Delisted companies", "optional limit", "只包含当前 package 捕获的分页。"],
    ["/stable/financial-statement-symbol-list", "财报 ticker 列表 / Financial statement symbol list", "optional limit", "可作为当前 package 覆盖的辅助目录，不等于全 FMP universe。"],
    ["/stable/stock-list", "股票目录 / Stock list", "optional limit", "只包含当前 package captured catalog。"],
    ["/stable/symbol-change", "Ticker 变更 / Symbol change", "optional limit", "历史变更 source rows；不作为 symbol identity 的唯一依据。"],
  ];

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>FMP-compatible financial data · Premium</div>
      <h2 id="fmp-fundamentals-overview" className="display-title" style={{ fontSize: 42, margin: "0 0 10px" }}>FMP Fundamentals API reference</h2>
      <p style={{ fontSize: 16, color: "var(--ink-muted)", lineHeight: 1.65, margin: "0 0 24px", maxWidth: 820 }}>
        这里列出可以直接调用的接口、返回示例和当前覆盖。FMP fundamentals Beta 目前向 Premium 账户开放。
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>Copy a request, inspect the current coverage, then read how revisions and future vintages will work.</span>
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 28 }}>
        <div style={panel}>
          <div className="eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>Authentication</div>
          <div style={{ color: "var(--ink-strong)", fontWeight: 600, marginBottom: 6 }}>Leandata Bearer token</div>
          <div style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55 }}>Send <code>Authorization: Bearer TOKEN</code>. Do not add an FMP <code>apikey</code> or <code>api_key</code>.</div>
        </div>
        <div style={panel}>
          <div className="eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>已验证覆盖 · Verified now</div>
          <div style={{ color: "var(--ink-strong)", fontWeight: 600, marginBottom: 6 }}>Sample-universe fundamentals Beta</div>
          <div style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55 }}>Premium 可访问当前已导入并验证的 sample-universe 批量快照；具体字段以已发布接口和返回结果为准。</div>
        </div>
        <div style={panel}>
          <div className="eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>当前 Beta · Current</div>
          <div style={{ color: "var(--ink-strong)", fontWeight: 600, marginBottom: 6 }}>Statements + raw snapshot families</div>
          <div style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55 }}>除三类核心报表和 ratios/metrics 外，现已提供 quotes、profile、公司资料、估计、评级、DCF、收入分部和目录等 raw FMP-shaped snapshot endpoints。</div>
        </div>
      </div>

      <div style={{ ...panel, borderColor: "var(--accent-rule)", background: "var(--accent-soft)", marginBottom: 28 }}>
        <strong style={{ color: "var(--accent-ink)" }}>Beta 已开放。</strong>
        <span style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.6 }}> Premium 用户现在可以查询 sample-universe 的 statements、derived fundamentals 与 raw snapshot endpoint families。欢迎留言反馈缺失 ticker、字段、period 或希望优先支持的数据族。</span>
      </div>

      <div style={{ ...panel, marginBottom: 28 }}>
        <h3 className="display-title" style={{ fontSize: 24, margin: "0 0 8px" }}>批量快照、修订与 PIT-like 计划</h3>
        <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.7, margin: 0 }}>
          当前数据来自我们采购并导入的 bulk snapshot。上游可能在事后修订历史值，因此单次快照不自动等于严格 PIT。后续会增加单独版本化的 PIT-like 周度或固定频率刷新，记录 capture time 与 visible time，并保留不可变 vintage。Native FMP endpoint forwarding 会作为独立兼容层建设。
        </p>
      </div>

      <h3 id="fmp-request-examples" className="display-title" style={{ fontSize: 28, margin: "0 0 10px" }}>Request examples · 请求示例</h3>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.6, margin: "0 0 14px", maxWidth: 830 }}>
        发送 HTTPS <code>GET</code> 请求到 <code>https://api.leandata.uk</code>，并携带 Leandata Bearer token。raw snapshot 与三类核心报表都使用 FMP-style path；需要固定某次已发布数据版本时，使用 package-pinned 路径。
      </p>

      <h3 className="display-title" style={{ fontSize: 28, margin: "28px 0 10px" }}>Available endpoints</h3>
      <div style={{ overflowX: "auto", marginBottom: 16 }}>
        <table className="tbl card" style={{ width: "100%", minWidth: 700, overflow: "hidden" }}>
          <thead><tr><th>Route</th><th>Response family</th><th>Parameters</th></tr></thead>
          <tbody>
            <tr><td style={mono}>/stable/income-statement</td><td>Income statement</td><td><code>symbol</code>, optional <code>period</code>, <code>limit</code></td></tr>
            <tr><td style={mono}>/stable/balance-sheet-statement</td><td>Balance sheet</td><td><code>symbol</code>, optional <code>period</code>, <code>limit</code></td></tr>
            <tr><td style={mono}>/stable/cash-flow-statement</td><td>Cash-flow statement</td><td><code>symbol</code>, optional <code>period</code>, <code>limit</code></td></tr>
            <tr><td style={mono}>/stable/ratios</td><td>Financial ratios</td><td><code>symbol</code>, <code>period=annual|quarter</code>, <code>limit</code></td></tr>
            <tr><td style={mono}>/stable/ratios-ttm</td><td>Trailing-twelve-month ratios</td><td><code>symbol</code></td></tr>
            <tr><td style={mono}>/stable/key-metrics</td><td>Key metrics</td><td><code>symbol</code>, <code>period=annual|quarter</code>, <code>limit</code></td></tr>
            <tr><td style={mono}>/stable/key-metrics-ttm</td><td>Trailing-twelve-month key metrics</td><td><code>symbol</code></td></tr>
            <tr><td style={mono}>/stable/*-statement-growth</td><td>Income, balance-sheet, or cash-flow growth</td><td><code>symbol</code>, current package: <code>period=annual</code></td></tr>
            <tr><td style={mono}>/stable/financial-growth</td><td>Financial growth summary</td><td><code>symbol</code>, current package: <code>period=annual</code></td></tr>
            <tr><td style={mono}>/stable/enterprise-values</td><td>Enterprise-value history</td><td><code>symbol</code>, <code>period=annual|quarter</code>, <code>limit</code></td></tr>
            <tr><td style={mono}>/stable/financial-scores</td><td>Altman/Piotroski financial scores</td><td><code>symbol</code></td></tr>
            <tr><td style={mono}>/v1/pit/fmp/*</td><td>Package-pinned statement snapshot</td><td><code>symbol</code>, <code>as_of</code>, <code>package_sha256</code></td></tr>
          </tbody>
        </table>
      </div>

      <h3 id="fmp-endpoint-subsections" className="display-title" style={{ fontSize: 28, margin: "32px 0 4px" }}>Endpoint subsections · 接口分节</h3>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.6, margin: "0 0 4px" }}>
        Each published endpoint has a stable anchor in the sidebar. All non-PIT fundamentals below are immutable package snapshots, not universal point-in-time facts.
      </p>
      <FmpEndpointSection id="fmp-historical-price-eod" route="/stable/historical-price-eod/full" title="Historical price EOD" params={<><code>symbol</code>, <code>from</code>, <code>to</code></>} note="EOD price history is a separately imported historical dataset; use the returned package identity for reproducible archive research." />
      <FmpEndpointSection id="fmp-income-statement" route="/stable/income-statement" title="Income statement" params={<><code>symbol</code>, optional <code>period=annual|quarter</code>, <code>limit</code></>} note="Raw FMP-shaped statement rows. Use the PIT route only when an explicit vintage and as_of boundary are required." />
      <FmpEndpointSection id="fmp-balance-sheet-statement" route="/stable/balance-sheet-statement" title="Balance-sheet statement" params={<><code>symbol</code>, optional <code>period=annual|quarter</code>, <code>limit</code></>} note="Raw FMP-shaped statement rows; sparse fields remain null or absent when the source did not provide them." />
      <FmpEndpointSection id="fmp-cash-flow-statement" route="/stable/cash-flow-statement" title="Cash-flow statement" params={<><code>symbol</code>, optional <code>period=annual|quarter</code>, <code>limit</code></>} note="Raw FMP-shaped statement rows. Do not infer zero from an absent source field." />
      <FmpEndpointSection id="fmp-pit-statements" route="/v1/pit/fmp/{income-statement|balance-sheet-statement|cash-flow-statement}" title="Package-pinned PIT statements" params={<><code>symbol</code>, <code>period</code>, <code>as_of</code>, <code>package_sha256</code></>} note="These are the only current FMP family routes with an explicit accepted-date visibility policy. package_sha256 and as_of are mandatory." />
      <FmpEndpointSection id="fmp-ratios" route="/stable/ratios" title="Financial ratios" params={<><code>symbol</code>, <code>period=annual|quarter</code>, <code>limit</code></>} note="Package snapshot only. Ratios can be revised by later source normalization." />
      <FmpEndpointSection id="fmp-ratios-ttm" route="/stable/ratios-ttm" title="Trailing-twelve-month ratios" params={<><code>symbol</code>, optional <code>limit</code></>} note="TTM is source-defined and not an independently reconstructed PIT series." />
      <FmpEndpointSection id="fmp-key-metrics" route="/stable/key-metrics" title="Key metrics" params={<><code>symbol</code>, <code>period=annual|quarter</code>, <code>limit</code></>} note="Package snapshot only; raw FMP-shaped rows are returned unchanged." />
      <FmpEndpointSection id="fmp-key-metrics-ttm" route="/stable/key-metrics-ttm" title="Trailing-twelve-month key metrics" params={<><code>symbol</code>, optional <code>limit</code></>} note="TTM fields are source-defined; clients should tolerate missing fields." />
      <FmpEndpointSection id="fmp-income-statement-growth" route="/stable/income-statement-growth" title="Income-statement growth" params={<><code>symbol</code>, current package <code>period=annual</code>, <code>limit</code></>} note="Growth is a package snapshot and does not claim a historical revision timeline." />
      <FmpEndpointSection id="fmp-balance-sheet-statement-growth" route="/stable/balance-sheet-statement-growth" title="Balance-sheet growth" params={<><code>symbol</code>, current package <code>period=annual</code>, <code>limit</code></>} note="Growth is a package snapshot and does not claim a historical revision timeline." />
      <FmpEndpointSection id="fmp-cash-flow-statement-growth" route="/stable/cash-flow-statement-growth" title="Cash-flow growth" params={<><code>symbol</code>, current package <code>period=annual</code>, <code>limit</code></>} note="Growth is a package snapshot and does not claim a historical revision timeline." />
      <FmpEndpointSection id="fmp-financial-growth" route="/stable/financial-growth" title="Financial growth" params={<><code>symbol</code>, current package <code>period=annual</code>, <code>limit</code></>} note="Use package identity when comparing a later refresh against this captured vintage." />
      <FmpEndpointSection id="fmp-enterprise-values" route="/stable/enterprise-values" title="Enterprise values" params={<><code>symbol</code>, <code>period=annual|quarter</code>, <code>limit</code></>} note="Valuation history is a package snapshot; it is not advertised as strict PIT." />
      <FmpEndpointSection id="fmp-financial-scores" route="/stable/financial-scores" title="Financial scores" params={<><code>symbol</code>, optional <code>limit</code></>} note="Altman/Piotroski-style scores are returned from the archived source payload." />
      <h3 className="display-title" style={{ fontSize: 28, margin: "32px 0 4px" }}>Raw snapshot endpoint families · 原始快照接口</h3>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.65, margin: "0 0 4px" }}>
        以下 endpoints 返回 package 内保存的原始 FMP-shaped JSON。它们全是 Premium-only、archive-only；不会把未列出的 route 转发给原生 FMP，也不会在 archive miss 时静默补数。
      </p>
      {rawSnapshotEndpoints.map(([route, title, params, note]) => (
        <FmpEndpointSection key={route} id={`fmp-${route.slice("/stable/".length)}`} route={route} title={title} params={params} note={note} />
      ))}

      <pre className="code" style={{ marginBottom: 22 }}>
{`# Raw quote snapshot — values below are illustrative, not live prices
curl "https://api.leandata.uk/stable/quote?symbol=AAPL" \\
  -H "Authorization: Bearer TOKEN"

[
  {
    "symbol": "EXAMPLE",
    "name": "Example Corp.",
    "price": 123.45,
    "change": 1.23,
    "changesPercentage": 1.01,
    "timestamp": 1785715200
  }
]

# Income statement — annual or quarter
curl "https://api.leandata.uk/stable/income-statement?symbol=AAPL&period=annual&limit=5" \\
  -H "Authorization: Bearer TOKEN"

# Balance sheet
curl "https://api.leandata.uk/stable/balance-sheet-statement?symbol=AAPL&period=quarter&limit=4" \\
  -H "Authorization: Bearer TOKEN"

# Cash-flow statement
curl "https://api.leandata.uk/stable/cash-flow-statement?symbol=AAPL&period=annual&limit=5" \\
  -H "Authorization: Bearer TOKEN"

# Point-in-time statement read — package identity and as_of are explicit.
curl "https://api.leandata.uk/v1/pit/fmp/income-statement?symbol=AAPL&as_of=2026-08-01T00:00:00Z&package_sha256=PACKAGE_SHA256" \\
  -H "Authorization: Bearer TOKEN"`}
      </pre>

      <pre className="code" style={{ marginBottom: 22 }}>
{`# Ratios — annual or quarter
curl "https://api.leandata.uk/stable/ratios?symbol=AAPL&period=quarter&limit=4" \\
  -H "Authorization: Bearer TOKEN"

# Ratios TTM — this endpoint does not use period
curl "https://api.leandata.uk/stable/ratios-ttm?symbol=AAPL" \\
  -H "Authorization: Bearer TOKEN"

# Key metrics
curl "https://api.leandata.uk/stable/key-metrics?symbol=AAPL&period=annual&limit=5" \\
  -H "Authorization: Bearer TOKEN"

# Annual growth in the current package
curl "https://api.leandata.uk/stable/financial-growth?symbol=AAPL&period=annual&limit=5" \\
  -H "Authorization: Bearer TOKEN"

# Enterprise values and financial scores
curl "https://api.leandata.uk/stable/enterprise-values?symbol=AAPL&period=quarter&limit=4" \\
  -H "Authorization: Bearer TOKEN"
curl "https://api.leandata.uk/stable/financial-scores?symbol=AAPL" \\
  -H "Authorization: Bearer TOKEN"`}
      </pre>

      <h3 className="display-title" style={{ fontSize: 28, margin: "0 0 10px" }}>Representative response</h3>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.6, margin: "0 0 14px", maxWidth: 830 }}>
        A published statement endpoint returns a JSON array. The example below shows the FMP-compatible field shape only; values are illustrative and are not live market or company data.
      </p>
      <pre className="code" style={{ marginBottom: 22 }}>
{`HTTP/1.1 200 OK
Content-Type: application/json

[
  {
    "date": "2026-03-31",
    "symbol": "EXAMPLE",
    "reportedCurrency": "USD",
    "cik": "0000000000",
    "fillingDate": "2026-05-01",
    "acceptedDate": "2026-05-01T16:00:00.000Z",
    "calendarYear": "2026",
    "period": "Q1",
    "revenue": 123456789,
    "netIncome": 12345678
  }
]`}
      </pre>

      <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.6, margin: "0 0 14px", maxWidth: 830 }}>
        Derived endpoints also return the original FMP-shaped JSON array. A ratios response can contain fields such as <code>currentRatio</code>, <code>quickRatio</code>, <code>debtToEquityRatio</code>, <code>priceToEarningsRatio</code> and <code>returnOnEquity</code>; TTM field names normally end in <code>TTM</code>. Treat missing or null fields as source data, not as zero.
      </p>

      <h3 id="fmp-request-contract" className="display-title" style={{ fontSize: 28, margin: "0 0 10px" }}>Parameters and result handling</h3>
      <div style={{ overflowX: "auto", marginBottom: 22 }}>
        <table className="tbl card" style={{ width: "100%", minWidth: 700, overflow: "hidden" }}>
          <thead><tr><th>Parameter</th><th>Use</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><td style={mono}>symbol</td><td>Required ticker</td><td>Use the listed company symbol, for example <code>AAPL</code>.</td></tr>
            <tr><td style={mono}>period</td><td>Optional cadence where supported</td><td><code>annual</code> or <code>quarter</code>. TTM and financial-scores routes do not accept it; current growth members are annual.</td></tr>
            <tr><td style={mono}>limit</td><td>Optional row count</td><td>Use a small explicit limit when testing or paginating research.</td></tr>
            <tr><td style={mono}>as_of</td><td>Required for statement PIT</td><td>ISO-8601 timestamp. The statement PIT route filters records by the documented conservative accepted-date visibility policy.</td></tr>
            <tr><td style={mono}>package_sha256</td><td>Required for PIT</td><td>Exact published package identity; use it for reproducible reruns.</td></tr>
          </tbody>
        </table>
      </div>

      <h3 id="fmp-response-metadata" className="display-title" style={{ fontSize: 28, margin: "0 0 10px" }}>Response metadata and current coverage</h3>
      <ul style={{ margin: "0 0 24px", paddingLeft: 20, color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.8 }}>
        <li><strong style={{ color: "var(--ink-strong)" }}>Current package scope:</strong> Premium sample-universe Beta 覆盖 typed statements/ratios/metrics/growth/valuation，以及 quote、profile、公司资料、估计、评级、DCF、收入分部、batch response 与目录等 raw snapshot families。</li>
        <li><strong style={{ color: "var(--ink-strong)" }}>Raw endpoint response:</strong> raw snapshot family 无数据时返回 <code>[]</code>，并带 completion metadata；这表示该不可变 package 已完整导入，但 source 在这次捕获中没有匹配 row。</li>
        <li><strong style={{ color: "var(--ink-strong)" }}>Still not advertised as available:</strong> institutional holdings、ETF holdings，以及任意 native FMP forwarding。后两者会有独立的数据来源、刷新与修订契约。</li>
        <li><strong style={{ color: "var(--ink-strong)" }}>Universe boundary:</strong> 这是 sample-universe Beta，不代表所有 ticker 或 catalog 都有相同覆盖；没有匹配数据时请处理空数组。</li>
      </ul>

      <h3 className="display-title" style={{ fontSize: 28, margin: "0 0 10px" }}>为什么这还不是严格 PIT · Why snapshots can change</h3>
      <ul style={{ margin: "0 0 24px", paddingLeft: 20, color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.8 }}>
        <li><strong style={{ color: "var(--ink-strong)" }}>历史值可能变化：</strong> later filings, amendments, and FMP normalization can revise earlier periods. A package-pinned request reproduces one captured vintage, but that vintage does not by itself prove what was knowable on every historical date.</li>
        <li><strong style={{ color: "var(--ink-strong)" }}>Endpoint families are different datasets:</strong> price history, statements, ratios, estimates, and TTM/growth are not interchangeable. Presence of one does not imply coverage of another.</li>
        <li><strong style={{ color: "var(--ink-strong)" }}>Expect missing fields:</strong> company, period, and filing availability vary. Client code should tolerate absent or null values rather than inferring a value.</li>
      </ul>

      <h3 className="display-title" style={{ fontSize: 28, margin: "0 0 10px" }}>Future plan · 后续计划</h3>
      <ol style={{ margin: "0 0 24px", paddingLeft: 20, color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.8 }}>
        <li>继续扩展 sample-universe 与字段验证，并为 statements、ratios、metrics、growth 和 valuation 返回结果保留明确 package identity。</li>
        <li>为 estimates、earnings、ratings、DCF 和 event families 增加独立版本化 capture/visible 时间；目前开放的是 immutable snapshot，而不是它们的严格 PIT 版本。</li>
        <li>Connect native FMP as a distinct forwarding surface for broader endpoint coverage. It will have its own availability and refresh policy and will not overwrite published package snapshots.</li>
        <li>发布独立版本化的 PIT-like 周度或固定频率刷新，公开 capture/visible 时间并保留 immutable vintages；native FMP 转发保持独立。</li>
      </ol>

      <div style={{ ...panel, marginBottom: 8 }}>
        <strong style={{ color: "var(--accent-ink)" }}>Ultimate 计划。</strong>
        <span style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55 }}> Ultimate 将增加 institutional holdings disclosures、ETF holdings 及相关数据族；它们同样存在上游修订问题，必须沿用 capture time、visible time 与 immutable vintage 语义。</span>
      </div>

      <div style={{ ...panel, borderColor: "var(--accent-rule)", background: "var(--accent-soft)", marginBottom: 8 }}>
        <strong style={{ color: "var(--accent-ink)" }}>Request tip.</strong>
        <span style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55 }}> Use your Leandata Bearer token—never an FMP <code>apikey</code> or <code>api_key</code>. To reproduce one captured vintage, save its <code>as_of</code> and <code>package_sha256</code> beside the query.</span>
      </div>
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
        The Stock Options Proxy has two surfaces: a <strong style={{ color: "var(--ink-strong)" }}>token portal</strong> for registration and token issuance,
        and a <strong style={{ color: "var(--ink-strong)" }}>data proxy</strong> for historical REST, realtime REST, and secure WebSocket market data.
        Once you have a token, use it to call historical and realtime endpoints without managing your own Alpaca / ThetaData credentials.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>Stock Options Proxy 提供两类服务：Token 门户负责注册、账户与 Token；数据代理通过稳定的公共域名提供历史 REST、实时 REST 与安全 WebSocket 行情。</span>
      </p>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 16 }}>
        <thead><tr><th>Surface</th><th>Public URL</th><th>Auth</th></tr></thead>
        <tbody>
          <tr><td>Token portal</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{TOKEN_BASE}</td><td style={{ fontSize: 12 }}>username + phone</td></tr>
          <tr><td>REST data proxy</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{REST_BASE}</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>Bearer &lt;token&gt;</td></tr>
          <tr><td>REST real-time proxy</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{RT_BASE}</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>Bearer &lt;token&gt;</td></tr>
          <tr><td>WS data proxy</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{WS_BASE}/*</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>auth message</td></tr>
        </tbody>
      </table>
      <div style={{ background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 16px", margin: "0 0 24px", fontSize: 13 }}>
        <strong style={{ color: "var(--ink-strong)" }}>{"\u26A1"} Stable public endpoints</strong> — use <code>api.leandata.uk</code> for historical REST,
        <code>rt-api.leandata.uk</code> for realtime REST, and <code>wss://leandata.uk/stream/*</code> for streaming.
        All data surfaces accept the same token. Origin hosts and cache tiers may move during failover, so clients should never pin a raw server IP.
        <br/><span style={{ color: "var(--ink-soft)" }}>历史 REST、实时 REST 与 WebSocket 均使用稳定域名和同一 Token。故障切换时源站与缓存层可能调整，客户端不应绑定裸 IP。</span>
      </div>

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
        Tokens expire 30 days after issuance (trial: 3 days, non-renewable). The proxy returns <code>401</code> for invalid or expired tokens and <code>403</code> if your tier lacks permission for the endpoint.
      </p>

      <h2 id="tiers-permissions" className="display-title" style={{ fontSize: 28, margin: "0 0 16px" }}>Tiers &amp; permissions</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Four public token plans control access to channels, symbols, rate limits, and REST endpoints.
        Basic is shown only for existing-account compatibility and is closed to new registration; Bulk Download is the separate one-off product above.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>公开注册提供四种 Token 套餐。Basic 仅为老账户兼容，不再开放新注册；批量导出请使用上方独立的 Bulk Download。</span>
      </p>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 12 }}>
        <thead>
          <tr><th style={{ width: 120 }}>Plan</th><th>Price</th><th>WS channels</th><th>WS symbols</th><th>WS conns</th><th>REST req/min<br/><span style={{ fontWeight: 400, fontSize: 11, color: "var(--ink-soft)" }}>(rolling 60 s window)</span></th><th>REST parallel</th><th>REST endpoints</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="tier trial">Trial</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>¥50/3 days</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>all 6 channels</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>50</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>3</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>1800</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>5</td>
            <td style={{ fontSize: 12 }}>Same as Standard · 3-day token · non-renewable</td>
          </tr>
          <tr>
            <td><span className="tier basic">Basic</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>Legacy · closed</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>— (REST only)</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>—</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>1</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>600</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>2</td>
            <td style={{ fontSize: 12 }}>existing accounts only · no new registration</td>
          </tr>
          <tr>
            <td><span className="tier value">Value</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>¥70/mo</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>all 6 channels</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>30</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>2</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>1800</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>3</td>
            <td style={{ fontSize: 12 }}>REST: stocks OR options (pick at signup) · WS: all channels</td>
          </tr>
          <tr>
            <td><span className="tier standard">Standard</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>¥100/mo</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>all 6 channels</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>50</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>3</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>1800</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>5</td>
            <td style={{ fontSize: 12 }}>stocks + options history · no crypto orderbooks</td>
          </tr>
          <tr>
            <td><span className="tier premium">Premium</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>¥150/mo</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>all 6 channels</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>500</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>{"\u221E"}</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>6000</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>10</td>
            <td style={{ fontSize: 12 }}>All REST endpoints including crypto orderbooks</td>
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 8px" }}>
        Rate limits tighten automatically under load: limits halve when server is overloaded and quarter under critical load. WebSocket delivery is always prioritised over REST.
      </p>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 40px" }}>
        Per-second equivalents: Basic 10/s · Value 30/s · Standard 30/s · Premium 100/s. Exceeding the per-minute quota or the parallel-request cap returns <strong>HTTP 429</strong>; back off and retry after the 60-second window.
        <br/>每秒换算：Basic 10/s · Value 30/s · Standard 30/s · Premium 100/s。超过每分钟配额或并发上限会返回 <strong>HTTP 429</strong>，请等待 60 秒窗口刷新后再重试。
      </p>

      {/* ── Token API ── */}
      <div className="eyebrow" style={{ marginBottom: 10, marginTop: 48 }}>Token API</div>

      <h2 id="post-register" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /api/register</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>Submit a new account registration. The request enters a pending queue until approved by an admin.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>提交新账户注册申请；请求会进入待审核队列，由管理员审核后开通。</span>
      </p>
      <EndpointBadge method="POST" path={`${TOKEN_BASE}/api/register`} />
      <ParamTable rows={[
        { name: "username", type: "string", required: true, desc: "Unique display name (must not exist in approved users)" },
        { name: "phone",    type: "string", required: true, desc: "Mobile number used to verify identity on token generation" },
        { name: "email",    type: "string", required: true, desc: "Valid email used for account identity, service notices, and future login verification." },
        { name: "tier",     type: "string", required: false, desc: "trial | value | standard | premium (default: standard). Basic is retired for new registrations." },
        { name: "mode",     type: "string", required: false, desc: "stocks | options — required when tier is value. Determines which data vertical is enabled." },
      ]} />
      <pre className="code" style={{ marginBottom: 28 }}>
{`// Request
{ "username": "tonnysun", "phone": "18717931119", "email": "tonny@example.com", "tier": "premium" }

// Value tier — mode required
{ "username": "qianyu", "phone": "13800138000", "email": "qianyu@example.com", "tier": "value", "mode": "options" }

// Response 200
{ "success": true, "message": "注册成功！请等待卖家确认订单后即可生成 Token。", "id": "61ce4f82-..." }

// Error 400 — Basic is no longer a public registration tier
{ "success": false, "error": "retired_registration_tier", "message": "Basic REST 月度套餐已停止新注册..." }

// Error 409 — username already taken
{ "success": false, "message": "该用户名已被使用，请换一个。" }`}
      </pre>

      <h2 id="post-check-status" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /api/check-status</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>Poll approval status before attempting token generation.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>在尝试生成 Token 之前，查询账户的审核状态。</span>
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
        Exchange approved credentials for a 30-day UUID token. If a token already exists for this user in the active token list it is returned as-is (not regenerated).
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>凭已审核通过的账号信息换取 30 天有效期的 UUID Token。该用户已签发的 Token 会原样返回，不会重新生成。</span>
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

      <h2 id="get-post-v1-indices-history" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>GET/POST /v1/indices/history</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Fetch normalized daily cash-index history from CBOE. Supported symbols are <code>SPX</code>, <code>VIX</code>, and <code>VIX3M</code>.
        This is index-level data, not option-chain contracts or VIX futures. CBOE publishes SPX as close-only, so its <code>open</code>, <code>high</code>, and <code>low</code> fields are <code>null</code>.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>获取 CBOE 官方现金指数日线。支持 SPX、VIX、VIX3M；这是指数值，不是期权链或 VIX 期货。SPX 官方文件仅含收盘价。</span>
      </p>
      <EndpointBadge method="GET/POST" path={`${REST_BASE}/v1/indices/history`} />
      <ParamTable rows={[
        { name: "symbol", type: "string", required: true, desc: "SPX | VIX | VIX3M" },
        { name: "start",  type: "string", required: true, desc: "Inclusive start date in YYYY-MM-DD format" },
        { name: "end",    type: "string", required: true, desc: "Inclusive end date in YYYY-MM-DD format" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}/v1/indices/history?symbol=VIX&start=2024-01-02&end=2024-01-05"`}
      </pre>
      <pre className="code" style={{ marginBottom: 40 }}>
{`// Response
{
  "schema": "index_history_v1",
  "symbol": "VIX",
  "start": "2024-01-02",
  "end": "2024-01-05",
  "timeframe": "1Day",
  "provider": "cboe",
  "cash_index": true,
  "count": 4,
  "data": [
    { "date": "2024-01-02", "open": 13.22, "high": 14.23, "low": 13.10, "close": 13.20 }
  ],
  "request_id": "..."
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

      <h2 id="post-v1-stock-history-trade-quote" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/stock/history/trade_quote</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Combined historical trade + quote data for a single stock symbol in one call.
        Fetches both <code>/v2/stocks/trades</code> and <code>/v2/stocks/quotes</code> from Alpaca in parallel, auto-paginates each leg, and returns them in a single response.
        Cached server-side; repeat calls return <code>X-Cache: DISK_HIT</code>.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>单只股票的合并历史成交+报价数据。并行从 Alpaca 拉取 trades 和 quotes 自动分页，单次返回。支持服务端缓存。</span>
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/stock/history/trade_quote`} />
      <ParamTable rows={[
        { name: "symbol", type: "string",  required: true,  desc: "Stock ticker (e.g. AAPL)" },
        { name: "start",  type: "string",  required: true,  desc: "ISO 8601 datetime (e.g. 2026-05-20T13:30:00Z)" },
        { name: "end",    type: "string",  required: true,  desc: "ISO 8601 datetime" },
        { name: "limit",  type: "integer", required: false, desc: "Max records per leg, 1–10000 (default: 1000)" },
        { name: "feed",   type: "string",  required: false, desc: "sip | iex (default: sip with pro account)" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/stock/history/trade_quote \\
  -H "Authorization: Bearer ***" \\
  -H "Content-Type: application/json" \\
  -d '{"symbol":"AAPL","start":"2026-05-20T13:30:00Z","end":"2026-05-20T13:31:00Z","limit":3}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 48 }}>
{`// Response
{
  "symbol": "AAPL",
  "start": "2026-05-20T13:30:00Z",
  "end": "2026-05-20T13:31:00Z",
  "feed": "sip",
  "trades": [
    { "c": ["@","I"], "i": 1301, "p": 298.44, "s": 1,
      "t": "2026-05-20T13:30:00.002Z", "x": "K", "z": "C" }
  ],
  "trade_count": 156,
  "quotes": [
    { "ap": 298.45, "as": 200, "bp": 298.43, "bs": 500, "ax": "V", "bx": "Q",
      "t": "2026-05-20T13:30:00.001Z", "c": ["R"], "z": "C" }
  ],
  "quote_count": 312
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
        Two upstreams sit behind a single proxy layer (auth, permissions, rate limits, credential stripping, cache):
        Alpaca for stocks, crypto, news, and most options; ThetaData Value for the option subset shown below.
        The table lists only routes where the dual-provider routing or fallback decision matters — pass-through Alpaca routes
        (<code>/v2/stocks/*</code>, <code>/v1beta3/crypto/*</code>, <code>/v1beta1/news*</code>, <code>/v2/options/contracts*</code>) are documented in their own sections.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>两个上游共享同一层代理。下表只列需要 dual-provider 路由/回退判断的端点；纯 Alpaca 透传端点在各自章节展开。</span>
      </p>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 20 }}>
        <thead><tr><th>Surface</th><th>Route</th><th>Routing behavior</th></tr></thead>
        <tbody>
          {[
            ["Alpaca options (native)",       "/v1beta1/options/*",                                            "Bars, historical trades, latest quotes/trades, snapshots, chain snapshots. Historical option data starts 2024-02-01."],
            ["Option bars (wrapper)",         "/v1/history/options/bars",                                      "ThetaData OHLC first; Alpaca bars fallback. provider=thetadata|alpaca to pin."],
            ["Contracts (wrapper)",           "/v1/options/contracts",                                         "Alpaca contracts first; ThetaData Value contracts fallback. provider=thetadata requires underlying_symbols."],
            ["Full snapshots / greeks / IV",  "/v1/options/snapshots",                                         "Alpaca only — ThetaData Value lacks greeks, IV, market value."],
            ["Quote / trade snapshots",       "/v1/options/snapshots/{quote,trade}",                           "Alpaca latest quote/trade; normalized to snapshots[OCC].latestQuote/latestTrade."],
            ["OI / OHLC snapshots",           "/v1/options/snapshots/open_interest, /v3/option/snapshot/*",    "ThetaData-backed where Value permits OI and OHLC snapshots."],
            ["ThetaData Value options",       "/v3/option/*",                                                  "ThetaData Value whitelist only; JSON response; no Alpaca fallback."],
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
  "${REST_BASE}/v2/stocks/quotes/latest?symbols=AAPL&feed=sip"

# Latest crypto quote (Alpaca native)
curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}/v1beta3/crypto/us/latest/quotes?symbols=BTC%2FUSD"

# Historical stock quotes (Alpaca native)
curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}/v2/stocks/quotes?symbols=AAPL&start=2026-05-20T13:30:00Z&end=2026-05-20T14:00:00Z&feed=sip"`}
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

      <div className="eyebrow" style={{ marginBottom: 6, marginTop: 32, fontSize: 11, color: "var(--ink-soft)" }}>Options Data · History</div>
      <h2 id="post-v1-history-options-bars" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/history/options/bars</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Historical OHLCV bars for option contracts. Default <code>provider: "auto"</code> routes to <strong style={{ color: "var(--ink-strong)" }}>ThetaData Value</strong> first and falls back to Alpaca bars only when ThetaData has no usable data.
        You can pass either OCC symbols directly (<code>AAPL260620C00200000</code>) or a plain stock ticker — the proxy will auto-resolve it to the option chain active on the <code>start</code> date.
        Supports in-flight coalescing and server-side cache; repeat historical calls return <code>X-Cache: DISK_HIT</code>.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>期权合约历史 OHLCV K线。默认 ThetaData Value，必要时回退 Alpaca。支持 OCC 或股票代码自动解析，并写入服务端缓存。</span>
      </p>
      <div style={{ background: "#fff3cd", border: "1px solid #ffc107", borderRadius: 8, padding: "10px 14px", margin: "0 0 12px", fontSize: 12 }}>
        <strong>{"\u26A0\uFE0F"} ThetaData Value plan limitation:</strong> Only <code>1Day</code> timeframe is available via ThetaData. Intraday timeframes (1Min, 5Min, 15Min, 1Hour) return <em>"No data found"</em> because the Value subscription does not include historical minute bars for options. Set <code>provider: "alpaca"</code> to use Alpaca for intraday option bars (data available from 2024-02-01).
        <br/><span style={{ color: "var(--ink-soft)" }}>ThetaData Value 仅支持 1Day 日线。分钟级（1Min/5Min/15Min/1Hour）会返回"No data found"。如需分钟级期权 K 线，请指定 provider: "alpaca"（数据从 2024-02-01 起）。</span>
      </div>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/history/options/bars`} />
      <ParamTable rows={[
        { name: "symbols",   type: "string",  required: true,  desc: "OCC symbol(s) comma-separated, or a stock ticker for auto-resolution" },
        { name: "start",     type: "string",  required: true,  desc: "ISO 8601 date" },
        { name: "end",       type: "string",  required: true,  desc: "ISO 8601 date" },
        { name: "timeframe", type: "string",  required: false, desc: "1Day only on ThetaData Value. Intraday (1Min, 5Min, 15Min, 1Hour) requires provider=\"alpaca\". Default: 1Day" },
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
        Historical open interest by date range with strike/expiry filters. Data source: <strong style={{ color: "var(--ink-strong)" }}>ThetaData Value</strong> (returns 503 if ThetaData is unavailable).
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>按日期范围和行权价/到期日筛选历史持仓量。</span>
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

      <h2 id="post-v1-history-options-eod" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>GET/POST /v1/history/options/eod</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        End-of-day OHLC summary for option contracts: open/high/low/close, volume, bid/ask, and trade count per contract per day.
        Data source: <strong style={{ color: "var(--ink-strong)" }}>ThetaData Value</strong> with server-side cache. Supports <code>GET</code> (query) and <code>POST</code> (JSON body).
        Also accessible at the legacy alias <code>/v1/options/eod</code> with identical behavior.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>期权合约日终 OHLC 汇总。数据源 ThetaData Value，写入服务端缓存。也可走旧别名 /v1/options/eod。</span>
      </p>
      <EndpointBadge method="GET/POST" path={`${REST_BASE}/v1/history/options/eod`} />
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
{`# POST
curl -X POST ${REST_BASE}/v1/history/options/eod \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbol":"AAPL","start":"2025-01-02","end":"2025-01-03","right":"call","max_dte":30}'

# GET
curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}/v1/history/options/eod?symbol=AAPL&start=2025-01-02&end=2025-01-03&right=call"`}
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
    "${REST_BASE}/v1/history/options/eod",
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

      {/* ── Not Supported ── */}
      <div style={{ background: "#f8d7da", border: "1px solid #f5c6cb", borderRadius: 8, padding: "14px 18px", margin: "48px 0 24px", fontSize: 13 }}>
        <h3 id="not-supported-value" style={{ fontSize: 16, fontWeight: 600, margin: "0 0 8px", color: "#721c24" }}>Not supported on ThetaData Value plan</h3>
        <p style={{ margin: "0 0 8px", color: "#721c24" }}>
          The following endpoints are registered in the proxy but will return errors because the ThetaData Value subscription does not include them. Do not call these unless you have upgraded to Standard/Pro.
        </p>
        <table className="tbl" style={{ width: "100%", fontSize: 12, marginBottom: 8 }}>
          <thead><tr><th>Endpoint</th><th>Error</th><th>Alternative</th></tr></thead>
          <tbody>
            <tr><td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>/v1/history/options/trade_quote</td><td>PERMISSION_DENIED — requires Standard subscription</td><td>Use /v1/history/options/trades (Alpaca) or /v3/option/history/quote (quote only)</td></tr>
            <tr><td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>/v1/options/snapshots/market_value</td><td>ThetaData Value lacks market_value data</td><td>Use /v1/options/snapshots (Alpaca-backed, includes greeks)</td></tr>
            <tr><td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>/v1/history/options/bars (intraday)</td><td>"No data found" for 1Min/5Min/15Min/1Hour</td><td>Use timeframe=1Day or provider="alpaca" for intraday</td></tr>
          </tbody>
        </table>
        <p style={{ margin: 0, fontSize: 12, color: "#856404" }}>
          ThetaData Value includes: EOD bars, OHLC snapshots, quote snapshots, open interest, contract lists, and historical quotes. It does <strong>not</strong> include: option trades, trade_quote, market value, implied volatility, or greeks via ThetaData. Greeks/IV are available via Alpaca snapshots.
        </p>
      </div>

      {/* ── Snapshots ── */}
      <div className="eyebrow" style={{ marginBottom: 6, marginTop: 48, fontSize: 11, color: "var(--ink-soft)" }}>Options Data · Snapshots</div>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 24px" }}>
        Snapshot endpoints return the <em>latest</em> state of option contracts — greeks, quotes, trade, open interest — served from a 60-second in-memory cache.
        All snapshot endpoints accept OCC symbols obtained from <code>/v1/options/contracts</code>.
      </p>

      <h2 id="post-v1-options-snapshots" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/snapshots</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Full snapshot per contract: latest trade, latest quote, greeks (delta, gamma, theta, vega, rho), and implied volatility.
        Use the sub-endpoints below when you only need one slice.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>每个合约的完整快照：最新成交、最新报价、希腊值与隐含波动率。只需单项时改用下方子端点。</span>
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
        Latest NBBO quote per contract, normalized to <code>snapshots[OCC].latestQuote</code>. Set <code>feed: "thetadata"</code> only to force the ThetaData Value quote snapshot.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>期权合约最新 NBBO 报价。只有明确需要 ThetaData Value 时才设置 feed: "thetadata"。</span>
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
        Latest trade per contract, normalized to <code>snapshots[OCC].latestTrade</code>.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>期权合约最新成交，归一化到 snapshots[OCC].latestTrade。</span>
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
        Latest open interest per contract (count + timestamp). ThetaData-only — must set <code>feed: "thetadata"</code>.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>期权合约最新持仓量。仅 ThetaData，必须设 feed: "thetadata"。</span>
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

      {/* ── ThetaData Value direct endpoints ── */}
      <div className="eyebrow" style={{ marginBottom: 6, marginTop: 48, fontSize: 11, color: "var(--ink-soft)" }}>Options Data · ThetaData Value</div>
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
            ["/v3/option/list/symbols",          "Options contracts", "List option root symbols"],
            ["/v3/option/list/dates/quote",      "Options contracts", "Available quote dates"],
            ["/v3/option/list/dates/trade",      "Options contracts", "Available trade dates as list metadata"],
            ["/v3/option/list/expirations",      "Options contracts", "Expirations for a root"],
            ["/v3/option/list/strikes",          "Options contracts", "Strikes for root/expiration"],
            ["/v3/option/list/contracts/quote",  "Options contracts", "Contract list by quote availability"],
            ["/v3/option/list/contracts/trade",  "Options contracts", "Contract list by trade availability"],
            ["/v3/option/snapshot/ohlc",         "Options snapshots", "Latest OHLC snapshot"],
            ["/v3/option/snapshot/quote",        "Options snapshots", "Latest NBBO quote snapshot"],
            ["/v3/option/snapshot/open_interest","Options snapshots", "Latest open-interest snapshot"],
            ["/v3/option/history/eod",           "Options history",   "Daily EOD summary"],
            ["/v3/option/history/ohlc",          "Options history",   "Historical OHLC bars"],
            ["/v3/option/history/quote",         "Options history",   "Historical quotes"],
            ["/v3/option/history/open_interest", "Options history",   "Historical open interest"],
            ["/v3/option/at_time/quote",         "Options history",   "Quote at a timestamp"],
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
  "${REST_BASE}/v3/option/history/ohlc?root=AAPL&exp=260620&strike=200.0&right=C&start_date=20250102&end_date=20250103"

# POST — JSON body forwarded to ThetaData
curl -X POST ${REST_BASE}/v3/option/history/ohlc \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"root":"AAPL","exp":260620,"strike":200.0,"right":"C","start_date":20250102,"end_date":20250103}'`}
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
      <pre className="code" style={{ marginBottom: 48 }}>
{`curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}/v3/option/snapshot/ohlc?root=AAPL&exp=260620&strike=200.0&right=C"

// Response — ThetaData native format
{
  "ohlc": { "open": 14.50, "high": 15.20, "low": 14.10, "close": 14.85, "volume": 320 }
}`}
      </pre>

      <h3 id="post-v3-option-at-time-quote" style={{ fontSize: 16, fontWeight: 500, margin: "20px 0 8px", color: "var(--ink-strong)" }}>Quote at time example</h3>
      <pre className="code" style={{ marginBottom: 12 }}>
{`# GET — quote at a specific time of day
curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}/v3/option/at_time/quote?root=AAPL&exp=260620&strike=200.0&right=C&start_date=20250102&end_date=20250102&time_of_day=14:30:00"

# POST — JSON body
curl -X POST ${REST_BASE}/v3/option/at_time/quote \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"root":"AAPL","exp":260620,"strike":200.0,"right":"C","start_date":20250102,"end_date":20250102,"time_of_day":"14:30:00"}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 48 }}>
{`// Response — ThetaData native format
{
  "quotes": [
    { "date": 20250102, "ms_of_day": 52200000, "bid": 14.80, "bid_size": 10, "ask": 14.90, "ask_size": 15 }
  ]
}`}
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
        Approve a pending registration. Writes the user to both the token-site database and the proxy backend, issuing a token automatically.
        Returns the generated token so you can share it directly with the user.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>批准一条待处理的注册申请；自动写入用户数据库并签发 Token，返回值可直接发给用户。</span>
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
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>拒绝一条待处理的注册申请，可附带原因。</span>
      </p>
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
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>Common HTTP status codes returned by the proxy and when they occur.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>代理返回的常见 HTTP 状态码及其触发场景。</span>
      </p>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 40 }}>
        <thead><tr><th style={{ width: 80 }}>Status</th><th>Body</th><th>When</th></tr></thead>
        <tbody>
          {[
            ["400", '{"error":"Missing required fields"}', "Required parameter absent or malformed JSON"],
            ["401", '{"error":"Invalid token"}', "Token missing, expired, or not active"],
            ["403", '{"error":"Forbidden"}', "Token valid but tier lacks permission for this endpoint"],
            ["404", '{"error":"Token not found"}', "Admin lookup: user_id not in active token list"],
            ["409", '{"success":false,"message":"..."}', "Duplicate username on registration"],
            ["429", "Rate limit exceeded: N/M req/min", "REST rate limit hit; retry after 60 s"],
            ["429", '{"error":"REST concurrency limit exceeded: N/M parallel requests"}', "Too many parallel requests in flight; wait for one to finish"],
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
      <div style={{ background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", margin: "0 0 12px", fontSize: 13 }}>
        <strong>HTTP 429 = rate limit hit.</strong> If you receive a <code>429</code> response, you have exceeded your tier's per-minute REST quota or your parallel-request concurrency cap. Back off and retry after the 60-second rolling window or after one in-flight request finishes — do not hammer the endpoint.
        <br/><span style={{ color: "var(--ink-soft)" }}>收到 HTTP 429 说明触发了限速：超过了套餐的每分钟 REST 配额或并发上限。请等待 60 秒滚动窗口刷新或等已有请求完成后再重试，不要持续重试。</span>
      </div>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        REST limits are per-user, per rolling 60-second window. Limits tighten automatically when the server is under load (overloaded) and further under critical load.
        WebSocket symbol subscriptions are counted separately and do not reset on reconnect.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>REST 限速按用户、按 60 秒滚动窗口计算。服务器负载升高时自动收紧，极端负载下进一步收紧。WS 标的订阅数单独计算，重连后不会重置。</span>
      </p>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 12 }}>
        <thead>
          <tr><th style={{ width: 150 }}>Tier</th><th>REST req/min</th><th>Under load</th><th>Critical</th><th>WS symbols</th></tr>
        </thead>
        <tbody>
          {[
            ["Trial",    "1800", "900", "450", "50"],
            ["Basic",    "600",  "300", "150", "—"],
            ["Value",    "1800", "900", "450", "30"],
            ["Standard", "1800", "900", "450", "50"],
            ["Premium",  "6000", "3000","1500","500"],
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

      <h2 id="concurrency-limits" className="display-title" style={{ fontSize: 28, margin: "0 0 12px" }}>Concurrency limits</h2>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        In addition to rate limits, the proxy enforces per-user concurrency limits on both REST and WebSocket connections.
        REST concurrency limits the number of parallel in-flight requests; WebSocket concurrency limits the number of simultaneously open connections across all channels.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>除限速外，代理还对 REST 和 WebSocket 实施每用户并发限制。REST 并发限制同时在途请求数；WS 并发限制所有通道的同时连接数。</span>
      </p>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 12 }}>
        <thead>
          <tr><th style={{ width: 150 }}>Tier</th><th>REST parallel</th><th>WS connections</th></tr>
        </thead>
        <tbody>
          {[
            ["Trial",    "5",   "3"],
            ["Basic",    "2",   "1"],
            ["Value",    "3",   "2"],
            ["Standard", "5",   "3"],
            ["Premium",  "10",  "\u221E"],
          ].map(([t, r, w], i) => (
            <tr key={i}>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{t}</td>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>{r}</td>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>{w}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 12px" }}>
        Exceeding the REST concurrency limit returns <code>429</code> with a JSON body. Exceeding the WS connection limit rejects the <code>auth</code> message and closes the socket with code <code>1008</code>.
      </p>

      <pre className="code" style={{ marginBottom: 40 }}>
{`// 429 response body (plain text) — rate limit
Rate limit exceeded: 301/300 req/min

// 429 response body (JSON) — concurrency limit
{
  "error": "REST concurrency limit exceeded: 5/5 parallel requests"
}

// WS auth rejected — connection limit
[{"T": "error", "msg": "Connection limit exceeded: 3/3 active websockets"}]
// Socket closed with code 1008 (policy violation)

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
        <thead><tr><th>Channel</th><th>Path</th><th>Format</th><th>Basic</th><th>Trial</th><th>Value</th><th>Standard</th><th>Premium</th></tr></thead>
        <tbody>
          {[
            ["stocks",    "/stream",           "msgpack", "—", "✓", "✓", "✓", "✓"],
            ["options",   "/stream/options",   "msgpack", "—", "✓", "✓", "✓", "✓"],
            ["boats",     "/stream/boats",     "msgpack", "—", "✓", "✓", "✓", "✓"],
            ["overnight", "/stream/overnight", "msgpack", "—", "✓", "✓", "✓", "✓"],
            ["crypto",    "/stream/crypto",    "JSON",    "—", "✓", "✓", "✓", "✓"],
            ["news",      "/stream/news",      "JSON",    "—", "✓", "✓", "✓", "✓"],
          ].map(([ch, path, fmt, b, tr, v, s, p], i) => (
            <tr key={i}>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 600 }}>{ch}</td>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>{path}</td>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)" }}>{fmt}</td>
              <td style={{ color: b === "✓" ? "var(--ok)" : "var(--ink-soft)", fontFamily: "var(--f-mono)", textAlign: "center" }}>{b}</td>
              <td style={{ color: tr === "✓" ? "var(--ok)" : "var(--ink-soft)", fontFamily: "var(--f-mono)", textAlign: "center" }}>{tr}</td>
              <td style={{ color: v === "✓" ? "var(--ok)" : "var(--ink-soft)", fontFamily: "var(--f-mono)", textAlign: "center" }}>{v}</td>
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
        Each tier has a per-user connection limit across all channels (see <a href="#concurrency-limits">Concurrency limits</a>). Exceeding it rejects auth with code <code>1008</code>.
      </p>

      {/* ── Channels ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Channels</div>

      <h2 id="stocks" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>stocks</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Live US equities: trades, quotes, and minute bars from the SIP feed (pro account). Subscribe to <code>trades</code>, <code>quotes</code>, and/or <code>bars</code> lists.
        Use <code>"*"</code> to subscribe to all symbols.
      </p>
      <H3>Symbol limit</H3>
      <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: "0 0 12px" }}>basic: — · value: 30 · trial/standard: 50 · premium: 500. Exceeding the limit returns an error message and the subscribe is rejected.</p>

      <h2 id="options" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>options</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Live OPRA options feed. Subscribe using OCC symbols in the <code>trades</code> and <code>quotes</code> lists.
        All tiers except Basic.
        <strong style={{ color: "var(--ink-strong)" }}> Index options are supported</strong> for Alpaca's current SPX/SPXW, VIX/VIXW, DJX and XSP families.
        Use the normal OCC contract symbol; the proxy handles Alpaca's required MsgPack upstream frames and keeps the public <code>/stream/options</code> contract unchanged.
      </p>

      <h2 id="crypto" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>crypto</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Live US crypto orderbooks and trades. Subscribe using <code>orderbooks</code> and/or <code>trades</code> lists with pairs like <code>BTC/USD</code>.
        Messages are plain JSON (not msgpack). All tiers except Basic.
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
        Messages are plain JSON. All tiers except Basic. Historical news is also available via REST <code>/v1/history/news</code>.
      </p>

      <h2 id="overnight" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>overnight</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 28px" }}>
        Extended-hours equity data. Same subscribe format as stocks (trades + quotes). All tiers except Basic.
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

      <h2 id="performance" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Performance tips</h2>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        The proxy serves cached responses in under 1ms. Most client-perceived latency comes from network round-trips and TLS handshakes. These tips can cut TTFB by 50–80%.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>代理返回缓存响应不到 1ms，客户端感知到的延迟主要来自网络往返和 TLS 握手。以下建议可将 TTFB 降低 50–80%。</span>
      </p>

      <h3 style={{ fontSize: 18, margin: "0 0 8px", color: "var(--ink)" }}>Use GET for cacheable endpoints</h3>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Where an endpoint supports both methods, prefer GET for idempotent history reads. Repeated requests can be served by the proxy's hot or archive cache; inspect <code>X-Cache</code> and <code>X-Cache-Tier</code> instead of assuming a specific edge provider.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>对同时支持 GET 与 POST 的端点，幂等历史查询优先使用 GET。重复请求可能命中热缓存或归档缓存，请查看 X-Cache / X-Cache-Tier，不要依赖特定边缘供应商。</span>
      </p>
      <pre className="code" style={{ marginBottom: 12 }}>
{`# POST — JSON body
curl -X POST https://api.leandata.uk/v1/history/bars \\
  -d '{"token":"TOKEN","symbol":"AAPL","start":"2025-01-01","end":"2025-12-31","timeframe":"1Day"}'

# GET — cache-friendly for idempotent reads
curl "https://api.leandata.uk/v1/history/bars?token=TOKEN&symbol=AAPL&start=2025-01-01&end=2025-12-31&timeframe=1Day"

# Check cache status in response headers:
# cf-cache-status: HIT    → served from edge (~20ms)
# cf-cache-status: MISS   → fetched from origin, now cached for next request`}
      </pre>

      <h3 style={{ fontSize: 18, margin: "0 0 8px", color: "var(--ink)" }}>Reuse connections</h3>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Each new HTTPS request pays ~100ms for TCP + TLS handshake. Use a persistent session (HTTP/2 or keep-alive) to amortize this across all requests.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>每个新 HTTPS 请求需约 100ms 用于 TCP + TLS 握手。使用持久连接（HTTP/2 或 keep-alive）可将此开销分摊到所有请求。</span>
      </p>
      <pre className="code" style={{ marginBottom: 12 }}>
{`# Python — use requests.Session for connection reuse
import requests

session = requests.Session()
session.headers["Authorization"] = "Bearer TOKEN"

# First request: ~150ms (TLS handshake + response)
r1 = session.get("https://api.leandata.uk/v1/history/bars",
                  params={"symbol": "AAPL", "start": "2025-01-01",
                          "end": "2025-12-31", "timeframe": "1Day"})

# Subsequent requests: ~20-40ms (connection reused)
r2 = session.get("https://api.leandata.uk/v1/history/bars",
                  params={"symbol": "MSFT", "start": "2025-01-01",
                          "end": "2025-12-31", "timeframe": "1Day"})

# JavaScript — fetch() reuses connections by default
// Node.js: use undici or node-fetch with keepAlive agent
import { Agent } from 'undici'
const agent = new Agent({ keepAliveTimeout: 30000 })`}
      </pre>

      <h3 style={{ fontSize: 18, margin: "0 0 8px", color: "var(--ink)" }}>Choose the right endpoint</h3>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Two REST base URLs are available. Use the one that fits your query type.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>提供两个 REST 基础 URL，根据查询类型选择合适的。</span>
      </p>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 12 }}>
        <thead>
          <tr><th>Base URL</th><th>Best for</th><th>Edge cache TTL</th></tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>api.leandata.uk</td>
            <td style={{ fontSize: 12, color: "var(--ink-muted)" }}>Historical bars, EOD, contracts, news</td>
            <td style={{ fontSize: 12, color: "var(--ink-muted)" }}>7 days</td>
          </tr>
          <tr>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>rt-api.leandata.uk</td>
            <td style={{ fontSize: 12, color: "var(--ink-muted)" }}>Snapshots, crypto orderbooks, real-time quotes</td>
            <td style={{ fontSize: 12, color: "var(--ink-muted)" }}>60 seconds</td>
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 40px" }}>
        Both endpoints return identical data and accept the same authentication. The difference is caching duration and upstream routing.
      </p>
    </div>
  );
}

window.DocsSite = DocsSite;
