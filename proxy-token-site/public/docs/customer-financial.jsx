import React from "react";
import { DocContent } from "./doc-components.jsx";
import { DOC_PATHS, docArticlePath } from "./doc-navigation.mjs";

const EXAMPLE_VERSION = "ca3a6c3e75980b9a66f9d71e250b37258e6713b1839e47dbdfde3163bdbc3bdd";
const PREMIUM_EN = "Included with your active Premium account: Morningstar fundamentals, EODHD company events and universe member lists. Use your existing token. No extra purchase or new token is needed.";
const PREMIUM_ZH = "有效 Premium 账户已包含 Morningstar 基本面、EODHD 公司事件和 universe 股票名单。沿用现有 token 即可，无需额外购买或新建 token。";
function Premium({ isZh }) { return <p className="callout">{isZh ? PREMIUM_ZH : PREMIUM_EN}</p>; }
function Fields({ isZh, rows }) {
  return <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>{isZh ? "字段" : "Field"}</th><th>{isZh ? "怎么用" : "How to use it"}</th></tr></thead><tbody>{rows.map(([key, en, zh]) => <tr key={key}><td><code style={{ overflowWrap: "anywhere", whiteSpace: "normal" }}>{key}</code></td><td>{isZh ? zh : en}</td></tr>)}</tbody></table></div>;
}
const auth = '-H "Authorization: Bearer <YOUR_PREMIUM_TOKEN>"';

export function UniverseCustomerBody({ articleId, isZh }) {
  const t = (en, zh) => isZh ? zh : en;
  return <DocContent articleId={articleId} data-no-i18n="true" style={{ maxWidth: 860 }}>
    <h2 id="universe-overview" className="display-title">{t("Universe member lists", "Universe 股票名单")}</h2>
    <Premium isZh={isZh} />
    <p>{t("Get the stocks in a supported universe, with their symbols, security IDs and a version you can save. NDX_SPX is currently available.", "查询支持的 universe 包含哪些股票，获取股票代码、证券 ID 和可保存的版本。目前可查 NDX_SPX。")}</p>
    <div className="card" style={{ padding: 20, margin: "20px 0" }}>
      <strong>{t("What this list covers", "这份名单覆盖什么")}</strong>
      <p>{t("NDX_SPX currently combines SPY and QQQ holdings as an approximation of the S&P 500 and Nasdaq-100. It can differ from the official index lists.", "NDX_SPX 目前合并 SPY、QQQ 的持仓，近似标普 500 和纳斯达克 100；它和指数官方名单可能不同。")}</p>
      <p>{t("The October 20, 2026 example has 519 stocks. The count can change. Only one saved NDX_SPX version was available on that date. History reads saved versions; it does not provide a member list for any date you choose.", "2026 年 10 月 20 日的示例包含 519 只股票，数量会变化。当时仅有一份已保存的 NDX_SPX 版本。历史查询只能读取已保存版本，不能任选日期获取当日名单。")}</p>
    </div>
    <h3>{t("Useful response fields", "值得保存的字段")}</h3>
    <Fields isZh={isZh} rows={[
      ["universe_id", "Which list you requested, such as NDX_SPX.", "请求的名单，例如 NDX_SPX。"],
      ["snapshot_id", "The version of this list. Save it to read the same version again.", "这份名单的版本；保存它，以后可以读回同一版本。"],
      ["member_count / members", "How many stocks the list contains, and the stocks themselves.", "股票数量和完整股票列表。"],
      ["members[].symbol.id / value", "The security ID and display symbol. Keep the ID as well as the ticker, since tickers can change.", "证券 ID 和显示代码。代码可能变更，保存时请同时保留 ID。"],
      ["membership_kind / is_index_exact", "How the list was formed. etf_proxy and false mean ETF holdings are used as an approximation.", "名单来源；etf_proxy 和 false 表示使用 ETF 持仓近似指数。"],
      ["time / end_time / observed_at_utc", "The list's time range and when it was recorded. These do not tell you the latest available financial or event date.", "名单对应的时间范围及记录时间，不能据此判断基本面或事件数据更新到了哪一天。"],
    ]} />
    <h3>{t("A short example", "简短示例")}</h3>
    <p>{t("Selected fields from the October 20 example, showing one stock. The actual members array contains the full list.", "以下节选自 10 月 20 日的示例，只展示一只股票；实际 members 数组包含完整名单。")}</p>
    <pre className="code">{JSON.stringify({universe_id:"NDX_SPX",snapshot_id:EXAMPLE_VERSION,member_count:519,membership_kind:"etf_proxy",is_index_exact:false,members:[{symbol:{id:"AAPL R735QTJ8XC9X",value:"AAPL"}}]},null,2)}</pre>
    <p><a href={docArticlePath("universes", "universe-read")}>{t("Get and save a member list →", "查询与保存名单 →")}</a></p>

    <h2 id="universe-read" className="display-title">{t("Get and save a member list", "查询与保存名单")}</h2>
    {articleId && <Premium isZh={isZh} />}
    <h3>{t("1. Get the latest available list", "1. 获取最新可用名单")}</h3>
    <p>{t("Replace the token placeholder with your existing token. This saves the response to universe.json and the headers to headers.txt.", "将 token 占位符换成现有 token。下面会把名单保存为 universe.json，响应头保存为 headers.txt。")}</p>
    <pre className="code">{`curl --fail-with-body \\
  "https://api.leandata.uk/v1/universes/NDX_SPX/snapshots/current" \\
  ${auth} \\
  -D headers.txt -o universe.json`}</pre>
    <h3>{t("2. Keep the version for later", "2. 保存版本，方便以后重读")}</h3>
    <p>{t("Keep the JSON file and its snapshot_id. To read that same version later, replace <SNAPSHOT_ID> below with the returned value. A saved older version can still be read when current is too old.", "保留 JSON 文件和其中的 snapshot_id。以后要读回同一版本，把下面的 <SNAPSHOT_ID> 换成返回值。即使 current 已过期，仍可以按已保存的 ID 读取旧版本。")}</p>
    <pre className="code">{`curl --fail-with-body \\
  "https://api.leandata.uk/v1/universes/NDX_SPX/snapshots/<SNAPSHOT_ID>" \\
  ${auth}`}</pre>
    <p>{t("These two shortcuts return the same NDX_SPX member list. They do not list every stock that has financial or event data.", "下面两个便捷地址返回同一份 NDX_SPX 名单。这份股票名单不代表这些数据接口有记录的全部股票。")}</p>
    <pre className="code">{`GET https://api.leandata.uk/v1/fundamentals/morningstar/universe/current
GET https://api.leandata.uk/v1/events/eodhd/universe/current`}</pre>
    <p>{t("All four routes use GET. The shortcuts accept only optional universe_id=NDX_SPX. The other routes accept no query parameters. There is no date or version-list endpoint. NDX and SPX inside this combined list are not separately available lists in this release.", "以上四条路由均使用 GET。两个便捷地址仅可选传 universe_id=NDX_SPX，其余路由不接受查询参数。目前没有按日期查询或列出所有版本的接口，也不能将组合名单内的 NDX、SPX 单独作为名单读取。")}</p>
    <h3>{t("Check whether the list changed", "检查名单是否变化")}</h3>
    <p>{t("Save the ETag from the response headers. Send it back as If-None-Match on your next request, keeping the quotes. A 304 response means you can reuse your saved file; it has no new response body. current uses Cache-Control: no-cache, so check before reusing it.", "保存响应头里的 ETag，下次请求通过 If-None-Match 原样传回，保留引号。返回 304 时可继续使用保存的文件，没有新的正文。current 的 Cache-Control 为 no-cache，复用前应重新检查。")}</p>
    <pre className="code">{`curl --include \\
  "https://api.leandata.uk/v1/universes/NDX_SPX/snapshots/current" \\
  ${auth} \\
  -H 'If-None-Match: "<PREVIOUS_ETAG>"'`}</pre>
    <h3>{t("If you cannot get a list", "拿不到名单时怎么办")}</h3>
    <Fields isZh={isZh} rows={[
      ["400", "Remove unsupported or repeated parameters.", "移除不支持或重复的参数。"],
      ["401 / 403", "Check that the token is valid and the account has active Premium access.", "检查 token 是否有效，以及账户的 Premium 是否仍有效。"],
      ["503", "No usable list is available, current is too old, or the service is temporarily unavailable. Retry later or read a version you already saved. Do not treat this as an empty list.", "暂时没有可用名单、current 已过期，或服务暂时不可用。稍后重试，或读取已保存版本；不要把错误当成空名单。"],
    ]} />
    <p>{t("current requires its recorded time and all list/component end times to be within the last 96 hours, including weekends, and not in the future. Financial and event dates should be checked through each source's coverage endpoint.", "current 的记录时间以及名单和各组成部分的结束时间都须在最近 96 小时内（含周末），且不能是未来时间。基本面和事件数据的可用日期，请分别查看各自的 coverage 接口。")}</p>
    <p><a href={DOC_PATHS.financialMorningstar}>Morningstar</a>{" · "}<a href={DOC_PATHS.financialEodhd}>EODHD</a></p>
  </DocContent>;
}

export function MorningstarCustomerBody({ articleId, isZh }) {
  const t = (en, zh) => isZh ? zh : en;
  return <DocContent articleId={articleId} data-no-i18n="true" style={{ maxWidth: 860 }}>
    <h2 id="morningstar-overview" className="display-title">{t("Morningstar fundamentals", "Morningstar 基本面")}</h2>
    <Premium isZh={isZh} />
    <p>{t("Look up daily company fundamentals such as revenue, net income, cash flow and valuation metrics. Start with available dates, then request the stocks and fields you need.", "查询公司每天可用的营收、净利润、现金流和估值等基本面指标。先查看可用日期，再选择股票和需要的字段。")}</p>
    <p><a href={docArticlePath("financial-morningstar", "morningstar-daily-history")}>{t("Query daily fundamentals →", "查询日度基本面 →")}</a>{" · "}<a href={docArticlePath("financial-morningstar", "morningstar-daily-coverage")}>{t("Check available dates →", "查看可用日期 →")}</a></p>
    <p>{t("The universe member list can help you choose stocks. It does not guarantee that every stock has data on every date, and its date is not Morningstar's latest data date.", "Universe 名单可用于选择股票，但不保证每只股票在每一天都有基本面数据；名单日期也不是 Morningstar 的最新数据日期。")}</p>
    <p><a href={DOC_PATHS.universes}>{t("About universe member lists →", "了解 universe 股票名单 →")}</a></p>

    <h2 id="morningstar-daily-history" className="display-title">{t("Query daily fundamentals", "查询日度基本面")}</h2>
    {articleId && <Premium isZh={isZh} />}
    <p>{t("Use GET /v1/fundamentals/morningstar/daily/history. The example asks for three fields for AAPL. Replace the dates with dates available in coverage.", "使用 GET /v1/fundamentals/morningstar/daily/history。下面查询 AAPL 的三项指标；使用时请换成 coverage 中可用的日期。")}</p>
    <pre className="code">{`curl --get "https://api.leandata.uk/v1/fundamentals/morningstar/daily/history" \\
  ${auth} \\
  --data-urlencode "symbols=AAPL" \\
  --data-urlencode "start=2026-10-15" \\
  --data-urlencode "end=2026-10-15" \\
  --data-urlencode "fields=market_cap,total_revenue,net_income"`}</pre>
    <Fields isZh={isZh} rows={[
      ["symbols / sids", "Select up to 100 tickers or security IDs. Use sids if a ticker is ambiguous.", "最多选择 100 个股票代码或证券 ID；代码有歧义时使用 sids。"],
      ["start / end", "Inclusive YYYY-MM-DD dates. Without a stock filter, request at most seven days.", "包含起止日期，格式 YYYY-MM-DD；不筛选股票时，最多查询七天。"],
      ["fields / limit", "Comma-separated fields; omit fields for all available fields. Up to 500 rows per page.", "fields 用逗号分隔；省略则返回全部字段。每页最多 500 行。"],
      ["rows[].date / symbol / qc_sid", "The data date, display symbol and security ID.", "数据日期、显示代码和证券 ID。"],
      ["rows[].values", "Requested values keyed by field name. null means unavailable, not zero.", "按字段名返回指标值。null 表示缺失，不是零。"],
      ["snapshot / next_offset / truncated", "When truncated is true, send snapshot and next_offset as offset for the next page, keeping the same filters and dates.", "truncated 为 true 时，将 snapshot 和 next_offset（作为 offset）传回获取下一页，筛选条件及日期保持不变。"],
    ]} />
    <p>{t("Keep the original response, dates and security IDs with any saved results. The snapshot value keeps pagination on the same selection; it is different from a universe snapshot_id.", "保存结果时，一并保留原始响应、日期和证券 ID。这里的 snapshot 用于固定分页结果，与 universe 的 snapshot_id 不同。")}</p>

    <h2 id="morningstar-daily-coverage" className="display-title">{t("Available dates and missing data", "可用日期与缺失数据")}</h2>
    <pre className="code">{`curl "https://api.leandata.uk/v1/fundamentals/morningstar/daily/coverage" \\
  ${auth}`}</pre>
    <p>{t("Use this response to find available dates and stocks before requesting history. Morningstar has its own date range; do not copy the latest date from EODHD or a universe member list.", "先用这个接口查看可用日期和股票，再查询历史。Morningstar 有自己的日期范围，不能直接套用 EODHD 或 universe 名单的最新日期。")}</p>
    <p>{t("An empty result means no rows matched your selection. Check the dates and stock ID. Leave missing dates and null values as missing. For 401 or 403, check your existing token and Premium validity; for a temporary service error, retry later.", "结果为空表示所选范围没有匹配记录，请检查日期和股票 ID。缺失日期和 null 值应保持缺失。遇到 401 或 403，检查现有 token 和 Premium 有效期；服务暂时出错时稍后重试。")}</p>
  </DocContent>;
}

export function EodhdCustomerBody({ articleId, isZh }) {
  const t = (en, zh) => isZh ? zh : en;
  return <DocContent articleId={articleId} data-no-i18n="true" style={{ maxWidth: 860 }}>
    <h2 id="eodhd-overview" className="display-title">{t("Earnings, dividends and splits", "财报、分红与拆股")}</h2>
    <Premium isZh={isZh} />
    <p>{t("Query recorded upcoming earnings, dividend and split events. For revenue, profit and other financial statement values, use Morningstar instead.", "查询已收录的近期财报、分红和拆股事件。营收、利润等财报数值请使用 Morningstar。")}</p>
    <p>{t("Event results can include stocks outside the universe member list. Filter by the stocks you need. This feed is not a complete calendar of every announced future event, and dates can change.", "事件结果也可能包含 universe 名单外的股票，请按关心的股票筛选。这不是所有已公告未来事件的完整日历，事件日期也可能调整。")}</p>
    <p><a href={docArticlePath("financial-eodhd", "eodhd-history")}>{t("Find company events →", "查询公司事件 →")}</a>{" · "}<a href={DOC_PATHS.universes}>{t("Universe member lists", "Universe 股票名单")}</a></p>

    <h2 id="eodhd-history" className="display-title">{t("Find company events", "查询公司事件")}</h2>
    {articleId && <Premium isZh={isZh} />}
    <p>{t("First check coverage for a date. Then call GET /v1/events/eodhd/history. start and end select the dates of the saved calendar updates, not the event dates. Replace the example date with an available date.", "先通过 coverage 找到可用日期，再调用 GET /v1/events/eodhd/history。start、end 筛选的是所保存日历的更新日期，不是事件日期。请将示例日期换成可用日期。")}</p>
    <pre className="code">{`curl --get "https://api.leandata.uk/v1/events/eodhd/history" \\
  ${auth} \\
  --data-urlencode "dataset=earnings" \\
  --data-urlencode "symbols=AAPL,MSFT" \\
  --data-urlencode "start=2026-10-14" \\
  --data-urlencode "end=2026-10-14"`}</pre>
    <p>{t("dataset can be earnings (default), dividends or splits. symbols accepts up to 100 comma-separated tickers. Without symbols, request at most seven days. limit is at most 500. When truncated is true, pass the returned snapshot and next_offset as offset for the next page, keeping other parameters unchanged.", "dataset 可选 earnings（默认）、dividends 或 splits。symbols 用逗号分隔，最多 100 只；不指定股票时，最多查七天。limit 最大为 500。truncated 为 true 时，下一页传回 snapshot 和 next_offset（作为 offset），其余参数不变。")}</p>
    <Fields isZh={isZh} rows={[
      ["data[].payload.ticker / snapshot_date", "The stock and the date of the saved calendar update.", "股票代码及所保存日历的更新日期。"],
      ["report_date", "For earnings: expected earnings date. For dividends: the shareholder record date, not an earnings date.", "earnings 中表示预计财报日；dividends 中表示股权登记日，不是财报日。"],
      ["report_time / estimate", "Expected earnings release time and EPS estimate, when supplied.", "预计财报发布时间及每股收益预期，可能缺失。"],
      ["dividend / dividend_date / payment_date", "Dividend amount and the source's dividend-event/payment dates, when supplied. Check company announcements for ex-dividend rules.", "分红金额及来源提供的股息事件日、支付日，可能缺失；除息规则请以公司公告为准。"],
    ]} />
    <p>{t("Read all pages, then select upcoming events by their event date. Keep the response and its update date: an older event record may have been revised. Missing values and empty results do not mean zero dividends or no announced events.", "读完分页后，再按事件日期选择未来事件。保存响应和更新日期，较早记录可能已经修订。字段缺失或结果为空，不表示分红为零，也不表示公司没有已公告事件。")}</p>

    <h2 id="eodhd-coverage" className="display-title">{t("Available dates and coverage", "可用日期与覆盖范围")}</h2>
    <pre className="code">{`curl --get "https://api.leandata.uk/v1/events/eodhd/coverage" \\
  ${auth} \\
  --data-urlencode "dataset=earnings"`}</pre>
    <p>{t("daily_coverage.latest_capture_date is the latest saved update date, including an update with no events. latest_nonempty_date is the latest date with records. Use these dates when requesting history.", "daily_coverage.latest_capture_date 是最近保存日历的日期，也包含没有事件的日期；latest_nonempty_date 是最近有记录的日期。查询历史时使用这些日期。")}</p>
    <p>{t("Earnings and dividend updates focus on events roughly seven days ahead. A stock missing from a result may still have an announced event. Check the latest saved update and company announcements when a date matters. For 401 or 403, check your existing token and Premium validity; for a temporary service error, retry later.", "财报与分红更新主要面向未来约七天的事件。某只股票未出现在结果中，仍可能有已公告事件。重要日期请查看最近更新并核对公司公告。遇到 401 或 403，检查现有 token 和 Premium 有效期；服务暂时出错时稍后重试。")}</p>
  </DocContent>;
}
