---
name: leandata-market-data
description: Query the public Leandata market-data API, follow pagination, and diagnose request errors.
---

# Leandata Market Data

Use the documented public API contract. Explain documented access, delivery and data-timestamp semantics. Do not infer private hosts, routing, storage or implementation details.

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
7. Follow the route-specific pagination marker and preserve selectors. Market routes use `next_page_token`; EODHD history uses `truncated` and `next_offset`.
8. Before reporting success, validate the HTTP status, JSON shape, requested symbols, timestamps, row count, and pagination state.

## Common requests

Stock bars (replace the dates with a range allowed by the account plan):

```bash
curl -X POST https://api.leandata.uk/v1/history/bars \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL","timeframe":"1Day","start":"2026-09-21","end":"2026-09-23"}'
```

Option minute bars (historical example; requires a plan covering these dates):

```bash
curl -X POST https://api.leandata.uk/v1/history/options/bars \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"symbols":"AAPL250117C00200000","timeframe":"1Min","start":"2025-01-02","end":"2025-01-03"}'
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

## Delivery and OI

- Ordinary GET/POST calls return data on the original API request. Disable automatic redirects in security-sensitive integrations; optional signed delivery requires explicit `direct=1`.
- Only `https://archive-direct.leandata.uk` is an authorized signed delivery origin. For POST→303 use GET without the original body; GET→307 remains GET. Fetch the complete signed URL with a separate client that sends no Bearer token, cookies or original credentials. Never log the signed URL.
- Initial API requests are metered normally; signed downloads are not counted as another public API request. Separate bulk-export orders retain explicit pricing.
- For OI use `/v3/option/snapshot/open_interest` with exact symbol/expiration/strike/right, or `/v1/options/open_interest` for bounded history. Discover current contracts before asking for current snapshots.
- `/v1/options/snapshots/open_interest` is not an implemented OI interface. Do not accept a general snapshot as OI data.
- OI source timestamps identify the report time (normally around 06:30 New York time), representing the previous trading session's close. Preserve report time, effective trading date and retrieval time separately. Check freshness; missing records are not zero.
- Future earnings dates use EODHD event routes; financial statement data uses Morningstar. The compatibility `/stable/earnings-calendar` and `/stable/dividends-calendar` endpoints remain unavailable (501); use the documented EODHD routes.
- Premium covers documented available endpoints, not every upstream interface; CN remains a separate plan.

## FMP snapshots

FMP `/stable/*` endpoints serve a fixed snapshot and do not update automatically.
New company reports, restatements, quotes, ratings and analyst estimates are not
automatically added. Use Morningstar for updated financial statement data and
EODHD for upcoming earnings dates. The expected daily 06:00 Pacific update
schedule does not apply to FMP snapshots.

## Daily financial updates

EODHD future earnings dates and Morningstar financial statement data are both
expected to start updating daily at **06:00 Pacific time**
(`America/Los_Angeles`, following PST/PDT daylight-saving changes). This is the
expected collection/update start, not a guaranteed completion time. Read each
route's matching coverage for the latest published snapshot. EODHD provides
upcoming report dates; Morningstar provides financial statement and fundamental
values. Frozen legacy Morningstar routes keep their documented archive boundary.

## EODHD events

Premium exposes GET/POST `/v1/events/eodhd/coverage` and
`/v1/events/eodhd/history` for `dataset=earnings` (default), `dividends` or
`splits`. Use the existing LeanData token; no upstream key is needed. Read
`https://leandata.uk/docs/financial/eodhd/` for the complete contract.

1. Inspect coverage for the selected dataset. Its `count` counts manifests;
   `data[].rows` counts captured records. Empty datasets can have null date bounds.
2. Choose an observed snapshot date. Default history selects its latest capture; pin the returned `snapshot` for history pagination, or use an exact `bundle`.
3. Send explicit inclusive `start`/`end` snapshot dates, not event dates.
   `start_date`/`end_date` are not supported aliases. `symbols` (alias `symbol`)
   permits up to 100 comma-separated tickers. Without symbols, use at most
   seven inclusive calendar days. `fields` projection is rejected.
4. History uses positive `limit` capped at 500 and `offset` 0..100000. Follow
   returned `next_offset` only while `truncated=true`, keeping every other
   selector fixed. Narrow scope before reaching the offset ceiling.
5. Coverage uses only dataset and optional bundle. History dates, symbols,
   limit, offset and fields do not filter coverage; coverage is not paginated.
6. Preserve `(bundle,row_id)`, native `payload`, nulls and
   original numeric bytes. Snapshot dates, earnings `report_date`/`report_time`,
   dividend `dividend_date`/`payment_date` and vendor publication time are
   distinct. Do not silently collapse revised observations.

```bash
curl --get "https://api.leandata.uk/v1/events/eodhd/coverage" \
  -H "Authorization: Bearer $LEANDATA_TOKEN" --data-urlencode dataset=earnings

# Set EODHD_BUNDLE and SNAPSHOT_DATE from coverage first.
curl --get "https://api.leandata.uk/v1/events/eodhd/history" \
  -H "Authorization: Bearer $LEANDATA_TOKEN" \
  --data-urlencode dataset=earnings --data-urlencode "bundle=$EODHD_BUNDLE" \
  --data-urlencode "start=$SNAPSHOT_DATE" --data-urlencode "end=$SNAPSHOT_DATE" \
  --data-urlencode limit=100 --data-urlencode offset=0
```

Use same-origin delivery by default. Cache-only and upstream-only controls are
unsupported. Optional direct delivery follows the credential-free signed GET
rules above. Use the latest EODHD earnings snapshot for future report dates; filter
`payload.report_date` for upcoming events. Financial statement data is updated
through Morningstar routes. Future dates may be revised in later snapshots. Empty splits do not prove no upstream events. Coverage reports captured dates
and records, not completion of all upstream event announcements.

## Endpoint notes

- Cash-index `start` and `end` are inclusive UTC calendar days. The maximum `limit` is 10,000; check `truncated` before treating a response as complete. Unfiltered cross-section requests are limited to seven inclusive calendar days.
- Daily cash-index bars support only SPX, NDX, VIX, and DJI. The other eight symbols are minute-only; resample them client-side when daily bars are needed. Responses do not include volume, and sparse sessions may contain fewer bars.
- Supply exact OCC symbols for option bars; do not infer a contract from a ticker, strike, or expiry. The format is `<ROOT><YYMMDD><C|P><8-digit strike>`, with strike in dollars multiplied by 1,000 and zero-padded.
- Option bars use `1Min`; resample client-side for wider intervals. If a request times out, retry smaller sequential date windows without overlap.
- A valid empty HTTP `200` after complete pagination means no records in the requested slice, not complete upstream coverage or no events in the market.

## Error handling

Record the HTTP status, response body, request ID, endpoint, sanitized parameters, and UTC timestamp. Never include the token.

| Status | Action |
|---|---|
| `400` | Check required fields, date order and format, timeframe, JSON, and symbol format. Correct the request before retrying. |
| `401` | Check that the Bearer header is present and the token has no extra whitespace or quotes. Never expose it. |
| `403` | Check plan access, date bounds, and the response body; see Plan access above. |
| `404` | Verify the documented route. A missing result alone does not prove that a symbol never existed. |
| `422`, `501` | Correct the oversized request or use an available documented endpoint. Do not retry unchanged. |
| `408`, `429`, `500`, `502`, `503`, `504` | Treat as transient or throttled responses. Honor `Retry-After`; reduce request size for timeouts. If the response points to a credential issue, stop retrying the unchanged token and verify it. Otherwise retry at most five times with bounded backoff and jitter. |

Do not retry `400`, `401`, `403`, or `404` without first correcting the request or access issue. Never silently switch endpoints, symbols, dates, or intervals to make a request appear successful.

## Report results

Report the endpoint, sanitized parameters, status, row count per symbol, earliest/latest timestamp, pagination completion, and warnings. Distinguish results with rows, valid empty results, client/request errors (`4xx`), and temporary service errors (`5xx`). Do not describe a `5xx` as “no historical data” without a later successful request proving an empty result.

## Machine-readable public contract

Read `https://api.leandata.uk/v1/api/contract` for the reviewed OI, financial
archive and shared delivery contract. The documentation copy is at
`https://leandata.uk/docs/public-api-contract.json`. Compare its SHA256 with
`X-Leandata-Contract-SHA256`; catalog absence is not an unavailable verdict.
Prefer `X-Leandata-Data-Tier` for logical serving tiers. Legacy `X-Cache-Tier`
remains compatible. Neither field certifies freshness or coverage. Preserve
route-specific payload schemas and source clocks when using older paths.

## Daily financial history

Use `/v1/fundamentals/morningstar/daily/history` for one source-labelled daily
series over the fixed historical archive and recent committed native captures.
The matching `/daily/coverage` accepts a date window (at most 366 elapsed days)
and optional symbols or QC SIDs. It reports source date counts, unobserved
weekdays (including possible holidays), latest-native-day missing counts and
unresolved symbols. Unknown expected stock coverage stays null.

Daily history accepts canonical v3 field names and always returns `values` as
an object of JSON numbers or null. Use QC SID for stable identity; observed
aliases are resolved through the fixed reference map, and ambiguous names must
be queried by SID. Native rows replace historical rows as whole records; no
fields are filled from another feed. Each row retains source identity, original
clocks and status. Existing raw `/native` and `/v3` archives remain separate.

EODHD history defaults to the latest committed batch for each capture date,
including empty captures. Use `versions=all` to inspect preserved versions or an
exact `bundle` for its original capture. For unpinned EODHD or daily-history
pagination, save the first response `snapshot` and reuse it with `next_offset`
as `offset`, keeping the date/identity/field/version filters unchanged. The
selection is immutable even if a late backfill arrives. Narrow the window if
more than 128 source bundles would be needed. Coverage `daily_coverage` separates
`latest_capture_date` and `latest_nonempty_date`; empty is not no-events proof.


## Contract reference and dividend field limits

`/v1/options/contracts` and native `/v2/options/contracts` use Alpaca only.
Other provider selectors fail with 400. List requests accept
`show_deliverables=true`, adjusted `root_symbol`, and `page_token` with unchanged
filters (Free pagination remains unavailable). Exact lookup uses `symbol_or_id`
on v1 or `/v1/options/contracts/{symbol_or_id}` / its native v2 alias.
No historical reference as-of selector is available. Theta
`/v3/option/list/contracts/{quote,trade}` lists dated activity and supplies no
adjusted status, deliverables or settlement terms. Never synthesize these fields
or mix providers to imply a complete contract master.

Alpaca deliverables can be missing or stale. Equity amount is shares per contract;
cash amount is in the indicated currency. multiplier=100 does not certify
standard/unadjusted status. delayed_settlement is about settlement delay, not
feed freshness; an unknown delayed amount may be zero. OI and close prices have
separate date fields. Use [Alpaca reference](https://docs.alpaca.markets/us/reference/get-options-contracts)
and [OCC notices](https://infomemo.theocc.com/infomemo/search-memo) for definitions
and corporate-action checks.

EODHD Upcoming earnings/dividends focus roughly seven days ahead. These captures
are not a complete all-announced future calendar or a change-only feed. In
`dataset=dividends`, report_date is the shareholder record date in the source
schema, not the earnings date. dividend is per share; currency, source_updated_at
and explicit confirmed/cancelled state are not supplied by this capture. Do not
infer missing values or carry past observations into a certified current calendar.
Pagination exhaustion and a committed bundle do not prove stock-event completeness.
