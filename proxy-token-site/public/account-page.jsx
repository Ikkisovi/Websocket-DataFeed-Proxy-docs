const { useEffect: useAccountEffect, useState: useAccountState } = React;

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
  const [email, setEmail] = useAccountState("");
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
          email: email.trim(),
        }),
      });
      setPhone("");
      setEmail("");
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
          登录后查看当前套餐、到期时间、REST 使用量、实时 WS 连接与订阅数量，并直接在线续费。
        </p>
        <div style={{ marginTop: 42, display: "flex", gap: 24, flexWrap: "wrap", color: "var(--ink-muted)", fontSize: 12 }}>
          <span>HttpOnly session</span>
          <span>Token 仅脱敏显示</span>
          <span>支付成功自动续期</span>
        </div>
      </section>

      <section className="account-login-panel">
        <form className="account-login-card" onSubmit={submit}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>账户登录</div>
          <h2 className="display-title" style={{ fontSize: 36, margin: "0 0 10px" }}>验证账户凭证</h2>
          <p style={{ color: "var(--ink-muted)", margin: "0 0 28px" }}>
            注册时的用户名、手机号和邮箱共同构成唯一登录凭证。
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label className="label">用户名</label>
              <input
                className="input mono"
                autoComplete="username"
                value={userId}
                onChange={event => setUserId(event.target.value)}
                placeholder="注册时使用的用户名"
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
            <div>
              <label className="label">注册邮箱</label>
              <input
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="name@example.com"
                required
              />
              <div style={{ marginTop: 7, color: "var(--ink-muted)", fontSize: 11, lineHeight: 1.5 }}>
                邮箱是账户身份的一部分，不能在线修改。
              </div>
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

function AccountDashboard({ overview, loading, onRefresh, onRenew }) {
  const account = overview?.account || {};
  const rest = overview?.usage?.rest;
  const ws = overview?.usage?.ws;
  const renewal = overview?.renewal;
  const expired = account.days_remaining === 0;
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

        <section className="card account-renewal account-span-8">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start" }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Upgrade & renewal</div>
              <h2 className="display-title" style={{ fontSize: 30, margin: "0 0 8px" }}>选择升级套餐</h2>
              <p style={{ margin: 0, color: "var(--ink-muted)" }}>
                在这里进入安全结账页选择 Value、Standard 或 Premium、时长和支付方式。支付成功后保留原 Token 并自动延长有效期。
              </p>
            </div>
            <button className="btn accent" onClick={onRenew}>
              选择升级套餐 →
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

function AccountPage() {
  const [authenticated, setAuthenticated] = useAccountState(null);
  const [overview, setOverview] = useAccountState(null);
  const [loading, setLoading] = useAccountState(false);
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
      <AccountDashboard
        overview={overview}
        loading={loading}
        onRefresh={() => loadOverview().catch(() => {})}
        onRenew={() => window.location.assign("/checkout")}
      />
    </div>
  );
}

window.AccountPage = AccountPage;
