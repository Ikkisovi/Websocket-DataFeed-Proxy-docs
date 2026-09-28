import React, { useEffect, useState } from "react";

async function researchRequest(url, body) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.code || "request_failed"), { status: response.status });
  return data;
}

export function ResearchDataPage() {
  const [language, setLanguage] = useState(() => window.LeandataI18n?.getLanguage() || "zh");
  const [products, setProducts] = useState(null);
  const [selected, setSelected] = useState("spectral-tick-flow");
  const [account, setAccount] = useState(null);
  const [sessionState, setSessionState] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null);
  const t = (zh, en) => language === "en" ? en : zh;
  const product = products?.find(item => item.id === selected);
  const free = product?.status === "free" && product.amount_minor === 0 && product.payment_required === false;
  const money = product ? new Intl.NumberFormat(language === "en" ? "en-US" : "zh-CN", {
    style: "currency", currency: product.currency,
  }).format(product.amount_minor / 100) : "—";

  async function loadProducts() {
    setError("");
    try {
      const data = await researchRequest("/api/research-data/products");
      if (!Array.isArray(data.products) || !data.products.length) throw new Error("catalog_unavailable");
      setProducts(data.products);
    } catch (_) { setError("catalog_unavailable"); }
  }
  async function loadSession() {
    setSessionState("loading");
    try {
      const data = await researchRequest("/api/account/session");
      if (!data.account) throw new Error("session_unavailable");
      setAccount(data.account);
      setSessionState("ready");
    } catch (err) {
      setAccount(null);
      setSessionState(err.status === 401 ? "ready" : "error");
    }
  }
  useEffect(() => {
    loadProducts();
    loadSession();
    const onLanguage = () => setLanguage(window.LeandataI18n?.getLanguage() || "zh");
    window.addEventListener("leandata:languagechange", onLanguage);
    return () => window.removeEventListener("leandata:languagechange", onLanguage);
  }, []);

  async function checkout(event) {
    event.preventDefault();
    if (!free || busy || !account || sessionState !== "ready") return;
    setBusy(true);
    setError("");
    try {
      const data = await researchRequest("/api/research-data/checkout", { product_id: product.id });
      setReceipt(data);
    } catch (err) {
      if (err.status === 401) setAccount(null);
      setError(err.message === "token_expired" ? "token_expired" : err.status === 401 ? "login_failed" : "checkout_failed");
    } finally { setBusy(false); }
  }

  return <div className="proxy-app research-page" data-no-i18n="true">
    <header className="topbar research-topbar">
      <a className="brand" href="/"><span className="dot" aria-hidden="true" /><strong>Leandata</strong></a>
      <div className="divider" />
      <nav className="nav" aria-label={t("主导航", "Main navigation")}>
        <a href="/docs/">{t("数据文档", "Documentation")}</a>
        <a href="/research-data" className="active" aria-current="page">{t("研究数据", "Research Data")}</a>
        <a href="/alternative-data/">{t("另类数据", "Alternative data")}</a>
      </nav>
      <div className="spacer" />
      <div className="meta">
        <button className="btn ghost research-language" data-ld-language-toggle="true" type="button" onClick={() => window.LeandataI18n?.setLanguage(language === "zh" ? "en" : "zh")}>{language === "zh" ? "English" : "中文"}</button>
        <a className="btn accent" href="/account">{t("管理账户", "Manage account")} →</a>
      </div>
    </header>
    <main className="research-shell">
      <div className="research-heading">
        <p className="eyebrow">RESEARCH DATA / {t("独立采购", "SEPARATE CHECKOUT")}</p>
        <h1 className="display-title">{t("研究数据", "Research Data")}</h1>
        <p>{t("按研究数据产品单独选择与结算。Spectral Tick-Flow 当前免费，使用有效 Token 即可访问。", "Select and check out research data independently. Spectral Tick-Flow is currently free with an active token.")}</p>
      </div>
      <div className="research-layout">
        <section aria-labelledby="research-catalog-title">
          <div className="research-section-heading"><h2 id="research-catalog-title">{t("可用数据", "Available data")}</h2><span>{products ? `${products.length} ${t("项产品", "product")}` : "…"}</span></div>
          {!products && !error && <p role="status">{t("正在加载数据产品…", "Loading data products…")}</p>}
          {products?.map(item => <label key={item.id} className={`card research-product ${selected === item.id ? "selected" : ""}`}>
            <div className="research-product-top"><span className="eyebrow">{t("日频研究信号", "DAILY RESEARCH SIGNAL")}</span><input type="radio" name="product" aria-label={item.name} value={item.id} checked={selected === item.id} onChange={() => { setSelected(item.id); setReceipt(null); }} /></div>
            <h3 className="display-title">{item.name}</h3>
            <p className="research-description">{t("探索股票成交订单流的周期结构。按历史 SPY 成分与稳定 SID 查询日频信号，保留源数据的稀疏日期与空值。", "Explore periodic structure in equity trading flow. Query daily signals by historical SPY membership and stable SID, with source gaps and nulls preserved.")}</p>
            <div className="research-tags"><span>{t("日频", "Daily")}</span><span>10 {t("个信号字段", "signal fields")}</span><span>{t("历史归档", "Historical archive")}</span></div>
            <div className="research-endpoints">{item.endpoints.map(endpoint => <code key={endpoint}>{endpoint}</code>)}</div>
            <div className="research-product-bottom"><strong>{item.amount_minor === 0 ? t("当前免费", "Currently free") : t("单独定价", "Separate pricing")}</strong><a href={item.docs_url}>{t("查看字段与覆盖范围", "Fields & coverage")} ↗</a></div>
          </label>)}
          <div className="research-details"><h3>{t("一次接入，开始研究", "Connect and start researching")}</h3><ol>
            <li>{t("注册免费账户，或使用现有账户登录。", "Create a free account or sign in with your existing account.")}</li>
            <li>{t("确认产品与金额，免费产品无需填写支付信息。", "Review your product and total. Free products need no payment details.")}</li>
            <li>{t("使用账户中的 Token，按文档调用研究数据接口。", "Use your account token to call the documented research endpoints.")}</li>
          </ol><p>{t("Spectral 可查询已有历史归档，不受行情免费套餐的回溯窗口限制。单次查询最多 10,000 行；无 SID 或股票筛选时，日期跨度最多 7 天。", "Spectral includes the available historical archive without the free market-data lookback window. Queries return up to 10,000 rows; unfiltered queries span at most seven days.")}</p></div>
        </section>
        <aside className="card research-checkout" aria-labelledby="research-checkout-title">
          <p className="eyebrow">{t("独立结算", "SEPARATE CHECKOUT")}</p>
          <h2 className="display-title" id="research-checkout-title">{t("采购明细", "Your selection")}</h2>
          <div className="research-line"><span>{product?.name || "—"}</span><strong>{money}</strong></div>
          <div className="research-line research-total"><span>{t("本次应付", "Total due")}</span><strong>{money}</strong></div>
          <p className="research-payment-note">{free ? t("无需付款 · 无自动续费", "No payment · No automatic renewal") : t("请选择可用产品。", "Select an available product.")}</p>
          {receipt ? <div className="research-success" role="status">
            <span className="research-success-mark" aria-hidden="true">✓</span>
            <h3>{t("免费访问已确认", "Free access confirmed")}</h3>
            <p>{t("使用现有 Token 即可调用。你的行情套餐与 Token 有效期保持不变。", "Use your existing token. Your market-data plan and token expiry stay the same.")}</p>
            <a className="btn accent research-button" href={receipt.product.docs_url}>{t("开始使用", "Start using the API")} →</a>
            <a className="research-secondary" href={receipt.token_url}>{t("前往账户获取 Token", "Get your token in Account")}</a>
          </div> : sessionState === "loading" ? <p className="research-account" role="status">{t("正在检查登录状态…", "Checking sign-in status…")}</p>
            : sessionState === "error" ? <div className="research-error" role="alert">
              {t("暂时无法检查登录状态，请重试。", "Could not check your sign-in status. Please retry.")}
              <button className="btn ghost" type="button" onClick={loadSession}>{t("重试", "Retry")}</button>
            </div> : account ? <form onSubmit={checkout}>
              <p className="research-account">{t("已登录", "Signed in")}: {account.user_id}</p>
              <button className="btn accent research-button" type="submit" disabled={!free || busy}>{busy ? t("正在确认…", "Confirming…") : t("确认免费访问", "Confirm free access")}{!busy && " →"}</button>
            </form> : <div>
              <a className="btn accent research-button" href="/account?next=research-data">{t("登录并继续", "Sign in to continue")} →</a>
              <a className="research-secondary" href="/register?next=research-data">{t("没有账户？免费注册", "New here? Create a free account")}</a>
            </div>}
          {error && <div className="research-error" role="alert">
            {error === "catalog_unavailable" ? t("产品暂时无法加载，请重试。", "The catalog could not be loaded. Please retry.") : error === "token_expired" ? t("Token 已过期，请到账户页面查看有效期。", "Your token has expired. Check your access in Account.") : error === "login_failed" ? t("登录信息不匹配或会话已过期，请重新登录。", "Sign-in details did not match or your session expired. Please sign in again.") : t("确认失败，请稍后重试。", "Unable to confirm access. Please try again.")}
            {error === "catalog_unavailable" && <button type="button" onClick={loadProducts}>{t("重试", "Retry")}</button>}
            {error === "token_expired" && <a href="/account">{t("账户管理", "Account")}</a>}
          </div>}
          <p className="research-footnote">{t("研究数据单独定价。免费状态以本页为准，其他产品将按其公布价格结算。", "Research data is priced per product. Current free availability is shown here; other products will use their published prices.")}</p>
        </aside>
      </div>
    </main>
    <footer className="research-footer"><span>Leandata Technologies Ltd.</span><a href="/checkout">{t("行情套餐与续费", "Market-data plans & renewal")} ↗</a></footer>
  </div>;
}
