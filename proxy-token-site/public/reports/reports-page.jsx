import React, { useEffect, useState } from "react";
import { study, TITLES, ARTICLE, useReportLanguage, EditorialHeader, AnnualChart, ReportFeature } from "./report-components.jsx";

const MODEL_LABELS = {
  ridge_fundamentals: ["基本面 · 线性", "Fundamentals · linear"],
  ridge_momentum_and_volatility: ["动量与波动 · 线性", "Momentum & volatility · linear"],
  ridge_combined: ["两者合并 · 线性", "Combined · linear"],
  boosted_combined: ["两者合并 · 提升树", "Combined · boosted trees"],
};
const fmt = n => new Intl.NumberFormat("en-US").format(n);
const pct = n => `${(n*100).toFixed(2)}%`;
function ReconstructionChart({ t }) {
  const [stage, setStage] = useState("later");
  return <figure className="report-chart" data-report-chart="reconstruction">
    <div className="chart-heading"><strong>{t("还原排名，不是预测收益", "Reconstructing ranks, not predicting returns")}</strong><div className="report-switch">
      <button type="button" aria-pressed={stage === "validation"} onClick={() => setStage("validation")}>{t("验证期", "Validation")}</button>
      <button type="button" aria-pressed={stage === "later"} onClick={() => setStage("later")}>{t("后段样本", "Later period")}</button>
    </div></div>
    <div className="model-bars">{study.reconstruction.models.map(m => <div key={m.id} className="model-bar">
      <span>{t(...MODEL_LABELS[m.id])}</span><div className="model-bar-track"><span style={{ width: `${m.stages[stage].mean_daily_spearman*100}%` }} /></div><strong>{m.stages[stage].mean_daily_spearman.toFixed(3)}</strong>
    </div>)}</div>
    <figcaption>{t("每日截面 Spearman 相关系数，四个模型使用同一批完整观测。验证期：2023-01—2024-06；后段：2024-07—2026-09。后段已被此前研究查看，不是全新的确认样本。", "Mean daily cross-sectional Spearman correlation on identical complete cases. Validation: January 2023–June 2024; later: July 2024–September 2026. Later dates have previously been inspected and are not a fresh confirmation sample.")}</figcaption>
  </figure>;
}
function Article({ language, t }) {
  const fit = study.reconstruction, legacy = study.archived_diagnostic;
  const best = fit.models.find(m => m.id === "boosted_combined").stages.later;
  const [showAnnual, setShowAnnual] = useState(false);
  return <>
    <header className="story-hero"><a className="report-back" href="/reports/">← {t("所有研究", "All research")}</a>
      <p className="eyebrow">BRAIN STOCK RANKING · {t("研究笔记 01", "RESEARCH NOTE 01")}</p>
      <h1>{TITLES[language === "en" ? "en" : "zh"]}</h1>
      <p className="story-deck">{t("用 15 个常见特征拆解一套机器学习排名，再检查一条长期回测曲线背后的交易日历。", "A small reconstruction model, a long backtest, and the clocks that sit between them.")}</p>
      <div className="story-meta"><span className="author-mark" aria-hidden="true">L</span><span><strong>LeanData Research</strong><br />2026.10.17 · {t("约 8 分钟", "8 min read")}</span><a href="/docs/market/research-signals/brain-overview/">{t("数据说明", "Dataset documentation")} ↗</a></div>
    </header>
    <div className="story-body">
      <p className="story-opening">{t("拿到一套机器学习股票排名，最容易问的是：买排名最高的股票，能赚多少？我们想先问一个更朴素的问题：如果不用它的模型，只用常见的基本面和动量特征，能否得到相似的排序？", "When a machine-learning stock ranking arrives, the natural question is how much the highest-ranked stocks earn. We began one step earlier: can ordinary fundamentals and momentum recover a similar ordering without using the vendor’s model?")}</p>
      <p>{t("这两个问题有关，却不是同一个问题。能拟合排名，说明模型之间存在共同信息；它不证明能复刻原始分数，更不证明能复刻未来收益。相反，一条好看的历史曲线，也可能混合了市场风险、风格暴露和回测时钟的影响。", "These are connected questions, but they measure different things. Recovering a ranking establishes shared information. It does not establish identical scores or future returns. A persuasive historical curve can also combine market risk, style exposures and choices about when trades occur.")}</p>
      <aside className="story-note"><strong>{t("这篇文章的结论范围", "What this note establishes")}</strong><p>{t("小模型能还原相当一部分排序，但还谈不上几乎完全一致。保存的长期曲线需要按诊断性结果阅读，尚不能作为固定持有 5 个交易日的独立回测证据。", "The small model recovers substantial ordering information, with meaningful disagreement remaining. The saved long-run curve is a diagnostic, not independent evidence for a fixed five-trading-session strategy.")}</p></aside>

      <h2 id="the-signal">{t("先认识这套排名", "First, understand the signal")}</h2>
      <p>{t("Brain 的官方产品同时提供 2、3、5、10、21 日五种预测周期，股票池按年调整。其公开说明已把价量、基本面、市场状态和日历列为模型输入。因此，用这些常见变量解释部分排序并不意外；真正值得检验的是，剩余信息是否改善了投资决策。", "Brain describes five forecast horizons—2, 3, 5, 10 and 21 days—and an annually refreshed stock universe. Its public description already lists price, volume, fundamentals, market conditions and calendar variables as inputs. Shared structure with familiar factors is therefore unsurprising. The useful question is whether the remaining information improves investment decisions.")}</p>
      <p className="source-line"><a href="https://braincompany.co/bsr.html" target="_blank" rel="noopener noreferrer">{t("Brain 官方产品页", "Brain product description")} ↗</a><span>·</span><a href="https://www.braincompany.co/assets/files/BSR_summary.pdf" target="_blank" rel="noopener noreferrer">{t("官方美股说明书", "US factsheet")} ↗</a></p>
      <p>{t("LeanData 的历史证券并集包含 2220 个清洗后的稳定身份，最新记录日的名单则有 947 个。前者是多年名单的并集，后者是某一天的已收录观测；两者都不能直接当成官方完整成分证明。本文的重建实验还要与本地特征库求交集，样本范围更窄。", "LeanData’s cleaned historical union contains 2,220 stable identities; the latest recorded cross-section contains 947. A historical union and one day’s observed names are different denominators, and neither certifies complete official constituents. Our reconstruction uses a further intersection with the local feature corpus.")}</p>

      <h2 id="reconstruction">{t("15 个变量，能走多远？", "How far do 15 ordinary variables go?")}</h2>
      <p>{t("我们固定使用 9 个基本面变量：盈利收益率、市净率、ROE、ROA、净利润率、负债权益比、营收增长、市值和股息率；再加 5、21、63、126、252 个观测交易日的动量，以及 21 日波动率。所有输入滞后一个观测交易日，按日做截面排序。缺失值不补零，四个对照共享相同的完整观测。", "We fixed nine fundamental variables: earnings yield, price-to-book, ROE, ROA, net margin, debt-to-equity, revenue growth, market capitalization and dividend yield. We added momentum over 5, 21, 63, 126 and 252 observed sessions, plus 21-session volatility. Inputs lag one observed session and are ranked cross-sectionally each day. All four comparisons use identical complete cases, with no missing-value filling.")}</p>
      <p>{t(`实验共有 ${fmt(fit.common_rows)} 个股票日、${fit.common_securities} 个历史证券身份。2016-04 至 2022 年用于训练，2023-01 至 2024-06 用于验证，2024-07 至 2026-09 是后段分析期。这个交集不是完整 Brain 股票池，基本面的历史发布版本也尚未独立认证。`, `The study contains ${fmt(fit.common_rows)} stock-days across ${fit.common_securities} historical identities. Training runs from April 2016 through 2022; validation from January 2023 through June 2024; later analysis from July 2024 through September 2026. This intersection is not the full Brain universe, and fundamental publication vintages are not independently certified.`)}</p>
      <ReconstructionChart t={t} />
      <p>{t("基本面线性模型的后段日均秩相关为 0.571，动量与波动率模型为 0.547。两者合并后，线性模型达到 0.759；固定参数的浅层提升树达到 0.813。这是相当强的排序关联，但 0.813 不是 81.3% 的预测准确率，也不是对未来收益的相关系数。", "In the later period, fundamentals alone reach a mean daily rank correlation of 0.571; momentum and volatility reach 0.547. Combining them raises the linear model to 0.759, and a shallow boosted model with fixed settings reaches 0.813. That is substantial ordering agreement. It is not 81.3% prediction accuracy, nor a correlation with future returns.")}</p>
      <blockquote>{t(`换成持仓语言：在同一交集内选 Top50，提升树与 Brain 的名单平均只重合约 ${(best.top50_mean_overlap*50).toFixed(1)} 只。`, `In portfolio terms, the boosted model and Brain share only about ${(best.top50_mean_overlap*50).toFixed(1)} of their Top50 names on average within this same intersection.`)}</blockquote>
      <p>{t("所以，我们的初步判断需要更精确：常见变量足以重建不少排名信息；“几乎拟合一致”仍然过强。余下差异究竟是有效信息、非线性结构还是噪声，要用相同股票池上的后续收益和成本来判断，不能从拟合相关直接跳过去。", "Our starting claim therefore needs precision. Ordinary variables recover a meaningful part of the ordering, while “almost identical” goes too far. Whether the remaining disagreement is useful information, nonlinear structure or noise requires a return-and-cost comparison on the same universe.")}</p>

      <h2 id="the-curve">{t("再回头看那条长期曲线", "Then revisit the long-run curve")}</h2>
      <p>{t(`保存的分析配置使用 rank5days、Top50、每次单边换手 2 个基点成本，时间覆盖 ${legacy.start} 至 ${legacy.end}。对导出的日收益重新计算，策略年化复合收益约 ${pct(legacy.brain.cagr)}，SPY 约 ${pct(legacy.spy.cagr)}；策略年化波动约 ${pct(legacy.brain.annualized_volatility)}，SPY 约 ${pct(legacy.spy.annualized_volatility)}。这说明较高的复合收益伴随着更高的风险。`, `The saved analysis uses rank5days, Top50 and a two-basis-point one-way turnover cost, covering ${legacy.start} through ${legacy.end}. Recomputed from the exported daily returns, compound annual growth is about ${pct(legacy.brain.cagr)} versus ${pct(legacy.spy.cagr)} for SPY; annualized volatility is ${pct(legacy.brain.annualized_volatility)} versus ${pct(legacy.spy.annualized_volatility)}. The higher compound return comes with greater risk.`)}</p>
      <p>{t("旧脚本把 CAGR 除以波动率的结果标成了 Sharpe。按日收益均值除以日收益标准差、年化并假设无风险收益为零，归档策略约为 0.752，SPY 约为 0.854。两种口径不能混用，也不能把旧标签直接当成正式风险调整收益证据。", "The old script labels CAGR divided by volatility as Sharpe. Using annualized mean daily return divided by daily standard deviation, with a zero risk-free rate, the archived strategy is about 0.752 and SPY about 0.854. These definitions cannot be interchanged, and the old label is not formal risk-adjusted-performance evidence.")}</p>
      <AnnualChart t={t} />
      <p>{t("“最近效果不好”也需要带上时间窗口。归档中 2025 年策略约上涨 5.52%，SPY 约上涨 15.70%，确实明显落后；但 2026 年截至 9 月 29 日，策略约上涨 18.61%，SPY 约上涨 11.56%。从 2025 年初连到该截止日，策略相对净值仍落后约 3.03%。我们看到的是不稳定的相对表现，而不是每个近期年份都失效。", "“Weak recently” needs a window. In the archive, the strategy gains about 5.52% in 2025 against SPY’s 15.70%, a material shortfall. In 2026 through September 29, it gains about 18.61% against 11.56%. Across the combined window from early 2025, relative wealth still trails by about 3.03%. This is uneven relative performance, rather than failure in every recent year.")}</p>
      <button type="button" className="report-text-button" aria-expanded={showAnnual} onClick={() => setShowAnnual(x => !x)}>{showAnnual ? t("收起年度数据", "Hide annual data") : t("查看年度数据", "Show annual data")} {showAnnual ? "−" : "+"}</button>
      {showAnnual && <div className="report-table-wrap"><table><caption>{t("归档诊断性收益；2010 和 2026 均为部分年度", "Archived diagnostic returns; 2010 and 2026 are partial years")}</caption><thead><tr><th>{t("年度", "Year")}</th><th>Brain</th><th>SPY</th><th>{t("百分点差", "Difference, pp")}</th></tr></thead><tbody>{legacy.annual_returns.map(row => <tr key={row.year}><th>{row.year}{row.partial_year ? "*" : ""}</th><td>{pct(row.brain)}</td><td>{pct(row.spy)}</td><td>{(row.difference*100).toFixed(2)}</td></tr>)}</tbody></table></div>}

      <h2 id="five-days">{t("“五日”，是哪一种五日？", "Which five days?")}</h2>
      <p>{t(`最值得注意的发现来自调仓记录。归档包含 ${legacy.rebalance_intervals} 个相邻调仓间隔，在保存的价格序列中，恰好相隔 5 个观测交易日的只有 ${legacy.five_session_intervals} 个。最常见的间隔是 3 日和 8 日。持仓日期与非零换手日期完全一致，这排除了单纯由持仓日期解码造成的差异。`, `The rebalance log provides the most consequential finding. Of ${legacy.rebalance_intervals} consecutive rebalance intervals, only ${legacy.five_session_intervals} spans exactly five observed price sessions. Three- and eight-session intervals are most common. Holdings dates match nonzero-turnover dates exactly, ruling out a discrepancy confined to decoding the holdings dates.`)}</p>
      <div className="cadence-grid">{Object.entries(legacy.session_gap_counts).map(([gap, count]) => <div key={gap} className={gap === "5" ? "intended" : ""}><strong>{gap}</strong><span>{t("日间隔", "sessions apart")}</span><b>{count} {t("次", "times")}</b></div>)}</div>
      <p>{t("本地模板先在排名索引上每五行取一个调仓日，再与价格日期相交。记录日期与交易日历不一致时，这种写法会偏离每五个交易日调仓。它与归档现象相符，但我们还没有完整封存当时的执行源，因此把它列为需要重跑确认的机制，而非已经证明的唯一原因。", "The local template selects every fifth row of the ranking index before intersecting with price dates. When record dates and the trading calendar differ, that procedure can depart from five-session rebalancing. It is consistent with the archive, but the historical execution source is not fully sealed; this mechanism needs confirmation in a controlled rerun.")}</p>
      <p>{t("因此，“rank5d、hold5d 是唯一有效组合”目前不能成立为研究结论。我们保存的是一条 rank5days 的诊断运行，其他四个周期还没有同口径的完整对照。更关键的是，现有这条曲线本身尚未实现所声称的固定五交易日持有。", "The claim that rank5d/hold5d is the only useful combination is therefore not established. This archive evidences one rank5days diagnostic, not a controlled comparison across all horizons. The curve also does not implement the fixed five-session holding schedule its configuration suggests.")}</p>

      <h2 id="next-question">{t("下一步，要检验增量信息", "The next question is incremental information")}</h2>
      <p>{t("我们会把后续比较放在同一时点股票池、同一交易日历和同一成本口径上：原始 Brain 排名、这个简单模型，以及控制常见特征之后的剩余信号。五种周期需要完整呈现，调仓起点也要做平移对照。缺失的持仓价格必须单独核对，不能当作零收益处理。", "The next comparison should put the original Brain ranking, the small reconstruction model and the remaining signal on the same dated universe, trading calendar and cost model. It should report all five horizons and test shifted rebalance starts. Missing held prices need explicit accounting rather than zero-return substitution.")}</p>
      <p>{t("基准也要对齐。Brain 官方说明书使用股票池等权组合做对照，而这份归档使用 SPY。前者更适合检验选股增量，后者回答相对一个可投资市场产品的表现；二者不能互相替代。历史发布版本、下一交易日执行、滑点和换手都还要一并验证。", "Benchmarks matter too. Brain’s factsheet compares with an equal-weighted universe, while this archive compares with SPY. The former helps test selection within the universe; the latter addresses performance relative to an investable market product. They answer different questions. Publication vintages, next-session execution, slippage and turnover remain part of the verification.")}</p>
      <p>{t("现阶段，更有用的认识是：复杂模型的排名可以与常见因子有很强的共同结构，而“有共同结构”“多赚了一点”和“具有可交易的增量信息”仍需要三套不同的证据。我们把这篇文章作为研究的起点。", "For now, the useful finding is that a complex ranking can share substantial structure with ordinary factors. Shared structure, a higher historical return and tradable incremental information each require their own evidence. This note is the starting point for that distinction.")}</p>

      <section className="story-methods" id="methods"><h2>{t("方法与延伸阅读", "Methods & further reading")}</h2><p>{t("重建：Ridge，alpha=1000；直方图梯度提升，100 轮、最多 15 叶、学习率 0.05，固定随机种子。Top50 重合只统计共同样本至少有 100 个证券的日期，排名相同按保留的稳定轴顺序打破平局。后段样本曾被先前研究查看，不作为全新样本外发现。", "Reconstruction: Ridge with alpha=1000; histogram gradient boosting with 100 iterations, at most 15 leaves and learning rate 0.05, with a fixed seed. Top50 overlap uses dates with at least 100 securities; ties follow the retained stable axis order. Later dates were previously inspected, so these are not fresh out-of-sample discoveries.")}</p>
      <ul><li><a href="./reconstruction.csv" download>{t("下载重建结果摘要 CSV", "Download reconstruction summary CSV")}</a></li><li><a href="./annual-diagnostic.csv" download>{t("下载归档诊断年度收益 CSV", "Download archived diagnostic annual returns CSV")}</a></li><li><a href="./reconstruction.png" download>{t("下载重建对照图", "Download reconstruction figure")}</a></li><li><a href="./annual-diagnostic.png" download>{t("下载年度相对表现图", "Download annual comparison figure")}</a></li><li><a href="https://www.quantconnect.com/docs/v2/writing-algorithms/datasets/brain/brain-ml-stock-ranking" target="_blank" rel="noopener noreferrer">QuantConnect · Brain ML Stock Ranking ↗</a></li><li><a href="/docs/market/research-signals/brain-universe-snapshot/">{t("LeanData 时点股票池接口", "LeanData dated-universe endpoint")} ↗</a></li></ul></section>
    </div>
    <footer className="story-footer"><a href="/research-data">← {t("回到研究数据", "Back to research data")}</a><span>LeanData Research · {t("研究笔记，不是投资建议", "Research note, not investment advice")}</span></footer>
  </>;
}
export function ReportsPage() {
  const [language, t] = useReportLanguage();
  const article = window.location.pathname.startsWith(ARTICLE);
  useEffect(() => { document.title = `${article ? TITLES[language === "en" ? "en" : "zh"] : t("研究报告", "Research reports")} — LeanData`; document.documentElement.lang = language === "en" ? "en" : "zh-CN"; }, [article, language]);
  return <div className="reports-page" data-no-i18n="true"><EditorialHeader language={language} t={t} />
    <main>{article ? <Article language={language} t={t} /> : <div className="reports-index"><p className="eyebrow">LEANDATA RESEARCH</p><h1>{t("读懂信号，\n再使用数据。", "Understand the signal.\nThen use the data.")}</h1><p className="reports-intro">{t("从一个具体问题出发，复查数据、方法和结果。这里记录我们对研究数据的实际检验，包括有效的部分、失效的部分，以及尚未回答的问题。", "Start with a question, then inspect the data, methods and results. Field notes on what research datasets reveal, where they fall short, and what we still need to test.")}</p><div className="report-index-heading"><h2>{t("最新研究", "Latest research")}</h2><span>01</span></div><ReportFeature t={t} language={language} /><div className="reports-crosslink"><div><p className="eyebrow">DATA LIBRARY</p><h2>{t("把研究接到你的工作流", "Bring the data into your workflow")}</h2><p>{t("查看 Brain、Spectral 等数据说明与当前访问方式。", "Explore Brain, Spectral and the current ways to access each dataset.")}</p></div><a className="btn" href="/research-data">{t("浏览研究数据", "Browse research data")} ↗</a></div></div>}</main>
  </div>;
}
