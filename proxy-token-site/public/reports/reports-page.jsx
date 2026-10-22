import React, { useEffect } from "react";
import { TITLES, useReportLanguage, EditorialHeader, ReportFeature, FactorStatsFeature } from "./report-components.jsx";

export function ReportsPage() {
  const [language, t] = useReportLanguage();
  useEffect(() => { document.title = `${t("研究报告", "Research reports")} — LeanData`; document.documentElement.lang = language === "en" ? "en" : "zh-CN"; }, [language]);
  return <div className="reports-page" data-no-i18n="true"><EditorialHeader language={language} t={t} />
    <main><div className="reports-index"><p className="eyebrow">LEANDATA RESEARCH</p><h1>{t("读懂信号，\n再使用数据。", "Understand the signal.\nThen use the data.")}</h1><p className="reports-intro">{t("从一个具体问题出发，复查数据、方法和结果。这里记录我们对研究数据的实际检验，包括有效的部分、失效的部分，以及尚未回答的问题。研究报告面向 Basic 及以上套餐的账户。", "Start with a question, then inspect the data, methods and results. Field notes on what research datasets reveal, where they fall short, and what we still need to test. Reports are available to accounts on the Basic plan and above.")}</p><div className="report-index-heading"><h2>{t("最新研究", "Latest research")}</h2><span>02</span></div><FactorStatsFeature t={t} /><ReportFeature t={t} language={language} /><div className="reports-crosslink"><div><p className="eyebrow">DATA LIBRARY</p><h2>{t("把研究接到你的工作流", "Bring the data into your workflow")}</h2><p>{t("查看 Brain、Spectral 等数据说明与当前访问方式。", "Explore Brain, Spectral and the current ways to access each dataset.")}</p></div><a className="btn" href="/research-data">{t("浏览研究数据", "Browse research data")} ↗</a></div></div></main>
  </div>;
}
