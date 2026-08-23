import React, {
  useCallback as useStatusCallback,
  useEffect as useStatusEffect,
  useRef as useStatusRef,
  useState as useStatusState,
} from "react";
import { UsagePage } from "./usage-page.jsx";

// ── StatusBody component ──
// Fetches live data from /api/status, /api/uptime, /api/latency, /api/incidents.
// Auto-refreshes every 30 s.

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

  const statusLabel = status === "operational" ? "正常运行" : status === "degraded" ? "性能下降" : status === "loading" ? "加载中…" : "服务中断";
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
  const lang = useCurrentLanguage();
  const isZh = lang === "zh";
  const Toggle = window.LanguageToggle;
  return (
    <div className="topbar">
      <div className="brand">
        <span className="dot"></span>
        <span><strong>{isZh ? "数据接口文档" : "Proxy Docs"}</strong></span>
      </div>
      <div className="divider"></div>
      <div className="nav">
        <a className={active === "proxy" ? "active" : ""} onClick={() => onNav && onNav("proxy")} style={{ cursor: "pointer" }}>{isZh ? "行情 API" : "Proxy API"}</a>
        <a className={active === "fmp" ? "active" : ""} onClick={() => onNav && onNav("fmp")} style={{ cursor: "pointer" }}>{isZh ? "财务数据" : "Financial Data"}</a>
        <a className={active === "bulk" ? "active" : ""} onClick={() => onNav && onNav("bulk")} style={{ cursor: "pointer" }}>{isZh ? "批量下载" : "Bulk Download"}</a>
        <a className={active === "ws" ? "active" : ""} onClick={() => onNav && onNav("ws")} style={{ cursor: "pointer" }}>{isZh ? "WS 实时流" : "WS Stream"}</a>
        <a className={active === "status" ? "active" : ""} onClick={() => onNav && onNav("status")} style={{ cursor: "pointer" }}>{isZh ? "服务状态" : "Status"}</a>
        <a className={active === "usage" ? "active" : ""} onClick={() => onNav && onNav("usage")} style={{ cursor: "pointer" }}>{isZh ? "用量统计" : "Usage"}</a>
        <a href="/updates" style={{ cursor: "pointer" }}>{isZh ? "产品更新" : "Updates"}</a>
      </div>
      <div className="spacer"></div>
      <div className="meta">
        {Toggle ? <Toggle /> : null}
        <a href="/" className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }}>{isZh ? "Token 账户管理 →" : "Token Portal →"}</a>
      </div>
    </div>
  );
}



function IndexOptionsBanner() {
  const lang = useCurrentLanguage();
  const isZh = lang === "zh";
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
      <strong>{isZh ? "指数期权现已全面上线。" : "Index options are fully supported."}</strong>
      <span>{isZh ? "SPX/SPXW、VIX/VIXW、DJX 和 XSP 等合约查询与实时期权行情流已就绪。" : "SPX/SPXW, VIX/VIXW, DJX, and XSP contract discovery and live option streaming are available."}</span>
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
          Real-time US equities, options, crypto and news — one unified token, zero provider configuration.
          The <strong style={{ color: "var(--ink-strong)" }}>Proxy API</strong> covers REST endpoints and tier management;
          <strong style={{ color: "var(--ink-strong)" }}>WS usage</strong> covers the 6 realtime streaming channels.
        </p>

        {/* Tab strip */}
        <div className="docs-tabs" style={{ marginTop: 32, display: "flex", gap: 0, borderBottom: "1px solid var(--rule)", marginInline: -64, paddingInline: 64 }}>
          <Tab id="proxy" tab={visibleTab} setTab={setTab} label="Proxy API" count="45+ endpoints" />
          <Tab id="fmp" tab={visibleTab} setTab={setTab} label="Financial data" count="overview" />
          <Tab id="bulk" tab={visibleTab} setTab={setTab} label="Bulk Download" count="¥50 / 50GB" />
          <Tab id="ws" tab={visibleTab} setTab={setTab} label="WS usage" count="6 channels" />
          <Tab id="status" tab={visibleTab} setTab={setTab} label="Status" count="live" />
          <Tab id="usage" tab={visibleTab} setTab={setTab} label="Usage" count="my stats" />
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

const SECTION_ZH_LABELS = {
  "Getting started": "入门指南",
  "Overview": "概览与架构",
  "Authentication": "身份鉴权",
  "Tiers & permissions": "套餐与权限",
  "Free plan usage": "Free 计划指引",
  "Token API": "Token 账户接口",
  "register": "注册接口",
  "check-status": "查询状态",
  "generate-token": "获取 Token",
  "REST History": "REST 历史行情",
  "history/bars": "历史 K 线",
  "history/news": "历史新闻",
  "stock trade+quote": "逐笔成交与报价",
  "Index Data": "指数数据",
  "index history": "指数日线历史",
  "Stock Data": "股票数据",
  "overview": "数据概览",
  "Multi-symbol": "多股票批量",
  "auctions": "集合竞价",
  "multi bars": "批量历史 K 线",
  "multi latest bars": "批量最新 K 线",
  "multi quotes": "批量逐笔报价",
  "multi latest quotes": "批量最新报价",
  "multi snapshots": "批量综合快照",
  "multi trades": "批量逐笔成交",
  "multi latest trades": "批量最新成交",
  "Metadata": "元数据字典",
  "condition codes": "成交条件代码",
  "exchange codes": "交易所代码",
  "Single symbol": "单只股票",
  "single bars": "单股历史 K 线",
  "single latest bar": "单股最新 K 线",
  "single quotes": "单股逐笔报价",
  "single latest quote": "单股最新报价",
  "single snapshot": "单股综合快照",
  "single trades": "单股逐笔成交",
  "single latest trade": "单股最新成交",
  "Options Data": "期权数据",
  "routing model": "路由与多级缓存",
  "contracts": "期权合约列表",
  "Snapshots": "期权快照",
  "snapshots": "全链快照与 Greeks",
  "quote": "最新报价快照",
  "snapshot trade": "最新成交快照",
  "open interest": "未平仓量快照",
  "expiry": "按到期日快照",
  "snapshot ohlc": "快照 OHLC",
  "Options history": "期权历史",
  "bars": "历史分钟 K 线",
  "eod": "日终结算数据",
  "history open interest": "历史未平仓量",
  "trades": "历史逐笔成交",
  "history ohlc": "历史 OHLC",
  "Direct API": "原生接口",
  "direct endpoints": "高频原生接口",
  "Crypto Data": "加密货币",
  "orderbooks": "实时订单簿",
  "Admin endpoints": "管理后台接口",
  "login": "管理员登录",
  "pending": "待审核列表",
  "approve": "审批开通",
  "reject": "拒绝申请",
  "Reference": "参考说明",
  "Error codes": "错误代码",
  "Rate limits": "并发与限流",
  "Financial data API": "财务数据 API",
  "Financial data overview": "财务数据概览",
  "Request contract": "请求规范",
  "Response metadata": "响应元数据",
  "Market history": "市场历史",
  "historical-price-eod/full": "日终历史价格全量",
  "Market snapshots": "市场快照",
  "quote-short": "简版报价",
  "aftermarket-quote": "盘后报价",
  "aftermarket-trade": "盘后成交",
  "stock-price-change": "价格涨跌幅",
  "market-capitalization": "当前市值",
  "historical-market-capitalization": "历史市值",
  "batch-quote": "批量报价",
  "batch-quote-short": "批量简版报价",
  "batch-aftermarket-quote": "批量盘后报价",
  "batch-aftermarket-trade": "批量盘后成交",
  "market-capitalization-batch": "批量市值",
  "Company reference": "公司资料与基本面",
  "profile": "公司资料",
  "stock-peers": "同行公司",
  "key-executives": "核心高管",
  "company-notes": "公司备忘录",
  "financial-reports-dates": "财报发布日期",
  "employee-count": "员工人数",
  "historical-employee-count": "历史员工人数",
  "shares-float": "流通股本",
  "shares-float-all": "全量流通股本",
  "dividends": "历史分红",
  "splits": "历史拆股",
  "Financial statements": "财务三大报表",
  "income-statement": "利润表 (Income Statement)",
  "balance-sheet-statement": "资产负债表 (Balance Sheet)",
  "cash-flow-statement": "现金流量表 (Cash Flow)",
  "PIT statements": "时点财报 (Point-in-Time)",
  "Ratios & metrics": "财务比率与指标",
  "ratios": "财务比率 (Ratios)",
  "ratios-ttm": "TTM 财务比率",
  "key-metrics": "关键指标 (Key Metrics)",
  "key-metrics-ttm": "TTM 关键指标",
  "Growth & valuation": "增长与估值",
  "income-statement-growth": "收入增长分析",
  "balance-sheet-statement-growth": "资产负债增长",
  "cash-flow-statement-growth": "现金流增长",
  "financial-growth": "综合财务增长",
  "enterprise-values": "企业价值 (EV)",
  "financial-scores": "财务健康评分",
  "Research & valuation": "深度研究与评级",
  "analyst-estimates": "分析师一致预测",
  "price-target-summary": "目标价汇总",
  "price-target-consensus": "目标价共识",
  "discounted-cash-flow": "DCF 现金流折现估值",
  "custom-discounted-cash-flow": "自定义 DCF 估值",
  "levered-discounted-cash-flow": "杠杆 DCF 估值",
  "custom-levered-discounted-cash-flow": "自定义杠杆 DCF",
  "owner-earnings": "所有者收益",
  "earnings": "历史收益数据",
  "grades": "分析师评级",
  "grades-consensus": "评级共识",
  "grades-historical": "历史评级变动",
  "ratings-snapshot": "综合评分快照",
  "ratings-historical": "历史评分记录",
  "Revenue & directories": "营收细分与代码目录",
  "revenue-geographic-segmentation": "按地区营收细分",
  "revenue-product-segmentation": "按产品营收细分",
  "available-countries": "支持国家列表",
  "available-exchanges": "支持交易所列表",
  "available-industries": "支持行业列表",
  "available-sectors": "支持板块列表",
  "cik-list": "CIK 代码列表",
  "delisted-companies": "已退市公司列表",
  "financial-statement-symbol-list": "财报股票代码列表",
  "stock-list": "全部美股列表",
  "symbol-change": "代码变更历史",
  "Coverage": "覆盖范围说明",
  "Snapshot boundary": "快照更新边界",
  "Future data families": "即将推出数据族",
  "Connecting": "连接与认证",
  "Endpoint": "连接端点",
  "Auth message": "认证消息格式",
  "Heartbeat": "心跳保活机制",
  "Channels": "数据通道",
  "stocks": "美股实时流 (stocks)",
  "options": "期权实时流 (options)",
  "boats": "大宗暗盘流 (boats)",
  "overnight": "夜盘交易流 (overnight)",
  "crypto": "加密货币流 (crypto)",
  "news": "新闻快讯流 (news)",
  "Messages": "交互消息格式",
  "Subscribe": "订阅消息 (Subscribe)",
  "Unsubscribe": "退订消息 (Unsubscribe)",
  "Trade": "逐笔成交帧 (Trade)",
  "Quote": "逐笔报价帧 (Quote)",
  "Bar": "分钟 K 线帧 (Bar)",
  "Operations": "高级运维",
  "Reconnect": "断线重连与退避",
  "Backpressure": "背压与流控机制",
  "System": "系统架构",
  "Components": "核心组件",
  "Latency": "延迟时延",
  "Metrics history": "历史指标",
  "Uptime": "90 天在线率",
  "Incidents": "故障与维护记录",
  "Methodology": "统计方法论"
};

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
    { title: "Getting started", items: ["Overview", "Authentication", "Tiers & permissions", "Free plan usage"] },
    { title: "Token API", items: ["register", "check-status", "generate-token"] },
    { title: "REST History", items: ["history/bars", "history/news", "stock trade+quote"] },
    { title: "Index Data", items: ["index history"] },
    { title: "Stock Data", items: ["overview"], children: [
      { title: "Multi-symbol", items: ["auctions", "multi bars", "multi latest bars", "multi quotes", "multi latest quotes", "multi snapshots", "multi trades", "multi latest trades"] },
      { title: "Metadata", items: ["condition codes", "exchange codes"] },
      { title: "Single symbol", items: ["single bars", "single latest bar", "single quotes", "single latest quote", "single snapshot", "single trades", "single latest trade"] },
    ]},
    { title: "Options Data", items: ["routing model", "contracts"], children: [
      { title: "Snapshots", items: ["snapshots", "quote", "snapshot trade", "open interest", "expiry", "snapshot ohlc"] },
      { title: "Options history", items: ["bars", "eod", "history open interest", "trades", "history ohlc"] },
      { title: "Direct API", items: ["direct endpoints"] },
    ]},
    { title: "Crypto Data", items: ["orderbooks"] },
    { title: "Admin endpoints", items: ["login", "pending", "approve", "reject"] },
    { title: "Reference", items: ["Error codes", "Rate limits"] },
  ] : tab === "fmp-fundamentals" ? [
    { title: "Financial data API", items: ["Financial data overview", "Request contract", "Response metadata"] },
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
    { title: "Metrics history", items: ["Uptime", "Incidents", "Methodology"] },
  ];

  function Chevron({ open }) {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', marginLeft: 'auto', opacity: 0.5 }}>
        <path d="M3 1 L7 5 L3 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }

  function Section({ s, depth = 0 }) {
    const lang = useCurrentLanguage();
    const isZh = lang === "zh";
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
      "Financial data overview": "fmp-fundamentals-overview",
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
    const ID_MAP = {'Overview': 'overview', 'Authentication': 'authentication', 'Tiers & permissions': 'tiers-permissions', 'Free plan usage': 'free-plan-usage', 'register': 'post-register', 'check-status': 'post-check-status', 'generate-token': 'post-generate-token', 'history/bars': 'post-v1-history-bars', 'index history': 'get-post-v1-indices-history', 'history/news': 'post-v1-history-news', 'stock trade+quote': 'post-v1-stock-history-trade-quote', 'overview': 'stock-data-availability', 'auctions': 'stock-auctions', 'multi bars': 'stock-bars', 'multi latest bars': 'stock-latest-bars', 'condition codes': 'stock-condition-codes', 'exchange codes': 'stock-exchange-codes', 'multi quotes': 'stock-quotes', 'multi latest quotes': 'stock-latest-quotes', 'multi snapshots': 'stock-snapshots', 'multi trades': 'stock-trades', 'multi latest trades': 'stock-latest-trades', 'single bars': 'stock-single-bars', 'single latest bar': 'stock-single-latest-bar', 'single quotes': 'stock-single-quotes', 'single latest quote': 'stock-single-latest-quote', 'single snapshot': 'stock-single-snapshot', 'single trades': 'stock-single-trades', 'single latest trade': 'stock-single-latest-trade', 'routing model': 'provider-fallback-cache', 'provider model': 'provider-fallback-cache', 'contracts': 'post-v1-options-contracts', 'snapshots': 'post-v1-options-snapshots', 'quote': 'post-v1-options-snapshots-quote', 'snapshot trade': 'post-v1-options-snapshots-trade', 'open interest': 'post-v1-options-snapshots-open-interest', 'expiry': 'post-v1-options-snapshots-expiry', 'snapshot ohlc': 'post-v3-option-direct-value', 'bars': 'post-v1-history-options-bars', 'eod': 'post-v1-history-options-eod', 'history open interest': 'post-v1-options-open-interest', 'trades': 'post-v1-history-options-trades', 'history ohlc': 'post-v3-option-direct-value', 'direct endpoints': 'post-v3-option-direct-value', 'orderbooks': 'post-v1-crypto-us-latest-orderbooks', 'login': 'post-admin-login', 'pending': 'get-admin-pending', 'approve': 'post-admin-approve', 'reject': 'post-admin-reject', 'Error codes': 'error-codes', 'Rate limits': 'rate-limits', 'Financial data overview': 'fmp-fundamentals-overview', 'Request contract': 'fmp-request-contract', 'Response metadata': 'fmp-response-metadata', 'historical-price-eod/full': 'fmp-historical-price-eod', 'income-statement': 'fmp-income-statement', 'balance-sheet-statement': 'fmp-balance-sheet-statement', 'cash-flow-statement': 'fmp-cash-flow-statement', 'PIT statements': 'fmp-pit-statements', 'ratios': 'fmp-ratios', 'ratios-ttm': 'fmp-ratios-ttm', 'key-metrics': 'fmp-key-metrics', 'key-metrics-ttm': 'fmp-key-metrics-ttm', 'income-statement-growth': 'fmp-income-statement-growth', 'balance-sheet-statement-growth': 'fmp-balance-sheet-statement-growth', 'cash-flow-statement-growth': 'fmp-cash-flow-statement-growth', 'financial-growth': 'fmp-financial-growth', 'enterprise-values': 'fmp-enterprise-values', 'financial-scores': 'fmp-financial-scores', 'Snapshot boundary': 'fmp-snapshot-boundary', 'Future data families': 'fmp-future-data-families'};
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
          <span style={{ flex: 1 }}>{isZh ? (SECTION_ZH_LABELS[s.title] ? `${SECTION_ZH_LABELS[s.title]}` : s.title) : s.title}</span>
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
                        }}>{isZh && SECTION_ZH_LABELS[it] ? `${SECTION_ZH_LABELS[it]}` : it}</a>
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
      ["Financial data overview", "fmp-fundamentals-overview"],
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

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--rule)", fontSize: 11, color: "var(--ink-muted)", lineHeight: 1.55 }}>
        <div style={{ color: "var(--ink-strong)", fontWeight: 600, marginBottom: 2 }}>Leandata Technologies Ltd.</div>
        <div>700 W Georgia St, Vancouver, BC V7Y 1B6, Canada</div>
        <div style={{ marginTop: 3, fontFamily: "var(--f-mono)", fontSize: 10.5 }}>
          <a href="https://leandata.uk" style={{ color: "var(--accent-ink)", textDecoration: "none" }}>leandata.uk</a>
        </div>
      </div>
    </div>
  );
}

// Stable public endpoints. Origin routing can move during failover.
const REST_BASE  = "https://api.leandata.uk";
const RT_BASE    = "https://rt-api.leandata.uk";
const TOKEN_BASE = "https://leandata.uk";
const WS_BASE = "wss://leandata.uk";

function useCurrentLanguage() {
  const [lang, setLang] = React.useState(() => {
    try {
      return localStorage.getItem("leandata.language") || "zh";
    } catch {
      return "zh";
    }
  });
  React.useEffect(() => {
    const handler = (e) => {
      try {
        setLang(e?.detail?.language || localStorage.getItem("leandata.language") || "zh");
      } catch {}
    };
    window.addEventListener("leandata:languagechange", handler);
    return () => window.removeEventListener("leandata:languagechange", handler);
  }, []);
  return lang;
}

function Bilingual({ en, zh }) {
  const lang = useCurrentLanguage();
  return <>{lang === "zh" ? zh : en}</>;
}

function DocDesc({ en, zh, style }) {
  const lang = useCurrentLanguage();
  const isZh = lang === "zh";
  return (
    <p style={{ fontSize: 15, color: "var(--ink-base)", margin: "0 0 12px", lineHeight: 1.65, ...style }}>
      {isZh ? (zh || en) : (en || zh)}
      {isZh && en && zh && <><br/><span style={{ color: "var(--ink-soft)", fontSize: 12.5 }}>{en}</span></>}
      {!isZh && zh && en && <><br/><span style={{ color: "var(--ink-soft)", fontSize: 12.5 }}>{zh}</span></>}
    </p>
  );
}

const API_CATEGORIES = {
  market: { en: "Market data", zh: "行情数据" },
  financial: { en: "Financial data", zh: "财务数据" },
};

function ParamRow({ name, type, required, desc, zh }) {
  const lang = useCurrentLanguage();
  const isZh = lang === "zh";
  const descText = isZh ? (zh || desc) : desc;
  const subText = isZh ? (zh ? desc : null) : (zh || null);
  return (
    <tr>
      <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-strong)", whiteSpace: "nowrap" }}>{name}</td>
      <td style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)" }}>{type}</td>
      <td style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: required ? "var(--accent)" : "var(--ink-soft)" }}>
        {isZh ? (required ? "必填" : "可选") : (required ? "required" : "optional")}
      </td>
      <td style={{ fontSize: 12, color: "var(--ink-base)" }}>
        {descText}
        {subText && <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>{subText}</div>}
      </td>
    </tr>
  );
}

function ParamTable({ rows }) {
  const lang = useCurrentLanguage();
  const isZh = lang === "zh";
  return (
    <table className="tbl" style={{ marginBottom: 20, width: "100%", fontSize: 13 }}>
      <thead>
        <tr>
          <th style={{ width: 180 }}>{isZh ? "参数名 / Parameter" : "Parameter"}</th>
          <th style={{ width: 90 }}>{isZh ? "类型 / Type" : "Type"}</th>
          <th style={{ width: 90 }}>{isZh ? "必填 / Required" : "Required"}</th>
          <th>{isZh ? "说明 / Description" : "Description"}</th>
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
  symbols: { name: "symbols", type: "string", required: true, desc: "Comma-separated symbols, e.g. AAPL,MSFT", zh: "逗号分隔的标的代码列表，例如 AAPL,MSFT" },
  symbolPath: { name: "symbol", type: "path", required: true, desc: "Single ticker in the URL path, e.g. AAPL", zh: "URL 路径中的单个标的代码，例如 AAPL" },
  start: { name: "start", type: "string", required: true, desc: "Inclusive start time/date. ISO 8601 recommended.", zh: "起始时间/日期（包含），推荐 ISO 8601 格式" },
  end: { name: "end", type: "string", required: true, desc: "Exclusive end time/date. ISO 8601 recommended.", zh: "截止时间/日期（不含），推荐 ISO 8601 格式" },
  feed: { name: "feed", type: "string", required: false, desc: "iex is default; sip/delayed_sip/boats/overnight/otc depend on endpoint and entitlement.", zh: "数据源通道（默认 iex，可选 sip、delayed_sip、boats、overnight 等）" },
  limit: { name: "limit", type: "integer", required: false, desc: "Page size. Use next_page_token for pagination when returned.", zh: "单页最大条数，配合 next_page_token 翻页" },
  pageToken: { name: "page_token", type: "string", required: false, desc: "Pagination token from the previous response.", zh: "上一页返回的翻页游标 Token" },
  timeframe: { name: "timeframe", type: "string", required: true, desc: "1Min, 5Min, 15Min, 30Min, 1Hour, 1Day, etc.", zh: "K 线周期：1Min、5Min、15Min、30Min、1Hour、1Day 等" },
  sort: { name: "sort", type: "string", required: false, desc: "asc or desc for historical tick endpoints.", zh: "排序方式：asc（升序）或 desc（降序）" },
  tape: { name: "tape", type: "string", required: true, desc: "Tape A, B, or C. Example: tape=C for Nasdaq-listed symbols.", zh: "交易磁带：Tape A（纽交所）、B（美交所/ETF）或 C（纳斯达克）" },
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
        zh: "查询一个或多个股票的历史集合竞价数据（Auction Prints）。",
        params: [STOCK_COMMON.symbols, STOCK_COMMON.start, STOCK_COMMON.end, { ...STOCK_COMMON.feed, desc: "Consolidated SIP feed for auction prints." }, STOCK_COMMON.limit, STOCK_COMMON.pageToken],
        keys: ["auctions", "next_page_token"],
        tested: "200 OK · Cacheable",
      },
      {
        id: "stock-bars",
        title: "Historical Bars",
        route: "/v2/stocks/bars",
        examplePath: "/v2/stocks/bars?symbols=AAPL&timeframe=1Day&start=2026-05-20&end=2026-05-21&limit=1&feed=sip",
        desc: "Historical OHLCV bars for multiple symbols.",
        zh: "多股票历史 OHLCV K 线（支持多周期与复权调整）。",
        params: [STOCK_COMMON.symbols, STOCK_COMMON.timeframe, STOCK_COMMON.start, STOCK_COMMON.end, STOCK_COMMON.feed, { name: "adjustment", type: "string", required: false, desc: "raw, split, dividend, or all." }, STOCK_COMMON.limit, STOCK_COMMON.pageToken],
        keys: ["bars", "next_page_token"],
        tested: "200 OK · Cacheable",
      },
      {
        id: "stock-latest-bars",
        title: "Latest Bars",
        route: "/v2/stocks/bars/latest",
        examplePath: "/v2/stocks/bars/latest?symbols=AAPL&feed=sip",
        desc: "Most recent minute bar for multiple symbols.",
        zh: "批量查询多股票最新分钟 K 线。",
        params: [STOCK_COMMON.symbols, STOCK_COMMON.feed],
        keys: ["bars"],
        tested: "200 OK · Cacheable",
      },
      {
        id: "stock-quotes",
        title: "Historical Quotes",
        route: "/v2/stocks/quotes",
        examplePath: "/v2/stocks/quotes?symbols=AAPL&start=2026-05-20T13:30:00Z&end=2026-05-20T14:00:00Z&limit=1&feed=sip",
        desc: "Historical bid/ask quote ticks for multiple symbols.",
        zh: "批量查询多股票历史逐笔报价（Quotes）。",
        params: [STOCK_COMMON.symbols, STOCK_COMMON.start, STOCK_COMMON.end, STOCK_COMMON.feed, STOCK_COMMON.limit, STOCK_COMMON.sort, STOCK_COMMON.pageToken],
        keys: ["quotes", "next_page_token"],
        tested: "200 OK · Cacheable",
      },
      {
        id: "stock-latest-quotes",
        title: "Latest Quotes",
        route: "/v2/stocks/quotes/latest",
        examplePath: "/v2/stocks/quotes/latest?symbols=AAPL&feed=sip",
        desc: "Latest quote for multiple symbols.",
        zh: "批量查询多股票最新实时报价（NBBO）。",
        params: [STOCK_COMMON.symbols, STOCK_COMMON.feed],
        keys: ["quotes"],
        tested: "200 OK · Cacheable",
      },
      {
        id: "stock-snapshots",
        title: "Snapshots",
        route: "/v2/stocks/snapshots",
        examplePath: "/v2/stocks/snapshots?symbols=AAPL&feed=sip",
        desc: "Composite latest state: latest trade, latest quote, minute bar, daily bar, and previous daily bar.",
        zh: "批量查询股票综合快照（最新成交、最新报价、分钟 K、日 K、前一日 K）。",
        params: [STOCK_COMMON.symbols, STOCK_COMMON.feed],
        keys: ["AAPL"],
        tested: "200 OK · Cacheable",
      },
      {
        id: "stock-trades",
        title: "Historical Trades",
        route: "/v2/stocks/trades",
        examplePath: "/v2/stocks/trades?symbols=AAPL&start=2026-05-20T13:30:00Z&end=2026-05-20T14:00:00Z&limit=1&feed=sip",
        desc: "Historical trade ticks for multiple symbols.",
        zh: "批量查询多股票历史逐笔成交（Trades）。",
        params: [STOCK_COMMON.symbols, STOCK_COMMON.start, STOCK_COMMON.end, STOCK_COMMON.feed, STOCK_COMMON.limit, STOCK_COMMON.sort, STOCK_COMMON.pageToken],
        keys: ["trades", "next_page_token"],
        tested: "200 OK · Cacheable",
      },
      {
        id: "stock-latest-trades",
        title: "Latest Trades",
        route: "/v2/stocks/trades/latest",
        examplePath: "/v2/stocks/trades/latest?symbols=AAPL&feed=sip",
        desc: "Latest trade for multiple symbols.",
        zh: "批量查询多股票最新成交记录。",
        params: [STOCK_COMMON.symbols, STOCK_COMMON.feed],
        keys: ["trades"],
        tested: "200 OK · Cacheable",
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
        zh: "查询成交与报价条件代码字典说明。",
        params: [{ name: "ticktype", type: "path", required: true, desc: "trade or quote." }, STOCK_COMMON.tape],
        keys: ["1", "4", "5", "6", "7", "8", "9", "@"],
        tested: "200 OK · Cacheable",
      },
      {
        id: "stock-exchange-codes",
        title: "Exchange Codes",
        route: "/v2/stocks/meta/exchanges",
        examplePath: "/v2/stocks/meta/exchanges",
        desc: "Maps exchange code values to readable venue names.",
        zh: "查询交易所代码与交易场所名称字典。",
        params: [],
        keys: ["A", "B", "C", "D", "E", "H", "I", "J"],
        tested: "200 OK · Cacheable",
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
        tested: "200 OK · Cacheable",
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
        tested: "200 OK · Cacheable",
      },
      {
        id: "stock-single-quotes",
        title: "Historical Quotes, Single Symbol",
        route: "/v2/stocks/{symbol}/quotes",
        examplePath: "/v2/stocks/AAPL/quotes?start=2026-05-20T13:30:00Z&end=2026-05-20T14:00:00Z&limit=1&feed=sip",
        desc: "Historical quote ticks for one stock.",
        zh: "单只股票历史逐笔报价（Quotes）。",
        params: [STOCK_COMMON.symbolPath, STOCK_COMMON.start, STOCK_COMMON.end, STOCK_COMMON.feed, STOCK_COMMON.limit, STOCK_COMMON.sort, STOCK_COMMON.pageToken],
        keys: ["quotes", "next_page_token", "symbol"],
        tested: "200 OK · Cacheable",
      },
      {
        id: "stock-single-latest-quote",
        title: "Latest Quote, Single Symbol",
        route: "/v2/stocks/{symbol}/quotes/latest",
        examplePath: "/v2/stocks/AAPL/quotes/latest?feed=sip",
        desc: "Latest quote for one stock.",
        zh: "单只股票最新实时报价。",
        params: [STOCK_COMMON.symbolPath, STOCK_COMMON.feed],
        keys: ["quote", "symbol"],
        tested: "200 OK · Cacheable",
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
        tested: "200 OK · Cacheable",
      },
      {
        id: "stock-single-trades",
        title: "Historical Trades, Single Symbol",
        route: "/v2/stocks/{symbol}/trades",
        examplePath: "/v2/stocks/AAPL/trades?start=2026-05-20T13:30:00Z&end=2026-05-20T14:00:00Z&limit=1&feed=sip",
        desc: "Historical trade ticks for one stock.",
        zh: "单只股票历史逐笔成交（Trades）。",
        params: [STOCK_COMMON.symbolPath, STOCK_COMMON.start, STOCK_COMMON.end, STOCK_COMMON.feed, STOCK_COMMON.limit, STOCK_COMMON.sort, STOCK_COMMON.pageToken],
        keys: ["trades", "next_page_token", "symbol"],
        tested: "200 OK · Cacheable",
      },
      {
        id: "stock-single-latest-trade",
        title: "Latest Trade, Single Symbol",
        route: "/v2/stocks/{symbol}/trades/latest",
        examplePath: "/v2/stocks/AAPL/trades/latest?feed=sip",
        desc: "Latest trade for one stock.",
        zh: "单只股票最新成交记录。",
        params: [STOCK_COMMON.symbolPath, STOCK_COMMON.feed],
        keys: ["trade", "symbol"],
        tested: "200 OK · Cacheable",
      },
    ],
  },
];

function StockEndpointSection({ endpoint }) {
  const lang = useCurrentLanguage();
  const isZh = lang === "zh";
  return (
    <section style={{ marginBottom: 42 }}>
      <h2 id={endpoint.id} className="display-title" style={{ fontSize: 24, margin: "0 0 8px" }}>{endpoint.title}</h2>
      <p style={{ fontSize: 15, color: "var(--ink-base)", margin: "0 0 12px", lineHeight: 1.6 }}>
        {isZh ? (endpoint.zh || endpoint.desc) : endpoint.desc}
        {isZh && endpoint.desc && <><br/><span style={{ color: "var(--ink-soft)", fontSize: 12.5 }}>{endpoint.desc}</span></>}
        {!isZh && endpoint.zh && <><br/><span style={{ color: "var(--ink-soft)", fontSize: 12.5 }}>{endpoint.zh}</span></>}
      </p>
      <EndpointBadge method="GET" path={`${REST_BASE}${endpoint.route}`} />
      {endpoint.params.length > 0 ? <ParamTable rows={endpoint.params} /> : (
        <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 20px" }}>{isZh ? "无需必填查询参数。" : "No query parameters are required."}</p>
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
    detail: "Complete-chain options EOD · measured average ~360 MB per underlying",
  },
  {
    id: "options_eod_alpaca",
    category: "Options",
    label: "Option EOD · traded contracts",
    detail: "Traded-contract options EOD · measured average ~76 MB per underlying",
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
      <div className="eyebrow" style={{ marginBottom: 10 }}>Financial fundamentals data · Premium</div>
      <h2 id="fmp-data-overview" className="display-title" style={{ fontSize: 42, margin: "0 0 10px" }}><Bilingual {...API_CATEGORIES.financial} /></h2>
      <p style={{ fontSize: 16, color: "var(--ink-muted)", lineHeight: 1.65, margin: "0 0 24px", maxWidth: 820 }}>
        通过 Leandata 获取美股财务数据，包括财报、财务指标、公司资料等。使用您的 Leandata token 即可访问，无需额外的 API 密钥。
        <br/>Access US stock financial data including statements, metrics, and company profiles. Use your Leandata token—no additional API keys needed.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 14 }}>详细接口文档请查看左侧 <strong style={{ color: "var(--ink-strong)" }}>Financial data API</strong> 部分。</span>
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 22 }}>
        <div style={panel}>
          <div className="eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>访问权限 / Access</div>
          <div style={{ color: "var(--ink-strong)", fontWeight: 600, marginBottom: 6 }}>Premium 账户</div>
          <div style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55 }}>使用您的 Leandata token 认证，无需额外的 API 密钥。<br/>Use <code>Authorization: Bearer YOUR_TOKEN</code> header.</div>
        </div>
        <div style={panel}>
          <div className="eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>数据类型 / Data Types</div>
          <div style={{ color: "var(--ink-strong)", fontWeight: 600, marginBottom: 6 }}>财报 + 指标 + 公司资料</div>
          <div style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55 }}>包括损益表、资产负债表、现金流量表、财务比率、关键指标、公司简介等。<br/>Income statements, balance sheets, ratios, metrics, profiles, and more.</div>
        </div>
        <div style={panel}>
          <div className="eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>覆盖范围 / Coverage</div>
          <div style={{ color: "var(--ink-strong)", fontWeight: 600, marginBottom: 6 }}>美股主要公司</div>
          <div style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55 }}>当前支持美股主要上市公司的历史财务数据。如有特定公司需求，请联系我们。<br/>Major US-listed companies. Contact us for specific coverage requests.</div>
        </div>
      </div>
      <div style={{ ...panel, borderColor: "var(--accent-rule)", background: "var(--accent-soft)", marginBottom: 22 }}>
        <strong style={{ color: "var(--accent-ink)" }}>查看完整接口文档</strong>
        <span style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.6 }}> 左侧 Financial data API 部分包含所有接口的详细参数、返回示例和使用说明。<br/>See the Financial data API section for complete documentation with parameters and examples.</span>
        <button onClick={openFundamentals} className="btn" style={{ marginLeft: 12, padding: "7px 11px", fontSize: 12 }}>打开文档 / Open Docs →</button>
      </div>
      <h3 id="fmp-snapshot-boundary" className="display-title" style={{ fontSize: 26, margin: "0 0 8px" }}>数据更新说明 / Data Updates</h3>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.7, margin: "0 0 22px" }}>
        财务数据基于公司公开披露的财报。公司可能会修订过往财报（如重述、更正等），我们会定期更新数据以反映这些变化。如需特定日期的历史数据版本，请联系我们。
        <br/><br/>
        Financial data is based on publicly filed company reports. Companies may revise past statements (restatements, corrections), and we update our data accordingly. Contact us if you need historical data as of a specific date.
      </p>
      <h3 id="fmp-future-data-families" className="display-title" style={{ fontSize: 26, margin: "0 0 8px" }}>即将推出 / Coming Soon</h3>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.7, margin: 0 }}>
        我们正在逐步增加更多数据类型，包括：分析师预测、机构持仓、ETF 持仓等。如有特定需求，欢迎联系我们。
        <br/><br/>
        We're expanding coverage to include: analyst estimates, institutional holdings, ETF holdings, and more. Contact us with your specific data needs.
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
    ["/stable/quote", "股票报价 / Quote", "symbol; optional limit", "获取股票的最新报价数据（历史快照，非实时）。Get latest stock quote data (historical snapshot, not real-time)."],
    ["/stable/quote-short", "简版报价 / Quote short", "symbol; optional limit", "获取股票报价的精简版本，包含主要字段。Simplified quote with key fields only."],
    ["/stable/aftermarket-quote", "盘后报价 / Aftermarket quote", "symbol; optional limit", "获取盘后交易时段的报价数据。After-hours trading quote data."],
    ["/stable/aftermarket-trade", "盘后成交 / Aftermarket trade", "symbol; optional limit", "获取盘后交易时段的成交数据。After-hours trading data."],
    ["/stable/stock-price-change", "价格变化 / Price change", "symbol; optional limit", "获取股票价格变化数据（涨跌幅、涨跌额等）。Stock price change metrics (percent change, amount, etc.)."],
    ["/stable/market-capitalization", "市值 / Market cap", "symbol; optional limit", "获取公司当前市值。Current company market capitalization."],
    ["/stable/historical-market-capitalization", "历史市值 / Historical market cap", "symbol; optional from, to, limit", "获取公司历史市值数据，可按日期范围筛选。Historical market cap data with date range filtering."],
    ["/stable/batch-quote", "批量报价 / Batch quote", "optional symbols, limit", "一次查询多只股票的报价。可通过 symbols 参数指定股票列表。Query quotes for multiple stocks at once using symbols parameter."],
    ["/stable/batch-quote-short", "批量简版报价 / Batch quote short", "optional symbols, limit", "一次查询多只股票的精简报价。Simplified quotes for multiple stocks."],
    ["/stable/batch-aftermarket-quote", "批量盘后报价 / Batch aftermarket quote", "optional symbols, limit", "一次查询多只股票的盘后报价。After-hours quotes for multiple stocks."],
    ["/stable/batch-aftermarket-trade", "批量盘后成交 / Batch aftermarket trade", "optional symbols, limit", "一次查询多只股票的盘后成交。After-hours trades for multiple stocks."],
    ["/stable/market-capitalization-batch", "批量市值 / Batch market cap", "optional symbols, limit", "一次查询多家公司的市值。Market capitalization for multiple companies."],
    ["/stable/profile", "公司资料 / Company profile", "exactly one of symbol or cik; optional limit", "获取公司基本信息（名称、行业、地址、简介等）。可用股票代码或 CIK 查询。Company information including name, industry, address, description. Use stock symbol or CIK."],
    ["/stable/stock-peers", "同业公司 / Peer companies", "symbol; optional limit", "获取同行业的相似公司列表。List of peer companies in the same industry."],
    ["/stable/key-executives", "公司高管 / Key executives", "symbol; optional limit", "获取公司高管信息（姓名、职位、薪酬等）。Executive team information including names, titles, and compensation."],
    ["/stable/company-notes", "公司备注 / Company notes", "symbol; optional limit", "获取公司相关的备注信息。Company-related notes and commentary."],
    ["/stable/financial-reports-dates", "财报日期 / Report dates", "symbol; optional limit", "获取公司财报发布日期列表。Financial report filing dates."],
    ["/stable/employee-count", "员工数量 / Employee count", "symbol; optional limit", "获取公司当前员工数量。Current employee headcount."],
    ["/stable/historical-employee-count", "历史员工数 / Historical employees", "symbol; optional limit", "获取公司历史员工数量变化。Historical employee count over time."],
    ["/stable/shares-float", "流通股数 / Shares float", "symbol; optional limit", "获取流通股数量。Number of shares available for public trading."],
    ["/stable/shares-float-all", "流通股列表 / All shares float", "optional limit", "获取所有公司的流通股数据列表。Shares float data for all available companies."],
    ["/stable/dividends", "分红历史 / Dividend history", "symbol; optional from, to, limit", "获取公司分红历史记录（日期、金额等）。Historical dividend payments with dates and amounts."],
    ["/stable/splits", "拆股历史 / Stock split history", "symbol; optional from, to, limit", "获取股票拆分/合并历史记录。Historical stock splits and reverse splits."],
    ["/stable/analyst-estimates", "分析师预测 / Analyst estimates", "symbol; optional limit", "获取分析师对公司业绩的预测数据。Analyst earnings and revenue estimates."],
    ["/stable/price-target-summary", "目标价汇总 / Price target summary", "symbol; optional limit", "获取分析师目标价汇总（平均值、最高、最低）。Analyst price target summary (average, high, low)."],
    ["/stable/price-target-consensus", "目标价共识 / Price target consensus", "symbol; optional limit", "获取分析师目标价共识数据。Consensus analyst price targets."],
    ["/stable/discounted-cash-flow", "DCF 估值 / DCF valuation", "symbol; optional limit", "获取现金流折现估值结果。Discounted cash flow valuation."],
    ["/stable/custom-discounted-cash-flow", "自定义 DCF / Custom DCF", "symbol; optional limit", "获取自定义参数的 DCF 估值。Custom discounted cash flow with adjusted parameters."],
    ["/stable/levered-discounted-cash-flow", "杠杆 DCF / Levered DCF", "symbol; optional limit", "获取考虑财务杠杆的 DCF 估值。Levered discounted cash flow valuation."],
    ["/stable/custom-levered-discounted-cash-flow", "自定义杠杆 DCF / Custom levered DCF", "symbol; optional limit", "获取自定义参数的杠杆 DCF 估值。Custom levered DCF with adjusted parameters."],
    ["/stable/owner-earnings", "所有者收益 / Owner earnings", "symbol; optional limit", "获取所有者收益指标（巴菲特式估值指标）。Owner earnings metric (Buffett-style valuation)."],
    ["/stable/earnings", "业绩公告 / Earnings events", "symbol; optional from, to, limit", "获取公司业绩公告历史（实际业绩、预期、公告日期）。Historical earnings announcements with actual vs expected results."],
    ["/stable/grades", "评级记录 / Analyst grades", "symbol; optional limit", "获取分析师评级记录（买入、持有、卖出等）。Analyst rating history (buy, hold, sell)."],
    ["/stable/grades-consensus", "评级共识 / Rating consensus", "symbol; optional limit", "获取分析师评级的共识结果。Consensus analyst rating."],
    ["/stable/grades-historical", "历史评级 / Historical ratings", "symbol; optional limit", "获取分析师评级的历史变化。Historical analyst rating changes."],
    ["/stable/ratings-snapshot", "评分快照 / Rating scores", "symbol; optional limit", "获取公司各项评分（如 ESG 评分等）。Company rating scores (e.g., ESG scores)."],
    ["/stable/ratings-historical", "历史评分 / Historical scores", "symbol; optional limit", "获取公司评分的历史变化。Historical rating score changes."],
    ["/stable/revenue-geographic-segmentation", "地域收入 / Geographic revenue", "symbol; optional limit", "获取公司按地域划分的收入数据。Revenue breakdown by geographic region."],
    ["/stable/revenue-product-segmentation", "产品收入 / Product revenue", "symbol; optional limit", "获取公司按产品线划分的收入数据。Revenue breakdown by product segment."],
    ["/stable/available-countries", "可用国家 / Available countries", "optional limit", "获取数据覆盖的国家列表。List of countries covered in the dataset."],
    ["/stable/available-exchanges", "可用交易所 / Available exchanges", "optional limit", "获取数据覆盖的交易所列表。List of exchanges covered in the dataset."],
    ["/stable/available-industries", "可用行业 / Available industries", "optional limit", "获取数据覆盖的行业列表。List of industries covered in the dataset."],
    ["/stable/available-sectors", "可用板块 / Available sectors", "optional limit", "获取数据覆盖的板块列表。List of sectors covered in the dataset."],
    ["/stable/cik-list", "CIK 列表 / CIK list", "optional limit", "获取公司 CIK（中央索引码）列表。List of company CIK numbers (Central Index Key)."],
    ["/stable/delisted-companies", "退市公司 / Delisted companies", "optional limit", "获取已退市公司列表。List of delisted companies."],
    ["/stable/financial-statement-symbol-list", "财报 ticker 列表 / Financial statement symbol list", "optional limit", "获取有财报数据的股票列表。List of stocks with financial statement data."],
    ["/stable/stock-list", "股票目录 / Stock list", "optional limit", "获取数据覆盖的所有股票列表。List of all covered stocks."],
    ["/stable/symbol-change", "Ticker 变更 / Symbol change", "optional limit", "获取股票代码历史变更记录（如公司更名）。Historical ticker symbol changes (e.g., company renamings)."],
  ];

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>美股财务数据 · Premium</div>
      <h2 id="fmp-fundamentals-overview" className="display-title" style={{ fontSize: 42, margin: "0 0 10px" }}>财务数据 API / Financial Data API</h2>
      <p style={{ fontSize: 16, color: "var(--ink-muted)", lineHeight: 1.65, margin: "0 0 24px", maxWidth: 820 }}>
        Premium 账户可访问公司财报、财务比率、关键指标、公司资料及参考数据。
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>Premium access includes company statements, ratios, metrics, profiles, and reference data.</span>
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 28 }}>
        <div style={panel}>
          <div className="eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>身份认证 / Authentication</div>
          <div style={{ color: "var(--ink-strong)", fontWeight: 600, marginBottom: 6 }}>使用 Leandata Token</div>
          <div style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55 }}>在请求头中添加 <code>Authorization: Bearer TOKEN</code>，无需额外的数据供应商密钥。<br/>Send the <code>Authorization: Bearer TOKEN</code> header; no additional data-vendor key is required.</div>
        </div>
        <div style={panel}>
          <div className="eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>数据覆盖 / Coverage</div>
          <div style={{ color: "var(--ink-strong)", fontWeight: 600, marginBottom: 6 }}>样本股票池</div>
          <div style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55 }}>Beta 版本覆盖主要美股的财务数据。如需特定股票，请联系我们。<br/>Beta covers major US stocks. Contact us for specific stock requests.</div>
        </div>
        <div style={panel}>
          <div className="eyebrow" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>数据类型 / Data Types</div>
          <div style={{ color: "var(--ink-strong)", fontWeight: 600, marginBottom: 6 }}>财报 + 行情 + 公司资料</div>
          <div style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55 }}>包括财务报表、财务指标、股票报价、公司信息、分析师预测等。<br/>Includes statements, metrics, quotes, profiles, analyst estimates.</div>
        </div>
      </div>

      <div style={{ ...panel, borderColor: "var(--accent-rule)", background: "var(--accent-soft)", marginBottom: 28 }}>
        <strong style={{ color: "var(--accent-ink)" }}>Beta 已开放 / Beta Available</strong>
        <span style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.6 }}> Premium 用户可以查询样本股票的财报、财务指标和公司资料。欢迎反馈缺失的股票或数据。<br/>Premium users can query statements, metrics, and profiles for sample stocks. Feedback welcome for missing data.</span>
      </div>

      <div style={{ ...panel, marginBottom: 28 }}>
        <h3 className="display-title" style={{ fontSize: 24, margin: "0 0 8px" }}>关于数据更新 / About Data Updates</h3>
        <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.7, margin: 0 }}>
          当前数据来自定期采购的批量数据。公司可能修订历史财务数据（如重述、更正等）。后续将提供版本化的历史数据查询，记录每次更新的时间。
          <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>Current data is from bulk snapshots. Companies may revise historical financials (restatements, corrections). Future updates will provide versioned historical queries with capture timestamps.</span>
        </p>
      </div>

      <h3 id="fmp-request-examples" className="display-title" style={{ fontSize: 28, margin: "0 0 10px" }}>请求示例 / Request Examples</h3>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.6, margin: "0 0 14px", maxWidth: 830 }}>
        发送 HTTPS <code>GET</code> 请求到 <code>https://api.leandata.uk</code>，请求头中携带您的 Leandata token。
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>Send HTTPS <code>GET</code> requests to <code>https://api.leandata.uk</code> with your Leandata token in the Authorization header.</span>
      </p>

      <h3 className="display-title" style={{ fontSize: 28, margin: "28px 0 10px" }}>可用接口 / Available Endpoints</h3>
      <div style={{ overflowX: "auto", marginBottom: 16 }}>
        <table className="tbl card" style={{ width: "100%", minWidth: 700, overflow: "hidden" }}>
          <thead><tr><th>接口路径 / Route</th><th>数据类型 / Data Type</th><th>参数 / Parameters</th></tr></thead>
          <tbody>
            <tr><td style={mono}>/stable/income-statement</td><td>利润表 / Income statement</td><td><code>symbol</code>, 可选 <code>period</code>, <code>limit</code></td></tr>
            <tr><td style={mono}>/stable/balance-sheet-statement</td><td>资产负债表 / Balance sheet</td><td><code>symbol</code>, 可选 <code>period</code>, <code>limit</code></td></tr>
            <tr><td style={mono}>/stable/cash-flow-statement</td><td>现金流量表 / Cash flow</td><td><code>symbol</code>, 可选 <code>period</code>, <code>limit</code></td></tr>
            <tr><td style={mono}>/stable/ratios</td><td>财务比率 / Financial ratios</td><td><code>symbol</code>, <code>period=annual|quarter</code>, <code>limit</code></td></tr>
            <tr><td style={mono}>/stable/ratios-ttm</td><td>财务比率（TTM）/ Ratios TTM</td><td><code>symbol</code></td></tr>
            <tr><td style={mono}>/stable/key-metrics</td><td>关键指标 / Key metrics</td><td><code>symbol</code>, <code>period=annual|quarter</code>, <code>limit</code></td></tr>
            <tr><td style={mono}>/stable/key-metrics-ttm</td><td>关键指标（TTM）/ Metrics TTM</td><td><code>symbol</code></td></tr>
            <tr><td style={mono}>/stable/*-statement-growth</td><td>财报增长率 / Statement growth</td><td><code>symbol</code>, <code>period=annual</code></td></tr>
            <tr><td style={mono}>/stable/financial-growth</td><td>财务增长汇总 / Financial growth</td><td><code>symbol</code>, <code>period=annual</code></td></tr>
            <tr><td style={mono}>/stable/enterprise-values</td><td>企业价值 / Enterprise value</td><td><code>symbol</code>, <code>period=annual|quarter</code>, <code>limit</code></td></tr>
            <tr><td style={mono}>/stable/financial-scores</td><td>财务评分 / Financial scores</td><td><code>symbol</code></td></tr>
            <tr><td style={mono}>/v1/pit/fmp/*</td><td>历史版本查询 / Versioned query</td><td><code>symbol</code>, <code>as_of</code>, <code>package_sha256</code></td></tr>
          </tbody>
        </table>
      </div>

      <h3 id="fmp-endpoint-subsections" className="display-title" style={{ fontSize: 28, margin: "32px 0 4px" }}>接口详细说明 / Endpoint Details</h3>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.6, margin: "0 0 4px" }}>
        每个端点均定义自己的字段、时间周期、限制与可用范围。
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>Each endpoint defines its own fields, timeframes, limits, and availability.</span>
      </p>
      <FmpEndpointSection id="fmp-historical-price-eod" route="/stable/historical-price-eod/full" title="历史收盘价 / Historical EOD Price" params={<><code>symbol</code>, <code>from</code>, <code>to</code></>} note="获取股票的历史每日收盘价数据。Get historical end-of-day price data." />
      <FmpEndpointSection id="fmp-income-statement" route="/stable/income-statement" title="利润表 / Income Statement" params={<><code>symbol</code>, 可选 <code>period=annual|quarter</code>, <code>limit</code></>} note="获取公司利润表数据。可查询年报或季报。Get company income statement data. Query annual or quarterly reports." />
      <FmpEndpointSection id="fmp-balance-sheet-statement" route="/stable/balance-sheet-statement" title="资产负债表 / Balance Sheet" params={<><code>symbol</code>, 可选 <code>period=annual|quarter</code>, <code>limit</code></>} note="获取公司资产负债表数据。Get company balance sheet data." />
      <FmpEndpointSection id="fmp-cash-flow-statement" route="/stable/cash-flow-statement" title="现金流量表 / Cash Flow Statement" params={<><code>symbol</code>, 可选 <code>period=annual|quarter</code>, <code>limit</code></>} note="获取公司现金流量表数据。Get company cash flow statement data." />
      <FmpEndpointSection id="fmp-pit-statements" route="/v1/pit/fmp/{income-statement|balance-sheet-statement|cash-flow-statement}" title="历史版本财报查询 / Versioned Statements" params={<><code>symbol</code>, <code>period</code>, <code>as_of</code>, <code>package_sha256</code></>} note="查询特定时间点的财报数据版本。需指定版本标识符。Query financial statements as of a specific date. Requires version identifier." />
      <FmpEndpointSection id="fmp-ratios" route="/stable/ratios" title="财务比率 / Financial Ratios" params={<><code>symbol</code>, <code>period=annual|quarter</code>, <code>limit</code></>} note="获取财务比率（如流动比率、负债率等）。Get financial ratios like current ratio, debt ratio, etc." />
      <FmpEndpointSection id="fmp-ratios-ttm" route="/stable/ratios-ttm" title="财务比率（TTM）/ Ratios TTM" params={<><code>symbol</code>, 可选 <code>limit</code></>} note="获取过去12个月的财务比率。Get trailing-twelve-month financial ratios." />
      <FmpEndpointSection id="fmp-key-metrics" route="/stable/key-metrics" title="关键指标 / Key Metrics" params={<><code>symbol</code>, <code>period=annual|quarter</code>, <code>limit</code></>} note="获取关键财务指标（如市盈率、ROE等）。Get key financial metrics like P/E ratio, ROE, etc." />
      <FmpEndpointSection id="fmp-key-metrics-ttm" route="/stable/key-metrics-ttm" title="关键指标（TTM）/ Metrics TTM" params={<><code>symbol</code>, 可选 <code>limit</code></>} note="获取过去12个月的关键财务指标。Get trailing-twelve-month key metrics." />
      <FmpEndpointSection id="fmp-income-statement-growth" route="/stable/income-statement-growth" title="利润表增长率 / Income Growth" params={<><code>symbol</code>, <code>period=annual</code>, <code>limit</code></>} note="获取利润表各项的同比增长率。Get year-over-year growth rates for income statement items." />
      <FmpEndpointSection id="fmp-balance-sheet-statement-growth" route="/stable/balance-sheet-statement-growth" title="资产负债表增长率 / Balance Sheet Growth" params={<><code>symbol</code>, <code>period=annual</code>, <code>limit</code></>} note="获取资产负债表各项的同比增长率。Get year-over-year growth rates for balance sheet items." />
      <FmpEndpointSection id="fmp-cash-flow-statement-growth" route="/stable/cash-flow-statement-growth" title="现金流量表增长率 / Cash Flow Growth" params={<><code>symbol</code>, <code>period=annual</code>, <code>limit</code></>} note="获取现金流量表各项的同比增长率。Get year-over-year growth rates for cash flow items." />
      <FmpEndpointSection id="fmp-financial-growth" route="/stable/financial-growth" title="财务增长汇总 / Financial Growth Summary" params={<><code>symbol</code>, <code>period=annual</code>, <code>limit</code></>} note="获取财务数据整体增长情况汇总。Get overall financial growth summary." />
      <FmpEndpointSection id="fmp-enterprise-values" route="/stable/enterprise-values" title="企业价值 / Enterprise Value" params={<><code>symbol</code>, <code>period=annual|quarter</code>, <code>limit</code></>} note="获取企业价值历史数据。Get historical enterprise value data." />
      <FmpEndpointSection id="fmp-financial-scores" route="/stable/financial-scores" title="财务评分 / Financial Scores" params={<><code>symbol</code>, 可选 <code>limit</code></>} note="获取 Altman Z-Score、Piotroski F-Score 等财务健康评分。Get Altman Z-Score, Piotroski F-Score, and other financial health scores." />
      <h3 className="display-title" style={{ fontSize: 28, margin: "32px 0 4px" }}>行情与公司资料接口 / Market Data & Company Info</h3>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.65, margin: "0 0 4px" }}>
        以下接口提供股票报价、公司资料、分析师评级等数据。
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>The following endpoints provide stock quotes, company profiles, analyst ratings, and more.</span>
      </p>
      {rawSnapshotEndpoints.map(([route, title, params, note]) => (
        <FmpEndpointSection key={route} id={`fmp-${route.slice("/stable/".length)}`} route={route} title={title} params={params} note={note} />
      ))}

      <pre className="code" style={{ marginBottom: 22 }}>
{`# 获取股票报价（示例使用 AAPL，返回历史数据非实时）
# Get stock quote (example uses AAPL, returns historical data not real-time)
curl "https://api.leandata.uk/stable/quote?symbol=AAPL" \\
  -H "Authorization: Bearer YOUR_TOKEN"

# 响应示例 / Response example
[
  {
    "symbol": "AAPL",
    "name": "Apple Inc.",
    "price": 178.45,
    "change": 2.15,
    "changesPercentage": 1.22,
    "dayLow": 176.30,
    "dayHigh": 179.20,
    "yearHigh": 199.62,
    "yearLow": 164.08,
    "marketCap": 2750000000000,
    "volume": 45678900,
    "avgVolume": 52000000,
    "timestamp": 1722729600
  }
]

# 获取年度利润表（最近5年）
# Get annual income statement (latest 5 years)
curl "https://api.leandata.uk/stable/income-statement?symbol=AAPL&period=annual&limit=5" \\
  -H "Authorization: Bearer YOUR_TOKEN"

# 获取季度资产负债表（最近4个季度）
# Get quarterly balance sheet (latest 4 quarters)
curl "https://api.leandata.uk/stable/balance-sheet-statement?symbol=AAPL&period=quarter&limit=4" \\
  -H "Authorization: Bearer YOUR_TOKEN"

# 获取年度现金流量表
# Get annual cash flow statement
curl "https://api.leandata.uk/stable/cash-flow-statement?symbol=AAPL&period=annual&limit=5" \\
  -H "Authorization: Bearer YOUR_TOKEN"

# 查询历史版本财报（需指定时间点和版本标识）
# Query versioned statement (requires timestamp and version identifier)
curl "https://api.leandata.uk/v1/pit/fmp/income-statement?symbol=AAPL&as_of=2026-08-01T00:00:00Z&package_sha256=PACKAGE_SHA256" \\
  -H "Authorization: Bearer YOUR_TOKEN"`}
      </pre>

      <pre className="code" style={{ marginBottom: 22 }}>
{`# 获取季度财务比率
# Get quarterly financial ratios
curl "https://api.leandata.uk/stable/ratios?symbol=TSLA&period=quarter&limit=4" \\
  -H "Authorization: Bearer YOUR_TOKEN"

# 获取 TTM 财务比率（不需要 period 参数）
# Get TTM ratios (no period parameter needed)
curl "https://api.leandata.uk/stable/ratios-ttm?symbol=MSFT" \\
  -H "Authorization: Bearer YOUR_TOKEN"

# 获取关键财务指标
# Get key financial metrics
curl "https://api.leandata.uk/stable/key-metrics?symbol=GOOGL&period=annual&limit=5" \\
  -H "Authorization: Bearer YOUR_TOKEN"

# 获取年度财务增长率
# Get annual financial growth
curl "https://api.leandata.uk/stable/financial-growth?symbol=NVDA&period=annual&limit=5" \\
  -H "Authorization: Bearer YOUR_TOKEN"

# 获取企业价值和财务评分
# Get enterprise value and financial scores
curl "https://api.leandata.uk/stable/enterprise-values?symbol=META&period=quarter&limit=4" \\
  -H "Authorization: Bearer YOUR_TOKEN"
curl "https://api.leandata.uk/stable/financial-scores?symbol=AMZN" \\
  -H "Authorization: Bearer YOUR_TOKEN"`}
      </pre>

      <h3 className="display-title" style={{ fontSize: 28, margin: "0 0 10px" }}>响应示例 / Response Example</h3>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.6, margin: "0 0 14px", maxWidth: 830 }}>
        接口返回 JSON 数组格式。以下是利润表数据的响应示例（字段值仅作示意）：
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>Endpoints return JSON arrays. Below is an income statement response example (values are illustrative):</span>
      </p>
      <pre className="code" style={{ marginBottom: 22 }}>
{`HTTP/1.1 200 OK
Content-Type: application/json

[
  {
    "date": "2025-12-31",
    "symbol": "AAPL",
    "reportedCurrency": "USD",
    "cik": "0000320193",
    "fillingDate": "2026-02-01",
    "acceptedDate": "2026-02-01T16:30:00.000Z",
    "calendarYear": "2025",
    "period": "FY",
    "revenue": 394328000000,
    "costOfRevenue": 214137000000,
    "grossProfit": 180191000000,
    "operatingIncome": 114301000000,
    "netIncome": 96995000000,
    "eps": 6.13,
    "epsdiluted": 6.11
  }
]`}
      </pre>

      <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.6, margin: "0 0 14px", maxWidth: 830 }}>
        财务比率接口返回的字段包括 <code>currentRatio</code>（流动比率）、<code>quickRatio</code>（速动比率）、<code>debtToEquityRatio</code>（负债权益比）、<code>priceToEarningsRatio</code>（市盈率）、<code>returnOnEquity</code>（ROE）等。TTM 字段通常以 <code>TTM</code> 结尾。字段缺失或为 null 时表示数据源没有提供该字段，请勿当作零处理。
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>Ratios endpoints return fields like <code>currentRatio</code>, <code>quickRatio</code>, <code>debtToEquityRatio</code>, <code>priceToEarningsRatio</code>, <code>returnOnEquity</code>, etc. TTM fields typically end with <code>TTM</code>. Missing or null fields indicate unavailable data—do not treat as zero.</span>
      </p>

      <h3 id="fmp-request-contract" className="display-title" style={{ fontSize: 28, margin: "0 0 10px" }}>参数说明 / Parameters</h3>
      <div style={{ overflowX: "auto", marginBottom: 22 }}>
        <table className="tbl card" style={{ width: "100%", minWidth: 700, overflow: "hidden" }}>
          <thead><tr><th>参数 / Parameter</th><th>用途 / Usage</th><th>说明 / Notes</th></tr></thead>
          <tbody>
            <tr><td style={mono}>symbol</td><td>股票代码（必需）/ Required ticker</td><td>使用上市公司代码，例如 <code>AAPL</code>、<code>TSLA</code>。Use listed ticker symbol like <code>AAPL</code>, <code>TSLA</code>.</td></tr>
            <tr><td style={mono}>period</td><td>时间周期（可选）/ Optional period</td><td><code>annual</code>（年报）或 <code>quarter</code>（季报）。TTM 和评分接口不需要此参数。<br/><code>annual</code> or <code>quarter</code>. Not needed for TTM and scores endpoints.</td></tr>
            <tr><td style={mono}>limit</td><td>返回条数（可选）/ Optional row limit</td><td>限制返回的记录数量，例如 <code>limit=5</code> 返回最近5条。<br/>Limit number of records returned, e.g., <code>limit=5</code> for latest 5 records.</td></tr>
            <tr><td style={mono}>as_of</td><td>查询时间点（版本查询必需）/ Required for versioned queries</td><td>ISO-8601 时间戳格式。仅历史版本查询接口需要。<br/>ISO-8601 timestamp. Only required for versioned query endpoints.</td></tr>
            <tr><td style={mono}>package_sha256</td><td>版本标识符（版本查询必需）/ Version identifier</td><td>数据版本的唯一标识。用于可重复查询。<br/>Unique version identifier for reproducible queries.</td></tr>
          </tbody>
        </table>
      </div>

      <h3 id="fmp-response-metadata" className="display-title" style={{ fontSize: 28, margin: "0 0 10px" }}>数据覆盖说明 / Coverage Notes</h3>
      <ul style={{ margin: "0 0 24px", paddingLeft: 20, color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.8 }}>
        <li><strong style={{ color: "var(--ink-strong)" }}>当前覆盖范围 / Current coverage:</strong> Beta 版本覆盖主要美股的财报、财务指标、股票报价、公司资料、分析师预测、评级、DCF 估值、收入分部等数据。<br/>Beta version covers major US stocks with statements, metrics, quotes, profiles, analyst estimates, ratings, DCF valuations, revenue segments.</li>
        <li><strong style={{ color: "var(--ink-strong)" }}>空结果处理 / Empty results:</strong> 如果返回空数组 <code>[]</code>，表示该股票暂无此类数据，非接口错误。<br/>Empty array <code>[]</code> means no data available for the stock, not an error.</li>
        <li><strong style={{ color: "var(--ink-strong)" }}>暂未提供 / Not yet available:</strong> 机构持仓（institutional holdings）、ETF 持仓数据暂未提供。<br/>Institutional holdings and ETF holdings are not yet available.</li>
        <li><strong style={{ color: "var(--ink-strong)" }}>样本股票池 / Sample universe:</strong> 这是 Beta 测试版本，并非所有股票都有完整数据覆盖。如遇空数组，说明该股票暂未包含在数据集中。<br/>This is Beta—not all tickers have full coverage. Empty arrays indicate the stock is not yet included.</li>
      </ul>

      <h3 className="display-title" style={{ fontSize: 28, margin: "0 0 10px" }}>注意事项 / Important Notes</h3>
      <ul style={{ margin: "0 0 24px", paddingLeft: 20, color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.8 }}>
        <li><strong style={{ color: "var(--ink-strong)" }}>历史数据可能修订 / Historical data may be revised:</strong> 公司可能因重述、更正等原因修订历史财务数据。后续将提供版本化查询功能，记录每次数据更新的时间。<br/>Companies may revise historical financials due to restatements or corrections. Future versions will provide timestamped versioned queries.</li>
        <li><strong style={{ color: "var(--ink-strong)" }}>不同数据类型独立 / Data types are independent:</strong> 股价数据、财报数据、财务比率、预测数据等来自不同数据集。某股票有股价数据不代表一定有财报数据。<br/>Price data, statements, ratios, and estimates are separate datasets. Having price data doesn't guarantee statement data.</li>
        <li><strong style={{ color: "var(--ink-strong)" }}>字段可能缺失 / Fields may be missing:</strong> 不同公司、不同时期的财报字段可能不同。代码应容忍字段缺失或为 null，不要将其当作 0 处理。<br/>Company, period, and filing availability vary. Code should handle missing or null fields, not infer zero.</li>
      </ul>

      <h3 className="display-title" style={{ fontSize: 28, margin: "0 0 10px" }}>后续计划 / Future Plans</h3>
      <ol style={{ margin: "0 0 24px", paddingLeft: 20, color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.8 }}>
        <li>扩展股票覆盖范围，增加更多美股和字段验证。<br/>Expand stock coverage and add more US stocks with field validation.</li>
        <li>为预测、业绩公告、评级、DCF 等数据提供版本化历史查询，记录数据更新时间。<br/>Provide versioned historical queries for estimates, earnings, ratings, DCF with capture timestamps.</li>
        <li>添加更多数据源支持，提供更广泛的接口覆盖。数据源将有独立的更新和修订策略。<br/>Add more data source support for broader endpoint coverage with independent refresh and revision policies.</li>
        <li>发布定期更新的历史数据版本，公开每次更新的时间戳，保留历史版本供查询。<br/>Publish regularly updated data versions with public timestamps, preserving historical versions for queries.</li>
      </ol>

      <div style={{ ...panel, marginBottom: 8 }}>
        <strong style={{ color: "var(--accent-ink)" }}>Ultimate 计划 / Ultimate Plan</strong>
        <span style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55 }}> Ultimate 套餐将包含机构持仓披露、ETF 持仓等数据。这些数据也会遵循版本化管理和时间戳记录。<br/>Ultimate tier will include institutional holdings disclosures and ETF holdings, also with versioned management and timestamps.</span>
      </div>

      <div style={{ ...panel, borderColor: "var(--accent-rule)", background: "var(--accent-soft)", marginBottom: 8 }}>
        <strong style={{ color: "var(--accent-ink)" }}>使用提示 / Usage Tip</strong>
        <span style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.55 }}> 只需使用您的 Leandata token，无需额外的数据供应商密钥。如需查询特定历史版本，保存对应的 <code>as_of</code> 时间和 <code>package_sha256</code> 标识符。<br/>Use your Leandata token only; no additional data-vendor key is required. To reproduce a specific version, save its <code>as_of</code> timestamp and <code>package_sha256</code> identifier.</span>
      </div>
    </div>
  );
}

function ProxyApiBody() {
  const lang = useCurrentLanguage();
  const isZh = lang === "zh";
  return (
    <div style={{ maxWidth: 760 }}>

      {/* ── Getting started ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Getting started</div>
      <h2 id="overview" className="display-title" style={{ fontSize: 38, margin: "0 0 8px" }}><Bilingual {...API_CATEGORIES.market} /></h2>
      <DocDesc
        zh="Leandata 提供两类核心服务：Token 门户负责账户注册与 Token 签发管理；行情代理通过稳定公共域名提供历史 REST、实时 REST 与 WebSocket 实时行情流。使用单一 Token 即可访问全部数据接口，无需自行配置第三方凭证。"
        en="Leandata provides two core surfaces: a token portal for registration and token issuance, and a high-performance market data proxy for historical REST, realtime REST, and secure WebSocket streaming. Authenticate with a single unified token across all historical and realtime data endpoints without managing third-party credentials."
      />
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 16 }}>
        <thead><tr><th>Surface</th><th>Public URL</th><th>Auth</th></tr></thead>
        <tbody>
          <tr><td>Token portal</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{TOKEN_BASE}</td><td style={{ fontSize: 12 }}>username + phone</td></tr>
          <tr><td>REST data proxy</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{REST_BASE}</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>Bearer &lt;token&gt;</td></tr>
          <tr><td>REST real-time proxy</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{RT_BASE}</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>Bearer &lt;token&gt;</td></tr>
          <tr><td>WS data proxy</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{WS_BASE}/stream/*</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>auth message</td></tr>
        </tbody>
      </table>
      <div style={{ background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 16px", margin: "0 0 24px", fontSize: 13 }}>
        <strong style={{ color: "var(--ink-strong)" }}>{"\u26A1"} Stable public endpoints</strong> — use <code>api.leandata.uk</code> for historical REST,
        <code>rt-api.leandata.uk</code> for realtime REST, and <code>wss://leandata.uk/stream/*</code> for streaming.
        All data surfaces accept the same token. Origin hosts and cache tiers may move during failover, so clients should never pin a raw server IP.
        <br/><span style={{ color: "var(--ink-soft)" }}>历史 REST、实时 REST 与 WebSocket 均使用稳定域名和同一 Token。故障切换时源站与缓存层可能调整，客户端不应绑定裸 IP。</span>
      </div>

      <h2 id="authentication" className="display-title" style={{ fontSize: 28, margin: "0 0 12px" }}>{isZh ? "身份鉴权 (Authentication)" : "Authentication"}</h2>
      <DocDesc
        zh="所有数据接口（REST 和 WS）都需要 UUID Token。推荐通过 HTTP Authorization 请求头传递，也支持在 POST JSON 请求体中传递："
        en="All data endpoints (REST and WS) require a UUID token. Pass it as an HTTP header or in the JSON body:"
      />
      <pre className="code" style={{ marginBottom: 12 }}>
{`# Option A — Authorization header (preferred)
Authorization: Bearer <TOKEN>

# Option B — token field in request body
{ "token": "<TOKEN>", "symbol": "AAPL", ... }`}
      </pre>
      <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: "0 0 40px" }}>
        Tokens expire 30 days after issuance (trial: 3 days, non-renewable). The proxy returns <code>401</code> for invalid or expired tokens and <code>403</code> if your tier lacks permission for the endpoint.
      </p>

      <h3 style={{ fontSize: 20, margin: "0 0 10px" }}>Invalid-token abuse protection (enabled runtime contract)</h3>
      <div style={{ background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", margin: "0 0 40px", fontSize: 13, lineHeight: 1.6 }}>
        <strong>Runtime status: enabled on REST and WebSocket authentication.</strong> The limiter applies only to repeated invalid-token attempts; one expired or mistyped token is not a ban condition. REST returns <code>429</code> with <code>Retry-After</code>; WS returns a <code>429</code> control error with <code>retry_after_seconds</code> before closing the failed session.
        <br/><span style={{ color: "var(--ink-soft)" }}>运行状态：REST 与 WebSocket 鉴权均已启用。仅对重复的无效 Token 尝试限流；一次过期或输入错误不会触发封禁。REST 返回带 <code>Retry-After</code> 的 <code>429</code>；WS 在关闭失败连接前返回带 <code>retry_after_seconds</code> 的 <code>429</code> 控制错误。</span>
        <table className="tbl card" style={{ overflow: "hidden", margin: "12px 0" }}>
          <thead><tr><th>Signal</th><th>Action</th><th>Scope</th></tr></thead>
          <tbody>
            <tr><td><code>5</code> invalid-token failures / <code>60s</code></td><td><code>429</code> soft throttle for <code>60s</code> with <code>Retry-After</code></td><td>abuse key</td></tr>
            <tr><td><code>15</code> failures / <code>5m</code></td><td>temporary ban for <code>5m</code></td><td>abuse key</td></tr>
          </tbody>
        </table>
        The abuse key uses a daily-rotated HMAC of the source IP plus a coarse User-Agent category. A presented token may be HMAC-fingerprinted for short-lived correlation, but raw IPs and raw tokens are never logged or persisted. Each temporary ban expires automatically after <code>5 minutes</code>; bans do not escalate. Pseudonymous counters and ban events are retained for at most <code>7 days</code>; identifier-free aggregate totals may be retained for <code>30 days</code>. Rotation occurs at <code>00:00 UTC</code>.
        <br/><span style={{ color: "var(--ink-soft)" }}>防护键由每日轮换的源 IP HMAC 和粗粒度 User-Agent 类别组成。Token 只允许以 HMAC 指纹做短期关联，不记录或持久化原始 IP/Token。每次临时封禁 <code>5 分钟</code>后自动解除，不会升级。伪匿名计数和封禁事件最多保留 <code>7 天</code>；去标识聚合总数可保留 <code>30 天</code>，每日 <code>00:00 UTC</code> 轮换。</span>
      </div>

      <h2 id="tiers-permissions" className="display-title" style={{ fontSize: 28, margin: "0 0 16px" }}>{isZh ? "套餐与权限说明 (Tiers & Permissions)" : "Tiers & permissions"}</h2>
      <DocDesc
        zh="Token 套餐决定数据通道和 REST endpoint 权限；运行时安全限制除特别说明外为共享配置。Basic 仅为老账户兼容，不再开放新注册；大批量数据导出请使用独立的 Bulk Download。"
        en="Token plans control access to channels and REST endpoints. Runtime safety limits are shared unless stated otherwise below. Basic is shown only for existing-account compatibility and is closed to new registration; Bulk Download is the separate one-off product above."
      />
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 12 }}>
        <thead>
          <tr><th style={{ width: 120 }}>Plan</th><th>Price</th><th>WS channels</th><th>WS subjects</th><th>WS account connection cap</th><th>REST historical parallel</th><th>REST endpoints</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="tier free">Free</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>Free (30 days)</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>all 6 channels</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>500 / connection</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>none</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>3</td>
            <td style={{ fontSize: 12 }}>Recent 31 days REST history · Nearest 2 option expiries · Instant activation</td>
          </tr>
          <tr>
            <td><span className="tier trial">Trial</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>¥50/3 days</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>all 6 channels</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>500 / connection</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>none</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>3</td>
            <td style={{ fontSize: 12 }}>Same as Standard · 3-day token · non-renewable</td>
          </tr>
          <tr>
            <td><span className="tier basic">Basic</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>Legacy · closed</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>— (REST only)</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>—</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>—</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>3</td>
            <td style={{ fontSize: 12 }}>existing accounts only · full history via bounded REST requests</td>
          </tr>
          <tr>
            <td><span className="tier value">Value</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>¥70/mo</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>all 6 channels</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>500 / connection</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>none</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>3</td>
            <td style={{ fontSize: 12 }}>REST: stocks OR options (pick at signup) · WS: all channels</td>
          </tr>
          <tr>
            <td><span className="tier standard">Standard</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>¥100/mo</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>all 6 channels</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>500 / connection</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>none</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>3</td>
            <td style={{ fontSize: 12 }}>stocks + options history · no crypto orderbooks</td>
          </tr>
          <tr>
            <td><span className="tier premium">Premium</span></td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>¥150/mo</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>all 6 channels</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>500 / connection</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>none</td>
            <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>3</td>
            <td style={{ fontSize: 12 }}>All REST endpoints including crypto orderbooks</td>
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 8px" }}>
        There is currently no tier-specific rolling REST req/min limiter. Upstream provider limits, the shared service ceiling, and overload backpressure still apply.
        <br/>当前没有按套餐执行的 REST 滚动 req/min 限额；服务总并发和过载背压机制仍然生效。
      </p>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 40px" }}>
        Keep historical REST concurrency at or below <strong>3 in-flight requests per account</strong>. If a <strong>429</strong> is returned, wait for in-flight requests to complete and retry with exponential backoff.
        <br/>单个账号的历史 REST 最大并发请求数建议保持在 <strong>3</strong> 以内。若收到 <strong>429</strong>，请等待在途请求完成并使用指数退避重试。
      </p>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 40px" }}>
        Basic has access to the full available historical range. There is no Basic-specific date-span, symbol-count, or page-count budget. Requests remain subject to provider limits and shared proxy runtime controls such as historical concurrency, QPS, timeouts, and overload backpressure. Bulk Download is a separate one-off delivery product, not a requirement for older dates.
        <br/>Basic 可以访问全部可用历史数据，不设 Basic 专属的日期跨度、symbol 数或页数预算。请求仍受上游限制和 proxy 运行时控制影响，包括历史并发、QPS、超时和过载背压。Bulk Download 是单独的一次性交付产品，不是解锁旧日期的必要条件。
      </p>

      {/* ── Free Plan Usage & Quickstart ── */}
      <div className="eyebrow" style={{ marginBottom: 10, marginTop: 48 }}>Free Plan Guide</div>
      <h2 id="free-plan-usage" className="display-title" style={{ fontSize: 28, margin: "0 0 16px" }}>Free plan usage &amp; code examples</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 16px" }}>
        The Free plan activates automatically on signup and provides access to market endpoints for evaluation and algorithm prototyping.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>Free 计划在注册后自动开通，为策略原型设计与算法回测验证提供市场数据接口访问。</span>
      </p>

      <div style={{ background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 8, padding: "16px", margin: "0 0 24px", fontSize: 13, lineHeight: 1.6 }}>
        <h4 style={{ margin: "0 0 8px", fontSize: 14, color: "var(--ink-strong)" }}>Free Plan Quota &amp; Access Boundaries / 权益与限制边界</h4>
        <ul style={{ margin: "0 0 10px 18px", padding: 0 }}>
          <li><strong>REST Historical Date Window:</strong> Queries must specify explicit <code>start</code> and <code>end</code> bounds within the most recent <strong>31 calendar days</strong>. Older dates return <code>403 free_historical_window_exceeded</code>.</li>
          <li><strong>Option Chains &amp; Snapshots:</strong> Access is limited to the <strong>nearest 2 upcoming expiration cycles</strong> (e.g. 0DTE, nearest weekly or monthly expiries). Expiries further out return <code>403 free_option_chain_window_exceeded</code>.</li>
          <li><strong>Real-time WebSocket:</strong> Full channel access (stocks, options, crypto, news, overnight) with standard connection limits.</li>
          <li><strong>Financial Statements:</strong> Fundamental balance sheet, income, and cash flow archives require an active <strong>Premium</strong> plan (returns <code>403 fmp_premium_required</code>).</li>
        </ul>
        <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>
          中文说明：REST 历史数据必须携带最近 31 个日历日内的明确 <code>start</code> / <code>end</code> 时间范围；期权链与 Greeks 快照支持最近 2 轮到期日；实时 WebSocket 通道全部开放；基本面财务数据需升级至 Premium。
        </span>
      </div>

      <h3 style={{ fontSize: 18, margin: "24px 0 8px" }}>1. Querying historical stock bars (Bounded 31-day range)</h3>
      <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: "0 0 8px" }}>
        Always provide <code>start</code> and <code>end</code> within the 31-day rolling window:
      </p>
      <pre className="code" style={{ marginBottom: 16 }}>
{`# cURL Example (Recent 5 days of 1-minute bars)
curl -X GET "https://api.leandata.uk/v2/stocks/bars?symbols=SPY&timeframe=1Min&start=2026-08-17&end=2026-08-21" \\
  -H "Authorization: Bearer YOUR_TOKEN"`}
      </pre>

      <h3 style={{ fontSize: 18, margin: "24px 0 8px" }}>2. Option contracts &amp; Greeks snapshots (Nearest 2 expiries)</h3>
      <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: "0 0 8px" }}>
        Fetch option chain contracts or snapshot Greeks for the nearest 2 expiration cycles:
      </p>
      <pre className="code" style={{ marginBottom: 16 }}>
{`# Fetch contracts for the nearest upcoming expiries
curl -X GET "https://api.leandata.uk/v1/options/contracts?underlying_symbols=SPY" \\
  -H "Authorization: Bearer YOUR_TOKEN"

# Query Greeks and snapshot quotes for a specific near-term expiry
curl -X GET "https://api.leandata.uk/v1/options/snapshots/expiry?underlying=SPY&expiry=2026-08-25" \\
  -H "Authorization: Bearer YOUR_TOKEN"`}
      </pre>

      <h3 style={{ fontSize: 18, margin: "24px 0 8px" }}>3. Real-time WebSocket streaming</h3>
      <pre className="code" style={{ marginBottom: 16 }}>
{`// Connect to wss://leandata.uk/stream
const ws = new WebSocket("wss://leandata.uk/stream");

ws.onopen = () => {
  // Authenticate
  ws.send(JSON.stringify({
    action: "auth",
    key: "YOUR_TOKEN",
    secret: "YOUR_TOKEN"
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (Array.isArray(msg) && msg[0]?.T === "success") {
    // Subscribe to stock and option live bars
    ws.send(JSON.stringify({
      action: "subscribe",
      bars: ["SPY", "AAPL"]
    }));
  }
};`}
      </pre>

      <h3 style={{ fontSize: 18, margin: "24px 0 8px" }}>4. Python SDK quickstart</h3>
      <pre className="code" style={{ marginBottom: 28 }}>
{`import requests
from datetime import datetime, timezone, timedelta

TOKEN = "YOUR_TOKEN"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# 1. Fetch recent 1-minute bars (within 31-day window)
end_date = datetime.now(timezone.utc)
start_date = end_date - timedelta(days=5)

resp = requests.get(
    "https://api.leandata.uk/v2/stocks/bars",
    params={
        "symbols": "SPY,QQQ",
        "timeframe": "1Min",
        "start": start_date.strftime("%Y-%m-%d"),
        "end": end_date.strftime("%Y-%m-%d")
    },
    headers=HEADERS
)
print("Bars status:", resp.status_code, resp.json().keys())

# 2. Fetch nearest option contracts
resp_opt = requests.get(
    "https://api.leandata.uk/v1/options/contracts",
    params={"underlying_symbols": "SPY"},
    headers=HEADERS
)
print("Option contracts:", resp_opt.status_code)`}
      </pre>

      <h3 style={{ fontSize: 18, margin: "24px 0 8px" }}>5. Error codes &amp; upgrade paths / 常见拦截错误与升级指引</h3>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 32 }}>
        <thead>
          <tr><th style={{ width: 220 }}>Error Code</th><th style={{ width: 120 }}>HTTP Status</th><th>Description &amp; Resolution / 说明与解决方式</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>free_historical_window_exceeded</code></td>
            <td><code>403 Forbidden</code></td>
            <td>Requested dates exceed the 31-day window. Adjust start/end or upgrade to Standard/Premium at <a href="/account.html" style={{ color: "var(--accent-ink)" }}>account.html</a>.</td>
          </tr>
          <tr>
            <td><code>free_historical_date_range_required</code></td>
            <td><code>403 Forbidden</code></td>
            <td>Missing explicit start/end dates. Free requests require bounded date parameters.</td>
          </tr>
          <tr>
            <td><code>free_option_chain_window_exceeded</code></td>
            <td><code>403 Forbidden</code></td>
            <td>Requested expiration is beyond the nearest 2 upcoming cycles. Upgrade for full multi-year option chains.</td>
          </tr>
          <tr>
            <td><code>fmp_premium_required</code></td>
            <td><code>403 Forbidden</code></td>
            <td>Financial statements (Income, Balance Sheet, Cash Flow) require a Premium subscription.</td>
          </tr>
        </tbody>
      </table>

      {/* ── Token API ── */}
      <div className="eyebrow" style={{ marginBottom: 10, marginTop: 48 }}>Token API</div>

      <h2 id="post-register" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /api/register</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>Submit a new account registration. The request enters a pending queue until approved by an admin.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>提交新账户注册申请；请求会进入待审核队列，由管理员审核后开通。</span>
      </p>
      <EndpointBadge method="POST" path={`${TOKEN_BASE}/api/register`} />
      <ParamTable rows={[
        { name: "username", type: "string", required: true, desc: "Unique display name (must not exist in approved users)", zh: "唯一用户名（不可与已有账户重复）" },
        { name: "phone",    type: "string", required: true, desc: "Mobile number used to verify identity on token generation", zh: "用于验证身份与匹配订单的手机号" },
        { name: "email",    type: "string", required: true, desc: "Valid email used for account identity, service notices, and future login verification.", zh: "接收服务通告、安全通知与登录凭据的邮箱" },
        { name: "tier",     type: "string", required: false, desc: "trial | value | standard | premium (default: standard). Basic is retired for new registrations.", zh: "套餐类型：trial | value | standard | premium（默认 standard）" },
        { name: "mode",     type: "string", required: false, desc: "stocks | options — required when tier is value. Determines which data vertical is enabled.", zh: "数据方向：stocks 或 options（仅当 tier 为 value 时必填）" },
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
        { name: "username", type: "string", required: true, desc: "The username submitted at registration", zh: "注册时提交的用户名" },
        { name: "phone",    type: "string", required: true, desc: "The phone number submitted at registration", zh: "注册时提交的手机号" },
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
        { name: "username", type: "string", required: true, desc: "Must match an entry in the approved users database", zh: "必须与已开通数据库中的用户名一致" },
        { name: "phone",    type: "string", required: true, desc: "Must match the phone number on record", zh: "必须与登记在册的手机号一致" },
      ]} />
      <pre className="code" style={{ marginBottom: 48 }}>
{`// Request
{ "username": "ikkipipi", "phone": "15213285787" }

// Response 200
{
  "success": true,
  "token":  "<TOKEN>",
  "expiry": "2026-06-19T14:15:57.059704+00:00",
  "role":   "premium"
}

// Error 401 — credentials not found or not approved
{ "success": false, "message": "User not found or payment pending." }`}
      </pre>

      {/* ── REST History ── */}
      <div className="eyebrow" style={{ marginBottom: 10, marginTop: 0 }}>REST History</div>

      <h2 id="post-v1-history-bars" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/history/bars</h2>
      <DocDesc
        zh="获取美股历史 OHLCV K 线数据（全市场 SIP 官方聚合行情，已复权）。支持自动分页与多级服务端缓存，响应头可通过 X-Cache 查看缓存命中状态。"
        en="Fetch historical OHLCV bars for US equities (SIP consolidated feed, split/dividend adjusted). Paginates automatically up to max_pages. Results are cached server-side; check the X-Cache response header for HIT / MISS."
      />
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/history/bars`} />
      <ParamTable rows={[
        { name: "symbol",    type: "string",  required: true,  desc: "Ticker (e.g. AAPL). Comma-separated for multi-symbol.", zh: "美股股票代码（如 AAPL），支持逗号分隔多标的" },
        { name: "start",     type: "string",  required: true,  desc: "ISO 8601 date or datetime (e.g. 2024-01-02)", zh: "起始日期或时间戳（包含），推荐 ISO 8601 格式" },
        { name: "end",       type: "string",  required: true,  desc: "ISO 8601 date or datetime", zh: "截止日期或时间戳（不含），推荐 ISO 8601 格式" },
        { name: "timeframe", type: "string",  required: false, desc: "1Min | 5Min | 15Min | 30Min | 1Hour | 1Day (default: 1Min)", zh: "K 线周期（默认 1Min，支持 5Min/15Min/1Hour/1Day）" },
        { name: "feed",      type: "string",  required: false, desc: "sip | iex (default: sip)", zh: "数据源通道（默认 sip 官方全市场聚合行情）" },
        { name: "limit",     type: "integer", required: false, desc: "Bars per page, 1–10000 (default: 10000)", zh: "单页最大返回 K 线路数（1-10000，默认 10000）" },
        { name: "max_pages", type: "integer", required: false, desc: "Max pagination pages (default: 100)", zh: "自动分页拉取的最大页数上限（默认 100）" },
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

      <h2 id="get-post-v1-indices-history" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>GET/POST /v1/indices/history</h2>
      <DocDesc
        zh="获取 CBOE 官方现金指数日线数据。支持标普500指数 (SPX)、恐慌指数 (VIX) 和 3个月波动率指数 (VIX3M)。这是现金指数本身的历史价格，非期权链或期货；CBOE 官方发布的 SPX 数据仅含收盘价。"
        en="Fetch normalized daily cash-index history from CBOE. Supported symbols are SPX, VIX, and VIX3M. This is index-level data, not option-chain contracts or VIX futures. CBOE publishes SPX as close-only, so its open, high, and low fields are null."
      />
      <EndpointBadge method="GET/POST" path={`${REST_BASE}/v1/indices/history`} />
      <ParamTable rows={[
        { name: "symbol", type: "string", required: true, desc: "SPX | VIX | VIX3M", zh: "指数代码：SPX（标普500）、VIX（恐慌指数）、VIX3M" },
        { name: "start",  type: "string", required: true, desc: "Inclusive start date in YYYY-MM-DD format", zh: "起始日期（包含），YYYY-MM-DD 格式" },
        { name: "end",    type: "string", required: true, desc: "Inclusive end date in YYYY-MM-DD format", zh: "截止日期（包含），YYYY-MM-DD 格式" },
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
      <DocDesc
        zh="获取全市场或指定标的的历史新闻文章与快讯，所有套餐均可使用。支持 max_pages 自动分页，每页返回最多 50 篇。"
        en="Fetch historical news articles. Available to all tiers including Basic. Pass max_pages greater than 1 to auto-paginate; each page contains up to 50 articles."
      />
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

      <h2 id="post-v1-stock-history-trade-quote" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/stock/history/trade_quote</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Combined historical trade + quote data for a single stock symbol in one call.
        Fetches trades and quotes in parallel, auto-paginates each leg, and returns them in a single response.
        Cached server-side; repeat calls return <code>X-Cache: DISK_HIT</code>.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>单只股票的合并历史成交与报价数据。服务端并行拉取 trades 和 quotes 自动分页并聚合返回，支持服务端多级缓存。</span>
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

      <h2 id="stock-data-availability" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>US Equities Market Data API</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        All standard stock market-data endpoints below are exposed as authenticated <code>GET</code> routes under <code>{REST_BASE}/v2/stocks/*</code>.
        The proxy adheres to the official US consolidated market-data structure, with authentication, caching, and rate limiting handled transparently.
        Feed availability follows standard market entitlement: <code>iex</code> is the default; <code>sip</code>, <code>delayed_sip</code>, <code>boats</code>, <code>overnight</code>, and <code>otc</code> depend on the requested endpoint and subscription.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>以下股票行情接口均通过标准 <code>GET</code> 路径开放。响应结构遵循官方全市场行情规范，鉴权、多级服务端缓存与并发控制由代理统一处理。</span>
      </p>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 28px" }}>
        Every endpoint in this section returns standard JSON payloads. Repeated latest/snapshot calls return <code>X-Cache: DISK_HIT</code> when served from cache.
      </p>

      {STOCK_ENDPOINT_GROUPS.map((group, gi) => (
        <div key={group.title} style={{ marginBottom: gi === STOCK_ENDPOINT_GROUPS.length - 1 ? 48 : 28 }}>
          <h3 id={slugify(group.title)} style={{ fontSize: 17, fontWeight: 500, margin: "0 0 8px", color: "var(--ink-strong)" }}>{group.title}</h3>
          <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: "0 0 20px" }}>{group.intro}</p>
          {group.endpoints.map(endpoint => <StockEndpointSection key={endpoint.id} endpoint={endpoint} />)}
        </div>
      ))}

      {/* ── Provider Data ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Options Data</div>

      <h2 id="provider-fallback-cache" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>{isZh ? "期权数据路由与多级缓存架构" : "Options routing model and server-side cache"}</h2>
      <DocDesc
        zh="底层行情接入多源专业数据链路，由代理网关统一处理鉴权、多级缓存（热点内存 + 历史海量归档）与并发调度："
        en="Market data is unified behind a high-availability proxy layer handling authentication, multi-tier caching (hot memory + historical archive), rate limiting, and automated upstream routing:"
      />
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 20 }}>
        <thead><tr><th>Surface</th><th>Route</th><th>Routing behavior</th></tr></thead>
        <tbody>
          {[
            ["Standard options (OCC)",        "/v1beta1/options/*",                                            "Bars, historical trades, latest quotes/trades, snapshots, and chain snapshots. Historical availability begins 2024-02-01."],
            ["Option bars (1Min)",            "/v1/history/options/bars",                                      "Canonical 1Min bars with source and coverage roles reported in the response. Sparse traded-activity fallback is eligible only for ranges starting on or after 2024-02-01; earlier or boundary-crossing ranges fail closed if dense historical coverage is unavailable. /v1/options/bars is an alias."],
            ["Contracts discovery",           "/v1/options/contracts",                                         "Current active contracts with strikes and expirations. Use /v3/option/list/contracts/* with a historical date for expired contracts."],
            ["Full snapshots / Greeks",       "/v1/options/snapshots",                                         "Latest quote, trade, Greeks, and implied volatility where available."],
            ["Quote / trade snapshots",       "/v1/options/snapshots/{quote,trade}",                           "Normalized latest quote and trade per OCC contract."],
            ["OI / OHLC snapshots",           "/v1/options/snapshots/open_interest, /v3/option/snapshot/*",    "Contract-level open-interest and OHLC snapshots."],
            ["Direct options API",            "/v3/option/*",                                                  "Direct parameter endpoints using root, expiration, strike, and right with structured JSON output."],
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
      </p>
      <h3 id="standard-rest-examples" style={{ fontSize: 16, fontWeight: 500, margin: "0 0 8px", color: "var(--ink-strong)" }}>Standard REST examples</h3>
      <pre className="code" style={{ marginBottom: 40 }}>
{`# Latest stock quote (Standard REST)
curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}/v2/stocks/quotes/latest?symbols=AAPL&feed=sip"

# Latest crypto quote (Standard REST)
curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}/v1beta3/crypto/us/latest/quotes?symbols=BTC%2FUSD"

# Historical stock quotes (Standard REST)
curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}/v2/stocks/quotes?symbols=AAPL&start=2026-05-20T13:30:00Z&end=2026-05-20T14:00:00Z&feed=sip"`}
      </pre>

      <h2 id="post-v1-options-contracts" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/contracts</h2>
      <DocDesc
        zh="查询指定标的当前活跃期权合约列表（包含 OCC 标准代码、行权价、到期日、未平仓合约数及行情字段）。返回的 symbol 可直接作为期权快照与历史 K 线的入参。Free 用户自动返回最近 2 轮有效到期日合约。"
        en="List current active option contracts for one or more underlying symbols. Returns OCC symbol, strike, expiration, option type, open interest where available, and pricing fields. Free users receive the nearest 2 upcoming expiration cycles."
      />
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/options/contracts`} />
      <ParamTable rows={[
        { name: "underlying_symbols",  type: "string",  required: false, desc: "Comma-separated underlyings (e.g. AAPL,TSLA). Required if symbol_or_id not set.", zh: "正股或指数代码（如 AAPL, TSLA），与 symbol_or_id 二选一" },
        { name: "symbol_or_id",        type: "string",  required: false, desc: "Lookup a single OCC symbol or contract ID directly", zh: "直接查询单张期权的 OCC 代码或合约 ID" },
        { name: "expiration_date",     type: "string",  required: false, desc: "Exact expiry YYYY-MM-DD", zh: "精确匹配目标到期日 YYYY-MM-DD" },
        { name: "expiration_date_gte", type: "string",  required: false, desc: "Expiry on or after date", zh: "到期日大于等于指定日期" },
        { name: "expiration_date_lte", type: "string",  required: false, desc: "Expiry on or before date", zh: "到期日小于等于指定日期" },
        { name: "strike_price_gte",    type: "number",  required: false, desc: "Minimum strike price", zh: "最低行权价" },
        { name: "strike_price_lte",    type: "number",  required: false, desc: "Maximum strike price", zh: "最高行权价" },
        { name: "type",                type: "string",  required: false, desc: "call | put", zh: "期权类型：call（看涨）或 put（看跌）" },
        { name: "limit",               type: "integer", required: false, desc: "1–10000 (default: 1000)", zh: "返回合约条数上限（1-10000，默认 1000）" },
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

      <div className="eyebrow" style={{ marginBottom: 6, marginTop: 32, fontSize: 11, color: "var(--ink-soft)" }}>Options Data · History</div>
      <h2 id="post-v1-history-options-bars" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/history/options/bars</h2>
      <DocDesc
        zh="按 OCC 合约代码查询期权历史 OHLCV K 线数据。接口统一返回标准 1 分钟（1Min）分辨率，多周期聚合请在客户端进行重采样（如 pandas.resample）。"
        en="Historical OHLCV bars for OCC option contracts. The canonical route is /v1/history/options/bars. The response is standard 1Min resolution; multi-period requests are normalized to 1Min."
      />
      <div style={{ background: "#fff3cd", border: "1px solid #ffc107", borderRadius: 8, padding: "10px 14px", margin: "0 0 12px", fontSize: 12 }}>
        <strong>{"\u2139\uFE0F"} Coverage note:</strong> Canonical <code>1Min</code> option bars are supported. Inspect <code>provider</code>, <code>providers</code>, and <code>coverage_roles</code> for provenance; sparse traded-activity fallback is not complete contract coverage. That fallback is eligible only when <code>start &gt;= 2024-02-01</code>. Requests starting earlier, including ranges crossing the boundary, require dense historical coverage and fail closed with HTTP <code>502</code> when it is unavailable.
        <br/><span style={{ color: "var(--ink-soft)" }}>覆盖说明：规范 <code>1Min</code> 期权 K 线已支持。请检查 <code>provider</code>、<code>providers</code> 和 <code>coverage_roles</code> 判断来源；稀疏成交回退不代表完整合约覆盖。该回退仅适用于 <code>start &gt;= 2024-02-01</code>。更早开始、包括跨过边界的请求需要完整历史覆盖；不可用时会以 HTTP <code>502</code> 失败关闭。</span>
      </div>
      <div style={{ background: "#fff8e1", border: "1px solid #f0c36d", borderRadius: 8, padding: "10px 14px", margin: "0 0 12px", fontSize: 12 }}>
        <strong>{"\u26A0\uFE0F"} Fixed-granularity warning:</strong> The wrapper always returns <code>1Min</code>. Legacy inputs such as <code>5Min</code>, <code>15Min</code>, <code>30Min</code>, or <code>1Hour</code> are normalized to <code>1Min</code>; there is no server-side aggregate. Basic has no plan-specific request-size budget. Provider limits and proxy runtime limits still apply; on <code>429</code> wait and retry with exponential backoff.
        <br/><span style={{ color: "var(--ink-soft)" }}>固定粒度警告：此 wrapper 永远返回 <code>1Min</code>。<code>5Min</code> 等旧参数只归一化为 <code>1Min</code>，不提供服务端聚合；Basic 不设套餐专属的请求大小预算。上游限制和 proxy 运行时限制仍然生效；收到 <code>429</code> 请等待并指数退避重试。</span>
      </div>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/history/options/bars`} />
      <ParamTable rows={[
        { name: "symbols",   type: "string",  required: true,  desc: "OCC symbol(s), comma-separated", zh: "OCC 标准期权代码（如 AAPL260620C00200000），逗号分隔" },
        { name: "start",     type: "string",  required: true,  desc: "ISO 8601 date", zh: "起始日期（包含，ISO 8601 格式）" },
        { name: "end",       type: "string",  required: true,  desc: "ISO 8601 date", zh: "截止日期（包含，ISO 8601 格式）" },
        { name: "timeframe", type: "string",  required: false, desc: "Output is standard 1Min. Multi-minute requests are normalized to 1Min.", zh: "K 线周期（统一返回 1Min 标准分钟线）" },
        { name: "limit",     type: "integer", required: false, desc: "Bars per page, 1–10000 (default: 10000)", zh: "单页条数上限（1-10000，默认 10000）" },
        { name: "max_pages", type: "integer", required: false, desc: "Max pagination pages (default: 100)", zh: "自动分页最大页数（默认 100）" },
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
  -d '{"symbols":"AAPL260620C00200000","start":"2025-05-01","end":"2025-05-15","timeframe":"1Min"}'`}
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
      <pre className="code" style={{ marginBottom: 40 }}>
{`// Client-side 5-minute resampling (pandas)
frame["t"] = pd.to_datetime(frame["t"], utc=True)
bars_5m = (frame.set_index("t").resample("5min")
  .agg({"o":"first","h":"max","l":"min","c":"last","v":"sum","n":"sum"})
  .dropna(subset=["o","h","l","c"]))`}
      </pre>

      <h2 id="post-v1-options-open-interest" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>GET/POST /v1/options/open_interest</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Historical open interest by date range with optional strike, expiration, and right filters.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>按日期范围和行权价/到期日筛选期权历史未平仓合约数（Open Interest）。</span>
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

      <h2 id="post-v1-history-options-eod" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>GET/POST /v1/history/options/eod</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        End-of-day OHLC summary for option contracts: open/high/low/close, volume, bid/ask spread, and trade count per contract per day. Supports <code>GET</code> (query parameters) and <code>POST</code> (JSON body).
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>期权合约日终（EOD）行情汇总，包含开高低收、成交量、买卖盘报价及成交笔数。支持 GET 与 POST。</span>
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
        Historical option trade ticks by OCC symbol.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>按 OCC 合约代码查询历史期权逐笔成交明细（Trade Ticks）。</span>
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
}`}
      </pre>

      {/* ── Snapshots ── */}
      <div className="eyebrow" style={{ marginBottom: 6, marginTop: 48, fontSize: 11, color: "var(--ink-soft)" }}>Options Data · Snapshots</div>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 24px" }}>
        Snapshot endpoints return the <em>latest</em> state of option contracts — greeks, quotes, trade, open interest — served from a high-speed in-memory cache.
        All snapshot endpoints accept OCC symbols obtained from <code>/v1/options/contracts</code>.
      </p>

      <h2 id="post-v1-options-snapshots" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/snapshots</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Full snapshot per contract: latest trade, latest quote, greeks (delta, gamma, theta, vega, rho), and implied volatility.
        Use the sub-endpoints below when you only need a specific slice.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>单个合约的全量实时快照：包含最新成交、最新报价、希腊字母风险指标（Delta, Gamma, Theta, Vega, Rho）及隐含波动率（IV）。</span>
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
        Latest NBBO quote per contract, normalized to <code>snapshots[OCC].latestQuote</code>.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>期权合约最新 NBBO 报价，统一归一化到 snapshots[OCC].latestQuote。</span>
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/options/snapshots/quote`} />
      <ParamTable rows={[
        { name: "symbols", type: "string",  required: true,  desc: "Comma-separated OCC option symbols (max 1000 per request)" },
        { name: "feed",    type: "string",  required: false, desc: "opra | indicative (default follows account entitlement)" },
        { name: "limit",   type: "integer", required: false, desc: "1–1000 (default: 100)" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/options/snapshots/quote \\
  -H "Authorization: Bearer <TOKEN>" \\
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
        { name: "symbols", type: "string",  required: true,  desc: "Comma-separated OCC option symbols (max 100 per request)" },
        { name: "feed",    type: "string",  required: false, desc: "opra | indicative (default follows account entitlement)" },
      ]} />
      <pre className="code" style={{ marginBottom: 40 }}>
{`curl -X POST ${REST_BASE}/v1/options/snapshots/trade \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbols":"AAPL260522C00110000","feed":"indicative"}'`}
      </pre>

      <h2 id="post-v1-options-snapshots-open-interest" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/snapshots/open_interest</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Latest open interest per contract (count + timestamp).
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>期权合约最新持仓量（OI 快照）。</span>
      </p>
      <EndpointBadge method="POST" path={`${REST_BASE}/v1/options/snapshots/open_interest`} />
      <ParamTable rows={[
        { name: "symbols", type: "string",  required: true,  desc: "Comma-separated OCC option symbols (max 1000 per request)" },
        { name: "limit",   type: "integer", required: false, desc: "1–1000 (default: 100)" },
      ]} />
      <pre className="code" style={{ marginBottom: 12 }}>
{`curl -X POST ${REST_BASE}/v1/options/snapshots/open_interest \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"symbols":"AAPL260522C00110000"}'`}
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
    json={"symbols": symbols}
)
for sym, snap in resp.json()["snapshots"].items():
    oi = snap["openInterest"]
    print(f"{sym}  OI={oi['oi']}  as_of={oi['t']}")`}
      </pre>

      <h2 id="post-v1-options-snapshots-expiry" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>POST /v1/options/snapshots/expiry</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Convenience endpoint: fetches <em>all</em> contracts for an underlying on a specific expiry date and returns their snapshots in one call.
        Resolves the contract list and batches snapshot requests automatically.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>便捷接口：一次性获取指定标的在特定到期日的所有合约快照（自动解析合约链并批量请求快照）。</span>
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

      {/* ── Direct Options API ── */}
      <div className="eyebrow" style={{ marginBottom: 6, marginTop: 48, fontSize: 11, color: "var(--ink-soft)" }}>Options Data · Direct API</div>
      <h2 id="post-v3-option-direct-value" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>GET/POST /v3/option/* (Direct Options API)</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Direct parameter endpoints for querying options data using root ticker, expiration (YYMMDD), strike, and right (C/P) instead of OCC symbols.
        Supports both <code>GET</code> query parameters and <code>POST</code> JSON bodies, with responses cached server-side.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>期权原生参数查询接口：支持直接使用标的代码、到期日（YYMMDD）、行权价与权利类型（C/P）组合查询，无需拼接 OCC 字符串。支持 GET 与 POST。</span>
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
{`# GET — query parameters
curl -H "Authorization: Bearer <TOKEN>" \\
  "${REST_BASE}/v3/option/history/ohlc?root=AAPL&exp=260620&strike=200.0&right=C&start_date=20250102&end_date=20250103"

# POST — JSON body
curl -X POST ${REST_BASE}/v3/option/history/ohlc \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"root":"AAPL","exp":260620,"strike":200.0,"right":"C","start_date":20250102,"end_date":20250103}'`}
      </pre>
      <pre className="code" style={{ marginBottom: 40 }}>
{`// Response
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

// Response
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
{`// Response
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
  "token":  "<TOKEN>",
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
            ["429", '{"error":"historical_concurrency_limit"}', "More than 3 historical REST requests are in flight for this account"],
            ["429", '{"error":"rate_limit_exceeded"}', "Rate limit reached; back off and retry"],
            ["500", '{"error":"internal_server_error"}', "Internal proxy server error"],
            ["503", '{"error":"service_unavailable"}', "Market data service temporarily unavailable"],
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
        <strong>HTTP 429 = an enforced runtime limit was reached.</strong> The common cause is the per-account historical REST concurrency cap. Wait for in-flight requests to complete and retry with exponential backoff.
        <br/><span style={{ color: "var(--ink-soft)" }}>收到 HTTP 429 表示触发了运行时限制，常见原因是账号历史 REST 并发达到上限。请等待在途请求完成并使用指数退避。</span>
      </div>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        The proxy does not currently enforce the old tier-specific rolling req/min values. Historical REST concurrency is per account and remains held until the response body reaches EOF.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>代理当前不执行旧的套餐级滚动 req/min 数值。历史 REST 并发按账号计算，并持续占用到响应正文读取完毕。</span>
      </p>
      <table className="tbl card" style={{ overflow: "hidden", marginBottom: 12 }}>
        <thead>
          <tr><th style={{ width: 220 }}>Runtime limit</th><th>Enforced value</th><th>Scope</th></tr>
        </thead>
        <tbody>
          {[
            ["Historical REST concurrency", "3", "per account"],
            ["Historical options REST QPS", "5/s", "per account"],
            ["WS subjects", "500", "per connection"],
            ["WS connections", "no account cap", "service capacity still applies"],
          ].map(([limit, value, scope], i) => (
            <tr key={i}>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{limit}</td>
              <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, textAlign: "center" }}>{value}</td>
              <td style={{ fontSize: 12, color: "var(--ink-soft)" }}>{scope}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 12px" }}>
        These are current runtime limits, not capacity guarantees. No plan-specific historical request-size budget is enforced. Service-wide backpressure can return <code>503</code>, and provider-capacity limits can return <code>429</code>.
        <br/><span style={{ color: "var(--ink-soft)" }}>这些是当前运行时限制，不是容量保证；历史请求大小不按套餐单独设预算。服务总背压可能返回 <code>503</code>，数据源容量限制可能返回 <code>429</code>。</span>
      </p>

      <h2 id="concurrency-limits" className="display-title" style={{ fontSize: 28, margin: "0 0 12px" }}>Concurrency limits</h2>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        The account-level concurrency cap applies only to historical REST: ordinary accounts may have up to <strong>3</strong> requests in flight.
        WebSocket accounts have no account-level connection cap. Each connection may subscribe to at most <strong>500 subjects</strong>.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>账号级并发上限仅适用于历史 REST：单个账号最多同时有 <strong>3</strong> 个并发在途请求。WebSocket 不设账号级连接数上限；每条连接最多订阅 <strong>500 个 subjects</strong>。</span>
      </p>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 12px" }}>
        Subjects count actual deliveries, not unique ticker strings. For example, <code>AAPL trades</code> plus <code>AAPL quotes</code> is two subjects; subscribing to the same subject on two connections counts twice because the frame is delivered twice. Accounts are counted independently: under the current admission logic, two paid accounts may each open 100 WebSocket connections. This is not an unlimited-capacity SLA. For large fan-out, keep a small number of upstream sockets and redistribute locally through a local proxy.
        <br/>Subjects 按实际投递计数，不按唯一 ticker 去重。例如同时订阅 <code>AAPL trades</code> 和 <code>AAPL quotes</code> 算两个 subjects；同一 subject 在两条连接上订阅也算两次，因为数据会发送两次。不同账号独立计数：按当前准入逻辑，两个付费账号可以各开 100 条 WS；这不代表无限容量 SLA。大规模分发建议仅保留少量上游连接，再通过本地代理转发给多个本地进程。
      </p>

      <pre className="code" style={{ marginBottom: 40 }}>
{`// 429 response body (JSON) — historical REST concurrency
{
  "error": "historical_concurrency_limit",
  "message": "Per-user historical concurrency limit exceeded"
}

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
  const lang = useCurrentLanguage();
  const isZh = lang === "zh";
  const H3 = ({ children }) => (
    <h3 style={{ fontFamily: "var(--f-sans)", fontWeight: 500, fontSize: 13, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink-muted)", margin: "32px 0 12px" }}>{children}</h3>
  );
  return (
    <div style={{ maxWidth: 760 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>{isZh ? "实时数据流" : "Realtime"}</div>
      <h2 id="endpoint" className="display-title" style={{ fontSize: 38, margin: "0 0 8px" }}>{isZh ? "WebSocket 连接与实时数据流" : "WebSocket connection"}</h2>
      <DocDesc
        zh="每个数据通道都有专属的独立 URL 路径。连接至对应 URL 后，先发送包含 Token 的 auth 认证消息，随后即可发送 subscribe 进行标的订阅。股票、期权、夜盘和暗盘通道采用二进制 MessagePack 格式编码，延迟更低；加密货币与新闻通道采用标准 JSON 格式。"
        en="Each channel has a dedicated path. Connect to the appropriate URL, send an auth message with your token, then send subscribe messages. Stocks/options/overnight/boats messages are binary MessagePack; crypto and news channels use JSON."
      />

      <table className="tbl card" style={{ marginBottom: 28, overflow: "hidden" }}>
        <thead><tr><th>{isZh ? "通道 / Channel" : "Channel"}</th><th>{isZh ? "路径 / Path" : "Path"}</th><th>{isZh ? "格式 / Format" : "Format"}</th><th>Basic</th><th>Trial</th><th>Value</th><th>Standard</th><th>Premium</th></tr></thead>
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
      <h2 id="auth-message" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>Connect, authenticate, subscribe / 连接、认证、订阅</h2>
      <DocDesc
        zh="建立 WebSocket 连接后，客户端首先发送一条包含 Token 的 auth 认证动作。鉴权在消息体中完成，无需 HTTP 请求头。"
        en="After opening the WebSocket, send an auth action. Authentication happens in the message body — no HTTP headers are needed."
      />
      <pre className="code" style={{ marginBottom: 12 }}>
{`{"action": "auth", "token": "<TOKEN>"}
{"action": "subscribe", "trades": ["AAPL"], "quotes": ["AAPL"]}`}
      </pre>
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
      <DocDesc
        zh="服务端会自动向客户端发送 WebSocket Ping 帧进行链路活性探测。绝大部分主流客户端库会自动响应 Pong 帧。若客户端不支持自动响应，请在收到 Ping 帧后调用 pong() 以保持长连接。若客户端发送队列积压超过 200 条消息，服务端将主动断开连接以保护系统健康。WebSocket 不设账号级连接数上限；单连接 500 个 subjects 限制依然适用。"
        en="The server sends WebSocket ping frames automatically. Most client libraries respond to pings automatically. If your client does not, call pong() on receipt to stay connected. The server will close connections that exceed the send queue limit (200 messages)."
      />

      {/* ── Channels ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Channels</div>

      <h2 id="stocks" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>{isZh ? "美股实时行情流 (stocks)" : "stocks"}</h2>
      <DocDesc
        zh="美股实时行情流：支持全市场 SIP 官方聚合行情的 Trades 逐笔成交、Quotes 逐笔买卖盘与分钟 K 线。通过 trades、quotes 或 bars 列表订阅，支持 * 订阅全市场标的。"
        en="Live US equities: trades, quotes, and minute bars from the consolidated SIP feed. Subscribe to trades, quotes, and/or bars lists. Use * to subscribe to all symbols."
      />
      <H3>Subject limit</H3>
      <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: "0 0 12px" }}>Each connection supports up to 500 subjects. A ticker subscribed under both <code>trades</code> and <code>quotes</code> consumes two subjects.</p>

      <h2 id="options" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>{isZh ? "期权实时行情流 (options)" : "options"}</h2>
      <DocDesc
        zh="OPRA 官方期权行情实时流：在 trades 和 quotes 列表中传入标准 OCC 期权代码进行订阅。除 Basic 套餐外均可使用。支持 SPX/SPXW、VIX/VIXW、DJX、XSP 等主流指数期权。行情通过 /stream/options 上的二进制 MessagePack 帧高效推送。"
        en="Live OPRA options feed. Subscribe using OCC symbols in the trades and quotes lists. All tiers except Basic. Index options are supported for SPX/SPXW, VIX/VIXW, DJX and XSP families."
      />

      <h2 id="crypto" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>{isZh ? "加密货币实时流 (crypto)" : "crypto"}</h2>
      <DocDesc
        zh="美国主流加密货币实时订单簿与逐笔成交：在 orderbooks 和 trades 列表中传入 BTC/USD、ETH/USD 等交易对。消息为标准 JSON 格式。除 Basic 外所有套餐可用。"
        en="Live US crypto orderbooks and trades. Subscribe using orderbooks and/or trades lists with pairs like BTC/USD. Messages are plain JSON (not msgpack). All tiers except Basic."
      />
      <pre className="code" style={{ marginBottom: 24 }}>
{`await ws.send(json.dumps({
    "action": "subscribe",
    "orderbooks": ["BTC/USD", "ETH/USD"],
    "trades":     ["BTC/USD"]
}))`}
      </pre>

      <h2 id="news" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>{isZh ? "实时新闻快讯流 (news)" : "news"}</h2>
      <DocDesc
        zh="实时金融新闻与快讯流：传入目标 ticker 列表或 * 订阅全量新闻。消息为标准 JSON 格式。历史新闻亦可通过 REST /v1/history/news 获取。"
        en="Realtime market news events. Subscribe with a news list of tickers or * for all. Messages are plain JSON. All tiers except Basic. Historical news is also available via REST /v1/history/news."
      />

      <h2 id="overnight" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>{isZh ? "美股夜盘交易流 (overnight)" : "overnight"}</h2>
      <DocDesc
        zh="美股夜盘交易时段数据：订阅格式与股票流一致（包含 trades 与 quotes）。除 Basic 外所有套餐可用。"
        en="Extended-hours equity data. Same subscribe format as stocks (trades + quotes). All tiers except Basic."
      />

      {/* ── Messages ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Messages</div>

      <h2 id="subscribe" className="display-title" style={{ fontSize: 28, margin: "0 0 8px" }}>{isZh ? "订阅与退订 (Subscribe / Unsubscribe)" : "Subscribe / Unsubscribe"}</h2>
      <DocDesc
        zh="订阅与退订共用相同的数据结构，仅 action 字段不同（subscribe 或 unsubscribe）。支持增量订阅，每次调用会在当前连接已有标的上追加或移除。"
        en="Subscribe and unsubscribe actions share the same shape — only the action field differs. You can update subscriptions incrementally; each call adds or removes the listed symbols."
      />
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
        Handle reconnects with backoff.
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
# X-Cache: HIT      → served from in-memory hot cache (~1ms)
# X-Cache: DISK_HIT → served from fast SSD archive (~5-15ms)
# X-Cache: MISS     → fetched from upstream and cached for next request`}
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
export { DocsSite };
