// RegisterPage.jsx — Redesigned registration page matching the docs aesthetic.
// Keeps the Chinese-language UI (target audience) but restyles into the
// warm-paper + Instrument Serif + IBM Plex Mono system. Drops the dark theme.

import PRODUCT_CATALOG from "./product-catalog.json";
import React, { useState as useRegState, useEffect as useRegEffect } from "react";

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
        <a href="/docs/#bulk">Bulk Download</a>
        <a href="index.html#ws-usage">WS usage</a>
        <a href="/account">账户管理</a>
      </div>
      <div className="spacer"></div>
      <div className="meta">
        <LanguageToggle />
        <a href="/account" className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }}>已有账号 · 账户管理 →</a>
      </div>
    </div>
  );
}

function planAccessSummary(plan) {
  const parts = [];
  if (Number.isInteger(plan?.rest_history_window_days)) {
    parts.push(`REST · recent ${plan.rest_history_window_days}d`);
  }
  return parts.join(" · ");
}

function RegisterPage() {
  const freePlan = PRODUCT_CATALOG.tiers.free;
  const freeChannels = Object.keys(freePlan.permissions.ws).filter(key => key !== "test" && freePlan.permissions.ws[key]);

  // Registration Form State
  const [regUsername, setRegUsername] = useRegState("");
  const [regPhone, setRegPhone] = useRegState("");
  const [regEmail, setRegEmail] = useRegState("");
  const [verificationCode, setVerificationCode] = useRegState("");
  const [verificationId, setVerificationId] = useRegState("");
  const [codeSent, setCodeSent] = useRegState(false);
  const [resendRemaining, setResendRemaining] = useRegState(0);
  const [regMsg, setRegMsg] = useRegState("");
  const [regStatus, setRegStatus] = useRegState(""); // "success", "error"
  const [activatedAccess, setActivatedAccess] = useRegState(null);
  const [regLoading, setRegLoading] = useRegState(false);
  const [existingAccount, setExistingAccount] = useRegState(false);

  // Status Query Form State
  const [checkUsername, setCheckUsername] = useRegState("");
  const [checkPhone, setCheckPhone] = useRegState("");
  const [checkMsg, setCheckMsg] = useRegState("");
  const [checkStatus, setCheckStatus] = useRegState(""); // "approved", "rejected", "pending", "not_found", "error"
  const [checkTokenInfo, setCheckTokenInfo] = useRegState(null); // { token, expiry, role, plan }
  const [checkLoading, setCheckLoading] = useRegState(false);

  useRegEffect(() => {
    if (resendRemaining <= 0) return undefined;
    const timer = setInterval(() => {
      setResendRemaining(value => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendRemaining]);

  const handleSendCode = async () => {
    const email = regEmail.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setRegMsg("请先填写有效的邮箱地址。");
      setRegStatus("error");
      return;
    }
    setRegLoading(true);
    setRegMsg("");
    setRegStatus("");
    try {
      const resp = await fetch('/api/register/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        setRegEmail(email);
        setVerificationId(data.challenge_id);
        setCodeSent(true);
        setResendRemaining(60);
        setRegMsg(data.message || "验证码已发送，请检查邮箱。");
        setRegStatus("success");
      } else {
        setRegMsg(data.message || "验证码发送失败，请稍后重试。");
        setRegStatus("error");
      }
    } catch (err) {
      setRegMsg("网络错误，请稍后再试。");
      setRegStatus("error");
    } finally {
      setRegLoading(false);
    }
  };

  // Handle Registration Submit
  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!regEmail.trim() || !verificationId || !/^\d{6}$/.test(verificationCode.trim())) {
      setRegMsg("请先获取并填写 6 位邮箱验证码。");
      setRegStatus("error");
      return;
    }
    if (!regUsername.trim() || !regPhone.trim() || !regEmail.trim()) {
      setRegMsg("请填写用户名、手机号和邮箱。");
      setRegStatus("error");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(regEmail.trim())) {
      setRegMsg("请输入有效的邮箱地址。");
      setRegStatus("error");
      return;
    }
    setRegLoading(true);
    setRegMsg("");
    setRegStatus("");
    setActivatedAccess(null);
    setExistingAccount(false);

    try {
      const resp = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: regUsername.trim(),
          phone: regPhone.trim(),
          email: regEmail.trim(),
          verification_id: verificationId,
          verification_code: verificationCode.trim(),
          tier: "free"
        })
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        if (data.status === "approved" && data.token) {
          setActivatedAccess({
            token: data.token,
            expiry: data.expiry,
            plan: data.current_plan || { name: data.tier || data.role || "Free" },
          });
          setRegMsg(data.message || "Free 计划已启用。");
          setRegStatus("success");
          setRegEmail("");
          setVerificationCode("");
          setVerificationId("");
          setCodeSent(false);
          return;
        }
        if (data.status === "existing_account") {
          setExistingAccount(true);
          setRegMsg(data.message || "该账户已存在，请从账户管理进入升级与用量页面。");
          setRegStatus("success");
          setRegEmail("");
          setVerificationCode("");
          setVerificationId("");
          setCodeSent(false);
          return;
        }
        setRegMsg(data.message || "账户已创建。");
        setRegStatus("success");
        setRegEmail("");
        setVerificationCode("");
        setVerificationId("");
        setCodeSent(false);
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
      setCheckMsg("请填写注册时的用户名和手机号。");
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
          setCheckTokenInfo({
            token: data.token,
            expiry: data.expiry,
            role: data.role,
            plan: data.current_plan,
          });
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

      <div className="register-content" style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        background: "var(--bg-canvas)",
        padding: "48px 64px 64px",
      }}>
        {/* Hero */}
        <div className="register-shell" style={{ maxWidth: 980, margin: "0 auto" }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>创建账户 · Free 计划</div>
          <h1 className="display-title register-title" style={{ fontSize: 52, margin: "0 0 12px", lineHeight: 1.02 }}>
            新用户 <span style={{ fontStyle: "italic", color: "var(--accent-ink)" }}>注册</span>
          </h1>
          <p style={{ color: "var(--ink-muted)", margin: "0 0 36px", fontSize: 15, maxWidth: 560 }}>
            注册默认开通 Free；可用数据范围见套餐权益与接口目录，当前请求和订阅限制见账户页。
            需要更多历史、额度或实时订阅，请在账户管理中升级。
          </p>

          {/* Layout: form + status side by side */}
          <div className="register-layout" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 32, alignItems: "start" }}>
            {/* Left: Free registration form */}
            <div>
              {/* Free account registration */}
              <div className="eyebrow" style={{ marginBottom: 10 }}>1 · 邮箱验证</div>
              <div className="card" style={{ padding: 24 }}>
                <form onSubmit={handleRegisterSubmit}>
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ padding: 14, border: "1px solid var(--accent-rule)", borderRadius: "var(--radius-md)", background: "var(--accent-soft)" }}>
                      <div className="eyebrow" style={{ color: "var(--accent-ink)", marginBottom: 6 }}>Default plan · Free</div>
                      <strong style={{ color: "var(--ink-strong)" }}>注册后立即开通</strong>
                      <div style={{ marginTop: 4, color: "var(--ink-muted)", fontSize: 12.5, lineHeight: 1.55 }}>
                        Free 长期有效 · {freeChannels.length} 个 WebSocket 通道。股票与期权历史最近 {freePlan.constraints.history_days} 个日历日；期权合约与最新快照限最近 {freePlan.constraints.option_expirations} 个未来到期日。当前运行时请求与订阅限制见账户页。
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 10, paddingTop: 18, borderTop: "1px solid var(--rule)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "end" }}>
                      <div>
                        <label className="label">邮箱地址</label>
                        <input
                          className="input mono"
                          type="email"
                          placeholder="name@example.com"
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          required
                        />
                        <div className="hint">验证码将发送到这个邮箱。</div>
                      </div>
                      <button
                        type="button"
                        className="btn"
                        onClick={handleSendCode}
                        disabled={regLoading || resendRemaining > 0}
                        style={{ minWidth: 132, justifyContent: "center", opacity: regLoading || resendRemaining > 0 ? 0.7 : 1 }}
                      >
                        {resendRemaining > 0 ? `${resendRemaining}s 后重发` : (codeSent ? "重新发送验证码" : "发送验证码")}
                      </button>
                    </div>
                    {codeSent && (
                      <div style={{ marginTop: 18 }}>
                        <label className="label">邮箱验证码</label>
                        <input
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          className="input mono"
                          placeholder="输入 6 位验证码"
                          value={verificationCode}
                          onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          required
                        />
                        <div className="hint">验证码有效期 10 分钟。</div>
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--rule)" }}>
                    <div className="eyebrow" style={{ marginBottom: 10 }}>2 · 账户信息</div>
                  </div>
                  <div className="register-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
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
                    <span>用户名、手机号和邮箱共同确定账户。邮箱必须通过验证码验证。</span>
                  </div>

                  <button 
                    type="submit" 
                    disabled={regLoading}
                    className="btn primary" 
                    style={{ width: "100%", justifyContent: "center", marginTop: 18, padding: "12px", opacity: regLoading ? 0.7 : 1 }}
                  >
                    {regLoading ? "正在创建账户…" : "注册并立即开通 Free →"}
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

                {existingAccount && (
                  <a href="/account" className="btn accent" style={{ width: "100%", justifyContent: "center", marginTop: 14 }}>
                    进入账户管理并升级 →
                  </a>
                )}

                {activatedAccess && (
                  <div className="card" style={{ marginTop: 14, padding: 16, background: "var(--accent-soft)", borderColor: "var(--accent-rule)" }}>
                    <div className="eyebrow" style={{ marginBottom: 8, color: "var(--accent-ink)" }}>Current plan</div>
                    <div style={{ fontSize: 16, fontWeight: 650, color: "var(--ink-strong)" }}>{activatedAccess.plan?.name || "Free"}</div>
                    <div style={{ marginTop: 4, fontSize: 12, color: "var(--ink-muted)" }}>{planAccessSummary(activatedAccess.plan)}</div>
                    <label className="label" style={{ marginTop: 14 }}>一次性 Token</label>
                    <input className="input mono" readOnly value={activatedAccess.token} style={{ fontSize: 12 }} />
                    <div className="hint">请立即复制并安全保存；有效期至 {activatedAccess.expiry ? new Date(activatedAccess.expiry).toLocaleDateString("zh-CN") : "长期有效"}。</div>
                    {new URLSearchParams(window.location.search).get("next") === "research-data" && (
                      <a className="btn accent" href="/research-data" style={{ marginTop: 14 }}>继续研究数据采购 →</a>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right: status-check card */}
            <aside className="register-status">
              <div className="card register-status-card" style={{ padding: 20, position: "sticky", top: 24 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>查询进度</div>
                <h3 className="display-title" style={{ fontSize: 22, margin: "0 0 6px" }}>已注册？</h3>
                <p style={{ color: "var(--ink-muted)", fontSize: 12.5, margin: "0 0 16px" }}>
                  使用注册时的用户名和手机号查询账户状态。
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
                                ["pending", "payment_pending"].includes(checkStatus) ? "var(--warn-soft)" : "var(--danger-soft)",
                    border: checkStatus === "approved" ? "1px solid var(--ok)" : 
                            ["pending", "payment_pending"].includes(checkStatus) ? "1px solid var(--warn)" : "1px solid var(--danger)",
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                  }}>
                    <span style={{ 
                      width: 6, 
                      height: 6, 
                      borderRadius: "50%", 
                      background: checkStatus === "approved" ? "var(--ok)" :
                                  ["pending", "payment_pending"].includes(checkStatus) ? "var(--warn)" : "var(--danger)",
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
                        {checkStatus === "approved" ? "已开通" :
                         checkStatus === "payment_pending" ? "账户已创建" :
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
                            <span style={{ color: "var(--ink-strong)" }}>{checkTokenInfo.expiry ? new Date(checkTokenInfo.expiry).toLocaleDateString("zh-CN") : checkTokenInfo.role === "free" ? "长期有效" : "—"}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--ink-muted)" }}>Role</span>
                            <span style={{ color: "var(--ink-strong)" }}>{checkTokenInfo.role || "—"}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                            <span style={{ color: "var(--ink-muted)" }}>Current plan</span>
                            <span style={{ color: "var(--ink-strong)" }}>{checkTokenInfo.plan?.name || "—"}</span>
                          </div>
                          {planAccessSummary(checkTokenInfo.plan) && (
                            <div style={{ marginTop: 6, color: "var(--ink-muted)", fontSize: 10.5 }}>
                              {planAccessSummary(checkTokenInfo.plan)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <hr style={{ border: 0, borderTop: "1px solid var(--rule)", margin: "20px 0 14px" }} />
                <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                  <strong style={{ color: "var(--ink-strong)" }}>状态说明 · </strong>
                  <span style={{ fontFamily: "var(--f-mono)" }}>Free → active · upgrade in /account</span>
                </div>
              </div>

              {/* Compliance & Help block */}
              <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--rule)", fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.6 }}>
                <div style={{ color: "var(--ink-strong)", fontWeight: 600 }}>Leandata Technologies Ltd.</div>
                <div>700 W Georgia St, Vancouver, BC V7Y 1B6, Canada</div>
                <div style={{ marginTop: 4 }}>
                  <a href="https://leandata.uk" style={{ color: "var(--accent-ink)", textDecoration: "none" }}>https://leandata.uk</a>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

window.RegisterPage = RegisterPage;
export { RegisterPage };
