import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

// Exercise the actual production bundle. Canvas drawing is stubbed: this is
// interaction/lifecycle validation, not a screenshot or visual acceptance.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://leandata.uk/chart/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const errors = [];
window.addEventListener('error', event => errors.push(event.message));
window.ResizeObserver = class {
  constructor(callback) { this.callback = callback; }
  observe(target) { this.callback([{ target, contentRect: { width: 900, height: 480 } }]); }
  unobserve() {}
  disconnect() {}
};
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
window.TextDecoder = TextDecoder;
window.TextEncoder = TextEncoder;
window.HTMLCanvasElement.prototype.getContext = function () {
  if (!this.context) this.context = new Proxy({ canvas: this, measureText: text => ({ width: String(text).length * 7 }), createLinearGradient: () => ({ addColorStop() {} }), setLineDash() {} }, { get: (target, key) => key in target ? target[key] : () => {} });
  return this.context;
};
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 900 });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 480 });
window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 480, width: 900, height: 480 });
const sockets = [], requests = [];
window.WebSocket = class {
  constructor(url) { this.url = url; this.readyState = 1; this.sent = []; sockets.push(this); window.setTimeout(() => this.onopen?.(), 0); }
  send(data) {
    const message = JSON.parse(data); this.sent.push(message);
    if (message.action === 'auth') window.setTimeout(() => this.onmessage({ data: JSON.stringify({ T: 'success', msg: 'authenticated' }) }), 0);
    if (message.action === 'subscribe') window.setTimeout(() => this.onmessage({ data: JSON.stringify({ T: 'subscription', subjects: [] }) }), 0);
  }
  close() { this.readyState = 3; this.onclose?.(); }
};
let denyHistory = false;
window.fetch = async (url, options) => {
  requests.push({ url, options });
  if (url === '/api/account/token') return { ok: false, status: 401, json: async () => ({ code: 'account_required' }) };
  if (denyHistory) return { ok: false, status: 403, headers: new Headers() };
  return { ok: true, status: 200, json: async () => ({ bars: [{ t: '2026-10-01T14:00:00Z', o: 100, h: 103, l: 99, c: 102, v: 1200 }], next_page_token: null }) };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 80));
async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await tick();
  assert.ok(predicate(), 'production bundle did not finish rendering within the bounded wait');
}
const document = window.document;
const button = text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text);
const input = (selector, value) => {
  const element = document.querySelector(selector);
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
};
window.eval(fs.readFileSync(new URL('../public/assets/chart-page.js', import.meta.url), 'utf8'));
await tick();
await until(() => document.querySelectorAll('canvas').length >= 2);
assert.equal(document.querySelector('[data-testid="chart-symbol"]').textContent, 'NVDA');
assert.match(document.body.textContent, /模拟行情/);
assert.equal(requests.length, 0, 'demo must never request live data');
assert.ok(document.querySelectorAll('canvas').length >= 2);
assert.equal(document.querySelector('.drawing-rail'), null, 'drawing tools should be collapsed initially');
assert.equal(document.querySelector('.quote-details').open, false, 'quote details should be collapsed initially');
button('工具').click(); await tick();
assert.ok(document.querySelector('.drawing-rail'));
assert.equal(button('工具').getAttribute('aria-expanded'), 'true');
button('工具').click(); await tick();
assert.equal(document.querySelector('.drawing-rail'), null);
button('1D').click(); await tick();
assert.equal(button('1D').getAttribute('aria-pressed'), 'true');
button('加密货币').click(); await tick();
assert.equal(document.querySelector('[data-testid="chart-symbol"]').textContent, 'BTC/USD');
button('美股').click(); await tick();
input('[aria-label="搜索标的"]', '*');
document.querySelector('.symbol-search').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick();
assert.match(document.querySelector('[role="alert"]').textContent, /有效股票代码/);
input('[aria-label="搜索标的"]', 'TSLA');
document.querySelector('.symbol-search').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick();
assert.equal(document.querySelector('[data-testid="chart-symbol"]').textContent, 'TSLA');
document.querySelector('[aria-label="加入自选"]').click(); await tick();
assert.equal(document.querySelectorAll('.watch-row').length, 5);
document.querySelector('[aria-label="切换 K 线 / 折线"]').click(); await tick();
document.querySelector('.header-right .primary-button').click(); await tick();
assert.ok(document.querySelector('[role="dialog"]'));
button('使用已登录账户 →').click(); await tick();
assert.match(document.querySelector('.dialog-error').textContent, /请先/);
input('#chart-token', 'synthetic-ui-test-only');
document.querySelector('.connect-dialog form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick();
assert.equal(document.querySelector('[role="dialog"]'), null);
assert.equal(document.querySelector('.data-badge').textContent, 'REST OHLCV');
assert.equal(document.querySelector('.chart-watermark small').textContent, 'TSLA / 1D');
assert.ok(requests.some(request => request.url.startsWith('/api/chart/bars?')));
assert.equal(sockets.length, 1);
assert.equal(sockets[0].sent[0].token, 'synthetic-ui-test-only');
assert.ok(!window.localStorage.getItem('leandata.chart.watchlist.v1').includes('synthetic-ui-test-only'));
assert.ok(sockets[0].sent[1].trades.length <= 5);
// The latest ticker's socket replaces and closes the old connection.
button('加密货币').click(); await tick();
assert.equal(sockets[0].readyState, 3);
assert.equal(sockets.at(-1).url, 'wss://leandata.uk/stream/crypto');
denyHistory = true;
button('5m').click(); await tick();
assert.match(document.querySelector('.chart-warning').textContent, /权限/);
assert.equal(document.querySelector('.data-badge').textContent, 'REST OHLCV', 'network failure must not silently substitute demo');
document.querySelector('.header-right .primary-button').click(); await tick();
button('断开连接').click(); await tick();
assert.equal(sockets.at(-1).readyState, 3);
assert.match(document.querySelector('.connection-pill').textContent, /未连接/);
assert.deepEqual(errors, []);
dom.window.close();
console.log('Chart UI: production bundle, demo isolation, symbol/frame/asset switching, watchlist, token privacy, reconnect cleanup and permission errors passed (canvas stubbed).');
