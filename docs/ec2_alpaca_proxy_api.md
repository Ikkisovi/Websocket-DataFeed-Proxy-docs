# Alpaca 行情代理 API 使用指南

> 更新时间: 2026-05-27
> 统一服务入口:
> - **Token 门户**: `https://leandata.uk` (或本地开发端口 `3000`)
> - **REST 历史数据代理 (Cloudflare 缓存)**: `https://api.leandata.uk`
> - **REST 实时数据代理 (Cloudflare 实时)**: `https://rt-api.leandata.uk`
> - **WebSocket 实时流 (EC2 直连)**: `ws://52.37.182.24:8767/stream`

这个代理让你**用一个 Token 就能快速拉取美股实时行情与历史数据**，免去了自行持有 Alpaca API 凭据或 ThetaData 账号的繁琐配置。

---

## 快速认证与开始

所有数据端点（REST 和 WebSocket）均需要一个 UUID Token 进行鉴权。

### 1. 认证方式
你可以将 Token 作为 HTTP Header 传入（推荐），或直接放在 POST 请求的 JSON 体中：

```http
# 方式 A — Authorization 标头 (推荐)
Authorization: Bearer 你的Token
```

```json
// 方式 B — 请求体参数
{
  "token": "你的Token",
  "symbol": "AAPL",
  ...
}
```

### 2. 测试连通性
```bash
curl https://api.leandata.uk/health
# → OK
```

---

## WebSocket 实时流

实时行情连接步骤：**建立连接 → 发送 `auth` 鉴权 → 接收成功确认 → 发送 `subscribe` 订阅消息 → 接收实时数据流**。

### ⚠️ 二进制通道解码说明 (非常重要)
为实现超低延迟分发，高频通道均采用 **MsgPack 二进制编码**。客户端收到消息后必须使用 MsgPack 库进行解码，直接使用 `JSON.parse` 会报错。

| 流通道地址 | 编码格式 | 订阅内容 | 备注说明 |
| --- | --- | --- | --- |
| `ws://52.37.182.24:8767/stream` | **MsgPack** | `trades`, `quotes` | 美股实时成交与报价 |
| `ws://52.37.182.24:8767/stream/options` | **MsgPack** | `trades`, `quotes` | 期权实时成交与报价 (仅支持个股/ETF期权，不支持指数期权) |
| `ws://52.37.182.24:8767/stream/boats` | **MsgPack** | `trades`, `quotes` | BOATS 渠道美股实时成交与报价 |
| `ws://52.37.182.24:8767/stream/overnight` | **MsgPack** | `trades`, `quotes` | 夜盘美股实时行情 |
| `ws://52.37.182.24:8767/stream/test` | **MsgPack** | `trades`, `quotes` | 测试调试专用通道 |
| `ws://52.37.182.24:8767/stream/crypto` | **JSON 文本** | `trades`, `orderbooks` | 加密货币成交与订单簿 |
| `ws://52.37.182.24:8767/stream/news` | **JSON 文本** | `news` | 实时新闻 (支持 `["*"]` 全量订阅) |

### 消息示例

* **Auth 鉴权**:
  ```json
  { "action": "auth", "token": "你的Token" }
  ```
  *成功回复: `{"T":"success","msg":"authenticated"}`*

* **订阅美股行情**:
  ```json
  { "action": "subscribe", "trades": ["AAPL"], "quotes": ["AAPL"] }
  ```

---

## 核心 HTTP REST 接口

### 1. 股票历史数据

#### 历史 K 线 (`POST /v1/history/bars`)
```bash
curl -X POST https://api.leandata.uk/v1/history/bars \
  -H "Authorization: Bearer 你的Token" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "start": "2026-05-13",
    "end": "2026-05-15",
    "timeframe": "1Min",
    "limit": 10
  }'
```

#### 合并成交与报价历史 (`POST /v1/stock/history/trade_quote`)
同时拉取股票的 Trades 和 Quotes 历史并并行分页合并：
```bash
curl -X POST https://api.leandata.uk/v1/stock/history/trade_quote \
  -H "Authorization: Bearer 你的Token" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "start": "2026-05-20T13:30:00Z",
    "end": "2026-05-20T13:31:00Z"
  }'
```

---

### 2. 期权历史与实时快照 (Options)

#### 查询期权合约列表 (`POST /v1/options/contracts`)
根据到期日或行权价筛选并返回 OCC 格式的期权代码：
```bash
curl -X POST https://api.leandata.uk/v1/options/contracts \
  -H "Authorization: Bearer 你的Token" \
  -H "Content-Type: application/json" \
  -d '{
    "underlying_symbols": "AAPL",
    "expiration_date_gte": "2026-05-16",
    "limit": 10
  }'
```

#### 期权历史 K 线 (`POST /v1/history/options/bars`)
支持直接传入 **OCC 格式合约代码** (如 `AAPL260620C00200000`) 或 **股票代码** (如 `AAPL`，系统将自动解析出该股票前 10 个活跃合约进行查询)：
```bash
curl -X POST https://api.leandata.uk/v1/history/options/bars \
  -H "Authorization: Bearer 你的Token" \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": "AAPL",
    "start": "2026-05-19",
    "end": "2026-05-19",
    "timeframe": "1Day"
  }'
```
> 💡 **提示**:
> - 默认的 `thetadata` 渠道期权历史 K 线仅提供 `1Day` 级别的日线数据。
> - 如需获取分钟级历史期权数据，请在请求体中显式指定 `"provider": "alpaca"`，Alpaca 的历史期权库自 **2024-02-01** 开始支持。

#### 批量获取期权快照 (`POST /v1/options/snapshots`)
包含最新的报价、成交、希腊字母 (Greeks) 及隐含波动率 (IV)。
```bash
curl -X POST https://api.leandata.uk/v1/options/snapshots \
  -H "Authorization: Bearer 你的Token" \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["AAPL260522C00200000"]
  }'
```

#### 按到期日拉取快照 (`POST /v1/options/snapshots/expiry`)
```bash
curl -X POST https://api.leandata.uk/v1/options/snapshots/expiry \
  -H "Authorization: Bearer 你的Token" \
  -H "Content-Type: application/json" \
  -d '{
    "underlying": "AAPL",
    "expiry": "2026-05-22"
  }'
```

#### 历史持仓量查询 (`GET/POST /v1/options/open_interest`)
```bash
curl -X POST https://api.leandata.uk/v1/options/open_interest \
  -H "Authorization: Bearer 你的Token" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "start": "2026-05-01",
    "end": "2026-05-15"
  }'
```

---

### 3. 高精度事件回测：指定时刻期权报价 (`GET/POST /v3/option/at_time/quote`)
获取 OPRA 报告在某一天中指定毫秒（如美东开盘 `09:30:01.000`）的最后一个 NBBO 报价。支持 SPX/NDX 等指数期权：
```bash
curl -X POST https://api.leandata.uk/v3/option/at_time/quote \
  -H "Authorization: Bearer 你的Token" \
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

---

### 4. 账户自助状态与审计查询

这些接口允许已鉴权用户通过其注册用户名自助查询自身的系统额度和使用审计历史：

#### 查询自身的分钟频次限额状态 (`GET/POST /api/usage/stats`)
```bash
curl -X POST https://leandata.uk/api/usage/stats \
  -H "Content-Type: application/json" \
  -d '{"username": "你的用户名"}'
```

#### 查询自身的调用审计历史 (`GET/POST /api/usage/audit`)
```bash
curl -X POST https://leandata.uk/api/usage/audit?limit=10 \
  -H "Content-Type: application/json" \
  -d '{"username": "你的用户名"}'
```
