// TokenPage.jsx — Redesigned token-generation page (replaces public/index.html)
// Same shell + topbar as docs site; left = form, right = docs iframe

import React, { useState } from "react";
import { DocsSite } from "./docs/docs-site.jsx";

function TokenTopbar({ portalOpen, setPortalOpen }) {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="dot"></span>
        <span><strong>Proxy Token Site</strong></span>
      </div>
      <div className="divider"></div>
      <div className="nav">
        <a href="/docs/" style={{ cursor: "pointer" }}>文档</a>
        <a href="/docs/#status" style={{ cursor: "pointer" }}>状态</a>
        <a href="/docs/#usage" style={{ cursor: "pointer" }}>用量</a>
        <a href="/updates" style={{ cursor: "pointer" }}>更新 / Updates</a>
      </div>
      <div className="spacer"></div>
      <div className="meta">
        <LanguageToggle />
        {!portalOpen && (
          <button className="btn ghost" onClick={() => setPortalOpen(true)} style={{ marginRight: 12, padding: "6px 10px", fontSize: 12 }}>
            打开入口
          </button>
        )}
        <a href="/account" className="btn accent" style={{ padding: "6px 10px", fontSize: 12 }}>管理账户 →</a>
        <a href="/admin.html" className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }}>管理后台 →</a>
      </div>
    </div>
  );
}

function TokenPage() {
  const [portalOpen, setPortalOpen] = useState(true);
  const [user, setUser] = useState("");
  const [phone, setPhone] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [tokenData, setTokenData] = useState(null); // { token, expiry, role }

  const t = (text) => window.LeandataI18n?.translate(text) || text;

  const handleGenerate = async () => {
    if (!user || !phone) {
      setErrorMsg("请输入用户名和手机号。");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setTokenData(null);
    
    try {
      const response = await fetch('/api/generate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, phone })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setTokenData({
          token: data.token,
          expiry: new Date(data.expiry).toLocaleString(),
          role: data.role || "premium"
        });
      } else {
        setErrorMsg(data.message);
      }
    } catch (error) {
      console.error('Error:', error);
      setErrorMsg("网络错误或服务器停机，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (tokenData && tokenData.token) {
      navigator.clipboard.writeText(tokenData.token);
      alert(t("令牌已复制到剪贴板！"));
    }
  };

  return (
    <div className="proxy-app" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TokenTopbar portalOpen={portalOpen} setPortalOpen={setPortalOpen} />

      <a href="/updates" style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "11px 22px",
        background: "var(--accent-soft)",
        borderBottom: "1px solid var(--accent-rule)",
        color: "var(--accent-ink)",
        textDecoration: "none",
        fontSize: 13,
      }}>
        <span>
          <strong>最近更新 · 财务历史与 Free 计划说明已更新</strong>
          　文档现在更容易理解，并明确说明 Free 的可用范围；长期财务历史已恢复，股票日线查不到时也会自动尝试历史归档。
        </span>
        <span style={{ fontFamily: "var(--f-mono)", whiteSpace: "nowrap" }}>查看更新 / View updates →</span>
      </a>

      <div style={{ display: "grid", gridTemplateColumns: portalOpen ? "minmax(420px, 440px) 1fr" : "1fr", flex: 1, minHeight: 0 }}>
        {/* Left: form */}
        {portalOpen && (
        <div style={{ position: "relative", padding: "56px 48px", background: "var(--bg-paper)", borderRight: "1px solid var(--rule)", overflow: "auto" }}>
          <button onClick={() => setPortalOpen(false)} style={{ position: "absolute", top: 16, right: 16, background: "transparent", border: "none", cursor: "pointer", fontSize: 20, color: "var(--ink-muted)" }}>✕</button>
          <div className="eyebrow" style={{ marginBottom: 14 }}>访问 · 30 天令牌</div>
          <h1 className="display-title" style={{ fontSize: 44, margin: "0 0 12px", lineHeight: 1.0 }}>
            获取您的 <span style={{ fontStyle: "italic", color: "var(--accent-ink)" }}>访问令牌</span>
          </h1>
          <p style={{ color: "var(--ink-muted)", margin: "0 0 32px", fontSize: 14, maxWidth: 360 }}>
            仅限已审核账户。输入注册时的用户名和手机号，即可恢复现有 Token；只有缺失时才会生成新的 UUID 并完成账户访问更新。
          </p>

          <div className="card" style={{ padding: 14, marginBottom: 24 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>AI agent skill</div>
            <p style={{ color: "var(--ink-muted)", fontSize: 12.5, lineHeight: 1.55, margin: "0 0 10px" }}>
              下载公开 skill，让 AI agent（如 Claude Code / Cursor / Codex）按正确规范拉取数据，包含 Free 计划范围约束与 400–504 错误分析。
            </p>
            <a
              className="btn"
              href="/skills/leandata-market-data/SKILL.md"
              download="SKILL.md"
              style={{ display: "inline-flex", textDecoration: "none", fontSize: 12 }}
            >
              Download SKILL.md
            </a>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <label className="label">用户名</label>
              <input className="input mono" value={user} onChange={e => setUser(e.target.value)} />
            </div>
            <div>
              <label className="label">手机号</label>
              <input className="input mono" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            <button
              className="btn primary"
              style={{ width: "100%", justifyContent: "center", padding: "12px 14px", marginTop: 4 }}
              onClick={handleGenerate}
              disabled={loading}
            >
              {loading ? "生成中…" : "生成令牌 →"}
            </button>
          </div>
          
          {errorMsg && (
            <div style={{ marginTop: 20, color: "#d9534f", fontSize: 13, background: "#fdf7f7", padding: "10px 12px", borderRadius: 6, border: "1px solid #f5c6c6" }}>
              {errorMsg}
            </div>
          )}

          {tokenData && (
            <div style={{ marginTop: 28 }}>
              <div style={{
                background: "var(--accent-soft)",
                border: "1px solid var(--accent-rule)",
                borderRadius: "var(--radius-md)",
                padding: "10px 12px",
                fontSize: 12.5,
                color: "var(--accent-ink)",
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ok)" }}></span>
                Token ready · 请复制并安全保存
              </div>
              <div className="card" style={{ padding: 16 }}>
                <div className="eyebrow" style={{ marginBottom: 8, color: "var(--ink-soft)" }}>Token</div>
                <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                  <input className="input mono" readOnly value={tokenData.token} style={{ fontSize: 12, flex: 1 }} />
                  <button className="btn" style={{ padding: "0 14px", fontSize: 12 }} onClick={handleCopy}>Copy</button>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 12 }}>
                  <span style={{ color: "var(--ink-muted)" }}>Expires</span>
                  <span style={{ fontFamily: "var(--f-mono)", color: "var(--ink-strong)" }}>{tokenData.expiry}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12 }}>
                  <span style={{ color: "var(--ink-muted)" }}>Role</span>
                  <span><span className={"tier " + tokenData.role}>{tokenData.role}</span></span>
                </div>
              </div>
            </div>
          )}

          <hr style={{ border: 0, borderTop: "1px solid var(--rule)", margin: "32px 0" }} />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
            <span style={{ color: "var(--ink-muted)" }}>New user?</span>
            <a href="/register.html" style={{ color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", gap: 6, textDecoration: 'none' }}>
              Register here
              <span style={{ fontFamily: "var(--f-mono)" }}>→</span>
            </a>
          </div>

          <div style={{ marginTop: 48, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--ink-soft)", letterSpacing: ".06em" }}>
            Token portal · v2.4
          </div>
        </div>

        )}
        {/* Right: real docs site */}
        <div style={{ position: "relative", background: "var(--bg-canvas)", overflow: "auto" }}>
          <DocsSite hideTopbar={true} />
        </div>
      </div>
    </div>
  );
}

window.TokenPage = TokenPage;
export { TokenPage };
