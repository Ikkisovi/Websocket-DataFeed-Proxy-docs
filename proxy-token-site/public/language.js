(() => {
  "use strict";

  const STORAGE_KEY = "leandata.language";
  const EVENT_NAME = "leandata:languagechange";
  const CJK_RE = /[\u3400-\u9fff]/;
  const originalText = new WeakMap();
  const originalAttributes = new WeakMap();
  let applying = false;
  let languageObserver = null;

  const translations = new Map(Object.entries({
    "新用户注册 — Stock Options Proxy": "Create an account — Leandata",
    "账户管理 — Leandata Proxy": "Account management — Leandata",
    "配置套餐 — Leandata": "Choose a plan — Leandata",
    "Admin — 审核后台": "Admin — Review console",

    "账户管理": "Account",
    "已有账号 · 账户管理 →": "Already registered · Manage account →",
    "新用户注册": "Create account",
    "退出登录": "Sign out",
    "创建账户 · 套餐与支付": "Create account · Plans and payment",
    "新用户 注册": "Create your account",
    "先创建账户，下一步再选择套餐、时长与支付方式。中途退出也可以使用原用户名与手机号恢复，不会重复创建注册流程。支付成功后自动开通，无需管理员批准。": "Create your account first, then choose a plan, term, and payment method. If you leave midway, return with the same username and phone number. Your service activates automatically after payment—no administrator approval required.",
    "先创建账户，下一步再选择套餐、时长与支付方式。中途退出也可以使用原用户名与手机号恢复，": "Create your account first, then choose a plan, term, and payment method. If you leave midway, return with the same username and phone number. ",
    "不会重复创建注册流程。支付成功后自动开通，无需管理员批准。": "Your registration will not be duplicated. Service activates automatically after payment—no administrator approval required.",
    "1 · 选择服务等级": "1 · Choose a service tier",
    "选择 REST 数据方向": "Choose your REST data focus",
    "pick one · WS 不受限": "pick one · all WS channels included",
    "1 · 创建账户": "1 · Create account",
    "用户名": "Username",
    "英文字母，用于后续登录": "Letters and numbers for future sign-in",
    "注册成功后无法修改。": "This cannot be changed after registration.",
    "手机号": "Phone number",
    "下单时使用的手机号": "Phone number used for your order",
    "用于匹配卖家订单记录。": "Used to match your payment record.",
    "邮箱": "Email",
    "用于账户绑定与服务通知": "Used for account linking and service notices",
    "必填。用于账户识别、服务通知和后续登录验证。": "Required for account identification, service notices, and future sign-in verification.",
    "下一步选择套餐、订阅时长和支付方式。返回本页时可使用同一账户信息继续。": "Next, choose your plan, billing term, and payment method. You can return and continue with the same account details.",
    "正在创建账户…": "Creating account…",
    "创建账户并选择套餐 →": "Create account and choose plan →",
    "查询进度": "Check progress",
    "已注册？": "Already registered?",
    "使用注册时的用户名和手机号查询审核状态。": "Use the username and phone number from registration to resume your checkout or check account status.",
    "查询中...": "Checking…",
    "查询状态": "Check status",
    "审核已通过": "Approved",
    "账户已创建": "Account created",
    "审核中": "Pending review",
    "审核未通过": "Not approved",
    "未找到记录": "No record found",
    "查询出错": "Unable to check",
    "继续选择套餐与支付 →": "Continue to plans and payment →",
    "状态说明 ·": "Status ·",
    "问题反馈：": "Support:",
    "请填写用户名、手机号和邮箱。": "Enter a username, phone number, and email address.",
    "请输入有效的邮箱地址。": "Enter a valid email address.",
    "已恢复账户，正在进入套餐与支付管理…": "Account restored. Opening plans and payment…",
    "账户信息已保存，正在进入套餐与支付管理…": "Account saved. Opening plans and payment…",
    "Trial 注册已提交，等待审核。": "Trial registration submitted for review.",
    "注册失败，请检查输入。": "Registration failed. Check your information.",
    "网络错误，请稍后再试。": "Network error. Try again shortly.",
    "请填写用户名和手机号。": "Enter your username and phone number.",
    "查询失败。": "Unable to check status.",
    "审核中，请耐心等待。": "Pending review. Please check again later.",

    "短期体验": "Short trial",
    "3 天试用 · 全部 WS 通道 · 不可续期": "3-day trial · all WS channels · non-renewable",
    "一次性批量下载": "One-time bulk download",
    "按 ticker 与数据集下单 · 超过 50 GB 后每开始 1 GB 加 ¥1": "Order by ticker and dataset · ¥1 for each additional started GB after 50 GB",
    "REST 二选一 · 限速": "Choose one REST focus · rate limited",
    "全部 WS 通道 + REST 股票或期权二选一 · 限速 30 req/min": "All WS channels + either stock or option REST · 30 requests/minute",
    "stocks history 或 options chains": "stock history or option chains",
    "股票方向": "Stocks",
    "期权方向": "Options",
    "全部 WS + REST 仅股票历史": "All WS channels + stock history REST",
    "全部 WS + REST 仅期权历史": "All WS channels + option history REST",
    "主流套餐": "Most popular",
    "全部 WS 通道 · 50 symbols · stocks + options 历史": "All WS channels · 50 symbols · stock and option history",
    "完整接入": "Full access",
    "全部 WS 通道 · 500 symbols · 全部 REST 含 crypto": "All WS channels · 500 symbols · all REST including crypto",
    "全部 · 含 crypto orderbooks": "All endpoints · includes crypto order books",
    "查询一个或多个股票的历史 auction 数据。适合需要开盘/收盘 auction print 的场景。": "Retrieve historical auction data for one or more stocks, including opening and closing auction prints.",
    "多股票历史 OHLCV K 线。": "Historical OHLCV bars for multiple stocks.",
    "多股票最新分钟 K 线。": "Latest minute bars for multiple stocks.",
    "多股票历史 bid/ask quote ticks。": "Historical bid/ask quote ticks for multiple stocks.",
    "多股票最新报价。": "Latest quotes for multiple stocks.",
    "股票综合快照：最新成交、最新报价、分钟 K、日 K、前一日 K。": "Combined stock snapshots with latest trade, latest quote, minute bar, daily bar, and previous daily bar.",
    "多股票历史逐笔成交。": "Historical trades for multiple stocks.",
    "多股票最新成交。": "Latest trades for multiple stocks.",
    "将成交/报价条件代码映射为可读说明。": "Map trade and quote condition codes to readable descriptions.",
    "将交易所代码映射为可读交易场所名称。": "Map exchange codes to readable venue names.",
    "单只股票历史 OHLCV K 线。": "Historical OHLCV bars for one stock.",
    "单只股票最新分钟 K 线。": "Latest minute bar for one stock.",
    "单只股票历史报价 ticks。": "Historical quote ticks for one stock.",
    "单只股票最新报价。": "Latest quote for one stock.",
    "单只股票综合快照。": "Combined snapshot for one stock.",
    "单只股票历史逐笔成交。": "Historical trades for one stock.",
    "单只股票最新成交。": "Latest trade for one stock.",
    "轻量历史数据访问": "Lightweight historical data access",
    "股票与期权历史查询": "Stock and option history",
    "REST API 访问": "REST API access",
    "适合低频研究": "Designed for lower-frequency research",
    "不包含实时 WebSocket": "Real-time WebSocket not included",
    "实时数据与单方向历史数据": "Real-time data with one historical-data focus",
    "全部实时 WebSocket 通道": "All real-time WebSocket channels",
    "股票或期权历史数据二选一": "Choose stock or option history",
    "30 symbols 实时订阅": "30 real-time symbol subscriptions",
    "2 个并发 WS 连接": "2 concurrent WebSocket connections",
    "主流研究与交易工作流": "Core research and trading workflows",
    "股票与期权历史数据": "Stock and option history",
    "50 symbols 实时订阅": "50 real-time symbol subscriptions",
    "3 个并发 WS 连接": "3 concurrent WebSocket connections",
    "完整数据权限与最高容量": "Complete data access and highest capacity",
    "完整 REST 数据范围": "Complete REST data coverage",
    "500 symbols 实时订阅": "500 real-time symbol subscriptions",
    "包含 crypto 与 news 数据": "Includes crypto and news data",

    "管理你的数据访问，不经过注册页。": "Manage your data access without returning to registration.",
    "管理你的数据访问，": "Manage your data access, ",
    "不经过注册页。": "without returning to registration.",
    "登录后查看当前套餐、到期时间、REST 使用量、实时 WS 连接与订阅数量，并直接在线续费。": "Sign in to view your current plan, expiry, REST usage, live WebSocket connections and subscriptions, and renew online.",
    "Token 仅脱敏显示": "Token is always masked",
    "支付成功自动续期": "Automatic renewal after payment",
    "账户登录": "Account sign-in",
    "验证账户凭证": "Verify your account",
    "用户 ID 与注册手机号共同构成唯一登录凭证。邮箱可选填写。": "Your user ID and registration phone number identify your account. Email is optional.",
    "用户 ID": "User ID",
    "注册时使用的手机号": "Phone number used at registration",
    "通知邮箱（可选）": "Notification email (optional)",
    "Endpoint 变更、新 endpoint 上线及更多数据支持会通过此邮箱通知。": "We will use this email for endpoint changes, new releases, and expanded data support.",
    "验证中…": "Verifying…",
    "进入账户管理 →": "Open account management →",
    "进入账户管理": "Manage account",
    "还没有账号？": "Need an account?",
    "前往新用户注册": "Create one now",
    "有效期至": "Valid through",
    "到期时间不可用": "Expiry unavailable",
    "已到期": "Expired",
    "当前 REST 进程运行周期": "Current REST process cycle",
    "统计服务暂不可用": "Usage service unavailable",
    "实时历史请求": "Live historical requests",
    "当前账户在线连接": "Current online connections",
    "WS 统计服务暂不可用": "WebSocket usage unavailable",
    "当前活跃主题订阅": "Current active subscriptions",
    "通知邮箱": "Notification email",
    "邮箱为可选项。Endpoint 变更、新 endpoint 上线及更多数据支持会通过此邮箱通知。": "Email is optional. We will use it for endpoint changes, new releases, and expanded data support.",
    "保存中…": "Saving…",
    "更新邮箱": "Update email",
    "保存邮箱": "Save email",
    "续费与套餐调整": "Renew or change plan",
    "进入安全结账页选择套餐、时长和支付方式。支付成功后保留原 Token 并自动延长有效期。": "Open secure checkout to choose a plan, term, and payment method. After payment, your existing token stays the same and its expiry is extended automatically.",
    "续费 / 更换套餐 →": "Renew / change plan →",
    "最近申请": "Latest request",
    "套餐与时长": "Plan and term",
    "提交时间": "Submitted",
    "个月": "months",
    "刷新中…": "Refreshing…",
    "刷新实时用量": "Refresh live usage",
    "正在检查账户 session…": "Checking your account session…",
    "请求失败，请稍后重试。": "Request failed. Try again shortly.",
    "恺 Kai · leandata.uk": "Kai · leandata.uk",

    "正在准备安全结账页…": "Preparing secure checkout…",
    "配置套餐": "Choose plan",
    "无法打开结账页。": "Unable to open checkout.",
    "快捷支付": "Secure checkout",
    "由 Stripe 安全处理卡号与 CVV": "Card details and CVC are handled securely by Stripe",
    "扫码或 App 内确认": "Confirm by QR code or in the app",
    "卡支付币种": "Card currency",
    "Stripe 结账币种": "Stripe checkout currency",
    "套餐设置": "Plan settings",
    "套餐": "Plan",
    "/ 月": "/ month",
    "Value 数据方向": "Value data focus",
    "套餐时长": "Plan term",
    "注册账户": "New account",
    "续费账户": "Renewal account",
    "当前有效期": "Current expiry",
    "支付成功后自动": "After payment, automatically ",
    "创建账户并签发 Token": "create the account and issue a token",
    "保留原 Token 并延长有效期": "keep the existing token and extend its expiry",
    "无需管理员批准。": "—no administrator approval required.",
    "套餐已生效": "plan is active",
    "包含功能": "Included",
    "人民币套餐月价": "RMB monthly plan price",
    "Stripe 卡支付月价": "Stripe card monthly price",
    "订阅时长": "Subscription term",
    "今日应付金额": "Due today",
    "正在确认支付…": "Confirming payment…",
    "使用信用卡支付": "Pay by card",
    "支付宝支付": "Pay with Alipay",
    "微信支付": "WeChat Pay",
    "支付宝": "Alipay",
    "支付": "Pay",
    "信用卡 / 借记卡": "Credit or debit card",
    "等待 EasyPay 审核": "Awaiting EasyPay approval",
    "暂不可用": "Temporarily unavailable",
    "人民币套餐价与 Stripe 卡支付价分开计价；结账前会显示最终币种和金额。": "RMB plan pricing and Stripe card pricing are separate. The final currency and amount are shown before checkout.",
    "结账凭证已失效，请从注册页或账户管理页重新进入。": "This checkout link has expired. Start again from registration or account management.",
    "结账凭证已失效，请重新进入结账页。": "This checkout link has expired. Open checkout again.",
    "请选择有效的支付套餐。": "Choose a valid payment plan.",
    "请选择有效的支付方式。": "Choose a valid payment method.",
    "该支付方式尚未启用。": "This payment method is not enabled.",
    "支付宝正在等待 EasyPay 审核，暂时不能收款。": "Alipay is awaiting EasyPay approval and cannot accept payments yet.",
    "该支付方式暂时不可用。": "This payment method is temporarily unavailable.",
    "Stripe 仅支持 CAD 或 USD 结账。": "Stripe checkout supports CAD or USD only.",
    "该用户名已经开通，请使用账户管理续费。": "This username is already active. Renew through account management.",
    "Stripe 尚未配置。": "Stripe is not configured.",
    "Stripe 测试/正式密钥与 webhook secret 尚未配置。": "Stripe keys and webhook signing secret are not configured.",
    "无法创建 Stripe Checkout，请稍后重试。": "Unable to create Stripe Checkout. Try again shortly.",
    "卡号、有效期和 CVV 直接提交给 Stripe，Leandata 不读取也不保存。支付平台验签回调确认后自动开通；重复回调不会重复延长有效期。": "Your card number, expiry, and CVC go directly to Stripe. Leandata never reads or stores them. Access activates only after a signed payment confirmation, and duplicate notifications never extend the term twice.",
    "真实支付商户尚未配置；当前订单已创建，但不能在本地完成扣款。": "The live payment account is not configured. The order was created but cannot be charged locally.",
    "付款已确认，但自动开通暂时失败。": "Payment was confirmed, but automatic activation is temporarily unavailable.",
    "Stripe 正在确认付款；确认后账户会自动开通。": "Stripe is confirming your payment. The account will activate once confirmed.",
    "信用卡支付已取消，没有产生扣款。": "Card payment was cancelled and no charge was made.",
    "支付已完成": "Payment complete",
    "订单已经完成幂等履约。": "Your order has been fulfilled safely. ",
    "账户与数据访问 Token 已自动创建。": "Your account and data-access token were created automatically.",
    "原有 Token 保持不变，有效期已经自动延长。": "Your existing token is unchanged and its expiry has been extended.",
    "已激活": "Activated",
    "首次签发 Token": "Newly issued token",
    "Token 保持不变": "Token unchanged",
    "复制 Token": "Copy token",

    "这里展示 leandata.uk 公共域名下历史 REST、实时 REST 与安全 WebSocket 的健康状态。可用性按分钟采样，延迟分位数按 60 分钟滚动窗口计算。": "This page reports the health of historical REST, real-time REST, and secure WebSocket services on leandata.uk. Availability is sampled by the minute and latency percentiles use a rolling 60-minute window.",
    "指数期权合约查询与实时行情现已支持。": "Index-option contract lookup and real-time quotes are now supported.",
    "探针在状态页浏览时按需运行，每 30 秒自动刷新。REST 检查服务健康端点，WS 检查公开安全 WebSocket 路由。可用性按天聚合，展示 90 天。": "Health probes run on demand while the status page is open and refresh every 30 seconds. REST checks the health endpoint, WebSocket checks the public secure route, and availability is aggregated daily over 90 days.",
    "Bulk Download 是一次性数据导出，不再作为 Basic REST 月度套餐销售。": "Bulk Download is a one-time data export and is no longer sold as the Basic monthly REST plan.",
    "当前估价基于已测量的 2021-01-01 至 2026-07-22 完整归档窗口：": "The current estimate is based on the measured full archive from 2021-01-01 through 2026-07-22:",
    "前 50 GB 为 ¥50，之后每开始 1 GB 加 ¥1。最终价格按实际交付切片的未压缩字节计算。": "The first 50 GB costs ¥50, then each additional started GB costs ¥1. Final pricing uses the uncompressed bytes in the delivered slice.",
    "最多 1,000 个": "up to 1,000",
    "当前自动估价使用完整参考窗口；日期范围会保存在订单中，由交付时按实际切片结算。": "The automatic estimate uses the full reference window. Your requested dates are saved with the order and priced from the delivered slice.",
    "没找到需要的 endpoint / dataset？": "Need a different endpoint or dataset?",
    "可以不选择上面的标准数据集。提交后会进入 admin，由 Kai 根据你留下的电话和邮箱人工联系报价。": "You can submit without selecting a standard dataset. Kai will use your phone and email to confirm the scope and provide a manual quote.",
    "标准数据集可生成参考估价；自定义 endpoint 申请会直接进入人工报价队列。订单提交时服务器会重新计算标准数据集价格，不能使用浏览器篡改后的价格。": "Standard datasets receive a reference estimate; custom endpoint requests enter the manual quote queue. The server recalculates all standard pricing when you submit.",
    "标准数据集可生成参考估价；自定义 endpoint 申请会直接进入人工报价队列。": "Standard datasets receive a reference estimate; custom endpoint requests enter the manual quote queue.",
    "订单提交时服务器会重新计算标准数据集价格，不能使用浏览器篡改后的价格。": "The server recalculates standard dataset pricing when the order is submitted; browser-side price changes are ignored.",
    "联系方式用于确认数据范围、交付格式和最终报价。": "We use your contact details to confirm data scope, delivery format, and final pricing.",
    "请选择至少一个数据集，或填写自定义 endpoint / 数据需求。": "Select at least one dataset or describe a custom endpoint or data request.",
    "请输入有效邮箱。": "Enter a valid email address.",
    "待确认": "pending confirmation",
    "人工报价": "manual quote",
    "当前价格": "Current price",
    "待人工报价": "Manual quote pending",
    "可直接描述需求，例如：": "Describe your request directly. For example:",
    "需要 /v1/options/snapshot/gex 的历史每日快照，标的为 SPY、QQQ，日期 2024-01-01 至今，希望 CSV 交付。": "I need daily historical /v1/options/snapshot/gex snapshots for SPY and QQQ from 2024-01-01 to the present, delivered as CSV.",
    "Stock Options Proxy 提供两类服务：Token 门户负责注册、账户与 Token；数据代理通过稳定的公共域名提供历史 REST、实时 REST 与安全 WebSocket 行情。": "Stock Options Proxy has two services: the token portal handles registration, accounts, and tokens; the data proxy provides historical REST, real-time REST, and secure WebSocket feeds through stable public domains.",
    "历史 REST、实时 REST 与 WebSocket 均使用稳定域名和同一 Token。故障切换时源站与缓存层可能调整，客户端不应绑定裸 IP。": "Historical REST, real-time REST, and WebSocket use stable domains and the same token. Origins and cache layers may change during failover, so clients must not bind to raw IP addresses.",
    "所有数据接口（REST 和 WS）都需要 UUID Token，可通过 HTTP Header 或 JSON Body 传递。": "Every data interface (REST and WebSocket) requires a UUID token supplied through an HTTP header or JSON body.",
    "公开注册提供四种 Token 套餐。Basic 仅为老账户兼容，不再开放新注册；批量导出请使用上方独立的 Bulk Download。": "Public registration offers four token plans. Basic remains for legacy accounts only and is closed to new registrations; use the separate Bulk Download service for exports.",
    "提交新账户注册申请；请求会进入待审核队列，由管理员审核后开通。": "Submit a new account registration request. It enters the review queue and activates after approval.",
    "在尝试生成 Token 之前，查询账户的审核状态。": "Check an account's review status before trying to generate a token.",
    "凭已审核通过的账号信息换取 30 天有效期的 UUID Token。该用户已签发的 Token 会原样返回，不会重新生成。": "Exchange approved account details for a UUID token valid for 30 days. If a token already exists, the same token is returned rather than regenerated.",
    "获取美股历史 OHLCV K线数据。支持自动分页，结果缓存 5 分钟。数据源：Alpaca SIP。": "Retrieve historical US equity OHLCV bars with automatic pagination and a five-minute cache. Source: Alpaca SIP.",
    "获取 CBOE 官方现金指数日线。支持 SPX、VIX、VIX3M；这是指数值，不是期权链或 VIX 期货。SPX 官方文件仅含收盘价。": "Retrieve official CBOE cash-index daily data for SPX, VIX, and VIX3M. These are index values, not option chains or VIX futures; the official SPX file contains closing values only.",
    "获取历史新闻文章。来源：Benzinga via Alpaca。所有套餐可用。支持自动分页，每页最多 50 篇。": "Retrieve historical news from Benzinga via Alpaca. Available on every plan with automatic pagination up to 50 articles per page.",
    "单只股票的合并历史成交+报价数据。并行从 Alpaca 拉取 trades 和 quotes 自动分页，单次返回。支持服务端缓存。": "Retrieve combined historical trades and quotes for one stock. Trades and quotes are paginated from Alpaca in parallel and returned together with server-side caching.",
    "以下股票数据接口均按 Alpaca native GET 路径开放。响应结构保持 Alpaca 原样，鉴权和服务端缓存由代理统一处理。": "The following equity endpoints expose Alpaca-native GET paths. Responses retain the Alpaca structure while the proxy handles authentication and caching.",
    "两个上游共享同一层代理。下表只列需要 dual-provider 路由/回退判断的端点；纯 Alpaca 透传端点在各自章节展开。": "Both upstreams share the same proxy layer. This table covers endpoints that require dual-provider routing or fallback; pure Alpaca pass-through endpoints appear in their own sections.",
    "列出指定标的的活跃期权合约。默认 Alpaca，失败时回退到 ThetaData Value 合约列表。": "List active option contracts for an underlying. Alpaca is used by default with fallback to the ThetaData Value contract list.",
    "期权合约历史 OHLCV K线。默认 ThetaData Value，必要时回退 Alpaca。支持 OCC 或股票代码自动解析，并写入服务端缓存。": "Retrieve historical option-contract OHLCV bars. ThetaData Value is the default with Alpaca fallback. OCC symbols and stock tickers are resolved automatically and results are cached.",
    "ThetaData Value 仅支持 1Day 日线。分钟级（1Min/5Min/15Min/1Hour）会返回\"No data found\"。如需分钟级期权 K 线，请指定 provider: \"alpaca\"（数据从 2024-02-01 起）。": "ThetaData Value supports 1Day bars only. Intraday requests (1Min/5Min/15Min/1Hour) return \"No data found\". For intraday option bars, set provider to \"alpaca\"; data starts on 2024-02-01.",
    "按日期范围和行权价/到期日筛选历史持仓量。": "Filter historical open interest by date range, strike, and expiration.",
    "期权合约日终 OHLC 汇总。数据源 ThetaData Value，写入服务端缓存。也可走旧别名 /v1/options/eod。": "Retrieve end-of-day option-contract OHLC summaries from ThetaData Value with server-side caching. The legacy /v1/options/eod alias is also supported.",
    "Alpaca 历史期权逐笔成交数据。Alpaca 历史期权数据从 2024-02-01 开始；无 ThetaData 备用源。若查询时间过早或数据集为空，返回标准空响应。": "Retrieve historical option trades from Alpaca. Data begins on 2024-02-01 and has no ThetaData fallback; earlier or empty queries return the standard empty response.",
    "每个合约的完整快照：最新成交、最新报价、希腊值与隐含波动率。只需单项时改用下方子端点。": "Retrieve a full snapshot for each contract: latest trade, latest quote, Greeks, and implied volatility. Use the child endpoints below when only one field is needed.",
    "期权合约最新 NBBO 报价。只有明确需要 ThetaData Value 时才设置 feed: \"thetadata\"。": "Retrieve the latest NBBO quote for option contracts. Set feed to \"thetadata\" only when ThetaData Value is specifically required.",
    "期权合约最新成交，归一化到 snapshots[OCC].latestTrade。": "Retrieve the latest option trade normalized to snapshots[OCC].latestTrade.",
    "期权合约最新持仓量。仅 ThetaData，必须设 feed: \"thetadata\"。": "Retrieve latest option open interest. This is ThetaData-only and requires feed: \"thetadata\".",
    "便捷接口：一次性获取指定标的在特定到期日的所有合约快照。会先解析合约列表，再批量请求快照（每批 100 个标的）。": "Convenience endpoint that retrieves every contract snapshot for an underlying and expiration. It resolves contracts first, then requests snapshots in batches of 100 symbols.",
    "ThetaData Value 期权白名单代理，仅开放 Value 订阅允许的端点。支持 GET/POST，成功 JSON 响应写入服务端缓存。": "Allowlisted proxy for ThetaData Value option endpoints. GET and POST are supported and successful JSON responses are cached.",
    "美国加密货币对的最新 L2 订单簿快照。仅限 Premium 套餐。每侧订单簿为按价格排序的对象数组。": "Retrieve the latest L2 order-book snapshot for US crypto pairs. Premium only. Each side is a price-sorted array of objects.",
    "美国加密货币对的最新 L2 订单簿快照。仅限 Premium 套餐。每侧订单簿为按价格排序的": "Retrieve the latest L2 order-book snapshot for US crypto pairs. Premium only. Each side is a price-sorted ",
    "对象数组。": "array of objects.",
    "获取管理员面板的会话 Token。密码通过 ADMIN_PASSWORD 环境变量设置。": "Get a session token for the admin console. The password is configured with ADMIN_PASSWORD.",
    "列出待审批的注册申请。": "List pending registration requests.",
    "批准一条待处理的注册申请；自动写入用户数据库并签发 Token，返回值可直接发给用户。": "Approve a pending registration, write it to the user database, and issue a token.",
    "拒绝一条待处理的注册申请，可附带原因。": "Reject a pending registration with an optional reason.",
    "代理返回的常见 HTTP 状态码及其触发场景。": "Common HTTP status codes returned by the proxy and the conditions that trigger them.",
    "收到 HTTP 429 说明触发了限速：超过了套餐的每分钟 REST 配额或并发上限。请等待 60 秒滚动窗口刷新或等已有请求完成后再重试，不要持续重试。": "HTTP 429 means the plan's per-minute REST quota or concurrency limit was reached. Wait for the 60-second rolling window or for in-flight requests to finish before retrying.",
    "每秒换算：Basic 10/s · Value 30/s · Standard 30/s · Premium 100/s。超过每分钟配额或并发上限会返回": "Per-second equivalents: Basic 10/s · Value 30/s · Standard 30/s · Premium 100/s. Exceeding the per-minute quota or concurrency cap returns ",
    "，请等待 60 秒窗口刷新后再重试。": "; wait for the 60-second window before retrying.",
    "REST 限速按用户、按 60 秒滚动窗口计算。服务器负载升高时自动收紧，极端负载下进一步收紧。WS 标的订阅数单独计算，重连后不会重置。": "REST limits are calculated per user over a rolling 60-second window and tighten automatically under server load. WebSocket symbol subscriptions are counted separately and do not reset after reconnecting.",
    "除限速外，代理还对 REST 和 WebSocket 实施每用户并发限制。REST 并发限制同时在途请求数；WS 并发限制所有通道的同时连接数。": "In addition to rate limits, the proxy applies per-user concurrency limits. REST limits in-flight requests; WebSocket limits simultaneous connections across all channels.",
    "代理返回缓存响应不到 1ms，客户端感知到的延迟主要来自网络往返和 TLS 握手。以下建议可将 TTFB 降低 50–80%。": "Cached proxy responses take under 1 ms on the server; client-perceived latency is mostly network round trips and TLS handshakes. The following practices can reduce TTFB by 50–80%.",
    "对同时支持 GET 与 POST 的端点，幂等历史查询优先使用 GET。重复请求可能命中热缓存或归档缓存，请查看 X-Cache / X-Cache-Tier，不要依赖特定边缘供应商。": "For endpoints that support both GET and POST, prefer GET for idempotent historical queries. Repeated requests may hit hot or archive cache; inspect X-Cache and X-Cache-Tier rather than assuming an edge provider.",
    "每个新 HTTPS 请求需约 100ms 用于 TCP + TLS 握手。使用持久连接（HTTP/2 或 keep-alive）可将此开销分摊到所有请求。": "Each new HTTPS request spends about 100 ms on TCP and TLS setup. Persistent HTTP/2 or keep-alive connections amortize this cost across requests.",
    "提供两个 REST 基础 URL，根据查询类型选择合适的。": "Two REST base URLs are available; choose the one appropriate for the query type.",

    "Admin 登录": "Admin sign-in",
    "管理员密码": "Admin password",
    "输入密码": "Enter password",
    "密码错误，请重试。": "Incorrect password. Try again.",
    "登录": "Sign in",
    "审核后台": "Review console",
    "待审核": "Pending",
    "已批准": "Approved",
    "Bulk 待处理": "Bulk pending",
    "刷新数据": "Refresh data",
    "刷新": "Refresh",
    "同步 users.json 到 ThinkCentre 并刷新": "Sync users.json to ThinkCentre and refresh",
    "同步": "Sync",
    "全部记录": "All records",
    "Bulk 下载": "Bulk downloads",
    "Email 公告": "Email announcements",
    "关闭": "Close",
    "Bulk 下载申请": "Bulk download requests",
    "这里显示公开 Bulk 页面提交的标准数据订单和自定义 endpoint 需求，并保留申请人的电话与邮箱供你人工报价。": "Standard dataset orders and custom endpoint requests submitted through the public Bulk page appear here with contact details for manual quoting.",
    "刷新申请": "Refresh requests",
    "正在加载 Bulk 申请…": "Loading Bulk requests…",
    "默认选择所有有有效邮箱的注册用户（包括已过期账号），也可添加一次性收件邮箱。": "All registered users with a valid email are selected by default, including expired accounts. One-time recipients can also be added.",
    "正在检查 SMTP": "Checking SMTP",
    "邮件内容": "Email content",
    "发件人：": "From:",
    "恢复模板": "Restore template",
    "收件人": "Recipients",
    "加载中…": "Loading…",
    "搜索用户或邮箱": "Search users or email",
    "全选": "Select all",
    "清空": "Clear",
    "正在读取 registry…": "Reading registry…",
    "手动添加邮箱": "Add email manually",
    "称呼（可选）": "Name (optional)",
    "添加": "Add",
    "不可发送用户": "Unavailable recipients",
    "发送控制": "Delivery controls",
    "先预览，再确认发送": "Preview before sending",
    "已选择": "Selected",
    "尚未预览": "Not previewed",
    "测试发送至": "Send test to",
    "测试发送": "Send test",
    "生成发送预览": "Generate preview",
    "确认正式发送": "Confirm live send",
    "正式发送会逐个投递。任何内容或收件人变化都会使旧快照失效，必须重新预览。": "Messages are delivered individually. Any content or recipient change invalidates the previous snapshot and requires a new preview.",
    "发送预览": "Delivery preview",
    "展示第一位收件人的个性化正文": "Shows the personalized message for the first recipient",
    "位收件人": "recipients",
    "连接失败，请检查网络。": "Connection failed. Check your network.",
    "公告后台": "Announcement console",
    "Bulk 订单后台": "Bulk order console",
    "加载失败:": "Load failed:",
    "已拒绝": "Rejected",
    "暂无记录": "No records",
    "批准": "Approve",
    "拒绝": "Reject",
    "拒绝原因（可选）": "Reason (optional)",
    "确认拒绝": "Confirm rejection",
    "取消": "Cancel",
    "原因": "Reason",
    "手机": "Phone",
    "注册": "Registered",
    "请求失败": "Request failed",
    "同步成功": "Sync complete",
    "同步失败": "Sync failed",
    "订单": "Order",
    "申请": "Request",
    "并发上限": "Concurrency limit",
    "剩余": "Remaining",
    "天": "days",
    "没有匹配的用户": "No matching users",
    "当前没有带有效邮箱的活跃用户": "No active users currently have a valid email",
    "无期限": "No expiry",
    "报价与处理": "Quote and fulfillment",
    "标记已报价 / 已联系": "Mark quoted / contacted",
    "标记已交付": "Mark delivered",
    "交付备注": "Delivery notes",
    "未指定 ticker": "No ticker specified",
    "自定义 endpoint / 数据需求": "Custom endpoint / data request",
    "Admin 备注": "Admin notes",
    "leandata.uk 更新 / Service update": "leandata.uk service update",

    // Navigation and buttons
    "Docs": "文档",
    "Status": "状态",
    "Usage": "用量",
    "Open Portal": "打开入口",
    "Manage account →": "管理账户 →",
    "Admin →": "管理后台 →",
    "Token portal →": "Token 入口 →",
    "Proxy API": "代理 API",
    "FMP data": "FMP 数据",
    "Bulk Download": "批量下载",
    "WS usage": "WS 用法",
    "Proxy Docs": "代理文档",

    // Token page
    "Get your": "获取您的",
    "access": "访问",
    "token": "令牌",
    "Approved accounts only. Enter the username and phone number on file — we'll mint a fresh UUID and push it to the upstream proxy.": "仅限已审核账户。输入注册时的用户名和手机号，我们将生成新的 UUID 并推送到上游代理。",
    "Username": "用户名",
    "Phone number": "手机号",
    "Generate token →": "生成令牌 →",
    "Generating...": "生成中...",
    "Please enter both username and phone number.": "请输入用户名和手机号。",
    "Network error or server is down. Please try again later.": "网络错误或服务器停机。请稍后重试。",
    "Token copied to clipboard!": "令牌已复制到剪贴板！",
    "Access · 30 day token": "访问 · 30 天令牌",

    // Status labels
    "Operational": "正常运行",
    "Degraded": "性能下降",
    "Outage": "服务中断",
    "Loading…": "加载中…",

    // Docs sections
    "The": "该",
    "Proxy API": "代理 API",
    "covers REST endpoints and tier management;": "涵盖 REST 端点和套餐管理；",
    "WS usage": "WS 用法",
    "covers the 6 realtime streaming channels.": "涵盖 6 个实时流通道。"
  }));

  const orderedTranslations = [...translations.entries()]
    .sort((left, right) => right[0].length - left[0].length);

  function readLanguage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "zh") return stored;
    } catch (_) {}
    return "zh";
  }

  let language = readLanguage();

  function translateDynamic(value) {
    let output = value
      .replace(/剩余\s*(\d+)\s*天/g, "$1 days remaining")
      .replace(/(\d+)\s*个月/g, (_, count) => `${count} ${Number(count) === 1 ? "month" : "months"}`)
      .replace(/(\d{4})年(\d{1,2})月(\d{1,2})日/g, (_, year, month, day) => {
        const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
        return new Intl.DateTimeFormat("en-CA", {
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: "UTC",
        }).format(date);
      })
      .replace(/并发上限\s*(\d+)/g, "Concurrency limit $1")
      .replace(/当前估价\s*¥/g, "Current estimate ¥")
      .replace(/订单\s*([A-Za-z0-9-]+)\s*已提交/g, "Order $1 submitted")
      .replace(/申请\s*([A-Za-z0-9-]+)\s*已提交/g, "Request $1 submitted")
      .replace(/Kai 会根据联系方式与你确认并人工报价/g, "Kai will contact you to confirm the scope and provide a quote");
    for (const [source, target] of orderedTranslations) {
      if (output.includes(source)) output = output.split(source).join(target);
    }
    output = output
      .replace(/[\s·]*无需管理员批准。/g, " · no administrator approval required.");
    return output;
  }

  function shouldSkip(node) {
    const parent = node.parentElement;
    if (!parent) return true;
    return Boolean(parent.closest(
      "script, style, noscript, pre, code, textarea, [data-no-i18n], #leandata-language-switcher"
    ));
  }

  function applyTextNode(node) {
    if (shouldSkip(node)) return;
    if (language === "zh") {
      if (originalText.has(node)) node.nodeValue = originalText.get(node);
      return;
    }
    const current = node.nodeValue || "";
    if (!CJK_RE.test(current)) return;
    if (!originalText.has(node)) originalText.set(node, current);
    const trimmed = current.trim();
    if (trimmed === "新用户") {
      node.nodeValue = current.replace("新用户", "Create your");
    } else if (trimmed === "注册" && node.parentElement?.closest("h1")) {
      node.nodeValue = current.replace("注册", "account");
    } else if (trimmed === "的") {
      node.nodeValue = current.replace("的", "'s");
    } else {
      node.nodeValue = translateDynamic(current);
    }
  }

  const translatedAttributes = ["placeholder", "title", "aria-label", "aria-description"];

  function applyElementAttributes(element) {
    if (!(element instanceof Element) || element.closest("[data-no-i18n], #leandata-language-switcher")) return;
    let originals = originalAttributes.get(element);
    if (!originals) {
      originals = {};
      originalAttributes.set(element, originals);
    }
    for (const attribute of translatedAttributes) {
      if (!element.hasAttribute(attribute)) continue;
      if (language === "zh") {
        if (Object.prototype.hasOwnProperty.call(originals, attribute)) {
          element.setAttribute(attribute, originals[attribute]);
        }
        continue;
      }
      const current = element.getAttribute(attribute) || "";
      if (!CJK_RE.test(current)) continue;
      if (!Object.prototype.hasOwnProperty.call(originals, attribute)) originals[attribute] = current;
      element.setAttribute(attribute, translateDynamic(current));
    }
  }

  function applyNode(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      applyTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) applyElementAttributes(root);
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
    );
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) applyTextNode(node);
      else applyElementAttributes(node);
      node = walker.nextNode();
    }
  }

  function renderSwitcher() {
    let switcher = document.getElementById("leandata-language-switcher");
    if (!switcher) {
      switcher = document.createElement("div");
      switcher.id = "leandata-language-switcher";
      switcher.setAttribute("data-no-i18n", "true");
      switcher.setAttribute("role", "group");
      switcher.setAttribute("aria-label", "Language / 语言");
      switcher.innerHTML = `
        <span class="ld-language-icon" aria-hidden="true">◎</span>
        <button type="button" data-language="zh">中文</button>
        <span class="ld-language-divider" aria-hidden="true"></span>
        <button type="button" data-language="en">EN</button>
      `;
      switcher.addEventListener("click", event => {
        const button = event.target.closest("button[data-language]");
        if (button) setLanguage(button.dataset.language);
      });
      document.body.appendChild(switcher);
    }
    switcher.querySelectorAll("button[data-language]").forEach(button => {
      const selected = button.dataset.language === language;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function injectStyle() {
    if (document.getElementById("leandata-language-style")) return;
    const style = document.createElement("style");
    style.id = "leandata-language-style";
    style.textContent = `
      #leandata-language-switcher {
        position: fixed;
        right: max(18px, env(safe-area-inset-right));
        bottom: max(18px, env(safe-area-inset-bottom));
        z-index: 2147483646;
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 5px;
        color: #31302d;
        background: rgba(255, 255, 255, .92);
        border: 1px solid rgba(20, 20, 20, .14);
        border-radius: 999px;
        box-shadow: 0 10px 28px rgba(20, 20, 20, .12), 0 1px 2px rgba(20, 20, 20, .08);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        font: 600 11px/1 "IBM Plex Sans", Inter, system-ui, sans-serif;
        letter-spacing: .02em;
      }
      #leandata-language-switcher .ld-language-icon {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        color: #72706a;
        font-size: 16px;
      }
      #leandata-language-switcher .ld-language-divider {
        width: 1px;
        height: 14px;
        background: rgba(20, 20, 20, .12);
      }
      #leandata-language-switcher button {
        appearance: none;
        min-width: 38px;
        height: 30px;
        padding: 0 9px;
        border: 0;
        border-radius: 999px;
        color: #77746f;
        background: transparent;
        cursor: pointer;
        font: inherit;
        transition: color .15s ease, background .15s ease, box-shadow .15s ease;
      }
      #leandata-language-switcher button:hover {
        color: #171716;
        background: rgba(20, 20, 20, .05);
      }
      #leandata-language-switcher button.active {
        color: #fff;
        background: #171716;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .08);
      }
      #leandata-language-switcher button:focus-visible {
        outline: 2px solid #635bff;
        outline-offset: 2px;
      }
      @media (max-width: 640px) {
        #leandata-language-switcher {
          right: max(12px, env(safe-area-inset-right));
          bottom: max(12px, env(safe-area-inset-bottom));
        }
      }
      @media (prefers-reduced-motion: reduce) {
        #leandata-language-switcher button { transition: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function applyLanguage() {
    if (applying) return;
    applying = true;
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    applyNode(document.body);
    if (language === "en") {
      if (!document.documentElement.dataset.ldOriginalTitle) {
        document.documentElement.dataset.ldOriginalTitle = document.title;
      }
      document.title = translateDynamic(document.title);
    } else if (document.documentElement.dataset.ldOriginalTitle) {
      document.title = document.documentElement.dataset.ldOriginalTitle;
    }
    renderSwitcher();
    applying = false;
  }

  function setLanguage(nextLanguage) {
    if (nextLanguage !== "en" && nextLanguage !== "zh") return;
    language = nextLanguage;
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch (_) {}
    applyLanguage();
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { language } }));
  }

  function start() {
    injectStyle();
    renderSwitcher();
    applyLanguage();
    const observerOptions = {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: translatedAttributes,
    };
    const observer = new MutationObserver(mutations => {
      if (applying) return;
      observer.disconnect();
      applying = true;
      for (const mutation of mutations) {
        if (mutation.type === "characterData") applyTextNode(mutation.target);
        for (const node of mutation.addedNodes) applyNode(node);
        if (mutation.type === "attributes") applyElementAttributes(mutation.target);
      }
      applying = false;
      if (document.body) observer.observe(document.body, observerOptions);
    });
    observer.observe(document.body, observerOptions);
    languageObserver = observer;
  }

  window.LeandataI18n = {
    getLanguage: () => language,
    setLanguage,
    translate: value => language === "en" ? translateDynamic(String(value ?? "")) : String(value ?? ""),
    destroy: () => {
      languageObserver?.disconnect();
      languageObserver = null;
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
