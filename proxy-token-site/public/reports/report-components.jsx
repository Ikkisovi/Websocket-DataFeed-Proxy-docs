import React, { useEffect, useState } from "react";
import study from "./brain-stock-ranking/analysis.json";
export { study };
export const ARTICLE = "/reports/brain-stock-ranking/";
export const TITLES = {
  zh: "Brain 的排名，究竟增加了什么？",
  en: "What does Brain’s ranking actually add?",
};
export function useReportLanguage() {
  const [language, setLanguage] = useState(() => window.LeandataI18n?.getLanguage() || "zh");
  useEffect(() => {
    const update = () => setLanguage(window.LeandataI18n?.getLanguage() || "zh");
    window.addEventListener("leandata:languagechange", update);
    return () => window.removeEventListener("leandata:languagechange", update);
  }, []);
  return [language, (zh, en) => language === "en" ? en : zh];
}
export function EditorialHeader({ language, t, active = "reports" }) {
  return <header className="topbar editorial-topbar">
    <a className="brand" href="/"><span className="dot" aria-hidden="true" /><strong>LeanData</strong></a>
    <nav className="nav" aria-label={t("主导航", "Main navigation")}>
      <a href="/research-data" aria-current={active === "data" ? "page" : undefined}>{t("研究数据", "Research Data")}</a>
      <a href="/reports/" aria-current={active === "reports" ? "page" : undefined}>{t("研究报告", "Reports")}</a>
      <a href="/docs/">{t("接口文档", "API docs")}</a>
    </nav>
    <div className="spacer" />
    <button type="button" className="btn ghost report-language" data-ld-language-toggle="true" onClick={() => window.LeandataI18n?.setLanguage(language === "en" ? "zh" : "en")}>{language === "en" ? "中文" : "English"}</button>
  </header>;
}
export function OfficialDisclaimer({ t }) {
  const [lang, setLang] = useState("bilingual");
  return (
    <aside className="official-disclaimer-card" role="note" aria-label={t("官方与研究免责声明", "Official and research disclaimer")}>
      <div className="disclaimer-header">
        <div className="disclaimer-title-wrap">
          <span className="disclaimer-badge">DISCLAIMER / 免责声明</span>
          <span className="disclaimer-origin">Brain Company Srl · Product Summary</span>
        </div>
        <div className="report-switch" aria-label={t("免责声明语言", "Disclaimer language")}>
          <button type="button" aria-pressed={lang === "bilingual"} onClick={() => setLang("bilingual")}>{t("双语", "Bilingual")}</button>
          <button type="button" aria-pressed={lang === "zh"} onClick={() => setLang("zh")}>中文</button>
          <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
        </div>
      </div>
      {(lang === "bilingual" || lang === "en") && (
        <p className="disclaimer-text en">
          <strong>DISCLAIMER:</strong> The content of this presentation is not to be intended as investment advice. The material is provided for informational purposes only and does not constitute an offer to sell, a solicitation to buy, or a recommendation or endorsement for any security or strategy, nor does it constitute an offer to provide investment advisory or other services by Brain. Brain makes no guarantees regarding the accuracy and completeness of the information expressed in this document.
        </p>
      )}
      {(lang === "bilingual" || lang === "zh") && (
        <p className="disclaimer-text zh">
          <strong>免责声明：</strong>本演示内容不构成投资建议。本资料仅供信息参考之用，不构成 Brain 对任何证券或投资策略的要约出售、购买要约邀请、推荐或背书，亦不构成提供投资咨询或其他服务的要约。Brain 对本文档所表达信息的准确性与完整性不作任何保证。
        </p>
      )}
    </aside>
  );
}

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

export function AnnualChart({ t, compact = false }) {
  const [recent, setRecent] = useState(false);
  const data = study.archived_diagnostic.annual_returns.filter(x => !recent || x.year >= 2021);
  const width = 720, height = compact ? 220 : 320, left = 38, top = 20, bottom = height - 48;
  const bound = .22, zero = (top + bottom) / 2, scale = (bottom - top) / (2 * bound);
  const slot = (width - left - 12) / data.length;
  return <figure className={compact ? "report-chart compact" : "report-chart"}>
    {!compact && <div className="chart-heading"><strong>{t("每年的差距", "The year-by-year difference")}</strong><div className="report-switch" aria-label={t("图表区间", "Chart period")}>
      <button type="button" aria-pressed={!recent} onClick={() => setRecent(false)}>{t("全区间", "All years")}</button>
      <button type="button" aria-pressed={recent} onClick={() => setRecent(true)}>{t("2021 起", "Since 2021")}</button>
    </div></div>}
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("归档诊断：Brain 减 SPY 年度收益差，非认证回测", "Archived diagnostic: annual Brain minus SPY returns, not a validated backtest")}>
      <title>{t("Brain 减 SPY，年度收益百分点差", "Brain minus SPY, annual return difference in percentage points")}</title>
      {[-.2, 0, .2].map(v => <g key={v}><line x1={left} x2={width-12} y1={zero-v*scale} y2={zero-v*scale} stroke={v === 0 ? "#b5bdb5" : "#e8ece7"} /><text x={left-8} y={zero-v*scale+4} textAnchor="end" fontSize="11" fill="#69756d">{v === 0 ? "0" : `${Math.round(v*100)}`}</text></g>)}
      {data.map((v, i) => <g key={v.year}><rect x={left+i*slot+slot*.2} width={slot*.6} y={v.difference >= 0 ? zero-v.difference*scale : zero} height={Math.max(1, Math.abs(v.difference)*scale)} fill={v.difference >= 0 ? "#486455" : "#b78b70"}><title>{`${v.year}: ${(v.difference*100).toFixed(2)} pp`}</title></rect>{(!compact || i%3 === 0) && <text x={left+(i+.5)*slot} y={bottom+22} textAnchor="middle" fontSize="11" fill="#69756d">{String(v.year).slice(2)}</text>}</g>)}
      <text x={width-12} y={height-7} textAnchor="end" fontSize="10" fill="#69756d">{t("年度差值 · 百分点 · 2026 为部分年度", "Annual difference · pp · 2026 is a partial year")}</text>
    </svg>
    {!compact && <figcaption>{t("取自归档分析，截止 2026-09-29。缺失价格和执行时钟尚未完成独立核验，图中数值仅用于复查旧结果。", "Reanalysis of an archived diagnostic through 29 September 2026. Missing prices and execution clocks have not been independently admitted; these values describe the old analysis.")}</figcaption>}
  </figure>;
}
export function ReportFeature({ t, language, compact = false }) {
  return <a href={ARTICLE} className={`report-feature ${compact ? "in-library" : ""}`}>
    <div className="report-feature-copy"><p className="eyebrow">BRAIN STOCK RANKING · {t("研究笔记", "RESEARCH NOTE")}</p>
      <h2>{TITLES[language === "en" ? "en" : "zh"]}</h2>
      <p>{t("从 15 特征基线到 34 组严格 purge 的收益实验：拟合排名、修正标签穿越，再检查跨期 IC 与身份尚未准入的条件净值。", "From a 15-feature baseline to 34 purged return experiments: recover rankings, fix label leakage, then inspect multi-horizon IC and NAV conditional on unresolved identities.")}</p>
      <span className="report-byline">LeanData Research <span>·</span> 2026.10.18 <span>·</span> {t("约 18 分钟", "18 min read")}</span>
      <span className="report-read">{t("阅读全文", "Read the story")} ↗</span>
    </div><div className="report-feature-art"><span>{t("归档诊断 · 年度相对收益", "ARCHIVED DIAGNOSTIC · ANNUAL DIFFERENCE")}</span><AnnualChart t={t} compact /></div>
  </a>;
}
