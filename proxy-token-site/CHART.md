# LeanData Chart

A read-only chart workspace at `/chart/`, integrated into the existing token
portal. Built with TradingView Lightweight Charts 5.2.1, React 18 and the existing
public-asset build. No remote chart scripts, order execution, or provider keys.

The workspace reuses the GPU Rental Index's `tokens.css`, `gpu-index.css`, fonts,
topbar, serif hero and left-hand watchlist cards. Drawing tools are hidden until
requested, and quote details are collapsed.
Chart exports are in a small menu. No additional chart/UI framework was added.

## Run and verify

```sh
cd /home/ikkipipi/leandata-research-data/proxy-token-site
npm run test:chart
node scripts/preview-chart.cjs
```

The isolated preview is at `http://127.0.0.1:18785/chart/`. Set
`CHART_PREVIEW_HOST` to the workstation's current Tailscale IP to serve an
additional tailnet listener. This preview loads no portal account store or
registry and runs no portal background jobs. Use an existing Token in the
connection dialog. The deployed portal also supports its existing authenticated
`/api/account/token` flow. Credentials stay in page memory and never enter URLs,
browser storage, exported files, or application logs. Only watchlists persist.

## Data behavior

- Default mode is explicitly labelled **DEMO** with deterministic synthetic
  prices and no network requests. Connecting clears the demo series. Failures
  never substitute demo prices.
- Stocks: historical raw SIP OHLCV through `/v2/stocks/bars`; live trades and
  quotes through `wss://leandata.uk/stream`. Supported chart intervals are
  1 minute, 5 minutes, 15 minutes, 1 hour and 1 day.
- The current gateway subscribes trades and quotes, not minute bars. Formal
  candles are fetched serially from REST every 30 seconds, replacing overlapping
  bars to incorporate revisions. A separate blue price line shows the latest
  WS trade. Tick-derived partial candles are not manufactured.
- Pagination loads the most recent data first, with up to six 1,000-bar pages.
  Larger requests display an incomplete-window notice. Daily queries are
  bounded to 366 days; intraday queries to 31 days. Empty sessions remain empty.
- WS connects, authenticates, then subscribes. Reconnects use bounded backoff,
  reauthenticate and resubscribe, and refresh REST to repair gaps. Authentication
  or permission errors stop automatic retries. Event timestamps drive freshness
  labels, not connection state. At most five symbols / ten subjects are active.
- Crypto adapters use `/v1beta3/crypto/us/bars` and `/stream/crypto`. The current
  public historical route returns **501** and the smoke-test account's WS
  subscription returns **403**. These are explicit unavailable/permission states;
  crypto live acceptance is not established. No backend route or entitlement was
  changed to enable them.
- All chart timestamps are UTC. Indicators are chart-window SMA 20/50, without
  implicit prior history. Prices are unadjusted, and displayed change is within
  the current bar rather than a daily return.

The fixed-destination `/api/chart/bars` portal bridge works around the public
REST browser OPTIONS response (405). It forwards the caller's Bearer token
only to LeanData, rejects redirects and arbitrary routes, caps concurrency at
four, enforces a 20-second timeout and a 2 MiB response limit, sanitizes vendor
errors and sets `Cache-Control: no-store`.

## Validation and release state

Local build, 286 portal/bridge tests, data-adapter tests and production-bundle
interaction tests pass. UI tests stub Canvas and do
not prove visual acceptance. Separate Chromium screenshots check the shared
design and desktop/mobile rendering.

Bounded live smoke on 2026-10-02: a one-hour SPY historical query returned
HTTP 200 and five valid bars; WS authenticated, acknowledged the subscription
and delivered a valid binary trade/quote frame. Native Node 26's experimental
HTTP/2 WebSocket transport failed; the standard HTTP/1 WebSocket client passed.

A site release includes `server.js`, chart public files, `chart-page.js`, the
bundled `chart-proxy.cjs`, dependency notices and site navigation together.
`ops/deploy_chart_site.py` applies a hash-bound overlay, preserves other public
assets and recreates only the UI using its existing Compose configuration.
The release receipt records host/container verification separately from public
acceptance. A static-only docs overlay is insufficient for the new server route.

Chart attribution and dependency notices are available in the footer and
`/vendor/chart-licenses.txt`, as required by
[TradingView's documentation](https://tradingview.github.io/lightweight-charts/docs).
