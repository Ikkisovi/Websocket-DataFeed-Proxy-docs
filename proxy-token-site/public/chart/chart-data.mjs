import { decode } from '@msgpack/msgpack';

export const TIMEFRAMES = { '1m': '1Min', '5m': '5Min', '15m': '15Min', '1h': '1Hour', '1D': '1Day' };
export const REST_POLL_MS = 30000;

export function validSymbol(value, asset) {
  return (asset === 'crypto' ? /^[A-Z0-9]{2,12}\/[A-Z0-9]{2,12}$/ : /^[A-Z][A-Z0-9.-]{0,14}$/).test(value);
}

export function normalizeBars(rows) {
  const unique = new Map();
  for (const row of rows) {
    const time = Math.floor(Date.parse(row.t) / 1000);
    const { o: open, h: high, l: low, c: close, v: volume } = row;
    if (![time, open, high, low, close, volume].every(Number.isFinite) || Math.min(open, high, low, close) <= 0 || volume < 0 || high < Math.max(open, close) || low > Math.min(open, close) || high < low) continue;
    unique.set(time, { time, open, high, low, close, volume });
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

export function mergeBars(existing, incoming, limit = 6000) {
  const rows = new Map(existing.map(row => [row.time, row]));
  for (const row of incoming) rows.set(row.time, row);
  return [...rows.values()].sort((a, b) => a.time - b.time).slice(-limit);
}

export function movingAverage(bars, period) {
  let sum = 0;
  return bars.flatMap((bar, i) => {
    sum += bar.close;
    if (i >= period) sum -= bars[i - period].close;
    return i < period - 1 ? [] : [{ time: bar.time, value: sum / period }];
  });
}

export async function decodeFrames(data) {
  let result;
  if (typeof data === 'string') result = JSON.parse(data);
  else {
    const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
    const bytes = new Uint8Array(buffer);
    // The gateway accepts JSON control messages, but stock data remains binary.
    try { result = decode(bytes); }
    catch { result = JSON.parse(new TextDecoder().decode(bytes)); }
  }
  return Array.isArray(result) ? result : [result];
}

export class HistoryError extends Error {
  constructor(status, retryAfter = 0) {
    super(status === 401 ? 'Token 已失效，请重新连接' : status === 403 ? '当前账户没有此行情权限或历史区间权限' : status === 501 ? '当前后端尚未开放此历史行情接口' : status === 429 ? '请求较多，稍后自动重试' : '历史行情暂时不可用，请重试');
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export async function loadHistory({ asset, symbol, timeframe, start, end, token, signal, maxPages = 6, fetcher = fetch }) {
  let cursor, bars = [], pages = 0;
  const seen = new Set();
  do {
    const query = new URLSearchParams({ asset, symbol, timeframe: TIMEFRAMES[timeframe], start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    if (cursor) query.set('page_token', cursor);
    const response = await fetcher(`/api/chart/bars?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal, cache: 'no-store' });
    if (!response.ok) throw new HistoryError(response.status, Math.max(0, Number(response.headers.get('Retry-After')) || 0));
    const data = await response.json();
    if (!Array.isArray(data.bars)) throw new Error('历史行情格式异常');
    const normalized = normalizeBars(data.bars);
    if (normalized.length !== data.bars.length) throw new Error('历史行情包含无效 K 线，已停止加载');
    bars = mergeBars(bars, normalized);
    pages++;
    cursor = data.next_page_token;
    if (cursor && seen.has(cursor)) throw new Error('历史分页异常，请重试');
    if (cursor) seen.add(cursor);
  } while (cursor && pages < maxPages);
  return { bars, truncated: Boolean(cursor), pages };
}

export class MarketStream {
  constructor({ asset, symbols, token, onStatus, onFrame, onReconnect, socketFactory = url => new WebSocket(url) }) {
    Object.assign(this, { asset, symbols, token, onStatus, onFrame, onReconnect, socketFactory });
    this.attempts = 0;
    this.stopped = false;
    this.open();
  }
  open() {
    if (this.stopped) return;
    this.onStatus('connecting');
    const socket = this.socketFactory(this.asset === 'crypto' ? 'wss://leandata.uk/stream/crypto' : 'wss://leandata.uk/stream');
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    let authenticated = false;
    const deadline = setTimeout(() => socket.close(), 12000);
    socket.onopen = () => socket.send(JSON.stringify({ action: 'auth', token: this.token }));
    // Preserve arrival order when Blob decoding yields asynchronously.
    let queue = Promise.resolve();
    socket.onmessage = event => {
      queue = queue.then(async () => {
        if (this.stopped || socket !== this.socket) return;
        const frames = await decodeFrames(event.data);
        if (this.stopped || socket !== this.socket) return;
        for (const frame of frames) {
          if (frame.T === 'error') {
            this.onStatus('error', Number(frame.code) === 429 ? 'WS 请求受限，请稍后手动连接' : 'WS 认证或订阅失败，请检查账户权限');
            this.stop();
            return;
          }
          if (frame.T === 'success' && frame.msg === 'authenticated' && !authenticated) {
            authenticated = true;
            socket.send(JSON.stringify({ action: 'subscribe', trades: this.symbols, quotes: this.symbols }));
          }
          if (frame.T === 'subscription') {
            clearTimeout(deadline);
            const reconnected = this.attempts > 0;
            this.attempts = 0;
            this.onStatus('connected');
            if (reconnected) this.onReconnect?.();
          }
          if (['t', 'q'].includes(frame.T) && this.symbols.includes(frame.S)) this.onFrame(frame);
        }
      }).catch(() => {
        this.onStatus('error', '无法解析实时行情，请重新连接');
        this.stop();
      });
    };
    socket.onerror = () => {};
    socket.onclose = () => {
      clearTimeout(deadline);
      if (this.stopped || socket !== this.socket) return;
      this.onStatus('reconnecting');
      if (++this.attempts > 6) {
        this.onStatus('error', 'WS 重连未成功，请手动重试');
        this.stop();
        return;
      }
      this.timer = setTimeout(() => this.open(), Math.min(30000, 1000 * 2 ** (this.attempts - 1)));
    };
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.socket && this.socket.readyState < 2) this.socket.close();
    this.token = '';
  }
}
