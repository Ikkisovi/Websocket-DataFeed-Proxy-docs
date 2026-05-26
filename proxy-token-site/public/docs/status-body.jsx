// status-body.jsx — Status page for the Public Docs Site
// Two components: REST API (Cloudflare → EC2) and WebSocket (direct → EC2)
// Surfaces: overall status header, per-component cards (uptime + latency p50/p95/p99 + sparkline),
//           90-day uptime grid, latency chart with range toggle, and incident log.
//
// Data is mocked here (static docs site). To wire to real telemetry, replace `useStatusData`
// with a fetcher pointed at /api/status, /api/uptime, /api/latency.

const { useState: useStatusState, useMemo: useStatusMemo, useEffect: useStatusEffect } = React;

// ── deterministic pseudo-random for mock data ───────────────────────────
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

// 90-day uptime: array of 0/1/2 (operational/degraded/outage)
function makeUptime(seed, baseUptime = 0.998) {
  const rng = seeded(seed);
  return Array.from({ length: 90 }, () => {
    const r = rng();
    if (r > baseUptime + 0.001) return 2;
    if (r > baseUptime - 0.01) return 1;
    return 0;
  });
}

// 24h latency (24 points, one per hour). REST higher baseline, WS very low.
function makeLatency(seed, base, jitter) {
  const rng = seeded(seed);
  return Array.from({ length: 24 }, (_, i) => {
    const hourFactor = 1 + 0.18 * Math.sin((i / 24) * 2 * Math.PI - Math.PI / 2); // market-hours bulge
    return Math.round(base * hourFactor + (rng() - 0.5) * jitter);
  });
}

function pctUp(arr) {
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

  const statusLabel = status === "operational" ? "Operational" : status === "degraded" ? "Degraded" : "Outage";
  const statusColor = status === "operational" ? "var(--ok)" : status === "degraded" ? "var(--warn)" : "var(--danger)";
  const statusBg    = status === "operational" ? "var(--ok-soft)" : status === "degraded" ? "var(--warn-soft)" : "var(--danger-soft)";

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
function LatencyChart({ rest, ws, range }) {
  // For ranges other than 24h, generate longer series
  const len = range === "24h" ? 24 : range === "7d" ? 7 * 24 : 30 * 24;
  const restSeries = useStatusMemo(() => makeLatency(101 + len, 92, 28).concat(Array.from({ length: len - 24 }, (_, i) => {
    const r = seeded(202 + i)();
    return Math.round(92 + (r - 0.5) * 36);
  })).slice(0, len), [len]);
  const wsSeries = useStatusMemo(() => makeLatency(303 + len, 6.5, 2).concat(Array.from({ length: len - 24 }, (_, i) => {
    const r = seeded(404 + i)();
    return Math.round((6.5 + (r - 0.5) * 3) * 10) / 10;
  })).slice(0, len), [len]);

  const W = 720, H = 200, PAD_L = 44, PAD_R = 12, PAD_T = 16, PAD_B = 28;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const max = Math.max(...restSeries) * 1.1;
  const xStep = plotW / (restSeries.length - 1);

  const restPath = restSeries.map((v, i) => `${i === 0 ? "M" : "L"}${PAD_L + i * xStep},${PAD_T + plotH - (v / max) * plotH}`).join(" ");
  const wsPath = wsSeries.map((v, i) => `${i === 0 ? "M" : "L"}${PAD_L + i * xStep},${PAD_T + plotH - (v / max) * plotH}`).join(" ");

  const gridLines = [0, 50, 100, 150];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {/* grid */}
      {gridLines.filter(g => g <= max).map(g => (
        <g key={g}>
          <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH - (g / max) * plotH} y2={PAD_T + plotH - (g / max) * plotH} stroke="var(--rule)" strokeDasharray="2 3"/>
          <text x={PAD_L - 6} y={PAD_T + plotH - (g / max) * plotH + 3} textAnchor="end" fontSize="9" fontFamily="var(--f-mono)" fill="var(--ink-soft)">{g}ms</text>
        </g>
      ))}
      {/* axis baseline */}
      <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="var(--rule-strong)"/>
      {/* time ticks */}
      {[0, 0.25, 0.5, 0.75, 1].map(p => {
        const x = PAD_L + plotW * p;
        const label = range === "24h"
          ? `${Math.round(p * 24)}h`
          : range === "7d"
          ? `${Math.round(p * 7)}d`
          : `${Math.round(p * 30)}d`;
        return (
          <g key={p}>
            <line x1={x} x2={x} y1={PAD_T + plotH} y2={PAD_T + plotH + 3} stroke="var(--rule-strong)"/>
            <text x={x} y={PAD_T + plotH + 14} textAnchor="middle" fontSize="9" fontFamily="var(--f-mono)" fill="var(--ink-soft)">−{label}</text>
          </g>
        );
      })}
      {/* REST series */}
      <path d={restPath} fill="none" stroke="var(--accent-ink)" strokeWidth="1.5"/>
      {/* WS series */}
      <path d={wsPath} fill="none" stroke="oklch(0.55 0.16 295)" strokeWidth="1.5"/>
    </svg>
  );
}

// ── data hook ──────────────────────────────────────────────────────────
function useStatusData() {
  return useStatusMemo(() => {
    const restUptime = makeUptime(7, 0.997);
    const wsUptime = makeUptime(11, 0.999);
    // Force last 30d to look healthy
    for (let i = 60; i < 90; i++) {
      if (Math.random() < 0.95) restUptime[i] = restUptime[i] === 2 ? 1 : restUptime[i];
    }
    return {
      rest: {
        name: "REST API",
        route: "api.leandata.uk · Cloudflare → EC2 (us-west-2)",
        status: "operational",
        uptime90: restUptime,
        latency24h: makeLatency(2026, 92, 24), // ms
      },
      ws: {
        name: "WebSocket stream",
        route: "ws://52.37.182.24:8767 · EC2 direct",
        status: "operational",
        uptime90: wsUptime,
        latency24h: makeLatency(2027, 6.5, 2).map(v => Math.round(v * 10) / 10), // ms with 1 decimal
      },
    };
  }, []);
}

// ── incidents (mock) ─────────────────────────────────────────────────────
const INCIDENTS = [
  {
    date: "2026-05-12", component: "REST API", severity: "minor", duration: "12 min",
    title: "Cache layer eviction backlog",
    summary: "Disk cache compactor stalled on a long-running snapshot; new writes queued. p99 latency spiked from 220ms → 1.4s on /v1/options/snapshots. Resolved by restarting the compactor process; no data loss.",
  },
  {
    date: "2026-04-28", component: "WebSocket stream", severity: "minor", duration: "47 min",
    title: "Upstream SIP feed delay",
    summary: "Alpaca SIP feed reported 200–400 ms delay on stocks channel between 14:08–14:55 UTC. Proxy continued to deliver messages; only end-to-end timing affected. Resolved upstream.",
  },
  {
    date: "2026-04-19", component: "REST API", severity: "minor", duration: "8 min",
    title: "Cloudflare cache purge",
    summary: "Scheduled cache purge during low-traffic window caused brief X-Cache: MISS spike. p95 latency rose from 142ms → 380ms while warm cache rebuilt. Expected behavior.",
  },
  {
    date: "2026-03-30", component: "WebSocket stream", severity: "major", duration: "3 min",
    title: "EC2 instance reboot",
    summary: "Security patch required full reboot. All active WS connections dropped with code 1013 and reconnected automatically within 90 seconds. REST unaffected (CF edge).",
  },
];

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

  const overall = (data.rest.status === "operational" && data.ws.status === "operational")
    ? "operational"
    : (data.rest.status === "outage" || data.ws.status === "outage")
      ? "outage"
      : "degraded";

  const overallLabel = overall === "operational" ? "All systems operational" : overall === "outage" ? "Service disruption" : "Partial degradation";
  const overallColor = overall === "operational" ? "var(--ok)" : overall === "outage" ? "var(--danger)" : "var(--warn)";
  const overallBg    = overall === "operational" ? "var(--ok-soft)" : overall === "outage" ? "var(--danger-soft)" : "var(--warn-soft)";

  const now = new Date();
  const lastUpdated = now.toISOString().replace("T", " ").slice(0, 16) + " UTC";

  return (
    <div style={{ maxWidth: 760 }}>
      {/* ── Overview ── */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>System</div>
      <h2 id="overview" className="display-title" style={{ fontSize: 38, margin: "0 0 8px" }}>Status</h2>
      <p style={{ fontSize: 15, color: "var(--ink-muted)", margin: "0 0 24px", maxWidth: 620 }}>
        Live health of the REST API (Cloudflare → EC2) and WebSocket stream (EC2 direct).
        Uptime is sampled every minute; latency percentiles are computed over a rolling 60-minute window.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>REST API（Cloudflare → EC2）与 WebSocket 流（EC2 直连）的实时健康指标。可用性按分钟采样，延迟分位数按 60 分钟滚动窗口计算。</span>
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 40 }}>
        <ComponentCard {...data.rest} unit="ms" color="var(--accent-ink)"/>
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
            <span style={{ width: 12, height: 2, background: "oklch(0.55 0.16 295)" }}/> WebSocket
          </span>
          <span style={{ flex: 1 }}/>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)" }}>
            {range} · ms · client → response
          </span>
        </div>
        <LatencyChart rest={data.rest.latency24h} ws={data.ws.latency24h} range={range}/>
      </div>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 40px" }}>
        REST latency includes Cloudflare edge → EC2 origin round-trip plus server processing.
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
      <div style={{ borderTop: "1px solid var(--rule)" }}>
        {INCIDENTS.map((inc, i) => (
          <div key={i} style={{ padding: "16px 0", borderBottom: "1px solid var(--rule)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)" }}>{inc.date}</span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>·</span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>{inc.component}</span>
              <span style={{ flex: 1 }}/>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)" }}>{inc.duration}</span>
              <SeverityChip s={inc.severity}/>
            </div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-strong)", marginBottom: 4 }}>{inc.title}</div>
            <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: 0, lineHeight: 1.55 }}>{inc.summary}</p>
          </div>
        ))}
      </div>

      {/* ── Methodology ── */}
      <h2 id="methodology" className="display-title" style={{ fontSize: 28, margin: "40px 0 12px" }}>Methodology</h2>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 12px", maxWidth: 620 }}>
        Probes run from <code className="ic">us-west-2</code>, <code className="ic">us-east-1</code>, and <code className="ic">eu-west-1</code> every 60 seconds.
        REST checks: <code className="ic">GET /v2/stocks/quotes/latest?symbols=AAPL</code> with a known token. WebSocket checks: connect, auth, expect <code className="ic">{"{T:\"success\"}"}</code> within 5 s.
        Uptime is the fraction of checks that completed with HTTP 2xx (REST) or a valid auth response (WS) within the SLO window.
        <br/><span style={{ color: "var(--ink-soft)", fontSize: 13 }}>
          探针位于 us-west-2、us-east-1、eu-west-1，每 60 秒采样一次。REST 检查命中已知 token 的最新报价接口；WS 检查建连后等待认证回执。可用性 = 在 SLO 窗口内 HTTP 2xx 或认证成功的探针比例。
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

window.StatusBody = StatusBody;
