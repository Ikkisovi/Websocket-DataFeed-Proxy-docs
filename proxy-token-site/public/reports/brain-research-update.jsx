import React from "react";
import results from "./brain-stock-ranking/task2-summary.json";
import { BrainSameBasisUpdate } from "./brain-same-basis-update.jsx";

const ic = value => `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
const decimal = value => value.toFixed(3);

export function BrainResearchUpdate({ t }) {
  const best = results.top_configs_by_ic5[0];
  const direct = results.best_direct_return;
  const yahoo = results.yahoo_source_diagnostics;
  return <section className="research-update" aria-labelledby="return-experiment">
    <BrainSameBasisUpdate t={t} />
    <h2 id="expanded-reconstruction">{t("扩展实验一：还原排名，不等于还原收益", "Extension 1: recovering rankings is not recovering returns")}</h2>
    <p>{t(
      "15 个特征只是最初的基线。后续我们重建了 44 个日频技术变量，加入基本面及其时间字段，再与原有价量特征合并。扩展窗口实验从至少 500 个交易日开始训练，每 126 个交易日重新拟合，20 个时点分别预测下一段从未参与该次拟合的数据。对 Brain 排名的日均相关提升至 0.8565，但这仍是老师分数的拟合，不是未来收益的预测准确率。",
      "The 15-feature model was only the starting baseline. We reconstructed 44 daily technical variables, added fundamentals and their clock fields, and combined them with the existing price/volume block. An expanding window starts with at least 500 sessions, refits every 126 sessions and predicts the following unseen block at each of 20 refits. Mean daily correlation with Brain rises to 0.8565. That measures teacher-score reconstruction, not forward-return accuracy."
    )}</p>
    <div className="report-table-wrap"><table data-research-table="teacher"><caption>{t("目标为 Brain 排名；2016-12-27 至 2026-09-28，2339 个可评分日期。不同于下文收益实验的日期与掩码。", "Target: Brain rank; 2,339 scoreable dates, 2016-12-27 to 2026-09-28. Dates and masks differ from the return experiment below.")}</caption><thead><tr><th>{t("模型 / 特征组", "Model / feature set")}</th><th>{t("特征数", "Features")}</th><th>{t("与 Brain 的日均秩相关", "Mean rank correlation with Brain")}</th></tr></thead><tbody>
      {results.teacher_reconstruction.rows.map(row => <tr key={row.model}><th><code>{row.model}</code></th><td>{row.feature_count}</td><td>{row.ic_brain.toFixed(4)}</td></tr>)}
    </tbody></table></div>
    <p>{t(
      "pool 是 90 个原始价量 / 基本面时间字段；both 是 44 个技术变量加 28 个基本面字段；all 是两者并集（134 个）。同样使用 all 时，线性 Ridge 的 0.7723 低于 HGB 的 0.8565，说明函数形式也影响拟合。它不能证明这些输入就是供应商的全部输入，更不能证明未解释部分都是 Alpha。基本面的历史发布版本尚未独立认证。",
      "pool contains 90 price/volume and fundamental-clock fields; both combines 44 technical variables with 28 fundamental fields; all is the 134-feature union. With the same all set, linear Ridge reaches 0.7723 versus HGB’s 0.8565: function class matters too. This neither identifies all vendor inputs nor establishes the unexplained component as alpha. Historical fundamental publication vintages remain unverified."
    )}</p>

    <h2 id="return-experiment">{t("扩展实验二：直接检验未来收益", "Extension 2: evaluate against future returns")}</h2>
    <p>{t(
      "第二个任务不再把接近 Brain 当作胜负标准。我们比较 34 组特征、标签和模型配置，以未来 5、21、63 个交易日的收益秩相关（IC）评估信号。Brain 只作为一个可选的训练老师；ret5 / ret21 / ret63 直接使用未来收益，blend 对可用的 Brain、5 日收益、21 日收益截面排名取平均。特征 broad 包含 351 列，是这轮最宽的候选组。",
      "The second task no longer rewards similarity to Brain. We compare 34 feature/label/model configurations against realized 5-, 21- and 63-session return rank IC. Brain is an optional training teacher; ret5 / ret21 / ret63 use returns directly, while blend averages the available cross-sectional Brain, 5-day-return and 21-day-return ranks. The broad set contains 351 columns, the widest candidate block in this experiment."
    )}</p>
    <ol className="research-protocol">
      <li>{t("按交易日索引建模，而非自然日步长。仍使用扩展训练窗口、126 日重拟合和 20 个拟合时点；本轮 Ridge alpha=3，HGB 为 300 轮、最多 63 叶、学习率 0.08、叶节点最少 200 个样本、L2=1，不启用提前停止，随机种子为 0。", "Use observed-session indexing, not a calendar-day stride. Retain expanding training, 126-session refits and 20 refit boundaries; this grid uses Ridge alpha=3 and HGB with 300 iterations, at most 63 leaves, learning rate 0.08, minimum 200 samples/leaf, L2=1, no early stopping and seed 0.")}</li>
      <li>{t("输入逐日截面排名；本轮允许部分特征缺失：Ridge 将缺失排名置为中性值，HGB 保留 NaN。这与前文 15 特征的共同完整观测实验不是同一缺失值策略。", "Rank inputs within each date. This grid allows partial feature gaps: Ridge uses neutral missing ranks; HGB retains NaN. This is not the complete-case policy of the original 15-feature experiment.")}</li>
      <li>{t("若预测区块从 b 开始，h 日收益标签只允许使用满足 r+1+h ≤ b−1 的训练行 r。即入场和出场价格都必须在预测区块开始前已可观察；blend 按最长 21 日分量清除重叠。", "For a prediction block starting at b, admit an h-session training label only if r+1+h ≤ b−1. Both its entry and exit prices must precede the prediction block; blend purges against its longest, 21-session component.")}</li>
      <li>{t("IC 在当日信号和对应未来价格共同有限的证券上计算，每日平均，不将重叠的 21 / 63 日标签视为独立观测。收益定义为 close[r+1+h] / close[r+1] − 1。", "Compute each date’s IC on jointly finite signal/return pairs and average over dates. Overlapping 21-/63-session labels are not independent observations. Returns are close[r+1+h] / close[r+1] − 1.")}</li>
    </ol>
    <aside className="story-note research-warning"><strong>{t("OOS 不等于从未看过的最终测试集", "OOS does not mean an untouched final test")}</strong><p>{t(
      "每个时点的模型没有拟合该时点的未来标签，但 34 个配置是在这段已展示的 OOS 上比较、挑选的，并非嵌套模型选择或预注册的前瞻检验。特征覆盖率筛选也使用了完整面板，而非每个训练窗口内重新准入。经追溯，价格标签来自内部特征语料的 QC 拆分／现金分红复权 close，而非未复权价格；这里更正此前的原价描述。来源时钟、历史版本与可执行公司行为账务仍需分别验证。下列 IC 是既有标签上的探索性结果，不是已认证的可投资收益预测。",
      "Each dated model excludes its future labels, but the 34 configurations were compared and selected on the displayed OOS period, not through nested selection or a preregistered prospective test. Feature-coverage admission also used the full panel rather than each training window alone. The traced return labels use the internal corpus’s QC split/cash-dividend Adjusted close, not raw unadjusted prices; this corrects the earlier raw-close description. Source clocks, vintages and executable corporate-action accounting remain separate checks. The ICs below are exploratory on those labels, not certified investable-return predictions."
    )}</p></aside>

    <h3 id="label-purge">{t("先修正一个足以改变结论的标签穿越", "First fix a label-boundary leak that changes the conclusion")}</h3>
    <p>{t(
      "最初仅按特征行的日期切分训练集，没有检查未来收益标签的终点。长周期标签因此会跨入预测区块。固定 fund / HGB，仅切换严格 purge 后，ret63 的 IC5 从 +0.0764 降至 +0.0028；ret21 从 +0.0317 降至 +0.0015。这个消融否定了先前“长收益标签特别强”的解读。",
      "The first split checked feature-row dates but not forward-label endpoints, allowing long-horizon labels into the prediction block. Holding fund / HGB fixed and enabling strict purge reduces ret63’s IC5 from +0.0764 to +0.0028 and ret21 from +0.0317 to +0.0015. This ablation rejects the earlier interpretation that long-return training labels were unusually powerful."
    )}</p>
    <div className="report-table-wrap"><table data-research-table="purge"><caption>{t("同一 fund / HGB 配置，结果指标均为 IC5；未 purge 的数值仅保留为错误机制对照。", "Same fund / HGB configuration; outcome is IC5 in every row. Unpurged numbers are retained only as a failure-mechanism control.")}</caption><thead><tr><th>{t("训练目标", "Training label")}</th><th>{t("未 purge", "Unpurged")}</th><th>{t("严格 purge", "Strict purge")}</th></tr></thead><tbody>
      {results.purge_ablation.map(row => <tr key={row.target}><th><code>{row.target}</code></th><td>{ic(row.unpurged)}</td><td>{ic(row.purged)}</td></tr>)}
    </tbody></table></div>

    <h3>{t("排名靠前的是一片平台，不是唯一冠军", "The leading configurations form a plateau, not a unique winner")}</h3>
    <p>{t(
      `purge 后，IC5 最好的 ${best.features} / ${best.target} / ${best.model} 为 ${ic(best.ic5)}，IC21 ${ic(best.ic21)}，IC63 ${ic(best.ic63)}。前十组的 IC5 在 +0.0188 到 +0.0217 之间。完全不用 Brain 标签的最佳配置 ${direct.features} / ${direct.target} / ${direct.model} 为 ${ic(direct.ic5)}：老师仍贡献了很大一部分表现，不能把蒸馏得到的优势称作独立发现了同样多的新信息。`,
      `After purge, the IC5 leader ${best.features} / ${best.target} / ${best.model} reaches ${ic(best.ic5)}, with IC21 ${ic(best.ic21)} and IC63 ${ic(best.ic63)}. The top ten IC5s span +0.0188 to +0.0217. The best configuration with no Brain label, ${direct.features} / ${direct.target} / ${direct.model}, reaches ${ic(direct.ic5)}. The teacher remains a material contributor; distillation is not evidence that an equal amount of independent new information was discovered.`
    )}</p>
    <div className="report-table-wrap"><table data-research-table="configurations"><caption>{t("按探索期 IC5 排列的前十组；未来收益价格口径为内部 corpus close，不是下图 Yahoo 价格。全部 34 组可下载。", "Top ten by exploratory IC5; return-price definition is internal corpus close, not the Yahoo prices in the figure. All 34 configurations are downloadable.")}</caption><thead><tr><th>{t("特征 / 标签 / 模型", "Features / label / model")}</th><th>IC5</th><th>IC21</th><th>IC63</th></tr></thead><tbody>
      {results.top_configs_by_ic5.map(row => <tr key={`${row.features}-${row.target}-${row.model}`}><th><code>{row.features} / {row.target} / {row.model}</code></th><td>{ic(row.ic5)}</td><td>{ic(row.ic21)}</td><td>{ic(row.ic63)}</td></tr>)}
    </tbody></table></div>

    <h3 id="source-price-nav">{t("净值重估：先选股，再检查未来价格", "Revalue NAV: select first, then inspect future prices")}</h3>
    <p>{t(
      "必须把两个价源分开。原 34 组组合曲线用的是内部语料 close，并在选 Top50 之前过滤未来收益不可用的证券，含有前视筛选；没有计费。我们不再把那些曲线称为可执行回测。本次单独重导出 IC5 领先模型的样本外预测，再用已缓存的 Yahoo 价格按信号日 t 选 Top50，t+1 收盘入场、t+6 收盘退出，分配每名 1/50。入场无价保留现金，不以较低排名补位；持仓退出无价则使当期及其后的完整累计净值失效。",
      "Keep the two price sources separate. The original 34-book curves used internal corpus close and filtered future-return availability before choosing Top50: a look-ahead selection error, without fees. They are no longer presented as executable backtests. We re-exported the IC5 leader’s OOS predictions, chose Top50 on signal date t before checking Yahoo prices, entered at close[t+1], exited at close[t+6], and allocated 1/50 per intended name. Missing entries remain cash, without substitution; an unpriced exit invalidates the period and subsequent full cumulative NAV."
    )}</p>
    <p>{t(
      "研究池也不能混淆：预测期间平均约 525 只有效证券 / 日（517–535），累计 780 个身份，不是固定 524 只，更不是官方约千只的全池。固定五交易日步长也不等同于官方固定星期的周调仓。图 A 比较相同窗口下的候选信号、受限交集内的 Brain 排名与 SPY 价格参考；没有跨股票池拼接官方等权基准。",
      "The prediction pool averages about 525 scoreable names/day (517–535), across 780 historical identities. It is neither a fixed 524-name pool nor the roughly thousand-name official universe. A five-session stride is also not identical to fixed-weekday weekly rebalancing. Panel A compares the candidate, Brain on restricted support and a same-window SPY price reference, without importing the official equal-weight benchmark from a different universe."
    )}</p>
    <figure className="report-figure-wrap research-main-figure">
      <a href="./task2-research.svg" target="_blank" rel="noopener noreferrer" aria-label={t("打开研究图的矢量大图", "Open full vector research figure")}><img src="/reports/brain-stock-ranking/task2-research.png" width="1440" height="1160" loading="lazy" alt={t("三联图：假设 ticker 连续的 Yahoo 诊断净值、多期限收益 IC，以及标签 purge 消融。正式净值不予报告。", "Three panels: Yahoo NAV conditional on static ticker continuity, multi-horizon return IC, and label-purge ablation. Formal NAV is withheld.")} /></a>
      <figcaption>{t(
        "图 2｜A：下一交易日入场的源价格诊断，不是执行认证，未计费用，假设历史 ticker 身份连续；B：相同模型在 5 / 21 / 63 日标签上的 IC，标签重叠且价格口径不同于 A；C：固定 fund / HGB 的 purge 消融。点击可查看矢量大图。",
        "Figure 2 | A: next-session-entry source-price diagnostic, not execution certification; no fees and static historical ticker continuity assumed. B: the same models’ ICs on overlapping 5 / 21 / 63-day labels, using a different price definition from A. C: purge ablation holding fund / HGB fixed. Click for the full vector figure."
      )}</figcaption>
    </figure>
    <div className="report-table-wrap"><table data-research-table="yahoo"><caption>{t("489 个五交易日持有区间；2016-12-28 入场至 2026-09-22 退出。下表的 NAV / Sharpe 仅在 ticker 连续假设下成立，均为毛值。Sharpe：区间均值 / 样本标准差 × √(252/5)，无风险利率设 0。", "489 five-session holding intervals; first entry 2016-12-28, final exit 2026-09-22. NAV / Sharpe are gross and conditional on ticker continuity only. Sharpe: period mean / sample standard deviation × √(252/5), zero risk-free rate.")}</caption><thead><tr><th>{t("源价格对照", "Source-price comparison")}</th><th>{t("条件终值", "Conditional terminal NAV")}</th><th>{t("条件 Sharpe", "Conditional Sharpe")}</th><th>{t("正式全期净值", "Formal full-period NAV")}</th></tr></thead><tbody>
      {[["broad_blend_ridge", "broad / blend / ridge"], ["brain_restricted", t("交集内 Brain Top50", "Restricted Brain Top50")], ["spy_reference", t("SPY 价格参考", "SPY price reference")]].map(([key, label]) => <tr key={key}><th>{label}</th><td>{yahoo[key].conditional_terminal_nav.toFixed(2)}×</td><td>{decimal(yahoo[key].conditional_sharpe)}</td><td>{t("不予报告", "Withheld")}</td></tr>)}
    </tbody></table></div>
    <p>{t(
      "候选终值 4.16×，略高于 SPY 的 4.01×，但 Sharpe 0.836 低于 SPY 的 0.899，且尚未扣费，不能宣称风险调整后胜出。更重要的是：历史 SID 对静态 ticker 的重复映射仍未解决，候选的 423 / 489 个区间涉及这种身份不确定性；图中是明确带假设的价格诊断，不是已经完成身份准入的收益。受限等权组合另有一个真实退出价格缺口，完整净值留空，不删掉该期、不填成零损失。Yahoo 复权版本及公司行动也没有独立认证。",
      "The candidate ends at 4.16× versus SPY’s 4.01×, but its 0.836 Sharpe trails SPY’s 0.899 before costs: this is not risk-adjusted outperformance. More importantly, duplicate historical SID-to-static-ticker mappings remain unresolved in 423 / 489 candidate periods. The figure is explicitly conditional source-price arithmetic, not identity-admitted performance. The restricted equal-weight book also has one actual missing exit quote: full NAV is left blank, not repaired by deleting the period or assigning zero loss. Yahoo adjustment vintages and corporate actions are not independently admitted either."
    )}</p>

    <h3 id="temporal-stability">{t("跨时期能否维持？先看市场中性的一侧", "Does it persist? Inspect the market-neutral side")}</h3>
    <p>{t(
      "下表保留原 34 组内部价格组合的时间稳定性诊断，不与 Yahoo 曲线混用，也不作为交易准入。全期多头 Sharpe 的中位数高于同池 Brain；2024-07 之后，这个差距更大，但多空 Sharpe 中位数几乎降到零。这与多头选股 / 市场暴露解释相容，却没有证明纯 Alpha 持续，也没有做正式 beta 归因。",
      "The table retains time-stability diagnostics from the original 34 internal-price books, not the Yahoo chart and not a trading-admission result. Median long-only Sharpe exceeds same-pool Brain, especially after July 2024, while median long-short Sharpe nearly vanishes. That is consistent with long-leg selection or market exposure, not proof of persistent pure alpha or a formal beta attribution."
    )}</p>
    <div className="report-table-wrap"><table data-research-table="stability"><caption>{t("旧组合含未来价格可用性筛选，仅诊断。LO：多头；LS：多空。2024-07+ 是日历子窗口，不代表数据已清洁认证。", "Legacy books contain future-price availability filtering; diagnostic only. LO: long-only; LS: long-short. 2024-07+ is a calendar subwindow, not clean-data certification.")}</caption><thead><tr><th>{t("窗口", "Window")}</th><th>{t("期数", "Periods")}</th><th>Brain LO</th><th>{t("模型中位 LO", "Median model LO")}</th><th>Brain LS</th><th>{t("模型中位 LS", "Median model LS")}</th></tr></thead><tbody>
      {results.windows_diagnostic_only.map((row, i) => <tr key={row.name}><th>{i === 0 ? t("全期", "Full period") : "2024-07+"}</th><td>{row.n}</td><td>{decimal(row.brain_lo)}</td><td>{decimal(row.median_lo)}</td><td>{decimal(row.brain_ls)}</td><td>{decimal(row.median_ls)}</td></tr>)}
    </tbody></table></div>
    <p>{t(
      "按年度汇总，模型中位数在 10 个年份中的 8 年高于同池 Brain，多空并未同步稳定。即使暂按独立同分布的年度正负号作粗略双侧检验，p=0.1094；考虑配置选择、年度依赖和 2026 部分年度，证据只会更有限。我们不据此声称统计显著，也不会把 IC21 / IC63 较高当成三个独立的成功实验。",
      "The median model beats same-pool Brain in 8 of 10 annual summaries, without equally stable long-short performance. Even a rough two-sided sign test assuming iid annual signs gives p=0.1094. Configuration selection, dependence and partial-year 2026 further limit interpretation. We make no significance claim and do not count higher IC21 / IC63 as three independent successful experiments."
    )}</p>

    <h3>{t("这轮实验留下的结论", "What this experiment actually establishes")}</h3>
    <p>{t(
      "常见特征加非线性模型能较强地还原 Brain 排名；严格清除跨区块未来标签后，仍有正的探索性收益 IC，而长标签的夸张优势消失；老师蒸馏仍是重要来源。到“可交易增量”还差三个关键环节：PIT 特征与身份、独立准入的执行价格 / 公司行动，以及冻结模型选择后的成本与前瞻检验。正式净值没有通过就保持空白，而不是让一条好看的图代替这些证据。",
      "Ordinary features plus a nonlinear model reconstruct much of Brain’s ordering. Positive exploratory return IC survives strict boundary purging, while the spectacular long-label advantage disappears; teacher distillation remains important. Tradable incremental value still requires PIT features/identities, independently admitted execution prices/corporate actions, and cost-aware prospective evaluation after freezing selection. Where formal NAV fails admission, it stays blank rather than letting an attractive chart replace the missing evidence."
    )}</p>
    <div className="research-downloads"><strong>{t("复查这轮实验", "Inspect this experiment")}</strong><ul>
      <li><a href="./task2-configurations.csv" download>{t("34 组配置：IC 与原组合诊断 CSV", "34 configurations: IC and legacy-book diagnostics CSV")}</a></li>
      <li><a href="./yahoo-conditional-nav.csv" download>{t("逐期 Yahoo 条件净值 CSV（缺口保留为空）", "Period-by-period conditional Yahoo NAV CSV (gaps stay blank)")}</a></li>
      <li><a href="./task2-summary.json" download>{t("方法摘要、子窗口结果与输入文件哈希 JSON", "Methods, subwindow results and publication-input hashes JSON")}</a></li>
      <li><a href="./task2-research.svg" download>{t("矢量研究图 SVG", "Vector research figure SVG")}</a> · <a href="./task2-research.png" download>{t("高分辨率 PNG", "High-resolution PNG")}</a></li>
    </ul><p className="research-footnote">{t("哈希绑定本次出版使用的已保存文件，不补造旧运行的执行身份；原始行情、SID 级预测和大规模训练产物未打包进站点。", "Hashes bind the saved inputs used for this publication, not retroactive execution identity. Raw prices, SID-level predictions and bulk training artifacts are not bundled into the site.")}</p></div>
  </section>;
}
