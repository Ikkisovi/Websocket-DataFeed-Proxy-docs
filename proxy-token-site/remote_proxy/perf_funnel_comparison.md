# 当前架构 vs Tailscale Funnel 对比分析

## 当前架构（已实测）

```
User ──公网──→ EC2:8768 ──Caddy──→ Tailscale mesh ──→ ThinkCentre:8768 ──→ Proxy ──→ DB
     ↑ 10-30ms   ↑ 0ms (同机)     ↑ 15-30ms              ↑ 0ms              ↑ 2ms

实测结果:
  CACHE_HIT p95: 220ms
  DB_HIT    p95: 3.4ms (本地) / ~330ms (公网)
  吞吐量:       124 req/s (公网) / 891 req/s (本地)
```

瓶颈:**EC2 公网入口 + Caddy 转发**

## Funnel 架构（理论分析 + 测试方案）

```
User ──公网 HTTPS──→ Tailscale DERP 中继 ──Tailscale 隧道──→ ThinkCentre:443 ──serve──→ Proxy ──→ DB
     ↑ TLS 握手      ↑ DERP 路由 (~20-40ms)    ↑ 0ms                ↑ 0ms              ↑ 2ms
```

### Funnel 延迟模型

| 组件 | 延迟 | 说明 |
|------|------|------|
| 用户 → DERP | 10-30ms | 取决于用户位置到最近 DERP |
| DERP → ThinkCentre | 10-20ms | DERP 到 ThinkCentre（美国西海岸） |
| TLS 终止 | +5-10ms | Funnel 自动 HTTPS |
| serve 转发 | +1-2ms | localhost:8768 |
| DB 查询 | +2ms | 本地 NVMe |
| **总计 Funnel** | **~30-60ms** | 预估 |
| **当前 EC2** | **~100-300ms** | 实测 |
| **Tailscale 直连** | **~1-3ms** | 实测（内网 only） |

### 为什么 Funnel 比 EC2 快？

| 因素 | EC2 路径 | Funnel 路径 |
|------|----------|-------------|
| 网络跳数 | 用户→EC2→Caddy→Tailscale→ThinkCentre (4跳) | 用户→DERP→ThinkCentre (2跳) |
| 协议转换 | HTTP→Caddy→HTTP→Tailscale→HTTP | HTTPS→Tailscale 隧道→HTTP |
| TLS 终止 | 无（HTTP） | Funnel 自动管理（零配置） |
| 连接池 | Caddy keepalive (60s) | Tailscale 长连接 |
| 带宽瓶颈 | EC2 t3.micro 限制 | Tailscale 无限制 (Plus) |

### Funnel 风险

| 风险 | 说明 | 缓解 |
|------|------|------|
| DERP 位置不确定 | 如果 DERP 在欧洲，延迟可能比 EC2 还高 | 可配置 `tailscale up --derp-region=us-west` |
| Plus 费用 | $6/用户/月 | 只有 funnel 节点需要 Plus |
| 依赖 Tailscale 服务 | DERP 宕机则无法访问 | 保留 EC2 作为 fallback |

---

## 升级 Plus 后的测试方案

### 步骤 1: 启用 Funnel（ThinkCentre 上）

```bash
ssh mint@100.70.107.106

# 升级 Tailscale 到 Plus（在 https://login.tailscale.com/admin/settings/billing 操作）

# 启用 funnel（在 serve 基础上暴露到公网）
tailscale funnel on

# 验证
tailscale funnel status
# 应显示: https://mint-thinkcentre-m900.<tailnet>.ts.net (funnel on)
```

### 步骤 2: 运行对比测试

```bash
# 在任意机器上运行（WSL2 / EC2 / 本地）
python3 perf_funnel_vs_ec2.py --token <token>
```

测试脚本已准备: `perf_funnel_vs_ec2.py`

### 步骤 3: 结果解读

```
如果 Funnel p95 < EC2 p95 * 0.5:
  → Funnel 显著更快，建议迁移

如果 Funnel p95 在 EC2 p95 * 0.5 ~ 1.0 之间:
  → 差异不大，保留双入口

如果 Funnel p95 > EC2 p95:
  → DERP 位置不利，保持现状
```

---

## 推荐策略

### 阶段 1: 保持现状（现在）
- EC2 公网入口不变
- 继续用 warmer v3 回填 DB
- 监控 `/health` DB 命中率

### 阶段 2: 评估 Funnel（升级 Plus 后 1 周）
- 启用 Funnel
- 运行 `perf_funnel_vs_ec2.py`
- 对比 1 周数据

### 阶段 3: 决策（评估后）
- **Funnel 更快**: 逐步迁移用户到 Funnel URL，EC2 作为 fallback
- **Funnel 无优势**: 保持 EC2 为主入口，Tailscale 只用于管理
- **混合**: 美国用户走 Funnel，亚洲用户走 EC2（GeoDNS）
