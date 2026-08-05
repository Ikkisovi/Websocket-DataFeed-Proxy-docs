const { useEffect, useState } = React;

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

function UpdatesTopbar() {
  return (
    <div className="topbar">
      <div className="brand"><span className="dot"></span><span><strong>Leandata Updates</strong></span></div>
      <div className="divider"></div>
      <div className="nav">
        <a href="/">Proxy API</a><a href="/docs/">Docs</a><a className="active" href="/updates">更新 / Updates</a><a href="/account">账户管理</a>
      </div>
      <div className="spacer"></div>
      <div className="meta"><LanguageToggle /><a href="/" className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }}>返回首页 →</a></div>
    </div>
  );
}

function updateDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return String(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN");
}

function UpdatesPage() {
  const [updates, setUpdates] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [loggedIn, setLoggedIn] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [updatesResponse, mineResponse] = await Promise.all([
        fetch("/api/product-updates"),
        fetch("/api/product-updates/feedback/mine", { credentials: "same-origin" }),
      ]);
      const updatesData = await updatesResponse.json();
      setUpdates(updatesData.updates || []);
      if (mineResponse.ok) {
        const mineData = await mineResponse.json();
        setLoggedIn(true);
        setFeedback(mineData.feedback || []);
      } else {
        setLoggedIn(false);
        setFeedback([]);
      }
    } catch (_) {
      setNotice("更新暂时无法读取，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const submit = async event => {
    event.preventDefault();
    if (!message.trim()) return setNotice("请先写下你的反馈。");
    setSubmitting(true); setNotice("");
    try {
      const response = await fetch("/api/product-updates/feedback", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "留言失败。");
      setFeedback(previous => [data.feedback, ...previous]);
      setMessage("");
      setNotice("已收到，谢谢你的反馈。");
    } catch (error) {
      setNotice(error.message || "留言失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <UpdatesTopbar />
      <main className="updates-shell">
        <div className="eyebrow" style={{ marginBottom: 10 }}>产品日志 · Product log</div>
        <h1 className="display-title" style={{ fontSize: 48, margin: "0 0 12px" }}>最近改动与留言</h1>
        <p style={{ color: "var(--ink-muted)", maxWidth: 720, lineHeight: 1.7, margin: "0 0 32px" }}>
          这里记录数据产品的近期变化，包括 Index options 支持与 Premium FMP fundamentals Beta；每条更新都会说明当前可用范围和下一步计划。
        </p>
        {notice && <div style={{ padding: "10px 14px", marginBottom: 20, border: "1px solid var(--accent-rule)", background: "var(--accent-soft)", color: "var(--accent-ink)", borderRadius: 8 }}>{notice}</div>}
        <div className="updates-grid">
          <section>
            <h2 className="display-title" style={{ fontSize: 28, margin: "0 0 14px" }}>近期改动</h2>
            {loading && <p style={{ color: "var(--ink-muted)" }}>读取中…</p>}
            {!loading && updates.map(item => (
              <article key={item.id} className="card" style={{ padding: 20, marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                  <span className="tier premium">{item.tag}</span><span style={{ color: "var(--ink-soft)", fontFamily: "var(--f-mono)", fontSize: 12 }}>{updateDate(item.date)}</span>
                </div>
                <h3 style={{ margin: "0 0 8px", fontSize: 20 }}>{item.title}</h3>
                <p style={{ margin: "0 0 8px", color: "var(--ink-muted)", lineHeight: 1.6 }}>{item.body}</p>
                <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: 13, lineHeight: 1.5 }}>{item.title_en} · {item.body_en}</p>
              </article>
            ))}
            <article className="card" style={{ padding: 20, marginBottom: 14 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 20 }}>快照、修订与 PIT 计划</h3>
              <p style={{ margin: 0, color: "var(--ink-muted)", lineHeight: 1.65 }}>
                这批数据是我们采购并导入的 bulk snapshot。上游可能在事后修订历史值，所以“某次快照”不自动等于严格 PIT。下一步会建立单独版本化的 PIT-like 周度或固定频率刷新：记录 capture time 与 visible time，保留不可变 vintage，并把每次刷新绑定到明确版本。
              </p>
              <p style={{ margin: "10px 0 0", color: "var(--ink-soft)", fontSize: 13, lineHeight: 1.55 }}>
                Native FMP endpoint forwarding 会作为另一个兼容层单独建设，不会与已发布的批量快照混为一谈。
              </p>
            </article>
            <article className="card" style={{ padding: 20, marginBottom: 14 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 20 }}>Premium 与 Ultimate</h3>
              <p style={{ margin: 0, color: "var(--ink-muted)", lineHeight: 1.65 }}>
                Premium 是当前 Beta 的访问层。Ultimate 计划增加 institutional holdings disclosures、ETF holdings 及相关数据族；这些数据同样可能被上游修订，也必须沿用 capture time、visible time 和 immutable vintage 语义后再作为可复现实验输入。
              </p>
            </article>
          </section>
          <aside className="card" style={{ padding: 20 }}>
            <h2 className="display-title" style={{ fontSize: 26, margin: "0 0 8px" }}>给我们留言</h2>
            {!loggedIn ? (
              <p style={{ color: "var(--ink-muted)", lineHeight: 1.6, margin: 0 }}>登录账户后即可提交反馈，并只查看自己的历史留言。<br/><a href="/account" style={{ color: "var(--accent-ink)" }}>去登录账户 →</a></p>
            ) : (
              <>
                <p style={{ color: "var(--ink-muted)", fontSize: 13, lineHeight: 1.5 }}>你的留言仅对账户本人可见；每小时最多提交 5 条。</p>
                <form onSubmit={submit}>
                  <textarea className="input" value={message} onChange={event => setMessage(event.target.value)} maxLength={2000} rows={6} placeholder="你希望下一步加入哪类 FMP 数据？" style={{ width: "100%", boxSizing: "border-box", resize: "vertical", marginBottom: 10 }} />
                  <button className="btn primary" type="submit" disabled={submitting}>{submitting ? "发送中…" : "提交反馈 →"}</button>
                </form>
                <h3 style={{ margin: "24px 0 10px", fontSize: 15 }}>我的留言</h3>
                {feedback.length === 0 ? <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>还没有留言。</p> : feedback.map(item => (
                  <div key={item.id} style={{ borderTop: "1px solid var(--rule)", padding: "10px 0", fontSize: 13 }}>
                    <div style={{ color: "var(--ink-muted)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{item.message}</div>
                    <div style={{ marginTop: 5, color: "var(--ink-soft)", fontFamily: "var(--f-mono)", fontSize: 11 }}>{updateDate(item.created_at)} · {item.status}</div>
                  </div>
                ))}
              </>
            )}
          </aside>
        </div>
      </main>
      <ComplianceFooter />
    </div>
  );
}

window.UpdatesPage = UpdatesPage;
