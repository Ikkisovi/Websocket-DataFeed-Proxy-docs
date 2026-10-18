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
      <p>{t("15 个常见特征能还原多少排名？一条始于 2010 年的曲线，又能说明多少问题？从拟合、持仓重合到交易日历，重新看一遍证据。", "How much of the ranking can 15 ordinary features recover? And what does a curve starting in 2010 actually establish? We revisit reconstruction, portfolio overlap and the trading calendar.")}</p>
      <span className="report-byline">LeanData Research <span>·</span> 2026.10.17 <span>·</span> {t("约 8 分钟", "8 min read")}</span>
      <span className="report-read">{t("阅读全文", "Read the story")} ↗</span>
    </div><div className="report-feature-art"><span>{t("归档诊断 · 年度相对收益", "ARCHIVED DIAGNOSTIC · ANNUAL DIFFERENCE")}</span><AnnualChart t={t} compact /></div>
  </a>;
}
