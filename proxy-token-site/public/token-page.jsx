// TokenPage.jsx — Redesigned token-generation page (replaces public/index.html)
// Same shell + topbar as docs site; left = form, right = docs iframe

const { useState } = React;

function TokenTopbar({ portalOpen, setPortalOpen }) {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="dot"></span>
        <span><strong>Proxy Token Site</strong></span>
      </div>
      <div className="divider"></div>
      <div className="nav">
        <a>Proxy API</a>
        <a>WS usage</a>
      </div>
      <div className="spacer"></div>
      <div className="meta">
        {!portalOpen && (
          <button className="btn ghost" onClick={() => setPortalOpen(true)} style={{ marginRight: 12, padding: "6px 10px", fontSize: 12 }}>
            Open Portal
          </button>
        )}
        <span className="pill"><span className="live"></span> portal · production</span>
        <a href="/admin.html" className="btn ghost" style={{ padding: "6px 10px", fontSize: 12 }}>Admin →</a>
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

  const handleGenerate = async () => {
    if (!user || !phone) {
      setErrorMsg("Please enter both username and phone number.");
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
      setErrorMsg('Network error or server is down. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (tokenData && tokenData.token) {
      navigator.clipboard.writeText(tokenData.token);
      alert("Token copied to clipboard!");
    }
  };

  return (
    <div className="proxy-app" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TokenTopbar portalOpen={portalOpen} setPortalOpen={setPortalOpen} />

      <div style={{ display: "grid", gridTemplateColumns: portalOpen ? "minmax(420px, 440px) 1fr" : "1fr", flex: 1, minHeight: 0 }}>
        {/* Left: form */}
        {portalOpen && (
        <div style={{ position: "relative", padding: "56px 48px", background: "var(--bg-paper)", borderRight: "1px solid var(--rule)", overflow: "auto" }}>
          <button onClick={() => setPortalOpen(false)} style={{ position: "absolute", top: 16, right: 16, background: "transparent", border: "none", cursor: "pointer", fontSize: 20, color: "var(--ink-muted)" }}>✕</button>
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
              onClick={handleGenerate}
              disabled={loading}
            >
              {loading ? "Generating..." : "Generate token →"}
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
                Token issued · valid for 30 days
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
            proxy-token-site · v2.4 · ec2 ⌁ us-west-2
          </div>
        </div>

        )}
        {/* Right: real docs iframe */}
        <div style={{ position: "relative", background: "var(--bg-canvas)", overflow: "hidden" }}>
          <iframe 
            src={`https://ikkisovi.github.io/Websocket-DataFeed-Proxy-docs/?v=${Date.now()}`}
            title="Documentation" 
            style={{ width: '100%', height: '100%', border: 'none' }} 
          />
        </div>
      </div>
    </div>
  );
}

window.TokenPage = TokenPage;
