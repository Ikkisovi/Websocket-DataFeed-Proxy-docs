(() => {
  "use strict";

  const STORAGE_KEY = "leandata.language";
  const EVENT_NAME = "leandata:languagechange";
  const CJK_RE = /[\u3400-\u9fff]/;
  const LATIN_LETTER_RE = /[A-Za-z]/;
  const originalText = new WeakMap();
  const originalAttributes = new WeakMap();
  let applying = false;
  let languageObserver = null;

  const translations = new Map(Object.entries({
    "新用户注册 — Stock Options Proxy": "Create an account — Leandata",
    "账户管理 — Leandata Proxy": "Account management — Leandata",
    "配置套餐 — Leandata": "Choose a plan — Leandata",
    "Admin — 审核后台": "Admin — Review console",
    "更新与留言 — Leandata": "Updates and feedback — Leandata",

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
    "全部 WS 通道 + REST 股票或期权二选一": "All WS channels + either stock or option REST",
    "stocks history 或 options chains": "stock history or option chains",
    "股票方向": "Stocks",
    "期权方向": "Options",
    "全部 WS + REST 仅股票历史": "All WS channels + stock history REST",
    "全部 WS + REST 仅期权历史": "All WS channels + option history REST",
    "主流套餐": "Most popular",
    "全部 WS 通道 · 50 symbols · stocks + options 历史": "All WS channels · 50 symbols · stock and option history",
    "全部 WS 通道 · 每连接 500 subjects · stocks + options 历史": "All WS channels · 500 subjects per connection · stock and option history",
    "完整接入": "Full access",
    "全部 WS 通道 · 500 symbols · 全部 REST 含 crypto": "All WS channels · 500 symbols · all REST including crypto",
    "全部 WS 通道 · 每连接 500 subjects · 全部 REST 含 crypto": "All WS channels · 500 subjects per connection · all REST including crypto",
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
    "主流研究与交易工作流": "Core research and trading workflows",
    "股票与期权历史数据": "Stock and option history",
    "完整数据权限与最高容量": "Complete data access and highest capacity",
    "完整 REST 数据范围": "Complete REST data coverage",
    "500 symbols 实时订阅": "500 real-time symbol subscriptions",
    "每连接最多 500 subjects": "Up to 500 subjects per connection",
    "WS 不设账号级连接数上限": "No account-level WebSocket connection cap",
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
    "Leandata 提供两类核心服务：<strong>Token 门户</strong>负责账户注册与 Token 签发管理；<strong>行情代理</strong>通过稳定公共域名提供历史 REST、实时 REST 与 WebSocket 实时行情流。使用单一 Token 即可访问全部数据接口，无需自行配置第三方凭证。": "Leandata provides two core capabilities: a token portal for account management and access tokens, and a high-performance market data proxy for historical REST, realtime REST, and WebSocket streaming. Authenticate with a single token across all services without managing third-party credentials.",
    "Stock Options Proxy 提供两类服务：Token 门户负责注册、账户与 Token；数据代理通过稳定的公共域名提供历史 REST、实时 REST 与安全 WebSocket 行情。": "Leandata provides two core capabilities: a token portal for account management and access tokens, and a high-performance market data proxy for historical REST, realtime REST, and WebSocket streaming.",
    "历史 REST、实时 REST 与 WebSocket 均使用稳定域名和同一 Token。故障切换时源站与缓存层可能调整，客户端不应绑定裸 IP。": "Historical REST, real-time REST, and WebSocket use stable domains and the same token. Origins and cache layers may change during failover, so clients must not bind to raw IP addresses.",
    "所有数据接口（REST 和 WS）都需要 UUID Token，可通过 HTTP Header 或 JSON Body 传递。": "Every data interface (REST and WebSocket) requires a UUID token supplied through an HTTP header or JSON body.",
    "公开注册提供四种 Token 套餐。Basic 仅为老账户兼容，不再开放新注册；批量导出请使用上方独立的 Bulk Download。": "Public registration offers four token plans. Basic remains for legacy accounts only and is closed to new registrations; use the separate Bulk Download service for exports.",
    "提交新账户注册申请；请求会进入待审核队列，由管理员审核后开通。": "Submit a new account registration request. It enters the review queue and activates after approval.",
    "在尝试生成 Token 之前，查询账户的审核状态。": "Check an account's review status before trying to generate a token.",
    "凭已审核通过的账号信息换取 30 天有效期的 UUID Token。该用户已签发的 Token 会原样返回，不会重新生成。": "Exchange approved account details for a UUID token valid for 30 days. If a token already exists, the same token is returned rather than regenerated.",
    "获取美股历史 OHLCV K 线数据（全市场 SIP 官方聚合行情，已复权）。支持自动分页与多级服务端缓存，响应头可通过 <code>X-Cache</code> 查看缓存命中状态。": "Retrieve historical US equity OHLCV bars (SIP consolidated feed, split/dividend adjusted) with automatic pagination and multi-tier server-side caching.",
    "获取 CBOE 官方现金指数日线。支持 SPX、VIX、VIX3M；这是指数值，不是期权链或 VIX 期货。SPX 官方文件仅含收盘价。": "Retrieve official CBOE cash-index daily data for SPX, VIX, and VIX3M. These are index values, not option chains or VIX futures; the official SPX file contains closing values only.",
    "获取历史新闻文章，所有套餐可用。支持自动分页，每页最多 50 篇。": "Retrieve historical news articles. Available on all plans with automatic pagination up to 50 articles per page.",
    "单只股票的合并历史成交与报价数据。服务端并行拉取 trades 和 quotes 自动分页并聚合返回，支持服务端多级缓存。": "Retrieve combined historical trades and quotes for a single stock. Trades and quotes are fetched in parallel, paginated, and returned together with server-side caching.",
    "以下股票行情接口均通过标准 <code>GET</code> 路径开放。响应结构遵循官方全市场行情规范，鉴权、多级服务端缓存与并发控制由代理统一处理。": "The following equity endpoints expose standard GET routes. Responses adhere to the official market-data structure while authentication and caching are handled by the proxy.",
    "底层行情接入多源专业数据链路，由代理网关统一处理鉴权、多级缓存（热点内存 + 历史海量归档）与并发调度：": "Market data is unified behind a high-availability proxy layer handling authentication, multi-tier caching (hot memory + historical archive), and automated routing:",
    "查询指定标的当前活跃期权合约（包含 OCC 代码、行权价、到期日、未平仓合约数等）。获取的 OCC 代码可直接用于查询快照或历史 K 线。历史到期合约请使用 <code>/v3/option/list/contracts/*</code>。": "List current active option contracts for an underlying. The returned OCC symbol can be passed directly to snapshots or historical bars.",
    "按 OCC 合约代码查询期权历史 OHLCV K 线。接口统一返回标准 1 分钟（1Min）K 线，多周期聚合请在客户端进行重采样（如使用 pandas.resample）。": "Retrieve historical OHLCV bars for OCC option contracts. Returns standard 1-minute resolution bars; client-side resampling should be used for higher timeframe aggregations.",
    "期权历史 K 线固定返回 1Min。传入 5Min 等旧参数时会归一化为 1Min；如需其他周期请客户端自行重采样。": "Option history bars return 1Min only. Legacy timeframe values such as 5Min are normalized to 1Min; clients must resample locally.",
    "按日期范围和行权价/到期日筛选期权历史未平仓合约数（Open Interest）。": "Filter historical open interest by date range, strike, and expiration.",
    "按日期范围和行权价/到期日筛选历史持仓量。": "Filter historical open interest by date range, strike, and expiration.",
    "期权合约日终（EOD）行情汇总，包含开高低收、成交量、买卖盘报价及成交笔数。支持 GET 与 POST。": "Retrieve end-of-day option-contract OHLC summaries with server-side caching. Supports GET and POST.",
    "按 OCC 合约代码查询历史期权逐笔成交明细（Trade Ticks）。": "Retrieve historical option trade ticks by OCC symbol.",
    "单个合约的全量实时快照：包含最新成交、最新报价、希腊字母风险指标（Delta, Gamma, Theta, Vega, Rho）及隐含波动率（IV）。": "Full snapshot per contract: latest trade, latest quote, Greeks (delta, gamma, theta, vega, rho), and implied volatility.",
    "每个合约的完整快照：最新成交、最新报价、希腊值与隐含波动率。只需单项时改用下方子端点。": "Retrieve a full snapshot for each contract: latest trade, latest quote, Greeks, and implied volatility.",
    "期权合约最新 NBBO 报价，统一归一化到 snapshots[OCC].latestQuote。": "Latest NBBO quote per contract, normalized to snapshots[OCC].latestQuote.",
    "期权合约最新成交，归一化到 snapshots[OCC].latestTrade。": "Retrieve the latest option trade normalized to snapshots[OCC].latestTrade.",
    "期权合约最新持仓量（OI 快照）。": "Retrieve latest option open interest (OI snapshot).",
    "便捷接口：一次性获取指定标的在特定到期日的所有合约快照（自动解析合约链并批量请求快照）。": "Convenience endpoint that retrieves every contract snapshot for an underlying and expiration.",
    "便捷接口：一次性获取指定标的在特定到期日的所有合约快照。会先解析合约列表，再批量请求快照（每批 100 个标的）。": "Convenience endpoint that retrieves every contract snapshot for an underlying and expiration.",
    "期权原生参数查询接口：支持直接使用标的代码、到期日（YYMMDD）、行权价与权利类型（C/P）组合查询，无需拼接 OCC 字符串。支持 GET 与 POST。": "Direct parameter endpoints for options data querying (root, expiration, strike, right) with structured JSON output.",
    "美国加密货币对的最新 L2 订单簿快照。仅限 Premium 套餐。每侧订单簿为按价格排序的对象数组。": "Retrieve the latest L2 order-book snapshot for US crypto pairs. Premium only. Each side is a price-sorted array of objects.",
    "美国加密货币对的最新 L2 订单簿快照。仅限 Premium 套餐。每侧订单簿为按价格排序的": "Retrieve the latest L2 order-book snapshot for US crypto pairs. Premium only. Each side is a price-sorted ",
    "对象数组。": "array of objects.",
    "获取管理员面板的会话 Token。密码通过 ADMIN_PASSWORD 环境变量设置。": "Get a session token for the admin console. The password is configured with ADMIN_PASSWORD.",
    "列出待审批的注册申请。": "List pending registration requests.",
    "批准一条待处理的注册申请；自动写入用户数据库并签发 Token，返回值可直接发给用户。": "Approve a pending registration, write it to the user database, and issue a token.",
    "拒绝一条待处理的注册申请，可附带原因。": "Reject a pending registration with an optional reason.",
    "代理返回的常见 HTTP 状态码及其触发场景。": "Common HTTP status codes returned by the proxy and the conditions that trigger them.",
    "收到 HTTP 429 表示触发了运行时限制，常见原因是账号历史 REST 并发达到上限。请等待在途请求完成并使用指数退避。": "HTTP 429 means an enforced runtime limit was reached, typically the per-account historical REST concurrency cap. Wait for in-flight requests to finish before retrying.",
    "收到 HTTP 429 说明触发了限速：超过了套餐的每分钟 REST 配额或并发上限。请等待 60 秒滚动窗口刷新或等已有请求完成后再重试，不要持续重试。": "HTTP 429 means an enforced runtime limit was reached. Wait for in-flight requests to finish before retrying.",
    "每个账号的历史 REST 同时在途请求请保持在 3 以内。上游 QPS 或 key pool 限制也可能返回 429，请使用指数退避。": "Keep historical REST concurrency at or below 3 in-flight requests per account. On 429, retry with exponential backoff.",
    "单个账号的历史 REST 最大并发请求数建议保持在 <strong>3</strong> 以内。若收到 <strong>429</strong>，请等待在途请求完成并使用指数退避重试。": "Keep historical REST concurrency at or below 3 in-flight requests per account. On 429, retry with exponential backoff.",
    "每秒换算：Basic 10/s · Value 30/s · Standard 30/s · Premium 100/s。超过每分钟配额或并发上限会返回": "Per-second equivalents: Basic 10/s · Value 30/s · Standard 30/s · Premium 100/s. Exceeding the per-minute quota or concurrency cap returns ",
    "，请等待 60 秒窗口刷新后再重试。": "; wait for the 60-second window before retrying.",
    "REST 限速按用户、按 60 秒滚动窗口计算。服务器负载升高时自动收紧，极端负载下进一步收紧。WS 标的订阅数单独计算，重连后不会重置。": "REST limits are calculated per user over a rolling 60-second window and tighten automatically under server load. WebSocket symbol subscriptions are counted separately and do not reset after reconnecting.",
    "除限速外，代理还对 REST 和 WebSocket 实施每用户并发限制。REST 并发限制同时在途请求数；WS 并发限制所有通道的同时连接数。": "In addition to rate limits, the proxy applies per-user concurrency limits. REST limits in-flight requests; WebSocket limits simultaneous connections across all channels.",
    "代理返回缓存响应不到 1ms，客户端感知到的延迟主要来自网络往返和 TLS 握手。以下建议可将 TTFB 降低 50–80%。": "Cached proxy responses take under 1 ms on the server; client-perceived latency is mostly network round trips and TLS handshakes. The following practices can reduce TTFB by 50–80%.",
    "对同时支持 GET 与 POST 的端点，幂等历史查询优先使用 GET。重复请求可能命中热缓存或归档缓存，请查看 X-Cache / X-Cache-Tier，不要依赖特定边缘供应商。": "For endpoints that support both GET and POST, prefer GET for idempotent historical queries. Repeated requests may hit hot or archive cache; inspect X-Cache and X-Cache-Tier rather than assuming an edge provider.",
    "每个新 HTTPS 请求需约 100ms 用于 TCP + TLS 握手。使用持久连接（HTTP/2 或 keep-alive）可将此开销分摊到所有请求。": "Each new HTTPS request spends about 100 ms on TCP and TLS setup. Persistent HTTP/2 or keep-alive connections amortize this cost across requests.",
    "提供两个 REST 基础 URL，根据查询类型选择合适的。": "Two REST base URLs are available; choose the one appropriate for the query type.",
    "指数期权现已全面上线。": "Index options are now supported.",

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

    // Admin — verification email template editor
    "注册邮件模板": "Registration email template",
    "注册验证码邮件": "Verification code email",
    "修改后，新发送的验证码邮件立即使用新模板。": "Once saved, newly sent verification emails use the new template immediately.",
    "保存模板": "Save template",
    "邮件主题": "Subject line",
    "纯文本内容": "Plain text body",
    "HTML 内容": "HTML body",
    "可用占位符：": "Available placeholders:",
    "。纯文本和 HTML 都必须包含": ". Both the plain text and HTML bodies must include",
    "纯文本预览 · 示例验证码 123456": "Plain text preview · sample code 123456",
    "加载模板失败": "Could not load the template",
    "加载邮件模板失败": "Could not load the email template",
    "保存模板失败": "Could not save the template",
    "邮件模板已保存": "Email template saved",
    "保存邮件模板失败": "Could not save the email template",
    "已恢复默认双语模板": "Restored the default bilingual template",

    // Admin — bulk order console
    "当前还没有 Bulk 下载申请": "No bulk download requests yet",
    "恢复待处理": "Move back to pending",
    "报价 CNY": "Quote (CNY)",
    "实际 raw GB": "Actual raw GB",
    "内部备注 / 联系结果": "Internal notes / contact outcome",
    "已报价 / 已联系": "Quoted / contacted",
    "已交付": "Delivered",
    "待处理": "Pending",
    "Bulk 订单更新失败": "Could not update the bulk order",

    // Admin — announcement console
    "正在读取 registry": "Reading the registry",
    "公告数据加载失败": "Could not load announcement data",
    "公告数据加载失败:": "Could not load announcement data:",
    "SMTP 已配置": "SMTP configured",
    "SMTP 未配置": "SMTP not configured",
    "未填写邮箱": "No email on file",
    "邮箱无效": "Invalid email",
    "账号已过期": "Account expired",
    "测试账号": "Test account",
    "服务账号": "Service account",
    "不可发送": "Cannot receive mail",
    "请输入有效的手动收件邮箱": "Enter a valid email address to add",
    "该邮箱已在当前收件人中": "That address is already in the recipient list",
    "发送请求失败": "The send request failed",
    "预览已生成，正式发送快照已锁定。": "Preview generated. The live send snapshot is now locked.",
    "请输入有效的测试收件邮箱": "Enter a valid test recipient address",
    "测试邮件发送成功": "Test email sent",
    "内容或收件人已变化，请重新生成预览": "The content or recipients changed — generate the preview again",
    "正式发送中…": "Sending…",
    "已发送": "Sent",
    "公告发送完成": "Announcement sent",
    "公告发送存在失败": "Some announcement deliveries failed",
    "处理中…": "Working…",
    "操作失败": "That action failed",
    "同步中…": "Syncing…",

    // Token page
    "仅限已审核账户。输入注册时的用户名和手机号，我们将生成新的 UUID 并推送到上游代理。": "Approved accounts only. Enter the username and phone number on file — we'll mint a fresh UUID and push it to the upstream proxy.",
    "请输入用户名和手机号。": "Please enter both username and phone number.",
    "网络错误或服务器停机，请稍后重试。": "Network error or server is down. Please try again later.",
    "令牌已复制到剪贴板！": "Token copied to clipboard!",

    // Page titles
    "美股期权代理 — 公开文档": "Stock Options Proxy — Public Docs",

    // Updates banner
    "新提醒 · Premium 用户现可试用 FMP fundamentals Beta": "New · Premium users can now try the FMP fundamentals beta",
    "我们采购的 bulk snapshot 现已开放 statements、ratios、key metrics、TTM、growth、enterprise values 与 financial scores；数据可能被上游事后修订，并非严格 PIT。欢迎反馈 ticker、字段、period 或修订问题。": "Our bulk snapshot now covers statements, ratios, key metrics, TTM, growth, enterprise values and financial scores. Upstream may revise data after the fact, so it is not strictly point-in-time. Feedback on tickers, fields, periods or revisions is welcome.",
    "查看更新 / View updates →": "View updates →",

    // Register page — free-plan signup and email verification
    "创建账户 · Free 计划": "Create account · Free plan",
    "注册默认开通 Free：可查看最近 31 个日历日的 REST 数据，并可订阅最多 10 条 WebSocket。 需要更多历史、额度或实时订阅，请在账户管理中升级。": "Registering activates the Free plan: REST queries cover the last 31 calendar days and you can hold up to 10 WebSocket subscriptions. Upgrade in account management for more history, quota, or live subscriptions.",
    "1 · 邮箱验证": "1 · Email verification",
    "注册后立即开通": "Active as soon as you register",
    "REST 可查询最近 31 个日历日；账户总计最多 10 条 WS 订阅。需要更多数据或额度，请注册完成后前往账户管理升级。": "REST covers the last 31 calendar days, and the account allows 10 WebSocket subscriptions in total. After registering, upgrade in account management for more data or quota.",
    "邮箱地址": "Email address",
    "验证码将发送到这个邮箱。": "We will send the code to this address.",
    "邮箱验证码": "Email verification code",
    "验证码有效期 10 分钟。": "The code is valid for 10 minutes.",
    "2 · 账户信息": "2 · Account details",
    "用户名、手机号和邮箱共同确定账户。相同组合会恢复已有账户；同名但不同电话或邮箱可以独立注册。": "Your username, phone number, and email together identify the account. The same combination restores an existing account; the same name with a different phone or email registers separately.",
    "进入账户管理并升级 →": "Open account management to upgrade →",
    "一次性 Token": "One-time token",
    "使用注册时的用户名、手机号和邮箱查询账户状态。": "Check account status with the username, phone number, and email from registration.",
    "最近一个月 · 轻量实时": "Last month · lightweight real-time",
    "全部 REST endpoint 仅最近 31 个日历日 · 最多 10 条并发 WS 订阅": "All REST endpoints, last 31 calendar days only · up to 10 concurrent WebSocket subscriptions",
    "全部 REST endpoint 仅最近 31 个日历日 · WS 全账号最多 10 subjects": "All REST endpoints, last 31 calendar days only · 10 WebSocket subjects account-wide",
    "请先填写有效的邮箱地址。": "Enter a valid email address first.",
    "验证码已发送，请检查邮箱。": "Code sent. Check your inbox.",
    "验证码发送失败，请稍后重试。": "Could not send the code. Try again shortly.",
    "请先获取并填写 6 位邮箱验证码。": "Request and enter the 6-digit email code first.",
    "Free 计划已启用。": "The Free plan is active.",
    "该账户已存在，请从账户管理进入升级与用量页面。": "This account already exists. Use account management for upgrades and usage.",
    "请填写注册时的用户名、手机号和邮箱。": "Enter the username, phone number, and email from registration.",
    "重新发送验证码": "Resend code",
    "发送验证码": "Send code",
    "输入 6 位验证码": "Enter the 6-digit code",
    "注册并立即开通 Free →": "Register and activate Free →",

    // Account page
    "注册时的用户名、手机号和邮箱共同构成唯一登录凭证。": "Your username, phone number, and email from registration form your unique sign-in credentials.",
    "邮箱是账户身份的一部分，不能在线修改。": "Email is part of your account identity and cannot be changed online.",
    "选择升级套餐 →": "Choose an upgrade →",
    "选择升级套餐": "Choose an upgrade",
    "在这里进入安全结账页选择 Value、Standard 或 Premium、时长和支付方式。支付成功后保留原 Token 并自动延长有效期。": "Open secure checkout to pick Value, Standard, or Premium, a term, and a payment method. After payment your existing token stays the same and its expiry extends automatically.",
    "注册时使用的用户名": "Username used at registration",

    // Checkout page
    "支付宝由 Z-Pay 跳转处理，卡号、有效期和 CVV 直接提交给 Stripe；Leandata 不读取或保存支付凭据。平台验签回调确认后自动开通；重复回调不会重复延长有效期。": "Alipay is handled through a Z-Pay redirect, and your card number, expiry, and CVC go directly to Stripe. Leandata never reads or stores payment credentials. Access activates after a signed platform callback, and duplicate callbacks never extend the term twice.",
    "支付宝正在确认付款；确认后账户会自动开通。": "Alipay is confirming your payment. The account activates once confirmed.",

    // Updates page — product log and feedback
    "返回首页 →": "Back to home →",
    "产品日志 · Product log": "Product log",
    "最近改动与留言": "Recent changes and feedback",
    "这里记录数据产品的近期变化，包括 Index options 支持与 Premium FMP fundamentals Beta；每条更新都会说明当前可用范围和下一步计划。": "This log covers recent changes to the data products, including index-option support and the Premium FMP fundamentals beta. Each entry states what is available now and what comes next.",
    "近期改动": "Recent changes",
    "快照、修订与 PIT 计划": "Snapshots, revisions, and point-in-time plans",
    "这批数据是我们采购并导入的 bulk snapshot。上游可能在事后修订历史值，所以“某次快照”不自动等于严格 PIT。下一步会建立单独版本化的 PIT-like 周度或固定频率刷新：记录 capture time 与 visible time，保留不可变 vintage，并把每次刷新绑定到明确版本。": "This data is a bulk snapshot we purchase and import. Upstream may revise historical values after the fact, so a single snapshot is not automatically strict point-in-time. Next we will add separately versioned, point-in-time-style weekly or fixed-cadence refreshes that record capture time and visible time, keep each vintage immutable, and bind every refresh to an explicit version.",
    "Native FMP endpoint forwarding 会作为另一个兼容层单独建设，不会与已发布的批量快照混为一谈。": "Native FMP endpoint forwarding will be built as a separate compatibility layer, kept distinct from the published bulk snapshots.",
    "Premium 与 Ultimate": "Premium and Ultimate",
    "Premium 是当前 Beta 的访问层。Ultimate 计划增加 institutional holdings disclosures、ETF holdings 及相关数据族；这些数据同样可能被上游修订，也必须沿用 capture time、visible time 和 immutable vintage 语义后再作为可复现实验输入。": "Premium is the access tier for the current beta. The Ultimate plan will add institutional holdings disclosures, ETF holdings, and related data families. Those may also be revised upstream, so they must carry capture time, visible time, and immutable vintage semantics before being used as reproducible research inputs.",
    "给我们留言": "Send us feedback",
    "登录账户后即可提交反馈，并只查看自己的历史留言。": "Sign in to submit feedback and see only your own past messages.",
    "去登录账户 →": "Go to account sign-in →",
    "你的留言仅对账户本人可见；每小时最多提交 5 条。": "Your messages are visible only to you, and you can send up to 5 per hour.",
    "我的留言": "My messages",
    "还没有留言。": "No messages yet.",
    "更新暂时无法读取，请稍后重试。": "Updates cannot be loaded right now. Try again shortly.",
    "请先写下你的反馈。": "Write your feedback first.",
    "留言失败，请稍后重试。": "Could not send your message. Try again shortly.",
    "留言失败。": "Could not send your message.",
    "已收到，谢谢你的反馈。": "Received — thank you for the feedback.",
    "你希望下一步加入哪类 FMP 数据？": "Which FMP data should we add next?",
    "提交反馈 →": "Submit feedback →",

    // Status page probe description
    "REST API（Cloudflare → EC2）与 WebSocket 流（EC2 直连）的实时健康指标。可用性按分钟采样，延迟分位数按 60 分钟滚动窗口计算。": "Live health metrics for the REST API (Cloudflare → EC2) and WebSocket streams (direct to EC2). Availability is sampled by the minute and latency percentiles use a rolling 60-minute window.",
    "探针位于 us-west-2、us-east-1、eu-west-1，每 60 秒采样一次。REST 检查命中已知 token 的最新报价接口；WS 检查建连后等待认证回执。可用性 = 在 SLO 窗口内 HTTP 2xx 或认证成功的探针比例。": "Probes run from us-west-2, us-east-1, and eu-west-1 every 60 seconds. The REST probe requests the latest-quote endpoint with a known token; the WebSocket probe connects and waits for an auth acknowledgement. Availability is the share of probes returning HTTP 2xx or a successful auth inside the SLO window.",

    // Index options banner
    "SPX/SPXW、VIX/VIXW、DJX 和 XSP 等合约查询与实时期权行情流已就绪。": "Proxy contract discovery and realtime option streams are live for SPX/SPXW, VIX/VIXW, DJX and XSP.",
    "SPX/SPXW、VIX/VIXW、DJX 和 XSP 的合约查询与实时期权流已上线。": "Proxy contract discovery and realtime option streams are live for SPX/SPXW, VIX/VIXW, DJX and XSP.",

    // FMP fundamentals — overview cards and hero
    "财务数据": "Financial data",
    "行情数据": "Market data",
    "通过 Leandata 获取美股财务数据，包括财报、财务指标、公司资料等。使用您的 Leandata token 即可访问，无需额外的 API 密钥。": "Get US equity financial data through Leandata: statements, metrics, company profiles and more. Your Leandata token is the only credential you need.",
    "Premium 账户": "Premium accounts",
    "使用您的 Leandata token 认证，无需额外的 API 密钥。": "Authenticate with your Leandata token. No additional API key is required.",
    "财报 + 指标 + 公司资料": "Statements + metrics + profiles",
    "包括损益表、资产负债表、现金流量表、财务比率、关键指标、公司简介等。": "Includes income statements, balance sheets, cash flow statements, financial ratios, key metrics and company profiles.",
    "美股主要公司": "Major US companies",
    "当前支持美股主要上市公司的历史财务数据。如有特定公司需求，请联系我们。": "Historical financial data is available for major US listed companies. Contact us if you need a specific company.",
    "查看完整接口文档": "Read the full endpoint reference",
    "左侧 Financial data API 部分包含所有接口的详细参数、返回示例和使用说明。": "The Financial data API section in the sidebar covers every endpoint's parameters, sample responses and usage notes.",
    "财务数据基于公司公开披露的财报。公司可能会修订过往财报（如重述、更正等），我们会定期更新数据以反映这些变化。如需特定日期的历史数据版本，请联系我们。": "Financial data comes from companies' public filings. Companies sometimes revise past filings through restatements or corrections, and we refresh the data regularly to reflect those changes. Contact us if you need the data as it stood on a specific date.",
    "我们正在逐步增加更多数据类型，包括：分析师预测、机构持仓、ETF 持仓等。如有特定需求，欢迎联系我们。": "We are adding more data types, including analyst estimates, institutional holdings and ETF holdings. Tell us what you need.",
    "美股财务数据 · Premium": "US equity financial data · Premium",
    "财务数据 API / Financial Data API": "Financial Data API",
    "Premium 账户可访问公司财报、财务比率、关键指标、公司资料及参考数据。": "Premium accounts can access company statements, financial ratios, key metrics, profiles, and reference data.",
    "使用您的 Leandata token 获取美股财务数据（财报、财务指标、公司资料等）。Beta 版本目前向 Premium 账户开放。": "Use your Leandata token to retrieve US equity financial data: statements, metrics, company profiles and more. The beta is open to Premium accounts.",
    "使用 Leandata Token": "Use your Leandata token",
    "样本股票池": "Sample universe",
    "Beta 版本覆盖主要美股的财务数据。如需特定股票，请联系我们。": "The beta covers financial data for major US equities. Contact us if you need a specific ticker.",
    "财报 + 行情 + 公司资料": "Statements + quotes + profiles",
    "包括财务报表、财务指标、股票报价、公司信息、分析师预测等。": "Includes financial statements, metrics, stock quotes, company information and analyst estimates.",
    "Beta 已开放 / Beta Available": "Beta available",
    "Premium 用户可以查询样本股票的财报、财务指标和公司资料。欢迎反馈缺失的股票或数据。": "Premium users can query statements, metrics and profiles for the sample universe. Tell us which tickers or fields are missing.",
    "当前数据来自定期采购的批量数据。公司可能修订历史财务数据（如重述、更正等）。后续将提供版本化的历史数据查询，记录每次更新的时间。": "Today's data comes from bulk data we purchase on a regular schedule. Companies may revise historical figures through restatements or corrections. Versioned historical queries, recording the time of each update, are coming.",
    "财务比率（TTM）/ Ratios TTM": "Financial ratios (TTM)",
    "关键指标（TTM）/ Metrics TTM": "Key metrics (TTM)",
    "每个端点均定义自己的字段、时间周期、限制与可用范围。": "Each endpoint defines its own fields, timeframes, limits, and availability.",
    "以下接口提供股票报价、公司资料、分析师评级等数据。": "These endpoints provide stock quotes, company profiles, analyst ratings and related data.",
    "接口返回 JSON 数组格式。以下是利润表数据的响应示例（字段值仅作示意）：": "Endpoints return a JSON array. Here is a sample income statement response; the values are illustrative only:",
    "ISO-8601 时间戳格式。仅历史版本查询接口需要。": "ISO-8601 timestamp. Required only by the versioned query endpoint.",
    "数据版本的唯一标识。用于可重复查询。": "Unique identifier for a data version. Use it for repeatable queries.",
    "Beta 版本覆盖主要美股的财报、财务指标、股票报价、公司资料、分析师预测、评级、DCF 估值、收入分部等数据。": "The beta covers statements, metrics, quotes, profiles, analyst estimates, ratings, DCF valuations and revenue segmentation for major US equities.",
    "机构持仓（institutional holdings）、ETF 持仓数据暂未提供。": "Institutional holdings and ETF holdings are not available yet.",
    "这是 Beta 测试版本，并非所有股票都有完整数据覆盖。如遇空数组，说明该股票暂未包含在数据集中。": "This is a beta and not every ticker has complete coverage. An empty array means the ticker is not in the dataset yet.",
    "公司可能因重述、更正等原因修订历史财务数据。后续将提供版本化查询功能，记录每次数据更新的时间。": "Companies may revise historical financial data through restatements or corrections. Versioned queries that record the time of each update are coming.",
    "股价数据、财报数据、财务比率、预测数据等来自不同数据集。某股票有股价数据不代表一定有财报数据。": "Prices, statements, ratios and estimates come from separate datasets. A ticker having price data does not mean it also has statement data.",
    "不同公司、不同时期的财报字段可能不同。代码应容忍字段缺失或为 null，不要将其当作 0 处理。": "Statement fields vary between companies and between periods. Your code should tolerate missing or null fields rather than treating them as 0.",
    "扩展股票覆盖范围，增加更多美股和字段验证。": "Widen ticker coverage with more US equities and more field validation.",
    "为预测、业绩公告、评级、DCF 等数据提供版本化历史查询，记录数据更新时间。": "Add versioned historical queries for estimates, earnings announcements, ratings and DCF data, recording each update time.",
    "添加更多数据源支持，提供更广泛的接口覆盖。数据源将有独立的更新和修订策略。": "Support more data sources for broader endpoint coverage. Each source will have its own update and revision policy.",
    "发布定期更新的历史数据版本，公开每次更新的时间戳，保留历史版本供查询。": "Publish regularly updated historical versions, expose the timestamp of each update and keep earlier versions queryable.",
    "Ultimate 计划 / Ultimate Plan": "Ultimate plan",
    "Ultimate 套餐将包含机构持仓披露、ETF 持仓等数据。这些数据也会遵循版本化管理和时间戳记录。": "The Ultimate plan will include institutional holdings disclosures and ETF holdings. Those datasets will follow the same versioning and timestamp rules.",
    "DCF 估值 / DCF valuation": "DCF valuation",
    "自定义 DCF / Custom DCF": "Custom DCF",
    "杠杆 DCF / Levered DCF": "Levered DCF",
    "自定义杠杆 DCF / Custom levered DCF": "Custom levered DCF",
    "CIK 列表 / CIK list": "CIK list",
    "财报 ticker 列表 / Financial statement symbol list": "Financial statement symbol list",
    "Ticker 变更 / Symbol change": "Symbol change",
    "注册成功！请等待卖家确认订单后即可生成 Token。": "Registration received. Once your order is confirmed you can generate a token.",
    "Basic REST 月度套餐已停止新注册...": "The Basic monthly REST plan is closed to new registrations…",
    "该用户名已被使用，请换一个。": "That username is taken. Choose another one.",
    "已批准 tonnysun，Token 已自动注册到 proxy。": "Approved tonnysun. The token was registered with the proxy automatically.",
    "信息不完整": "Incomplete information"
  }));

  const orderedTranslations = [...translations.entries()]
    .sort((left, right) => right[0].length - left[0].length);

  // Short UI labels. These are matched against a whole text node only — putting
  // them in the substring map above would splice into longer prose (e.g. the
  // key 文档 would rewrite 详细接口文档请查看左侧 to 详细接口Docs请查看左侧).
  const exactTranslations = new Map(Object.entries({
    // Topbar navigation and buttons
    "文档": "Docs",
    "状态": "Status",
    "用量": "Usage",
    "打开入口": "Open Portal",
    "管理账户 →": "Manage account →",
    "管理后台 →": "Admin →",
    "Token 入口 →": "Token portal →",
    "代理 API": "Proxy API",
    "FMP 数据": "FMP data",
    "批量下载": "Bulk Download",
    "WS 用法": "WS usage",
    "代理文档": "Proxy Docs",

    // Token page
    "访问 · 30 天令牌": "Access · 30 day token",
    "获取您的": "Get your",
    "访问令牌": "access token",
    "生成令牌 →": "Generate token →",
    "生成中…": "Generating…",

    // Status labels
    "正常运行": "Operational",
    "性能下降": "Degraded",
    "服务中断": "Outage",
    "加载中…": "Loading…",
    "读取中…": "Loading…",
    "发送中…": "Sending…",

    // Short labels that also appear inside longer sentences, so they must only
    // translate when they are the entire text node.
    "新用户": "Create your",
    "已开通": "Active",

    // Documentation prose split by inline <strong> and <code> elements.
    "Leandata 提供两类核心服务：": "Leandata provides two core services:",
    "Token 门户": "Token portal",
    "负责账户注册与 Token 签发管理；": "handles account registration and token issuance;",
    "行情代理": "Market data proxy",
    "通过稳定公共域名提供历史 REST、实时 REST 与 WebSocket 实时行情流。使用单一 Token 即可访问全部数据接口，无需自行配置第三方凭证。": "delivers historical REST, real-time REST, and WebSocket streaming through stable public domains. One token provides access to every data interface, with no third-party credentials to manage.",
    "运行状态：REST 与 WebSocket 鉴权均已启用。仅对重复的无效 Token 尝试限流；一次过期或输入错误不会触发封禁。REST 返回带": "Runtime status: REST and WebSocket authentication are enabled. The limiter applies only to repeated invalid-token attempts; one expired or mistyped token does not trigger a ban. REST returns",
    "的": " on ",
    "；WS 在关闭失败连接前返回带": "; before closing a failed connection, WebSocket returns",
    "控制错误。": "control error.",
    "防护键由每日轮换的源 IP HMAC 和粗粒度 User-Agent 类别组成。Token 只允许以 HMAC 指纹做短期关联，不记录或持久化原始 IP/Token。每次临时封禁": "The protection key combines a daily-rotated source-IP HMAC with a coarse User-Agent category. Tokens may be HMAC-fingerprinted only for short-lived correlation; raw IP addresses and tokens are never logged or persisted. Each temporary ban expires after",
    "5 分钟": "5 minutes",
    "后自动解除，不会升级。伪匿名计数和封禁事件最多保留": "and does not escalate. Pseudonymous counters and ban events are retained for at most",
    "；去标识聚合总数可保留": "; de-identified aggregate totals may be retained for",
    "，每日": ", with rotation each day at",
    "轮换。": ".",
    "Token 套餐决定通道和 REST endpoint 权限；运行时安全限制除下方特别说明外为共享配置。Basic 仅为老账户兼容，不再开放新注册；批量导出请使用上方独立的 Bulk Download。": "Token plans determine channel and REST endpoint access. Runtime safety limits are shared unless stated otherwise below. Basic remains for existing-account compatibility and is closed to new registration; use the separate Bulk Download service above for exports.",
    "当前没有按套餐执行的 REST 滚动 req/min 限额；服务总并发和过载背压机制仍然生效。": "No plan-specific rolling REST requests-per-minute quota is currently enforced. Service-wide concurrency and overload backpressure still apply.",
    "单个账号的历史 REST 最大并发请求数建议保持在": "Keep historical REST concurrency at or below",
    "以内。若收到": "per account. If you receive",
    "，请等待在途请求完成并使用指数退避重试。": ", wait for in-flight requests to complete and retry with exponential backoff.",
    "Basic 账户可以访问全部可用历史数据，不设专属的日期跨度或页数预算。请求受并发、QPS、超时和过载背压等运行时限制。批量数据导出请使用独立的 Bulk Download 服务。": "Basic accounts can access the full available historical range without a plan-specific date-span or page budget. Requests remain subject to runtime controls such as concurrency, QPS, timeouts, and overload backpressure. Use the separate Bulk Download service for bulk exports.",
    "Basic 可以访问全部可用历史数据，不设 Basic 专属的日期跨度、symbol 数或页数预算。请求仍受上游限制和 proxy 运行时控制影响，包括历史并发、QPS、超时和过载背压。Bulk Download 是单独的一次性交付产品，不是解锁旧日期的必要条件。": "Basic can access the full available historical range without a Basic-specific date-span, symbol-count, or page-count budget. Requests remain subject to data-source limits and proxy runtime controls, including historical concurrency, QPS, timeouts, and overload backpressure. Bulk Download is a separate one-time delivery product, not a requirement for older dates.",
    "获取美股历史 OHLCV K 线数据（全市场 SIP 官方聚合行情，已复权）。支持自动分页与多级服务端缓存，响应头可通过": "Retrieve adjusted US equity OHLCV bars from the consolidated SIP feed, with automatic pagination and multi-tier server-side caching. Inspect",
    "查看缓存命中状态。": "to see cache-hit status.",
    "以下股票行情接口均通过标准": "The following equity market-data endpoints use standard",
    "路径开放。响应结构遵循官方全市场行情规范，鉴权、多级服务端缓存与并发控制由代理统一处理。": "routes. Responses follow the official consolidated-market-data structure, while the proxy handles authentication, multi-tier caching, and concurrency control.",
    "查询指定标的当前活跃期权合约（包含 OCC 代码、行权价、到期日、未平仓合约数等）。获取的 OCC 代码可直接用于查询快照或历史 K 线。历史到期合约请使用": "List currently active option contracts for an underlying, including OCC symbols, strikes, expirations, and open interest. Returned OCC symbols can be used directly for snapshots or historical bars. For expired historical contracts, use",
    "覆盖说明：标准": "Coverage note: standard",
    "期权 K 线已由多层历史归档引擎全面支持。": "option bars are fully supported by the multi-tier historical archive.",
    "覆盖说明：规范": "Coverage note: canonical",
    "期权 K 线已支持。请检查": "option bars are supported. Inspect",
    "判断来源；稀疏成交回退不代表完整合约覆盖。该回退仅适用于": "to determine provenance; sparse traded-activity fallback is not complete contract coverage. That fallback is eligible only when",
    "。更早开始、包括跨过边界的请求需要完整历史覆盖；不可用时会以 HTTP": ". Requests starting earlier, including ranges crossing the boundary, require dense historical coverage and fail closed with HTTP",
    "失败关闭。": ".",
    "固定粒度警告：此 wrapper 永远返回": "Fixed-granularity warning: this wrapper always returns",
    "等旧参数只归一化为": "and other legacy inputs are normalized to",
    "，不提供服务端聚合；Basic 不设套餐专属的请求大小预算。上游限制和 proxy 运行时限制仍然生效；收到": ". No server-side aggregation is provided. Basic has no plan-specific request-size budget. Data-source and proxy runtime limits still apply. On",
    "请等待并指数退避重试。": ", wait and retry with exponential backoff.",
    "代理当前不执行旧的套餐级滚动 req/min 数值。历史 REST 并发按账号计算，并持续占用到响应正文读取完毕。": "The proxy no longer enforces the legacy plan-specific rolling requests-per-minute values. Historical REST concurrency is counted per account and remains occupied until the response body is fully consumed.",
    "这些是当前运行时限制，不是容量保证；历史请求大小不按套餐单独设预算。服务过载时可能触发背压保护。": "These are current runtime limits, not capacity guarantees. Historical request size has no separate plan-specific budget, and overload backpressure may activate when the service is under pressure.",
    "这些是当前运行时限制，不是容量保证；历史请求大小不按套餐单独设预算。服务总背压可能返回": "These are current runtime limits, not capacity guarantees. Historical request size has no separate plan-specific budget. Service-wide backpressure can return",
    "，数据源容量限制可能返回": ", and provider-capacity limits can return",
    "账号级并发上限仅适用于历史 REST：单个账号最多同时有": "The account-level concurrency limit applies only to historical REST: one account may have at most",
    "个并发在途请求。WebSocket 不设账号级连接数上限；每条连接最多订阅": "requests in flight. WebSocket has no account-level connection cap; each connection may subscribe to at most",
    "500 个 subjects": "500 subjects",
    "Subjects 按实际投递计数，不按唯一 ticker 去重。例如同时订阅": "Subjects count actual deliveries rather than unique tickers. For example, subscribing to",
    "和": "and",
    "算两个 subjects；同一 subject 在两条连接上订阅也算两次，因为数据会发送两次。不同账号独立计数：按当前准入逻辑，两个付费账号可以各开 100 条 WS；这不代表无限容量 SLA。大规模分发建议仅保留少量上游连接，再通过本地代理转发给多个本地进程。": "counts as two subjects. The same subject on two connections also counts twice because the data is delivered twice. Accounts are counted independently: under current admission logic, two paid accounts may each open 100 WebSocket connections. This is not an unlimited-capacity SLA. For large fan-out, keep only a small number of upstream connections and redistribute locally.",
    "查询一个或多个股票的历史集合竞价数据（Auction Prints）。": "Retrieve historical auction prints for one or more stocks.",
    "多股票历史 OHLCV K 线（支持多周期与复权调整）。": "Retrieve adjusted historical OHLCV bars for multiple stocks and supported timeframes.",
    "批量查询多股票最新分钟 K 线。": "Retrieve the latest minute bars for multiple stocks.",
    "批量查询多股票历史逐笔报价（Quotes）。": "Retrieve historical quote ticks for multiple stocks.",
    "批量查询多股票最新实时报价（NBBO）。": "Retrieve the latest NBBO quotes for multiple stocks.",
    "批量查询股票综合快照（最新成交、最新报价、分钟 K、日 K、前一日 K）。": "Retrieve combined stock snapshots with latest trades, quotes, minute bars, daily bars, and previous daily bars.",
    "批量查询多股票历史逐笔成交（Trades）。": "Retrieve historical trade ticks for multiple stocks.",
    "批量查询多股票最新成交记录。": "Retrieve the latest trades for multiple stocks.",
    "查询成交与报价条件代码字典说明。": "Retrieve readable descriptions for trade and quote condition codes.",
    "查询交易所代码与交易场所名称字典。": "Retrieve the mapping of exchange codes to trading venues.",
    "单只股票历史逐笔报价（Quotes）。": "Retrieve historical quote ticks for one stock.",
    "单只股票最新实时报价。": "Retrieve the latest quote for one stock.",
    "单只股票历史逐笔成交（Trades）。": "Retrieve historical trade ticks for one stock.",
    "单只股票最新成交记录。": "Retrieve the latest trade for one stock.",

    // Token, registration, account, and product-update pages.
    "最近更新 · 财务历史与 Free 计划说明已更新": "Latest update · Financial history and Free plan guidance updated",
    "文档现在更容易理解，并明确说明 Free 的可用范围；长期财务历史已恢复，股票日线查不到时也会自动尝试历史归档。": "The docs are now easier to follow and clearly explain Free plan coverage. Long-term financial history is restored, and daily stock requests automatically try the historical archive when needed.",
    "仅限已审核账户。输入注册时的用户名和手机号，即可恢复现有 Token；只有缺失时才会生成新的 UUID 并完成账户访问更新。": "Approved accounts only. Enter the username and phone number used at registration to recover the existing token. A new UUID is issued only when no token exists.",
    "下载公开 skill，让 AI agent 按正确字段拉取数据，并分析 400–504 错误。内容不包含服务内部实现。": "Download the public skill so an AI agent can request data with the correct fields and analyze HTTP 400–504 errors. It contains no internal service implementation details.",
    "Token ready · 请复制并安全保存": "Token ready · Copy and store it securely",
    "1 · 填写账户信息": "1 · Enter account information",
    "用户名和手机号共同确定账户。邮箱是可选资料，不影响 Token 开通。": "Your username and phone number identify the account. Email is optional and does not affect token activation.",
    "使用注册时的用户名和手机号查询账户状态。": "Use the username and phone number from registration to check account status.",
    "请填写注册时的用户名和手机号。": "Enter the username and phone number used at registration.",
    "Token 默认隐藏，可按需显示": "Token hidden by default · reveal when needed",
    "注册时的用户名和手机号共同构成唯一登录凭证。": "The username and phone number used at registration form the unique sign-in credential.",
    "Token 已复制到剪贴板。": "Token copied to the clipboard.",
    "浏览器不允许自动复制，请手动复制 Token。": "Your browser blocked automatic copying. Copy the token manually.",
    "隐藏 Token": "Hide token",
    "显示 Token": "Show token",
    "这里记录数据产品的近期变化，包括实时流、指数期权支持与 Premium 财务数据；每条更新都会说明当前可用范围和下一步计划。": "This page tracks recent product changes, including real-time streams, index-option support, and Premium financial data. Each update states what is available now and what comes next.",
    "数据更新与历史版本": "Data updates and historical versions",
    "部分历史数据可能因公开披露的更正或重述而更新。需要复现研究结果时，请保存查询日期、请求参数和响应中的版本标识符。": "Some historical data may change after public corrections or restatements. To reproduce research results, retain the query date, request parameters, and response version identifier.",
    "不同数据类别由各自的公开端点说明覆盖范围和返回结构。": "Each data category documents its coverage and response structure on its public endpoints.",
    "Premium 提供当前财务数据访问。Ultimate 计划增加机构持仓、ETF 持仓及相关数据类别；新增类别会在可用后通过产品更新说明。": "Premium provides access to current financial data. Ultimate is planned to add institutional holdings, ETF holdings, and related categories; new categories will be announced through product updates when available.",
    "你希望下一步加入哪类数据？": "Which data category should we add next?",

    // Admin usage-monitoring UI.
    "用量监控": "Usage monitoring",
    "正在加载用量数据…": "Loading usage data…",
    "查找用户": "Find a user",
    "查找": "Search",
    "最近注册": "Recent registrations",
    "正在加载…": "Loading…",
    "用户用量": "User usage",
    "已过期": "Expired",
    "待支付": "Payment pending",
    "暂无注册记录": "No registration records",
    "层级": "Tier",
    "注册时间": "Registered",
    "到期": "Expiry",
    "续费": "Renewal",
    "保留窗口内没有用量数据": "No usage data in the retention window",
    "用户": "User",
    "角色": "Role",
    "请求 今天（UTC）": "Requests today (UTC)",
    "请求 近 7 天（UTC）": "Requests · last 7 days (UTC)",
    "请求 近 30 天（UTC）": "Requests · last 30 days (UTC)",
    "WS 会话 近 7 天（UTC）": "WebSocket sessions · last 7 days (UTC)",
    "流出 近 7 天（UTC）": "Egress · last 7 days (UTC)",
    "错误 近 7 天（UTC）": "Errors · last 7 days (UTC)",
    "最后活跃": "Last active",
    "正在加载用户详情…": "Loading user details…",
    "不在共享 registry 中（可能是匿名/测试流量）": "Not present in the shared registry (possibly anonymous or test traffic)",
    "无路由记录": "No route records",
    "每日活动（近 14 天，UTC）": "Daily activity · last 14 days (UTC)",
    "日期": "Date",
    "WS 会话": "WebSocket sessions",
    "流出": "Egress",
    "错误": "Errors",
    "常用路由": "Top routes",
    "最近事件": "Recent events",
    "时间": "Time",
    "事件": "Event",
    "路由/模式": "Route / mode",
    "无事件": "No events",
    "搜索中…": "Searching…",
    "无记录": "No records",
    "来源": "Source",
    "查看用量详情": "View usage details",
    "同步已批准的账户访问并刷新": "Sync approved account access and refresh",
    "手机号 / 用户名 / 邮箱 / user_id（如 15120992482）": "Phone / username / email / user_id (for example, 15120992482)",
    "用户用量监控": "User usage monitoring",
    "注册用户": "Registered users",
    "Free 用户": "Free users",
    "registry 角色": "Registry roles",
    "活跃用户（今天 UTC）": "Active users (today UTC)",
    "HTTP 请求（今天 UTC）": "HTTP requests (today UTC)",
    "WS 会话（近 7 天 UTC）": "WebSocket sessions (last 7 UTC days)",
    "流出（近 7 天 UTC）": "Egress (last 7 UTC days)",
    "⚠ usage 日志不可读": "⚠ Usage log is unreadable",
    "搜索失败": "Search failed",

    // FMP docs prose split across <code> elements. Each piece is its own text
    // node, so an exact match is both safe and sufficient here.
    "详细接口文档请查看左侧": "Full endpoint documentation is in the sidebar under",
    "美股期权与数据代理服务 · Stock Options & Financial Data Proxy Service": "Stock Options & Financial Data Proxy Service",
    "部分。": "section.",
    "打开文档 / Open Docs →": "Open docs →",
    "在请求头中添加": "Add the header",
    "，无需额外的数据供应商密钥。": "; no additional data-vendor key is required.",
    "发送 HTTPS": "Send an HTTPS",
    "请求到": "request to",
    "，请求头中携带您的 Leandata token。": "with your Leandata token in the request header.",
    "财务比率接口返回的字段包括": "The financial ratios endpoint returns fields such as",
    "（流动比率）、": "(current ratio),",
    "（速动比率）、": "(quick ratio),",
    "（负债权益比）、": "(debt to equity),",
    "（市盈率）、": "(P/E),",
    "（ROE）等。TTM 字段通常以": "(ROE) and more. TTM fields usually end with",
    "结尾。字段缺失或为 null 时表示数据源没有提供该字段，请勿当作零处理。": ". A missing or null field means the source did not provide it — do not treat it as zero.",
    "使用上市公司代码，例如": "Use a listed company ticker, for example",
    "（年报）或": "(annual) or",
    "（季报）。TTM 和评分接口不需要此参数。": "(quarterly). The TTM and scores endpoints do not take this parameter.",
    "限制返回的记录数量，例如": "Limit how many records are returned, for example",
    "返回最近5条。": "returns the 5 most recent.",
    "如果返回空数组": "If the response is an empty array",
    "，表示该股票暂无此类数据，非接口错误。": ", that ticker has no data of this type yet — it is not an endpoint error.",
    "只需使用您的 Leandata token，无需额外的数据供应商密钥。如需查询特定历史版本，保存对应的": "Use your Leandata token only; no additional data-vendor key is required. To query a specific historical version, save its",
    "。如需查询特定历史版本，保存对应的": ". To query a specific historical version, save its",
    "时间和": "time and",
    "标识符。": "identifier.",

    "无": "None",
    "加载失败": "Load failed",
  }));

  function readLanguage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "zh") return stored;
    } catch (_) {}

    // Auto-detect browser language if no stored preference
    try {
      const browserLang = navigator.language || navigator.userLanguage || "";
      if (browserLang.toLowerCase().startsWith("zh")) {
        return "zh";
      }
      if (browserLang.toLowerCase().startsWith("en")) {
        return "en";
      }
    } catch (_) {}

    // Default to Chinese
    return "zh";
  }

  let language = readLanguage();

  function translateDynamic(value) {
    // Whole-node labels win outright, so short keys never splice into prose.
    const trimmed = value.trim();
    if (trimmed && exactTranslations.has(trimmed)) {
      const [lead] = value.match(/^\s*/);
      const [tail] = value.match(/\s*$/);
      return lead + exactTranslations.get(trimmed) + tail;
    }
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
    // Docs headings are authored inline-bilingual. Only reached when the explicit
    // maps left CJK behind, so a hand-written entry always wins over these.
    if (CJK_RE.test(output)) {
      const bilingual = translateInlineBilingual(output.trim());
      if (bilingual !== null) {
        const [lead] = output.match(/^\s*/);
        const [tail] = output.match(/\s*$/);
        return lead + bilingual + tail;
      }
    }
    return output;
  }

  // "更新 / Updates" -> "Updates". Requires one side pure CJK and the other pure
  // Latin, so a genuine slash pair like "endpoint / dataset？" is left alone.
  function splitSlashBilingual(value) {
    const parts = value.split(/\s*\/\s*/);
    if (parts.length !== 2) return null;
    const [left, right] = parts.map(part => part.trim());
    if (!left || !right) return null;
    const leftIsCjk = CJK_RE.test(left);
    if (leftIsCjk === CJK_RE.test(right)) return null;
    const cjkSide = leftIsCjk ? left : right;
    const latinSide = leftIsCjk ? right : left;
    if (LATIN_LETTER_RE.test(cjkSide)) return null;
    if (!LATIN_LETTER_RE.test(latinSide)) return null;
    return latinSide;
  }

  // "获取公司当前市值。Current market cap." -> "Current market cap."
  function splitTrailingEnglish(value) {
    const match = value.match(
      /^[^A-Za-z]*[㐀-鿿][\s\S]*?[。！？]\s*([A-Z][^㐀-鿿]*[.!?])$/
    );
    return match ? match[1].trim() : null;
  }

  function translateInlineBilingual(value) {
    return splitSlashBilingual(value) ?? splitTrailingEnglish(value);
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

  // Pages whose React topbar renders <LanguageToggle /> mark it with
  // data-ld-language-toggle; there the floating switcher is redundant.
  function renderSwitcher() {
    const existing = document.getElementById("leandata-language-switcher");
    if (document.querySelector("[data-ld-language-toggle]")) {
      existing?.remove();
      return;
    }
    let switcher = existing;
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

  // Inline topbar toggle for React pages. Exposed as a global so JSX can use
  // <LanguageToggle />; the body only runs at render time, after React loads.
  function LanguageToggle() {
    const react = window.React;
    const [current, setCurrent] = react.useState(language);
    react.useEffect(() => {
      const handler = () => setCurrent(language);
      window.addEventListener(EVENT_NAME, handler);
      return () => window.removeEventListener(EVENT_NAME, handler);
    }, []);
    const hint = current === "zh" ? "Switch to English" : "切换到中文";
    return react.createElement("button", {
      type: "button",
      className: "btn ghost",
      "data-no-i18n": "true",
      "data-ld-language-toggle": "true",
      onClick: () => setLanguage(current === "zh" ? "en" : "zh"),
      title: hint,
      "aria-label": hint,
      style: {
        marginRight: 8,
        padding: "6px 10px",
        fontSize: 12,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
      },
    },
      react.createElement("span", { "aria-hidden": "true", style: { fontSize: 13, lineHeight: 1 } }, "◎"),
      current === "zh" ? "EN" : "中文"
    );
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
      // React topbars mount after this script runs; once their inline toggle
      // appears, drop the floating fallback so only one control is visible.
      renderSwitcher();
      applying = false;
      if (document.body) observer.observe(document.body, observerOptions);
    });
    observer.observe(document.body, observerOptions);
    languageObserver = observer;
  }

  window.LanguageToggle = LanguageToggle;

  window.LeandataI18n = {
    getLanguage: () => language,
    setLanguage,
    Toggle: LanguageToggle,
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
