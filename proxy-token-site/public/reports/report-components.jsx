import React, { useEffect, useState } from "react";
import teaser from "./teaser.json";
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
// Reports for plans from Basic up. The server decides; this only labels the entry.
export function useResearchAccess() {
  const [state, setState] = useState("unknown");
  useEffect(() => {
    let live = true;
    fetch("/api/research/access", { credentials: "same-origin", cache: "no-store" })
      .then(r => r.json()).then(d => live && setState(d.state)).catch(() => live && setState("unknown"));
    return () => { live = false; };
  }, []);
  return state;
}
export function AccessNote({ t, state }) {
  const text = {
    ok: t("已解锁 · 当前套餐可阅读", "Unlocked · included in your plan"),
    anonymous: t("Basic 及以上套餐可阅读 · 请先登录", "Included from the Basic plan up · sign in first"),
    insufficient: t("当前套餐不含研究报告 · 升级到 Basic 及以上", "Not in your current plan · upgrade to Basic or above"),
    unknown: t("Basic 及以上套餐可阅读", "Included from the Basic plan up"),
  }[state] || "";
  return <span className="access-note" data-state={state}><i aria-hidden="true" />{text}</span>;
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

export function AnnualChart({ t, compact = false }) {
  const [recent, setRecent] = useState(false);
  const data = teaser.annual_returns.filter(x => !recent || x.year >= 2021);
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
  const access = useResearchAccess();
  return <a href={ARTICLE} className={`report-feature ${compact ? "in-library" : ""}`}>
    <div className="report-feature-copy"><p className="eyebrow">BRAIN STOCK RANKING · {t("研究笔记", "RESEARCH NOTE")}</p>
      <h2>{TITLES[language === "en" ? "en" : "zh"]}</h2>
      <p>{t("从 15 特征基线到 34 组严格 purge 的收益实验：拟合排名、修正标签穿越，再检查跨期 IC 与身份尚未准入的条件净值。", "From a 15-feature baseline to 34 purged return experiments: recover rankings, fix label leakage, then inspect multi-horizon IC and NAV conditional on unresolved identities.")}</p>
      <span className="report-byline">LeanData Research <span>·</span> 2026.10.18 <span>·</span> {t("约 18 分钟", "18 min read")}</span>
      <AccessNote t={t} state={access} />
      <span className="report-read">{t("阅读全文", "Read the story")} ↗</span>
    </div><div className="report-feature-art"><span>{t("归档诊断 · 年度相对收益", "ARCHIVED DIAGNOSTIC · ANNUAL DIFFERENCE")}</span><AnnualChart t={t} compact /></div>
  </a>;
}

export const FACTOR_STATS = "/reports/factor-stats/";
export function FactorStatsFeature({ t }) {
  const access = useResearchAccess();
  const windows = [t("全部历史", "Full history"), t("近 7 天", "7 days"), t("近 14 天", "14 days"), t("近 30 天", "30 days")];
  return <a href={FACTOR_STATS} className="report-feature">
    <div className="report-feature-copy"><p className="eyebrow">FACTOR DIRECTORY STATS · {t("因子实测", "MEASURED FACTORS")}</p>
      <h2>{t("211 个因子，在我们的数据上到底有没有用？", "211 factors: what do they do on our data?")}</h2>
      <p>{t("每个因子都有公式、含义，以及我们自己算出的覆盖率、Rank IC、ICIR，和前 20% / 末 20% 的纯多、空头、多空组合。窗口可在全部历史与近 7、14、30 天之间切换。", "Each factor shows its formula and meaning next to our own measured coverage, rank IC, ICIR and top / bottom quintile long-only, short and long-short portfolios, switchable between full history and the last 7, 14 and 30 days.")}</p>
      <span className="report-byline">LeanData Research <span>·</span> {t("每日可更新", "refreshable daily")} <span>·</span> {t("中英双语", "English / 中文")}</span>
      <AccessNote t={t} state={access} />
      <span className="report-read">{t("打开因子目录", "Open the directory")} ↗</span>
    </div><div className="report-feature-art factor-art"><span>{t("统计口径", "WHAT IS MEASURED")}</span>
      <ul>{[t("Rank IC · ICIR · t 值", "Rank IC · ICIR · t-stat"), t("纯多 · 空头 · 多空（五分位）", "Long only · short leg · long-short (quintiles)"), t("累计收益 · 最大回撤 · 换手", "Cumulative return · drawdown · turnover")].map(x => <li key={x}>{x}</li>)}</ul>
      <div className="factor-art-windows">{windows.map(w => <b key={w}>{w}</b>)}</div>
    </div>
  </a>;
}
