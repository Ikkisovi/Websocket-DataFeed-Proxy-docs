import React, { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, LineSeries, HistogramSeries, createChart, CrosshairMode } from 'lightweight-charts';
import { MarketStream, TIMEFRAMES, HistoryError, loadHistory, mergeBars, movingAverage, validSymbol, REST_POLL_MS } from './chart-data.mjs';

const UP = '#328365', DOWN = '#ba5947';
const STOCKS = ['SPY', 'QQQ', 'NVDA', 'AAPL'];
const CRYPTO = ['BTC/USD', 'ETH/USD', 'SOL/USD'];
const NAMES = { SPY: 'S&P 500 ETF', QQQ: 'Nasdaq 100 ETF', NVDA: 'NVIDIA Corporation', AAPL: 'Apple Inc.', TSLA: 'Tesla, Inc.', 'BTC/USD': 'Bitcoin / US Dollar', 'ETH/USD': 'Ethereum / US Dollar', 'SOL/USD': 'Solana / US Dollar' };
const number = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
const compact = value => Number.isFinite(value) ? Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value) : '—';
const clock = value => value ? new Date(value).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC' : '—';
const STORAGE = 'leandata.chart.watchlist.v1';
function savedWatchlists() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE));
    return Object.fromEntries(['stock', 'crypto'].map(asset => [asset, Array.isArray(data?.[asset]) && data[asset].length && data[asset].length <= 5 && data[asset].every(s => typeof s === 'string' && validSymbol(s, asset)) ? [...new Set(data[asset])] : asset === 'stock' ? STOCKS : CRYPTO]));
  } catch { return { stock: STOCKS, crypto: CRYPTO }; }
}

// Deterministic, explicitly labelled UI samples. Never mixed with network data.
function demoBars(symbol, timeframe, days = 5) {
  const seconds = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '1D': 86400 }[timeframe];
  const base = { NVDA: 178, AAPL: 230, SPY: 630, QQQ: 558, 'BTC/USD': 95000, 'ETH/USD': 3400, 'SOL/USD': 180 }[symbol] || 120;
  let seed = [...symbol].reduce((n, c) => n + c.charCodeAt(0), 42), close = base;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const end = Math.floor(Date.UTC(2026, 9, 1, 20) / 1000 / seconds) * seconds;
  const count = Math.min(600, Math.max(20, Math.round(days * 86400 / seconds)));
  return Array.from({ length: count }, (_, i) => {
    const open = close;
    close = open + (random() - .47) * base * .006;
    return { time: end - (count - 1 - i) * seconds, open, close, high: Math.max(open, close) + random() * base * .002, low: Math.min(open, close) - random() * base * .002, volume: Math.round(10000 + random() * 90000) };
  });
}

function Icon({ name }) {
  const paths = {
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>,
    chart: <><path d="M5 3v18M12 3v18M19 3v18" /><path d="M3 7h4v7H3zM10 10h4v8h-4zM17 5h4v7h-4z" /></>,
    line: <path d="m3 18 5-7 5 3 8-10" />,
    cross: <><path d="M12 3v18M3 12h18" /><circle cx="12" cy="12" r="4" /></>,
    horizontal: <><path d="M3 12h18" /><circle cx="7" cy="12" r="2" /></>,
    fit: <><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" /><path d="M8 8h8v8H8z" /></>,
    camera: <><path d="M3 7h5l2-3h4l2 3h5v13H3z" /><circle cx="12" cy="13" r="4" /></>,
    plus: <path d="M12 4v16M4 12h16" />,
    close: <path d="m5 5 14 14M19 5 5 19" />,
    refresh: <><path d="M20 6v5h-5" /><path d="M20 11a8 8 0 1 0-1 7" /></>,
    settings: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" /></>,
  };
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.chart}</svg>;
}

function ChartCanvas({ bars, type, ma20, ma50, mode, livePrice, onHover, draw, onDrawDone, chartRef }) {
  const container = useRef();
  const internals = useRef();
  const hoverRef = useRef(onHover), drawRef = useRef(draw), doneRef = useRef(onDrawDone);
  hoverRef.current = onHover; drawRef.current = draw; doneRef.current = onDrawDone;
  useEffect(() => {
    const chart = createChart(container.current, {
      autoSize: true,
      layout: { background: { color: '#ffffff' }, textColor: '#7a716a', fontFamily: 'IBM Plex Mono, ui-monospace, monospace', fontSize: 11, attributionLogo: true },
      grid: { vertLines: { visible: false }, horzLines: { color: '#efeae0' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#b0a89e', labelBackgroundColor: '#3a3530' }, horzLine: { color: '#b0a89e', labelBackgroundColor: '#3a3530' } },
      rightPriceScale: { borderColor: '#e8e2d6', minimumWidth: 70 },
      timeScale: { borderColor: '#e8e2d6', timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 7 },
      localization: { locale: 'en-US', timeFormatter: time => new Date(Number(time) * 1000).toLocaleString('en-GB', { timeZone: 'UTC' }) },
    });
    const price = chart.addSeries(type === 'candles' ? CandlestickSeries : LineSeries, type === 'candles'
      ? { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false }
      : { color: '#227579', lineWidth: 2 });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }, 1);
    chart.panes()[1].setStretchFactor(.22);
    const sma20 = chart.addSeries(LineSeries, { color: '#c39962', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const sma50 = chart.addSeries(LineSeries, { color: '#a29ac9', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    internals.current = { chart, price, volume, sma20, sma50, previous: [], drawings: [] };
    chartRef.current = internals.current;
    chart.subscribeCrosshairMove(event => {
      const data = event.seriesData.get(price);
      hoverRef.current(data && event.point ? internals.current.previous.find(bar => bar.time === data.time) || null : null);
    });
    chart.subscribeClick(event => {
      if (!drawRef.current || !event.point || event.paneIndex !== 0) return;
      const value = price.coordinateToPrice(event.point.y);
      if (value == null) return;
      const drawings = internals.current.drawings;
      if (drawings.length >= 8) price.removePriceLine(drawings.shift());
      drawings.push(price.createPriceLine({ price: value, color: '#dda75c', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Level' }));
      doneRef.current();
    });
    return () => { chartRef.current = null; internals.current = null; chart.remove(); };
  }, [type]);
  useEffect(() => {
    const state = internals.current;
    if (!state) return;
    const { chart, price, volume, sma20, sma50, previous } = state;
    const priceRow = bar => type === 'candles' ? bar : { time: bar.time, value: bar.close };
    const volumeRow = bar => ({ time: bar.time, value: bar.volume, color: bar.close >= bar.open ? '#32836538' : '#ba594738' });
    const initial = !previous.length;
    const reset = initial || !bars.length || previous[0]?.time !== bars[0]?.time || bars.length < previous.length;
    if (reset) { price.setData(bars.map(priceRow)); volume.setData(bars.map(volumeRow)); }
    else {
      bars.forEach((bar, i) => {
        if (JSON.stringify(bar) !== JSON.stringify(previous[i])) {
          price.update(priceRow(bar), bar.time < previous[previous.length - 1].time);
          volume.update(volumeRow(bar), bar.time < previous[previous.length - 1].time);
        }
      });
    }
    sma20.setData(ma20 ? movingAverage(bars, 20) : []);
    sma50.setData(ma50 ? movingAverage(bars, 50) : []);
    state.previous = bars;
    if (initial && bars.length) chart.timeScale().fitContent();
  }, [bars, type, ma20, ma50]);
  useEffect(() => {
    const state = internals.current;
    if (!state) return;
    if (state.liveLine) state.price.removePriceLine(state.liveLine);
    state.liveLine = Number.isFinite(livePrice) && mode === 'live' ? state.price.createPriceLine({ price: livePrice, color: '#477cbd', lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: 'Last trade' }) : null;
  }, [livePrice, mode, type]);
  return <div className={`chart-canvas ${draw ? 'drawing' : ''}`} ref={container} data-testid="chart-canvas" />;
}

export function ChartPage() {
  const [asset, setAsset] = useState('stock');
  const [symbol, setSymbol] = useState('NVDA');
  const [timeframe, setTimeframe] = useState('15m');
  const [days, setDays] = useState(5);
  const [mode, setMode] = useState('demo');
  const [token, setToken] = useState('');
  const [dialog, setDialog] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [watchlists, setWatchlists] = useState(savedWatchlists);
  const [search, setSearch] = useState('');
  const [searchError, setSearchError] = useState('');
  const [type, setType] = useState('candles');
  const [ma20, setMa20] = useState(true), [ma50, setMa50] = useState(false);
  const [draw, setDraw] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [bars, setBars] = useState([]);
  const [hover, setHover] = useState(null);
  const [quotes, setQuotes] = useState({});
  const [history, setHistory] = useState({ status: 'idle' });
  const [stream, setStream] = useState({ status: 'idle' });
  const [refresh, setRefresh] = useState(0);
  const chartRef = useRef(), barsRef = useRef([]), quoteRef = useRef({});
  const [now, setNow] = useState(Date.now());
  const watchlist = watchlists[asset];
  const symbols = [...new Set([symbol, ...watchlist])].slice(0, 5);
  const symbolsKey = symbols.join(',');
  const bar = hover && hover.open != null ? hover : bars[bars.length - 1];
  const quote = quotes[symbol];
  const lastPrice = mode === 'demo' ? bar?.close : quote?.price;
  const change = bar ? bar.close - bar.open : null;
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { try { localStorage.setItem(STORAGE, JSON.stringify(watchlists)); } catch {} }, [watchlists]);
  useEffect(() => { setHover(null); setDraw(false); }, [symbol, asset, timeframe]);

  useEffect(() => {
    const data = mode === 'demo' ? demoBars(symbol, timeframe, days) : [];
    barsRef.current = data; setBars(data);
    if (mode !== 'live' || !token) { setHistory({ status: 'idle' }); return; }
    let disposed = false, timer, cooldown = 0, complete = false;
    const abort = new AbortController();
    async function fetchBars(initial) {
      if (disposed) return;
      setHistory(old => ({ ...old, status: 'loading', error: '' }));
      try {
        const end = Date.now();
        // Repeat the newest interval so corrections replace existing candles.
        const last = barsRef.current[barsRef.current.length - 1];
        const overlap = timeframe === '1D' ? 7 * 86400000 : 2 * 86400000;
        const start = initial || !last ? end - days * 86400000 : Math.max(end - days * 86400000, last.time * 1000 - overlap);
        const result = await loadHistory({ asset, symbol, timeframe, start, end, token, signal: abort.signal });
        if (disposed) return;
        if (initial) complete = !result.truncated;
        const merged = initial ? result.bars : mergeBars(barsRef.current, result.bars);
        barsRef.current = merged; setBars(merged);
        setHistory({ status: 'ready', at: Date.now(), truncated: !complete || result.truncated, empty: !merged.length });
        cooldown = REST_POLL_MS;
      } catch (error) {
        if (disposed || error.name === 'AbortError') return;
        setHistory(old => ({ ...old, status: 'error', error: error.message }));
        if (error instanceof HistoryError && [400, 401, 403, 404, 422, 501].includes(error.status)) return;
        cooldown = Math.min(300000, Math.max(REST_POLL_MS, (error.retryAfter || 0) * 1000, cooldown * 2));
      }
      if (!disposed) timer = setTimeout(() => fetchBars(!barsRef.current.length), cooldown);
    }
    fetchBars(true);
    // Network work is serial: every next poll is scheduled after completion.
    return () => { disposed = true; abort.abort(); clearTimeout(timer); };
  }, [asset, symbol, timeframe, days, mode, token, refresh]);

  useEffect(() => {
    quoteRef.current = {}; setQuotes({});
    if (mode !== 'live' || !token) { setStream({ status: 'idle' }); return; }
    const market = new MarketStream({
      asset, symbols, token,
      onStatus: (status, error) => setStream({ status, error }),
      onReconnect: () => setRefresh(n => n + 1),
      onFrame: frame => {
        const previous = quoteRef.current[frame.S] || {};
        const eventTime = Date.parse(frame.t);
        if (!Number.isFinite(eventTime) || eventTime > Date.now() + 60000) return;
        if (frame.T === 't') {
          if (!Number.isFinite(frame.p) || frame.p <= 0 || eventTime < (previous.tradeTime || 0)) return;
          quoteRef.current[frame.S] = { ...previous, price: frame.p, tradeTime: eventTime, received: Date.now() };
        } else {
          if (![frame.bp, frame.ap].every(Number.isFinite) || frame.bp <= 0 || frame.ap < frame.bp || eventTime < (previous.quoteTime || 0)) return;
          quoteRef.current[frame.S] = { ...previous, bid: frame.bp, ask: frame.ap, quoteTime: eventTime, received: Date.now() };
        }
      },
    });
    const flush = setInterval(() => setQuotes({ ...quoteRef.current }), 250);
    return () => { market.stop(); clearInterval(flush); };
  }, [asset, symbolsKey, mode, token]);

  function chooseAsset(next) {
    setAsset(next); setSymbol(watchlists[next][0]); setSearch(''); setSearchError('');
  }
  function chooseFrame(next) {
    setTimeframe(next); setDays(next === '1D' ? 31 : Math.min(days, 31));
  }
  function searchSymbol(event) {
    event.preventDefault();
    const value = search.trim().toUpperCase();
    if (!validSymbol(value, asset)) { setSearchError(asset === 'crypto' ? '请输入 BTC/USD 这样的交易对' : '请输入有效股票代码，例如 AAPL'); return; }
    setSymbol(value); setSearch(''); setSearchError('');
  }
  function addWatchlist() {
    if (watchlist.includes(symbol)) return;
    if (watchlist.length >= 5) { setSearchError('自选最多 5 个，请先移除一个'); return; }
    setWatchlists(old => ({ ...old, [asset]: [...watchlist, symbol] }));
  }
  function connect(value) {
    const credential = value.trim();
    if (!credential || credential.length > 2048 || /\s/.test(credential)) { setDialogError('请输入有效 Token'); return; }
    setToken(credential); setMode('live'); setTokenInput(''); setDialog(false); setDialogError(''); setRefresh(n => n + 1);
  }
  async function useAccount() {
    setAccountBusy(true); setDialogError('');
    try {
      const response = await fetch('/api/account/token', { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.token) throw new Error('请先在账户页面登录，或粘贴已有 Token');
      connect(data.token);
    } catch { setDialogError('请先在账户页面登录，或粘贴已有 Token'); }
    finally { setAccountBusy(false); }
  }
  function downloadCSV() {
    const text = ['time_utc,open,high,low,close,volume', ...bars.map(b => `${new Date(b.time * 1000).toISOString()},${b.open},${b.high},${b.low},${b.close},${b.volume}`)].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `${mode === 'demo' ? 'DEMO-' : ''}${symbol.replace('/', '-')}-${timeframe}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  function screenshot() {
    const canvas = chartRef.current?.chart.takeScreenshot();
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, 420, 27);
    context.fillStyle = '#647082'; context.font = '12px sans-serif'; context.fillText(`LeanData · ${symbol} · ${timeframe} · ${mode === 'demo' ? 'DEMO / simulated data' : 'REST candles / UTC'}`, 10, 18);
    const a = document.createElement('a'); a.download = `LeanData-${mode === 'demo' ? 'DEMO-' : ''}${symbol.replace('/', '-')}.png`; a.href = canvas.toDataURL(); a.click();
  }
  const lastEvent = Math.max(quote?.tradeTime || 0, quote?.quoteTime || 0);
  const stale = mode === 'live' && (!lastEvent || now - lastEvent > 60000);
  const status = mode === 'demo' ? '演示数据' : mode === 'idle' ? '未连接' : stream.status === 'connected' ? (stale ? '已连接 · 等待新行情' : '实时行情') : ({ connecting: '连接中', reconnecting: '正在重连', error: '连接异常' }[stream.status] || '未连接');

  return <div className="chart-app gpu-index-app">
    <header className="chart-header gpu-index-topbar">
      <span className="gpu-index-mark" /><a className="gpu-index-brand" href="/"><strong>LeanData</strong> research</a>
      <span className="gpu-index-divider" /><span className="gpu-index-top-title">行情图表 / Market chart</span>
      <span className="gpu-index-spacer" />
      <div className="header-right"><span className={`connection-pill gpu-index-health ${mode === 'demo' ? 'demo' : stale || stream.status !== 'connected' ? 'waiting' : 'live'}`} role="status"><i className={`gpu-index-health-dot ${mode !== 'live' || stale ? 'warn' : ''}`} />{status}</span><button className="primary-button" onClick={() => { setDialog(true); setDialogError(''); }}>{mode === 'live' ? '连接设置' : '连接行情'} <span>↗</span></button></div>
    </header>
    <main className="gpu-index-shell">
      <nav className="gpu-index-crumbs" aria-label="Breadcrumb"><a href="/">首页 Home</a><span>/</span><a href="/alternative-data/">GPU Rental Index</a><span>/</span><span className="here">行情图表 / Market chart</span><a className="crumb-account" href="/account">账户 Account ↗</a></nav>
      <section className="gpu-index-hero">
        <div><div className="gpu-index-eyebrow">Market data · Historical bars · Live quotes</div><h1 className="gpu-index-title">Market <em>Chart</em></h1><p className="gpu-index-subtitle">轻量行情工作台。历史 K 线、实时成交报价与自选，连接你的 LeanData 数据。</p></div>
        <div className="gpu-index-meta"><div className="gpu-index-meta-row"><span>Feed</span><span>{mode === 'demo' ? 'Demo / simulated' : 'LeanData REST + WS'}</span></div><div className="gpu-index-meta-row"><span>Candles</span><span>{mode === 'demo' ? '模拟行情' : '30-second refresh'}</span></div><div className="gpu-index-meta-row"><span>Clock</span><span>UTC · USD · Unadjusted</span></div></div>
      </section>
    <div className="chart-toolbar gpu-index-toolbar">
      <form onSubmit={searchSymbol} className="symbol-search"><Icon name="search" /><input aria-label="搜索标的" value={search} onChange={e => setSearch(e.target.value)} placeholder={asset === 'stock' ? '搜索代码 · NVDA' : '搜索交易对 · BTC/USD'} maxLength="25" /><button type="submit">↵</button></form>
      <div className="toolbar-separator" />
      <div className="timeframes" aria-label="K 线周期">{Object.keys(TIMEFRAMES).map(frame => <button key={frame} className={frame === timeframe ? 'active' : ''} aria-pressed={frame === timeframe} onClick={() => chooseFrame(frame)}>{frame}</button>)}</div>
      <div className="toolbar-separator" />
      <button className={`toolbar-button ${type === 'line' ? 'active' : ''}`} title="切换 K 线 / 折线" aria-label="切换 K 线 / 折线" onClick={() => setType(old => old === 'candles' ? 'line' : 'candles')}><Icon name={type === 'candles' ? 'chart' : 'line'} /></button>
      <label className={`indicator-toggle ${ma20 ? 'active' : ''}`}><input type="checkbox" checked={ma20} onChange={e => setMa20(e.target.checked)} /><i className="ma20-dot" />MA 20</label>
      <label className={`indicator-toggle ${ma50 ? 'active' : ''}`}><input type="checkbox" checked={ma50} onChange={e => setMa50(e.target.checked)} /><i className="ma50-dot" />MA 50</label>
      <div className="toolbar-fill" /><button className="tools-toggle" aria-expanded={toolsOpen} onClick={() => { setToolsOpen(old => !old); setDraw(false); }}>工具</button><details className="export-menu"><summary aria-label="导出选项">···</summary><div><button disabled={!bars.length} onClick={downloadCSV}><Icon name="download" />下载 CSV</button><button disabled={!bars.length} onClick={screenshot}><Icon name="camera" />保存截图</button></div></details>
    </div>
    {searchError && <div className="chart-notice" role="alert">{searchError}<button onClick={() => setSearchError('')}>关闭</button></div>}
    <div className="chart-workspace gpu-index-workspace">
      <aside className="watchlist-panel" aria-label="自选与报价">
        <div className="watchlist-heading"><h2>自选列表</h2><span>{watchlist.length}/5</span><button aria-label="加入当前标的" title="加入当前标的" onClick={addWatchlist}><Icon name="plus" /></button></div>
        <div className="asset-tabs"><button className={asset === 'stock' ? 'active' : ''} onClick={() => chooseAsset('stock')}>美股</button><button className={asset === 'crypto' ? 'active' : ''} onClick={() => chooseAsset('crypto')}>加密货币</button></div>
        <div className="watchlist-columns"><span>标的</span><span>最近成交</span></div>
        <div className="watchlist-rows gpu-index-cards">{watchlist.map((ticker, index) => {
          const simulated = mode === 'demo' ? demoBars(ticker, timeframe, days).at(-1) : null;
          const value = simulated?.close ?? quotes[ticker]?.price;
          const age = quotes[ticker]?.tradeTime ? now - quotes[ticker].tradeTime : Infinity;
          return <div key={ticker} className={`watch-row gpu-index-card ${ticker === symbol ? 'selected active' : ''}`}><button className="watch-select" onClick={() => setSymbol(ticker)}><span className="watch-symbol"><b>{ticker}</b><small>{NAMES[ticker] || 'US Equity'}</small></span><span className="watch-value"><b>{number(value)}</b><small>{simulated ? 'DEMO' : age < 60000 ? '刚刚更新' : Number.isFinite(value) ? '等待更新' : '—'}</small></span></button><button className="remove-watch" aria-label={`移除 ${ticker}`} disabled={watchlist.length === 1} onClick={() => setWatchlists(old => ({ ...old, [asset]: watchlist.filter(s => s !== ticker) }))}>×</button></div>;
        })}</div>
        <details className="quote-details"><summary>报价详情</summary><div className="quote-card"><div className="bid-ask"><div><span>买价 BID</span><b className="up">{number(quote?.bid)}</b></div><div><span>卖价 ASK</span><b className="down">{number(quote?.ask)}</b></div></div><dl><div><dt>价差</dt><dd>{quote?.ask != null ? number(quote.ask - quote.bid, 4) : '—'}</dd></div><div><dt>成交时间</dt><dd>{clock(quote?.tradeTime)}</dd></div><div><dt>报价时间</dt><dd>{clock(quote?.quoteTime)}</dd></div><div><dt>K 线刷新</dt><dd>{clock(history.at)}</dd></div></dl></div></details>
        <div className="data-explanation"><p>{mode === 'demo' ? '演示价格 · 连接账户查看真实行情' : 'K 线每 30 秒刷新 · 报价实时更新'}<br />未复权 · UTC</p><a href="/docs/realtime/websocket/">数据说明 ↗</a></div>
      </aside>

      <section className="chart-main gpu-index-panel" aria-label="行情图表">
      {toolsOpen && <aside className="drawing-rail" aria-label="图表工具">
        <button className={!draw ? 'selected' : ''} title="十字光标" aria-label="十字光标" onClick={() => setDraw(false)}><Icon name="cross" /></button>
        <button className={draw ? 'selected' : ''} title="添加水平价格线" aria-label="添加水平价格线" onClick={() => setDraw(old => !old)}><Icon name="horizontal" /></button>
        <div className="rail-divider" /><button title="适应全部数据" aria-label="适应全部数据" onClick={() => chartRef.current?.chart.timeScale().fitContent()}><Icon name="fit" /></button>
        <button title="移除价格线" aria-label="移除价格线" onClick={() => { const state = chartRef.current; if (state) { state.drawings.forEach(line => state.price.removePriceLine(line)); state.drawings = []; } }}><Icon name="close" /></button>
        <div className="rail-fill" /><span className="rail-caption">UTC</span>
      </aside>}
        <div className="instrument-header gpu-index-panel-head"><div><div className="instrument-title"><h2 className="gpu-index-panel-title" data-testid="chart-symbol">{symbol}</h2><span className="exchange-tag">{asset === 'stock' ? 'US · SIP' : 'CRYPTO'}</span><button className="star-button" aria-label="加入自选" title="加入自选" onClick={addWatchlist}>{watchlist.includes(symbol) ? '★' : '☆'}</button></div><p>{NAMES[symbol] || symbol} <span>· {timeframe} · USD</span></p></div><div className="instrument-price"><strong>{number(mode === 'live' && lastPrice ? lastPrice : bar?.close)}</strong><span className={change >= 0 ? 'up' : 'down'}>{change == null ? '—' : `${change >= 0 ? '+' : ''}${number(change)} (${number(change / bar.open * 100)}%)`}<small> 当前 K 线</small></span></div></div>
        <div className="ohlc-bar">{['open', 'high', 'low', 'close'].map(key => <span key={key}>{key[0].toUpperCase()} <b className={key === 'close' ? change >= 0 ? 'up' : 'down' : ''}>{number(bar?.[key])}</b></span>)}<span>Vol <b>{compact(bar?.volume)}</b></span><span className="ohlc-fill" /><span className="data-badge">{mode === 'demo' ? 'DEMO' : 'REST OHLCV'}</span></div>
        <div className="canvas-wrapper">
          <ChartCanvas key={`${asset}:${symbol}:${timeframe}`} bars={bars} type={type} ma20={ma20} ma50={ma50} mode={mode} livePrice={lastPrice} onHover={setHover} draw={draw} onDrawDone={() => setDraw(false)} chartRef={chartRef} />
        <div className="chart-watermark"><small>{mode === 'demo' ? 'DEMO · 模拟行情' : `${symbol} / ${timeframe}`}</small></div>
          {!bars.length && <div className="chart-empty"><Icon name="chart" /><strong>{history.status === 'loading' ? '正在加载历史行情…' : history.status === 'error' ? '历史行情加载失败' : history.empty ? '这个区间没有 K 线' : '连接你的行情数据'}</strong><p>{history.error || (history.empty ? '尝试更长的历史区间或其他标的' : '使用 LeanData 账户或 Token 开始看盘')}</p><button onClick={() => history.status === 'error' ? setRefresh(n => n + 1) : setDialog(true)}>{history.status === 'error' ? '重新加载' : '连接行情'}</button></div>}
          {draw && <div className="draw-hint">点击价格图添加水平线 · 再次点击工具取消</div>}
        </div>
        {(history.error || history.truncated || stream.error) && <div className="chart-warning" role="alert">{history.error || stream.error || '已显示最近 6,000 根 K 线；所选区间未完全加载。'}{history.error && <button onClick={() => setRefresh(n => n + 1)}>重试</button>}</div>}
        <div className="chart-bottom"><div className="ranges">{(timeframe === '1D' ? [[31, '1M'], [90, '3M'], [365, '1Y']] : [[1, '1D'], [5, '5D'], [31, '1M']]).map(([value, label]) => <button key={value} className={days === value ? 'active' : ''} onClick={() => setDays(value)}>{label}</button>)}<button onClick={() => chartRef.current?.chart.timeScale().scrollToRealTime()}>最新 ↗</button></div><span>{history.status === 'loading' ? '历史加载中…' : mode === 'demo' ? '模拟数据 · 未请求后端' : `${bars.length.toLocaleString()} 根 K 线`} <span className="bottom-clock">{clock(now)}</span></span></div>
      </section>

    </div>
    <footer className="chart-footer"><span><i className={mode === 'live' ? 'online-dot' : 'demo-dot'} />{mode === 'demo' ? '演示模式' : 'LeanData REST + WebSocket'}<span className="footer-divider">/</span> {mode === 'live' ? `最新事件 ${clock(lastEvent)}` : '连接账户，开始看盘'}</span><span>Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a><a className="license-link" href="/vendor/chart-licenses.txt">License</a></span></footer>
    </main>
    {dialog && <div className="dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) { setDialog(false); setTokenInput(''); } }}><section role="dialog" aria-modal="true" aria-labelledby="connect-title" className="connect-dialog" onKeyDown={e => { if (e.key === 'Escape') { setDialog(false); setTokenInput(''); } }}><button className="dialog-close" aria-label="关闭连接设置" onClick={() => { setDialog(false); setTokenInput(''); }}><Icon name="close" /></button><div className="panel-eyebrow">CONNECT YOUR FEED</div><h2 id="connect-title">连接 LeanData 行情</h2><p>使用现有账户权限，加载历史 K 线和实时成交报价。</p><button className="account-connect" onClick={useAccount} disabled={accountBusy}>{accountBusy ? '正在读取账户…' : '使用已登录账户 →'}</button><div className="dialog-or">或使用已有 Token</div><form onSubmit={e => { e.preventDefault(); connect(tokenInput); }}><label htmlFor="chart-token">LeanData Token</label><input autoFocus id="chart-token" type="password" autoComplete="off" value={tokenInput} onChange={e => setTokenInput(e.target.value)} placeholder="粘贴 Token" maxLength="2048" /><p className="token-note">Token 仅保留在本页内存，刷新后清除。</p>{dialogError && <p className="dialog-error" role="alert">{dialogError}</p>}<button className="primary-button" type="submit">连接 REST + WS <span>↗</span></button></form><div className="dialog-links"><a href="/account" target="_blank" rel="noreferrer">登录 / 查看 Token ↗</a><button onClick={() => { setToken(''); setMode('demo'); setDialog(false); setTokenInput(''); }}>演示界面</button>{mode === 'live' && <button onClick={() => { setToken(''); setMode('idle'); setDialog(false); setTokenInput(''); }}>断开连接</button>}</div></section></div>}
  </div>;
}
