# Proxy Token Site — 完整文档

> Token 自助发放与审核系统，面向 WebSocket DataFeed Proxy 的用户管理前端。
> 
> **部署地址**: http://52.37.182.24:3000/  
> **EC2 源码路径**: `/home/ec2-user/proxy-token-site/`  
> **WSL 本地副本**: `/home/kai/product-apim/proxy-token-site/`

---

## 1. 项目概述

Proxy Token Site 是一个基于 **Node.js + Express** 的轻量级 Web 应用，提供以下功能：

1. **新用户注册** — 买家填写用户名+手机号+选择套餐，提交后进入待审核队列
2. **审核后台** — 管理员登录后可查看待审核列表，批准或拒绝注册申请
3. **Token 自助生成** — 已批准用户输入用户名+手机号，系统自动生成 UUID Token 并同步到上游 Proxy
4. **权限分级** — 三个服务等级 (`premium` / `limited_premium` / `basic`)，控制 WebSocket 和 REST API 的访问范围

### 数据流

```
用户注册 ──→ pending.json (待审核)
                │
                ▼
         管理员批准 ──→ users.json (本地用户库)
                │           │
                ▼           ▼
         cloud-proxy/users.json (上游 Proxy 注册表)
                │
                ▼
         用户首页生成 Token (有效期30天)
```

---

## 2. 技术栈

| 组件 | 技术 |
|------|------|
| 后端 | Node.js 20 + Express 5 |
| 前端 | 纯 HTML/CSS/JS (无框架) |
| 数据存储 | JSON 文件 (users.json, pending.json, tokens.json) |
| 进程管理 | systemd (`proxy-token-site.service`) |
| 上游同步 | 直接文件写入 `/home/ec2-user/cloud-proxy/users.json` |

### 依赖 (package.json)

```json
{
  "dependencies": {
    "express": "^5.2.1",
    "cors": "^2.8.6",
    "body-parser": "^2.2.2",
    "uuid": "^14.0.0"
  }
}
```

---

## 3. 目录结构

```
proxy-token-site/
├── server.js              # Express 后端主文件 (332行)
├── package.json           # 项目依赖
├── package-lock.json      # 锁定版本
├── deploy.sh              # 一键部署脚本 (EC2)
├── server.log             # 运行时日志
├── ARCHITECTURE.md        # 旧版架构文档 (已部分过时)
│
├── data/                  # JSON 数据文件
│   ├── users.json         # 已批准用户库 (8用户)
│   ├── pending.json       # 待审核注册 (3条)
│   └── tokens.json        # 历史 token 记录
│
├── public/                # 静态前端
│   ├── index.html         # 首页: Token 生成
│   ├── register.html      # 注册页: 新用户提交 + 状态查询
│   ├── admin.html         # 管理后台: 审核/批准/拒绝
│   ├── script.js          # 首页交互逻辑
│   └── style.css          # 首页样式
│
└── scripts/               # 运维工具
    ├── register_buyer.js  # CLI: 手动添加用户到系统
    └── audit_summary.py   # 审计日志分析器
```

---

## 4. API 端点详解

### 4.1 公开端点 (无需认证)

#### `POST /api/register` — 新用户注册

**请求体**:
```json
{
  "username": "tonnysun",
  "phone": "18717931119",
  "tier": "premium"
}
```

**响应**:
```json
{
  "success": true,
  "message": "注册成功！请等待卖家确认订单后即可生成 Token。",
  "id": "61ce4f82-8b16-4e7e-be01-282730e53cc8"
}
```

**校验规则**:
- 用户名和手机号必填
- 用户名在 `users.json` 中不能已存在
- 同名用户不能在 `pending.json` 中已有 pending 状态记录

---

#### `POST /api/check-status` — 查询审核状态

**请求体**:
```json
{
  "username": "tonnysun",
  "phone": "18717931119"
}
```

**响应**:
```json
{
  "success": true,
  "status": "pending",
  "message": "审核中，请耐心等待。"
}
```

`status` 可能值: `pending` | `approved` | `rejected` | `not_found`

---

#### `POST /api/generate-token` — 生成/查询 Token

**请求体**:
```json
{
  "username": "ikkipipi",
  "phone": "15213285787"
}
```

**响应**:
```json
{
  "success": true,
  "token": "c886624f-232d-4803-99fa-f8b970e4720a",
  "expiry": "2026-06-19T14:15:57.059704+00:00",
  "role": "premium"
}
```

**逻辑**:
1. 校验 `users.json` 中是否存在匹配的用户名+手机号
2. 检查 `cloud-proxy/users.json` 是否已有该用户的 token — 有则直接返回
3. 无则生成新 UUID，有效期 = 当前时间 + 30天
4. 写入 `cloud-proxy/users.json`，包含 `token`, `user_id`, `role`, `expires_at`, `permissions`

---

#### `POST /api/admin/login` — 管理员登录

**请求体**:
```json
{ "password": "admin123" }
```

**响应**:
```json
{
  "success": true,
  "token": "<32字节hex随机字符串>"
}
```

- 密码通过环境变量 `ADMIN_PASSWORD` 配置，默认 `admin123`
- 成功后在内存 `adminSessions` Set 中记录 token

---

### 4.2 管理员端点 (需 `X-Admin-Token` Header)

#### `GET /api/admin/pending` — 待审核列表

返回 `pending.json` 中 `status === 'pending'` 的记录。

---

#### `GET /api/admin/all` — 全部记录

合并 `pending.json` + `users.json`，统一格式返回。

---

#### `POST /api/admin/approve` — 批准注册

**请求体**:
```json
{ "id": "61ce4f82-8b16-4e7e-be01-282730e53cc8" }
```

**执行流程**:
1. 在 `pending.json` 中找到对应记录，标记 `status = 'approved'`
2. 将用户信息写入 `users.json` (含 `role` 和 `permissions`)
3. **自动生成 token 并同步到 `cloud-proxy/users.json`**:
   - 生成 UUID token
   - 有效期 = 当前时间 + 1个月
   - 包含完整权限配置
4. 返回 token 和过期时间给管理员

---

#### `POST /api/admin/reject` — 拒绝注册

**请求体**:
```json
{
  "id": "...",
  "reason": "信息不完整"
}
```

标记 `status = 'rejected'`，记录拒绝原因和时间。

---

## 5. 服务等级与权限 (TIERS)

`server.js` 中硬编码了三个等级：

| 等级 | 角色名 | WebSocket 权限 | REST 权限 |
|------|--------|---------------|-----------|
| **premium** | `premium` | stocks, options, overnight, crypto, news, boats, test | stocks_history, options_history, options_contracts, options_snapshots, options_snapshots_expiry, crypto_orderbooks, news_history |
| **limited_premium** | `limited_premium` | stocks, options (无 overnight/crypto/news/boats/test) | stocks_history, options_history, options_contracts, options_snapshots, options_snapshots_expiry (无 crypto_orderbooks/news_history) |
| **basic** | `basic` | stocks, news (无 options/overnight/crypto/boats/test) | stocks_history, news_history (无 options 相关/crypto) |

> **注意**: `register.html` 前端展示的是 `Basic/Standard/Premium` 三档定价，但后端实际只认 `premium/limited_premium/basic`。前端 `standard` 选项映射到后端的哪个 tier 需要确认。

---

## 6. 前端页面

### 6.1 `/` (index.html) — Token 生成页

- 左侧: 表单输入用户名+手机号，点击生成 Token
- 右侧: iframe 嵌入文档 `https://ikkisovi.github.io/Websocket-DataFeed-Proxy-docs/`
- 支持 sidebar 折叠 (toggle 按钮)
- Token 显示框支持一键复制

### 6.2 `/register.html` — 注册页

- 暗色主题，移动端友好
- 展示三档套餐价格 (Basic 20/月, Standard 50/月, Premium 100/月)
- 表单: 用户名 + 手机号 + 服务等级选择
- 底部: 审核状态查询区 (输入用户名+手机号查进度)
- 注册成功提示 + 链接跳转到首页生成 Token

### 6.3 `/admin.html` — 管理后台

- 暗色主题，登录弹窗
- 顶部统计: 待审核数 / 已批准数
- Tab 切换: 待审核 / 全部记录
- 每张卡片显示: 用户名、等级 badge、手机号、注册时间
- 操作按钮: ✅ 批准 / ❌ 拒绝 (拒绝时可填写原因)
- Toast 通知

---

## 7. 运维工具

### 7.1 `scripts/register_buyer.js` — CLI 手动注册

绕过前端注册流程，直接添加已付费用户。

```bash
node scripts/register_buyer.js <username> <phone> <plan>
```

**Plan 选项**:
- `basic10` — 基础行情流 (20/月)
- `standard100` — 标准行情流 (50/月)
- `advanced` — 全功能高级 (100/月)
- `premium` — 全包尊享 (130/月)

> 注意: 这个脚本的 `TIERS` 定义与 `server.js` 中的不完全一致，是历史遗留。

### 7.2 `scripts/audit_summary.py` — 审计分析

分析 proxy 的 `audit.jsonl` 日志，输出用量统计。

```bash
python3 scripts/audit_summary.py --days=7 --top-users=10
```

输出包括: 总请求数、独立用户数、Top 用户、Top endpoints、WebSocket 模式、HTTP 状态码、热门标的、小时分布。

---

## 8. 部署与运维

### 8.1 部署脚本 (deploy.sh)

```bash
cd /home/kai/product-apim/proxy-token-site
bash deploy.sh
```

**流程**:
1. 本地打包 (排除 node_modules)
2. SCP 上传到 EC2 `/tmp/`
3. SSH 解压到 `/home/ec2-user/proxy-token-site/`
4. 备份旧版 `server.js`
5. 清空 `pending.json`
6. 创建/重启 systemd service
7. Health check (检查 3 个页面 HTTP 200)

> ⚠️ `deploy.sh` 中硬编码了旧 IP `35.88.155.223` 和 RSA 密钥 `alpacaproxy.pem`，需要更新为当前主 EC2 `52.37.182.24` 和 ed25519 密钥。

### 8.2 systemd 服务配置

```ini
[Unit]
Description=Proxy Token Site
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user/proxy-token-site
Environment=ADMIN_PASSWORD=admin123
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### 8.3 常用运维命令

```bash
# 查看服务状态
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "sudo systemctl status proxy-token-site"

# 查看日志
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "sudo journalctl -u proxy-token-site -f"

# 重启服务
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "sudo systemctl restart proxy-token-site"

# 查看数据文件
ssh -i ~/.ssh/id_ed25519 ec2-user@52.37.182.24 "cat /home/ec2-user/proxy-token-site/data/users.json | jq ."
```

---

## 9. 当前数据快照

### users.json (已批准用户: 8人)

| 用户名 | 手机号 | 等级 | 来源 |
|--------|--------|------|------|
| user1 | 1234567890 | premium | 初始测试 |
| user2 | 0987654321 | restricted (仅news) | 初始测试 |
| 谈小片生意被片250 | 123456789 | premium | 初始测试 |
| ikkipipi | 15213285787 | premium | 注册 |
| js | 17657336886 | premium | 注册 |
| 托尼损 | 13816672286 | premium | 注册 |
| testuser123 | 13900139000 | premium | 注册 (含token) |
| 卜拎吥零 | 18154317642 | limited_premium | 注册 |

### pending.json (待审核: 3人)

| 用户名 | 手机号 | 等级 | 注册时间 |
|--------|--------|------|----------|
| kikikoko | 19356526815 | premium | 2026-05-18 |
| tonnysun | 18717931119 | premium | 2026-05-19 |
| richardman | 18154317642 | premium | 2026-05-22 |

---

## 10. 已知问题与注意事项

1. **部署脚本 IP 过时** — `deploy.sh` 指向 `35.88.155.223`，当前主 EC2 是 `52.37.182.24`
2. **部署脚本密钥过时** — 使用 RSA `alpacaproxy.pem`，当前应使用 ed25519 密钥
3. **前端套餐与后端 tier 映射不明确** — `register.html` 展示 `Basic/Standard/Premium`，但后端只认 `basic/limited_premium/premium`，`standard` 的映射逻辑需确认
4. **Token 有效期** — 批准时生成 token 有效期1个月；用户自助生成时也是1个月。但 `users.json` 中 `js` 用户的 `expires_at` 字段在本地库中，实际以 `cloud-proxy/users.json` 为准
5. **数据无备份** — JSON 文件是单点存储，建议定期 `scp` 备份或加入 git
6. **无 HTTPS** — 当前 http://52.37.182.24:3000/ 明文传输，敏感信息（手机号、token）存在泄露风险
7. **admin token 内存存储** — 服务重启后所有 admin session 失效，需重新登录

---

## 11. 文件清单与行数

| 文件 | 行数 | 说明 |
|------|------|------|
| `server.js` | 332 | Express 后端主文件 |
| `public/index.html` | 54 | Token 生成页 |
| `public/register.html` | 186 | 注册页 (含内联 CSS+JS) |
| `public/admin.html` | 236 | 管理后台 (含内联 CSS+JS) |
| `public/script.js` | 80 | 首页交互 |
| `public/style.css` | 247 | 首页样式 |
| `scripts/register_buyer.js` | 108 | CLI 注册工具 |
| `scripts/audit_summary.py` | 196 | 审计分析器 |
| `deploy.sh` | 69 | 部署脚本 |
| `ARCHITECTURE.md` | 93 | 旧版架构文档 |
