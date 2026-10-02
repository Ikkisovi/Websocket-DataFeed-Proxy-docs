const express = require('express');
const request = require('supertest');
const { createChartHistoryHandler, historyRequest } = require('./shared/chart-proxy.cjs');
const valid = { asset: 'stock', symbol: 'NVDA', timeframe: '15Min', start: '2026-10-01T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z' };
const row = { t: '2026-10-01T14:00:00Z', o: 100, h: 102, l: 99, c: 101, v: 12 };
const testToken = 'synthetic-chart-test-only';
function appFor(fetcher) {
  const app = express();
  app.get('/api/chart/bars', createChartHistoryHandler(fetcher));
  return app;
}
test('requests stay on fixed routes and raw SIP prices; rejects injected targets, invalid scope and oversized cursor', () => {
  const url = historyRequest(valid, Date.parse(valid.end));
  expect(url.origin).toBe('https://api.leandata.uk');
  expect(url.searchParams.get('adjustment')).toBe('raw');
  expect(url.searchParams.get('sort')).toBe('desc');
  expect(historyRequest({ ...valid, asset: 'https://other.test' })).toBeNull();
  expect(historyRequest({ ...valid, symbol: '*' })).toBeNull();
  expect(historyRequest({ ...valid, symbol: ['NVDA', 'AAPL'] })).toBeNull();
  expect(historyRequest({ ...valid, timeframe: '1Sec' })).toBeNull();
  expect(historyRequest({ ...valid, start: '2020-01-01T00:00:00Z' })).toBeNull();
  expect(historyRequest({ ...valid, page_token: 'x'.repeat(4097) })).toBeNull();
  expect(historyRequest({ ...valid, asset: 'crypto', symbol: 'BTC/USD' }).pathname).toBe('/v1beta3/crypto/us/bars');
});
test('missing auth and bad requests never reach upstream', async () => {
  const fetcher = jest.fn();
  const app = appFor(fetcher);
  expect((await request(app).get('/api/chart/bars').query(valid)).status).toBe(401);
  expect((await request(app).get('/api/chart/bars').query({ ...valid, symbol: '*' }).set('Authorization', `Bearer ${testToken}`)).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});
test('forwards auth only to LeanData, publishes safe fields and no-store, never redirects', async () => {
  const fetcher = jest.fn(async () => new Response(JSON.stringify({ bars: { NVDA: [{ ...row, private_debug: testToken }] }, next_page_token: 'page-2', secret: testToken })));
  const result = await request(appFor(fetcher)).get('/api/chart/bars').query(valid).set('Authorization', `Bearer ${testToken}`);
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ bars: [row], next_page_token: 'page-2' });
  expect(result.headers['cache-control']).toBe('no-store');
  expect(JSON.stringify(result.body)).not.toContain(testToken);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { Authorization: `Bearer ${testToken}` } });
});
test('preserves auth/permission/rate-limit status without leaking vendor errors', async () => {
  for (const status of [401, 403, 429, 501, 503]) {
    const response = new Response(testToken, { status, headers: { 'Retry-After': '45' } });
    const result = await request(appFor(async () => response)).get('/api/chart/bars').query(valid).set('Authorization', `Bearer ${testToken}`);
    expect(result.status).toBe(status);
    expect(result.body).toEqual({ code: `history_http_${status}` });
    expect(result.headers['retry-after']).toBe('45');
  }
});
test('fails closed on invalid shape and oversized responses', async () => {
  for (const response of [new Response('{}'), new Response('[]', { headers: { 'content-length': '3000000' } }), new Response('x'.repeat(2100000))]) {
    const result = await request(appFor(async () => response)).get('/api/chart/bars').query(valid).set('Authorization', `Bearer ${testToken}`);
    expect(result.status).toBe(502);
    expect(result.body).toEqual({ code: 'history_unavailable' });
  }
});
test('caps concurrent upstream requests and admits requests after completion', async () => {
  const releases = [];
  const app = appFor(() => new Promise(resolve => releases.push(() => resolve(new Response(JSON.stringify({ bars: { NVDA: [row] } }))))));
  const pending = Array.from({ length: 4 }, () => request(app).get('/api/chart/bars').query(valid).set('Authorization', `Bearer ${testToken}`).then(r => r));
  while (releases.length < 4) await new Promise(resolve => setImmediate(resolve));
  const blocked = await request(app).get('/api/chart/bars').query(valid).set('Authorization', `Bearer ${testToken}`);
  expect(blocked.status).toBe(429);
  expect(blocked.body.code).toBe('chart_busy');
  releases.forEach(release => release());
  expect((await Promise.all(pending)).every(r => r.status === 200)).toBe(true);
});
