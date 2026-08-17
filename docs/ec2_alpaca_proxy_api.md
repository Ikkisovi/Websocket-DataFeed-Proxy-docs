# Alpaca 行情代理 API

> 更新时间: 2026-08-05
> 当前公共入口: REST `https://api.leandata.uk` | WS `wss://leandata.uk/stream`

这个代理让你**用一个 token 就能获取美股实时行情和历史数据**，不需要自己持有 Alpaca API key 或 ThetaData 账号。

**新增**: REST 数据统一走 Provider 路由层，支持 Alpaca native stocks / crypto / options / news 与 ThetaData Value 期权白名单；成功响应进入服务端缓存。
**新增 (2026-05-22)**: 股票逐笔 Tick 级成交与报价历史数据端点 `/v1/stock/history/trade_quote`，直连 ThetaData。

---

## 订阅套餐

| 套餐 | 价格 | 历史 REST 并发 | WS 限制 | 可用数据流 |
| --- | --- | --- | --- | --- |
| **Trial** | ¥50/3天 | 3 | 每连接 500 subjects；无账号级连接数上限 | Standard 能力，3 天试用 |
| **Basic** | 老账户兼容 | 3 | REST only | 全部可用历史数据、快照，无实时流；不设套餐专属请求大小预算 |
| **Value** | ¥70/月 | 3 | 每连接 500 subjects；无账号级连接数上限 | 全部实时流 + 股票或期权历史二选一 |
| **Standard** | ¥100/月 | 3 | 每连接 500 subjects；无账号级连接数上限 | 股票与期权实时流 + 历史数据 |
| **Premium** | ¥150/月 | 3 | 每连接 500 subjects；无账号级连接数上限 | 全部实时流 + 全部历史数据 |

> 当前没有按套餐执行的滚动 REST req/min 限额；上游 QPS、key pool 与服务总并发限制仍会返回 `429`/`503`。
>
> **Basic 历史范围**：Basic 可以查询全部可用历史，不设套餐专属的日期跨度、symbol 数或页数预算。请求仍受上游限制和 proxy 的历史并发、QPS、超时与过载背压控制；Basic 可能比高等级慢。Bulk Download 是单独的一次性交付产品，不是解锁旧日期的必要条件。
>
> 注册地址：`https://leandata.uk/register`
> 选择套餐并填写信息后，等待管理员确认即可自助生成 Token。

---

## 快速开始

### 1. 拿到你的 token

在 `http://52.37.182.24:3000/register.html` 注册并选择套餐，等待管理员确认后即可自助生成 Token。不需要 Alpaca 账号。

### 2. 测试连通性

```bash
curl http://52.37.182.24:8768/health
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
curl -X POST http://52.37.182.24:8768/v1/history/bars \
  -H 'Content-Type: application/json' \
  -d '{"token":"你的token","symbol":"AAPL","start":"2026-05-13","end":"2026-05-15","timeframe":"1Min","limit":10}'
```

### 5. 拉取股票逐笔 Tick 成交与报价历史 (HTTP)

```bash
curl -X POST http://52.37.182.24:8768/v1/stock/history/trade_quote \
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
GET http://52.37.182.24:8768/health
→ OK
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
  "http://52.37.182.24:8768/v2/stocks/quotes/latest?symbols=AAPL&feed=sip"

# 单只股票 snapshot
curl -H "Authorization: Bearer 你的token" \
  "http://52.37.182.24:8768/v2/stocks/AAPL/snapshot?feed=sip"

# condition codes
curl -H "Authorization: Bearer 你的token" \
  "http://52.37.182.24:8768/v2/stocks/meta/conditions/trade?tape=C"
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
  "http://52.37.182.24:8768/v2/stocks/quotes/latest?symbols=AAPL&feed=sip"

# 最新 crypto 报价
curl -H "Authorization: Bearer 你的token" \
  "http://52.37.182.24:8768/v1beta3/crypto/us/latest/quotes?symbols=BTC%2FUSD"
```

部分旧版接口文档曾把 `provider` 写成强制路由参数。当前 v2 期权 bars wrapper 使用归档/ThetaData 优先、必要时 Alpaca 部分回退；响应中的 `provider`、`providers` 和 `coverage_roles` 才是实际来源证据。不要把 `provider` 当作当前 bars wrapper 的硬切换开关。

| provider | 行为 |
| --- | --- |
| `auto` | 旧版兼容值；当前 v2 wrapper 按接口固定路由并返回实际来源。 |
| `thetadata` / `theta` | 仅适用于明确支持该参数的 native 路由；不代表当前 bars wrapper 会硬切换。 |
| `alpaca` | 仅适用于明确支持该参数的 native 路由；不代表当前 bars wrapper 会跳过归档。 |

重叠接口 fallback 规则：

| 接口 | 默认路由 |
| --- | --- |
| `/v1/history/options/bars` | 规范 `1Min` 期权 K 线；实际来源见响应中的 `provider`、`providers`、`coverage_roles`。仅当请求起点为 **2024-02-01 或之后** 时允许回退 Alpaca 稀疏成交活动；更早开始、包括跨过边界的请求不会使用 Alpaca。`/v1/options/bars` 是兼容旧客户端的别名 |
| `/v1/options/contracts` | 当前活跃合约由 Alpaca native 返回；历史/已到期合约请用 `/v3/option/list/contracts/{trade|quote}` 并传 `date` |
| `/v1/options/snapshots` | Alpaca only（ThetaData Value 不含 Greeks/IV/market value） |
| `/v1/options/snapshots/quote`、`/v1/options/snapshots/trade` | Alpaca latest quote/trade 优先，归一化到 `snapshots[OCC].latestQuote/latestTrade` |
| `/v1/options/snapshots/open_interest`、`/v3/option/snapshot/*` | ThetaData Value 可用快照 |
| `/v3/option/*` | ThetaData Value 白名单，无 Alpaca fallback |

服务端会缓存成功的 REST 响应。命中时响应头为 `X-Cache: DISK_HIT`。缓存键会剔除 `token` / API key 等凭据；TTL：历史数据 7 天、当日/盘中 60 秒、快照 5 分钟、合约/list 1 小时。

ThetaData Value 开放期权 list、minute/EOD OHLC、snapshot `ohlc` / `quote` / `open_interest`、history `eod` / `ohlc` / `quote` / `open_interest`、`at_time/quote`。不开放 option trades、trade_quote、market value、implied volatility、Greeks。

💡 **指数期权支持 (REST)**：期权 bars 必须传 OCC 合约代码；归档/ThetaData 覆盖到的 `SPX`、`SPXW`、`NDX` 等合约可以查询历史 K 线。历史/已到期合约的发现使用 `/v3/option/list/contracts/trade` 或 `/v3/option/list/contracts/quote`，并传历史 `date`；不要用当前活跃合约 wrapper 代替历史合约列表。

### 期权历史 K 线

```
POST /v1/history/options/bars
```

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `token` | string | ✅ | 代理 token |
| `symbols` | string | ✅ | OCC 期权代码，可逗号分隔多个合约，例如 `AAPL260522C00200000` |
| `start` | string | ✅ | 开始日期 |
| `end` | string | ✅ | 结束日期 |
| `timeframe` | string | ❌ | 输出固定为 `1Min`；传入其他值会兼容性归一化为 `1Min`，不会返回服务端聚合的 5 分钟 K 线 |
| `provider` | string | ❌ | 当前 v2 bars wrapper 不把它作为硬切换开关；实际来源看响应中的 `provider`、`providers`、`coverage_roles` |
| `limit` | int | ❌ | 默认 10000 |
| `max_pages` | int | ❌ | 默认 100 |

OCC 格式: [股票代码][到期日YYMMDD][C/P][行权价*1000]
- 示例: AAPL260522C00200000 = AAPL 2026-05-22 Call 200.00

获取期权代码流程:
1. 当前活跃合约可先用 `/v1/options/contracts` 查询
2. 历史/已到期合约使用 `/v3/option/list/contracts/trade` 或 `/v3/option/list/contracts/quote` 并传 `date`
3. 从返回的 `symbol` 字段获取 OCC 代码
4. 再用该代码请求 `/v1/history/options/bars`

返回固定为 `timeframe: "1Min"`，并通过 `provider`、`providers` 和 `coverage_roles` 标明实际来源；仅当 `start >= 2024-02-01` 时可能回退到 Alpaca 的稀疏成交活动。`start` 早于该日期（包括跨过边界）的请求不会使用 Alpaca；若 ThetaData 无法提供，wrapper 返回 HTTP `502` 和 `thetadata_required_for_option_history`。

> ⚠️ **固定粒度边界**：期权历史 bars 永远返回 `1Min`。传入 `5Min`、`15Min`、`30Min` 或 `1Hour` 只会被兼容性归一化为 `1Min`，不会返回服务端聚合结果。需要其他周期时，请在客户端使用返回的 `1Min` bars 自行重采样。
>
> ⚠️ **来源边界**：`provider`、`providers` 和 `coverage_roles` 是实际来源证据；稀疏成交回退不能当作完整合约链覆盖。
>
> ⚠️ **历史日期边界**：Alpaca fallback 仅适用于 `start >= 2024-02-01`。更早历史不会落到 Alpaca，跨过该日期的请求也按更早的起点处理。
>
> **Basic** 可以查询全部可用历史，不设套餐专属的日期跨度、symbol 数或分页数预算。遇到 `429` 请等待在途请求完成并指数退避；`429`/`503` 表示 proxy 或上游运行时限制，而不是历史权限或历史年龄限制。

兼容旧客户端的请求：

```bash
curl -X POST "https://api.leandata.uk/v1/history/options/bars" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"symbols":"AAPL260620C00200000","start":"2025-05-01","end":"2025-05-02","timeframe":"5Min"}'
```

上面的请求仍返回 `"timeframe": "1Min"`。客户端重采样示例：

```python
import pandas as pd

frame = pd.DataFrame(payload["bars"]["AAPL260620C00200000"])
frame["t"] = pd.to_datetime(frame["t"], utc=True)
bars_5m = (
    frame.set_index("t")
    .resample("5min")
    .agg({"o": "first", "h": "max", "l": "min", "c": "last", "v": "sum", "n": "sum"})
    .dropna(subset=["o", "h", "l", "c"])
)
```

### 期权历史逐笔成交

```
GET/POST /v1/history/options/trades
GET /v1beta1/options/trades
```

数据源为 Alpaca historical option trades。Alpaca 历史期权数据从 **2024-02-01** 开始；更早日期会返回空数据，wrapper 路由会附带 `data_availability` 和 `warning`。

```bash
curl -H "Authorization: Bearer 你的token" \
  "http://52.37.182.24:8768/v1beta1/options/trades?symbols=AAPL260620C00200000&start=2025-01-02&end=2025-01-03&limit=100"
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
  "limit": 100
}
```

支持的筛选字段: `underlying_symbols`, `expiration_date`, `expiration_date_gte`, `expiration_date_lte`, `strike_price_gte`, `strike_price_lte`, `type` / `option_type`, `limit`。

- 该 wrapper 返回当前活跃合约，数据源为 Alpaca native。
- 历史/已到期合约请直接使用 `/v3/option/list/contracts/trade` 或 `/v3/option/list/contracts/quote`。
- 历史合约列表的 `date`、`request_type` 和 `max_dte` 参数属于 native v3 路由，不是这个 wrapper 的历史开关。

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
curl -X POST http://52.37.182.24:8768/v1/options/snapshots/quote \
  -H "Authorization: Bearer 你的token" \
  -H "Content-Type: application/json" \
  -d '{"symbols":"AAPL260620C00200000","feed":"indicative"}'

curl -H "Authorization: Bearer 你的token" \
  "http://52.37.182.24:8768/v1beta1/options/trades/latest?symbols=AAPL260620C00200000&feed=indicative"
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
  "http://52.37.182.24:8768/v3/option/history/ohlc?root=AAPL&exp=260620&strike=200000&right=C&start_date=20250102&end_date=20250103"
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
  "http://52.37.182.24:8768/v3/option/at_time/quote?symbol=AAPL&expiration=20241108&strike=220.000&right=call&start_date=20241104&end_date=20241104&time_of_day=09:30:01.000"
```

**POST 请求 (JSON Body):**
```bash
curl -X POST http://52.37.182.24:8768/v3/option/at_time/quote \
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

response = httpx.post("http://52.37.182.24:8768/v3/option/at_time/quote", json=params, headers=headers)
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
| `429` | **运行时限制**（历史 REST 并发、上游 QPS/key pool，或 WS subject 数超限） |
| `500` | 代理内部错误（上游 Alpaca 故障等） |

### 运行时限制

套餐角色决定 endpoint 和频道权限；以下限制由当前 Runtime 实际执行，超限返回 `429`。

| 限制 | 当前值 | 作用域 |
| --- | --- | --- |
| 历史 REST 并发 | 3 | 每普通账号 |
| ThetaData REST QPS | 5/s | 每普通账号 |
| ThetaData native 并发 | 2 | 全服务共享 |
| WS subjects | 500 | 每条连接 |
| Free WS subjects | 10 | 同账号所有连接合计 |
| 付费 WS 连接数 | 无账号级硬上限 | 仍受服务实际容量约束 |

> 注意: `/v1/stock/history/trade_quote` 端点由于返回逐笔 Tick 数据量极大，建议单次查询不超过 1 个交易日，并合理设置 `start_time`/`end_time` 缩小范围。

> WS 按实际 subject 投递计数，不按唯一 ticker 去重。`AAPL trades` 与 `AAPL quotes` 算两个 subjects；同一 subject 在两条连接上订阅也算两次，因为数据会发送两次。不同账号独立计数。需要向多个本地进程分发时，建议只维持少量上游 WS，再通过本地代理扇出。

### 管理接口（Admin）

以下接口任何已认证用户均可调用。非管理员只能查看**自己的**数据；管理员可查看全部。

#### 查询审计日志

```
POST /v1/admin/audit
```

```bash
curl -X POST 'http://52.37.182.24:8768/v1/admin/audit?limit=50' \
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
curl -X POST http://52.37.182.24:8768/v1/admin/stats \
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

**Q: 历史数据走代理还是直连？**  
默认直连 Alpaca REST。如果直连失败且设置了 `ALPACA_HISTORY_AUTO_FALLBACK=1`，会自动切到代理。

**Q: 期权代码格式？**  
标准 OCC 格式，如 `AAPL260522C00200000` = AAPL 2026-05-22 Call $200。

**Q: 为什么我收到的数据是乱码？**  
检查帧编码表 —— 股票和期权的 WS 流是 MsgPack，需要用 `msgpack.unpackb()` 解码。

**Q: 支持哪些时间框架？**  
实时流无 bars；期权历史 K 线输出固定为 `1Min`，客户端如需 `5Min` 等周期请自行聚合。期权 bars 使用 OCC 合约代码；Basic 的历史请求不受套餐专属请求大小预算限制，但仍受 proxy 和上游运行时限制。

---

## 期权链与历史合约发现

`/v1/history/options/bars` 当前要求传入 OCC 期权合约代码。`/v1/options/contracts` 只用于发现当前活跃合约，不是历史/已到期合约全集。

查询历史或已到期合约时，先调用：

### 使用示例

```bash
curl -G https://api.leandata.uk/v3/option/list/contracts/trade \
  -H "Authorization: Bearer 你的token" \
  --data-urlencode "date=2024-10-01" \
  --data-urlencode "symbol=AAPL"
```

再把历史合约列表返回的 OCC `symbol` 传给 `/v1/history/options/bars`。
