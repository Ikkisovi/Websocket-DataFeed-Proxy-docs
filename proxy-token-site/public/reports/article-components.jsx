import React, { useState } from "react";
import study from "./brain-stock-ranking/analysis.json";
export { study };
export { TITLES, useReportLanguage, EditorialHeader, OfficialDisclaimer } from "./report-components.jsx";

export function NavComparisonChart({ t }) {
  const [overlapOnly, setOverlapOnly] = useState(false);
  const comp = study.official_comparison;
  const raw = comp.nav_curve_samples;
  const pts = raw.filter((s, i) => {
    if (overlapOnly && s.date > "2025-04-10") return false;
    return i % 4 === 0 || s.date === "2025-04-04" || (raw[i+1] && raw[i].official_top50 !== null && raw[i+1].official_top50 === null) || i === raw.length - 1;
  });

  const width = 720, height = 340, left = 45, top = 25, bottom = 290, right = 20;
  const maxVal = 12.0;
  const yScale = (val) => bottom - (val / maxVal) * (bottom - top);
  const xScale = (i) => left + (i / (pts.length - 1)) * (width - left - right);

  const makePath = (key) => {
    let d = "";
    let inPath = false;
    pts.forEach((pt, i) => {
      const v = pt[key];
      if (v === null || v === undefined) {
        inPath = false;
        return;
      }
      const x = xScale(i);
      const y = yScale(v);
      if (!inPath) {
        d += `M ${x.toFixed(1)} ${y.toFixed(1)} `;
        inPath = true;
      } else {
        d += `L ${x.toFixed(1)} ${y.toFixed(1)} `;
      }
    });
    return d;
  };

  const pathOfficialTop50 = makePath("official_top50");
  const pathOfficialUniform = makePath("official_uniform");
  const pathGrossTop50 = makePath("gross_top50");
  const pathActualTop50 = makePath("actual_top50");
  const pathSpy = makePath("spy");

  const yTicks = [0, 2, 4, 6, 8, 10, 12];
  const yearTicks = [2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024, 2026];

  return (
    <figure className="report-chart nav-comparison-chart">
      <div className="chart-heading">
        <strong>{t("官方宣传曲线 vs 实际回测 vs 基准 (2010–2026)", "Official Claims vs Actual Execution vs SPY (2010–2026)")}</strong>
        <div className="report-switch" aria-label={t("图表区间", "Chart period")}>
          <button type="button" aria-pressed={!overlapOnly} onClick={() => setOverlapOnly(false)}>{t("全周期 (至 2026.09)", "Full period (to 2026.09)")}</button>
          <button type="button" aria-pressed={overlapOnly} onClick={() => setOverlapOnly(true)}>{t("官方对照期 (至 2025.04)", "Overlap period (to 2025.04)")}</button>
        </div>
      </div>
      <div className="chart-legend-row">
        <span className="legend-item"><span className="legend-line official-top" />{t("官方宣称 Top 50 (终值 10.75)", "Brain Official Top 50 (10.75)")}</span>
        <span className="legend-item"><span className="legend-line gross-top" />{t("零费率复现 Gross (8.02 / 11.18)", "Gross 0-Fee Replication (8.02 / 11.18)")}</span>
        <span className="legend-item"><span className="legend-line actual-top" />{t("扣费实测 Net 2bps (6.92 / 9.52)", "Net 2bps Execution (6.92 / 9.52)")}</span>
        <span className="legend-item"><span className="legend-line official-uni" />{t("官方等权基准 (终值 5.76)", "Official Uniform EW (5.76)")}</span>
        <span className="legend-item"><span className="legend-line spy-bench" />{t("SPY 市场基准 (5.25 / 7.46)", "SPY Benchmark (5.25 / 7.46)")}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("Brain 官方净值 vs 实际回测 vs SPY 对比", "Brain Official NAV vs Actual Execution vs SPY")}>
        <title>{t("累计净值走势对比 (起点 = 1.0)", "Cumulative NAV Comparison (Start = 1.0)")}</title>
        {yTicks.map(v => (
          <g key={v}>
            <line x1={left} x2={width - right} y1={yScale(v)} y2={yScale(v)} stroke={v === 0 ? "#b5bdb5" : "#e8ece7"} />
            <text x={left - 8} y={yScale(v) + 4} textAnchor="end" fontSize="11" fill="#69756d">{v}</text>
          </g>
        ))}
        {yearTicks.map(year => {
          const idx = pts.findIndex(p => p.date.startsWith(String(year)));
          if (idx < 0) return null;
          const x = xScale(idx);
          return (
            <g key={year}>
              <line x1={x} x2={x} y1={top} y2={bottom} stroke="#f0f3ee" strokeDasharray="2 3" />
              <text x={x} y={bottom + 20} textAnchor="middle" fontSize="11" fill="#69756d">{String(year).slice(2)}</text>
            </g>
          );
        })}
        <path d={pathSpy} fill="none" stroke="#8c7754" strokeWidth="1.6" strokeDasharray="2 3" />
        <path d={pathOfficialUniform} fill="none" stroke="#d65360" strokeWidth="1.6" strokeDasharray="5 4" />
        <path d={pathActualTop50} fill="none" stroke="#285535" strokeWidth="1.8" strokeDasharray="6 3" />
        <path d={pathGrossTop50} fill="none" stroke="#1b7a43" strokeWidth="2.0" />
        <path d={pathOfficialTop50} fill="none" stroke="#3b66cf" strokeWidth="2.4" />
      </svg>
      <div className="nav-quad-metrics">
        <div className="metric-box off-box">
          <span className="m-label">{t("官方宣传 Top 50 (至 2025.04)", "Official Top 50 (to 2025.04)")}</span>
          <strong className="m-val">10.75x</strong>
          <span className="m-sub">CAGR: 16.87% · Sharpe: 2.66</span>
        </div>
        <div className="metric-box gross-box">
          <span className="m-label">{t("零费率复现 Gross (至 2025.04 / 2026.09)", "Gross 0-Fee (2025.04 / 2026.09)")}</span>
          <strong className="m-val">8.02x <span className="m-val-tail">→ 11.18x</span></strong>
          <span className="m-sub">CAGR: 15.56% · Sharpe: 0.81</span>
        </div>
        <div className="metric-box act-box">
          <span className="m-label">{t("实操扣费 Net 2bps (2025.04 / 2026.09)", "Net 2bps (2025.04 / 2026.09)")}</span>
          <strong className="m-val">6.92x <span className="m-val-tail">→ 9.52x</span></strong>
          <span className="m-sub">{t("摩擦年损 1.11 pp · 夏普 0.75", "Fee drag 1.11 pp/yr · Sharpe 0.75")}</span>
        </div>
        <div className="metric-box uni-box">
          <span className="m-label">{t("官方等权基准 Uniform (至 2025.04)", "Official Uniform EW (to 2025.04)")}</span>
          <strong className="m-val">5.76x</strong>
          <span className="m-sub">CAGR: 12.12% · Sharpe: 1.93</span>
        </div>
      </div>
      <figcaption>{t(
        "数据来源：官方 Factsheet (BSR_summary.pdf 截至 2025-04-10) 曲线数字化提取 vs 本地 QuantConnect 归档全周期每日回测 (series.csv) vs SPY。实测包含单边 2 bps 换手摩擦，官方宣传为 0 摩擦假设。",
        "Sources: Brain Official Factsheet (digitized from BSR_summary.pdf, through 2025-04-10) vs local QuantConnect archived daily backtest (series.csv, through 2026-09-29) vs SPY. Actual execution includes 2 bps turnover friction; official marketing claims assume zero friction."
      )}</figcaption>
    </figure>
  );
}

