import React, { useEffect as useAccountEffect, useState as useAccountState } from "react";

function ComplianceFooter() {
  return (
    <footer style={{
      width: "min(1120px, calc(100% - 40px))",
      margin: "32px auto 0",
      padding: "20px 0 32px",
      borderTop: "1px solid var(--rule)",
      color: "var(--ink-muted)",
      fontSize: 12,
      lineHeight: 1.6,
    }}>
      <div style={{ color: "var(--ink-strong)", fontWeight: 600 }}>Leandata Technologies Ltd.</div>
      <div>700 W Georgia St, Vancouver, BC V7Y 1B6, Canada</div>
      <a href="https://leandata.uk" style={{ color: "var(--accent-ink)", textDecoration: "none" }}>
        https://leandata.uk
      </a>
    </footer>
  );
}

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
        <a href="/research-data">研究数据与报告</a>
        <a href="/reports/factor-stats/">因子字典</a>
      </div>
      <div className="spacer"></div>
      <div className="meta">
        <LanguageToggle />
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
  const [loginMode, setLoginMode] = useAccountState("email");
  const [email, setEmail] = useAccountState("");
  const [username, setUsername] = useAccountState("");
  const [phone, setPhone] = useAccountState("");
  const [code, setCode] = useAccountState("");
  const [token, setToken] = useAccountState("");
  const [challengeId, setChallengeId] = useAccountState("");
  const [countdown, setCountdown] = useAccountState(0);
  const [sendingCode, setSendingCode] = useAccountState(false);
  const [loading, setLoading] = useAccountState(false);
  const [message, setMessage] = useAccountState("");

  useAccountEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const sendLoginCode = async () => {
    setMessage("");
    if (loginMode === "email" ? !email.trim() : !phone.trim()) {
      setMessage("请先输入邮箱或手机号。");
      return;
    }
    setSendingCode(true);
    try {
      const data = await accountRequest("/api/account/login-code", {
        method: "POST",
        body: JSON.stringify({
          credential: {
            email: email.trim(),
            ...(loginMode === "email" && username.trim() ? { username: username.trim() } : {}),
            ...(loginMode === "phone" ? { phone: phone.trim() } : {}),
          },
        }),
      });
      setChallengeId(data.challenge_id || "");
      setCountdown(60);
      setMessage(data.message || "验证码已发送至绑定邮箱。");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSendingCode(false);
    }
  };

  const submit = async event => {
    event.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      if (loginMode === "token") {
        if (!username.trim() || !phone.trim() || !token.trim()) throw new Error("请输入账号名、手机号和 Token。");
        await accountRequest("/api/account/login", {
          method: "POST",
          body: JSON.stringify({ credential: { user_id: username.trim(), phone: phone.trim(), token: token.trim() } }),
        });
        setPhone(""); setToken("");
        await onLoggedIn();
        return;
      }
      const credential = {
        email: email.trim(),
        ...(loginMode === "email" && username.trim() ? { username: username.trim() } : {}),
        ...(loginMode === "phone" ? { phone: phone.trim() } : {}),
      };
      if (!challengeId) throw new Error("请先点击获取验证码。");
      if (!code.trim()) throw new Error("请输入 6 位邮箱验证码。");
      credential.challenge_id = challengeId;
      credential.code = code.trim();

      await accountRequest("/api/account/login", {
        method: "POST",
        body: JSON.stringify({ credential }),
      });
      setPhone("");
      setCode("");
      setChallengeId("");
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
          <span>邮箱验证码登录</span>
          <span>Token 默认隐藏，可按需显示</span>
          <span>支付成功自动续期</span>
        </div>
      </section>

      <section className="account-login-panel">
        <form className="account-login-card" onSubmit={submit}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>账户登录</div>
          <h2 className="display-title" style={{ fontSize: 36, margin: "0 0 10px" }}>登录你的账户</h2>
          <p style={{ color: "var(--ink-muted)", margin: "0 0 24px" }}>
            使用邮箱验证码验证身份。
          </p>

          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {loginMode !== "token" && [["email", "邮箱验证码登录"], ["phone", "手机号登录"]].map(([mode, label]) => (
              <button key={mode} type="button" className={`btn ${loginMode === mode ? "primary" : "ghost"}`}
                aria-pressed={loginMode === mode} onClick={() => { setLoginMode(mode); setCode(""); setChallengeId(""); setMessage(""); setToken(""); }}
                style={{ flex: 1, justifyContent: "center", padding: "8px 12px", fontSize: 13 }}>{label}</button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {loginMode !== "token" && <div>
              <label className="label">{loginMode === "email" ? "邮箱" : "账户已绑定的邮箱"}</label>
              <input
                className="input mono"
                type="email"
                autoComplete="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="邮箱地址"
                required
              />
            </div>}
            {loginMode === "email" && (
              <details>
                <summary style={{ color: "var(--ink-muted)", cursor: "pointer", fontSize: 13 }}>同一邮箱有多个账号？</summary>
                <label className="label" style={{ marginTop: 12 }}>账号名（可选）</label>
                <input className="input mono" autoComplete="username" value={username}
                  onChange={event => { setUsername(event.target.value); setCode(""); setChallengeId(""); }}
                  placeholder="填写要登录的账号名" maxLength={128} />
              </details>
            )}
            {loginMode === "token" && (
              <>
                <p style={{ margin: 0, color: "var(--ink-muted)", fontSize: 13 }}>
                  注册时没有填写邮箱的账户，请用注册时获得的 Token 验证身份，登录后即可绑定邮箱。
                </p>
                <div>
                  <label className="label">账号名</label>
                  <input className="input mono" autoComplete="username" value={username}
                    onChange={event => setUsername(event.target.value)} placeholder="注册时的账号名" maxLength={128} required />
                </div>
                <div>
                  <label className="label">Token</label>
                  <input className="input mono" type="password" autoComplete="current-password" value={token}
                    onChange={event => setToken(event.target.value)} placeholder="账户 Token" required />
                </div>
              </>
            )}
            {(loginMode === "phone" || loginMode === "token") && (
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
            )}

              {loginMode !== "token" && <div>
                <label className="label">邮箱验证码</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="input mono"
                    value={code}
                    onChange={event => setCode(event.target.value)}
                    placeholder="6 位数字验证码"
                    maxLength={6}
                    required
                  />
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={sendingCode || countdown > 0}
                    onClick={sendLoginCode}
                    style={{ whiteSpace: "nowrap", padding: "8px 14px", fontSize: 13 }}
                  >
                    {countdown > 0 ? `${countdown}s 后重试` : sendingCode ? "发送中…" : "获取验证码"}
                  </button>
                </div>
              </div>}

            <button className="btn primary" disabled={loading} style={{ justifyContent: "center", padding: 12 }}>
              {loading ? "验证中…" : "进入账户管理 →"}
            </button>
            {message && <div className="account-alert error">{message}</div>}
            {loginMode === "token" ? (
              <button type="button" className="btn ghost" style={{ justifyContent: "center" }}
                onClick={() => { setLoginMode("email"); setToken(""); setMessage(""); }}>返回邮箱验证码登录</button>
            ) : (
              <details>
                <summary style={{ color: "var(--ink-muted)", cursor: "pointer", fontSize: 13 }}>尚未绑定邮箱？</summary>
                <p style={{ color: "var(--ink-muted)", fontSize: 13, margin: "10px 0" }}>注册时没有填写邮箱的账户，可先用 Token 验证身份，再在账户页绑定邮箱。</p>
                <button type="button" className="btn ghost" style={{ fontSize: 13 }}
                  onClick={() => { setLoginMode("token"); setCode(""); setChallengeId(""); setMessage(""); }}>使用 Token 验证身份</button>
              </details>
            )}
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

function BindEmailCard({ onBound }) {
  const [email, setEmail] = useAccountState("");
  const [code, setCode] = useAccountState("");
  const [challengeId, setChallengeId] = useAccountState("");
  const [busy, setBusy] = useAccountState(false);
  const [message, setMessage] = useAccountState("");
  const send = async () => {
    setMessage(""); setBusy(true);
    try {
      const data = await accountRequest("/api/account/email/code", { method: "POST", body: JSON.stringify({ email: email.trim() }) });
      setChallengeId(data.challenge_id || "");
      setMessage("验证码已发送，请查收邮件。");
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };
  const bind = async event => {
    event.preventDefault();
    setMessage(""); setBusy(true);
    try {
      await accountRequest("/api/account/email/bind", { method: "POST", body: JSON.stringify({ challenge_id: challengeId, code: code.trim() }) });
      await onBound();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };
  return (
    <section className="card account-span-12" data-bind-email="true" style={{ padding: 24 }}>
      <div className="eyebrow">绑定邮箱</div>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, margin: "8px 0 16px" }}>
        你的账户注册时没有邮箱。绑定后可用邮箱验证码登录，不再需要输入 Token；绑定后不能在线修改。
      </p>
      <form onSubmit={bind} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input mono" type="email" autoComplete="email" value={email} placeholder="邮箱地址"
          onChange={event => { setEmail(event.target.value); setChallengeId(""); }} style={{ flex: "1 1 220px" }} required />
        <button type="button" className="btn ghost" disabled={busy || !email.trim()} onClick={send}>获取验证码</button>
        <input className="input mono" value={code} onChange={event => setCode(event.target.value)} placeholder="6 位验证码"
          maxLength={6} style={{ flex: "0 1 140px" }} required />
        <button className="btn primary" disabled={busy || !challengeId || !code.trim()}>绑定</button>
      </form>
      {message && <div style={{ marginTop: 10, color: "var(--ink-muted)", fontSize: 13 }}>{message}</div>}
    </section>
  );
}

function AccountDashboard({ overview, loading, onRefresh, onRenew }) {
  const account = overview?.account || {};
  const rest = overview?.usage?.rest;
  const ws = overview?.usage?.ws;
  const renewal = overview?.renewal;
  const [tokenVisible, setTokenVisible] = useAccountState(false);
  const [tokenValue, setTokenValue] = useAccountState("");
  const [tokenLoading, setTokenLoading] = useAccountState(false);
  const [tokenMessage, setTokenMessage] = useAccountState("");
  const hasIndependentExpiry = Object.hasOwn(account, "market_expiry") || Object.hasOwn(account, "china_expiry");
  const capabilities = account.capabilities;
  const expired = account.days_remaining === 0;
  const isPermanentFree = (account.tier === 'free' || account.role === 'free') && account.expiry == null;

  const toggleToken = async () => {
    setTokenMessage("");
    if (tokenVisible) {
      setTokenVisible(false);
      setTokenValue("");
      return;
    }
    setTokenLoading(true);
    try {
      const data = await accountRequest("/api/account/token");
      setTokenValue(data.token || "");
      setTokenVisible(true);
    } catch (error) {
      setTokenMessage(error.message);
    } finally {
      setTokenLoading(false);
    }
  };

  const copyToken = async () => {
    if (!tokenValue) return;
    try {
      await navigator.clipboard.writeText(tokenValue);
      setTokenMessage("Token 已复制到剪贴板。");
    } catch (_) {
      setTokenMessage("浏览器不允许自动复制，请手动复制 Token。");
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
              <span className="pill">Token {tokenVisible ? tokenValue : (account.token_masked || "unavailable")}</span>
              <button className="btn ghost" onClick={toggleToken} disabled={tokenLoading} style={{ padding: "6px 10px", fontSize: 12 }}>
                {tokenLoading ? "读取中…" : tokenVisible ? "隐藏 Token" : "显示 Token"}
              </button>
              {tokenVisible && (
                <button className="btn ghost" onClick={copyToken} style={{ padding: "6px 10px", fontSize: 12 }}>
                  复制 Token
                </button>
              )}
            </div>
            {tokenMessage && <div style={{ marginTop: 8, color: "var(--ink-muted)", fontSize: 12 }}>{tokenMessage}</div>}
          </div>
          {hasIndependentExpiry ? (
            <div className="account-summary" data-subscription-expiries="true">
              <div className="account-pair"><span className="account-pair-label">US market expiry</span><span className="account-pair-value" data-expiry="market">{account.market_expiry ? formatAccountDate(account.market_expiry) : "Permanent Free baseline"}</span></div>
              <div className="account-pair"><span className="account-pair-label">China expiry</span><span className="account-pair-value" data-expiry="china">{account.china_expiry ? formatAccountDate(account.china_expiry) : "Not active"}</span></div>
              <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>Independent subscription expiry · permanent Free baseline retained</div>
            </div>
          ) : (
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "var(--ink-muted)", fontSize: 12 }}>有效期至</div>
            <div style={{ color: expired ? "var(--danger)" : "var(--ink-strong)", fontFamily: "var(--f-mono)", marginTop: 5 }}>
              {formatAccountDate(account.expiry)}
            </div>
            <div style={{ color: expired ? "var(--danger)" : "var(--ink-muted)", fontSize: 12, marginTop: 5 }}>
              {isPermanentFree ? "长期有效" : account.days_remaining == null ? "到期时间不可用" : expired ? "已到期" : `剩余 ${account.days_remaining} 天`}
            </div>
          </div>
          )}
        </section>

        {!account.email && <BindEmailCard onBound={onRefresh} />}

        {capabilities && <section className="card account-span-12" data-effective-capabilities="true" style={{ padding: 24 }}>
          <div className="eyebrow">Effective capabilities</div>
          {["ws", "rest"].map(group => <div key={group} style={{ marginTop: 12 }}>
            <strong>{group.toUpperCase()}</strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {Object.entries(capabilities[group] || {}).filter(([name]) => name !== "test" && name !== "admin_token_lookup").map(([name, allowed]) => (
                <span className="pill" key={name} data-capability={`${group}.${name}`} data-enabled={String(allowed === true)}>{allowed === true ? "✓" : "—"} {name.replaceAll("_", " ")}</span>
              ))}
            </div>
          </div>)}
          {account.catalog_version && <div style={{ marginTop: 12, fontSize: 12, color: "var(--ink-muted)" }}>Catalog {account.catalog_version}</div>}
        </section>}

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
                在这里进入安全结账页选择套餐、时长和支付方式。China 可叠加到美股套餐，分别到期；支付后保留原 Token。
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
          <div className="eyebrow" style={{ marginBottom: 8 }}>Runtime limits</div>
          <div className="account-pair">
            <span className="account-pair-label">Historical REST concurrency</span>
            <span className="account-pair-value">{formatAccountNumber(rest?.limits?.historical_concurrent_max)}</span>
          </div>
          <div className="account-pair">
            <span className="account-pair-label">Request-size policy</span>
            <span className="account-pair-value">{rest?.limits?.request_size_policy === "no_plan_specific_budget" ? "No plan cap" : "—"}</span>
          </div>
          <div className="account-pair">
            <span className="account-pair-label">Rate policy</span>
            <span className="account-pair-value">{rest?.limits?.rate_policy === "shared_proxy_and_provider_limits" ? "Proxy + provider" : "—"}</span>
          </div>
          {ws?.limits && Object.entries(ws.limits).map(([name, value]) => <div className="account-pair" key={name}><span className="account-pair-label">WS {name.replaceAll("_", " ")}</span><span className="account-pair-value">{typeof value === "object" ? "See usage details" : String(value ?? "—")}</span></div>)}
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
      const next = new URLSearchParams(window.location.search).get("next") || "";
      // Named targets, or a same-site path under /reports/ (no scheme, host or protocol-relative form).
      const nextPage = { "research-data": "/research-data", reports: "/reports/" }[next]
        || (/^\/reports\/[\w\-./#]*$/.test(next) && !next.includes("//") && !next.includes("..") ? next : undefined);
      if (nextPage) window.location.replace(nextPage);
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
      <ComplianceFooter />
    </div>
  );
}

window.AccountPage = AccountPage;
export { AccountPage };
