# Leandata payment setup

## Card data boundary

Leandata must never receive or persist a card number, expiry, CVC/CVV, PIN, or
magnetic-stripe data. Card entry is hosted by Stripe Checkout. Leandata stores
only Stripe identifiers and the existing server-authoritative bundle/order
snapshot.

## Stripe test-mode setup

1. Create or activate a Canadian Stripe account.
2. Copy `payment.env.example` to the host-only
   `data/stripe-payment.env` file and set mode `0600`. In the AWS deployment
   this is `/srv/leandata/proxy-token-site/data/stripe-payment.env`; the
   container reads it at `/app/data/stripe-payment.env`.
3. Add a Stripe restricted or secret test key as `STRIPE_SECRET_KEY`.
4. Register this endpoint in Stripe test mode:

   `https://leandata.uk/api/payment/stripe/webhook`

5. Subscribe to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.expired`
6. Store the endpoint signing secret as `STRIPE_WEBHOOK_SECRET`.

Stripe card Checkout supports CAD and USD only. Pricing is USD-anchored:
the USD monthly amounts (`STRIPE_MONTHLY_PRICES_USD_MINOR` in `server.js`)
are the single source of truth and USD orders charge them directly. CAD orders
are converted dynamically as `round(USD * live USD→CAD rate)` at order-creation
time; the rate is fetched from a free FX source (`open.er-api.com`), cached
for 12 hours (`FX_CACHE_TTL_MS`), and falls back to the last-known-good rate
or `USD_CAD_FALLBACK_RATE` (default 1.2) when the fetch fails. Pin a rate with
`USD_CAD_RATE_OVERRIDE` for tests or incident freezes. The current rate is
exposed at `GET /api/payment/fx` (no-store) and echoed per bundle as
`fx_usd_cad` in `checkout-info`. The RMB plan catalogue is separate from the
Stripe charge currency and is never derived from FX.

Until EasyPay approves the merchant, keep
`PAYMENT_ALIPAY_ENABLED=false`. The checkout continues to display Alipay as an
unavailable preview tile but the backend rejects Alipay order creation. Change
the flag to `true` only after the production EasyPay endpoint and signature
verification are ready.
7. Keep `PAYMENT_MOCK_ENABLED=false` outside isolated local preview sessions.

For localhost testing, keep the server on a test key and forward signed sandbox
events with Stripe CLI:

```bash
stripe listen \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.expired \
  --forward-to http://127.0.0.1:3317/api/payment/stripe/webhook
```

Use the `whsec_...` value printed by that listener as the local
`STRIPE_WEBHOOK_SECRET`. The listener secret is for the local CLI session; the
production webhook endpoint has a separate signing secret in Stripe Dashboard.

The Checkout Session charges the selected bundle once. It does not save the
card for later off-session use. A future recurring or saved-card feature must
use Stripe Billing or Setup Intents with explicit customer consent.

## Go-live acceptance

- Test successful, declined, 3DS/authentication, cancellation, and expired
  Checkout Sessions.
- Prove the webhook signature rejects altered payloads.
- Prove duplicate webhooks do not extend an account twice.
- Prove the amount, currency, bundle ID, account identity, and local order
  match before fulfillment.
- Keep Stripe keys out of Git, logs, browser JavaScript, and screenshots.
