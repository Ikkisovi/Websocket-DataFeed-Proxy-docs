// RegisterPage.jsx — Redesigned registration page matching the docs aesthetic.
// Keeps the Chinese-language UI (target audience) but restyles into the
// warm-paper + Instrument Serif + IBM Plex Mono system. Drops the dark theme.

const { useState: useRegState } = React;

function RegisterTopbar() {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="dot"></span>
        <span><strong>Public Docs Site</strong></span>
      </div>
      <div className="divider"></div>
      <div className="nav">
        <a href="index.html">Proxy API</a>
        <a href="index.html#ws-usage">WS usage</a>
        <a href="/account">账户管理</a>
      </div>
      <div className="spacer"></div>
      <div className="meta">
        <a href="/account" className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }}>已有账号 · 账户管理 →</a>
      </div>
    </div>
  );
}

// Single source of truth for tier display.
// Numbers (wsSymbols, restPerMin) must match cloud-proxy RateLimiter and docs Tiers table.
const ALL_CHANNELS = ["stocks", "options", "boats", "overnight", "crypto", "news"];

const TIERS = [
  {
    id: "trial",
    name: "Trial",
    price: "$30",
    period: "/ 3 days",
    tagline: "短期体验",
    desc: "3 天试用 · 全部 WS 通道 · 不可续期",
    channels: ALL_CHANNELS,
    wsSymbols: 50,
    restPerMin: 60,
    restParallel: 5,
    wsConns: 3,
    validity: "3 days",
    rest: "stocks + options history",
    restOnly: false,
    badge: null,
  },
  {
    id: "basic",
    name: "Basic",
    price: "$40",
    period: "/ month",
    tagline: "仅 REST · 批量下载",
    desc: "无实时 WebSocket · 仅历史数据与批量下载接口",
    channels: [],
    wsSymbols: 0,
    restPerMin: 10,
    restParallel: 2,
    wsConns: 1,
    validity: "30 days",
    rest: "stocks + options history",
    restOnly: true,
    badge: null,
  },
  {
    id: "value",
    name: "Value",
    price: "$50",
    period: "/ month",
    tagline: "REST 二选一 · 限速",
    desc: "全部 WS 通道 + REST 股票或期权二选一 · 限速 30 req/min",
    channels: ALL_CHANNELS,
    wsSymbols: 30,
    restPerMin: 30,
    restParallel: 3,
    wsConns: 2,
    validity: "30 days",
    rest: "stocks history 或 options chains",
    restOnly: false,
    badge: null,
    hasMode: true,
    modes: [
      { id: "stocks", label: "股票方向", desc: "全部 WS + REST 仅股票历史" },
      { id: "options", label: "期权方向", desc: "全部 WS + REST 仅期权历史" },
    ],
  },
  {
    id: "standard",
    name: "Standard",
    price: "$80",
    period: "/ month",
    tagline: "主流套餐",
    desc: "全部 WS 通道 · 50 symbols · stocks + options 历史",
    channels: ALL_CHANNELS,
    wsSymbols: 50,
    restPerMin: 60,
    restParallel: 5,
    wsConns: 3,
    validity: "30 days",
    rest: "stocks + options history",
    restOnly: false,
    badge: "POPULAR",
  },
  {
    id: "premium",
    name: "Premium",
    price: "$130",
    period: "/ month",
    tagline: "完整接入",
    desc: "全部 WS 通道 · 500 symbols · 全部 REST 含 crypto",
    channels: ALL_CHANNELS,
    wsSymbols: 500,
    restPerMin: 300,
    restParallel: 10,
    wsConns: "∞",
    validity: "30 days",
    rest: "全部 · 含 crypto orderbooks",
    restOnly: false,
    badge: null,
  },
];

const COMPARISON_ROWS = [
  { label: "Realtime WebSocket",       get: t => t.channels.length > 0 },
  { label: "WS channels",              get: t => t.channels.length === 0 ? "—" : `${t.channels.length} channels`, raw: true },
  { label: "REST data scope",          get: t => t.id === "premium" ? "all" : t.id === "value" ? "mode" : t.restOnly ? "stocks+options" : "stocks+options", raw: true },
  { label: "REST req/min",             get: t => `${t.restPerMin}/min`, raw: true },
  { label: "REST parallel",            get: t => `${t.restParallel}`, raw: true },
  { label: "WS symbols",               get: t => t.wsSymbols === 0 ? "—" : `${t.wsSymbols}`, raw: true },
  { label: "WS connections",           get: t => t.channels.length === 0 ? "—" : `${t.wsConns}`, raw: true },
  { label: "Token validity",           get: t => t.validity, raw: true },
];

function RegisterPage() {
  const [tier, setTier] = useRegState("standard");
  const [mode, setMode] = useRegState("");  // "stocks" or "options" for value tier

  // Registration Form State
  const [regUsername, setRegUsername] = useRegState("");
  const [regPhone, setRegPhone] = useRegState("");
  const [regEmail, setRegEmail] = useRegState("");
  const [regMsg, setRegMsg] = useRegState("");
  const [regStatus, setRegStatus] = useRegState(""); // "success", "error"
  const [regLoading, setRegLoading] = useRegState(false);

  // Status Query Form State
  const [checkUsername, setCheckUsername] = useRegState("");
  const [checkPhone, setCheckPhone] = useRegState("");
  const [checkMsg, setCheckMsg] = useRegState("");
  const [checkStatus, setCheckStatus] = useRegState(""); // "approved", "rejected", "pending", "not_found", "error"
  const [checkTokenInfo, setCheckTokenInfo] = useRegState(null); // { token, expiry, role }
  const [checkLoading, setCheckLoading] = useRegState(false);

  // Handle Registration Submit
  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!regUsername.trim() || !regPhone.trim()) {
      setRegMsg("请填写用户名和手机号。");
      setRegStatus("error");
      return;
    }
    if (tier === "value" && !mode) {
      setRegMsg("Value 套餐请先选择 REST 数据方向（股票 或 期权）。");
      setRegStatus("error");
      return;
    }
    setRegLoading(true);
    setRegMsg("");
    setRegStatus("");

    try {
      const resp = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: regUsername.trim(),
          phone: regPhone.trim(),
          tier,
          ...(regEmail.trim() && { email: regEmail.trim() }),
          ...(tier === "value" && mode && { mode })
        })
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        setRegMsg(data.message || "注册提交成功，等待审核。");
        setRegStatus("success");
        setRegUsername("");
        setRegPhone("");
        setRegEmail("");
      } else {
        setRegMsg(data.message || "注册失败，请检查输入。");
        setRegStatus("error");
      }
    } catch (err) {
      setRegMsg("网络错误，请稍后再试。");
      setRegStatus("error");
    } finally {
      setRegLoading(false);
    }
  };

  // Handle Check Status
  const handleCheckStatus = async (e) => {
    e.preventDefault();
    if (!checkUsername.trim() || !checkPhone.trim()) {
      setCheckMsg("请填写用户名和手机号。");
      setCheckStatus("error");
      return;
    }
    setCheckLoading(true);
    setCheckMsg("");
    setCheckStatus("");
    setCheckTokenInfo(null);

    try {
      const resp = await fetch('/api/check-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: checkUsername.trim(),
          phone: checkPhone.trim()
        })
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        setCheckMsg(data.message);
        setCheckStatus(data.status);
        if (data.status === 'approved' && data.token) {
          setCheckTokenInfo({ token: data.token, expiry: data.expiry, role: data.role });
        }
      } else {
        setCheckMsg(data.message || "查询失败。");
        setCheckStatus("error");
      }
    } catch (err) {
      setCheckMsg("网络错误，请稍后再试。");
      setCheckStatus("error");
    } finally {
      setCheckLoading(false);
    }
  };

  return (
    <div className="proxy-app" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <RegisterTopbar />

      <div style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        background: "var(--bg-canvas)",
        padding: "48px 64px 64px",
      }}>
        {/* Hero */}
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>注册 · 待审核</div>
          <h1 className="display-title" style={{ fontSize: 52, margin: "0 0 12px", lineHeight: 1.02 }}>
            新用户 <span style={{ fontStyle: "italic", color: "var(--accent-ink)" }}>注册</span>
          </h1>
          <p style={{ color: "var(--ink-muted)", margin: "0 0 36px", fontSize: 15, maxWidth: 560 }}>
            选择套餐并填写信息，管理员确认订单后可自助生成 Token。
            注册不会立即开通 — 通常 1 个工作日内完成审核。
          </p>

          {/* Layout: form + status side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 32, alignItems: "start" }}>
            {/* Left: tiers + form */}
            <div>
              {/* Tier cards */}
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
                <div className="eyebrow">1 · 选择服务等级</div>
                <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-soft)" }}>
                  5 plans · USD · subscription
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 28 }}>
                {TIERS.map(t => {
                  const selected = tier === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => { setTier(t.id); if (t.id !== "value") setMode(""); }}
                      className="card"
                      style={{
                        textAlign: "left",
                        padding: 16,
                        cursor: "pointer",
                        borderColor: selected ? "var(--ink-strong)" : "var(--rule)",
                        background: selected ? "var(--bg-paper)" : "var(--bg-canvas)",
                        borderWidth: 1,
                        borderStyle: "solid",
                        borderRadius: "var(--radius-lg)",
                        position: "relative",
                        transition: "all .15s",
                        fontFamily: "inherit",
                        boxShadow: selected ? "0 1px 0 var(--ink-strong)" : "none",
                      }}
                    >
                      {t.badge && (
                        <span style={{
                          position: "absolute", top: -8, right: 12,
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: "var(--ink-strong)",
                          color: "var(--ink-inverse)",
                          fontFamily: "var(--f-mono)",
                          fontSize: 9.5,
                          letterSpacing: ".1em",
                        }}>{t.badge}</span>
                      )}
                      {selected && (
                        <span style={{
                          position: "absolute", top: 12, right: 12,
                          width: 16, height: 16, borderRadius: "50%",
                          background: "var(--ink-strong)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#fff", fontSize: 9,
                        }}>✓</span>
                      )}

                      <div style={{ marginBottom: 8 }}>
                        <span className={`tier ${t.id}`} style={{ marginBottom: 6 }}>{t.name}</span>
                      </div>

                      <div style={{ display: "flex", alignItems: "baseline", gap: 2, marginBottom: 4 }}>
                        <span className="display-title" style={{ fontSize: 28 }}>{t.price}</span>
                      </div>
                      <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--ink-muted)", marginBottom: 10 }}>
                        {t.period}
                      </div>

                      <div style={{ fontSize: 11, color: "var(--ink-strong)", fontWeight: 500, marginBottom: 4 }}>{t.tagline}</div>
                      <p style={{ color: "var(--ink-muted)", fontSize: 11.5, margin: "0 0 12px", lineHeight: 1.5, minHeight: 50 }}>{t.desc}</p>

                      {/* Symbols line */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, fontSize: 11 }}>
                        <span style={{ color: "var(--ink-muted)" }}>symbols</span>
                        <span style={{
                          fontFamily: "var(--f-mono)",
                          color: "var(--ink-strong)",
                          fontSize: 11,
                        }}>{t.restOnly ? "unlimited (REST)" : `${t.wsSymbols} symbols`}</span>
                      </div>

                      {/* Channels */}
                      <div style={{ fontSize: 10, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>
                        WS
                      </div>
                      {t.restOnly ? (
                        <div style={{
                          fontFamily: "var(--f-mono)",
                          fontSize: 10.5,
                          color: "var(--ink-soft)",
                          padding: "2px 6px",
                          background: "var(--bg-sunken)",
                          borderRadius: 3,
                          display: "inline-block",
                          marginBottom: 10,
                        }}>— REST only</div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 10 }}>
                          {t.channels.map(c => (
                            <code key={c} style={{
                              fontFamily: "var(--f-mono)",
                              fontSize: 9.5,
                              padding: "1px 5px",
                              borderRadius: 3,
                              background: selected ? "var(--accent-soft)" : "var(--bg-sunken)",
                              color: selected ? "var(--accent-ink)" : "var(--ink-muted)",
                            }}>{c}</code>
                          ))}
                        </div>
                      )}

                      {/* REST line */}
                      <div style={{ fontSize: 10, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>
                        REST
                      </div>
                      <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--ink-base)", lineHeight: 1.5 }}>
                        {t.rest}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Value mode selector — shown only when value tier is selected */}
              {tier === "value" && (() => {
                const vt = TIERS.find(t => t.id === "value");
                return (
                  <div className="card" style={{ padding: 16, marginBottom: 20, borderColor: !mode ? "oklch(0.65 0.18 25)" : "var(--rule)", transition: "border-color .2s" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <div className="eyebrow" style={{ margin: 0 }}>选择 REST 数据方向</div>
                      <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--ink-soft)" }}>pick one · WS 不受限</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {vt.modes.map(m => {
                        const active = mode === m.id;
                        return (
                          <button
                            key={m.id}
                            onClick={() => setMode(m.id)}
                            style={{
                              padding: "12px 14px",
                              border: `1.5px solid ${active ? "var(--ink-strong)" : "var(--rule)"}`,
                              borderRadius: "var(--radius-lg)",
                              background: active ? "var(--bg-paper)" : "var(--bg-canvas)",
                              cursor: "pointer",
                              textAlign: "left",
                              fontFamily: "inherit",
                              boxShadow: active ? "0 1px 0 var(--ink-strong)" : "none",
                              transition: "all .15s",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                              <span style={{
                                width: 14, height: 14, borderRadius: "50%",
                                border: `1.5px solid ${active ? "var(--ink-strong)" : "var(--ink-soft)"}`,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                background: active ? "var(--ink-strong)" : "transparent",
                                color: "#fff", fontSize: 8, flexShrink: 0,
                              }}>{active ? "✓" : ""}</span>
                              <span style={{ fontWeight: 600, fontSize: 13, color: "var(--ink-strong)" }}>{m.label}</span>
                            </div>
                            <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--ink-muted)", lineHeight: 1.5, paddingLeft: 20 }}>
                              {m.desc}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Feature comparison strip — data-driven from TIERS */}
              <div className="card" style={{ padding: 0, marginBottom: 28, overflow: "hidden" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 200 }}>Feature</th>
                      {TIERS.map(t => <th key={t.id} style={{ textAlign: "center" }}>{t.name}</th>)}
                    </tr>
                  </thead>
                  <tbody style={{ fontFamily: "var(--f-mono)", fontSize: 11.5 }}>
                    {COMPARISON_ROWS.map(row => (
                      <tr key={row.label}>
                        <td style={{ fontFamily: "var(--f-sans)", color: "var(--ink-strong)" }}>{row.label}</td>
                        {TIERS.map(t => {
                          const v = row.get(t);
                          if (row.raw) {
                            return <td key={t.id} style={{ textAlign: "center", color: v === "—" ? "var(--ink-soft)" : "var(--ink-base)" }}>{v}</td>;
                          }
                          return v
                            ? <td key={t.id} style={{ textAlign: "center", color: "var(--ok)" }}>✓</td>
                            : <td key={t.id} style={{ textAlign: "center", color: "var(--ink-soft)" }}>—</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Form fields */}
              <div className="eyebrow" style={{ marginBottom: 10 }}>2 · 账户信息</div>
              <div className="card" style={{ padding: 24 }}>
                <form onSubmit={handleRegisterSubmit}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                    <div>
                      <label className="label">用户名</label>
                      <input 
                        className="input mono" 
                        placeholder="英文字母，用于后续登录" 
                        value={regUsername}
                        onChange={(e) => setRegUsername(e.target.value)}
                        required
                      />
                      <div className="hint">注册成功后无法修改。</div>
                    </div>
                    <div>
                      <label className="label">手机号</label>
                      <input 
                        className="input mono" 
                        placeholder="下单时使用的手机号" 
                        value={regPhone}
                        onChange={(e) => setRegPhone(e.target.value)}
                        required
                      />
                      <div className="hint">用于匹配卖家订单记录。</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 18 }}>
                    <label className="label">邮箱（可选）</label>
                    <input
                      className="input mono"
                      type="email"
                      placeholder="用于接收服务更新通知"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                    />
                    <div className="hint">仅用于接收数据服务变更与故障通知，不会用于其他用途。</div>
                  </div>

                  <div style={{
                    marginTop: 22,
                    padding: 12,
                    border: "1px dashed var(--rule-strong)",
                    borderRadius: "var(--radius-md)",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 12.5,
                    color: "var(--ink-muted)",
                    background: "var(--bg-canvas)",
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warn)", flex: "0 0 auto" }}></span>
                    <span>
                      您选择的套餐：
                      <strong style={{ color: "var(--ink-strong)", margin: "0 4px" }}>
                        {TIERS.find(t => t.id === tier).name} {TIERS.find(t => t.id === tier).price}{TIERS.find(t => t.id === tier).period}
                      </strong>
                      · 提交后会进入待审核队列
                    </span>
                  </div>

                  <button 
                    type="submit" 
                    disabled={regLoading}
                    className="btn primary" 
                    style={{ width: "100%", justifyContent: "center", marginTop: 18, padding: "12px", opacity: regLoading ? 0.7 : 1 }}
                  >
                    {regLoading ? "提交中..." : "提交注册 →"}
                  </button>
                </form>

                {regMsg && (
                  <div style={{
                    marginTop: 14,
                    padding: 12,
                    borderRadius: "var(--radius-md)",
                    background: regStatus === "success" ? "var(--ok-soft)" : "var(--danger-soft)",
                    border: regStatus === "success" ? "1px solid var(--ok)" : "1px solid var(--danger)",
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    color: regStatus === "success" ? "var(--ok)" : "var(--danger)",
                  }}>
                    <span style={{ 
                      width: 6, 
                      height: 6, 
                      borderRadius: "50%", 
                      background: regStatus === "success" ? "var(--ok)" : "var(--danger)", 
                      marginTop: 6, 
                      flex: "0 0 auto" 
                    }}></span>
                    <div style={{ fontSize: 13 }}>{regMsg}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: status-check card */}
            <aside>
              <div className="card" style={{ padding: 20, position: "sticky", top: 24 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>查询进度</div>
                <h3 className="display-title" style={{ fontSize: 22, margin: "0 0 6px" }}>已注册？</h3>
                <p style={{ color: "var(--ink-muted)", fontSize: 12.5, margin: "0 0 16px" }}>
                  使用注册时的用户名和手机号查询审核状态。
                </p>

                <form onSubmit={handleCheckStatus}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <input 
                      className="input mono" 
                      placeholder="用户名" 
                      value={checkUsername}
                      onChange={(e) => setCheckUsername(e.target.value)}
                      required
                    />
                    <input 
                      className="input mono" 
                      placeholder="手机号" 
                      value={checkPhone}
                      onChange={(e) => setCheckPhone(e.target.value)}
                      required
                    />
                    <button 
                      type="submit" 
                      disabled={checkLoading}
                      className="btn" 
                      style={{ width: "100%", justifyContent: "center", opacity: checkLoading ? 0.7 : 1 }}
                    >
                      {checkLoading ? "查询中..." : "查询状态"}
                    </button>
                  </div>
                </form>

                {checkMsg && (
                  <div style={{
                    marginTop: 14,
                    padding: 12,
                    borderRadius: "var(--radius-md)",
                    background: checkStatus === "approved" ? "var(--ok-soft)" : 
                                checkStatus === "pending" ? "var(--warn-soft)" : "var(--danger-soft)",
                    border: checkStatus === "approved" ? "1px solid var(--ok)" : 
                            checkStatus === "pending" ? "1px solid var(--warn)" : "1px solid var(--danger)",
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                  }}>
                    <span style={{ 
                      width: 6, 
                      height: 6, 
                      borderRadius: "50%", 
                      background: checkStatus === "approved" ? "var(--ok)" : 
                                  checkStatus === "pending" ? "var(--warn)" : "var(--danger)", 
                      marginTop: 6, 
                      flex: "0 0 auto" 
                    }}></span>
                    <div>
                      <div style={{ 
                        fontSize: 13, 
                        fontWeight: 500, 
                        color: "var(--ink-strong)", 
                        marginBottom: 2 
                      }}>
                        {checkStatus === "approved" ? "审核已通过" : 
                         checkStatus === "pending" ? "审核中" : 
                         checkStatus === "rejected" ? "审核未通过" : 
                         checkStatus === "not_found" ? "未找到记录" : "查询出错"}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                        {checkMsg}
                      </div>
                      {checkTokenInfo && (
                        <div style={{ marginTop: 8, padding: "8px 10px", background: "var(--bg-sunken)", borderRadius: 6, fontFamily: "var(--f-mono)", fontSize: 11.5 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ color: "var(--ink-muted)" }}>Token</span>
                            <span style={{ color: "var(--ink-strong)", letterSpacing: "0.03em" }}>{checkTokenInfo.token}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ color: "var(--ink-muted)" }}>Expires</span>
                            <span style={{ color: "var(--ink-strong)" }}>{checkTokenInfo.expiry ? new Date(checkTokenInfo.expiry).toLocaleDateString("zh-CN") : "—"}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--ink-muted)" }}>Role</span>
                            <span style={{ color: "var(--ink-strong)" }}>{checkTokenInfo.role || "—"}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <hr style={{ border: 0, borderTop: "1px solid var(--rule)", margin: "20px 0 14px" }} />
                <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                  <strong style={{ color: "var(--ink-strong)" }}>状态说明 · </strong>
                  <span style={{ fontFamily: "var(--f-mono)" }}>pending → approved → rejected</span>
                </div>
              </div>

              {/* Tiny help block */}
              <div style={{ marginTop: 16, padding: "0 4px", fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.6 }}>
                问题反馈：
                <a style={{ color: "var(--accent-ink)" }}> support@alpaca-proxy.io</a>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

window.RegisterPage = RegisterPage;
