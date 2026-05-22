// TokenPage.jsx — Redesigned token-generation page (replaces public/index.html)
// Same shell + topbar as docs site; left = form, right = docs preview pane

const { useState: useTokenState } = React;

function TokenTopbar() {
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
        <span className="pill"><span className="live"></span> portal · production</span>
        <a className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }}>Sign in →</a>
      </div>
    </div>
  );
}

function TokenPage() {
  const [tokenVisible, setTokenVisible] = useTokenState(false);
  const [user, setUser] = useTokenState("ikkipipi");
  const [phone, setPhone] = useTokenState("15213285787");
  const sampleToken = "c886624f-232d-4803-99fa-f8b970e4720a";

  return (
    <div className="proxy-app" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TokenTopbar />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(420px, 440px) 1fr", flex: 1, minHeight: 0 }}>
        {/* Left: form */}
        <div style={{ padding: "56px 48px", background: "var(--bg-paper)", borderRight: "1px solid var(--rule)", overflow: "auto" }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Access · 30 day token</div>
          <h1 className="display-title" style={{ fontSize: 44, margin: "0 0 12px", lineHeight: 1.0 }}>
            Get your <span style={{ fontStyle: "italic", color: "var(--accent-ink)" }}>access</span> token
          </h1>
          <p style={{ color: "var(--ink-muted)", margin: "0 0 32px", fontSize: 14, maxWidth: 360 }}>
            Approved accounts only. Enter the username and phone number on file —
            we'll mint a fresh UUID and push it to the upstream proxy.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <label className="label">Username</label>
              <input className="input mono" value={user} onChange={e => setUser(e.target.value)} />
            </div>
            <div>
              <label className="label">Phone number</label>
              <input className="input mono" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            <button
              className="btn primary"
              style={{ width: "100%", justifyContent: "center", padding: "12px 14px", marginTop: 4 }}
              onClick={() => setTokenVisible(true)}
            >
              Generate token →
            </button>
          </div>

          {tokenVisible && (
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
                Token issued · valid for 30 days
              </div>
              <div className="card" style={{ padding: 16 }}>
                <div className="eyebrow" style={{ marginBottom: 8, color: "var(--ink-soft)" }}>Token</div>
                <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                  <input className="input mono" readOnly value={sampleToken} style={{ fontSize: 12, flex: 1 }} />
                  <button className="btn" style={{ padding: "0 14px", fontSize: 12 }}>Copy</button>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 12 }}>
                  <span style={{ color: "var(--ink-muted)" }}>Expires</span>
                  <span style={{ fontFamily: "var(--f-mono)", color: "var(--ink-strong)" }}>2026-06-21 · 14:15 UTC</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12 }}>
                  <span style={{ color: "var(--ink-muted)" }}>Role</span>
                  <span><span className="tier premium">Premium</span></span>
                </div>
              </div>
            </div>
          )}

          <hr style={{ border: 0, borderTop: "1px solid var(--rule)", margin: "32px 0" }} />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
            <span style={{ color: "var(--ink-muted)" }}>New user?</span>
            <a style={{ color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              Register here
              <span style={{ fontFamily: "var(--f-mono)" }}>→</span>
            </a>
          </div>

          {/* Subtle footer signature */}
          <div style={{ marginTop: 48, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--ink-soft)", letterSpacing: ".06em" }}>
            proxy-token-site · v2.4 · ec2 ⌁ us-west-2
          </div>
        </div>

        {/* Right: docs preview placeholder */}
        <div style={{ position: "relative", background: "var(--bg-canvas)", overflow: "hidden" }}>
          {/* Mini-topbar inside the docs pane */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 18px",
            borderBottom: "1px solid var(--rule)",
            background: "var(--bg-paper)",
            fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-muted)",
          }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#e0c89a" }}></span>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#cbd6b8" }}></span>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ink-soft)" }}></span>
            <span style={{ marginLeft: 8 }}>docs · ikkisovi.github.io / Websocket-DataFeed-Proxy-docs</span>
          </div>

          {/* Reuse a slim version of the docs body */}
          <div style={{ padding: "32px 36px 0", overflow: "auto", height: "calc(100% - 33px)" }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Reference</div>
            <h2 className="display-title" style={{ fontSize: 32, margin: "0 0 6px" }}>Stock Options Proxy API</h2>
            <p style={{ color: "var(--ink-muted)", margin: "0 0 22px", fontSize: 13.5, maxWidth: 560 }}>
              Rendered from the repository markdown sources.
            </p>

            <div style={{ display: "flex", gap: 22, borderBottom: "1px solid var(--rule)", marginBottom: 20 }}>
              <span style={{ paddingBottom: 8, borderBottom: "2px solid var(--ink-strong)", fontSize: 13, fontWeight: 500, color: "var(--ink-strong)" }}>Proxy API</span>
              <span style={{ paddingBottom: 8, fontSize: 13, color: "var(--ink-muted)" }}>WS usage</span>
            </div>

            <div className="card" style={{ padding: 14, marginBottom: 18, display: "flex", alignItems: "center", gap: 10 }}>
              <span className="method post">POST</span>
              <code className="ic" style={{ fontSize: 12.5 }}>/api/generate-token</code>
            </div>

            <h3 style={{ fontFamily: "var(--f-sans)", fontWeight: 500, fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-muted)", margin: "0 0 10px" }}>Example response</h3>
            <pre className="code" style={{ fontSize: 11.5, marginBottom: 18 }}>
{`{
  "success": true,
  "token":   "c886624f-…",
  "expiry":  "2026-06-19T14:15:57Z",
  "role":    "premium"
}`}
            </pre>

            <h3 style={{ fontFamily: "var(--f-sans)", fontWeight: 500, fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-muted)", margin: "0 0 10px" }}>Tier matrix</h3>
            <table className="tbl card" style={{ overflow: "hidden", fontSize: 12 }}>
              <thead>
                <tr><th>Tier</th><th>WS channels</th><th>REST</th></tr>
              </thead>
              <tbody>
                <tr><td><span className="tier premium">Premium</span></td><td style={{ fontFamily: "var(--f-mono)", fontSize: 11.5 }}>all</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 11.5 }}>all + history</td></tr>
                <tr><td><span className="tier standard">Limited</span></td><td style={{ fontFamily: "var(--f-mono)", fontSize: 11.5 }}>stocks, options</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 11.5 }}>partial</td></tr>
                <tr><td><span className="tier basic">Basic</span></td><td style={{ fontFamily: "var(--f-mono)", fontSize: 11.5 }}>stocks, news</td><td style={{ fontFamily: "var(--f-mono)", fontSize: 11.5 }}>history only</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

window.TokenPage = TokenPage;
