// A fixed-destination, bounded bridge for browsers. Authorization remains with
// LeanData; no credentials, upstream bodies, or request URLs are logged/cached.
const FRAMES = new Set(['1Min', '5Min', '15Min', '1Hour', '1Day']);
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function historyRequest(query, now = Date.now()) {
  const { asset, symbol, timeframe, start, end, page_token } = query;
  if (!['stock', 'crypto'].includes(asset) || !FRAMES.has(timeframe)) return null;
  const pattern = asset === 'stock' ? /^[A-Z][A-Z0-9.-]{0,14}$/ : /^[A-Z0-9]{2,12}\/[A-Z0-9]{2,12}$/;
  if (typeof symbol !== 'string' || !pattern.test(symbol)) return null;
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  if (typeof start !== 'string' || typeof end !== 'string' || !timestamp.test(start) || !timestamp.test(end)) return null;
  const a = Date.parse(start), b = Date.parse(end);
  const days = timeframe === '1Day' ? 366 : 31;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b || b - a > days * 86400000 || b > now + 60000) return null;
  if (page_token !== undefined && (typeof page_token !== 'string' || page_token.length > 4096 || /[\x00-\x1f]/.test(page_token))) return null;
  const url = new URL(asset === 'stock' ? 'https://api.leandata.uk/v2/stocks/bars' : 'https://api.leandata.uk/v1beta3/crypto/us/bars');
  const params = { symbols: symbol, timeframe, start, end, limit: '1000', sort: 'desc' };
  if (asset === 'stock') Object.assign(params, { feed: 'sip', adjustment: 'raw' });
  if (page_token) params.page_token = page_token;
  url.search = new URLSearchParams(params).toString();
  return url;
}

async function boundedJSON(response) {
  if (Number(response.headers.get('content-length')) > MAX_BODY_BYTES) throw new Error('body_limit');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new Error('body_limit');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function createChartHistoryHandler(fetcher = (...args) => fetch(...args)) {
  let pending = 0;
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const auth = req.get('Authorization') || '';
    if (!/^Bearer [^\s\x00-\x1f]{1,2048}$/.test(auth)) return res.status(401).json({ code: 'token_required' });
    const url = historyRequest(req.query);
    if (!url) return res.status(400).json({ code: 'invalid_chart_request' });
    if (pending >= 4) return res.set('Retry-After', '5').status(429).json({ code: 'chart_busy' });
    pending++;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 20000);
    const onClose = () => { if (!res.writableEnded) abort.abort(); };
    res.on('close', onClose);
    try {
      const upstream = await fetcher(url, { headers: { Authorization: auth, Accept: 'application/json' }, signal: abort.signal, redirect: 'error' });
      if (!upstream.ok) {
        await upstream.body?.cancel().catch(() => {});
        const retry = upstream.headers.get('retry-after');
        if (retry && /^\d{1,5}$/.test(retry)) res.set('Retry-After', retry);
        const status = [400, 401, 403, 404, 422, 429, 501, 503].includes(upstream.status) ? upstream.status : 502;
        return res.status(status).json({ code: `history_http_${status}` });
      }
      const data = await boundedJSON(upstream);
      const rows = Array.isArray(data.bars) ? data.bars : data.bars?.[req.query.symbol];
      if (!Array.isArray(rows) || rows.length > 1000) throw new Error('shape');
      // Publish only the fields used by the chart, never arbitrary vendor data.
      const bars = rows.map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v }));
      const cursor = data.next_page_token;
      if (cursor != null && (typeof cursor !== 'string' || cursor.length > 4096)) throw new Error('cursor');
      return res.json({ bars, next_page_token: cursor || null });
    } catch {
      if (!res.headersSent && !res.destroyed) return res.status(abort.signal.aborted ? 504 : 502).json({ code: abort.signal.aborted ? 'history_timeout' : 'history_unavailable' });
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
      pending--;
    }
  };
}

module.exports = { createChartHistoryHandler, historyRequest, boundedJSON };
