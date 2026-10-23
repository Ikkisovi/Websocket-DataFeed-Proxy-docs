(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const WINDOWS = [['full', 'Full history'], ['7d', '7 days'], ['14d', '14 days'], ['30d', '30 days']];
const WDAYS = { full: null, '7d': 7, '14d': 14, '30d': 30 };
const ZH = {
  'Full history': '全部历史', '7 days': '近 7 天', '14 days': '近 14 天', '30 days': '近 30 天',
  'IC mean': 'IC 均值', 'ICIR': 'ICIR', 't-stat': 't 值', 'IC > 0': 'IC>0 占比', 'Long-short': '多空', 'Long only': '纯多',
  'Bottom 20%': '末 20%', 'Days': '天数', 'All': '全部', 'Factor': '因子', 'All factors': '全部因子', 'Loading…': '加载中…',
  'Loading factor statistics…': '正在加载因子统计…', 'Formula': '公式', 'What it measures': '含义', 'Measured on our data': '我们的实测',
  'How to read this.': '阅读说明', 'ICIR (daily)': 'ICIR（日度）', 'Sessions': '交易日数', 'Names (latest)': '最新名字数',
  'Portfolio': '组合', 'Cumulative': '累计收益', 'Mean / day': '日均收益', 'Sharpe (ann.)': '年化 Sharpe', 'Max drawdown': '最大回撤',
  'Turnover / day': '日换手', 'Cumulative return': '累计收益曲线', 'Rank IC, rolling mean': '滚动 Rank IC 均值', 'Latest cross-section': '最新截面分布',
  'Daily rank IC': '每日 Rank IC', 'Not enough sessions in this window.': '该窗口内交易日不足。', 'No values.': '无数值。',
  'No finite values on the latest session.': '最新交易日没有有效值。',
  'Long only · top 20%': '纯多 · 前 20%', 'Bottom 20% · the short leg': '末 20% · 空头端', 'Long-short · top − bottom': '多空 · 前 20% 减末 20%',
  '21 sessions': '21 日', 'Search': '搜索', 'Back': '返回', 'Inputs': '输入', 'substitute input': '替代输入', 'Implementation': '实现说明',
  'The source page publishes no formula text for this factor; the implementation notes list its inputs.': '原页面没有给出该因子的公式文本；输入见实现说明。',
  'Computed from one-minute trade bars on the close clock (09:31–16:00 bars).': '由一分钟成交 K 线按收盘口径计算（09:31–16:00 的 K 线）。',
  'Portfolios, equal weight, daily rebalance': '组合：等权、每日调仓',
  'not investable: no costs, daily rebalance, close-to-close marks': '不可直接投资：不计成本、每日调仓、按收盘到收盘计价',
  'newest sessions use Alpaca raw prices; corporate-action days are excluded by the 40% rule': '最新几个交易日使用 Alpaca 未复权价格；公司行为日按 40% 规则剔除',
  'fundamentals are the current restated Morningstar vintage, not original-vintage PIT': '基本面用的是 Morningstar 当前修订版本，不是当时可见的原始版本',
  '7d/14d windows hold few sessions; read n before the value': '7 天、14 天窗口样本很少；先看样本数再看数值',
  'tails clipped to p1–p99 in the plot': '图中尾部截到 p1–p99',
  'NAV': '净值', 'Trend': '走势', 'Long-short NAV': '多空净值', 'Long-only NAV': '纯多净值',
  'Original implementation note (English)': '原始实现说明（英文）',
  'Explanations and symbol notes follow the selected language; formulas retain their original definitions.': '含义与变量释义随语言切换，公式保持原定义。',
};
const siteLang = () => (window.LeandataI18n && window.LeandataI18n.getLanguage && window.LeandataI18n.getLanguage()) || (function () { try { return localStorage.getItem('leandata.language'); } catch (e) { return null; } })() || 'zh';
const lang = { v: siteLang() === 'en' ? 'en' : 'zh' };
const tr = s => lang.v === 'zh' ? (ZH[s] ?? s) : s;
const zhOf = (m, k) => lang.v === 'zh' ? (state.idx.zh[m][k] ?? k) : k;
const ttl = r => lang.v === 'zh' ? (r.title_zh || r.title) : r.title;
function paintShell() {
  const w = document.getElementById('asofw');
  if (w) w.textContent = state.idx ? (lang.v === 'zh' ? `${state.idx.meta.update_policy ? '收盘后自动更新 · ' : ''}信号截至 ${state.idx.meta.last_signal_date} · 收益截至 ${state.idx.meta.last_label_date}` : `${state.idx.meta.update_policy ? 'Updated after the close · ' : ''}signals through ${state.idx.meta.last_signal_date} · returns through ${state.idx.meta.last_label_date}`) : '';
  const t = document.getElementById('fs-title'); if (t) t.textContent = lang.v === 'zh' ? '因子目录实测' : 'Factor Directory Stats';
  const d = document.getElementById('fs-deck'); if (d) d.textContent = lang.v === 'zh' ? '每个因子的覆盖率、Rank IC、五分位纯多/空头/多空组合，可在全部历史与近 7、14、30 天之间切换。' : 'Coverage, rank IC and quintile long-only, short and long-short portfolios for every factor, switchable between full history and the last 7, 14 and 30 days.';
  document.querySelectorAll('.nav a[data-t]').forEach(a => { a.textContent = a.dataset.t.split('|')[lang.v === 'en' ? 1 : 0]; });
  const l = document.querySelector('[data-ld-language-toggle]'); if (l) l.textContent = lang.v === 'en' ? '中文' : 'English';
  document.documentElement.lang = lang.v === 'en' ? 'en' : 'zh-CN';
}
const state = { idx: null, win: 'full', nav: 'ls', sort: 'ic', dir: -1, q: '', cat: 'all', cache: {}, route: 0 };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x, d = 1) => x == null ? '–' : (x * 100).toFixed(d) + '%';
const sgn = x => x == null ? '' : x > 0 ? 'pos' : x < 0 ? 'neg' : '';
const f3 = x => x == null ? '–' : x.toFixed(3);
const f2 = x => x == null ? '–' : x.toFixed(2);
const cls = x => `num ${sgn(x)}`;

function tex(latex, display) {
  try { return window.katex ? katex.renderToString(latex, { output: 'htmlAndMathml', throwOnError: true, trust: false, strict: 'ignore', displayMode: !!display, maxExpand: 1000 }) : `<code>${esc(latex)}</code>`; }
  catch (e) { return `<code>${esc(latex)}</code>`; }
}
function prose(value) {
  const text = String(value || '');
  const math = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)\$/g;
  const plain = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');
  let html = '', end = 0;
  for (const match of text.matchAll(math)) {
    html += plain(text.slice(end, match.index));
    html += tex(match[1] ?? match[2] ?? match[3] ?? match[4], match[1] != null || match[2] != null);
    end = match.index + match[0].length;
  }
  return html + plain(text.slice(end));
}
function formula(value) {
  const s = String(value || '');
  return (/[A-Za-z]{3,}\s+[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(s) || /[\u3400-\u9fff]/.test(s)) && !/[\\_^={}]/.test(s) ? prose(s) : tex(s, true);
}
function sparkline(row) {
  const raw = row.nav_preview?.[state.win]?.[state.nav] || [];
  let carry = null;
  const values = raw.map(v => { if (Number.isFinite(v)) carry = v; return carry; });
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return '<span class="dim">–</span>';
  let lo = Math.min(1,...finite), hi = Math.max(1,...finite); if (hi === lo) { lo -= .01; hi += .01; }
  const X = i => 3 + i * 132 / Math.max(1,values.length-1), Y = v => 35 - (v-lo)/(hi-lo)*30;
  let d = '', pen = false;
  values.forEach((v,i) => { if (v == null) { pen=false; return; } d += `${pen?'L':'M'}${X(i).toFixed(2)},${Y(v).toFixed(2)}`; pen=true; });
  const label = `${tr(state.nav === 'ls' ? 'Long-short NAV' : 'Long-only NAV')} · ${tr(WINDOWS.find(w=>w[0]===state.win)[1])}`;
  return `<svg class="nav-spark ${finite.at(-1)>=1?'pos':'neg'}" viewBox="0 0 138 40" role="img" aria-label="${esc(label)}"><title>${esc(label)} · ${finite.at(-1).toFixed(3)}</title><line x1="3" x2="135" y1="${Y(1)}" y2="${Y(1)}" class="nav-base"/><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

async function load() {
  const r = await fetch('/reports/factor-stats/data/index.json', { credentials: 'same-origin', cache: 'no-store' });
  if (!r.ok) { const e = new Error(r.status === 401 || r.status === 403 ? 'access' : 'http ' + r.status); e.status = r.status; throw e; }
  state.idx = await r.json();
  const m = state.idx.meta;
  paintShell(); route();
}
const signIn = () => `/account?next=${encodeURIComponent(location.pathname + location.hash)}`;
const accessMessage = () => `<div class="empty">${lang.v === 'zh' ? '登录已过期，或当前套餐不含研究报告。' : 'Your session expired, or your plan does not include research reports.'} <a href="${signIn()}">${lang.v === 'zh' ? '重新登录' : 'Sign in again'}</a> · <a href="/reports/">${lang.v === 'zh' ? '返回研究报告' : 'Back to reports'}</a></div>`;
async function factor(id) {
  const row = state.idx.factors.find(r => r.id === id);
  if (!row) throw new Error('unknown factor');
  if (!state.cache[row.shard]) {
    // A failed shard (expired session, network) is not cached, so the next open retries it.
    const version = state.idx.meta.snapshot_id;
    const query = version ? `?v=${encodeURIComponent(version)}` : '';
    state.cache[row.shard] = fetch(`/reports/factor-stats/data/s${row.shard}.json${query}`, { credentials: 'same-origin', cache: 'no-store' }).then(r => {
      if (!r.ok) { const e = new Error(r.status === 401 || r.status === 403 ? 'access' : 'http ' + r.status); e.status = r.status; throw e; }
      return r.json();
    }).catch(e => { delete state.cache[row.shard]; throw e; });
  }
  return (await state.cache[row.shard])[id];
}



function carryNote() {
  const mc = state.idx.meta.membership_carry;
  if (!mc || !mc.sessions) return '';
  const ds = mc.dates, runs = []; let start = ds[0], prev = ds[0];
  const gap = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5 > 5;
  for (const d of ds.slice(1)) { if (gap(prev, d)) { runs.push([start, prev]); start = d; } prev = d; }
  runs.push([start, prev]);
  const big = runs.filter(r => (Date.parse(r[1]) - Date.parse(r[0])) / 864e5 > 14).map(r => `${r[0]}–${r[1]}`).join(L('、', ', '));
  return `<li>${L(`成员池口径：成员为 SPY 与 QQQ 当日开盘前可知的持仓并集。其中 ${mc.sessions} 个交易日的持仓快照无法确认（${big} 等），我们沿用前一交易日的成员，并仍按当日价格与因子值统计。这是我们的做法，不是原始成员记录。`,
    `Universe: members are the union of SPY and QQQ holdings known before the open. On ${mc.sessions} sessions (${big} and others) a holdings snapshot could not be resolved; we carry the previous session’s members and still score those days on their own prices and factor values. This is our convention, not an original membership record.`)}</li>`;
}
/* ---------- replication with the Leandata API ---------- */
const L = (zh, en) => lang.v === 'zh' ? zh : en;
const MS_NATIVE = { cash: 'cash_and_equivalents', current_assets: 'current_assets_3m', current_liabilities: 'current_liabilities_3m',
  free_cash_flow_3m: 'free_cash_flow_3m', goodwill: 'goodwill_3m', gross_profit_3m: 'gross_profit_3m', intangible_assets: 'other_intangible_assets_3m',
  inventory: 'inventory_3m', net_income_3m: 'net_income_3m', net_receivables: 'receivables_3m', operating_cash_flow_3m: 'operating_cash_flow_3m',
  operating_income_3m: 'operating_income_3m', retained_earnings: 'retained_earnings_3m', revenue_3m: 'total_revenue_3m', stockholders_equity: 'stockholders_equity',
  total_assets: 'total_assets', total_debt: 'total_debt_3m', total_liabilities: 'total_liabilities',
  weighted_average_shares_basic: 'basic_average_shares_3m', weighted_average_shares_diluted: 'diluted_average_shares_3m', market_cap: 'market_cap', shares_outstanding: 'shares_outstanding' };
const MS_TTM = { basic_eps_ttm: 'basic_eps_3m', diluted_eps_ttm: 'diluted_eps_3m', gross_profit_ttm: 'gross_profit_3m', net_income_ttm: 'net_income_3m',
  operating_income_ttm: 'operating_income_3m', revenue_ttm: 'total_revenue_3m', selling_general_admin_ttm: 'sga_3m' };
const MDAY = {
  tail_vol_share: ['volume in the last 30 minutes ÷ session volume', '最后 30 分钟成交量 ÷ 全天成交量'],
  rv: ['sum of squared 5-minute log returns', '5 分钟对数收益平方和'],
  rv_up: ['sum of squared positive 5-minute log returns', '5 分钟正对数收益平方和'],
  iskew: ['sqrt(N)·Σ(r−mean)³ / (Σ(r−mean)²)^1.5 on 5-minute log returns', '5 分钟对数收益的偏度 sqrt(N)·Σ(r−mean)³ / (Σ(r−mean)²)^1.5'],
  shortcut_illiq: ['Σ over 5-minute buckets of (2·(H−L)−|C−O|) ÷ dollar volume', '各 5 分钟桶 (2·(H−L)−|C−O|) ÷ 成交额 之和'],
  pv_corr: ['correlation of 1-minute close and volume', '1 分钟收盘价与成交量的相关系数'],
  vol_std: ['std of 1-minute volume over the whole session grid (a missing minute counts as 0)', '全天分钟网格上分钟成交量的标准差（缺失分钟记 0）'],
  px_noon: ['last trade close at or before 12:00', '12:00 及之前最后一笔成交的收盘价'],
  px_last: ['last trade close of the session', '当日最后一笔成交的收盘价'] };
function replicateCard(rec) {
  const req = rec.requires || [];
  const isLeaf = rec.id.startsWith('fm_');
  const rows = []; const fields = new Set(); let bars = false, minute = false, fund = false, universe = false;
  const add = (inp, how) => rows.push(`<tr><td class="mono">${esc(inp)}</td><td>${how}</td></tr>`);
  const PX = { open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v', vwap: 'vw' };
  for (const q of req) {
    if (PX[q]) { bars = true; add(q, L(`<code>POST /v1/history/bars</code>，<code>timeframe=1Day</code>，字段 <code>${PX[q]}</code>`, `<code>POST /v1/history/bars</code>, <code>timeframe=1Day</code>, field <code>${PX[q]}</code>`)); }
    else if (q === 'ret') { bars = true; add(q, L('复权收盘价的日收益：<code>c / c.shift(1) − 1</code>', 'daily return of the adjusted close: <code>c / c.shift(1) − 1</code>')); }
    else if (q === 'amount') { bars = true; add(q, L('成交额 = <code>v × vw</code>（无 vwap 时用 <code>c</code>）', 'dollar volume = <code>v × vw</code> (<code>c</code> when vwap is missing)')); }
    else if (q === 'turnover') { bars = true; fund = true; fields.add('shares_outstanding'); add(q, L('<code>v ÷ shares_outstanding</code>', '<code>v ÷ shares_outstanding</code>')); }
    else if (q === 'market_cap') { fund = true; fields.add('market_cap'); add(q, L('Morningstar 日频字段 <code>market_cap</code>（我们的口径：拆股复权、未做分红调整的收盘价 × 观测股本）', 'Morningstar daily field <code>market_cap</code> (ours: split-adjusted, dividend-unadjusted close × observed shares)')); }
    else if (q === 'shares') { fund = true; fields.add('shares_outstanding'); add(q, L('Morningstar 日频字段 <code>shares_outstanding</code>', 'Morningstar daily field <code>shares_outstanding</code>')); }
    else if (q === 'member') { universe = true; add(q, L('<code>GET /v1/universes/NDX_SPX/snapshots/current</code>（当前成员；我们历史用的是 SPY+QQQ 持仓的逐日成员）', '<code>GET /v1/universes/NDX_SPX/snapshots/current</code> (current members; our history uses day-by-day SPY+QQQ holdings)')); }
    else if (q === 'mkt_ret') { bars = true; fund = true; fields.add('market_cap'); add(q, L('成员的市值加权日收益，权重用上一交易日的 <code>market_cap</code>', 'member return weighted by the previous session <code>market_cap</code>')); }
    else if (q === 'sectors') add(q, L('静态行业分类（不是接口字段，请用自己的行业表）', 'static sector labels (not an endpoint field; use your own sector table)'));
    else if (q.startsWith('mday.')) { minute = true; const d = MDAY[q.slice(5)]; add(q, L(`<code>POST /v1/history/bars</code>，<code>timeframe=1Min</code>，仅常规交易时段成交分钟：${d ? d[1] : ''}`, `<code>POST /v1/history/bars</code>, <code>timeframe=1Min</code>, regular-hours trade minutes only: ${d ? d[0] : ''}`)); }
    else if (q === 'ms_enterprise_value') { fund = true; ['market_cap', 'total_debt_3m', 'cash_and_equivalents'].forEach(f => fields.add(f)); add(q, L('<code>market_cap + total_debt_3m − cash_and_equivalents</code>', '<code>market_cap + total_debt_3m − cash_and_equivalents</code>')); }
    else if (q.startsWith('ms_')) {
      const k = q.slice(3);
      if (MS_NATIVE[k]) { fund = true; fields.add(MS_NATIVE[k]); add(q, L(`Morningstar 日频字段 <code>${MS_NATIVE[k]}</code>`, `Morningstar daily field <code>${MS_NATIVE[k]}</code>`)); }
      else if (MS_TTM[k]) { fund = true; fields.add(MS_TTM[k]); add(q, L(`最近连续四个季度 <code>${MS_TTM[k]}</code> 之和（相邻报告间隔 70–115 天，缺季则不可用）`, `sum of the last four consecutive quarterly <code>${MS_TTM[k]}</code> reports (70–115 days apart; a missing quarter makes it unavailable)`)); }
      else add(q, L('Morningstar 日频字段（见字段表）', 'Morningstar daily field (see the field table)'));
    } else add(q, '–');
  }
  if (isLeaf) { minute = true; add('minute bars', L('分钟 K 线：<code>POST /v1/history/bars</code>，<code>timeframe=1Min</code>；收盘时钟，只用 15:59 及之前的成交分钟', 'minute bars: <code>POST /v1/history/bars</code>, <code>timeframe=1Min</code>; close clock, trade minutes up to 15:59 only')); }
  const snippet = [
    'import requests, pandas as pd',
    'API, H = "https://api.leandata.uk", {"Authorization": "Bearer <TOKEN>"}',
    universe ? 'snap = requests.get(f"{API}/v1/universes/NDX_SPX/snapshots/current", headers=H).json()\nsymbols = sorted({m["symbol"]["value"] for c in snap["components"] for m in c["members"]})' : 'symbols = ["AAPL", "MSFT"]  # your universe',
    bars ? 'r = requests.post(f"{API}/v1/history/bars", headers=H, json={"symbol": ",".join(symbols[:100]), "timeframe": "1Day",\n                                                        "start": "2015-01-01", "end": "2026-10-23"}).json()\nclose = pd.DataFrame({s: pd.Series({b["t"][:10]: b["c"] for b in v}) for s, v in r["bars"].items()})' : '',
    minute ? '# minute bars: same call with "timeframe": "1Min", one session per request for large universes' : '',
    fund ? `f = requests.get(f"{API}/v1/fundamentals/morningstar/daily/history", headers=H,\n                 params={"symbols": ",".join(symbols[:100]), "fields": "${[...fields].join(',')}",\n                         "start": "2015-01-01", "end": "2026-10-23"}).json()["rows"]` : '',
  ].filter(Boolean).join('\n');
  return `<section class="card repl"><h2>${L('如何用 Leandata 接口复现这个因子', 'Replicate this factor with the Leandata API')}</h2>
    <p>${L(`所需输入如下；公式见上方，回看 ${rec.lookback_sessions || 1} 个交易日。接口在 <a href="/docs/market/stocks/">股票行情</a>、<a href="/docs/financial/morningstar/">Morningstar 财务</a>、<a href="/docs/universes/">成员列表</a> 文档中。`,
      `Inputs are listed below; the formula is above and looks back ${rec.lookback_sessions || 1} sessions. Endpoints are documented under <a href="/docs/market/stocks/">stock bars</a>, <a href="/docs/financial/morningstar/">Morningstar financials</a> and <a href="/docs/universes/">universe lists</a>.`)}</p>
    <div class="tbl"><table><thead><tr><th>${L('输入', 'Input')}</th><th>${L('取数方式', 'How to get it')}</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
    <pre class="code"><code>${esc(snippet)}</code></pre>
    <h3>${L('评估口径（与本页统计一致）', 'Evaluation recipe (matches the statistics on this page)')}</h3>
    <ul>
      <li>${L('用同一个交易日的收盘数据算因子；标签是下一交易日的收盘到收盘收益；收益超过 ±40% 的样本剔除（视为公司行为）。', 'Compute the factor from that session’s close data; the label is the next session’s close-to-close return; samples beyond ±40% are dropped as corporate actions.')}</li>
      <li>${L('每日横截面 Spearman Rank IC（至少 30 只有效股票）；因子最高 20% 等权做多、最低 20% 等权做空，每日调仓，不计成本。', 'Daily cross-sectional Spearman rank IC (at least 30 valid names); equal-weight the top 20% as the long leg and the bottom 20% as the short leg, rebalanced daily, no costs.')}</li>
      <li>${L('因子为 NaN 或无穷时视为缺失，不是 0；IC 在两边都有限的股票上重新排序。', 'NaN or infinite factor values are missing, not zero; IC re-ranks on names finite on both sides.')}</li>
      <li>${L('你的结果会与本页略有差异：我们的历史用 QuantConnect 复权价、Morningstar 当前修订版本和逐日 SPY+QQQ 持仓成员；接口返回的是当前版本与当前成员。', 'Your numbers will differ slightly: our history uses QuantConnect-adjusted prices, the current restated Morningstar vintage and day-by-day SPY+QQQ holdings; the endpoints return the current vintage and current members.')}</li>
    </ul></section>`;
}

/* ---------- list ---------- */
const COLS = [
  ['ic', 'IC mean', r => r.summary[state.win].ic.mean, v => f3(v)],
  ['icir', 'ICIR', r => r.summary[state.win].ic.icir, v => f2(v)],
  ['t', 't-stat', r => r.summary[state.win].ic.t, v => f2(v)],
  ['hit', 'IC > 0', r => r.summary[state.win].ic.hit, v => pct(v, 0), true],
  ['ls', 'Long-short', r => r.summary[state.win].ls.cum, v => pct(v)],
  ['long', 'Long only', r => r.summary[state.win].long.cum, v => pct(v)],
  ['short', 'Bottom 20%', r => r.summary[state.win].short.cum, v => pct(v)],
  ['n', 'Days', r => r.summary[state.win].ic.n, v => v ?? '–', true],
];
function renderList() {
  const rows = state.idx.factors;
  const cats = ['all', ...[...new Set(rows.map(r => r.category))].sort()];
  const q = state.q.toLowerCase();
  let list = rows.filter(r => (state.cat === 'all' || r.category === state.cat) &&
    (!q || (r.title + ' ' + (r.title_zh || '')).toLowerCase().includes(q) || r.id.includes(q) || r.tags.join(' ').toLowerCase().includes(q)));
  const col = COLS.find(c => c[0] === state.sort) || COLS[0];
  list.sort((a, b) => {
    const x = col[2](a), y = col[2](b);
    if (x == null) return 1; if (y == null) return -1;
    return (x - y) * state.dir;
  });
  const app = $('#app');
  app.innerHTML = `
    <div class="controls">
      <input id="q" type="search" placeholder="${lang.v === 'zh' ? `在 ${rows.length} 个因子中按名称、编号或标签搜索` : `Search ${rows.length} factors by name, id or tag`}" value="${esc(state.q)}" aria-label="${tr('Search')}">
      <div class="seg" role="group" aria-label="Window">${WINDOWS.map(([k, l]) => `<button data-win="${k}" aria-pressed="${state.win === k}">${tr(l)}</button>`).join('')}</div>
      <div class="seg nav-choice" role="group" aria-label="${tr('Trend')}">${[['ls','Long-short'],['long','Long only']].map(([key,label])=>`<button data-nav="${key}" aria-pressed="${state.nav===key}">${tr(label)}</button>`).join('')}</div>
    </div>
    <div class="chips">${cats.map(c => `<button class="chip" data-cat="${c}" aria-pressed="${state.cat === c}">${c === 'all' ? tr('All') : esc(zhOf('categories', c))}</button>`).join('')}</div>
    <div class="count">${lang.v === 'zh' ? `${list.length} 个因子 · ${tr(WINDOWS.find(w => w[0] === state.win)[1])} · 五分位组合，不计成本` : `${list.length} factors · ${WINDOWS.find(w => w[0] === state.win)[1].toLowerCase()} · quintile portfolios, no costs`}</div>
    <div class="tbl"><table><thead><tr><th>${tr('Factor')}</th><th class="nav-column">${tr(state.nav==='ls'?'Long-short NAV':'Long-only NAV')}</th>${COLS.map(c => `<th data-sort="${c[0]}" ${state.sort === c[0] ? `aria-sort="${state.dir < 0 ? 'descending' : 'ascending'}"` : ''}>${tr(c[1])}${state.sort === c[0] ? (state.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>
    <tbody>${list.map(r => `<tr data-id="${r.id}" tabindex="0"><td>${esc(ttl(r))}<span class="id">${r.id}</span></td><td class="nav-column">${sparkline(r)}</td>${COLS.map(c => { const v = c[2](r); return `<td class="n ${c[4] ? '' : sgn(v)}">${c[3](v)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  const qi = $('#q'); qi.addEventListener('input', e => { state.q = e.target.value; const pos = e.target.selectionStart; renderList(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
  app.querySelectorAll('[data-win]').forEach(b => b.onclick = () => { state.win = b.dataset.win; renderList(); });
  app.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { state.cat = b.dataset.cat; renderList(); });
  app.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { state.nav = b.dataset.nav; renderList(); });
  app.querySelectorAll('th[data-sort]').forEach(h => h.onclick = () => { state.dir = state.sort === h.dataset.sort ? -state.dir : -1; state.sort = h.dataset.sort; renderList(); });
  app.querySelectorAll('tbody tr').forEach(t => { const go = () => { location.hash = t.dataset.id; }; t.onclick = go; t.onkeydown = e => { if (e.key === 'Enter') go(); }; });
}

/* ---------- charts ---------- */
function windowStart(dates, days) {
  if (days == null) return 0;
  const last = new Date(dates[dates.length - 1] + 'T00:00:00Z').getTime() - days * 864e5;
  let i = 0; while (i < dates.length && new Date(dates[i] + 'T00:00:00Z').getTime() <= last) i++;
  return i;
}
function lineChart(el, dates, lines, fmt) {
  const W = 560, H = 230, L = 46, R = 10, T = 8, B = 22;
  const n = dates.length; if (n < 2) { el.innerHTML = `<div class="empty">${tr('Not enough sessions in this window.')}</div>`; return; }
  let lo = Infinity, hi = -Infinity;
  lines.forEach(l => l.y.forEach(v => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
  if (!isFinite(lo)) { el.innerHTML = `<div class="empty">${tr('No values.')}</div>`; return; }
  lo = Math.min(lo, 0); hi = Math.max(hi, 0); if (hi === lo) hi = lo + 1; const pad = (hi - lo) * .06; lo -= pad; hi += pad;
  const X = i => L + (W - L - R) * i / (n - 1), Y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const ticks = 4, ty = Array.from({ length: ticks + 1 }, (_, k) => lo + (hi - lo) * k / ticks);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  ty.forEach(v => { s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${fmt(v)}</text>`; });
  s += `<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3"/>`;
  [0, Math.floor((n - 1) / 2), n - 1].forEach((i, k) => { s += `<text x="${X(i)}" y="${H - 5}" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}">${dates[i]}</text>`; });
  lines.forEach(l => {
    let d = '', pen = false;
    l.y.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; });
    s += `<path d="${d}" fill="none" stroke="${l.color}" stroke-width="${l.w || 1.6}" stroke-linejoin="round"/>`;
    const li = l.y.length - 1 - [...l.y].reverse().findIndex(v => v != null);
    if (l.y[li] != null) s += `<circle cx="${X(li)}" cy="${Y(l.y[li])}" r="3" fill="${l.color}"/>`;
  });
  s += `<line id="cur" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/></svg><div class="tip" hidden></div>`;
  el.innerHTML = s;
  const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), cur = el.querySelector('#cur');
  svg.addEventListener('pointermove', e => {
    const r = svg.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(n - 1, Math.round((x - L) / (W - L - R) * (n - 1))));
    cur.setAttribute('x1', X(i)); cur.setAttribute('x2', X(i)); cur.setAttribute('visibility', 'visible');
    tip.hidden = false; tip.innerHTML = `${dates[i]}<br>` + lines.map(l => `${l.name} ${l.y[i] == null ? '–' : fmt(l.y[i])}`).join('<br>');
    tip.style.left = Math.min(r.width - 150, Math.max(0, e.clientX - r.left + 10)) + 'px'; tip.style.top = '8px';
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; cur.setAttribute('visibility', 'hidden'); });
}
function barChart(el, labels, vals, colorFn, fmt, edgeLabels) {
  const W = 560, H = 190, L = 46, R = 10, T = 8, B = 22, n = vals.length;
  const mx = Math.max(...vals, 1), bw = (W - L - R) / n;
  const Y = v => T + (H - T - B) * (1 - v / mx);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  [0, mx / 2, mx].forEach(v => { s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${Math.round(v)}</text>`; });
  vals.forEach((v, i) => { s += `<rect x="${L + i * bw + 1}" y="${Y(v)}" width="${Math.max(1, bw - 2)}" height="${H - B - Y(v)}" fill="${colorFn(i)}"><title>${labels[i]}: ${v}</title></rect>`; });
  edgeLabels.forEach(([i, a, t]) => { s += `<text x="${L + i * bw}" y="${H - 5}" text-anchor="${a}">${t}</text>`; });
  el.innerHTML = s + '</svg>';
}

/* ---------- detail ---------- */
async function renderDetail(id) {
  const renderId = ++state.route;
  const app = $('#app'); app.innerHTML = `<div class="empty">${tr('Loading…')}</div>`;
  let rec; try { rec = await factor(id); } catch (e) { if (e.message === 'access') { app.innerHTML = accessMessage(); return; } app.innerHTML = `<div class="empty">${lang.v === 'zh' ? `没有名为 ${esc(id)} 的因子。<a href="#">返回列表</a>` : `No factor named ${esc(id)}. <a href="#">Back to the list</a>`}</div>`; return; }
  document.title = (lang.v === 'zh' && rec.page.title_zh ? rec.page.title_zh : rec.page.title) + ' · Factor Directory Stats';
  if (renderId !== state.route) return;
  const p = lang.v==='zh' && rec.page.localized?.zh ? {...rec.page,...rec.page.localized.zh} : rec.page;
  const fs = p.formulas.filter(f => f.latex);
  const defn = `
    <div class="defn">
      <section class="card"><h3>${tr('Formula')}</h3>
        ${fs.length ? fs.map(f => `<div class="formula"><div class="cap">${prose(f.text || '')}</div>${formula(f.latex)}</div>`).join('') : rec.id.startsWith('fm_') ? `<p class="expl">${tr('Computed from one-minute trade bars on the close clock (09:31–16:00 bars).')}</p>` : `<p class="dim">${tr('The source page publishes no formula text for this factor; the implementation notes list its inputs.')}</p>`}
        ${p.intro ? `<p class="dim" style="margin:8px 0 12px">${prose(p.intro)}</p>` : ''}
        ${p.symbols.length ? `<dl class="sym">${p.symbols.map(s => `<dt>${/[\\^_{}]/.test(s.symbol) ? tex(s.symbol, false) : prose(s.symbol)}</dt><dd>${prose(s.meaning)}</dd>`).join('')}</dl>` : ''}
      </section>
      <section class="card"><h3>${tr('What it measures')}</h3><div class="expl">${prose(p.explanation || rec.note)}</div>
        <p class="dim" style="margin:12px 0 0;font-size:12.5px">${tr('Inputs')}: ${rec.requires.map(r => `<span class="mono">${esc(r)}</span>`).join(', ') || '–'}${rec.proxy ? ` · ${tr('substitute input')}: ${esc(rec.proxy)}` : ''}</p>
        ${rec.note && p.explanation && p.explanation !== rec.note ? (lang.v==='zh' ? `<details class="implementation-note"><summary>${tr('Original implementation note (English)')}</summary><p>${prose(rec.note)}</p></details>` : `<p class="dim implementation-note">${tr('Implementation')}: ${prose(rec.note)}</p>`) : ''}</section>
    </div>`;
  app.innerHTML = `
    <div class="crumb"><a href="#">← ${tr('All factors')}</a></div>
    <h2 class="title">${esc(lang.v === 'zh' && p.title_zh ? p.title_zh : p.title)}</h2>
    <div class="tags"><span class="tag mono">${esc(rec.id)}</span>${p.tags.map(t => `<span class="tag">${esc(zhOf('tags', t))}</span>`).join('')}<span class="tag alt">${esc(zhOf('families', rec.family))}</span></div>
    ${defn}
    <div class="measured"><h2>${tr('Measured on our data')}</h2><div class="seg" role="group" aria-label="Window">${WINDOWS.map(([k, l]) => `<button data-win="${k}" aria-pressed="${state.win === k}">${tr(l)}</button>`).join('')}</div></div>
    <div id="measure"></div>
    ${replicateCard(rec)}
    <div class="notes"><strong>${tr('How to read this.')}</strong><ul>${state.idx.meta.caveats.map(c => `<li>${esc(tr(c))}</li>`).join('')}
      <li>${tr('Explanations and symbol notes follow the selected language; formulas retain their original definitions.')}</li>
      <li>${lang.v === 'zh' ? '标签：次日收盘到收盘收益；因子值最高的 20% 为纯多，最低的 20% 为末 20%，多空为两者之差；保持因子自然符号，不翻转。' : `Label: ${esc(state.idx.meta.label)}; the 20% of names with the highest factor value form Long only, the lowest 20% form Bottom 20%; Long-short is the difference. The factor's natural sign is kept.`}</li>
      ${carryNote()}
      <li>${lang.v === 'zh' ? `成员覆盖率 ${pct(rec.coverage, 1)}；首个有效交易日 ${esc(rec.first_valid)}。` : `Coverage on members: ${pct(rec.coverage, 1)}; first valid session ${esc(rec.first_valid)}.`}</li>
      ${rec.latest_names != null ? `<li>${lang.v === 'zh' ? `最近有效因子日期 ${esc(rec.last_signal_date || '–')}；最新交易日有值 ${rec.latest_names} 只。` : `Latest finite factor date ${esc(rec.last_signal_date || '–')}; ${rec.latest_names} names available on the latest session.`}</li>` : ''}</ul></div>`;
  app.querySelectorAll('[data-win]').forEach(b => b.onclick = () => { state.win = b.dataset.win; app.querySelectorAll('[data-win]').forEach(x => x.setAttribute('aria-pressed', x.dataset.win === state.win)); renderMeasure(rec); });
  renderMeasure(rec);
}
function renderMeasure(rec) {
  const w = state.win, S = rec.summary[w];
  const all = state.idx.dates, bp = a => a.map(v => v == null ? null : v / 1e4);
  const ser = { ic: bp(rec.series.ic), long: bp(rec.series.long), short: bp(rec.series.short), names: [rec.series.names_last] };
  ser.ls = ser.long.map((v, i) => v == null || ser.short[i] == null ? null : v - ser.short[i]);
  const i0 = windowStart(all, WDAYS[w]);
  const dates = all.slice(i0);
  const cum = a => { let e = 1; return a.slice(i0).map(v => { e *= 1 + (v ?? 0); return e - 1; }); };
  const rollAll = k => { const seen = []; return ser.ic.map(v => { if (v != null) seen.push(v); const xs = seen.slice(-k); return xs.length >= Math.max(2, Math.floor(k / 2)) ? xs.reduce((m, x) => m + x, 0) / xs.length : null; }); };
  const roll = k => rollAll(+k).slice(i0);
  const small = S.ic.n < 20;
  const missing = ser.ls.slice(i0).filter(v => v == null).length;
  const gapNote = missing ? `<div class="dim" style="font-size:12px;margin-top:6px">${lang.v === 'zh' ? `其中 ${missing} 个交易日没有可用截面（因子尚无值、成员池为空或不足 30 只），净值在这些日子按持平处理。` : `${missing} sessions in this window have no usable cross-section (factor not yet defined, empty universe, or fewer than 30 names); the curve is held flat on those days.`}</div>` : '';
  const pf = (name, d) => `<tr><td>${name}</td><td class="n ${sgn(d.cum)}">${pct(d.cum, 2)}</td><td class="n ${sgn(d.mean)}">${pct(d.mean, 3)}</td><td class="n ${sgn(d.sharpe)}">${f2(d.sharpe)}</td><td class="n neg">${pct(d.mdd, 1)}</td><td class="n">${d.turnover == null ? '–' : pct(d.turnover, 0)}</td></tr>`;
  $('#measure').innerHTML = `
    ${small ? `<div class="warn">${lang.v === 'zh' ? `该窗口只有 ${S.ic.n} 个交易日，数值只描述这几天，不是稳定估计。` : `Only ${S.ic.n} sessions in this window. Treat the numbers as a description of those days, not as a stable estimate.`}</div>` : ''}
    <div class="stats">
      <div class="stat"><div class="k">${tr('IC mean')}</div><div class="v ${sgn(S.ic.mean)}">${f3(S.ic.mean)}</div></div>
      <div class="stat"><div class="k">${tr('ICIR (daily)')}</div><div class="v">${f2(S.ic.icir)}</div></div>
      <div class="stat"><div class="k">${tr('t-stat')}</div><div class="v">${f2(S.ic.t)}</div></div>
      <div class="stat"><div class="k">${tr('IC > 0')}</div><div class="v">${pct(S.ic.hit, 0)}</div></div>
      <div class="stat"><div class="k">${tr('Sessions')}</div><div class="v">${S.ic.n}</div></div>
      <div class="stat"><div class="k">${tr('Names (latest)')}</div><div class="v">${ser.names[0]}</div></div>
    </div>
    <section class="card pf"><h3>${tr('Portfolios, equal weight, daily rebalance')}</h3><table><thead><tr><th>${tr('Portfolio')}</th><th>${tr('Cumulative')}</th><th>${tr('Mean / day')}</th><th>${tr('Sharpe (ann.)')}</th><th>${tr('Max drawdown')}</th><th>${tr('Turnover / day')}</th></tr></thead><tbody>
      ${pf(tr('Long only · top 20%'), S.long)}${pf(tr('Bottom 20% · the short leg'), S.short)}${pf(tr('Long-short · top − bottom'), { ...S.ls, turnover: (S.long.turnover != null && S.short.turnover != null) ? (S.long.turnover + S.short.turnover) / 2 : null })}
    </tbody></table></section>
    <div class="grid2">
      <section class="card"><h3>${tr('Cumulative return')}</h3><div class="legend"><span><i style="background:var(--pos)"></i>${tr('Long only')}</span><span><i style="background:var(--neg)"></i>${tr('Bottom 20%')}</span><span><i style="background:var(--accent)"></i>${tr('Long-short')}</span></div><div class="plot" id="c1"></div>${gapNote}</section>
      <section class="card"><h3>${tr('Rank IC, rolling mean')}</h3><div class="legend"><span><i style="background:var(--accent)"></i>${tr('21 sessions')}</span><span><i style="background:var(--pos)"></i>10</span><span><i style="background:var(--neg)"></i>5</span></div><div class="plot" id="c2"></div></section>
      <section class="card"><h3>${tr('Latest cross-section')}</h3><div id="c3"></div><div class="dim mono" id="c3n" style="font-size:12px;margin-top:6px"></div></section>
      <section class="card"><h3>${tr('Daily rank IC')}</h3><div class="plot" id="c4"></div></section>
    </div>`;
  lineChart($('#c1'), dates, [
    { name: 'Long', y: cum(ser.long), color: 'var(--pos)' }, { name: 'Bottom', y: cum(ser.short), color: 'var(--neg)' },
    { name: 'L-S', y: cum(ser.ls), color: 'var(--accent)', w: 2 }], v => pct(v, 0));
  lineChart($('#c2'), dates, [{ name: '5', y: roll('5'), color: 'var(--neg)', w: 1 }, { name: '10', y: roll('10'), color: 'var(--pos)', w: 1 }, { name: '21', y: roll('21'), color: 'var(--accent)', w: 2 }], v => v.toFixed(3));
  const icv = ser.ic.slice(i0);
  lineChart($('#c4'), dates, [{ name: 'IC', y: icv, color: 'var(--accent)', w: 1 }], v => v.toFixed(2));
  const d = rec.dist;
  if (d) {
    barChart($('#c3'), d.hist.map((_, i) => `${d.edges[i].toPrecision(3)} to ${d.edges[i + 1].toPrecision(3)}`), d.hist, () => 'var(--accent)', v => v,
      [[0, 'start', d.edges[0].toPrecision(3)], [15, 'middle', d.q[3].toPrecision(3)], [29, 'end', d.edges[30].toPrecision(3)]]);
    $('#c3n').textContent = `n ${d.n} · mean ${d.mean.toPrecision(3)} · sd ${d.std.toPrecision(3)} · p1 ${d.q[0].toPrecision(3)} · median ${d.q[3].toPrecision(3)} · p99 ${d.q[6].toPrecision(3)} · ${tr('tails clipped to p1–p99 in the plot')}`;
  } else $('#c3').innerHTML = `<div class="empty">${tr('No finite values on the latest session.')}</div>`;
}

function route() {
  ++state.route;
  const id = decodeURIComponent(location.hash.slice(1));
  if (id && /^[A-Za-z0-9_.~-]+$/.test(id)) renderDetail(id); else { document.title = 'Factor Directory Stats'; renderList(); }
}
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
window.addEventListener('leandata:languagechange', () => { lang.v = siteLang() === 'en' ? 'en' : 'zh'; if (state.idx) { paintShell(); route(); } });
load().catch(e => { $('#app').innerHTML = e.message === 'access' ? accessMessage() : `<div class="empty">Could not load the statistics / 无法加载统计：${esc(e.message)}</div>`; });

})();
