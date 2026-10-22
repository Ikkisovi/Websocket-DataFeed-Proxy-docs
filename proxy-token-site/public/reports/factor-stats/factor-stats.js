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
  'Explanations and symbol notes come from the source page and are shown in English.': '含义和符号说明来自原页面，保持英文。',
};
const siteLang = () => (window.LeandataI18n && window.LeandataI18n.getLanguage && window.LeandataI18n.getLanguage()) || (function () { try { return localStorage.getItem('leandata.language'); } catch (e) { return null; } })() || 'zh';
const lang = { v: siteLang() === 'en' ? 'en' : 'zh' };
const tr = s => lang.v === 'zh' ? (ZH[s] ?? s) : s;
const zhOf = (m, k) => lang.v === 'zh' ? (state.idx.zh[m][k] ?? k) : k;
const ttl = r => lang.v === 'zh' ? (r.title_zh || r.title) : r.title;
function paintShell() {
  const w = document.getElementById('asofw');
  if (w) w.textContent = state.idx ? (lang.v === 'zh' ? `信号截至 ${state.idx.meta.last_signal_date} · 收益截至 ${state.idx.meta.last_label_date}` : `signals through ${state.idx.meta.last_signal_date} · returns through ${state.idx.meta.last_label_date}`) : '';
  const t = document.getElementById('fs-title'); if (t) t.textContent = lang.v === 'zh' ? '因子目录实测' : 'Factor Directory Stats';
  const d = document.getElementById('fs-deck'); if (d) d.textContent = lang.v === 'zh' ? '每个因子的覆盖率、Rank IC、五分位纯多/空头/多空组合，可在全部历史与近 7、14、30 天之间切换。' : 'Coverage, rank IC and quintile long-only, short and long-short portfolios for every factor, switchable between full history and the last 7, 14 and 30 days.';
  document.querySelectorAll('.nav a[data-t]').forEach(a => { a.textContent = a.dataset.t.split('|')[lang.v === 'en' ? 1 : 0]; });
  const l = document.querySelector('[data-ld-language-toggle]'); if (l) l.textContent = lang.v === 'en' ? '中文' : 'English';
  document.documentElement.lang = lang.v === 'en' ? 'en' : 'zh-CN';
}
const state = { idx: null, win: 'full', sort: 'ic', dir: -1, q: '', cat: 'all', cache: {} };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x, d = 1) => x == null ? '–' : (x * 100).toFixed(d) + '%';
const sgn = x => x == null ? '' : x > 0 ? 'pos' : x < 0 ? 'neg' : '';
const f3 = x => x == null ? '–' : x.toFixed(3);
const f2 = x => x == null ? '–' : x.toFixed(2);
const cls = x => `num ${sgn(x)}`;

function tex(latex, display) {
  try { return window.katex ? katex.renderToString(latex, { output: 'mathml', throwOnError: false, displayMode: !!display }) : `<code>${esc(latex)}</code>`; }
  catch (e) { return `<code>${esc(latex)}</code>`; }
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
    state.cache[row.shard] = fetch(`/reports/factor-stats/data/s${row.shard}.json`, { credentials: 'same-origin', cache: 'no-store' }).then(r => {
      if (!r.ok) { const e = new Error(r.status === 401 || r.status === 403 ? 'access' : 'http ' + r.status); e.status = r.status; throw e; }
      return r.json();
    }).catch(e => { delete state.cache[row.shard]; throw e; });
  }
  return (await state.cache[row.shard])[id];
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
    </div>
    <div class="chips">${cats.map(c => `<button class="chip" data-cat="${c}" aria-pressed="${state.cat === c}">${c === 'all' ? tr('All') : esc(zhOf('categories', c))}</button>`).join('')}</div>
    <div class="count">${lang.v === 'zh' ? `${list.length} 个因子 · ${tr(WINDOWS.find(w => w[0] === state.win)[1])} · 五分位组合，不计成本` : `${list.length} factors · ${WINDOWS.find(w => w[0] === state.win)[1].toLowerCase()} · quintile portfolios, no costs`}</div>
    <div class="tbl"><table><thead><tr><th>${tr('Factor')}</th>${COLS.map(c => `<th data-sort="${c[0]}" ${state.sort === c[0] ? `aria-sort="${state.dir < 0 ? 'descending' : 'ascending'}"` : ''}>${tr(c[1])}${state.sort === c[0] ? (state.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>
    <tbody>${list.map(r => `<tr data-id="${r.id}" tabindex="0"><td>${esc(ttl(r))}<span class="id">${r.id}</span></td>${COLS.map(c => { const v = c[2](r); return `<td class="n ${c[4] ? '' : sgn(v)}">${c[3](v)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  const qi = $('#q'); qi.addEventListener('input', e => { state.q = e.target.value; const pos = e.target.selectionStart; renderList(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
  app.querySelectorAll('[data-win]').forEach(b => b.onclick = () => { state.win = b.dataset.win; renderList(); });
  app.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { state.cat = b.dataset.cat; renderList(); });
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
  const app = $('#app'); app.innerHTML = `<div class="empty">${tr('Loading…')}</div>`;
  let rec; try { rec = await factor(id); } catch (e) { if (e.message === 'access') { app.innerHTML = accessMessage(); return; } app.innerHTML = `<div class="empty">${lang.v === 'zh' ? `没有名为 ${esc(id)} 的因子。<a href="#">返回列表</a>` : `No factor named ${esc(id)}. <a href="#">Back to the list</a>`}</div>`; return; }
  document.title = (lang.v === 'zh' && rec.page.title_zh ? rec.page.title_zh : rec.page.title) + ' · Factor Directory Stats';
  const p = rec.page; const fs = p.formulas.filter(f => f.latex);
  const defn = `
    <div class="defn">
      <section class="card"><h3>${tr('Formula')}</h3>
        ${fs.length ? fs.map(f => `<div class="formula"><div class="cap">${esc(f.text || '')}</div>${tex(f.latex, true)}</div>`).join('') : rec.id.startsWith('fm_') ? `<p class="expl">${tr('Computed from one-minute trade bars on the close clock (09:31–16:00 bars).')}</p>` : `<p class="dim">${tr('The source page publishes no formula text for this factor; the implementation notes list its inputs.')}</p>`}
        ${p.intro ? `<p class="dim" style="margin:8px 0 12px">${esc(p.intro)}</p>` : ''}
        ${p.symbols.length ? `<dl class="sym">${p.symbols.map(s => `<dt>${/[\\^_{}]/.test(s.symbol) ? tex(s.symbol, false) : esc(s.symbol)}</dt><dd>${esc(s.meaning).replace(/\*([^*\s][^*]*)\*/g, '<i>$1</i>')}</dd>`).join('')}</dl>` : ''}
      </section>
      <section class="card"><h3>${tr('What it measures')}</h3><p class="expl">${esc(p.explanation || rec.note)}</p>
        <p class="dim" style="margin:12px 0 0;font-size:12.5px">${tr('Inputs')}: ${rec.requires.map(r => `<span class="mono">${esc(r)}</span>`).join(', ') || '–'}${rec.proxy ? ` · ${tr('substitute input')}: ${esc(rec.proxy)}` : ''}</p>
        ${rec.note && p.explanation && p.explanation !== rec.note ? `<p class="dim" style="margin:8px 0 0;font-size:12.5px">${tr('Implementation')}: ${esc(rec.note)}</p>` : ''}</section>
    </div>`;
  app.innerHTML = `
    <div class="crumb"><a href="#">← ${tr('All factors')}</a></div>
    <h2 class="title">${esc(lang.v === 'zh' && p.title_zh ? p.title_zh : p.title)}</h2>
    <div class="tags"><span class="tag mono">${esc(rec.id)}</span>${p.tags.map(t => `<span class="tag">${esc(zhOf('tags', t))}</span>`).join('')}<span class="tag alt">${esc(zhOf('families', rec.family))}</span></div>
    ${defn}
    <div class="measured"><h2>${tr('Measured on our data')}</h2><div class="seg" role="group" aria-label="Window">${WINDOWS.map(([k, l]) => `<button data-win="${k}" aria-pressed="${state.win === k}">${tr(l)}</button>`).join('')}</div></div>
    <div id="measure"></div>
    <div class="notes"><strong>${tr('How to read this.')}</strong><ul>${state.idx.meta.caveats.map(c => `<li>${esc(tr(c))}</li>`).join('')}
      <li>${tr('Explanations and symbol notes come from the source page and are shown in English.')}</li>
      <li>${lang.v === 'zh' ? '标签：次日收盘到收盘收益；因子值最高的 20% 为纯多，最低的 20% 为末 20%，多空为两者之差；保持因子自然符号，不翻转。' : `Label: ${esc(state.idx.meta.label)}; the 20% of names with the highest factor value form Long only, the lowest 20% form Bottom 20%; Long-short is the difference. The factor's natural sign is kept.`}</li>
      <li>${lang.v === 'zh' ? `成员覆盖率 ${pct(rec.coverage, 1)}；首个有效交易日 ${esc(rec.first_valid)}。` : `Coverage on members: ${pct(rec.coverage, 1)}; first valid session ${esc(rec.first_valid)}.`}</li></ul></div>`;
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
  const rollAll = k => ser.ic.map((_, i) => { const xs = ser.ic.slice(Math.max(0, i - k + 1), i + 1).filter(v => v != null); return xs.length >= Math.max(2, Math.floor(k / 2)) && ser.ic.slice(Math.max(0, i - k + 1), i + 1).length === Math.min(k, i + 1) ? xs.reduce((a, b) => a + b, 0) / xs.length : null; });
  const roll = k => rollAll(+k).slice(i0);
  const small = S.ic.n < 20;
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
      <section class="card"><h3>${tr('Cumulative return')}</h3><div class="legend"><span><i style="background:var(--pos)"></i>${tr('Long only')}</span><span><i style="background:var(--neg)"></i>${tr('Bottom 20%')}</span><span><i style="background:var(--accent)"></i>${tr('Long-short')}</span></div><div class="plot" id="c1"></div></section>
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
  const id = decodeURIComponent(location.hash.slice(1));
  if (id && /^[A-Za-z0-9_.~-]+$/.test(id)) renderDetail(id); else { document.title = 'Factor Directory Stats'; renderList(); }
}
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
window.addEventListener('leandata:languagechange', () => { lang.v = siteLang() === 'en' ? 'en' : 'zh'; if (state.idx) { paintShell(); route(); } });
load().catch(e => { $('#app').innerHTML = e.message === 'access' ? accessMessage() : `<div class="empty">Could not load the statistics / 无法加载统计：${esc(e.message)}</div>`; });

})();
