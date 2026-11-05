import React from "react";

export function DataUpdates({ isZh }) {
  const text = (zh, en) => isZh ? zh : en;
  const rows = [
    ["05:00", text("每天", "Daily"), text("SEC 财报日增量", "SEC daily fundamentals")],
    ["05:15 · 18:15", text("周一至周五", "Mon–Fri"), text("NDX / SPY 成分检测", "NDX / SPY membership checks")],
    ["07:00 · 09:00 · 11:00 · 13:00 · 15:00 · 15:35", text("周一至周五", "Mon–Fri"), text("SEC 盘中增量；必要时直接解析财报内联 XBRL", "SEC intraday refresh; inline XBRL parsing when needed")],
    ["09:10 · 09:25", text("周一至周五", "Mon–Fri"), text("盘前下游 universe 发布", "Pre-open downstream universe publication")],
    ["12:00", text("每天", "Daily"), text("SEC 数据陈旧与积压检查", "SEC freshness and backlog check")],
    [text("每轮结束后约 10 分钟", "About 10 min after each run"), text("持续", "Recurring"), text("成分快照同步至公网归档", "Universe snapshots → public archive")],
    [text("每轮结束后约 5 分钟 / 1 分钟", "About 5 min / 1 min after each run"), text("持续", "Recurring"), text("SEC 事件观察 / 服务健康检查", "SEC event observation / service health checks")],
  ];
  return <div>
    <h1 className="display-title">{text("数据更新时间", "Data update schedule")}</h1>
    <p>{text("以下为 SEC 财报与 NDX/SPX universe 的计划启动时间，统一使用美东时间（America/New_York，自动切换夏令时）。", "Scheduled starts for SEC fundamentals and the NDX/SPX universe. All times use America/New_York and follow daylight saving time.")}</p>
    <p style={{ color: "var(--ink-muted)" }}>{text("计划启动不等于数据已可用；交易所休市、源端延迟、重试及校验可能延后发布。", "A scheduled start is not an availability deadline. Market holidays, source delays, retries and validation may delay publication.")}</p>
    <div style={{ overflowX: "auto" }}><table className="param-table">
      <thead><tr>{[text("时间（ET）", "Time (ET)"), text("频率", "Frequency"), text("任务", "Task")].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map(([time, frequency, task]) => <tr key={task}><td>{time}</td><td>{frequency}</td><td>{task}</td></tr>)}</tbody>
    </table></div>
    <h2>{text("归档与公网查询", "Archive and public access")}</h2>
    <p>{text("SEC 数据自动采集、校验并写入新的 ClickHouse 构建，回读通过后才切换当前版本。公网 API 提供已提交数据查询，需要有效 Token 及对应套餐权限；数据库端口不直接开放公网。", "SEC data is collected, validated and archived automatically into a new ClickHouse build. The current version advances only after readback passes. Public APIs serve committed data with a valid token and the required plan permissions; database ports are not public.")}</p>
    <h2>{text("如何确认数据版本", "Check the data version")}</h2>
    <ul>
      <li><code>/v1/fundamentals/sec/coverage</code> — {text("查看财报 build_id 和覆盖日期。SEC 自爬数据与 Morningstar 归档是不同来源。", "Check the financial build_id and coverage dates. Self-crawled SEC data and the Morningstar archive are distinct sources.")}</li>
      <li><code>/v1/universes/NDX_SPX/snapshots/current</code> — {text("核对 snapshot_id、member_count 和日期；复现实验请改用 /snapshots/{snapshot_id} 固定版本。", "Check snapshot_id, member_count and dates; use /snapshots/{snapshot_id} to pin a version for reproducible research.")}</li>
    </ul>
    <p style={{ color: "var(--ink-muted)" }}>{text("NDX/SPX 合集使用 Nasdaq NDX 成分表与 SPY 股票持仓代理；不是精确 SPX 指数成分声明。新增成员可使用唯一 SEC CIK 标识，不要求新建 QC SID；成分更新不代表该成员所有财报字段已齐全。", "The NDX/SPX union uses Nasdaq NDX constituents and SPY equity holdings as a proxy, not an exact SPX constituent claim. New members may use a unique SEC CIK without a new QC SID. Membership updates do not establish complete financial-field coverage.")}</p>
    <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>{text("调度核对日期：2026-11-05。", "Schedule verified: 2026-11-05.")}</p>
  </div>;
}
