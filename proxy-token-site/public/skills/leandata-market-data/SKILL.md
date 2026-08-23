---
name: leandata-market-data
description: Fetch market data from the public Leandata REST API and diagnose HTTP/API errors. Use when an agent needs to construct or validate historical market-data requests, paginate or split large date ranges, retrieve stock or option bars, interpret empty results, or respond to 400, 401, 403, 404, 429, 500, 502, 503, or 504 responses.
---

# Leandata Market Data

Use only the public API contract. Do not infer or explain private infrastructure, vendors, routing, caches, or implementation details.

## Free plan quota and boundaries

When operating under a Free plan token (`role: free`):

1. **REST Historical Window:** Historical REST requests (`/v2/stocks/bars`, `/v1/history/bars`, `/v1/indices/history`, `/v1/options/eod`) **must include explicit `start` and `end` bounds within the most recent 31 calendar days**. Dates older than 31 days or requests with missing bounds fail with `403 free_historical_window_exceeded` or `403 free_historical_date_range_required`.
2. **Option Chains and Snapshots:** Contract discovery (`/v1/options/contracts`) and option Greeks snapshots (`/v1/options/snapshots/expiry`, `/v1/options/snapshots/{underlying}`) are limited to the **nearest 2 upcoming expiration cycles** (e.g. 0DTE and nearest weekly/monthly expiries). Requesting further-out expirations fails with `403 free_option_chain_window_exceeded`.
3. **Financial Fundamentals:** Corporate financial statements (Income Statement, Balance Sheet, Cash Flow) require an active **Premium** subscription and fail with `403 fmp_premium_required`.
4. **Upgrade Guidance:** When encountering `403 free_*_exceeded`, guide the user to upgrade their plan at `https://leandata.uk/account.html`.

## Request workflow

1. Use `https://api.leandata.uk` for historical REST requests.
2. Send the token as `Authorization: Bearer <TOKEN>`. Never print, log, or repeat the real token.
3. Read the endpoint parameter table before calling it. Do not guess field names.
4. Always send both `start` and `end` when the endpoint documents them as required.
5. Use ISO dates (`YYYY-MM-DD`) unless the endpoint explicitly requires another format.
6. Start with one symbol and a short date interval. Expand only after that request succeeds.
7. Keep at most three historical requests in flight. On `429`, honor `Retry-After` when present; otherwise use exponential backoff with jitter.
8. Follow `next_page_token` until it is null. Preserve the original request parameters on every page.
9. Validate the HTTP status, JSON shape, requested symbol keys, timestamps, row count, and pagination state before claiming success.

## Common requests

Stock bars:

```bash
curl -X POST https://api.leandata.uk/v1/history/bars \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL","timeframe":"1Day","start":"2024-01-02","end":"2024-01-05"}'
```

Option minute bars:

```bash
curl -X POST https://api.leandata.uk/v1/history/options/bars \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"symbols":"AAPL260620C00200000","timeframe":"1Min","start":"2023-04-01","end":"2023-06-30"}'
```

For option bars:

- Supply exact OCC symbols; do not invent a contract from a ticker, strike, or expiry.
- OCC format is `<ROOT><YYMMDD><C|P><8-digit strike>`. The strike is dollars × 1000, zero-padded to eight digits.
- Output is canonical `1Min`. Resample client-side for wider bars.
- Long date ranges are accepted by the public endpoint. If a client-side timeout occurs, retry as sequential monthly windows without overlap.
- An empty symbol array is a valid no-data result only when the response is HTTP `200`, the JSON shape is valid, and pagination is complete.

## Error analysis

Capture the HTTP status, response JSON, request ID header/body field, endpoint, sanitized parameters, and UTC timestamp. Never include the token.

| Status | Meaning | Action |
|---|---|---|
| `400` | Invalid request | Read `error`/`message`; check required fields, date order/format, timeframe, JSON, and symbol format. Do not retry unchanged. |
| `401` | Missing or invalid authentication | Confirm the Bearer header is present and the token has no extra quotes or whitespace. Do not expose it. |
| `403` | Permission or request-policy rejection | Check error code: `free_historical_window_exceeded` (needs <=31 days bounds), `free_option_chain_window_exceeded` (needs nearest 2 expiries), `fmp_premium_required` (needs Premium plan). Read the error body and account usage endpoint; guide user to upgrade at `https://leandata.uk/account.html`. |
| `404` | Route or resource not found | Verify the exact documented path. A missing result is not proof that the symbol never existed. |
| `408` | Request timeout | Retry a smaller date window with exponential backoff. |
| `429` | Invalid-token abuse protection, concurrency, or rate limit | If `error` is `invalid_token_rate_limited` or `invalid_token_temporarily_blocked`, stop retrying the unchanged credential, honor `Retry-After`, and obtain/verify a token first. For other `429` responses, stop parallel calls and retry with exponential backoff and jitter. |
| `500` | Server error | Retry once after backoff; if repeated, record the request ID and report it. |
| `502` | Temporary data-path failure | Retry a small known-valid request. If that works, reduce the original request and retry sequentially. Report repeated failures with request IDs. |
| `503` | Service temporarily unavailable or overloaded | Do not change symbols or fabricate alternate parameters. Back off, retry a small health/known-valid request, then retry the original request later. |
| `504` | Gateway timeout | Reduce the date/symbol batch, retry sequentially, and report repeated request IDs. |

## Retry policy

- Retry only `408`, `429`, `500`, `502`, `503`, and `504` automatically.
- Use delays such as 1s, 2s, 4s, 8s plus random jitter, capped at five attempts.
- Retry `400`, `401`, `403`, or route-level `404` only after correcting the request or credentials.
- Never automatically retry an unchanged token after `invalid_token_rate_limited` or `invalid_token_temporarily_blocked`.
- Never silently switch endpoints, symbol formats, dates, or granularities to make a request appear successful.

## Report results

State the endpoint, sanitized parameters, status, row count per symbol, earliest/latest timestamp, pagination completion, and any warnings. Distinguish:

- successful data (`200` with rows),
- successful no-data (`200` with a valid empty result),
- client/request error (`4xx`), and
- temporary service failure (`5xx`).

Never describe a `5xx` as “no historical data” without a later successful request proving an empty result.
