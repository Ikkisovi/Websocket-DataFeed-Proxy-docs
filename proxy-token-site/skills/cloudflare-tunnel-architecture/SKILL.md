---
name: Cloudflare Tunnel Architecture
description: Explains the Cloudflare Zero Trust Tunnel setup replacing EC2+Caddy+Tailscale, with tested latency benchmarks and operational commands. Domain leandata.uk.
---

# Cloudflare Tunnel 架构逻辑与部署拓扑

## 1. 架构演进

### 过去 (EC2 + Caddy + Tailscale)

用户 → EC2 (公网IP) → Caddy → Tailscale 隧道 → ThinkCentre localhost

**痛点：** EC2 是"昂贵的传话筒" — 每月 ~$15，增加延迟，性能天花板。

### 中间尝试 (Tailscale Funnel)

用户 → Tailscale Funnel → ThinkCentre localhost

**结果：慢。** Funnel 不支持自定义域名，延迟不理想。

### 现在 (Cloudflare Zero Trust Tunnel) ✅

用户 → Cloudflare Anycast 边缘节点 → cloudflared 长连接 → ThinkCentre localhost

**优势：**
- 免费（域名 ~$10/年）
- 全球 Anycast — 用户连最近的边缘节点
- 无需公网 IP、无需 EC2、无需 Caddy
- `cloudflared` 是 Go 写的高性能网络穿透，专门优化大流量
- 自动 TLS，DDoS 防护

---

## 2. 当前路由配置

域名 `leandata.uk` DNS 由 Cloudflare 管理。路由在 Cloudflare Dashboard 远程配置（无本地 config.yml）。

**混合架构**：REST 走 Cloudflare Tunnel → ThinkCentre，WS 走 EC2 直连（不经过 Cloudflare）。

| 公网域名 | → ThinkCentre 目标 | 用途 |
|---|---|---|
| `api.leandata.uk` | `http://localhost:8768` | REST API 代理 |
| `leandata.uk` | `http://localhost:3000` | 主站（docs + register + admin + token API + status） |
| Catch-all | `http_status:404` | 默认返回 404 |

**注意**: `ws.leandata.uk` 已删除。WS 直接连 EC2 (`ws://52.37.182.24:8767/*`)，不走 Cloudflare Tunnel。原因：EC2 到 Alpaca 的 AWS 内网延迟更低（p50 33.5ms vs TC 的 58.6ms）。

---

## 3. 实测延迟基准 (2026-05-25)

从 WSL (同一局域网) 测试，代表内网视角。外部用户通过 Cloudflare Anycast 会更快。

### REST

| 路径 | Health (warm) | Bars (cached) |
|---|---|---|
| Cloudflare (`leandata.uk`) | 120-240ms | ~400ms |
| EC2 legacy | 65-200ms | ~80ms |
| Tailscale 直连 | 90-120ms | ~43ms |

Cloudflare 从内网测有 ~300ms 额外开销（请求出家 → CF 边缘 → 再回来）。外部用户没有这个回程。

### WebSocket

**WS 不走 Cloudflare Tunnel。** 实测 EC2 直连 Alpaca WS 延迟更低（p50 33.5ms vs TC 58.6ms），所以 WS 全部走 EC2 (`ws://52.37.182.24:8767/*`)。

ThinkCentre proxy 设置 `REST_ONLY=true`，不连 WS 上游。

---

## 4. 运维指南

### 安装 cloudflared

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb
```

### 注册为系统服务

```bash
sudo cloudflared service install <TUNNEL_TOKEN>
```

### 日常运维

```bash
# 状态
sudo systemctl status cloudflared

# 实时日志
sudo journalctl -u cloudflared -f

# 查看最近错误
sudo journalctl -u cloudflared --since "10 min ago" | grep -E "ERR|Updated|config"

# 重启（重置全部 4 条边缘连接）
sudo systemctl restart cloudflared
```

### 路由变更

在 Cloudflare Dashboard → Zero Trust → Networks → Tunnels → 选择 Tunnel → Public Hostnames 修改。
变更 ~30 秒内自动推送到 `cloudflared`（日志显示 "Updated to new configuration"）。

### 已知行为

- `cloudflared` 维持 4 条并行边缘连接，偶尔某条 `control stream failure` 是正常的，会自动重连
- Cloudflare 默认 WebSocket idle timeout 100s — 活跃的 stream 不受影响
- 如果全部 4 条都断开，检查家庭网络或 `sudo systemctl restart cloudflared`

---

## 5. EC2 角色变更

EC2 不再退役 — 它在混合架构中承担 WS 代理角色（AWS 内网到 Alpaca 延迟更低）。

- ✅ EC2 上的 Caddy + PM2 + token-site 已停止
- ✅ EC2 只运行 WS-only Docker proxy（端口 8767）
- ✅ users.json 从 ThinkCentre SCP 同步到 EC2（方向已反转）
- EC2 成本保留（WS 实时流需要低延迟）

---

## 6. Status & Incident API

Token portal (port 3000) 暴露 Status + Incident API，前端 StatusBody（内嵌 `docs-site.jsx`）消费：

| Endpoint | 说明 |
|---|---|
| `GET /api/status` | 探测 REST proxy `/health` + WS TCP 连接。返回 `overall` + 各组件状态。**自动检测故障并记录事件。** |
| `GET /api/uptime` | 90 天每日可用性百分比数组 |
| `GET /api/latency?range=24h\|7d\|30d` | 分桶延迟时序（1h 桶，每桶 p50） |
| `GET /api/incidents` | 事件列表（最新在前，上限 100 条） |
| `POST /api/incidents` | 手动记录事件 `{component, severity?, title, summary?, duration?}` |

**自动事件触发**（在 `/api/status` 探测内运行）：
- 服务器启动 → `resolved` "Service restart"
- REST/WS 探测 up→down → `major` 故障事件
- REST/WS 探测 down→up → `resolved` 恢复事件

数据持久化到 `data/status.json`。无需认证。
