const { useEffect: useAccountEffect, useMemo: useAccountMemo, useState: useAccountState } = React;

const ACCOUNT_PLANS = [
  {
    id: "basic",
    name: "Basic",
    price: 40,
    summary: "仅 REST · 交互历史查询",
    detail: "无实时 WebSocket；适合轻量历史查询。",
    wsConnections: 0,
  },
  {
    id: "value",
    name: "Value",
    price: 50,
    summary: "全部 WS · REST 二选一",
    detail: "选择股票或期权方向，适合单一数据工作流。",
    wsConnections: 2,
    modes: [
      { id: "stocks", label: "股票方向" },
      { id: "options", label: "期权方向" },
    ],
  },
  {
    id: "standard",
    name: "Standard",
    price: 80,
    summary: "主流套餐",
    detail: "全部 WS 通道与股票、期权历史数据。",
    wsConnections: 3,
    badge: "POPULAR",
  },
  {
    id: "premium",
    name: "Premium",
    price: 130,
    summary: "完整接入",
    detail: "最大实时容量与完整 REST 权限。",
    wsConnections: "∞",
  },
];

const ACCOUNT_MONTH_OPTIONS = [1, 2, 3, 6, 12];

async function accountRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  let data = {};
  try {
    data = await response.json();
  } catch (_) {}
  if (!response.ok) {
    const error = new Error(data.message || "请求失败，请稍后重试。");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function formatAccountDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAccountNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-US") : "—";
}

function AccountTopbar({ loggedIn, onLogout }) {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="dot"></span>
        <span><strong>Leandata Account</strong></span>
      </div>
      <div className="divider"></div>
      <div className="nav">
        <a href="/">Proxy API</a>
        <a href="/docs/">Docs</a>
        <a href="/register">新用户注册</a>
        <a href="/account" className="active">账户管理</a>
      </div>
      <div className="spacer"></div>
      <div className="meta">
        <span className="pill"><span className="live"></span> production</span>
        {loggedIn && (
          <button className="btn ghost" onClick={onLogout} style={{ padding: "6px 10px", fontSize: 12 }}>
            退出登录
          </button>
        )}
      </div>
    </div>
  );
}

function AccountLogin({ onLoggedIn }) {
  const [userId, setUserId] = useAccountState("");
  const [phone, setPhone] = useAccountState("");
  const [loading, setLoading] = useAccountState(false);
  const [message, setMessage] = useAccountState("");

  const submit = async event => {
    event.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      await accountRequest("/api/account/login", {
        method: "POST",
        body: JSON.stringify({
          credential: {
            user_id: userId.trim(),
            phone: phone.trim(),
          },
        }),
      });
      setPhone("");
      await onLoggedIn();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="account-login-wrap">
      <section className="account-login-copy">
        <div className="eyebrow" style={{ marginBottom: 14 }}>Private account portal</div>
        <h1 className="display-title" style={{ fontSize: "clamp(48px, 7vw, 82px)", margin: 0, maxWidth: 720 }}>
          管理你的数据访问，
          <span style={{ color: "var(--accent-ink)", fontStyle: "italic" }}>不经过注册页。</span>
        </h1>
        <p style={{ maxWidth: 620, margin: "24px 0 0", color: "var(--ink-muted)", fontSize: 16 }}>
          登录后查看当前套餐、到期时间、REST 使用量、实时 WS 连接与订阅数量，并提交续费申请。
        </p>
        <div style={{ marginTop: 42, display: "flex", gap: 24, flexWrap: "wrap", color: "var(--ink-muted)", fontSize: 12 }}>
          <span>HttpOnly session</span>
          <span>Token 仅脱敏显示</span>
          <span>续费需管理员确认</span>
        </div>
      </section>

      <section className="account-login-panel">
        <form className="account-login-card" onSubmit={submit}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>账户登录</div>
          <h2 className="display-title" style={{ fontSize: 36, margin: "0 0 10px" }}>验证账户凭证</h2>
          <p style={{ color: "var(--ink-muted)", margin: "0 0 28px" }}>
            用户 ID 与注册手机号共同构成唯一登录凭证。
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label className="label">用户 ID</label>
              <input
                className="input mono"
                autoComplete="username"
                value={userId}
                onChange={event => setUserId(event.target.value)}
                placeholder="your-user-id"
                required
              />
            </div>
            <div>
              <label className="label">手机号</label>
              <input
                className="input mono"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={event => setPhone(event.target.value)}
                placeholder="注册时使用的手机号"
                required
              />
            </div>
            <button className="btn primary" disabled={loading} style={{ justifyContent: "center", padding: 12 }}>
              {loading ? "验证中…" : "进入账户管理 →"}
            </button>
            {message && <div className="account-alert error">{message}</div>}
          </div>

          <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid var(--rule)", fontSize: 12, color: "var(--ink-muted)" }}>
            还没有账号？<a href="/register" style={{ color: "var(--accent-ink)" }}>前往新用户注册</a>
          </div>
        </form>
      </section>
    </div>
  );
}

function AccountKpi({ label, value, note }) {
  return (
    <div className="card account-kpi account-span-3">
      <div className="eyebrow">{label}</div>
      <div className="account-kpi-value">{value}</div>
      <div className="account-kpi-note">{note}</div>
    </div>
  );
}

function AccountDashboard({ overview, loading, onRefresh, onRenew, onEmailSaved }) {
  const account = overview?.account || {};
  const rest = overview?.usage?.rest;
  const ws = overview?.usage?.ws;
  const renewal = overview?.renewal;
  const expired = account.days_remaining === 0;
  const [email, setEmail] = useAccountState(account.email || "");
  const [emailSaving, setEmailSaving] = useAccountState(false);
  const [emailMessage, setEmailMessage] = useAccountState("");
  const [emailMessageType, setEmailMessageType] = useAccountState("success");

  useAccountEffect(() => {
    setEmail(account.email || "");
  }, [account.email]);

  const saveEmail = async event => {
    event.preventDefault();
    setEmailMessage("");
    setEmailSaving(true);
    try {
      const data = await accountRequest("/api/account/email", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setEmail(data.email);
      setEmailMessageType("success");
      setEmailMessage(data.message);
      await onEmailSaved();
    } catch (error) {
      setEmailMessageType("error");
      setEmailMessage(error.message);
    } finally {
      setEmailSaving(false);
    }
  };

  return (
    <main className="account-main">
      <div className="account-grid">
        <section className="card account-hero account-span-12">
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Account overview</div>
            <h1 className="display-title" style={{ fontSize: 46, margin: "0 0 8px" }}>{account.user_id || "—"}</h1>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className={`tier ${account.role || ""}`}>{account.role || "unknown"}</span>
              {account.mode && <span className="pill">{account.mode}</span>}
              <span className="pill">Token {account.token_masked || "unavailable"}</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "var(--ink-muted)", fontSize: 12 }}>有效期至</div>
            <div style={{ color: expired ? "var(--danger)" : "var(--ink-strong)", fontFamily: "var(--f-mono)", marginTop: 5 }}>
              {formatAccountDate(account.expiry)}
            </div>
            <div style={{ color: expired ? "var(--danger)" : "var(--ink-muted)", fontSize: 12, marginTop: 5 }}>
              {account.days_remaining == null ? "到期时间不可用" : expired ? "已到期" : `剩余 ${account.days_remaining} 天`}
            </div>
          </div>
        </section>

        <AccountKpi
          label="REST requests"
          value={formatAccountNumber(rest?.requests)}
          note={rest ? "当前 REST 进程运行周期" : "统计服务暂不可用"}
        />
        <AccountKpi
          label="Active REST"
          value={formatAccountNumber(rest?.active_historical_requests)}
          note={rest?.limits ? `并发上限 ${rest.limits.historical_concurrent_max}` : "实时历史请求"}
        />
        <AccountKpi
          label="WS connections"
          value={formatAccountNumber(ws?.active_connections)}
          note={ws ? "当前账户在线连接" : "WS 统计服务暂不可用"}
        />
        <AccountKpi
          label="WS subscriptions"
          value={formatAccountNumber(ws?.subscriptions)}
          note="当前活跃主题订阅"
        />

        <section className="card account-renewal account-span-12">
          <div className="eyebrow" style={{ marginBottom: 8 }}>Notification email · optional</div>
          <h2 className="display-title" style={{ fontSize: 30, margin: "0 0 8px" }}>通知邮箱</h2>
          <p style={{ margin: "0 0 18px", color: "var(--ink-muted)", maxWidth: 760 }}>
            邮箱为可选项。Endpoint 变更、新 endpoint 上线及更多数据支持会通过此邮箱通知。
          </p>
          <form className="account-email-form" onSubmit={saveEmail}>
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="name@example.com"
              aria-label="通知邮箱（可选）"
            />
            <button
              className="btn primary"
              disabled={emailSaving || !email.trim() || email.trim() === (account.email || "")}
            >
              {emailSaving ? "保存中…" : account.email ? "更新邮箱" : "保存邮箱"}
            </button>
          </form>
          {emailMessage && (
            <div className={`account-alert ${emailMessageType}`} style={{ marginTop: 12 }}>
              {emailMessage}
            </div>
          )}
        </section>

        <section className="card account-renewal account-span-8">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start" }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Renewal</div>
              <h2 className="display-title" style={{ fontSize: 30, margin: "0 0 8px" }}>续费与套餐调整</h2>
              <p style={{ margin: 0, color: "var(--ink-muted)" }}>
                选择新套餐与续费月数。提交后进入管理员审核，不会立即改动 token 或到期时间。
              </p>
            </div>
            <button className="btn accent" onClick={onRenew} disabled={renewal?.status === "pending"}>
              {renewal?.status === "pending" ? "审核中" : "续费 / 更换套餐 →"}
            </button>
          </div>

          {renewal && (
            <div className="account-summary" style={{ marginTop: 20 }}>
              <div className="account-pair">
                <span className="account-pair-label">最近申请</span>
                <span className="account-pair-value">{renewal.status}</span>
              </div>
              <div className="account-pair">
                <span className="account-pair-label">套餐与时长</span>
                <span className="account-pair-value">{renewal.tier} · {renewal.months} 个月</span>
              </div>
              <div className="account-pair">
                <span className="account-pair-label">提交时间</span>
                <span className="account-pair-value">{formatAccountDate(renewal.requested_at)}</span>
              </div>
              {renewal.reject_reason && (
                <div className="account-alert error" style={{ marginTop: 12 }}>{renewal.reject_reason}</div>
              )}
            </div>
          )}
        </section>

        <aside className="card account-renewal account-span-4">
          <div className="eyebrow" style={{ marginBottom: 8 }}>Plan limits</div>
          <div className="account-pair">
            <span className="account-pair-label">Symbols / request</span>
            <span className="account-pair-value">{formatAccountNumber(rest?.limits?.max_symbols_per_request)}</span>
          </div>
          <div className="account-pair">
            <span className="account-pair-label">Date span</span>
            <span className="account-pair-value">{rest?.limits?.max_date_span_days ? `${rest.limits.max_date_span_days} days` : "—"}</span>
          </div>
          <div className="account-pair">
            <span className="account-pair-label">Max pages</span>
            <span className="account-pair-value">{formatAccountNumber(rest?.limits?.max_pages)}</span>
          </div>
          <button className="btn" onClick={onRefresh} disabled={loading} style={{ width: "100%", justifyContent: "center", marginTop: 16 }}>
            {loading ? "刷新中…" : "刷新实时用量"}
          </button>
        </aside>
      </div>
    </main>
  );
}

function AccountRenewal({ overview, onCancel, onSubmitted }) {
  const currentTier = overview?.account?.tier;
  const initialTier = ACCOUNT_PLANS.some(plan => plan.id === currentTier) ? currentTier : "standard";
  const [tier, setTier] = useAccountState(initialTier);
  const [mode, setMode] = useAccountState(overview?.account?.mode || "");
  const [months, setMonths] = useAccountState(1);
  const [loading, setLoading] = useAccountState(false);
  const [message, setMessage] = useAccountState("");
  const selectedPlan = useAccountMemo(() => ACCOUNT_PLANS.find(plan => plan.id === tier), [tier]);

  const submit = async () => {
    setMessage("");
    setLoading(true);
    try {
      const data = await accountRequest("/api/account/renew", {
        method: "POST",
        body: JSON.stringify({
          tier,
          months,
          ...(tier === "value" && { mode }),
        }),
      });
      await onSubmitted(data);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="account-main">
      <button className="btn ghost" onClick={onCancel} style={{ marginBottom: 22 }}>← 返回账户概览</button>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Renew plan</div>
      <h1 className="display-title" style={{ fontSize: 52, margin: "0 0 12px" }}>选择续费套餐</h1>
      <p style={{ color: "var(--ink-muted)", maxWidth: 680, margin: "0 0 32px" }}>
        此页面只处理老用户续费。用户 ID 与手机号不再重复提交，申请归属于当前登录 session。
      </p>

      <div className="account-plan-grid">
        {ACCOUNT_PLANS.map(plan => (
          <button
            key={plan.id}
            className={`card account-plan ${tier === plan.id ? "selected" : ""}`}
            onClick={() => {
              setTier(plan.id);
              if (plan.id !== "value") setMode("");
            }}
          >
            {plan.badge && <span className="pill" style={{ position: "absolute", right: 12, top: 12 }}>{plan.badge}</span>}
            <div className="eyebrow">{plan.name}</div>
            <div style={{ marginTop: 14 }}>
              <span className="display-title" style={{ fontSize: 34 }}>${plan.price}</span>
              <span style={{ color: "var(--ink-muted)" }}> / month</span>
            </div>
            <div style={{ color: "var(--ink-strong)", fontWeight: 500, marginTop: 14 }}>{plan.summary}</div>
            <div style={{ color: "var(--ink-muted)", fontSize: 12, marginTop: 7 }}>{plan.detail}</div>
          </button>
        ))}
      </div>

      {selectedPlan?.modes && (
        <section className="card account-renewal" style={{ marginTop: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Value 数据方向</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {selectedPlan.modes.map(option => (
              <button
                key={option.id}
                className={`btn ${mode === option.id ? "accent" : ""}`}
                onClick={() => setMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="card account-renewal" style={{ marginTop: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>续费时长</div>
        <div className="account-months">
          {ACCOUNT_MONTH_OPTIONS.map(option => (
            <button
              key={option}
              className={`btn account-month ${months === option ? "selected" : ""}`}
              onClick={() => setMonths(option)}
            >
              {option} 个月
            </button>
          ))}
        </div>
      </section>

      <section className="account-summary" style={{ marginTop: 16 }}>
        <div className="account-pair">
          <span className="account-pair-label">账户</span>
          <span className="account-pair-value">{overview?.account?.user_id}</span>
        </div>
        <div className="account-pair">
          <span className="account-pair-label">套餐</span>
          <span className="account-pair-value">{selectedPlan?.name}{mode ? ` · ${mode}` : ""}</span>
        </div>
        <div className="account-pair">
          <span className="account-pair-label">续费时长</span>
          <span className="account-pair-value">{months} 个月 · {months * 30} 天</span>
        </div>
        <div className="account-pair">
          <span className="account-pair-label">参考金额</span>
          <span className="account-pair-value">${(selectedPlan?.price || 0) * months}</span>
        </div>
        <div style={{ marginTop: 12, color: "var(--ink-muted)", fontSize: 12 }}>
          金额为套餐月价的参考合计；最终订单由管理员确认。批准后从当前有效期末尾继续延长，已到期账户则从批准时间起计算。
        </div>
      </section>

      {message && <div className="account-alert error" style={{ marginTop: 16 }}>{message}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
        <button className="btn" onClick={onCancel}>取消</button>
        <button
          className="btn primary"
          onClick={submit}
          disabled={loading || (tier === "value" && !mode)}
        >
          {loading ? "提交中…" : "提交续费申请 →"}
        </button>
      </div>
    </main>
  );
}

function AccountPage() {
  const [authenticated, setAuthenticated] = useAccountState(null);
  const [overview, setOverview] = useAccountState(null);
  const [loading, setLoading] = useAccountState(false);
  const [view, setView] = useAccountState("dashboard");
  const [notice, setNotice] = useAccountState("");

  const loadOverview = async () => {
    setLoading(true);
    try {
      const data = await accountRequest("/api/account/overview");
      setOverview(data);
      setAuthenticated(true);
      return data;
    } catch (error) {
      if (error.status === 401) {
        setAuthenticated(false);
        setOverview(null);
      } else {
        setNotice(error.message);
      }
      throw error;
    } finally {
      setLoading(false);
    }
  };

  useAccountEffect(() => {
    loadOverview().catch(() => {});
  }, []);

  const logout = async () => {
    try {
      await accountRequest("/api/account/logout", { method: "POST", body: "{}" });
    } catch (_) {}
    setAuthenticated(false);
    setOverview(null);
    setView("dashboard");
  };

  if (authenticated === null) {
    return (
      <div className="proxy-app account-shell">
        <AccountTopbar loggedIn={false} />
        <div style={{ padding: 80, textAlign: "center", color: "var(--ink-muted)" }}>正在检查账户 session…</div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="proxy-app account-shell">
        <AccountTopbar loggedIn={false} />
        <AccountLogin onLoggedIn={loadOverview} />
      </div>
    );
  }

  return (
    <div className="proxy-app account-shell">
      <AccountTopbar loggedIn={true} onLogout={logout} />
      {notice && (
        <div className="account-alert error" style={{ width: "min(1120px, calc(100% - 40px))", margin: "20px auto 0" }}>
          {notice}
        </div>
      )}
      {view === "renew" ? (
        <AccountRenewal
          overview={overview}
          onCancel={() => setView("dashboard")}
          onSubmitted={async data => {
            setNotice(data.message);
            await loadOverview();
            setView("dashboard");
          }}
        />
      ) : (
        <AccountDashboard
          overview={overview}
          loading={loading}
          onRefresh={() => loadOverview().catch(() => {})}
          onRenew={() => setView("renew")}
          onEmailSaved={() => loadOverview().catch(() => {})}
        />
      )}
    </div>
  );
}

window.AccountPage = AccountPage;
