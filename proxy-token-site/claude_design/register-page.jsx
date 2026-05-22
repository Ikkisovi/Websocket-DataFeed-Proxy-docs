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
        <a>Proxy API</a>
        <a>WS usage</a>
      </div>
      <div className="spacer"></div>
      <div className="meta">
        <a className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }}>已有账号 · 生成 Token →</a>
      </div>
    </div>
  );
}

const TIERS = [
  {
    id: "premium",
    name: "Premium",
    price: "¥100",
    period: "/月",
    desc: "全部实时流 · 500 symbols · 全部历史数据 · 无限 REST",
    channels: ["stocks", "options", "crypto", "news", "overnight"],
    rest: "history · snapshots · orderbooks",
  },
  {
    id: "standard",
    name: "Standard",
    price: "¥50",
    period: "/月",
    desc: "股票/期权/crypto/新闻 · 100 symbols · 历史数据",
    channels: ["stocks", "options", "crypto", "news"],
    rest: "history · contracts · snapshots",
  },
  {
    id: "basic",
    name: "Basic",
    price: "¥20",
    period: "/月",
    desc: "股票/新闻实时流 · 10 symbols",
    channels: ["stocks", "news"],
    rest: "stocks_history · news_history",
  },
];

function RegisterPage() {
  const [tier, setTier] = useRegState("premium");
  const [showStatus, setShowStatus] = useRegState(false);

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
              <div className="eyebrow" style={{ marginBottom: 10 }}>1 · 选择服务等级</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 28 }}>
                {TIERS.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTier(t.id)}
                    className="card"
                    style={{
                      textAlign: "left",
                      padding: 18,
                      cursor: "pointer",
                      borderColor: tier === t.id ? "var(--ink-strong)" : "var(--rule)",
                      background: tier === t.id ? "var(--bg-paper)" : "var(--bg-canvas)",
                      borderWidth: 1,
                      borderStyle: "solid",
                      borderRadius: "var(--radius-lg)",
                      position: "relative",
                      transition: "all .15s",
                      fontFamily: "inherit",
                    }}
                  >
                    {tier === t.id && (
                      <span style={{
                        position: "absolute", top: 12, right: 12,
                        width: 18, height: 18, borderRadius: "50%",
                        background: "var(--ink-strong)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", fontSize: 10,
                      }}>✓</span>
                    )}
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
                      <span className={`tier ${t.id}`}>{t.name}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 2, marginBottom: 10 }}>
                      <span className="display-title" style={{ fontSize: 32 }}>{t.price}</span>
                      <span style={{ color: "var(--ink-muted)", fontSize: 13 }}>{t.period}</span>
                    </div>
                    <p style={{ color: "var(--ink-muted)", fontSize: 12, margin: "0 0 12px", lineHeight: 1.5 }}>{t.desc}</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {t.channels.map(c => (
                        <code key={c} style={{
                          fontFamily: "var(--f-mono)",
                          fontSize: 10.5,
                          padding: "1px 6px",
                          borderRadius: 3,
                          background: tier === t.id ? "var(--accent-soft)" : "var(--bg-sunken)",
                          color: tier === t.id ? "var(--accent-ink)" : "var(--ink-muted)",
                        }}>{c}</code>
                      ))}
                    </div>
                  </button>
                ))}
              </div>

              {/* Form fields */}
              <div className="eyebrow" style={{ marginBottom: 10 }}>2 · 账户信息</div>
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                  <div>
                    <label className="label">用户名</label>
                    <input className="input mono" placeholder="英文字母，用于后续登录" />
                    <div className="hint">注册成功后无法修改。</div>
                  </div>
                  <div>
                    <label className="label">手机号</label>
                    <input className="input mono" placeholder="下单时使用的手机号" />
                    <div className="hint">用于匹配卖家订单记录。</div>
                  </div>
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

                <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 18, padding: "12px" }}>
                  提交注册 →
                </button>
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

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <input className="input mono" placeholder="用户名" />
                  <input className="input mono" placeholder="手机号" />
                  <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => setShowStatus(true)}>
                    查询状态
                  </button>
                </div>

                {showStatus && (
                  <div style={{
                    marginTop: 14,
                    padding: 12,
                    borderRadius: "var(--radius-md)",
                    background: "var(--warn-soft)",
                    border: "1px solid oklch(0.88 0.06 75)",
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warn)", marginTop: 6, flex: "0 0 auto" }}></span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-strong)", marginBottom: 2 }}>审核中</div>
                      <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                        提交时间 · <span style={{ fontFamily: "var(--f-mono)" }}>2026-05-22 11:14</span>
                      </div>
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
