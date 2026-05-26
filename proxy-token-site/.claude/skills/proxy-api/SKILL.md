---
name: proxy-api
description: "Complete API documentation for the Alpaca Data Proxy (WebSocket + REST endpoints, auth, caching). Use when needing to understand how to interact with the proxy endpoints or write client code."
argument-hint: "[endpoint or topic]"
---

# Alpaca 行情代理 API

> 更新时间: 2026-05-25
> REST: `https://api.leandata.uk` (Cloudflare → ThinkCentre)
> WS: `ws://52.37.182.24:8767` (EC2 直连 Alpaca)
> Token Portal: `https://leandata.uk/register`

这个代理让你**用一个 token 就能获取美股实时行情和历史数据**，不需要自己持有 Alpaca API key 或 ThetaData 账号。

**新增**: REST 数据统一走 Provider 路由层，支持 Alpaca native stocks / crypto / options / news 与 ThetaData Value 期权白名单；成功响应进入服务端缓存。
**新增 (2026-05-22)**: 股票逐笔 Tick 级成交与报价历史数据端点 `/v1/stock/history/trade_quote`，直连 ThetaData。

---

## 订阅套餐

| 套餐 | 价格 | REST 请求/分钟 | WS 最大 Symbol 数 | REST 并发 | WS 连接数 | 可用数据流 |
| --- | --- | --- | --- | --- | --- | --- |
| **Trial** | $30/3天 | 60 | 100 | 5 | 3 | Standard 能力，3 天试用 |
| **Basic** | $40/月 | 10 | 10 | 2 | 1 | 历史数据、批量下载、快照，无实时流 |
| **Value** | $60/月 | 30 | 30 | 3 | 2 | 股票 OR 期权（注册时选模式），含全部 WS 流 |
| **Standard** | $80/月 | 60 | 100 | 5 | 3 | 股票、期权、合约实时流 + 历史数据 |
| **Premium** | $130/月 | 300 | 500 | 10 | ∞ | 全部实时流 + 全部历史数据（含 crypto orderbooks） |

> 注册地址：`https://leandata.uk/register`
> 选择套餐并填写信息后，等待管理员确认即可自助生成 Token。

---

## 快速开始

### 1. 拿到你的 token

在 `https://leandata.uk/register` 注册并选择套餐，等待管理员确认后即可自助生成 Token。不需要 Alpaca 账号。

### 2. 测试连通性

```bash
curl https://api.leandata.uk/health
# → OK
```

### 3. 连接实时行情 (WebSocket)

```javascript
// 以股票为例，期权/crypto/news 换对应的 URL 即可
const ws = new WebSocket('ws://52.37.182.24:8767/stream');

ws.onopen = () => {
  ws.send(JSON.stringify({ action: 'auth', token: '你的token' }));
  // 收到 {"T":"success","msg":"authenticated"} 后
  ws.send(JSON.stringify({ action: 'subscribe', trades: ['AAPL'], quotes: ['AAPL'] }));
};

ws.onmessage = (msg) => {
  // 股票/期权/boats/overnight 的行情是 MsgPack 二进制，需要解码
  // crypto/news 是 JSON 文本
  console.log(msg.data);
};
```

### 4. 拉取历史 K 线 (HTTP)

```bash
curl -X POST https://api.leandata.uk/v1/history/bars \
  -H 'Content-Type: application/json' \
  -d '{"token":"你的token","symbol":"AAPL","start":"2026-05-13","end":"2026-05-15","timeframe":"1Min","limit":10}'
```

### 5. 拉取股票逐笔 Tick 成交与报价历史 (HTTP)

```bash
curl -X POST https://api.leandata.uk/v1/stock/history/trade_quote \
  -H 'Content-Type: application/json' \
  -d '{"token":"你的token","symbol":"AAPL","date":"2026-05-19"}'
```

返回逐笔 trade + quote 数据，包含成交价格、成交量、买卖报价、交易所代码等。支持传入 `start_date`/`end_date` 查询区间，或单日 `date` 快速查询。

---

## WebSocket 实时流

所有 WS 端点都是**先连接 → 发送 auth → 收到确认 → 订阅 → 收数据**。

### ⚠️ 帧编码（重要！）

| 流 | 编码格式 |
| --- | --- |
| `/stream` (股票) | **MsgPack 二进制** |
| `/stream/options` | **MsgPack 二进制** |
| `/stream/test` | **MsgPack 二进制** |
| `/stream/boats` | **MsgPack 二进制** |
| `/stream/overnight` | **MsgPack 二进制** |
| `/stream/crypto` | JSON 文本 |
| `/stream/news` | JSON 文本 |

**MsgPack 流必须用 msgpack 库解码，不能直接 JSON.parse。**

### 端点一览

| 端点 | 订阅键 | 说明 |
| --- | --- | --- |
| `ws://52.37.182.24:8767/stream` | `trades`, `quotes` | 美股实时成交+报价 |
| `ws://52.37.182.24:8767/stream/options` | `trades`, `quotes` | 期权实时成交+报价 |
| `ws://52.37.182.24:8767/stream/crypto` | `trades`, `orderbooks` | 加密货币 |
| `ws://52.37.182.24:8767/stream/news` | `news` | 新闻推送（支持 `*` 全量订阅） |
| `ws://52.37.182.24:8767/stream/boats` | `trades`, `quotes` | 美股（boats feed） |
| `ws://52.37.182.24:8767/stream/overnight` | `trades`, `quotes` | 美股盘后 |
| `ws://52.37.182.24:8767/stream/test` | `trades`, `quotes` | 测试流 |

### Auth 消息

```json
{"action": "auth", "token": "你的token"}
```

成功回复:
```json
{"T": "success", "msg": "authenticated"}
```

### 订阅消息

**股票 / 期权 / boats / overnight / test:**
```json
{"action": "subscribe", "trades": ["AAPL"], "quotes": ["AAPL"]}
```

**Crypto:**
```json
{"action": "subscribe", "trades": ["BTC/USD"], "orderbooks": ["BTC/USD"]}
```

**News:**
```json
{"action": "subscribe", "news": ["*"]}
```

### 限制

- 不支持 `*` 通配符订阅（news 除外）
- 股票代码不能带 `.`（`BRK.B` 不支持）
- 不支持 WS bars / daily bars / LULD
- Crypto 不支持 quotes
- **WebSocket Options 限制**: 实时流 `/stream/options` 不支持指数期权（如 `SPX`、`SPXW`、`NDX`、`RUT` 等），仅支持美国个股与 ETF 期权。这是因为上游数据源 (Alpaca) 暂未提供指数期权实时行情。

---

## HTTP REST API

所有 HTTP 端点（`/health` 除外）都需要 token。POST 可在 JSON body 里传 `token`，GET 可用 query 参数，推荐统一使用 `Authorization: Bearer 你的token`:

```json
{"token": "你的token", ...}
```

HTTP header:

```http
Authorization: Bearer 你的token
```

### 健康检查

```
GET https://api.leandata.uk/health
→ OK
```

### Status API（Token Portal）

无需认证，通过主站 `https://leandata.uk` 访问：

```
GET /api/status        — 实时探测 REST proxy + WS 端口，返回 overall + 各组件 status/latencyMs
GET /api/uptime        — 90 天每日可用性百分比数组 (rest + ws)
GET /api/latency?range=24h|7d|30d — 分桶延迟时序 (1h 桶, p50)
```

示例：
```bash
curl https://leandata.uk/api/status
# {"overall":"operational","components":{"rest":{"status":"operational","latencyMs":5282},"ws":{"status":"operational","latencyMs":15}},...}

curl https://leandata.uk/api/uptime
# {"rest":[100,100,...,50],"ws":[100,100,...,100]}  (90 elements each)

curl "https://leandata.uk/api/latency?range=24h"
# {"range":"24h","rest":[92,88,...],"ws":[6,7,...]}
```

### 股票历史 K 线

```
POST /v1/history/bars
```

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `token` | string | ✅ | 代理 token |
| `symbol` | string | ✅ | 单个股票代码 |
| `start` | string | ✅ | 开始日期，如 `2026-05-13` |
| `end` | string | ✅ | 结束日期 |
| `timeframe` | string | ❌ | 默认 `1Min`，支持 `1Min`/`5Min`/`15Min`/`1Hour`/`1Day` |
| `limit` | int | ❌ | 默认 10000，范围 1-10000 |
| `max_pages` | int | ❌ | 默认 100 |
| `feed` | string | ❌ | `sip` 或 `iex` |

### 股票逐笔 Tick 成交与报价历史

```
POST /v1/stock/history/trade_quote
```

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `token` | string | ✅ | 代理 token |
| `symbol` | string | ✅ | 股票代码，如 `AAPL` |
| `date` | string | ✅ (二选一) | 单日查询，格式 `YYYY-MM-DD` 或 `YYYYMMDD` |
| `start_date` | string | ✅ (二选一) | 区间查询开始日期 |
| `end_date` | string | ✅ (二选一) | 区间查询结束日期 |
| `start_time` | string | ❌ | 开始时间，默认 `09:30:00` |
| `end_time` | string | ❌ | 结束时间，默认 `16:00:00` |
| `exclusive` | bool | ❌ | 是否排除边界时间，默认 `false` |
| `venue` | string | ❌ | 数据源渠道，默认 `nqb` (Nasdaq Basic) |

**返回字段示例**:
```json
{
  "data": [
    {"timestamp": "2026-05-19T09:30:00.123456-04:00", "price": 150.25, "size": 100, "exchange": "Q", "bid": 150.24, "ask": 150.26, "bid_size": 500, "ask_size": 300},
    ...
  ],
  "count": 12500
}
```

**注意**: 此端点直连 ThetaData，需要 ThetaData 账号具备 Standard 或更高订阅级别。Free 订阅会返回 `PERMISSION_DENIED`。

### Alpaca Native 股票数据 (GET)

以下 Alpaca 股票数据接口均已通过统一 provider 路由开放，使用同一个代理 token 鉴权。响应保持 Alpaca 原始结构；命中服务端缓存时返回 `X-Cache: DISK_HIT`，数据源头为 `X-Provider: alpaca`。

| 接口 | 方法 | 路由 |
| --- | --- | --- |
| Historical auctions | GET | `/v2/stocks/auctions` |
| Historical bars | GET | `/v2/stocks/bars` |
| Latest bars | GET | `/v2/stocks/bars/latest` |
| Condition codes | GET | `/v2/stocks/meta/conditions/{ticktype}` |
| Exchange codes | GET | `/v2/stocks/meta/exchanges` |
| Historical quotes | GET | `/v2/stocks/quotes` |
| Latest quotes | GET | `/v2/stocks/quotes/latest` |
| Snapshots | GET | `/v2/stocks/snapshots` |
| Historical trades | GET | `/v2/stocks/trades` |
| Latest trades | GET | `/v2/stocks/trades/latest` |
| Historical bars (single symbol) | GET | `/v2/stocks/{symbol}/bars` |
| Latest bar (single symbol) | GET | `/v2/stocks/{symbol}/bars/latest` |
| Historical quotes (single symbol) | GET | `/v2/stocks/{symbol}/quotes` |
| Latest quote (single symbol) | GET | `/v2/stocks/{symbol}/quotes/latest` |
| Snapshot (single symbol) | GET | `/v2/stocks/{symbol}/snapshot` |
| Historical trades (single symbol) | GET | `/v2/stocks/{symbol}/trades` |
| Latest trade (single symbol) | GET | `/v2/stocks/{symbol}/trades/latest` |

我们的上游已订阅了全市场数据，因此推荐使用 `feed=sip` 获取最准确的 NBBO 数据；`iex`、`delayed_sip`、`boats`、`overnight`、`otc` 也完全可用。Historical auctions 按 Alpaca 规则使用 SIP。

示例：

```bash
# 最新股票报价
curl -H "Authorization: Bearer 你的token" \
  "https://api.leandata.uk/v2/stocks/quotes/latest?symbols=AAPL&feed=sip"

# 单只股票 snapshot
curl -H "Authorization: Bearer 你的token" \
  "https://api.leandata.uk/v2/stocks/AAPL/snapshot?feed=sip"

# condition codes
curl -H "Authorization: Bearer 你的token" \
  "https://api.leandata.uk/v2/stocks/meta/conditions/trade?tape=C"
```

### Provider 路由 / Fallback / 服务端缓存

同一个 token 可以直接访问以下 native provider 路由族，鉴权、限流、凭据清洗和缓存行为一致：

| Provider surface | 路由族 | 说明 |
| --- | --- | --- |
| Alpaca stocks | `/v2/stocks/*` | 股票 auctions / bars / trades / quotes / latest / snapshots / metadata |
| Alpaca crypto | `/v1beta3/crypto/*`, `/v1beta1/crypto-perps/*` | Crypto bars / trades / quotes / latest / orderbooks |
| Alpaca options | `/v1beta1/options/*` | Option bars / historical trades / latest quotes/trades / snapshots；历史期权数据从 2024-02-01 开始 |
| Alpaca news | `/v1beta1/news*` | 新闻查询 |
| Alpaca option contracts | `/v2/options/contracts*` | 期权合约元数据 |
| ThetaData Value options | `/v3/option/*` | ThetaData Value 期权白名单端点 |

示例：

```bash
# 最新股票报价
curl -H "Authorization: Bearer 你的token" \
  "https://api.leandata.uk/v2/stocks/quotes/latest?symbols=AAPL&feed=sip"

# 最新 crypto 报价
curl -H "Authorization: Bearer 你的token" \
  "https://api.leandata.uk/v1beta3/crypto/us/latest/quotes?symbols=BTC%2FUSD"
```

支持 `provider` 参数的期权接口可传：

| provider | 行为 |
| --- | --- |
| `auto` | 默认。按接口使用主 Provider，失败或无数据时按规则 fallback。 |
| `thetadata` / `theta` | 强制 ThetaData Value。不会 fallback 到 Alpaca。 |
| `alpaca` | 强制 Alpaca。不会先查 ThetaData。 |

重叠接口 fallback 规则：

| 接口 | 默认路由 |
| --- | --- |
| `/v1/history/options/bars` | ThetaData Value OHLC → Alpaca option bars fallback |
| `/v1/options/contracts` | Alpaca contracts → ThetaData Value contract list fallback |
| `/v1/options/snapshots` | Alpaca only（ThetaData Value 不含 Greeks/IV/market value） |
| `/v1/options/snapshots/quote`、`/v1/options/snapshots/trade` | Alpaca latest quote/trade 优先，归一化到 `snapshots[OCC].latestQuote/latestTrade` |
| `/v1/options/snapshots/open_interest`、`/v3/option/snapshot/*` | ThetaData Value 可用快照 |
| `/v3/option/*` | ThetaData Value 白名单，无 Alpaca fallback |

服务端会缓存成功的 REST 响应。命中时响应头为 `X-Cache: DISK_HIT`。缓存键会剔除 `token` / API key 等凭据；TTL：历史数据 7 天、当日/盘中 60 秒、快照 5 分钟、合约/list 1 小时。

ThetaData Value 仅开放期权 list、snapshot `ohlc` / `quote` / `open_interest`、history `eod` / `ohlc` / `quote` / `open_interest`、`at_time/quote`。不开放 option trades、trade_quote、market value、implied volatility、Greeks。

💡 **指数期权支持 (REST)**: REST 接口（如 `/v1/history/options/bars` 和 `/v1/options/contracts`）在指定 `provider=thetadata` 时，**完全支持** `SPX`、`SPXW`、`NDX` 等指数期权的历史 K 线和合约列表查询。由于 ThetaData 拥有完整的历史期权数据库（部分数据多达 8-12 年），期权链在历史上是非常齐全的。你可以使用 `date` 参数来重构历史上任何一天的完整期权链（包括已到期过期的合约）。

### 期权历史 K 线

```
POST /v1/history/options/bars
```

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `token` | string | ✅ | 代理 token |
| `symbols` | string | ✅ | **支持两种格式**：<br>1. OCC 格式期权代码：`AAPL260522C00200000`<br>2. **股票代码**：`AAPL`（自动解析为期权链，返回前10个合约） |
| `start` | string | ✅ | 开始日期 |
| `end` | string | ✅ | 结束日期 |
| `timeframe` | string | ❌ | 默认 `1Min` |
| `provider` | string | ❌ | `auto` / `thetadata` / `alpaca`，默认 `auto` |
| `limit` | int | ❌ | 默认 10000 |
| `max_pages` | int | ❌ | 默认 100 |

💡 也可以用 `symbol`（单数），会自动转成 `symbols`。

**新功能**：传入股票代码（如 `AAPL`）时，系统会自动查询期权链并返回前10个合约的数据，无需手动指定 OCC 代码。

OCC 格式: [股票代码][到期日YYMMDD][C/P][行权价*1000]
- 示例: AAPL260522C00200000 = AAPL 2026-05-22 Call 200.00

获取期权代码流程:
1. 先用 /v1/options/contracts 查询合约列表
2. 从返回的 symbol 字段获取 OCC 代码
3. 再用该代码请求 /v1/history/options/bars

数据源: 默认优先从 ThetaData Value 获取，失败或无数据时自动回退到 Alpaca。响应包含 `provider` 字段。

### 期权历史逐笔成交

```
GET/POST /v1/history/options/trades
GET /v1beta1/options/trades
```

数据源为 Alpaca historical option trades。Alpaca 历史期权数据从 **2024-02-01** 开始；更早日期会返回空数据，wrapper 路由会附带 `data_availability` 和 `warning`。

```bash
curl -H "Authorization: Bearer 你的token" \
  "https://api.leandata.uk/v1beta1/options/trades?symbols=AAPL260620C00200000&start=2025-01-02&end=2025-01-03&limit=100"
```

### 期权合约查询

```
POST /v1/options/contracts
```

```json
{
  "token": "你的token",
  "underlying_symbols": "AAPL",
  "expiration_date_gte": "2026-05-16",
  "provider": "auto",
  "limit": 100
}
```

支持的筛选字段: `underlying_symbols`, `expiration_date`, `expiration_date_gte`, `expiration_date_lte`, `strike_price_gte`, `strike_price_lte`, `type` / `option_type`, `provider`, `date`, `request_type`, `max_dte`, `limit`。

- `provider=auto`: Alpaca 优先，失败时用 ThetaData Value contract list。
- `provider=thetadata`: 只支持 `underlying_symbols` 查询，不支持 `symbol_or_id` 单合约 lookup。
- `request_type`: ThetaData list metadata 使用 `quote` 或 `trade`，默认 `quote`。

### 期权快照

```
POST /v1/options/snapshots
```

```json
{
  "token": "你的token",
  "symbols": ["AAPL260522C00200000"],
  "feed": "indicative"
}
```

### 期权最新报价 / 最新成交

```
POST /v1/options/snapshots/quote
POST /v1/options/snapshots/trade
GET  /v1beta1/options/quotes/latest
GET  /v1beta1/options/trades/latest
```

`/v1/options/snapshots/quote` 默认使用 Alpaca `/v1beta1/options/quotes/latest`，返回 `snapshots[OCC].latestQuote`。
`/v1/options/snapshots/trade` 默认使用 Alpaca `/v1beta1/options/trades/latest`，返回 `snapshots[OCC].latestTrade`。
如需 ThetaData Value quote snapshot，可显式传 `feed: "thetadata"`。

```bash
curl -X POST https://api.leandata.uk/v1/options/snapshots/quote \
  -H "Authorization: Bearer 你的token" \
  -H "Content-Type: application/json" \
  -d '{"symbols":"AAPL260620C00200000","feed":"indicative"}'

curl -H "Authorization: Bearer 你的token" \
  "https://api.leandata.uk/v1beta1/options/trades/latest?symbols=AAPL260620C00200000&feed=indicative"
```

### 按到期日取期权快照（便捷接口）

```
POST /v1/options/snapshots/expiry
```

```json
{
  "token": "你的token",
  "underlying": "AAPL",
  "expiry": "2026-05-22"
}
```

自动拉取该到期日所有合约，然后批量取快照。

### 期权持仓量 (Open Interest)

```
GET/POST /v1/options/open_interest
```

```json
{
  "token": "你的token",
  "symbol": "AAPL",
  "start": "2026-05-01",
  "end": "2026-05-15",
  "right": "both"
}
```

数据源为 ThetaData Value，支持 GET query 或 POST JSON，成功响应写入服务端缓存。

### 期权日终数据 (EOD)

```
POST /v1/options/eod
```

```json
{
  "token": "你的token",
  "symbol": "AAPL",
  "start": "2026-05-01",
  "end": "2026-05-15",
  "right": "call",
  "max_dte": 30
}
```

同样可用 `/v1/history/options/eod`，该路由支持 GET query 和 POST JSON。

### ThetaData Value 直连白名单

这些 `/v3/option/*` 端点通过代理鉴权后访问 ThetaData Value 期权白名单，支持 GET 或 POST，返回 JSON：

| 端点 | 访问要求 |
| --- | --- |
| `/v3/option/list/symbols` | Options contracts |
| `/v3/option/list/dates/quote` | Options contracts |
| `/v3/option/list/dates/trade` | Options contracts |
| `/v3/option/list/expirations` | Options contracts |
| `/v3/option/list/strikes` | Options contracts |
| `/v3/option/list/contracts/quote` | Options contracts |
| `/v3/option/list/contracts/trade` | Options contracts |
| `/v3/option/snapshot/ohlc` | Options snapshots |
| `/v3/option/snapshot/quote` | Options snapshots |
| `/v3/option/snapshot/open_interest` | Options snapshots |
| `/v3/option/history/eod` | Options history |
| `/v3/option/history/ohlc` | Options history |
| `/v3/option/history/quote` | Options history |
| `/v3/option/history/open_interest` | Options history |
| `/v3/option/at_time/quote` | Options history |

```bash
curl -H "Authorization: Bearer 你的token" \
  "https://api.leandata.uk/v3/option/history/ohlc?root=AAPL&exp=260620&strike=200000&right=C&start_date=20250102&end_date=20250103"
```

#### 📌 指定时间期权报价 (At Time Quote)

```
GET/POST /v3/option/at_time/quote
```

返回由 OPRA 报告的、在一天中指定毫秒的最后一个 NBBO 期权报价。用于在指定具体时刻（如开盘瞬间、特定消息发布瞬间）获取高精度盘口价格快照。

##### 1. 请求参数

支持以 GET Query 参数或 POST JSON Body 参数形式传递（推荐使用 `Authorization` Bearer Token 鉴权）：

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `symbol` / `root` | string | ✅ | - | 标的股票或指数代码（例如 `AAPL`、`SPX` 等） |
| `start_date` / `start` | string | ✅ | - | 开始日期，格式 `YYYY-MM-DD` 或 `YYYYMMDD` |
| `end_date` / `end` | string | ✅ | - | 结束日期，格式 `YYYY-MM-DD` 或 `YYYYMMDD` |
| `time_of_day` / `time` | string | ✅ | `09:30:00` | 精确时间，格式 `HH:MM:SS` 或 `HH:MM:SS.SSS`（美东时间） |
| `expiration` / `exp` | string | ✅ | - | 期权到期日，格式 `YYYY-MM-DD`/`YYYYMMDD` 或 `*` (全部) |
| `strike` | string | ❌ | `*` | 行权价（如 `220.00`），或 `*` (全部) |
| `right` | string | ❌ | `both` | 期权类型，可选：`call` / `put` / `both` |
| `max_dte` | integer | ❌ | - | 最大到期天数 (DTE) 过滤条件 |
| `strike_range` | integer | ❌ | - | 限制行权价范围，返回标的现价上下 `n` 档以内的合约 |

##### 2. 响应字段 (JSON Array)

返回的对象数组包含以下结构：

```json
[
  {
    "symbol": "AAPL",
    "expiration": "2024-11-08",
    "strike": 220.0,
    "right": "call",
    "timestamp": "2024-11-04T09:30:01.000",
    "bid_size": 10,
    "bid_exchange": 4,
    "bid": 2.15,
    "bid_condition": 0,
    "ask_size": 15,
    "ask_exchange": 4,
    "ask": 2.20,
    "ask_condition": 0
  }
]
```

##### 3. 使用示例

**GET 请求 (URL 参数):**
```bash
curl -H "Authorization: Bearer 你的token" \
  "https://api.leandata.uk/v3/option/at_time/quote?symbol=AAPL&expiration=20241108&strike=220.000&right=call&start_date=20241104&end_date=20241104&time_of_day=09:30:01.000"
```

**POST 请求 (JSON Body):**
```bash
curl -X POST https://api.leandata.uk/v3/option/at_time/quote \
  -H "Authorization: Bearer 你的token" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "start_date": "2024-11-04",
    "end_date": "2024-11-04",
    "time_of_day": "09:30:01.000",
    "expiration": "2024-11-08",
    "strike": "220.00",
    "right": "call"
  }'
```

**Python 客户端调用示例:**
```python
import httpx

headers = {
    "Authorization": "Bearer 你的token",
    "Content-Type": "application/json"
}

params = {
    "symbol": "AAPL",
    "start_date": "2024-11-04",
    "end_date": "2024-11-04",
    "time_of_day": "09:30:01.000",
    "expiration": "2024-11-08",
    "strike": "220.00",
    "right": "call"
}

response = httpx.post("https://api.leandata.uk/v3/option/at_time/quote", json=params, headers=headers)
print(response.json())
```

### Crypto 最新订单簿

```
POST /v1/crypto/us/latest/orderbooks
```

```json
{
  "token": "你的token",
  "symbols": ["BTC/USD", "ETH/USD"]
}
```

### 新闻历史

```
POST /v1/history/news
```

```json
{
  "token": "你的token",
  "symbols": "AAPL",
  "start": "2026-05-14T00:00:00Z",
  "end": "2026-05-15T00:00:00Z",
  "limit": 10
}
```

### 鉴权与限流错误

| HTTP 状态 | 含义 |
| --- | --- |
| `200` | 成功 |
| `400` | 请求参数有误 |
| `401` | token 无效（不在注册表中） |
| `403` | token 有效但没有该端点的权限 |
| `429` | **速率超限**（REST 请求太频繁或 WS 订阅 symbol 数超限制） |
| `500` | 代理内部错误（上游 Alpaca 故障等） |

### 速率限制

代理按用户角色执行限流，超限返回 `429`。

| 角色 | REST 请求/分钟 | WS 最大 Symbol 数 | 说明 |
| --- | --- | --- | --- |
| `basic` / `basic_flow` | 10 | 10 | 基础套餐 |
| `standard` / `standard_flow` | 60 | 100 | 标准套餐 |
| `premium` / `advanced` | 300 | 500 | 高级/ premium |
| `fallback` / `admin` | 1000 | 1000 | 管理员/回退（实际不限） |

> 注意: `/v1/stock/history/trade_quote` 端点由于返回逐笔 Tick 数据量极大，建议单次查询不超过 1 个交易日，并合理设置 `start_time`/`end_time` 缩小范围。

> WS symbol 限制：每次 `subscribe` 会累加 symbol 数量，超出限制时 subscribe 被拒绝。断开后自动释放。

### 管理接口（Admin）

以下接口任何已认证用户均可调用。非管理员只能查看**自己的**数据；管理员可查看全部。

#### 查询审计日志

```
POST /v1/admin/audit
```

```bash
curl -X POST 'https://api.leandata.uk/v1/admin/audit?limit=50' \
  -H 'Content-Type: application/json' \
  -d '{"token":"你的token"}'
```

**查询参数**（管理员可用）：
- `?user_id=xxx` — 过滤指定用户
- `?event=http_request|ws_request` — 过滤事件类型
- `?mode=stock|options|crypto|news|...` — 过滤 WS 模式
- `?limit=100` — 最多返回条数（默认 100，最大 1000）

**返回示例**：
```json
{
  "total": 42,
  "returned": 5,
  "events": [
    {
      "event": "http_request",
      "endpoint": "/v1/history/news",
      "user_id": "ikkipipi",
      "status": 200,
      "elapsed_ms": 202,
      "symbols": "AAPL",
      "limit": 2
    },
    {
      "event": "ws_request",
      "ws_event": "auth",
      "user_id": "ikkipipi",
      "mode": "news",
      "timestamp": 1716040000.0,
      "token_masked": "967d4072...bc5d"
    }
  ]
}
```

#### 查询流量与系统统计

```
POST /v1/admin/stats
```

```bash
curl -X POST https://api.leandata.uk/v1/admin/stats \
  -H 'Content-Type: application/json' \
  -d '{"token":"你的token"}'
```

**返回示例**（普通用户）：
```json
{
  "user_id": "ikkipipi",
  "user_stats": {
    "rest_requests_1min": 3,
    "ws_symbols": 15
  },
  "all_user_stats": null,
  "system": null
}
```

**返回示例**（管理员）：
```json
{
  "user_id": "ikkipipi",
  "user_stats": { "rest_requests_1min": 3, "ws_symbols": 15 },
  "all_user_stats": {
    "user1": { "rest_requests_1min": 0, "ws_symbols": 5 },
    "ikkipipi": { "rest_requests_1min": 3, "ws_symbols": 15 }
  },
  "system": {
    "memory_percent": 65.6,
    "memory_available_mb": 310,
    "load_1min": 0.02,
    "cpu_percent": 1.5
  }
}
```

---

## 常见问题

**Q: Lean/QuantConnect 怎么配置？**
```
ALPACA_PROXY_URL=ws://52.37.182.24:8767/stream
ALPACA_PROXY_TOKEN=你的token
```
注意 WS 连接走 EC2 直连（`52.37.182.24:8767`），REST 历史数据走 Cloudflare（`https://api.leandata.uk`）。

**Q: 历史数据走代理还是直连？**  
默认直连 Alpaca REST。如果直连失败且设置了 `ALPACA_HISTORY_AUTO_FALLBACK=1`，会自动切到代理。REST 代理地址为 `https://api.leandata.uk`。

**Q: 期权代码格式？**  
标准 OCC 格式，如 `AAPL260522C00200000` = AAPL 2026-05-22 Call $200。

**Q: 为什么我收到的数据是乱码？**  
检查帧编码表 —— 股票和期权的 WS 流是 MsgPack，需要用 `msgpack.unpackb()` 解码。

**Q: 支持哪些时间框架？**  
实时流无 bars；历史 K 线支持 `1Min` `5Min` `15Min` `1Hour` `1Day`。

---

## 🚀 期权链自动解析 (Option Chain Auto-Resolution)

> 新增端点: `/v1/history/options/bars` 现已支持**股票代码自动解析期权链**。

这个特性允许客户端通过传入标准股票代码（如 `"AAPL"`）而非复杂的 OCC 期权合约字符串，来请求历史期权 bars。代理会自动：

1. 检测输入为股票代码（非 OCC 格式）
2. 查询 **ThetaData 合约列表**（过滤当日活跃合约）
3. 自动解析前 10 个期权合约为标准 OCC 字符串（如 `AAPL260918C00360000`）
4. 并行查询返回这些合约的历史 bars

### 使用示例

```bash
curl -X POST https://api.leandata.uk/v1/history/options/bars \
  -H "Content-Type: application/json" \
  -d '{
    "token": "你的token",
    "symbol": "AAPL",
    "timeframe": "1Min",
    "start": "2026-05-19T09:30:00Z",
    "end": "2026-05-19T16:00:00Z"
  }'
```

**返回示例**：
```json
{
  "bars": {
    "AAPL260522C00200000": [...],
    "AAPL260522C00210000": [...]
  }
}
```
