function UsagePage() {
  return (
    <div style={{ maxWidth: 820 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Usage / 用量</div>
      <h2 className="display-title" style={{ fontSize: 42, margin: "0 0 12px" }}>Account usage / 账户用量</h2>
      <p style={{ color: "var(--ink-muted)", lineHeight: 1.65, margin: "0 0 6px" }}>
        Account-specific usage and plan details are available after you sign in.
      </p>
      <p lang="zh-CN" style={{ color: "var(--ink-muted)", lineHeight: 1.65, margin: 0 }}>
        登录后可查看与账户相关的用量和套餐信息。
      </p>
      <a href="/account" className="btn primary" style={{ display: "inline-block", marginTop: 20 }}>Account Management / 账户管理 →</a>
    </div>
  );
}

window.UsagePage = UsagePage;
