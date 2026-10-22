import React, { useEffect, useState } from "react";
import summary from "./brain-stock-ranking/summary-v2.json";
import { TITLES, useReportLanguage, EditorialHeader, OfficialDisclaimer, AnnualChart } from "./report-components.jsx";

const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const signed = (v, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}`;
const ic = v => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(3)}`;
const ci = ([m, lo, hi], d = 1) => `${signed(m, d)}% [${signed(lo, d)}, ${signed(hi, d)}]`;

const ARMS = [
  ["A_rank5_5d", "官方用法：rank5 · 每 5 日换仓", "Vendor use: rank5 · rebalance every 5 days", "#b78b70"],
  ["C_rank2_in_rank21_hold", "rank2 进场 · rank21 支持就持有", "Enter on rank2 · hold while rank21 agrees", "#3b66cf"],
  ["D_rank2_in_rank2_hold", "rank2 进场 · rank2 支持就持有", "Enter on rank2 · hold while rank2 agrees", "#1b7a43"],
  ["ew_universe", "股票池等权", "Equal-weight universe", "#8c9a88"],
  ["spy", "SPY", "SPY", "#263d2c"],
];
const PERIODS = ["2015-06—2026-09", "2023-01—2026-09"];
const IC_PERIODS = ["2015-06—2021", "2022", "2023—2025", "2026"];

function NavChart({ t }) {
  const pts = summary.nav_curve_weekly;
  const width = 720, height = 330, left = 40, right = 16, top = 16, bottom = 290;
  const max = Math.ceil(Math.max(...pts.flatMap(p => ARMS.map(a => p[a[0]]))));
  const x = i => left + (i / (pts.length - 1)) * (width - left - right);
  const y = v => bottom - (v / max) * (bottom - top);
  const path = key => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");
  const years = [2016, 2018, 2020, 2022, 2024, 2026];
  return <figure className="report-chart" data-report-chart="nav">
    <div className="chart-heading"><strong>{t("累计净值，扣 10 bps 单边成本（起点 = 1）", "Cumulative NAV after 10 bps per side (start = 1)")}</strong></div>
    <div className="chart-legend-row">{ARMS.map(([key, zh, en, color]) => <span key={key} className="legend-item">
      <span className="legend-line" style={{ background: color, height: 3 }} />{t(zh, en)}</span>)}</div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("Brain 策略、股票池等权与 SPY 的累计净值", "Cumulative NAV of Brain strategies, the equal-weight universe and SPY")}>
      {Array.from({ length: max + 1 }, (_, v) => <g key={v}><line x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke={v === 1 ? "#b5bdb5" : "#e8ece7"} />
        <text x={left - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#69756d">{v}</text></g>)}
      {years.map(yr => { const i = pts.findIndex(p => p.date.startsWith(String(yr))); return i < 0 ? null :
        <text key={yr} x={x(i)} y={bottom + 20} textAnchor="middle" fontSize="11" fill="#69756d">{yr}</text>; })}
      {ARMS.map(([key, , , color]) => <path key={key} d={path(key)} fill="none" stroke={color} strokeWidth={key === "spy" ? 2.2 : 1.7} strokeDasharray={key === "ew_universe" ? "5 4" : undefined} />)}
    </svg>
    <figcaption>{t("股票：QC 复权收盘价；SPY：Yahoo 复权收盘价。t 日信号，t+1 日收盘成交；等权 30 只。两次调仓之间的等权漂移不计成本。", "Stocks use QC adjusted closes; SPY uses Yahoo adjusted closes. Signal at t, trade at the t+1 close, 30 names equal weight. Drift between trades is not charged.")}</figcaption>
  </figure>;
}

function StrategyTable({ t }) {
  const [period, setPeriod] = useState(PERIODS[0]);
  const rows = summary.nav_table[period];
  return <div className="report-table-wrap">
    <div className="report-switch" aria-label={t("区间", "Period")}>{PERIODS.map(p =>
      <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>{p}</button>)}</div>
    <table data-research-table="strategies"><caption>{t("扣 10 bps 单边成本后的绝对表现；换手为单边、每年倍数。", "Absolute performance after 10 bps per side; turnover is one-way, times per year.")}</caption>
      <thead><tr><th>{t("组合", "Book")}</th><th>{t("净值", "NAV")}</th><th>{t("年化", "CAGR")}</th><th>Sharpe</th><th>{t("最大回撤", "Max DD")}</th><th>{t("换手", "Turnover")}</th></tr></thead>
      <tbody>{ARMS.map(([key, zh, en]) => { const r = rows[key]; return <tr key={key}><th>{t(zh, en)}</th>
        <td>{r.terminal_nav.toFixed(2)}x</td><td>{pct(r.cagr)}</td><td>{r.sharpe.toFixed(2)}</td><td>{pct(r.max_drawdown, 0)}</td>
        <td>{r.turnover_oneway_per_year != null ? `${r.turnover_oneway_per_year}x` : "—"}</td></tr>; })}</tbody></table>
  </div>;
}

function IcTable({ t }) {
  const m = summary.ic_matched;
  const rows = [["rank2", "rank2 → 2 日", "rank2 → 2 days", "h2"], ["rank5", "rank5 → 5 日", "rank5 → 5 days", "h5"],
    ["rank21", "rank21 → 21 日", "rank21 → 21 days", "h21"], ["slope_2m21", "期限结构 rank2 − rank21 → 5 日", "Term structure rank2 − rank21 → 5 days", "h5"]];
  return <div className="report-table-wrap"><table data-research-table="ic">
    <caption>{t("日均截面 Rank IC（t+1 进场）。最后一行是剔除行业与 12 个风险暴露后的 rank5 → 5 日。", "Mean daily cross-sectional rank IC (entry at t+1). The last row is rank5 → 5 days after removing sector and 12 risk exposures.")}</caption>
    <thead><tr><th>{t("信号 → 持有期", "Signal → holding")}</th>{IC_PERIODS.map(p => <th key={p}>{p}</th>)}</tr></thead>
    <tbody>{rows.map(([sig, zh, en, h]) => <tr key={sig}><th>{t(zh, en)}</th>{IC_PERIODS.map(p => <td key={p}>{ic(m[sig][p][h][0])}</td>)}</tr>)}
      <tr><th>{t("rank5 → 5 日，中性化", "rank5 → 5 days, neutralized")}</th>{IC_PERIODS.map(p => <td key={p}>{ic(summary.brain_h5_neutral[p].neutral)}</td>)}</tr></tbody>
  </table></div>;
}

function AstTable({ t }) {
  const a = summary.ast;
  const rows = [["stack1", "单个公式", "Single formula"], ["stack20", "20 个公式线性组合", "Ridge of 20 formulas"]];
  return <div className="report-table-wrap"><table data-research-table="ast">
    <caption>{t("与 Brain rank5 的日均截面 Spearman（拟合度），两个随机种子。公式只在 2015-06—2021 上搜索和拟合。", "Mean daily Spearman with Brain rank5 (fidelity), two seeds. Formulas were searched and fitted on 2015-06—2021 only.")}</caption>
    <thead><tr><th></th><th>2015—2021</th><th>2022</th><th>2023—2025</th><th>2026</th></tr></thead>
    <tbody>{rows.map(([k, zh, en]) => <tr key={k}><th>{t(zh, en)}</th>{["train", "valid", "test", "holdout"].map(s =>
      <td key={s}>{a.s0[k][s].toFixed(2)} / {a.s1[k][s].toFixed(2)}</td>)}</tr>)}
      <tr><th>{t("现有 65 个 5 日因子，线性拟合 Brain", "Our 65 existing 5-day factors, ridge to Brain")}</th><td colSpan="2"></td><td>{summary.library.lib65_ridge_to_brain.fidelity_test.toFixed(2)}</td><td></td></tr></tbody>
  </table></div>;
}

function Article({ language, t }) {
  const full = summary.nav_table[PERIODS[0]];
  const hold = summary.hold_excess_vs_ew;
  const pair = summary.hold_paired_all_10bps;
  const neu = summary.brain_h5_neutral;
  const lost = summary.annual_native_vs_spy.filter(r => r.difference < 0).length;
  const years = summary.annual_native_vs_spy.length;
  return <>
    <header className="story-hero"><a className="report-back" href="/reports/">← {t("所有研究", "All research")}</a>
      <p className="eyebrow">BRAIN STOCK RANKING · {t("研究笔记 01", "RESEARCH NOTE 01")}</p>
      <h1>{TITLES[language === "en" ? "en" : "zh"]}</h1>
      <p className="story-deck">{t("扣成本的策略回测、相对 SPY 的表现、因子本身的质量，以及用公式复现它。", "A cost-aware strategy backtest, the comparison with SPY, the quality of the signal itself, and a formula reproduction.")}</p>
      <div className="story-meta"><span className="author-mark" aria-hidden="true">L</span><span><strong>LeanData Research</strong><br />2026.10.22 · {t("约 6 分钟", "6 min read")}</span><a href="/docs/market/research-signals/brain-overview/">{t("数据说明", "Dataset documentation")} ↗</a></div>
    </header>
    <div className="story-body">
      <aside className="story-note"><strong>{t("结论", "Findings")}</strong><ul>
        <li>{t(<>按官方用法（rank5 选前 30、每 5 个交易日换仓），扣 10 bps 后 2015-06—2026-09 年化 <strong className="text-stat">{pct(full.A_rank5_5d.cagr)}</strong>；同期 SPY <strong className="text-stat">{pct(full.spy.cagr)}</strong>，股票池等权 <strong className="text-stat">{pct(full.ew_universe.cagr)}</strong>。{years} 个年份里有 {lost} 个跑输 SPY。</>,
          <>Used as the vendor suggests (top 30 by rank5, rebalanced every five sessions), it returns <strong className="text-stat">{pct(full.A_rank5_5d.cagr)}</strong> a year after 10 bps from June 2015 to September 2026, against <strong className="text-stat">{pct(full.spy.cagr)}</strong> for SPY and <strong className="text-stat">{pct(full.ew_universe.cagr)}</strong> for the equal-weight universe. It trails SPY in {lost} of {years} years.</>)}</li>
        <li>{t("信号是真的，但很弱：5 日 Rank IC 约 0.02；剔除行业和风险暴露后只剩 0.006—0.014，2022 和 2026 年为负。", "The signal is real but weak: five-day rank IC is about 0.02, falling to 0.006–0.014 after removing sector and risk exposures, and negative in 2022 and 2026.")}</li>
        <li>{t("最大的问题是换手：官方用法每年单边换手约 27 倍。用缓冲规则降到 4—8 倍后，收益回到股票池等权附近，但仍低于 SPY。", "Turnover is the main problem: about 27 times a year one-way. A holding buffer cuts it to 4–8 times and brings returns back to the equal-weight universe, still below SPY.")}</li>
        <li>{t("20 个公式的线性组合就能复现它（与 Brain 的截面相关 0.75—0.77），主体是中长期动量减短期反转，再加盈利质量和营收增长。", "A linear blend of 20 formulas reproduces it (cross-sectional correlation 0.75–0.77 with Brain): medium-term momentum minus short-term reversal, plus profitability and revenue growth.")}</li>
      </ul></aside>

      <h2 id="the-signal">{t("这是什么", "What it is")}</h2>
      <p>{t("Brain 对约 1000 只美股每天给出 2、3、5、10、21 日五个预测周期的打分，股票池按年更新。官方说明的模型是多个机器学习分类器投票，输入包括价量、基本面、行业、波动与日历变量。官方说明书的 Top50 曲线是周调仓、以股票池等权为基准，不扣成本。", "Brain scores about 1,000 US stocks daily for five horizons — 2, 3, 5, 10 and 21 days — with the universe refreshed yearly. The vendor describes a vote of machine-learning classifiers over price, volume, fundamentals, sector, volatility and calendar inputs. Its factsheet shows a weekly Top50 book against an equal-weight universe, before costs.")}</p>
      <p className="source-line"><a href="https://braincompany.co/bsr.html" target="_blank" rel="noopener noreferrer">{t("Brain 官方产品页", "Brain product description")} ↗</a><span>·</span><a href="https://www.braincompany.co/assets/files/BSR_summary.pdf" target="_blank" rel="noopener noreferrer">{t("官方美股说明书", "US factsheet")} ↗</a></p>
      <p>{t(<>我们的检验用 2015—2026 年的 NDX 与 SPX 时点成分（951 个历史证券），Brain 覆盖其中 95% 的股票日。<span className="text-caveat">这是大盘股池，不是 Brain 自己的千只股票池；成分来自 ETF 持仓，不是官方指数成分证明。</span></>,
        <>We test on point-in-time NDX and SPX members from 2015 to 2026 (951 historical securities); Brain covers 95% of their stock-days. <span className="text-caveat">This is a large-cap universe, not Brain's own 1,000 names, and membership comes from ETF holdings rather than official index records.</span></>)}</p>
      <OfficialDisclaimer t={t} />

      <h2 id="backtest">{t("用它做策略：扣成本回测", "As a strategy: a backtest after costs")}</h2>
      <p>{t("规则在运行前固定，只跑一次：t 日的信号在 t+1 日收盘成交，等权持有 30 只，单边成本 10 bps。比较三种用法：官方的 rank5 每 5 日换仓（5 个错开的分仓，避免起始日的偶然性）；用 rank2 进场、只要 rank21 仍在前 50% 就持有；以及同样的缓冲但用 rank2 自己判断，作为对照。", "Rules were fixed before a single run: signal at t, trade at the t+1 close, 30 names equal weight, 10 bps per side. Three uses are compared: the vendor's rank5 rebalanced every five sessions (five staggered tranches, so no start date is chosen); entering on rank2 and holding while rank21 stays in the top half; and the same buffer judged by rank2 itself, as a control.")}</p>
      <NavChart t={t} />
      <StrategyTable t={t} />
      <p>{t(<>扣成本前，官方用法每年比股票池等权多 <strong className="text-stat">{signed(hold.A_rank5_5d.gross[0])}%</strong>；扣 10 bps 后变成 <strong className="text-stat">{ci(hold.A_rank5_5d.net10)}</strong>。缓冲规则把差距补了回来：rank21 持有比官方用法每年多 {ci(pair["C_rank2_in_rank21_hold - A_rank5_5d [all, 10bps]"])}，但这几乎全是省下的成本。它与“用 rank2 自己做缓冲”的差为 {ci(pair["C_rank2_in_rank21_hold - D_rank2_in_rank2_hold [all, 10bps]"])}：长周期的打分没有提供额外信息，起作用的是降低换手本身。</>,
        <>Before costs the vendor's use beats the equal-weight universe by <strong className="text-stat">{signed(hold.A_rank5_5d.gross[0])}%</strong> a year; after 10 bps it becomes <strong className="text-stat">{ci(hold.A_rank5_5d.net10)}</strong>. The buffer recovers the gap: holding on rank21 adds {ci(pair["C_rank2_in_rank21_hold - A_rank5_5d [all, 10bps]"])} a year over the vendor's use, almost all of it saved costs. Against a buffer judged by rank2 itself the difference is {ci(pair["C_rank2_in_rank21_hold - D_rank2_in_rank2_hold [all, 10bps]"])}: the long horizon adds no information; lower turnover does the work.</>)}</p>

      <h2 id="vs-spy">{t("和 SPY 比", "Against SPY")}</h2>
      <AnnualChart t={t} />
      <p>{t(<>官方用法只在 2015（半年）和 2020 年跑赢 SPY。即使用缓冲规则，2015—2026 年的年化也只有 <strong className="text-stat">{pct(full.D_rank2_in_rank2_hold.cagr)}</strong>，Sharpe {full.D_rank2_in_rank2_hold.sharpe.toFixed(2)}，最大回撤 {pct(full.D_rank2_in_rank2_hold.max_drawdown, 0)}；SPY 是 {pct(full.spy.cagr)}、{full.spy.sharpe.toFixed(2)}、{pct(full.spy.max_drawdown, 0)}。在大盘股池里，等权本身就落后于市值加权的 SPY，Brain 选出的 30 只股票没能弥补这个差距。</>,
        <>The vendor's use beats SPY only in 2015 (half a year) and 2020. Even with the buffer, 2015–2026 returns <strong className="text-stat">{pct(full.D_rank2_in_rank2_hold.cagr)}</strong> a year with Sharpe {full.D_rank2_in_rank2_hold.sharpe.toFixed(2)} and a {pct(full.D_rank2_in_rank2_hold.max_drawdown, 0)} drawdown, against {pct(full.spy.cagr)}, {full.spy.sharpe.toFixed(2)} and {pct(full.spy.max_drawdown, 0)} for SPY. In a large-cap universe equal weight already trails cap-weighted SPY, and Brain's 30 names do not close that gap.</>)}</p>

      <h2 id="quality">{t("因子本身的质量", "The quality of the signal")}</h2>
      <IcTable t={t} />
      <p>{t(<>五个周期几乎是同一个信号：每个周期的截面排名有 {Math.round(summary.redundancy_r2_train.rank21 * 100)}%—{Math.round(summary.redundancy_r2_train.rank5 * 100)}% 能由另外四个解释，取平均也不比 rank5 好。短周期略强，21 日最弱。期限结构（rank2 − rank21）只在 2022 和 2026 年有用，那两年长周期的打分失效；在 2015—2021 年它接近 0，事前无法知道何时启用。</>,
        <>The five horizons are nearly one signal: {Math.round(summary.redundancy_r2_train.rank21 * 100)}–{Math.round(summary.redundancy_r2_train.rank5 * 100)}% of each horizon's ranking is explained by the other four, and averaging them does no better than rank5. Shorter horizons are slightly stronger; 21 days is weakest. The term structure (rank2 − rank21) only helps in 2022 and 2026, when the long horizon failed; in 2015–2021 it is near zero, so there is no way to know beforehand when to use it.</>)}</p>
      <p>{t(<>中性化后 IC 从 {ic(neu["2023—2025"].raw)} 降到 {ic(neu["2023—2025"].neutral)}（2023—2025），2026 年为 {ic(neu["2026"].neutral)}：大部分收益是风格暴露。它对我们已有的因子也没有增量：与 36 个价量输入一起做线性组合时，Brain 的权重只有 {summary.ridge_weight_of_brain_among_37}；在公式搜索中把 Brain 作为一个可选变量，排名前 10 的公式里只有 3 个（另一次 0 个）用到它，测试期表现与不放 Brain 的搜索没有可分辨的差别。</>,
        <>Neutralized, IC falls from {ic(neu["2023—2025"].raw)} to {ic(neu["2023—2025"].neutral)} in 2023–2025 and is {ic(neu["2026"].neutral)} in 2026: most of the return is style exposure. It also adds nothing to factors we already have: blended linearly with 36 price-volume inputs, Brain gets a weight of {summary.ridge_weight_of_brain_among_37}; offered as a variable in a formula search, it appears in 3 of the top 10 formulas (0 in a second run), with test results indistinguishable from a search without it.</>)}</p>

      <h2 id="reproduction">{t("用公式复现它", "Reproducing it with formulas")}</h2>
      <p>{t("我们在 64 个价量、基本面与风险字段上做遗传编程搜索，目标是与 Brain rank5 的截面相关，只用 2015-06—2021 年数据，每个随机种子评估 10 万个公式。", "We ran a genetic-programming search over 64 price, fundamental and risk fields, targeting cross-sectional correlation with Brain rank5, on June 2015–2021 data only, with 100,000 formulas evaluated per seed.")}</p>
      <AstTable t={t} />
      <p>{t(<>两个种子找到同一类结构。一个 12 个符号的短例子：<code>Rank(SUE) − 账面市值比 − 3 日均值(Rank(5 日反转)) + Rank(12-1 月动量)</code>，训练期相关 0.68，2023—2025 年 0.74。复现组合的 5 日 IC 与 Brain 本身相当（2023—2025 年约 0.02）。2026 年拟合度降到 0.61，说明 Brain 今年的模型或输入可能变了，这一点我们无法核实。</>,
        <>Both seeds find the same structure. A short 12-symbol example: <code>Rank(SUE) − book-to-price − 3-day mean(Rank(5-day reversal)) + Rank(12-1 month momentum)</code>, with correlation 0.68 in training and 0.74 in 2023–2025. The reproduction's five-day IC matches Brain's own (about 0.02 in 2023–2025). Fidelity falls to 0.61 in 2026, which suggests the model or its inputs changed this year; we cannot verify that.</>)}</p>

      <h2 id="limits">{t("缺点与没测的部分", "Weaknesses, and what we did not test")}</h2>
      <ul>
        <li>{t("信号弱且以风格为主；原生的 5 日换仓撑不起它的成本。", "The signal is weak and mostly style; native five-day rebalancing cannot carry its costs.")}</li>
        <li>{t("年份之间差异远大于用法之间差异：2022 年所有用法都比等权池少 5—16 个百分点。", "Years differ far more than uses: in 2022 every use trails the equal-weight universe by 5–16 points.")}</li>
        <li>{t("五个周期高度冗余，可被常见公式复现，独有信息很少。", "The five horizons are redundant and reproducible from common formulas, leaving little unique information.")}</li>
        <li>{t("没测：多空组合、Brain 自己的千只股票池、行业中性组合、盘中执行。2026 年数据已在本文的多项分析中读过，不能再作未读样本。", "Not tested: long-short books, Brain's own 1,000-name universe, sector-neutral books, intraday execution. 2026 data has been read in several analyses here and is no longer an unseen sample.")}</li>
        <li>{t("此前版本中基于旧回测的长期曲线已撤回：那份回测把缺失收益记为 0，并且调仓日历有错，实际是 3 日与 8 日交替持有。", "The long-run curve in earlier versions is withdrawn: that backtest booked missing returns as zero, and a calendar bug made it alternate three- and eight-session holds.")}</li>
      </ul>

      <section className="story-methods" id="methods"><h2>{t("方法", "Methods")}</h2>
        <p>{t("IC 为每日截面 Spearman，在两者都有值的股票上重新排名，每日至少 30 只；区间为 21 日循环区块自助法 95% 区间。中性化把信号与收益都对截距、12 个风险暴露排名和行业做回归后取残差。公式搜索的选择只用 2015-06—2021 年；2022、2023—2025、2026 依次读取。", "IC is the daily cross-sectional Spearman, reranked on stocks where both values exist, with at least 30 stocks a day; intervals are 95% circular block-bootstrap intervals with 21-day blocks. Neutralization regresses both signal and return on an intercept, 12 risk-exposure ranks and sector, and keeps the residuals. Formula search selection used June 2015–2021 only; 2022, 2023–2025 and 2026 were read in that order.")}</p>
        <ul>
          <li><a href="./summary-v2.json" download>{t("下载本文汇总数据 JSON", "Download this note's summary data (JSON)")}</a></li>
          <li><a href="https://www.quantconnect.com/docs/v2/writing-algorithms/datasets/brain/brain-ml-stock-ranking" target="_blank" rel="noopener noreferrer">QuantConnect · Brain ML Stock Ranking ↗</a></li>
          <li><a href="/docs/market/research-signals/brain-universe-snapshot/">{t("LeanData 时点股票池接口", "LeanData dated-universe endpoint")} ↗</a></li>
        </ul></section>
    </div>
    <footer className="story-footer"><a href="/research-data">← {t("回到研究数据", "Back to research data")}</a><span>LeanData Research · {t("研究笔记，不是投资建议", "Research note, not investment advice")}</span></footer>
  </>;
}
export function BrainArticlePage() {
  const [language, t] = useReportLanguage();
  useEffect(() => { document.title = `${TITLES[language === "en" ? "en" : "zh"]} — LeanData`; document.documentElement.lang = language === "en" ? "en" : "zh-CN"; }, [language]);
  return <div className="reports-page" data-no-i18n="true"><EditorialHeader language={language} t={t} />
    <main><Article language={language} t={t} /></main>
  </div>;
}
