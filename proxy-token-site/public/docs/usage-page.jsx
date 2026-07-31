// usage-page.jsx — Static Usage / Quota dashboard preview
// This is a visual placeholder, not a view of the audit log, stats endpoint,
// account activity, production traffic, or billable usage:
//
//   · KPI strip — REST today, cache hit %, WS subs vs plan limit, token expiry
//   · Daily REST request volume   (bar chart, 30d, hover tooltip)
//   · Cache hit vs miss           (stacked bars, 30d)
//   · WS symbols subscribed over time vs plan ceiling
//   · Recent audit events table   (last 50)
//
// PLACEHOLDER ONLY. All numbers below are seeded demo data. This public page is
// deliberately labelled as non-production until a server-side, authenticated
// usage ledger is wired in. Do not present these values as account usage or billing.

const { useState: useUsageState, useMemo: useUsageMemo, useEffect: useUsageEffect, useCallback: useUsageCb } = React;

// ─────────────────────────────────────────────────────────────────────────────
// Mock data — seeded so layout is deterministic
// ─────────────────────────────────────────────────────────────────────────────

function usageSeeded(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

const TODAY = new Date("2026-05-26");

function makeDays(n = 30) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(TODAY);
    d.setDate(d.getDate() - i);
    out.push(d);
  }
  return out;
}

function fmtMonthDay(d) {
  return `${d.getMonth() + 1}-${d.getDate()}`;
}
function fmtFullDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function fmtNumber(n) {
  return n.toLocaleString("en-US");
}

// Endpoints split — REST families ikkipipi typically hits.
const ENDPOINT_FAMILIES = [
  { id: "stocks",   label: "/v1/stock/history/*",     color: "var(--accent)" },
  { id: "options",  label: "/v1/options/*",           color: "oklch(0.62 0.09 195)" },
  { id: "news",     label: "/v1/history/news",        color: "oklch(0.72 0.08 195)" },
  { id: "admin",    label: "/v1/admin/*",             color: "var(--ink-soft)" },
];

function makeDailyRequests() {
  const rng = usageSeeded(7);
  return makeDays(30).map((d, i) => {
    // Weekday bulge, Sundays quieter.
    const dow = d.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const base = isWeekend ? 180 : 720;
    const jitter = isWeekend ? 80 : 280;
    // One spike day mid-month for visual interest
    const spike = i === 18 ? 1.85 : 1;
    const stocks   = Math.round((base * 0.55 + (rng() - 0.5) * jitter) * spike);
    const options  = Math.round((base * 0.28 + (rng() - 0.5) * jitter * 0.6) * spike);
    const news     = Math.round((base * 0.10 + (rng() - 0.5) * jitter * 0.3) * spike);
    const admin    = Math.round((base * 0.07 + (rng() - 0.5) * jitter * 0.15) * spike);
    const total = stocks + options + news + admin;
    return { date: d, stocks: Math.max(0, stocks), options: Math.max(0, options), news: Math.max(0, news), admin: Math.max(0, admin), total };
  });
}

function makeDailyCache() {
  const rng = usageSeeded(13);
  return makeDays(30).map((d, i) => {
    const dow = d.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const total = isWeekend ? Math.round(220 + rng() * 100) : Math.round(820 + rng() * 380);
    // Hit ratio drifts between 55% – 78% with cold-start dip on Mondays.
    const ratio = dow === 1 ? 0.45 + rng() * 0.1 : 0.62 + rng() * 0.16;
    const hits = Math.round(total * ratio);
    const misses = total - hits;
    return { date: d, hits, misses, total, ratio };
  });
}

function makeDailyWs() {
  const rng = usageSeeded(23);
  return makeDays(30).map((d, i) => {
    // Day-by-day peak symbols subscribed; 500-symbol Premium ceiling.
    const base = 280 + Math.sin(i / 4) * 80;
    const jitter = (rng() - 0.5) * 90;
    const peak = Math.max(40, Math.min(495, Math.round(base + jitter)));
    return { date: d, peak };
  });
}

// Audit events — derived from the request series so totals line up.
function makeAuditEvents() {
  const rng = usageSeeded(31);
  const ENDPOINTS = [
    { e: "http_request", ep: "/v1/stock/history/bars",         family: "stocks" },
    { e: "http_request", ep: "/v1/stock/history/trade_quote",  family: "stocks" },
    { e: "http_request", ep: "/v1/options/chains",             family: "options" },
    { e: "http_request", ep: "/v1/options/history/bars",       family: "options" },
    { e: "http_request", ep: "/v1/history/news",               family: "news" },
    { e: "http_request", ep: "/v1/admin/stats",                family: "admin" },
    { e: "ws_request",   ep: "ws · subscribe",                 family: "ws", ws: "subscribe", mode: "stocks" },
    { e: "ws_request",   ep: "ws · subscribe",                 family: "ws", ws: "subscribe", mode: "options" },
    { e: "ws_request",   ep: "ws · subscribe",                 family: "ws", ws: "subscribe", mode: "news" },
    { e: "ws_request",   ep: "ws · auth",                      family: "ws", ws: "auth", mode: "stocks" },
    { e: "ws_request",   ep: "ws · unsubscribe",               family: "ws", ws: "unsubscribe", mode: "options" },
  ];
  const SYMBOLS = ["AAPL", "MSFT", "TSLA", "NVDA", "SPY", "QQQ", "AMD", "META", "GOOGL", "AMZN"];
  const STATUS = [200, 200, 200, 200, 200, 200, 200, 200, 429, 200];
  const CACHE  = ["HIT", "HIT", "HIT", "MISS", "HIT", "MISS", "HIT", "HIT", "HIT", "MISS"];

  const out = [];
  for (let i = 0; i < 60; i++) {
    const def = ENDPOINTS[Math.floor(rng() * ENDPOINTS.length)];
    const status = STATUS[Math.floor(rng() * STATUS.length)];
    const minsAgo = Math.floor(rng() * 220) + i * 3;
    const ts = new Date(TODAY.getTime() - minsAgo * 60 * 1000);
    const symbols = Array.from({ length: 1 + Math.floor(rng() * 2) }, () => SYMBOLS[Math.floor(rng() * SYMBOLS.length)]);
    const ev = {
      ts,
      event: def.e,
      endpoint: def.ep,
      status,
      family: def.family,
      cache: def.e === "http_request" ? CACHE[Math.floor(rng() * CACHE.length)] : null,
      elapsed_ms: def.e === "http_request"
        ? (CACHE[Math.floor(rng() * CACHE.length)] === "HIT" ? Math.round(20 + rng() * 80) : Math.round(160 + rng() * 700))
        : Math.round(2 + rng() * 8),
      symbols: def.e === "ws_request"
        ? symbols.slice(0, 1 + Math.floor(rng() * 5))
        : symbols,
      ws_event: def.ws || null,
      mode: def.mode || null,
    };
    out.push(ev);
  }
  return out.sort((a, b) => b.ts - a.ts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Charts — light, minimal SVG, no chart library
// ─────────────────────────────────────────────────────────────────────────────

function StackedBarChart({ data, height = 220, families, hover, setHover }) {
  // data: [{date, stocks, options, news, admin, total}]
  const padL = 44;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const width = 920;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const max = Math.max(...data.map(d => d.total));
  const niceMax = Math.ceil(max / 200) * 200;
  const barW = innerW / data.length * 0.66;
  const step = innerW / data.length;

  // y ticks
  const ticks = [0, niceMax * 0.5, niceMax];

  return (
    <div style={{ position: "relative" }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", width: "100%", height }}>
        {/* grid */}
        {ticks.map((t, i) => {
          const y = padT + innerH - (t / niceMax) * innerH;
          return (
            <g key={i}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="var(--rule)" strokeWidth="1" />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize="10" fontFamily="var(--f-mono)" fill="var(--ink-soft)">
                {fmtNumber(t)}
              </text>
            </g>
          );
        })}
        {/* bars */}
        {data.map((d, i) => {
          const x = padL + i * step + (step - barW) / 2;
          let yCursor = padT + innerH;
          const isHover = hover === i;
          return (
            <g key={i}
               onMouseEnter={() => setHover(i)}
               onMouseLeave={() => setHover(null)}>
              <rect x={x - (step - barW) / 2} y={padT} width={step} height={innerH} fill="transparent" />
              {families.map(fam => {
                const v = d[fam.id];
                const h = (v / niceMax) * innerH;
                yCursor -= h;
                return (
                  <rect
                    key={fam.id}
                    x={x}
                    y={yCursor}
                    width={barW}
                    height={h}
                    fill={fam.color}
                    opacity={isHover ? 1 : 0.92}
                    style={{ transition: "opacity .12s" }}
                  />
                );
              })}
            </g>
          );
        })}
        {/* x labels (sparse) */}
        {data.map((d, i) => {
          if (i !== 0 && i !== data.length - 1 && i !== Math.floor(data.length / 2)) return null;
          const x = padL + i * step + step / 2;
          return (
            <text key={i} x={x} y={height - 10} textAnchor="middle" fontSize="10" fontFamily="var(--f-mono)" fill="var(--ink-soft)">
              {fmtMonthDay(d.date)}
            </text>
          );
        })}
      </svg>

      {/* hover tooltip */}
      {hover !== null && (() => {
        const d = data[hover];
        const xPct = (padL + hover * step + step / 2) / width * 100;
        const placeRight = xPct < 50;
        return (
          <div style={{
            position: "absolute",
            left: `${xPct}%`,
            top: 12,
            transform: placeRight ? "translateX(12px)" : "translateX(calc(-100% - 12px))",
            background: "var(--bg-paper)",
            border: "1px solid var(--rule-strong)",
            borderRadius: "var(--radius-md)",
            boxShadow: "0 6px 24px rgba(26,24,21,0.08)",
            padding: "10px 12px",
            minWidth: 220,
            fontSize: 12,
            pointerEvents: "none",
            zIndex: 5,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontFamily: "var(--f-mono)", color: "var(--ink-strong)", fontWeight: 500 }}>{fmtFullDate(d.date)}</span>
              <span style={{ fontFamily: "var(--f-mono)", color: "var(--ink-strong)", fontWeight: 500 }}>{fmtNumber(d.total)}</span>
            </div>
            {families.map(fam => (
              <div key={fam.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ink-muted)" }}>
                  <span style={{ width: 8, height: 8, background: fam.color, borderRadius: 2 }}></span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>{fam.label}</span>
                </span>
                <span style={{ fontFamily: "var(--f-mono)", color: "var(--ink-strong)", fontSize: 11 }}>{fmtNumber(d[fam.id])}</span>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

function CacheBarChart({ data, height = 180 }) {
  const [hover, setHover] = useUsageState(null);
  const padL = 44, padR = 16, padT = 16, padB = 28;
  const width = 920;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const max = Math.max(...data.map(d => d.total));
  const niceMax = Math.ceil(max / 200) * 200;
  const barW = innerW / data.length * 0.66;
  const step = innerW / data.length;
  const ticks = [0, niceMax * 0.5, niceMax];

  return (
    <div style={{ position: "relative" }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", width: "100%", height }}>
        {ticks.map((t, i) => {
          const y = padT + innerH - (t / niceMax) * innerH;
          return (
            <g key={i}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="var(--rule)" strokeWidth="1" />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize="10" fontFamily="var(--f-mono)" fill="var(--ink-soft)">{fmtNumber(t)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = padL + i * step + (step - barW) / 2;
          const hitH = (d.hits / niceMax) * innerH;
          const missH = (d.misses / niceMax) * innerH;
          const isHover = hover === i;
          return (
            <g key={i}
               onMouseEnter={() => setHover(i)}
               onMouseLeave={() => setHover(null)}>
              <rect x={x - (step - barW) / 2} y={padT} width={step} height={innerH} fill="transparent" />
              <rect x={x} y={padT + innerH - missH - hitH} width={barW} height={hitH} fill="var(--ok)" opacity={isHover ? 1 : 0.88}/>
              <rect x={x} y={padT + innerH - missH} width={barW} height={missH} fill="var(--ink-soft)" opacity={isHover ? 1 : 0.55}/>
            </g>
          );
        })}
        {data.map((d, i) => {
          if (i !== 0 && i !== data.length - 1 && i !== Math.floor(data.length / 2)) return null;
          const x = padL + i * step + step / 2;
          return (
            <text key={i} x={x} y={height - 10} textAnchor="middle" fontSize="10" fontFamily="var(--f-mono)" fill="var(--ink-soft)">{fmtMonthDay(d.date)}</text>
          );
        })}
      </svg>
      {hover !== null && (() => {
        const d = data[hover];
        const xPct = (padL + hover * step + step / 2) / width * 100;
        const placeRight = xPct < 50;
        return (
          <div style={{
            position: "absolute",
            left: `${xPct}%`,
            top: 12,
            transform: placeRight ? "translateX(12px)" : "translateX(calc(-100% - 12px))",
            background: "var(--bg-paper)",
            border: "1px solid var(--rule-strong)",
            borderRadius: "var(--radius-md)",
            boxShadow: "0 6px 24px rgba(26,24,21,0.08)",
            padding: "10px 12px",
            minWidth: 220, fontSize: 12, pointerEvents: "none", zIndex: 5,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontFamily: "var(--f-mono)", color: "var(--ink-strong)", fontWeight: 500 }}>{fmtFullDate(d.date)}</span>
              <span style={{ fontFamily: "var(--f-mono)", color: "var(--ink-strong)", fontWeight: 500 }}>{(d.ratio * 100).toFixed(1)}% hit</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ink-muted)" }}>
                <span style={{ width: 8, height: 8, background: "var(--ok)", borderRadius: 2 }}></span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>X-Cache: HIT</span>
              </span>
              <span style={{ fontFamily: "var(--f-mono)", color: "var(--ink-strong)", fontSize: 11 }}>{fmtNumber(d.hits)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ink-muted)" }}>
                <span style={{ width: 8, height: 8, background: "var(--ink-soft)", borderRadius: 2 }}></span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>MISS</span>
              </span>
              <span style={{ fontFamily: "var(--f-mono)", color: "var(--ink-strong)", fontSize: 11 }}>{fmtNumber(d.misses)}</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function WsLineChart({ data, ceiling, height = 180 }) {
  const [hover, setHover] = useUsageState(null);
  const padL = 44, padR = 16, padT = 16, padB = 28;
  const width = 920;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const niceMax = ceiling;
  const step = innerW / (data.length - 1);
  const ticks = [0, niceMax * 0.5, niceMax];

  const points = data.map((d, i) => [padL + i * step, padT + innerH - (d.peak / niceMax) * innerH]);
  const path = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const area = `${path} L${padL + innerW},${padT + innerH} L${padL},${padT + innerH} Z`;

  return (
    <div style={{ position: "relative" }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", width: "100%", height }}>
        {ticks.map((t, i) => {
          const y = padT + innerH - (t / niceMax) * innerH;
          return (
            <g key={i}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="var(--rule)" strokeWidth="1"/>
              <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize="10" fontFamily="var(--f-mono)" fill="var(--ink-soft)">{t}</text>
            </g>
          );
        })}
        {/* Ceiling marker */}
        <line x1={padL} x2={width - padR}
              y1={padT + innerH - (ceiling / niceMax) * innerH}
              y2={padT + innerH - (ceiling / niceMax) * innerH}
              stroke="var(--danger)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6"/>
        <text x={width - padR - 4} y={padT + innerH - (ceiling / niceMax) * innerH - 4}
              textAnchor="end" fontSize="10" fontFamily="var(--f-mono)" fill="var(--danger)">
          plan ceiling · {ceiling}
        </text>

        <path d={area} fill="var(--accent-soft)" opacity="0.55"/>
        <path d={path} fill="none" stroke="var(--accent-ink)" strokeWidth="1.5" strokeLinejoin="round"/>

        {/* Hover surface */}
        {data.map((d, i) => {
          const x = padL + i * step - step / 2;
          return (
            <rect key={i} x={x} y={padT} width={step} height={innerH} fill="transparent"
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}/>
          );
        })}
        {hover !== null && (
          <g>
            <line x1={points[hover][0]} x2={points[hover][0]} y1={padT} y2={padT + innerH}
                  stroke="var(--ink-strong)" strokeWidth="1" opacity="0.25"/>
            <circle cx={points[hover][0]} cy={points[hover][1]} r="3.5" fill="var(--accent-ink)"/>
          </g>
        )}

        {data.map((d, i) => {
          if (i !== 0 && i !== data.length - 1 && i !== Math.floor(data.length / 2)) return null;
          return (
            <text key={i} x={padL + i * step} y={height - 10} textAnchor="middle" fontSize="10" fontFamily="var(--f-mono)" fill="var(--ink-soft)">{fmtMonthDay(d.date)}</text>
          );
        })}
      </svg>
      {hover !== null && (() => {
        const d = data[hover];
        const xPct = (padL + hover * step) / width * 100;
        const placeRight = xPct < 50;
        return (
          <div style={{
            position: "absolute",
            left: `${xPct}%`,
            top: 12,
            transform: placeRight ? "translateX(12px)" : "translateX(calc(-100% - 12px))",
            background: "var(--bg-paper)",
            border: "1px solid var(--rule-strong)",
            borderRadius: "var(--radius-md)",
            boxShadow: "0 6px 24px rgba(26,24,21,0.08)",
            padding: "10px 12px",
            minWidth: 200, fontSize: 12, pointerEvents: "none", zIndex: 5,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontFamily: "var(--f-mono)", color: "var(--ink-strong)" }}>{fmtFullDate(d.date)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--ink-muted)", fontFamily: "var(--f-mono)", fontSize: 11 }}>peak symbols</span>
              <span style={{ fontFamily: "var(--f-mono)", color: "var(--ink-strong)", fontSize: 11 }}>{d.peak} / {ceiling}</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Real data fetching
// ─────────────────────────────────────────────────────────────────────────────

function useUsageData(username) {
  const [audit, setAudit] = useUsageState(null);
  const [stats, setStats] = useUsageState(null);
  const [error, setError] = useUsageState(null);
  const [loading, setLoading] = useUsageState(false);

  const fetchData = useUsageCb(async () => {
    if (!username) return;
    setLoading(true);
    setError(null);
    try {
      const [auditRes, statsRes] = await Promise.all([
        fetch(`/api/usage/audit?username=${encodeURIComponent(username)}&limit=1000`).then(r => r.json()),
        fetch(`/api/usage/stats?username=${encodeURIComponent(username)}`).then(r => r.json()),
      ]);
      if (auditRes.error) { setError(auditRes.error); setLoading(false); return; }
      setAudit(auditRes);
      setStats(statsRes);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [username]);

  useUsageEffect(() => { fetchData(); const id = setInterval(fetchData, 60000); return () => clearInterval(id); }, [fetchData]);

  return { audit, stats, error, loading, refresh: fetchData };
}

function aggregateAuditData(auditEvents) {
  if (!auditEvents || auditEvents.length === 0) {
    return { dailyRequests: [], dailyCache: [], dailyWs: [], recentEvents: [] };
  }

  const now = new Date();
  const days30ago = new Date(now);
  days30ago.setDate(days30ago.getDate() - 30);

  // Build day buckets
  const dayMap = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = fmtFullDate(d);
    dayMap[key] = { date: d, stocks: 0, options: 0, news: 0, admin: 0, total: 0, hits: 0, misses: 0, wsPeak: 0 };
  }

  for (const ev of auditEvents) {
    const ts = ev.timestamp ? new Date(ev.timestamp * 1000) : null;
    if (!ts || ts < days30ago) continue;
    const key = fmtFullDate(ts);
    const bucket = dayMap[key];
    if (!bucket) continue;

    if (ev.event === "http_request") {
      bucket.total++;
      const ep = ev.endpoint || "";
      if (ep.includes("/stock/") || ep.includes("/history/bars")) bucket.stocks++;
      else if (ep.includes("/options/")) bucket.options++;
      else if (ep.includes("/news")) bucket.news++;
      else if (ep.includes("/admin/")) bucket.admin++;
      else bucket.stocks++; // default to stocks

      // Cache status from extra fields (if present)
      if (ev.cache === "HIT") bucket.hits++;
      else bucket.misses++;
    } else if (ev.event === "ws_request" && ev.ws_event === "subscribe") {
      const syms = ev.symbols ? (Array.isArray(ev.symbols) ? ev.symbols.length : 1) : 1;
      bucket.wsPeak = Math.max(bucket.wsPeak, syms);
    }
  }

  const ordered = Object.values(dayMap).sort((a, b) => a.date - b.date);
  return {
    dailyRequests: ordered.map(d => ({ date: d.date, stocks: d.stocks, options: d.options, news: d.news, admin: d.admin, total: d.total })),
    dailyCache: ordered.map(d => ({ date: d.date, hits: d.hits, misses: d.misses, total: d.hits + d.misses, ratio: d.hits + d.misses > 0 ? d.hits / (d.hits + d.misses) : 0 })),
    dailyWs: ordered.map(d => ({ date: d.date, peak: d.wsPeak })),
    recentEvents: auditEvents.slice(0, 60).map(ev => ({
      ts: ev.timestamp ? new Date(ev.timestamp * 1000) : new Date(),
      event: ev.event,
      endpoint: ev.endpoint || (ev.ws_event ? `ws · ${ev.ws_event}` : "—"),
      status: ev.status || 0,
      family: ev.event === "ws_request" ? "ws" : "http",
      cache: ev.cache || null,
      elapsed_ms: ev.elapsed_ms || 0,
      symbols: ev.symbols ? (Array.isArray(ev.symbols) ? ev.symbols : [ev.symbols]) : ev.symbol ? [ev.symbol] : [],
      ws_event: ev.ws_event || null,
      mode: ev.mode || null,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

function UsageTopbar() {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="dot"></span>
        <span><strong>Public Docs Site</strong></span>
      </div>
      <div className="divider"></div>
      <div className="nav">
        <a>Proxy API</a>
        <a>WS usage</a>
        <a>Status</a>
        <a className="active">Usage</a>
      </div>
      <div className="spacer"></div>
      <div className="meta">
        <span className="pill"><span className="live"></span> ikkipipi · signed in</span>
        <a className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }}>Sign out</a>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, accent, footer }) {
  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="eyebrow" style={{ color: "var(--ink-muted)" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="display-title" style={{ fontSize: 36, lineHeight: 1, color: accent || "var(--ink-strong)" }}>{value}</span>
        {sub && <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-muted)" }}>{sub}</span>}
      </div>
      {footer && <div style={{ marginTop: 6 }}>{footer}</div>}
    </div>
  );
}

function MiniBar({ ratio, color = "var(--accent)" }) {
  return (
    <div style={{ height: 6, background: "var(--bg-sunken)", borderRadius: 999, overflow: "hidden", marginTop: 8 }}>
      <div style={{ width: `${Math.min(100, ratio * 100)}%`, height: "100%", background: color, transition: "width .2s" }}></div>
    </div>
  );
}

function UsagePage() {
  const mockRequests = useUsageMemo(() => makeDailyRequests(), []);
  const mockCache    = useUsageMemo(() => makeDailyCache(), []);
  const mockWs       = useUsageMemo(() => makeDailyWs(), []);
  const mockAudit    = useUsageMemo(() => makeAuditEvents(), []);

  const requests = mockRequests;
  const cache    = mockCache;
  const wsData   = mockWs;
  const audit    = mockAudit;

  const [hoverReq, setHoverReq] = useUsageState(null);
  const [auditFilter, setAuditFilter] = useUsageState("all"); // all | http | ws

  const todayReq = requests[requests.length - 1];
  const monthReqTotal = requests.reduce((s, d) => s + d.total, 0);
  const monthCacheTotal = cache.reduce((s, d) => s + d.total, 0);
  const monthCacheHits  = cache.reduce((s, d) => s + d.hits, 0);
  const hitRate = monthCacheTotal > 0 ? monthCacheHits / monthCacheTotal : 0;
  const wsCurrent = wsData[wsData.length - 1].peak;
  const wsCeiling = 500;
  const restPerMinLimit = 300;
  const restPerMinUsed = 0;

  const filteredAudit = audit.filter(e => {
    if (auditFilter === "all") return true;
    if (auditFilter === "http") return e.event === "http_request";
    if (auditFilter === "ws")   return e.event === "ws_request";
    return true;
  });

  return (
    <div>
      <div role="alert" style={{ margin: "20px 32px 0", padding: "16px 20px", border: "2px solid var(--warn)", borderRadius: "var(--radius-lg)", background: "var(--bg-paper)" }}>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 600, color: "var(--warn)", letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 8 }}>
          Placeholder · 非真实用量
        </div>
        <div style={{ color: "var(--ink-strong)", fontSize: 14, lineHeight: 1.6 }}>
          此页是静态样式预览（摆设）。所有请求数、缓存命中率、WS 订阅、频道、审计事件及时间戳均为固定演示数据，
          不代表任何账户、生产流量或计费。真实的当前连接/请求状态请登录 <a href="/account" style={{ color: "var(--accent-ink)" }}>Account Management</a> 查看。
        </div>
      </div>

      {/* Placeholder header */}
      <div style={{
        padding: "36px 64px 28px",
        borderBottom: "1px solid var(--rule)",
        background: "var(--bg-paper)",
      }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32, flexWrap: "wrap" }}>
          <div style={{ minWidth: 360 }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>Usage · static preview</div>
            <h1 className="display-title" style={{ fontSize: 52, margin: "0 0 6px", lineHeight: 1.02 }}>
              <span style={{ fontStyle: "italic", color: "var(--accent-ink)" }}>Placeholder</span> usage
            </h1>
            <p style={{ color: "var(--ink-muted)", margin: 0, fontSize: 14 }}>
              Fixed seeded sample data · no account lookup · no live refresh
            </p>
          </div>

          <div style={{
            display: "flex", gap: 28, alignItems: "stretch",
            border: "1px solid var(--rule)", borderRadius: "var(--radius-lg)",
            background: "var(--bg-canvas)", padding: "12px 18px",
            fontFamily: "var(--f-mono)", fontSize: 12,
          }}>
            <div>
              <div style={{ color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: ".1em", fontSize: 10, marginBottom: 4 }}>Source</div>
              <span style={{ color: "var(--ink-strong)" }}>fixed seed</span>
            </div>
            <div>
              <div style={{ color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: ".1em", fontSize: 10, marginBottom: 4 }}>Ledger</div>
              <span style={{ color: "var(--ink-strong)" }}>not connected</span>
            </div>
            <div>
              <div style={{ color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: ".1em", fontSize: 10, marginBottom: 4 }}>Status</div>
              <span style={{ color: "var(--warn)" }}>placeholder</span>
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "32px 64px 64px", background: "var(--bg-canvas)", flex: 1 }}>

        {/* KPI strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
          <Kpi
            label="REST requests · sample"
            value={fmtNumber(todayReq.total)}
            sub={`sample / ${fmtNumber(monthReqTotal)} fixed total`}
            footer={
              <>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>
                  <span>not live · {restPerMinUsed}/min</span>
                  <span>illustrative limit · {restPerMinLimit}/min</span>
                </div>
                <MiniBar ratio={restPerMinUsed / restPerMinLimit} />
              </>
            }
          />
          <Kpi
            label="Cache hit rate · sample"
            value={`${(hitRate * 100).toFixed(1)}%`}
            accent="var(--ok)"
            sub={`${fmtNumber(monthCacheHits)} hits`}
            footer={
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>
                {fmtNumber(monthCacheTotal - monthCacheHits)} simulated misses · not a production cache rate
              </div>
            }
          />
          <Kpi
            label="WS subs · sample"
            value={`${wsCurrent}`}
            sub={`/ ${wsCeiling} symbols`}
            footer={
              <>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>
                  <span>illustrative channels</span>
                  <span>{Math.round((wsCurrent / wsCeiling) * 100)}% simulated</span>
                </div>
                <MiniBar ratio={wsCurrent / wsCeiling} color="var(--accent)" />
              </>
            }
          />
          <Kpi
            label="Total events · sample"
            value={fmtNumber(audit.length)}
            sub="simulated audit events"
            footer={
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>
                fixed example only
              </div>
            }
          />
        </div>

        {/* Daily REST requests chart */}
        <div className="card" style={{ padding: 24, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 8 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Daily REST volume · sample</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span className="display-title" style={{ fontSize: 28, lineHeight: 1 }}>{fmtNumber(monthReqTotal)}</span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-muted)" }}>simulated requests · fixed 30-day sample</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              {ENDPOINT_FAMILIES.map(fam => (
                <div key={fam.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, background: fam.color, borderRadius: 2 }}></span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>{fam.label}</span>
                </div>
              ))}
            </div>
          </div>
          <StackedBarChart data={requests} families={ENDPOINT_FAMILIES} hover={hoverReq} setHover={setHoverReq} />
        </div>

        {/* Two-up: cache hit/miss + ws subs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 8 }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 6 }}>Cache · hit vs miss · sample</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span className="display-title" style={{ fontSize: 24, lineHeight: 1, color: "var(--ok)" }}>{(hitRate * 100).toFixed(1)}%</span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>simulated 30d ratio</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, background: "var(--ok)", borderRadius: 2 }}></span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>HIT</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, background: "var(--ink-soft)", borderRadius: 2 }}></span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>MISS</span>
                </div>
              </div>
            </div>
            <CacheBarChart data={cache} />
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 8 }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 6 }}>WS subscriptions · sample peak/day</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span className="display-title" style={{ fontSize: 24, lineHeight: 1 }}>{wsCurrent}</span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>simulated · {wsCeiling} ceiling</span>
                </div>
              </div>
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>
                static example · not a connection inventory
              </div>
            </div>
            <WsLineChart data={wsData} ceiling={wsCeiling} />
          </div>
        </div>

        {/* Active WS channels */}
        <div className="card" style={{ padding: 0, marginBottom: 20, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--rule)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="eyebrow">Illustrative WS channels · sample</div>
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)", marginTop: 4 }}>
                Fixed example rows; no live WebSocket session is read here.
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn ghost" disabled style={{ fontSize: 12, padding: "6px 10px", cursor: "not-allowed" }}>Static preview</button>
            </div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Channel</th>
                <th style={{ width: 90 }}>Symbols</th>
                <th>Subscribed</th>
                <th style={{ width: 110 }}>Connection</th>
                <th style={{ width: 110 }}>Since</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="method ws">stocks</span></td>
                <td style={{ fontFamily: "var(--f-mono)", color: "var(--ink-strong)" }}>184</td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>AAPL, MSFT, NVDA, TSLA, SPY, QQQ, AMD, META, GOOGL, AMZN, <span style={{ color: "var(--ink-soft)" }}>+174 more</span></td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>conn-3a</td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-muted)" }}>09:31:04</td>
              </tr>
              <tr>
                <td><span className="method ws">options</span></td>
                <td style={{ fontFamily: "var(--f-mono)", color: "var(--ink-strong)" }}>142</td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>AAPL250620C00150000, SPY250620P00420000, <span style={{ color: "var(--ink-soft)" }}>+140 more</span></td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>conn-3a</td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-muted)" }}>09:31:48</td>
              </tr>
              <tr>
                <td><span className="method ws">news</span></td>
                <td style={{ fontFamily: "var(--f-mono)", color: "var(--ink-strong)" }}>16</td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>AAPL, TSLA, NVDA, SPY, BTC/USD, ETH/USD, <span style={{ color: "var(--ink-soft)" }}>+10 more</span></td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>conn-5b</td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-muted)" }}>11:02:11</td>
              </tr>
              <tr style={{ opacity: 0.55 }}>
                <td><span className="tier" style={{ textTransform: "uppercase" }}>boats</span></td>
                <td style={{ fontFamily: "var(--f-mono)", color: "var(--ink-soft)" }}>—</td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)" }}>not subscribed</td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-soft)" }}>—</td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-soft)" }}>—</td>
              </tr>
              <tr style={{ opacity: 0.55 }}>
                <td><span className="tier" style={{ textTransform: "uppercase" }}>overnight</span></td>
                <td style={{ fontFamily: "var(--f-mono)", color: "var(--ink-soft)" }}>—</td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)" }}>not subscribed</td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-soft)" }}>—</td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-soft)" }}>—</td>
              </tr>
              <tr style={{ opacity: 0.55 }}>
                <td><span className="tier" style={{ textTransform: "uppercase" }}>crypto</span></td>
                <td style={{ fontFamily: "var(--f-mono)", color: "var(--ink-soft)" }}>—</td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)" }}>not subscribed</td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-soft)" }}>—</td>
                <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-soft)" }}>—</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Audit log table */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--rule)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div className="eyebrow">Illustrative audit events · sample</div>
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)", marginTop: 4 }}>
                Fixed seeded examples · no proxy audit ledger is displayed here
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, background: "var(--bg-sunken)", padding: 3, borderRadius: 6 }}>
              {[
                { id: "all", label: "All" },
                { id: "http", label: "HTTP" },
                { id: "ws", label: "WebSocket" },
              ].map(f => (
                <button key={f.id} onClick={() => setAuditFilter(f.id)} style={{
                  border: "none",
                  background: auditFilter === f.id ? "var(--bg-paper)" : "transparent",
                  color: auditFilter === f.id ? "var(--ink-strong)" : "var(--ink-muted)",
                  padding: "5px 12px",
                  fontFamily: "var(--f-mono)",
                  fontSize: 11,
                  letterSpacing: ".05em",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontWeight: auditFilter === f.id ? 500 : 400,
                  boxShadow: auditFilter === f.id ? "0 1px 1px rgba(0,0,0,0.05)" : "none",
                }}>{f.label}</button>
              ))}
            </div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Time</th>
                <th style={{ width: 92 }}>Event</th>
                <th>Endpoint / action</th>
                <th style={{ width: 88 }}>Status</th>
                <th style={{ width: 86 }}>Cache</th>
                <th style={{ width: 84, textAlign: "right" }}>Elapsed</th>
                <th>Symbols</th>
              </tr>
            </thead>
            <tbody>
              {filteredAudit.slice(0, 24).map((e, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--ink-muted)" }}>
                    {e.ts.toISOString().slice(11, 19)}<br/>
                    <span style={{ color: "var(--ink-soft)" }}>{fmtFullDate(e.ts)}</span>
                  </td>
                  <td>
                    <span style={{
                      fontFamily: "var(--f-mono)",
                      fontSize: 10,
                      letterSpacing: ".04em",
                      textTransform: "uppercase",
                      padding: "2px 6px",
                      borderRadius: 3,
                      background: e.event === "http_request" ? "var(--accent-soft)" : "oklch(0.95 0.05 295)",
                      color: e.event === "http_request" ? "var(--accent-ink)" : "oklch(0.42 0.10 295)",
                    }}>
                      {e.event === "http_request" ? "HTTP" : "WS"}
                    </span>
                  </td>
                  <td style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--ink-strong)" }}>
                    {e.endpoint}
                    {e.ws_event && (
                      <span style={{ marginLeft: 6, color: "var(--ink-muted)", fontSize: 11 }}>· {e.ws_event}{e.mode ? ` · ${e.mode}` : ""}</span>
                    )}
                  </td>
                  <td>
                    <span style={{
                      fontFamily: "var(--f-mono)", fontSize: 11.5,
                      color: e.status === 200 ? "var(--ok)" : e.status === 429 ? "var(--warn)" : "var(--danger)",
                    }}>
                      {e.status}
                    </span>
                  </td>
                  <td style={{ fontFamily: "var(--f-mono)", fontSize: 11.5 }}>
                    {e.cache === null ? <span style={{ color: "var(--ink-soft)" }}>—</span> :
                      <span style={{ color: e.cache === "HIT" ? "var(--ok)" : "var(--ink-muted)" }}>{e.cache}</span>}
                  </td>
                  <td style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--ink-base)", textAlign: "right" }}>
                    {e.elapsed_ms}ms
                  </td>
                  <td style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>
                    {e.symbols.join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--rule)", background: "var(--bg-sunken)" }}>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)" }}>
              Showing 24 of {filteredAudit.length} simulated events · not refreshed from production
            </span>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)" }}>Export unavailable for placeholder data</span>
          </div>
        </div>

        {/* Footer note */}
        <div style={{ marginTop: 28, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)", letterSpacing: ".04em", textAlign: "center" }}>
          placeholder only · fixed seeded sample data · not account usage, telemetry, or billing
        </div>
      </div>
    </div>
  );
}

window.UsagePage = UsagePage;
