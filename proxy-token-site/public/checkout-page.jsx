const {
  useEffect: useCheckoutEffect,
  useMemo: useCheckoutMemo,
  useState: useCheckoutState,
} = React;

function CheckoutIcon({ name }) {
  const paths = {
    back: <path d="M15 18l-6-6 6-6" />,
    chevron: <path d="M6 9l6 6 6-6" />,
    check: <path d="M5 12l4 4L19 6" />,
    shield: (
      <>
        <path d="M12 3l7 3v5c0 4.4-2.8 7.7-7 10-4.2-2.3-7-5.6-7-10V6l7-3z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
    bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
    layers: (
      <>
        <path d="M12 2l9 5-9 5-9-5 9-5z" />
        <path d="M3 12l9 5 9-5" />
        <path d="M3 17l9 5 9-5" />
      </>
    ),
    link: (
      <>
        <path d="M10 13a5 5 0 007.1.1l2-2a5 5 0 00-7.1-7.1l-1.1 1.1" />
        <path d="M14 11a5 5 0 00-7.1-.1l-2 2A5 5 0 0012 20l1.1-1.1" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.check}
    </svg>
  );
}

function PaymentMethodIcon({ method }) {
  if (method === "alipay") {
    return (
      <span className="payment-logo alipay" aria-hidden="true" data-no-i18n="true">
        <span className="alipay-symbol">支</span>
        <span className="alipay-wordmark">ALIPAY</span>
      </span>
    );
  }
  if (method === "stripe_card") {
    return (
      <span className="payment-logo stripe_card" aria-hidden="true">
        <span className="stripe-wordmark">stripe</span>
      </span>
    );
  }
  return (
    <span className="payment-logo wechat_pay" aria-hidden="true">
      <svg viewBox="0 0 48 38" fill="none">
        <path d="M20.2 4C10.7 4 3 10 3 17.3c0 4.1 2.4 7.8 6.3 10.2L7.8 33l6.2-3.2c2 .5 4.1.8 6.2.8 9.5 0 17.2-6 17.2-13.3S29.7 4 20.2 4z" fill="currentColor" />
        <path d="M31.6 13.5c7.4 0 13.4 4.7 13.4 10.5 0 3.2-1.9 6.1-4.9 8l1.1 4.2-4.8-2.5c-1.5.4-3.2.6-4.8.6-7.4 0-13.4-4.7-13.4-10.4 0-5.8 6-10.4 13.4-10.4z" fill="#fff" stroke="currentColor" strokeWidth="2" />
        <circle cx="14" cy="15" r="1.6" fill="#fff" />
        <circle cx="25" cy="15" r="1.6" fill="#fff" />
        <circle cx="27.5" cy="23.5" r="1.3" fill="currentColor" />
        <circle cx="35.5" cy="23.5" r="1.3" fill="currentColor" />
      </svg>
    </span>
  );
}

async function checkoutRequest(path, options = {}) {
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

function formatCny(amountFen) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(Number(amountFen || 0) / 100);
}

function formatCardMoney(amountMinor, currency) {
  return new Intl.NumberFormat(currency === "CAD" ? "en-CA" : "en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
  }).format(Number(amountMinor || 0) / 100);
}

function formatCheckoutDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function selectedBundleParts(bundleId) {
  const match = String(bundleId || "").match(/^(basic|value|standard|premium)(?:-(stocks|options))?-(1|2|3|6|12)m$/);
  return match
    ? { tier: match[1], mode: match[2] || "", months: Number(match[3]) }
    : { tier: "standard", mode: "", months: 1 };
}

function CheckoutSuccess({ info, result, issuedToken }) {
  const order = result?.order || {};
  const account = order.account || {};
  const isRegistration = (info?.kind || order.kind) === "registration";
  const copyToken = async () => {
    if (!issuedToken) return;
    await navigator.clipboard.writeText(issuedToken);
  };
  return (
    <div className="checkout-layout">
      <section>
        <h1 className="checkout-section-title">支付已完成</h1>
        <div className="activation-note">
          <CheckoutIcon name="shield" />
          <span>
            订单已经完成幂等履约。{isRegistration ? "账户与数据访问 Token 已自动创建。" : "原有 Token 保持不变，有效期已经自动延长。"}
          </span>
        </div>
      </section>
      <aside className="checkout-summary">
        <div className="summary-card success-card">
          <div className="success-mark"><CheckoutIcon name="check" /></div>
          <h2 className="success-title">已激活</h2>
          <p className="success-copy">
            {account.user_id} 的 {order.bundle?.name || account.tier} 套餐已生效，有效期至 {formatCheckoutDate(account.expiry)}。
          </p>
          {issuedToken && (
            <div className="token-box">
              <div className="token-label">首次签发 Token</div>
              <div className="token-value">{issuedToken}</div>
            </div>
          )}
          {!issuedToken && account.token_masked && (
            <div className="token-box">
              <div className="token-label">Token 保持不变</div>
              <div className="token-value">{account.token_masked}</div>
            </div>
          )}
          <div className="success-actions">
            {issuedToken && <button className="checkout-pay-button" onClick={copyToken}>复制 Token</button>}
            <button className="secondary-button" onClick={() => window.location.assign("/account")}>进入账户管理</button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function CheckoutPage() {
  const query = useCheckoutMemo(() => new URLSearchParams(window.location.search), []);
  const checkoutToken = query.get("checkout_token") || "";
  const stripeOrderId = query.get("stripe_order") || "";
  const zpayOrderId = query.get("zpay_order") || "";
  const stripeCancelled = query.get("stripe_cancelled") === "1";
  const [info, setInfo] = useCheckoutState(null);
  const [tier, setTier] = useCheckoutState("standard");
  const [mode, setMode] = useCheckoutState("");
  const [months, setMonths] = useCheckoutState(1);
  const [method, setMethod] = useCheckoutState("stripe_card");
  const [stripeCurrency, setStripeCurrency] = useCheckoutState("CAD");
  const [loading, setLoading] = useCheckoutState(true);
  const [paying, setPaying] = useCheckoutState(false);
  const [error, setError] = useCheckoutState("");
  const [result, setResult] = useCheckoutState(null);
  const [issuedToken, setIssuedToken] = useCheckoutState("");

  useCheckoutEffect(() => {
    const suffix = checkoutToken ? `?checkout_token=${encodeURIComponent(checkoutToken)}` : "";
    checkoutRequest(`/api/payment/checkout-info${suffix}`)
      .then(data => {
        const suggested = selectedBundleParts(data.suggested_bundle_id);
        setInfo(data);
        setTier(suggested.tier);
        setMode(suggested.mode);
        setMonths(suggested.months);
        const preferredMethod = data.payment_methods?.find(item => item.id === "stripe_card" && item.available)
          || data.payment_methods?.find(item => item.available);
        if (preferredMethod) setMethod(preferredMethod.id);
      })
      .catch(requestError => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [checkoutToken]);

  useCheckoutEffect(() => {
    if (!stripeOrderId || stripeCancelled) return;
    const suffix = new URLSearchParams({
      ...(checkoutToken ? { checkout_token: checkoutToken } : {})
    }).toString();
    checkoutRequest(`/api/payment/orders/${encodeURIComponent(stripeOrderId)}${suffix ? `?${suffix}` : ""}`)
      .then(data => {
        if (data.order?.status === "COMPLETED") {
          setError("");
          setResult(data);
          setIssuedToken(data.issued_token || "");
        } else if (data.order?.status === "FAILED") {
          setError(data.order.error || "付款已确认，但自动开通暂时失败。");
        } else {
          setError("Stripe 正在确认付款；确认后账户会自动开通。");
        }
      })
      .catch(requestError => setError(requestError.message));
  }, [stripeOrderId, checkoutToken, stripeCancelled]);

  useCheckoutEffect(() => {
    if (!zpayOrderId) return;
    const suffix = new URLSearchParams({
      ...(checkoutToken ? { checkout_token: checkoutToken } : {})
    }).toString();
    checkoutRequest(`/api/payment/orders/${encodeURIComponent(zpayOrderId)}${suffix ? `?${suffix}` : ""}`)
      .then(data => {
        if (data.order?.status === "COMPLETED") {
          setError("");
          setResult(data);
          setIssuedToken(data.issued_token || "");
        } else if (data.order?.status === "FAILED" || data.order?.status === "MANUAL_REVIEW") {
          setError(data.order.error || "支付宝付款已确认，但自动开通暂时失败。");
        } else {
          setError("支付宝正在确认付款；确认后账户会自动开通。");
        }
      })
      .catch(requestError => setError(requestError.message));
  }, [zpayOrderId, checkoutToken]);

  useCheckoutEffect(() => {
    if (stripeCancelled) setError("信用卡支付已取消，没有产生扣款。");
  }, [stripeCancelled]);

  const plan = useCheckoutMemo(
    () => info?.plans?.find(item => item.id === tier) || null,
    [info, tier]
  );
  const bundleId = [tier, tier === "value" ? (mode || "stocks") : null, `${months}m`]
    .filter(Boolean)
    .join("-");
  const bundle = useCheckoutMemo(
    () => info?.bundles?.find(item => item.id === bundleId) || null,
    [info, bundleId]
  );
  const selectedPaymentMethod = useCheckoutMemo(
    () => info?.payment_methods?.find(item => item.id === method) || null,
    [info, method]
  );
  const stripeMonthlyAmountMinor = useCheckoutMemo(
    () => Number(bundle?.stripe_monthly_prices_minor?.[stripeCurrency] || 0),
    [bundle, stripeCurrency]
  );
  const stripeTotalMinor = stripeMonthlyAmountMinor * months;

  const chooseTier = nextTier => {
    setTier(nextTier);
    if (nextTier === "value") {
      setMode(current => current || "stocks");
    } else {
      setMode("");
    }
  };

  const pay = async () => {
    if (!bundle) return;
    setPaying(true);
    setError("");
    try {
      const created = await checkoutRequest("/api/payment/orders", {
        method: "POST",
        body: JSON.stringify({
          checkout_token: checkoutToken || undefined,
          bundle_id: bundle.id,
          payment_method: method,
          checkout_locale: window.LeandataI18n?.getLanguage?.() === "en" ? "en" : "zh",
          ...(method === "stripe_card" && { stripe_currency: stripeCurrency }),
        }),
      });
      if (created.checkout_url) {
        window.location.assign(created.checkout_url);
        return;
      }
      if (!created.mock_enabled) {
        setError("真实支付商户尚未配置；当前订单已创建，但不能在本地完成扣款。");
        return;
      }
      const completed = await checkoutRequest(`/api/payment/mock/${encodeURIComponent(created.order.id)}/complete`, {
        method: "POST",
        body: JSON.stringify({ resume_token: created.resume_token }),
      });
      setResult(completed);
      setIssuedToken(completed.issued_token || "");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPaying(false);
    }
  };

  const goBack = () => {
    const checkoutKind = info?.kind || result?.order?.kind;
    window.location.assign(checkoutKind === "renewal" ? "/account" : "/register");
  };

  if (loading) {
    return <div className="checkout-loading">正在准备安全结账页…</div>;
  }

  if (!info && !result) {
    return (
      <main className="checkout-shell">
        <button className="checkout-back" onClick={() => window.location.assign("/register")}>
          <CheckoutIcon name="back" /> 配置套餐
        </button>
        <div className="checkout-error" style={{ marginTop: 40 }}>{error || "无法打开结账页。"}</div>
      </main>
    );
  }

  return (
    <main className="checkout-shell">
      <button className="checkout-back" onClick={goBack}>
        <CheckoutIcon name="back" /> 配置套餐
      </button>

      {result ? (
          <CheckoutSuccess info={info} result={result} issuedToken={issuedToken} />
      ) : (
        <div className="checkout-layout">
          <section>
            <h1 className="checkout-section-title">快捷支付</h1>
            <div className="payment-methods">
              {info.payment_methods.map(item => (
                <button
                  type="button"
                  key={item.id}
                  className={`payment-method ${method === item.id ? "selected" : ""} ${!item.available ? "unavailable" : ""}`}
                  onClick={() => item.available && setMethod(item.id)}
                  disabled={!item.available}
                >
                  <PaymentMethodIcon method={item.id} />
                  <span>
                    <span className="payment-method-name">{item.name}</span>
                    <span className="payment-method-note">
                      {item.status || (item.id === "stripe_card" ? "由 Stripe 安全处理卡号与 CVV" : "扫码或 App 内确认")}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            {method === "stripe_card" && (
              <>
                <div className="checkout-separator">卡支付币种</div>
                <div className="currency-grid" aria-label="Stripe 结账币种">
                  {(selectedPaymentMethod?.currencies || []).map(option => (
                    <button
                      type="button"
                      key={option.currency}
                      className={`currency-option ${stripeCurrency === option.currency ? "selected" : ""}`}
                      onClick={() => setStripeCurrency(option.currency)}
                    >
                      <span>{option.currency}</span>
                      <strong>{formatCardMoney(bundle?.stripe_monthly_prices_minor?.[option.currency], option.currency)} / 月</strong>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="checkout-separator">套餐设置</div>

            <label className="checkout-field-label" htmlFor="plan">套餐</label>
            <div className="checkout-select-wrap">
              <select id="plan" className="checkout-select" value={tier} onChange={event => chooseTier(event.target.value)}>
                {info.plans.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} — {item.summary}
                  </option>
                ))}
              </select>
              <CheckoutIcon name="chevron" />
            </div>

            {tier === "value" && (
              <div className="mode-grid" aria-label="Value 数据方向">
                <button className={`mode-option ${mode === "stocks" ? "selected" : ""}`} onClick={() => setMode("stocks")}>股票方向</button>
                <button className={`mode-option ${mode === "options" ? "selected" : ""}`} onClick={() => setMode("options")}>期权方向</button>
              </div>
            )}

            <div className="duration-grid" aria-label="套餐时长">
              {(plan?.duration_months || []).map(option => (
                <button
                  type="button"
                  key={option}
                  className={`duration-option ${months === option ? "selected" : ""}`}
                  onClick={() => setMonths(option)}
                >
                  {option} 个月
                </button>
              ))}
            </div>

            <div className="checkout-identity">
              <div className="identity-row">
                <span>{info.kind === "registration" ? "注册账户" : "续费账户"}</span>
                <span>{info.identity.user_id}</span>
              </div>
              {info.identity.email && (
                <div className="identity-row">
                  <span>邮箱</span>
                  <span>{info.identity.email}</span>
                </div>
              )}
              {info.identity.current_expiry && (
                <div className="identity-row">
                  <span>当前有效期</span>
                  <span>{formatCheckoutDate(info.identity.current_expiry)}</span>
                </div>
              )}
            </div>

            <div className="activation-note">
              <CheckoutIcon name="shield" />
              <span>支付成功后自动{info.kind === "registration" ? "创建账户并签发 Token" : "保留原 Token 并延长有效期"}，无需管理员批准。</span>
            </div>
          </section>

          <aside className="checkout-summary">
            <div className="summary-card">
              <h2 className="summary-title">{bundle?.name || plan?.name} 套餐</h2>
              <div className="summary-kicker">包含功能</div>
              <ul className="summary-features">
                {(bundle?.features || plan?.features || []).map((feature, index) => (
                  <li className="summary-feature" key={feature}>
                    <CheckoutIcon name={["bolt", "link", "layers", "shield"][index % 4]} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="summary-divider"></div>
              <div className="price-row">
                <span>人民币套餐月价</span>
                <span>{formatCny(bundle?.monthly_amount_cny_fen)}</span>
              </div>
              {method === "stripe_card" && (
                <div className="price-row">
                  <span>Stripe 卡支付月价</span>
                  <span>{formatCardMoney(stripeMonthlyAmountMinor, stripeCurrency)} {stripeCurrency}</span>
                </div>
              )}
              <div className="price-row">
                <span>订阅时长</span>
                <span>{months} 个月</span>
              </div>
              <div className="price-row total">
                <span>今日应付金额</span>
                <span>
                  {method === "stripe_card"
                    ? `${formatCardMoney(stripeTotalMinor, stripeCurrency)} ${stripeCurrency}`
                    : formatCny(bundle?.amount_cny_fen)}
                </span>
              </div>
              <button
                className="checkout-pay-button"
                disabled={paying || !bundle || !selectedPaymentMethod?.available}
                onClick={pay}
              >
                {paying
                  ? "正在确认支付…"
                  : method === "stripe_card"
                    ? `使用信用卡支付 ${formatCardMoney(stripeTotalMinor, stripeCurrency)} ${stripeCurrency}`
                    : `${method === "alipay" ? "支付宝" : "微信支付"}${method === "alipay" ? "支付 " : " "}${formatCny(bundle?.amount_cny_fen)}`}
              </button>
              {error && <div className="checkout-error">{error}</div>}
            </div>
            <p className="checkout-terms">
              支付宝由 Z-Pay 跳转处理，卡号、有效期和 CVV 直接提交给 Stripe；Leandata 不读取或保存支付凭据。平台验签回调确认后自动开通；重复回调不会重复延长有效期。
            </p>
          </aside>
        </div>
      )}
      <ComplianceFooter />
    </main>
  );
}

window.CheckoutPage = CheckoutPage;
