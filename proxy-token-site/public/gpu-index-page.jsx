import React from "react";

const RENTAL_LABELS = {
  "on-demand": "On-demand",
  bid: "Bid market",
  reserved: "Reserved",
};

// Feed is stale when the latest slot is older than one 6h cadence + 30m grace.
const STALE_MS = 6 * 3600 * 1000 + 30 * 60 * 1000;
const GAP_MS = STALE_MS;
const REFRESH_MS = 60 * 1000;
const MAX_X_LABELS = 6;

function getFeedUrl() {
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="gpu-index-feed"]');
    const content = meta?.getAttribute("content");
    if (content) return content;
  }
  return "/api/internal/vastai-gpu-index";
}

function money(value) {
  return Number.isFinite(value) ? `$${value.toFixed(value < 1 ? 3 : 2)}` : "—";
}

function count(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function decimal(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function timeLabel(value, withDate = false) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-CA", {
    month: withDate ? "short" : undefined,
    day: withDate ? "2-digit" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date) + "Z";
}

function ageText(value) {
  if (!value) return "unknown";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
}

function slotGapMs(older, newer) {
  return new Date(newer).getTime() - new Date(older).getTime();
}

// 6h change is only meaningful between consecutive slots; otherwise report null
// so the card renders "—" instead of a misleading jump across a gap.
function relativeChange(points) {
  if (points.length < 2) return null;
  const previous = points[points.length - 2];
  const current = points[points.length - 1];
  if (!previous.mean) return null;
  if (slotGapMs(previous.slot, current.slot) > GAP_MS) return null;
  return ((current.mean - previous.mean) / previous.mean) * 100;
}

function statisticalPoint(point) {
  return {
    ...point,
    low: point.raw_low ?? point.low,
    high: point.raw_high ?? point.high,
    mean: point.raw_mean ?? point.mean,
  };
}

function visualPoint(point, cleanChart) {
  if (!cleanChart) return statisticalPoint(point);
  return {
    ...point,
    // Clean only the plotted range. Mean and supply still include every offer.
    mean: point.raw_mean ?? point.mean,
  };
}

function PriceCard({ item, selected, onSelect, sortBy, feedLatest }) {
  const statisticalPoints = item.points.map(statisticalPoint);
  const latest = statisticalPoints[statisticalPoints.length - 1];
  const latestVisualBand = item.points[item.points.length - 1];
  const change = relativeChange(statisticalPoints);
  const isNew = statisticalPoints.length < 2;
  const changeClass = change == null ? "" : change > 0.01 ? "up" : change < -0.01 ? "down" : "";
  const changeLabel = isNew ? "new" : change == null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
  const isOlder = Boolean(feedLatest) && latest.slot < feedLatest;
  return (
    <button className={`gpu-index-card ${selected ? "active" : ""}`} onClick={onSelect} aria-pressed={selected}>
      <div className="gpu-index-card-head">
        <span className="gpu-index-card-name">{item.gpu_name}</span>
        <span className={`gpu-index-card-change ${changeClass}`} title={isNew ? undefined : change == null ? "6h change needs consecutive slots" : undefined}>
          {changeLabel}
        </span>
      </div>
      <div className="gpu-index-card-price">{money(latest.mean)}<small>/ GPU·h</small></div>
      <div className="gpu-index-card-foot">
        <span>p10–p90 {money(latestVisualBand.low)}—{money(latestVisualBand.high)}</span>
        <span>{count(latest.number)} GPU · incl.</span>
      </div>
      {isOlder && <div className="gpu-index-card-older">older observation · 非最新</div>}
      <div className="gpu-index-card-metrics">
        <span>{decimal(latest.vram_gb)} GB</span>
        <span className={sortBy === "dlperf" ? "ranked" : ""}>DLP/$ {decimal(latest.dlperf_per_dollar)}</span>
        <span className={sortBy === "vram_cost" ? "ranked" : ""}>$/GB·h {decimal(latest.vram_cost_per_hour, 4)}</span>
      </div>
    </button>
  );
}

function niceStep(range) {
  if (!range) return 1;
  const rough = range / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / power;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
}

function pickLabelIndices(total, max = MAX_X_LABELS) {
  if (total <= max) return new Set(Array.from({ length: total }, (_, index) => index));
  const picked = new Set();
  for (let rank = 0; rank < max; rank += 1) {
    picked.add(Math.round((rank * (total - 1)) / (max - 1)));
  }
  return picked;
}

function PriceChart({ points, cleanChart }) {
  const [hovered, setHovered] = React.useState(null);
  const chartPoints = points.map(point => visualPoint(point, cleanChart));
  const times = chartPoints.map(point => new Date(point.slot).getTime());
  const W = 1000, H = 390;
  const left = 67, right = 24, top = 25, priceBottom = 270, volumeTop = 307, volumeBottom = 355;
  const plotWidth = W - left - right;
  const priceHeight = priceBottom - top;
  const allLows = chartPoints.map(point => Math.min(point.low, point.close, point.mean));
  const allHighs = chartPoints.map(point => Math.max(point.high, point.close, point.mean));
  const rawMin = Math.min(...allLows);
  const rawMax = Math.max(...allHighs);
  const rawRange = Math.max(rawMax - rawMin, rawMax * .08, .01);
  const yMin = Math.max(0, rawMin - rawRange * .08);
  const yMax = rawMax + rawRange * .08;
  const maxNumber = Math.max(...chartPoints.map(point => point.number), 1);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const tSpan = (tMax - tMin) || 1;
  // X uses actual time distances so irregular cadence is honestly spaced.
  const xAt = index => chartPoints.length > 1 ? left + ((times[index] - tMin) / tSpan) * plotWidth : left + plotWidth / 2;
  const yAt = value => priceBottom - ((value - yMin) / (yMax - yMin || 1)) * priceHeight;
  const numberY = value => volumeBottom - (value / maxNumber) * (volumeBottom - volumeTop);
  // Break the mean line across gaps wider than one cadence + grace.
  let meanPath = "";
  chartPoints.forEach((point, index) => {
    const gap = index > 0 ? times[index] - times[index - 1] : 0;
    const move = index === 0 || gap > GAP_MS;
    meanPath += `${move ? "M" : "L"}${xAt(index)},${yAt(point.mean)} `;
  });
  const gridStep = niceStep(yMax - yMin);
  const gridStart = Math.ceil(yMin / gridStep) * gridStep;
  const grids = [];
  for (let value = gridStart; value <= yMax + gridStep / 10; value += gridStep) grids.push(value);
  const barWidth = Math.min(32, Math.max(8, plotWidth / Math.max(chartPoints.length, 8) * .45));
  const labelIndices = pickLabelIndices(chartPoints.length);
  const active = hovered == null ? null : chartPoints[hovered];

  const handleMove = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < chartPoints.length; index += 1) {
      const distance = Math.abs(xAt(index) - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    setHovered(best);
  };

  return (
    <div className="gpu-index-chart-wrap">
      {active && (
        <div className="gpu-index-tooltip" style={{ left: `${(xAt(hovered) / W) * 100}%`, top: `${(yAt(active.mean) / H) * 100}%` }}>
          <div className="gpu-index-tooltip-time">{timeLabel(active.slot, true)} {active.formal ? "· formal" : "· provisional"}</div>
          <div className="gpu-index-tooltip-row"><span>{cleanChart ? "Band high" : "Observed high"}</span><span>{money(active.high)}</span></div>
          <div className="gpu-index-tooltip-row"><span>Mean · all offers</span><span>{money(active.mean)}</span></div>
          <div className="gpu-index-tooltip-row"><span>Close</span><span>{money(active.close)}</span></div>
          <div className="gpu-index-tooltip-row"><span>{cleanChart ? "Band low" : "Observed low"}</span><span>{money(active.low)}</span></div>
          <div className="gpu-index-tooltip-row"><span>Supply · incl. capacity</span><span>{count(active.number)} GPU</span></div>
          <div className="gpu-index-tooltip-row"><span>VRAM</span><span>{decimal(active.vram_gb)} GB / GPU</span></div>
          <div className="gpu-index-tooltip-row"><span>DLPerf/$</span><span>{decimal(active.dlperf_per_dollar)}</span></div>
          <div className="gpu-index-tooltip-row"><span>VRAM/$h</span><span>{decimal(active.vram_per_dollar_hour)} GB</span></div>
          <div className="gpu-index-tooltip-row"><span>$/GB·h</span><span>{decimal(active.vram_cost_per_hour, 4)}</span></div>
          {cleanChart && <div className="gpu-index-tooltip-row"><span>Observed high</span><span>{money(active.raw_high)}</span></div>}
          {cleanChart && <div className="gpu-index-tooltip-row"><span>Outside visual band</span><span>{count(active.tail_gpu_count)} GPU</span></div>}
        </div>
      )}
      <svg className="gpu-index-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="GPU rental price high-low range, median close, weighted mean, and included rentable GPU count over time" onMouseMove={handleMove} onMouseLeave={() => setHovered(null)}>
        {grids.map(value => (
          <g key={value}>
            <line x1={left} x2={W - right} y1={yAt(value)} y2={yAt(value)} stroke="var(--rule)" strokeDasharray="2 4" />
            <text x={left - 10} y={yAt(value) + 4} textAnchor="end" fontSize="10" fontFamily="var(--f-mono)" fill="var(--ink-soft)">{money(value)}</text>
          </g>
        ))}
        <line x1={left} x2={W - right} y1={priceBottom} y2={priceBottom} stroke="var(--rule-strong)" />
        <line x1={left} x2={W - right} y1={volumeBottom} y2={volumeBottom} stroke="var(--rule-strong)" />
        <text x={left - 10} y={volumeTop + 3} textAnchor="end" fontSize="9" fontFamily="var(--f-mono)" fill="var(--ink-soft)">GPU</text>
        <text x={left - 10} y={volumeBottom} textAnchor="end" fontSize="9" fontFamily="var(--f-mono)" fill="var(--ink-soft)">0</text>

        {chartPoints.map((point, index) => {
          const x = xAt(index);
          const provisional = !point.formal;
          return (
            <g key={point.capture_id} opacity={provisional ? .52 : 1}>
              <rect x={x - barWidth / 2} y={numberY(point.number)} width={barWidth} height={volumeBottom - numberY(point.number)} rx="2" fill="var(--accent-soft)" stroke="var(--accent-rule)" />
              <line x1={x} x2={x} y1={yAt(point.high)} y2={yAt(point.low)} stroke="var(--ink-strong)" strokeWidth="1.5" strokeDasharray={provisional ? "3 2" : undefined} />
              <line x1={x - 7} x2={x + 7} y1={yAt(point.close)} y2={yAt(point.close)} stroke="var(--ink-strong)" strokeWidth="2.5" />
              <circle cx={x} cy={yAt(point.mean)} r="4" fill="var(--bg-paper)" stroke="var(--accent)" strokeWidth="2.5" />
              {labelIndices.has(index) && <text x={x} y={H - 10} textAnchor="middle" fontSize="9.5" fontFamily="var(--f-mono)" fill="var(--ink-soft)">{timeLabel(point.slot, true)}</text>}
            </g>
          );
        })}
        {chartPoints.length > 1 && <path d={meanPath} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {hovered != null && <line x1={xAt(hovered)} x2={xAt(hovered)} y1={top} y2={volumeBottom} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 4" opacity=".6" />}
      </svg>
    </div>
  );
}

function HistoryTable({ points }) {
  const rows = React.useMemo(() => [...points].reverse(), [points]);
  return (
    <div className="gpu-index-history">
      <div className="gpu-index-history-head">
        <span>历史观测 · 每个时间点</span>
        <span className="gpu-index-history-note">UTC · 最新在前</span>
      </div>
      <div className="gpu-index-history-scroll">
        <table>
          <thead>
            <tr>
              <th>UTC 时间</th>
              <th>全样本均价</th>
              <th>加权中位价</th>
              <th>p10</th>
              <th>p90</th>
              <th>纳入统计 GPU</th>
              <th>机器数</th>
              <th>记录状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(point => (
              <tr key={point.capture_id} className={point.formal ? "" : "provisional"}>
                <td className="mono">{point.slot}</td>
                <td>{money(point.raw_mean ?? point.mean)}</td>
                <td>{money(point.close)}</td>
                <td>{money(point.low)}</td>
                <td>{money(point.high)}</td>
                <td>{count(point.number)}</td>
                <td>{count(point.machine_count)}</td>
                <td>{point.formal ? "正式" : "试运行"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function slotCount(value) {
  if (value == null) return "—";
  if (Array.isArray(value)) return count(value.length);
  return count(value);
}

function Dashboard({ data, refreshError }) {
  const [rentalType, setRentalType] = React.useState(data.rental_types.includes("on-demand") ? "on-demand" : data.rental_types[0]);
  const [sortBy, setSortBy] = React.useState("price");
  const [cleanChart, setCleanChart] = React.useState(true);
  const available = React.useMemo(() => data.series
    .filter(item => item.rental_type === rentalType)
    .sort((left, right) => {
      const leftPoint = statisticalPoint(left.points[left.points.length - 1]);
      const rightPoint = statisticalPoint(right.points[right.points.length - 1]);
      if (sortBy === "price") return leftPoint.mean - rightPoint.mean;
      if (sortBy === "supply") return rightPoint.number - leftPoint.number;
      if (sortBy === "dlperf") return (rightPoint.dlperf_per_dollar ?? -Infinity) - (leftPoint.dlperf_per_dollar ?? -Infinity);
      if (sortBy === "vram_cost") return (leftPoint.vram_cost_per_hour ?? Infinity) - (rightPoint.vram_cost_per_hour ?? Infinity);
      return left.gpu_name.localeCompare(right.gpu_name);
    }), [data, rentalType, sortBy]);
  const [selectedKey, setSelectedKey] = React.useState(() => {
    const preferred = data.series.find(item => item.rental_type === "on-demand" && item.gpu_name === "RTX 4090");
    return preferred?.key || data.series[0]?.key;
  });
  React.useEffect(() => {
    if (!available.some(item => item.key === selectedKey)) {
      setSelectedKey(available.find(item => item.gpu_name === "RTX 4090")?.key || available[0]?.key);
    }
  }, [available, selectedKey]);
  const selected = available.find(item => item.key === selectedKey) || available[0];
  const latest = selected ? statisticalPoint(selected.points[selected.points.length - 1]) : null;
  const formalPoints = selected?.points.filter(point => point.formal).length || 0;
  const feedLatest = data.latest_slot || null;
  const stale = feedLatest ? Date.now() - new Date(feedLatest).getTime() >= STALE_MS : false;
  const selectedIsOlder = Boolean(selected && feedLatest) && selected.points[selected.points.length - 1].slot < feedLatest;
  const coverage = data.coverage || null;
  const latestCapture = data.captures?.[data.captures.length - 1];
  const excludedGroups = latestCapture?.excluded_machine_groups;

  return (
    <div className="gpu-index-app">
      <header className="gpu-index-topbar">
        <span className="gpu-index-mark" />
        <span className="gpu-index-brand"><strong>Leandata</strong> research</span>
        <span className="gpu-index-divider" />
        <span className="gpu-index-top-title">另类数据 / Alternative data</span>
        <span className="gpu-index-spacer" />
        <span className="gpu-index-health" title={feedLatest ? `Latest slot ${feedLatest}; stale when older than 6h 30m` : "Latest slot unknown"}>
          <span className={`gpu-index-health-dot ${stale || !feedLatest ? "warn" : ""}`} />
          {feedLatest ? (stale ? `feed stale · ${ageText(feedLatest)}` : `feed fresh · ${ageText(feedLatest)}`) : "freshness unknown"}
        </span>
      </header>

      <main className="gpu-index-shell">
        {refreshError && <p role="status">更新暂时失败，当前显示上次成功读取的数据。</p>}
        <nav className="gpu-index-crumbs" aria-label="Breadcrumb">
          <a href="/">首页 Home</a>
          <span aria-hidden="true">/</span>
          <a href="/docs/">文档 Docs</a>
          <span aria-hidden="true">/</span>
          <span className="here">另类数据 / Alternative data · GPU index</span>
        </nav>
        <section className="gpu-index-hero">
          <div>
            <div className="gpu-index-eyebrow">另类数据 / Alternative data · GPU rental market · 6-hour tape</div>
            <h1 className="gpu-index-title">GPU Rental <em>Index</em></h1>
            <p className="gpu-index-subtitle">按物理机器去重，以纳入样本的可租 GPU 容量（included eligible capacity）加权，而非全市场。图表用 p10–p90 清理极值尺度；均价、供给和原始报价统计仍纳入全部报价（all offers），尾部报价保留用于审计。</p>
          </div>
          <div className="gpu-index-meta">
            <div className="gpu-index-meta-row"><span>Last slot</span><span>{data.latest_slot ? timeLabel(data.latest_slot, true) : "—"}</span></div>
            <div className="gpu-index-meta-row"><span>Freshness</span><span>{feedLatest ? ageText(feedLatest) : "unknown"}</span></div>
            <div className="gpu-index-meta-row"><span>Captures</span><span>{data.capture_count} total · {data.formal_capture_count} formal</span></div>
            {coverage && (
              <div className="gpu-index-meta-row"><span>Coverage</span><span>expected {slotCount(coverage.expected_slots)} · missing {slotCount(coverage.missing_slots)} · invalid {slotCount(coverage.invalid_slots)}</span></div>
            )}
            {latestCapture?.index_rows != null && (
              <div className="gpu-index-meta-row"><span>Index rows</span><span>{count(latestCapture?.index_rows)}</span></div>
            )}
            {excludedGroups != null && (
              <div className="gpu-index-meta-row"><span>Excluded groups</span><span>{Array.isArray(excludedGroups) ? count(excludedGroups.length) : count(excludedGroups)}</span></div>
            )}
            <div className="gpu-index-meta-row"><span>Capture state</span><span>{data.status.state}</span></div>
            <div className="gpu-index-meta-row"><span>Next capture</span><span>{data.status.next_capture_at ? timeLabel(data.status.next_capture_at, true) : "—"}</span></div>
            <div className="gpu-index-meta-row"><span>Refresh</span><span>60s · no-store</span></div>
          </div>
        </section>

        <div className="gpu-index-toolbar">
          <div className="gpu-index-segments" aria-label="Rental market">
            {data.rental_types.map(type => <button key={type} className={`gpu-index-segment ${type === rentalType ? "active" : ""}`} onClick={() => setRentalType(type)}>{RENTAL_LABELS[type] || type}</button>)}
          </div>
          <div className="gpu-index-toolbar-right">
            <div className="gpu-index-range-toggle" aria-label="Price range treatment">
              <button className={cleanChart ? "active" : ""} onClick={() => setCleanChart(true)}>Clean chart</button>
              <button className={!cleanChart ? "active" : ""} onClick={() => setCleanChart(false)}>Raw audit</button>
            </div>
            <label className="gpu-index-sort-label" htmlFor="gpu-index-sort">Rank by</label>
            <select id="gpu-index-sort" className="gpu-index-sort" value={sortBy} onChange={event => setSortBy(event.target.value)}>
              <option value="price">Mean price · low first</option>
              <option value="dlperf">DLPerf / $·h · high first</option>
              <option value="vram_cost">VRAM cost $ / GB·h · low first</option>
              <option value="supply">Available GPUs · high first</option>
              <option value="name">GPU model</option>
            </select>
            <div className="gpu-index-method">included-capacity view · {available.length} models</div>
          </div>
        </div>

        <div className="gpu-index-workspace">
          <div className="gpu-index-cards">
            {available.map(item => <PriceCard key={item.key} item={item} selected={item.key === selected?.key} onSelect={() => setSelectedKey(item.key)} sortBy={sortBy} feedLatest={feedLatest} />)}
          </div>

          {selected && latest && <section className="gpu-index-panel">
            <div className="gpu-index-panel-head">
              <div>
                <h2 className="gpu-index-panel-title">{selected.gpu_name}</h2>
                <div className="gpu-index-panel-caption">{RENTAL_LABELS[selected.rental_type] || selected.rental_type} · {selected.points.length} observations · UTC{selectedIsOlder && <span className="gpu-index-older">older observation · 非最新</span>}</div>
              </div>
              <div className="gpu-index-kpis">
                <div className="gpu-index-kpi"><div className="gpu-index-kpi-label">Mean · all</div><div className="gpu-index-kpi-value">{money(latest.mean)}</div></div>
                <div className="gpu-index-kpi"><div className="gpu-index-kpi-label">Close</div><div className="gpu-index-kpi-value">{money(latest.close)}</div></div>
                <div className="gpu-index-kpi"><div className="gpu-index-kpi-label">Supply · incl.</div><div className="gpu-index-kpi-value">{count(latest.number)}</div></div>
                <div className="gpu-index-kpi"><div className="gpu-index-kpi-label">VRAM</div><div className="gpu-index-kpi-value">{decimal(latest.vram_gb)} GB</div></div>
                <div className="gpu-index-kpi"><div className="gpu-index-kpi-label">DLP/$</div><div className="gpu-index-kpi-value">{decimal(latest.dlperf_per_dollar)}</div></div>
              </div>
            </div>
            <PriceChart points={selected.points} cleanChart={cleanChart} />
            <div className="gpu-index-legend">
              <span className="gpu-index-legend-item"><span className="gpu-index-legend-swatch" />{cleanChart ? "p10–p90 visual band" : "Raw min–max audit range"}</span>
              <span className="gpu-index-legend-item"><span className="gpu-index-legend-swatch" />Close = weighted median</span>
              <span className="gpu-index-legend-item"><span className="gpu-index-legend-swatch mean" />Mean includes all offers</span>
              <span className="gpu-index-legend-item"><span className="gpu-index-legend-swatch number" />Supply = included eligible capacity</span>
              {formalPoints < selected.points.length && <span className="gpu-index-provisional">dashed = bootstrap / provisional</span>}
            </div>
            <HistoryTable points={selected.points} />
          </section>}
        </div>
      </main>
    </div>
  );
}

export function GpuIndexPage() {
  const [state, setState] = React.useState({ loading: true, data: null, error: null });
  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(getFeedUrl(), { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "GPU index unavailable");
        if (!cancelled) setState({ loading: false, data: body, error: null });
      } catch (error) {
        // Keep the last good snapshot on refresh failures; the stale badge
        // recomputes from the latest slot on every render.
        if (!cancelled) setState(previous => ({ loading: false, data: previous.data, error: error.message }));
      }
    }
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  if (state.loading && !state.data) return <div className="gpu-index-state"><div className="gpu-index-state-card"><h1>Reading the tape…</h1><p>正在读取 GPU 价格历史。</p></div></div>;
  if (state.error && !state.data) return <div className="gpu-index-state"><div className="gpu-index-state-card"><h1>Index unavailable</h1><p>{state.error}</p></div></div>;
  return <Dashboard data={state.data} refreshError={state.error} />;
}
