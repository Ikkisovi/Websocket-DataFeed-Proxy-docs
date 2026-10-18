import React from "react";
import audit from "./brain-stock-ranking/same-basis-summary.json";

const pct = x => x === null ? "—" : `${(x * 100).toFixed(2)}%`;
const dec = x => x === null ? "—" : x.toFixed(3);

export function BrainSameBasisUpdate({ t }) {
  const window = audit.windows["2024-07+"];
  const primary = window.fees["2"];
  const names = [["broad_blend_ridge", t("冻结的 blend Ridge", "Frozen blend Ridge")], ["brain_rank5days", t("共同池 Brain Top50", "Common-pool Brain Top50")], ["SPY_buy_hold", "SPY buy & hold"]];
  return <section className="same-basis-update" aria-labelledby="same-basis-audit">
    <h2 id="same-basis-audit">{t("最新核验：统一复权、选股和成本之后", "Latest audit: shared adjustment, selection and cost rules")}</h2>
    <aside className="story-note research-warning"><strong>{t("先更正价格口径", "First correct the price definition")}</strong><p>{t(
      "内部 corpus close 经追溯属于 QC 拆分／现金分红复权价格，而不是未复权原价。此前以 ClickHouse 原始 SPY 收盘价作主比较的说法撤回。这里股票保留原生 QC SID 与 QC Adjusted close，SPY 使用通过本地共享限流网关封存的 Alpaca SIP adjustment=all。统一的是复权、日期和账务约定，不冒称两个供应商的逐值价格已同源对齐。旧 Yahoo 图及 34 组组合仅作为明确标注的历史诊断保留。",
      "The internal corpus close is QC split/cash-dividend Adjusted, not raw unadjusted close. The earlier raw ClickHouse SPY comparison is withdrawn. Stocks retain native QC SIDs and QC Adjusted closes; SPY uses sealed Alpaca SIP adjustment=all captures through the local shared gateway. Normalization, dates and accounting are shared, but distinct providers are not misrepresented as same-vendor price parity. Earlier Yahoo and 34-book charts remain explicitly historical diagnostics."
    )}</p></aside>
    <p>{t(
      "只重估已冻结的 broad / blend / Ridge，不重新挑模型。两种股票信号先取当日共同可评分的原生 SID，再各选 Top50；这一窗口平均约 494 只，而不是沿用约 525 只的模型单独覆盖池。信号日之后的下一交易日收盘执行，每五个交易日调仓，按漂移后的真实交易金额计费，不每周强行清仓。无价入场保留现金，所需退出价未知就阻断，不用未来数据补选。",
      "Revalue only the previously frozen broad / blend / Ridge; do not choose another model. Both stock signals use the same signal-date native-SID support before selecting Top50: about 494 names on average in this window, not the model-only roughly 525-name coverage pool. Execute at the next session close, rebalance every five sessions and charge actual drift-aware traded notional rather than forcing weekly liquidation. Missing entries remain cash; required unknown exits block the book, without hindsight replacement."
    )}</p>
    <div className="report-table-wrap"><table data-research-table="same-basis"><caption>{t("2024-07-05 至 2026-09-22，111 个五交易日期间；这个日历窗口沿用前一轮稳定性研究，不按本轮收益另选。主费率为每笔成交金额 2 bps，所有组合在同日终止并计退出费用。Sharpe 采用日收益、样本标准差、√252，无风险利率为 0。", "2024-07-05 to 2026-09-22, 111 five-session periods. Reuses the preceding study’s calendar window, not a window selected on these returns. Primary cost is 2 bps per traded notional; all books terminate together with exit costs. Sharpe uses daily returns, sample SD, sqrt(252), zero risk-free rate.")}</caption><thead><tr><th>{t("组合", "Book")}</th><th>{t("终值", "Terminal NAV")}</th><th>CAGR</th><th>{t("日频 Sharpe", "Daily Sharpe")}</th><th>{t("五日 Sharpe", "5-session Sharpe")}</th><th>{t("最大回撤", "Max drawdown")}</th></tr></thead><tbody>
      {names.map(([key, label]) => { const row = primary[key]; return <tr key={key}><th>{label}</th><td>{row.terminal_nav.toFixed(3)}×</td><td>{pct(row.cagr)}</td><td>{dec(row.daily_sharpe)}</td><td>{dec(row.five_session_sharpe)}</td><td>{pct(row.daily_max_drawdown)}</td></tr>; })}
    </tbody></table></div>
    <p><strong>{t("结论不是战胜 SPY。", "This is not a win over SPY. ")}</strong>{t(
      "模型净 CAGR 为 17.40%，略低于 SPY 的 17.54%；日频 Sharpe 0.936 对 1.064，回撤也更大。它明显优于共同池内的 Brain 组合，但“更像老师／优于受限老师”不等于创造了市场之外的净 Alpha。",
      "The model’s net CAGR is 17.40%, slightly below SPY’s 17.54%; daily Sharpe is 0.936 versus 1.064, with a larger drawdown. It beats the common-pool Brain book, but matching or improving on a restricted teacher is not evidence of net alpha over the market."
    )}</p>
    <figure className="report-figure-wrap same-basis-figure"><a href="./same-basis-research.svg" target="_blank" rel="noopener noreferrer"><img src="/reports/brain-stock-ranking/same-basis-research.png" width="1440" height="1160" loading="lazy" alt={t("同口径净值、日频回撤与交易费率敏感性：2 bps 后模型 CAGR 与 Sharpe 均低于 SPY。", "Common-rule NAV, daily drawdown and fee sensitivity: after 2 bps, model CAGR and Sharpe both trail SPY.")} /></a><figcaption>{t("图 3｜只展示估值完整的既定日历窗口。股票和 SPY 供应商不同，复权及会计约定相同；不是经纪商成交或原始发布版本 PIT 认证。点击打开矢量图。", "Figure 3 | Only the predeclared, completely valued calendar window is plotted. Stocks and SPY retain different providers but share normalization/accounting rules. This is not broker fill or original-vintage PIT certification. Click for vector detail.")}</figcaption></figure>
    <div className="report-table-wrap"><table data-research-table="same-basis-fees"><caption>{t("每笔成交金额的费率敏感性；不重新选模型，不把 SPY 人为每周清仓。数值为 CAGR。", "Cost per traded notional; no model reselection or artificial weekly SPY liquidation. Entries are CAGR.")}</caption><thead><tr><th>{t("费率", "Fee")}</th><th>Ridge</th><th>Brain</th><th>SPY</th></tr></thead><tbody>{[0, 2, 5].map(fee => <tr key={fee}><th>{fee} bps</th><td>{pct(window.fees[String(fee)].broad_blend_ridge.cagr)}</td><td>{pct(window.fees[String(fee)].brain_rank5days.cagr)}</td><td>{pct(window.fees[String(fee)].SPY_buy_hold.cagr)}</td></tr>)}</tbody></table></div>
    <h3>{t("公司行动不能用末价续写", "A corporate action is not a last-price fill")}</h3>
    <p>{t(
      "未经修正的严格版本在 2026-08-10 因持有 EA 而阻断。EA 于 8 月 4 日发布收购完成公告，每股现金对价为 $210。永久 SID 的最终两日 QC Adjusted、Alpaca raw 和 adjustment=all 价格完全相同，现金单位无需猜测。保留旧版阻断结果，再以哈希绑定的独立修订单于 8 月 5 日确认现金权利，不计虚构的市场卖出费用。现金在下次 8 月 10 日调仓可再使用，是明确的研究会计假设；公告并不独立证明某经纪商的到账日。它不是末价填补，也不是实盘结算认证。",
      "The uncorrected strict version blocks on 2026-08-10 while holding EA. EA’s August 4 completion announcement establishes $210 cash per share. The permanent SID’s final two QC Adjusted, Alpaca raw and all-adjusted sessions match exactly, so the cash unit is not guessed. Retain the blocked result, then apply a separately hash-bound amendment recognizing the cash entitlement on August 5 without a fictional market-sale fee. Reusability at the August 10 rebalance is an explicit research accounting assumption; the announcement does not independently establish a broker pay date. This is neither last-price filling nor settlement certification."
    )} <a href={audit.company_action_source} target="_blank" rel="noopener noreferrer">{t("EA 官方完成公告", "Official EA completion announcement")}</a></p>
    <h3>{t("全历史仍不能宣称通过", "Full history still does not pass")}</h3>
    <p>{t(
      "完整 489 期中，Brain 首次在 2017-03-13 因 HAR 所需报价缺失而阻断；Ridge 在 2018-01-03 因 BCR 阻断。现金并购、现金加股票／或有权利、换码延续和普通源缺口必须分别查证，不能把终止日期一律当作清零或现金结算。两条股票策略的全期 NAV、CAGR 与风险指标保持空白，不能把成功的近期修正外推到全历史。SPY 本身全期可估值，不能因此补齐策略的缺失收益。",
      "Across all 489 periods, Brain first blocks on HAR’s required quote on 2017-03-13; Ridge blocks on BCR on 2018-01-03. Cash mergers, mixed stock/cash or contingent rights, identity continuity and ordinary source gaps require separate evidence. An archive end is neither zero value nor proven cash settlement. Full-period strategy NAV/CAGR/risk remain blank; a successful recent correction does not certify the full history. SPY’s complete valuation cannot fill the strategies’ missing returns."
    )}</p>
    <p>{t(
      "近期模型相对 SPY 的五日配对收益，用固定四期移动区块、2000 次重抽样得到年化算术超额均值 95% 区间 −14.30% 至 +11.17%，跨过零。这是描述性不确定性，不是经过多重选择校正的显著性检验；它也不是 CAGR 的置信区间。配置先前已在展示的 OOS 上比较过，历史特征版本和准入限制仍在，不能升格为新的独立前瞻成功。28 项针对性测试通过，两次运行的 NAV、交易、缺口与指标逐值一致。",
      "For paired five-session model-minus-SPY returns, fixed four-period moving blocks and 2,000 bootstrap draws give a 95% interval of −14.30% to +11.17% for the annualized arithmetic active mean, spanning zero. This is descriptive uncertainty, not a selection-adjusted significance test or a CAGR confidence interval. Configurations were previously compared on the displayed OOS period; historical feature-vintage/admission limitations remain. It is not a new independent prospective success. All 28 focused tests pass; repeated NAV, trades, gaps and metrics match exactly."
    )}</p>
    <div className="research-downloads"><strong>{t("下载本次同口径核验", "Download the common-rule audit")}</strong><ul>
      <li><a href="./same-basis-metrics.csv" download>{t("两个窗口、三档成本的指标 CSV（未通过项留空）", "Two windows and three costs: metrics CSV (blocked values blank)")}</a></li>
      <li><a href="./same-basis-daily-nav.csv" download>{t("近期逐日净值 CSV，2 bps", "Recent daily NAV CSV, 2 bps")}</a></li>
      <li><a href="./same-basis-summary.json" download>{t("方法、边界与源哈希 JSON", "Methods, boundaries and source hashes JSON")}</a></li>
      <li><a href="./same-basis-research.svg" download>SVG</a> · <a href="./same-basis-research.png" download>PNG</a></li>
    </ul></div>
  </section>;
}
