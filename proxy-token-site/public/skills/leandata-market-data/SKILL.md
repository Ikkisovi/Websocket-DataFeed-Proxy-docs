---
name: leandata-market-data
description: Query the public Leandata market-data API, follow pagination, and diagnose request errors.
---

# Leandata Market Data

Use the documented public API contract. Do not infer or describe private infrastructure, data suppliers, routing, caches, or implementation details.

## Plan access

- Free historical REST requests to `/v2/stocks/bars`, `/v1/history/bars`, `/v1/indices/history`, and `/v1/options/eod` require explicit `start` and `end` bounds within the most recent 31 calendar days.
- Free option-contract discovery and snapshots cover the nearest two upcoming expiration cycles.
- Financial statements (income statement, balance sheet, and cash flow) require Premium.
- Cash-index minute and daily endpoints require a paid plan. Minute data covers SPX, NDX, VIX, DJI, VIX3M, VIX6M, RUT, DXY, TNX, VVIX, SKEW, and VXN; the daily endpoint covers SPX, NDX, VIX, and DJI. The separate `/v1/indices/history` route covers SPX, VIX, and VIX3M.
- For access errors, check the response and current endpoint documentation. Direct account-plan changes to `https://leandata.uk/account.html`.

## Request workflow

1. Use `https://api.leandata.uk` for historical REST requests.
2. Send the token as `Authorization: Bearer <TOKEN>`. Never print, log, or repeat the real token.
3. Read the endpoint documentation and use its exact parameter names and formats.
4. Include required `start` and `end` bounds. Use ISO dates unless the endpoint says otherwise.
5. Start with one symbol and a short interval; expand after a valid response.
6. Keep request batches small; follow the retry guidance below for transient errors.
7. Follow `next_page_token` until it is null and preserve the original parameters on every page.
8. Before reporting success, validate the HTTP status, JSON shape, requested symbols, timestamps, row count, and pagination state.

## Common requests

Stock bars (replace the dates with a range allowed by the account plan):

```bash
curl -X POST https://api.leandata.uk/v1/history/bars \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL","timeframe":"1Day","start":"2026-09-21","end":"2026-09-23"}'
```

Option minute bars:

```bash
curl -X POST https://api.leandata.uk/v1/history/options/bars \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"symbols":"AAPL260620C00200000","timeframe":"1Min","start":"2023-04-01","end":"2023-06-30"}'
```

Cash-index minute bars (paid plan):

```bash
curl "https://api.leandata.uk/v1/indices/minute?symbol=SPX&start=2026-09-15&end=2026-09-17&limit=3" \
  -H "Authorization: Bearer <TOKEN>"
```

Cash-index daily bars (paid plan):

```bash
curl "https://api.leandata.uk/v1/indices/daily?symbol=VIX&start=2026-09-15&end=2026-09-17" \
  -H "Authorization: Bearer <TOKEN>"
```

## Endpoint notes

- Cash-index `start` and `end` are inclusive UTC calendar days. The maximum `limit` is 10,000; check `truncated` before treating a response as complete. Unfiltered cross-section requests are limited to seven inclusive calendar days.
- Daily cash-index bars support only SPX, NDX, VIX, and DJI. The other eight symbols are minute-only; resample them client-side when daily bars are needed. Responses do not include volume, and sparse sessions may contain fewer bars.
- Supply exact OCC symbols for option bars; do not infer a contract from a ticker, strike, or expiry. The format is `<ROOT><YYMMDD><C|P><8-digit strike>`, with strike in dollars multiplied by 1,000 and zero-padded.
- Option bars use `1Min`; resample client-side for wider intervals. If a request times out, retry smaller sequential date windows without overlap.
- Treat an empty result as no data only when the response is HTTP `200`, the JSON is valid, and pagination is complete.

## Error handling

Record the HTTP status, response body, request ID, endpoint, sanitized parameters, and UTC timestamp. Never include the token.

| Status | Action |
|---|---|
| `400` | Check required fields, date order and format, timeframe, JSON, and symbol format. Correct the request before retrying. |
| `401` | Check that the Bearer header is present and the token has no extra whitespace or quotes. Never expose it. |
| `403` | Check plan access, date bounds, and the response body; see Plan access above. |
| `404` | Verify the documented route. A missing result alone does not prove that a symbol never existed. |
| `408`, `429`, `500`, `502`, `503`, `504` | Treat as transient or throttled responses. Honor `Retry-After`; reduce request size for timeouts. If the response points to a credential issue, stop retrying the unchanged token and verify it. Otherwise retry at most five times with bounded backoff and jitter. |

Do not retry `400`, `401`, `403`, or `404` without first correcting the request or access issue. Never silently switch endpoints, symbols, dates, or intervals to make a request appear successful.

## Report results

Report the endpoint, sanitized parameters, status, row count per symbol, earliest/latest timestamp, pagination completion, and warnings. Distinguish results with rows, valid empty results, client/request errors (`4xx`), and temporary service errors (`5xx`). Do not describe a `5xx` as “no historical data” without a later successful request proving an empty result.
