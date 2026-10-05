// Shared navigation and page addresses for the browser and static publisher.

const DOC_PATHS = {
  home: "/docs/",
  marketOverview: "/docs/market/overview/",
  marketStocks: "/docs/market/stocks/",
  marketOptions: "/docs/market/options/",
  marketIndices: "/docs/market/indices/",
  marketResearch: "/docs/market/research-signals/",
  marketCryptoNews: "/docs/market/crypto-news/",
  marketCn: "/docs/market/cn/",
  financial: "/docs/financial/",
  financialRegular: "/docs/financial/regular/",
  financialMorningstar: "/docs/financial/morningstar/",
  financialStatements: "/docs/financial/statements/",
  financialRatios: "/docs/financial/ratios-growth/",
  bulk: "/docs/bulk/download/",
  websocket: "/docs/realtime/websocket/",
  subscriptions: "/docs/realtime/subscriptions/",
  status: "/docs/status/",
  usage: "/docs/usage/",
};

const NAV_GROUPS = [
  {
    key: "market",
    label: "行情数据", en: "Market data",
    match: ["proxy"],
    mainTab: "proxy",
    items: [
      { label: "总览与认证", en: "Overview & authentication", desc: "Overview · Auth · Tiers", href: DOC_PATHS.marketOverview },
      { label: "股票行情", en: "Stock data", desc: "Bars · Quotes · Trades", href: DOC_PATHS.marketStocks },
      { label: "期权行情", en: "Options data", desc: "Contracts · Snapshots · OI", href: DOC_PATHS.marketOptions },
      { label: "指数行情", en: "Index data", desc: "SPX · VIX · DJX · XSP", href: DOC_PATHS.marketIndices },
      { label: "研究信号", en: "Research signals", desc: "Spectral Tick-Flow · SID", href: DOC_PATHS.marketResearch },
      { label: "加密与新闻", en: "Crypto & news", desc: "Snapshots · Orderbooks · News", href: DOC_PATHS.marketCryptoNews },
      { label: "中国数据", en: "CN Data", desc: "CN archive · /v1/cn/* · ¥70/月", href: DOC_PATHS.marketCn },
    ],
  },
  {
    key: "financial",
    label: "财务数据", en: "Financial data",
    match: ["fmp", "fmp-fundamentals", "morningstar"],
    mainTab: "fmp",
    items: [
      { label: "选择数据源", en: "Choose source", desc: "Regular / FMP · Morningstar", href: DOC_PATHS.financial },
      { label: "Regular / FMP", en: "Regular / FMP", desc: "50+ standard endpoints", href: DOC_PATHS.financialRegular },
      { label: "Morningstar", en: "Morningstar", desc: "Daily wide fundamentals", href: DOC_PATHS.financialMorningstar },
      { label: "财务三表", en: "Financial statements", desc: "Income · Balance · Cashflow", href: DOC_PATHS.financialStatements },
      { label: "比率与增长", en: "Ratios & growth", desc: "Ratios · Growth", href: DOC_PATHS.financialRatios },
    ],
  },
  {
    key: "batch",
    label: "批量与实时", en: "Bulk & realtime",
    match: ["bulk", "ws"],
    mainTab: "bulk",
    items: [
      { label: "批量下载", en: "Bulk download", desc: "¥50 / 50GB snapshot", href: DOC_PATHS.bulk },
      { label: "WS 使用指南", en: "WS guide", desc: "6 channels", href: DOC_PATHS.websocket },
      { label: "订阅与消息", en: "Subscriptions & messages", desc: "Subscribe · Shapes", href: DOC_PATHS.subscriptions },
    ],
  },
  {
    key: "ops",
    label: "状态与用量", en: "Status & usage",
    match: ["status", "usage"],
    mainTab: "status",
    items: [
      { label: "服务状态", en: "Service status", desc: "Live · Latency · Uptime", href: DOC_PATHS.status },
      { label: "用量统计", en: "Usage", desc: "30d · Token stats", href: DOC_PATHS.usage },
      { label: "产品更新", en: "Product updates", desc: "Changelog", href: "/updates" },
    ],
  },
];

const DOC_PAGE_CONFIG = {
  home: { path: DOC_PATHS.home, tab: "home" },
  "market-overview": { path: DOC_PATHS.marketOverview, tab: "proxy", focus: "overview" },
  "market-stocks": { path: DOC_PATHS.marketStocks, tab: "proxy", focus: "stocks" },
  "market-options": { path: DOC_PATHS.marketOptions, tab: "proxy", focus: "options" },
  "market-indices": { path: DOC_PATHS.marketIndices, tab: "proxy", focus: "indices" },
  "market-research": { path: DOC_PATHS.marketResearch, tab: "proxy", focus: "research" },
  "market-crypto-news": { path: DOC_PATHS.marketCryptoNews, tab: "proxy", focus: "crypto-news" },
  "market-cn": { path: DOC_PATHS.marketCn, tab: "proxy", focus: "cn" },
  financial: { path: DOC_PATHS.financial, tab: "fmp" },
  "financial-regular": { path: DOC_PATHS.financialRegular, tab: "fmp-fundamentals" },
  "financial-morningstar": { path: DOC_PATHS.financialMorningstar, tab: "morningstar" },
  "financial-statements": { path: DOC_PATHS.financialStatements, tab: "fmp-fundamentals", focus: "statements" },
  "financial-ratios": { path: DOC_PATHS.financialRatios, tab: "fmp-fundamentals", focus: "ratios" },
  bulk: { path: DOC_PATHS.bulk, tab: "bulk" },
  websocket: { path: DOC_PATHS.websocket, tab: "ws" },
  subscriptions: { path: DOC_PATHS.subscriptions, tab: "ws", focus: "subscriptions" },
  status: { path: DOC_PATHS.status, tab: "status" },
  usage: { path: DOC_PATHS.usage, tab: "usage" },
};

const DOC_PAGE_BY_PATH = Object.fromEntries(
  Object.entries(DOC_PAGE_CONFIG).map(([page, config]) => [config.path, page])
);

const SECTION_ZH_LABELS = {
  "Market · US / World": "市场 · 美国 / 世界",
  "US market": "美国市场",
  "World · CN 中国数据": "世界 · 中国数据",
  "Getting started": "入门指南",
  "Overview": "概览与架构",
  "Authentication": "身份鉴权",
  "Tiers & permissions": "套餐与权限",
  "Free plan usage": "Free 计划指引",
  "Token API": "Token 账户接口",
  "register": "注册接口",
  "check-status": "查询状态",
  "generate-token": "获取 Token",
  "REST History": "REST 历史行情",
  "history/bars": "历史 K 线",
  "history/news": "历史新闻",
  "stock trade+quote": "逐笔成交与报价",
  "Index Data": "指数数据",
  "index history": "指数日线历史",
  "Cash minute archive": "现金指数分钟归档",
  "Cash minute history": "分钟线历史",
  "Cash minute coverage": "分钟线覆盖范围",
  "Cash daily history": "派生日线历史",
  "Cash daily coverage": "派生日线覆盖范围",
  "Research Signals": "研究信号",
  "Spectral overview": "Spectral 概览",
  "Spectral methodology": "Spectral 方法解读",
  "Spectral processing": "Spectral 去重与版本处理",
  "Spectral fields": "Spectral 字段字典",
  "Spectral history": "Spectral 历史信号",
  "Spectral coverage": "Spectral 覆盖范围",
  "Spectral workflows": "Spectral 研究工作流",
  "Stock Data": "股票数据",
  "overview": "数据概览",
  "Multi-symbol": "多股票批量",
  "auctions": "集合竞价",
  "multi bars": "批量历史 K 线",
  "multi latest bars": "批量最新 K 线",
  "multi quotes": "批量逐笔报价",
  "multi latest quotes": "批量最新报价",
  "multi snapshots": "批量综合快照",
  "multi trades": "批量逐笔成交",
  "multi latest trades": "批量最新成交",
  "Metadata": "元数据字典",
  "condition codes": "成交条件代码",
  "exchange codes": "交易所代码",
  "Single symbol": "单只股票",
  "single bars": "单股历史 K 线",
  "single latest bar": "单股最新 K 线",
  "single quotes": "单股逐笔报价",
  "single latest quote": "单股最新报价",
  "single snapshot": "单股综合快照",
  "single trades": "单股逐笔成交",
  "single latest trade": "单股最新成交",
  "Options Data": "期权数据",
  "routing model": "路由与多级缓存",
  "contracts": "期权合约列表",
  "Snapshots": "期权快照",
  "snapshots": "全链快照与 Greeks",
  "quote": "最新报价快照",
  "snapshot trade": "最新成交快照",
  "open interest": "未平仓量快照",
  "expiry": "按到期日快照",
  "snapshot ohlc": "快照 OHLC",
  "Options history": "期权历史",
  "bars": "历史分钟 K 线",
  "eod": "日终结算数据",
  "history open interest": "历史未平仓量",
  "trades": "历史逐笔成交",
  "history ohlc": "历史 OHLC",
  "at-time quote": "时点整链报价",
  "Direct API": "原生接口",
  "direct endpoints": "高频原生接口",
  "Crypto Data": "加密货币",
  "crypto snapshots": "实时多维快照",
  "orderbooks": "实时订单簿",
  "Admin endpoints": "管理后台接口",
  "login": "管理员登录",
  "pending": "待审核列表",
  "approve": "审批开通",
  "reject": "拒绝申请",
  "Reference": "参考说明",
  "Error codes": "错误代码",
  "Rate limits": "并发与限流",
  "Financial data API": "财务数据 API",
  "Morningstar fundamentals": "Morningstar 财务数据",
  "Morningstar overview": "Morningstar 概览",
  "What is PIT?": "什么是 PIT？",
  "Deduplication": "去重与数据处理",
  "Morningstar fields": "Morningstar 字段字典",
  "Morningstar history": "Morningstar 历史快照",
  "Morningstar coverage": "Morningstar 覆盖范围",
  "Financial data overview": "财务数据概览",
  "Request contract": "请求规范",
  "Response metadata": "响应元数据",
  "Market history": "市场历史",
  "historical-price-eod/full": "日终历史价格全量",
  "Market snapshots": "市场快照",
  "quote-short": "简版报价",
  "aftermarket-quote": "盘后报价",
  "aftermarket-trade": "盘后成交",
  "stock-price-change": "价格涨跌幅",
  "market-capitalization": "当前市值",
  "historical-market-capitalization": "历史市值",
  "batch-quote": "批量报价",
  "batch-quote-short": "批量简版报价",
  "batch-aftermarket-quote": "批量盘后报价",
  "batch-aftermarket-trade": "批量盘后成交",
  "market-capitalization-batch": "批量市值",
  "Company reference": "公司资料与基本面",
  "profile": "公司资料",
  "stock-peers": "同行公司",
  "key-executives": "核心高管",
  "company-notes": "公司备忘录",
  "financial-reports-dates": "财报发布日期",
  "employee-count": "员工人数",
  "historical-employee-count": "历史员工人数",
  "shares-float": "流通股本",
  "shares-float-all": "全量流通股本",
  "dividends": "历史分红",
  "splits": "历史拆股",
  "Financial statements": "财务三大报表",
  "income-statement": "利润表 (Income Statement)",
  "balance-sheet-statement": "资产负债表 (Balance Sheet)",
  "cash-flow-statement": "现金流量表 (Cash Flow)",
  "PIT statements": "时点财报 (Point-in-Time)",
  "Ratios & metrics": "财务比率与指标",
  "ratios": "财务比率 (Ratios)",
  "ratios-ttm": "TTM 财务比率",
  "key-metrics": "关键指标 (Key Metrics)",
  "key-metrics-ttm": "TTM 关键指标",
  "Growth & valuation": "增长与估值",
  "income-statement-growth": "收入增长分析",
  "balance-sheet-statement-growth": "资产负债增长",
  "cash-flow-statement-growth": "现金流增长",
  "financial-growth": "综合财务增长",
  "enterprise-values": "企业价值 (EV)",
  "financial-scores": "财务健康评分",
  "Research & valuation": "深度研究与评级",
  "analyst-estimates": "分析师一致预测",
  "price-target-summary": "目标价汇总",
  "price-target-consensus": "目标价共识",
  "discounted-cash-flow": "DCF 现金流折现估值",
  "custom-discounted-cash-flow": "自定义 DCF 估值",
  "levered-discounted-cash-flow": "杠杆 DCF 估值",
  "custom-levered-discounted-cash-flow": "自定义杠杆 DCF",
  "owner-earnings": "所有者收益",
  "earnings": "历史收益数据",
  "grades": "分析师评级",
  "grades-consensus": "评级共识",
  "grades-historical": "历史评级变动",
  "ratings-snapshot": "综合评分快照",
  "ratings-historical": "历史评分记录",
  "Revenue & directories": "营收细分与代码目录",
  "revenue-geographic-segmentation": "按地区营收细分",
  "revenue-product-segmentation": "按产品营收细分",
  "available-countries": "支持国家列表",
  "available-exchanges": "支持交易所列表",
  "available-industries": "支持行业列表",
  "available-sectors": "支持板块列表",
  "cik-list": "CIK 代码列表",
  "delisted-companies": "已退市公司列表",
  "financial-statement-symbol-list": "财报股票代码列表",
  "stock-list": "全部美股列表",
  "symbol-change": "代码变更历史",
  "Coverage": "覆盖范围说明",
  "Snapshot boundary": "快照更新边界",
  "Future data families": "即将推出数据族",
  "Connecting": "连接与认证",
  "Endpoint": "连接端点",
  "Auth message": "认证消息格式",
  "Heartbeat": "心跳保活机制",
  "Channels": "数据通道",
  "stocks": "美股实时流 (stocks)",
  "options": "期权实时流 (options)",
  "boats": "大宗暗盘流 (boats)",
  "overnight": "夜盘交易流 (overnight)",
  "crypto": "加密货币流 (crypto)",
  "news": "新闻快讯流 (news)",
  "Messages": "交互消息格式",
  "Subscribe": "订阅消息 (Subscribe)",
  "Unsubscribe": "退订消息 (Unsubscribe)",
  "Trade": "逐笔成交帧 (Trade)",
  "Quote": "逐笔报价帧 (Quote)",
  "Bar": "分钟 K 线帧 (Bar)",
  "Operations": "高级运维",
  "Reconnect": "断线重连与退避",
  "Backpressure": "背压与流控机制",
  "System": "系统架构",
  "Components": "核心组件",
  "Latency": "延迟时延",
  "Metrics history": "历史指标",
  "Uptime": "90 天在线率",
  "Incidents": "故障与维护记录",
  "Methodology": "统计方法论",
  "CN Data overview": "CN Data 总览",
  "Daily bars": "日线",
  "Minute bars": "分钟线",
  "Valuation": "估值",
  "Membership": "成分与会话",
  "Fundamentals": "财务报表",
  "ETF data": "ETF 数据",
  "ETF minutes": "ETF 分钟线",
  "Options": "期权",
  "Funds": "基金",
  "Reserved routes": "预留路由",
  "Catalog": "目录",
  "Shareholders": "股东持仓",
  "Money flow": "资金流",
  "Billboard": "龙虎榜",
  "Access & scope": "权限与范围"
};

    const FMP_ID_MAP = {
      "Financial data overview": "fmp-fundamentals-overview",
      "Request contract": "fmp-request-contract",
      "Response metadata": "fmp-response-metadata",
      "historical-price-eod/full": "fmp-historical-price-eod",
      "income-statement": "fmp-income-statement",
      "balance-sheet-statement": "fmp-balance-sheet-statement",
      "cash-flow-statement": "fmp-cash-flow-statement",
      "PIT statements": "fmp-pit-statements",
      "ratios": "fmp-ratios",
      "ratios-ttm": "fmp-ratios-ttm",
      "key-metrics": "fmp-key-metrics",
      "key-metrics-ttm": "fmp-key-metrics-ttm",
      "income-statement-growth": "fmp-income-statement-growth",
      "balance-sheet-statement-growth": "fmp-balance-sheet-statement-growth",
      "cash-flow-statement-growth": "fmp-cash-flow-statement-growth",
      "financial-growth": "fmp-financial-growth",
      "enterprise-values": "fmp-enterprise-values",
      "financial-scores": "fmp-financial-scores",
    };
    const ID_MAP = {'Morningstar overview': 'morningstar-overview', 'What is PIT?': 'morningstar-pit', 'Deduplication': 'morningstar-processing', 'Morningstar fields': 'morningstar-fields', 'Morningstar history': 'morningstar-history', 'Morningstar coverage': 'morningstar-coverage', 'Market · US / World': 'market-us-world', 'Overview': 'overview', 'Authentication': 'authentication', 'Tiers & permissions': 'tiers-permissions', 'Free plan usage': 'free-plan-usage', 'register': 'post-register', 'check-status': 'post-check-status', 'generate-token': 'post-generate-token', 'history/bars': 'post-v1-history-bars', 'index history': 'get-post-v1-indices-history', 'Cash minute archive': 'cash-indices-overview', 'Cash minute history': 'get-post-v1-indices-minute', 'Cash minute coverage': 'get-v1-indices-minute-coverage', 'Cash daily history': 'get-post-v1-indices-daily', 'Cash daily coverage': 'get-v1-indices-daily-coverage', 'Spectral overview': 'spectral-overview', 'Spectral methodology': 'spectral-methodology', 'Spectral processing': 'spectral-processing', 'Spectral fields': 'spectral-fields', 'Spectral history': 'get-post-v1-spectral-tick-flow', 'Spectral coverage': 'get-v1-spectral-tick-flow-coverage', 'Spectral workflows': 'spectral-workflows', 'history/news': 'post-v1-history-news', 'stock trade+quote': 'post-v1-stock-history-trade-quote', 'overview': 'stock-data-availability', 'auctions': 'stock-auctions', 'multi bars': 'stock-bars', 'multi latest bars': 'stock-latest-bars', 'condition codes': 'stock-condition-codes', 'exchange codes': 'stock-exchange-codes', 'multi quotes': 'stock-quotes', 'multi latest quotes': 'stock-latest-quotes', 'multi snapshots': 'stock-snapshots', 'multi trades': 'stock-trades', 'multi latest trades': 'stock-latest-trades', 'single bars': 'stock-single-bars', 'single latest bar': 'stock-single-latest-bar', 'single quotes': 'stock-single-quotes', 'single latest quote': 'stock-single-latest-quote', 'single snapshot': 'stock-single-snapshot', 'single trades': 'stock-single-trades', 'single latest trade': 'stock-single-latest-trade', 'routing model': 'provider-fallback-cache', 'provider model': 'provider-fallback-cache', 'contracts': 'post-v1-options-contracts', 'snapshots': 'post-v1-options-snapshots', 'quote': 'post-v1-options-snapshots-quote', 'snapshot trade': 'post-v1-options-snapshots-trade', 'open interest': 'post-v1-options-snapshots-open-interest', 'expiry': 'post-v1-options-snapshots-expiry', 'snapshot ohlc': 'post-v3-option-snapshot-ohlc', 'bars': 'post-v1-history-options-bars', 'eod': 'post-v1-history-options-eod', 'history open interest': 'post-v1-options-open-interest', 'trades': 'post-v1-history-options-trades', 'history ohlc': 'post-v3-option-history-ohlc', 'at-time quote': 'post-v3-option-at-time-quote', 'direct endpoints': 'post-v3-option-direct-value', 'crypto snapshots': 'get-post-v1beta3-crypto-us-snapshots', 'orderbooks': 'post-v1-crypto-us-latest-orderbooks', 'login': 'post-admin-login', 'pending': 'get-admin-pending', 'approve': 'post-admin-approve', 'reject': 'post-admin-reject', 'Error codes': 'error-codes', 'Rate limits': 'rate-limits', 'Financial data overview': 'fmp-fundamentals-overview', 'Request contract': 'fmp-request-contract', 'Response metadata': 'fmp-response-metadata', 'historical-price-eod/full': 'fmp-historical-price-eod', 'income-statement': 'fmp-income-statement', 'balance-sheet-statement': 'fmp-balance-sheet-statement', 'cash-flow-statement': 'fmp-cash-flow-statement', 'PIT statements': 'fmp-pit-statements', 'ratios': 'fmp-ratios', 'ratios-ttm': 'fmp-ratios-ttm', 'key-metrics': 'fmp-key-metrics', 'key-metrics-ttm': 'fmp-key-metrics-ttm', 'income-statement-growth': 'fmp-income-statement-growth', 'balance-sheet-statement-growth': 'fmp-balance-sheet-statement-growth', 'cash-flow-statement-growth': 'fmp-cash-flow-statement-growth', 'financial-growth': 'fmp-financial-growth', 'enterprise-values': 'fmp-enterprise-values', 'financial-scores': 'fmp-financial-scores', 'Snapshot boundary': 'fmp-snapshot-boundary', 'Future data families': 'fmp-future-data-families', 'CN Data overview': 'cn-data-overview', 'Daily bars': 'cn-daily-bars', 'Minute bars': 'cn-minute-bars', 'Valuation': 'cn-valuation', 'Membership': 'cn-membership', 'Reference': 'cn-reference', 'Fundamentals': 'cn-fundamentals', 'ETF data': 'cn-etf', 'Shareholders': 'cn-shareholders', 'Money flow': 'cn-money-flow', 'Billboard': 'cn-billboard', 'Access & scope': 'cn-access', 'ETF minutes': 'cn-etf-minute', 'Options': 'cn-options', 'Funds': 'cn-funds', 'Reserved routes': 'cn-unavailable', 'Catalog': 'cn-catalog'};

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function docSectionId(tab, label) {
  return tab === "fmp-fundamentals"
    ? FMP_ID_MAP[label] || `fmp-${slugify(label)}`
    : ID_MAP[label] || slugify(label);
}

function getDocSections(tab, page) {
  const sections = tab === "proxy" ? [
    { title: "Getting started", items: ["Overview", "Authentication", "Tiers & permissions", "Free plan usage"] },
    { title: "Token API", items: ["register", "check-status", "generate-token"] },
    { title: "REST History", items: ["history/bars", "history/news", "stock trade+quote"] },
    { title: "Index Data", items: ["index history", "Cash minute archive", "Cash minute history", "Cash minute coverage", "Cash daily history", "Cash daily coverage"] },
    { title: "Research Signals", items: ["Spectral overview", "Spectral methodology", "Spectral processing", "Spectral fields", "Spectral history", "Spectral coverage", "Spectral workflows"] },
    { title: "Stock Data", items: ["Market · US / World"], children: [
      { title: "US market", items: ["overview"], children: [
        { title: "Multi-symbol", items: ["auctions", "multi bars", "multi latest bars", "multi quotes", "multi latest quotes", "multi snapshots", "multi trades", "multi latest trades"] },
        { title: "Metadata", items: ["condition codes", "exchange codes"] },
        { title: "Single symbol", items: ["single bars", "single latest bar", "single quotes", "single latest quote", "single snapshot", "single trades", "single latest trade"] },
      ]},
      { title: "World · CN 中国数据", items: ["CN Data overview", "Daily bars", "Minute bars", "Valuation", "Membership", "Reference", "Fundamentals", "ETF data", "ETF minutes", "Options", "Funds", "Shareholders", "Reserved routes", "Catalog", "Access & scope"] },
    ]},
    { title: "Options Data", items: ["routing model", "contracts"], children: [
      { title: "Snapshots", items: ["snapshots", "quote", "snapshot trade", "open interest", "expiry", "snapshot ohlc"] },
      { title: "Options history", items: ["bars", "eod", "history open interest", "trades", "history ohlc", "at-time quote"] },
      { title: "Direct API", items: ["direct endpoints"] },
    ]},
    { title: "Crypto Data", items: ["crypto snapshots", "orderbooks"] },
    { title: "Admin endpoints", items: ["login", "pending", "approve", "reject"] },
    { title: "Reference", items: ["Error codes", "Rate limits"] },
  ] : tab === "morningstar" ? [
    { title: "Morningstar fundamentals", items: ["Morningstar overview", "What is PIT?", "Deduplication", "Morningstar fields", "Morningstar history", "Morningstar coverage"] },
  ] : tab === "fmp-fundamentals" ? [
    { title: "Financial data API", items: ["Financial data overview", "Request contract", "Response metadata"] },
    { title: "Market history", items: ["historical-price-eod/full"] },
    { title: "Market snapshots", items: ["quote", "quote-short", "aftermarket-quote", "aftermarket-trade", "stock-price-change", "market-capitalization", "historical-market-capitalization", "batch-quote", "batch-quote-short", "batch-aftermarket-quote", "batch-aftermarket-trade", "market-capitalization-batch"] },
    { title: "Company reference", items: ["profile", "stock-peers", "key-executives", "company-notes", "financial-reports-dates", "employee-count", "historical-employee-count", "shares-float", "shares-float-all", "dividends", "splits"] },
    { title: "Financial statements", items: ["income-statement", "balance-sheet-statement", "cash-flow-statement", "PIT statements"] },
    { title: "Ratios & metrics", items: ["ratios", "ratios-ttm", "key-metrics", "key-metrics-ttm"] },
    { title: "Growth & valuation", items: ["income-statement-growth", "balance-sheet-statement-growth", "cash-flow-statement-growth", "financial-growth", "enterprise-values", "financial-scores"] },
    { title: "Research & valuation", items: ["analyst-estimates", "price-target-summary", "price-target-consensus", "discounted-cash-flow", "custom-discounted-cash-flow", "levered-discounted-cash-flow", "custom-levered-discounted-cash-flow", "owner-earnings", "earnings", "grades", "grades-consensus", "grades-historical", "ratings-snapshot", "ratings-historical"] },
    { title: "Revenue & directories", items: ["revenue-geographic-segmentation", "revenue-product-segmentation", "available-countries", "available-exchanges", "available-industries", "available-sectors", "cik-list", "delisted-companies", "financial-statement-symbol-list", "stock-list", "symbol-change"] },
    { title: "Coverage", items: ["Snapshot boundary", "Future data families"] },
  ] : tab === "ws" ? [
    { title: "Connecting", items: ["Endpoint", "Auth message", "Heartbeat"] },
    { title: "Channels", items: ["stocks", "options", "crypto", "news", "overnight"] },
    { title: "Messages", items: ["Subscribe", "Unsubscribe", "Trade", "Quote", "Bar"] },
    { title: "Operations", items: ["Reconnect", "Backpressure"] },
  ] : [
    { title: "System", items: ["Overview", "Components", "Latency"] },
    { title: "Metrics history", items: ["Uptime", "Incidents", "Methodology"] },
  ];

  const pageSections = {
    "market-overview": sections.filter((section) => ["Getting started", "Token API", "Stock Data", "Admin endpoints", "Reference"].includes(section.title)).map((section) => section.title === "Stock Data" ? { ...section, linksOnly: true } : section),
    "market-stocks": [
      { title: "REST History", items: ["history/bars", "stock trade+quote"] },
      { title: "Stock Data", items: ["Market · US / World"], children: [{ title: "US market", items: ["overview"], children: [
        { title: "Multi-symbol", items: ["auctions", "multi bars", "multi latest bars", "multi quotes", "multi latest quotes", "multi snapshots", "multi trades", "multi latest trades"] },
        { title: "Metadata", items: ["condition codes", "exchange codes"] },
        { title: "Single symbol", items: ["single bars", "single latest bar", "single quotes", "single latest quote", "single snapshot", "single trades", "single latest trade"] },
      ]},
      // Cross-page entry: sidebar leaf resolves to the dedicated CN route.
      { title: "World · CN 中国数据", items: ["CN Data overview"] }]},
    ],
    "market-options": sections.filter((section) => section.title === "Options Data"),
    "market-indices": sections.filter((section) => section.title === "Index Data"),
    "market-research": sections.filter((section) => section.title === "Research Signals"),
    "market-crypto-news": [{ title: "REST History", items: ["history/news"] }, ...sections.filter((section) => section.title === "Crypto Data")],
    "market-cn": [{ title: "World · CN 中国数据", items: ["CN Data overview", "Daily bars", "Minute bars", "Valuation", "Membership", "Reference", "Fundamentals", "ETF data", "ETF minutes", "Options", "Funds", "Shareholders", "Reserved routes", "Catalog", "Access & scope"] }],
    "financial-statements": sections.filter((section) => section.title === "Financial statements"),
    "financial-ratios": sections.filter((section) => ["Ratios & metrics", "Growth & valuation"].includes(section.title)),
    subscriptions: sections.filter((section) => section.title === "Messages"),
  };
  const scopedSections = pageSections[page] || sections;

  return scopedSections;
}

function flattenSections(sections) {
  return sections.flatMap(section => [
    ...(section.items || []).map(label => ({ label, group: section.title })),
    ...flattenSections(section.children || []),
  ]);
}

// Sidebar mirror groups (linksOnly) are visible navigation that must never
// mint article routes; their leaves resolve cross-page via docArticlePath.
function articleItems(sections) {
  return (sections || []).flatMap(section => section.linksOnly
    ? []
    : [...(section.items || []).map(label => ({ label, group: section.title })),
      ...articleItems(section.children || [])]);
}

const DOC_ARTICLES = {};
for (const [page, config] of Object.entries(DOC_PAGE_CONFIG)) {
  if (!["proxy", "ws", "fmp-fundamentals", "morningstar"].includes(config.tab)) continue;
  for (const item of articleItems(getDocSections(config.tab, page))) {
    const id = docSectionId(config.tab, item.label);
    // cn-* sidebar entries outside market-cn are cross-page links: they must
    // not mint a second local article route.
    if (id.startsWith("cn-") && page !== "market-cn") continue;
    const path = `${config.path}${id}/`;
    DOC_ARTICLES[path] ||= { ...config, path, page, id, label: item.label, group: item.group };
  }
}

function docArticlePath(page, id) {
  const path = `${DOC_PAGE_CONFIG[page].path}${id}/`;
  if (DOC_ARTICLES[path]) return path;
  // Cross-page sidebar entries (e.g. CN overview listed under market-stocks)
  // resolve to the article's own route instead of falling back to this page.
  const foreign = Object.values(DOC_ARTICLES).find(article => article.id === id);
  if (foreign) return foreign.path;
  return DOC_PAGE_CONFIG[page].path;
}

function legacyDocsPath(hash) {
  if (!hash) return null;
  if (hash === "fmp" || hash === "financial-source-selector" || hash.startsWith("fmp-data-")) return DOC_PATHS.financial;
  if (hash === "morningstar" || hash.startsWith("morningstar-")) return DOC_PATHS.financialMorningstar;
  if (["fmp-income-statement", "fmp-balance-sheet-statement", "fmp-cash-flow-statement", "fmp-pit-statements"].includes(hash)) return DOC_PATHS.financialStatements;
  if (hash.startsWith("fmp-ratio") || hash.startsWith("fmp-key-metric") || hash.includes("growth") || hash === "fmp-enterprise-values" || hash === "fmp-financial-scores") return DOC_PATHS.financialRatios;
  if (hash.startsWith("fmp-")) return DOC_PATHS.financialRegular;
  if (hash.startsWith("cn-")) return DOC_PATHS.marketCn;
  if (hash.includes("spectral")) return DOC_PATHS.marketResearch;
  if (hash.includes("indices")) return DOC_PATHS.marketIndices;
  if (["endpoint", "auth-message", "heartbeat", "stocks", "options", "crypto", "news", "overnight", "reconnect", "backpressure", "ws"].includes(hash)) return DOC_PATHS.websocket;
  if (hash.includes("options") || hash.startsWith("post-v3-option") || hash === "provider-fallback-cache") return DOC_PATHS.marketOptions;
  if (hash.includes("crypto") || hash.includes("history-news")) return DOC_PATHS.marketCryptoNews;
  if (["subscribe", "unsubscribe", "trade", "quote", "bar"].includes(hash)) return DOC_PATHS.subscriptions;
  if (hash.startsWith("stock-") || hash.includes("history-bars") || hash.includes("trade-quote")) return DOC_PATHS.marketStocks;
  if (["proxy", "authentication", "overview", "tiers-permissions", "free-plan-usage", "post-register", "post-check-status", "post-generate-token", "error-codes", "rate-limits"].includes(hash)) return DOC_PATHS.marketOverview;
  if (hash === "bulk") return DOC_PATHS.bulk;
  if (hash === "status") return DOC_PATHS.status;
  if (hash === "usage") return DOC_PATHS.usage;
  return null;
}

function resolveLegacyDocPath(pathname, hash) {
  if (!hash || DOC_ARTICLES[pathname]) return null;
  const target = pathname === DOC_PATHS.home ? legacyDocsPath(hash) : pathname;
  const page = DOC_PAGE_BY_PATH[target];
  return page ? docArticlePath(page, hash) : null;
}

export { resolveLegacyDocPath, DOC_PATHS, NAV_GROUPS, DOC_PAGE_CONFIG, DOC_PAGE_BY_PATH, DOC_ARTICLES, SECTION_ZH_LABELS, getDocSections, docSectionId, docArticlePath };
