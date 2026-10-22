import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM,VirtualConsole} from 'jsdom';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const data=JSON.parse(fs.readFileSync(path.join(root,'reports/brain-stock-ranking/analysis.json')));
assert.equal(data.reconstruction.feature_count,15);
assert.equal(data.archived_diagnostic.five_session_intervals,1);
assert.equal(data.archived_diagnostic.rebalance_intervals,840);
assert.equal(data.reconstruction.models.length,4);
function audit(value){
 if(Array.isArray(value)){value.forEach(audit);return;}
 if(value&&typeof value==='object')for(const[k,v]of Object.entries(value)){
  assert(!/(?:sha256|verify|verified|qc_|source_file|sid$|loaded_at|research_admission)/i.test(k),k);audit(v);
 }
}
audit(data);
const summaryV2=JSON.parse(fs.readFileSync(path.join(root,'reports/brain-stock-ranking/summary-v2.json')));audit(summaryV2);
assert.equal(summaryV2.nav_table['2015-06—2026-09'].A_rank5_5d.cagr,0.0962);assert.equal(summaryV2.annual_native_vs_spy.length,12);
for(const name of ['annual-diagnostic.csv','reconstruction.csv','annual-diagnostic.png','annual-diagnostic.svg','reconstruction.png','reconstruction.svg'])assert(fs.statSync(path.join(root,'reports/brain-stock-ranking',name)).size>100,name);
const results=JSON.parse(fs.readFileSync(path.join(root,'reports/brain-stock-ranking/task2-summary.json')));
assert.equal(results.config_count,34);
assert.equal(results.n_rebalances,489);
assert.equal(results.year_sign_test.two_sided_p,0.109375);
assert.equal(results.teacher_reconstruction.rows.length,4);
assert.equal(results.top_configs_by_ic5.length,10);
assert(results.top_configs_by_ic5[0].ic5>0.0217&&results.top_configs_by_ic5[0].ic5<0.0218);
for(const item of Object.values(results.yahoo_source_diagnostics))assert.equal(item.formal_nav,null);
assert.equal(results.yahoo_source_diagnostics.uniform_restricted.conditional_terminal_nav,null);
assert.equal(results.yahoo_source_diagnostics.uniform_restricted.conditional_missing_exit_periods,1);
assert.equal(results.yahoo_source_diagnostics.broad_blend_ridge.invalid_identity_or_quote_periods,423);
for(const hash of Object.values(results.publication_inputs_sha256))assert.match(hash,/^[a-f0-9]{64}$/);
const csv=fs.readFileSync(path.join(root,'reports/brain-stock-ranking/task2-configurations.csv'),'utf8').trim().split(/\r?\n/);
assert.equal(csv.length,35);
const nav=fs.readFileSync(path.join(root,'reports/brain-stock-ranking/yahoo-conditional-nav.csv'),'utf8').trim().split(/\r?\n/);
assert.equal(nav.length,490);
assert.equal(nav.at(-1).split(',')[5],''); // no full NAV after the equal-weight book's held quote gap
for(const name of ['task2-research.png','task2-research.svg'])assert(fs.statSync(path.join(root,'reports/brain-stock-ranking',name)).size>10000,name);
const same=JSON.parse(fs.readFileSync(path.join(root,'reports/brain-stock-ranking/same-basis-summary.json')));
assert.equal(same.not_single_vendor_parity,true);
assert.equal(same.windows['2024-07+'].five_session_periods,111);
for(const fee of ['0','2','5'])for(const arm of ['broad_blend_ridge','brain_rank5days','SPY_buy_hold']){
 assert.equal(same.windows['2024-07+'].fees[fee][arm].status,'PASS_ALL_MARKS');
 if(arm!=='SPY_buy_hold')assert.equal(same.windows.full.fees[fee][arm].terminal_nav,null);
}
const primary=same.windows['2024-07+'].fees['2'];
assert(primary.broad_blend_ridge.cagr<primary.SPY_buy_hold.cagr);
assert(primary.broad_blend_ridge.daily_sharpe<primary.SPY_buy_hold.daily_sharpe);
assert.equal(primary.broad_blend_ridge.cash_conversions,1);
assert.equal(fs.readFileSync(path.join(root,'reports/brain-stock-ranking/same-basis-daily-nav.csv'),'utf8').trim().split(/\r?\n/).length,557);
for(const name of ['same-basis-research.svg','same-basis-research.png'])assert(fs.statSync(path.join(root,'reports/brain-stock-ranking',name)).size>10000);
for(const forbidden of ['events-private','trades-private','predictions.npz','spy-adjusted-monthly'])assert(!JSON.stringify(same).includes(forbidden));
const tick=()=>new Promise(r=>setTimeout(r,15));
const checks=[];
for(const page of ['/reports/','/reports/brain-stock-ranking/','/research-data'])for(const lang of ['en','zh']){
 const errors=[];const console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://leandata.uk'+page,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});
 const w=dom.window;w.localStorage.setItem('leandata.language',lang);
 w.fetch=async url=>({ok:!url.endsWith('/session'),status:url.endsWith('/session')?401:200,json:async()=>({products:[{id:'spectral-tick-flow',name:'Spectral Tick-Flow Signal',status:'free',amount_minor:0,currency:'CNY',payment_required:false,docs_url:'/docs/market/research-signals/',endpoints:['/v1/signals/spectral-tick-flow']}]})});
 for(const file of ['language.js',page==='/research-data'?'assets/research-data-page.js':page==='/reports/brain-stock-ranking/'?'reports/brain-stock-ranking/article.js':'assets/reports-page.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
 await tick();await tick();assert.deepEqual(errors,[]);assert(w.document.querySelector('main'));
 assert(w.document.querySelector('a[href="/reports/"]'));
 if(page==='/reports/brain-stock-ranking/'){
  assert.match(w.document.querySelector('h1').textContent,lang==='en'?/What does Brain/:/Brain 的排名/);
  const buttons=()=>[...w.document.querySelectorAll('button')];
  const click=async label=>{const b=buttons().find(x=>x.textContent.trim()===label);assert(b,label);b.click();await tick();};
  const body=()=>w.document.body.textContent;
  for(const value of ['9.6%','16.0%','14.5%','0.57','0.006','0.75'])assert(body().includes(value),value);
  assert.match(body(),lang==='en'?/trails SPY in 10 of 12 years/:/12 个年份里有 10 个跑输 SPY/);
  assert.equal(w.document.querySelectorAll('[data-report-chart="nav"] svg path').length,5);
  assert.equal(w.document.querySelectorAll('[data-research-table="strategies"] tbody tr').length,5);
  assert.match(w.document.querySelector('[data-research-table="strategies"] tbody tr').textContent,/2\.69x9\.6%/);
  await click('2023-01—2026-09');assert.match(w.document.querySelector('[data-research-table="strategies"] tbody tr').textContent,/1\.52x12\.3%/);
  await click('2015-06—2026-09');
  assert.equal(w.document.querySelectorAll('[data-research-table="ic"] tbody tr').length,5);
  assert.equal(w.document.querySelectorAll('[data-research-table="ast"] tbody tr').length,3);
  assert.match(w.document.querySelector('[data-research-table="ast"]').textContent,/0\.77 \/ 0\.75/);
  assert.equal(w.document.querySelectorAll('.story-body .report-chart svg rect').length,12);
  await click(lang==='en'?'Since 2021':'2021 起');assert.equal(w.document.querySelectorAll('.story-body .report-chart svg rect').length,6);
  await click(lang==='en'?'All years':'全区间');assert.equal(w.document.querySelectorAll('.story-body .report-chart svg rect').length,12);
  for(const gone of ['.model-bars','.same-basis-update','.nav-comparison-chart','.research-main-figure'])assert(!w.document.querySelector(gone),gone);
  for(const href of ['https://braincompany.co/bsr.html','https://www.braincompany.co/assets/files/BSR_summary.pdf']){
   const link=w.document.querySelector(`a[href="${href}"]`);assert(link);assert(link.rel.includes('noopener'));
  }
  for(const link of w.document.querySelectorAll('a[download]'))assert(fs.existsSync(path.resolve(root,'reports/brain-stock-ranking',link.getAttribute('href'))));
  const before=w.document.querySelector('h1').textContent;w.LeandataI18n.setLanguage(lang==='en'?'zh':'en');await tick();assert.notEqual(w.document.querySelector('h1').textContent,before);
 }else if(page==='/research-data'){
  const brain=w.document.querySelector('[data-product="brain-stock-ranking"]');assert(brain);assert(!brain.querySelector('input,button,form'));
  assert(brain.querySelector('a[href="/reports/brain-stock-ranking/"]'));
  assert.equal(w.document.querySelector('a[aria-current="page"]').getAttribute('href'),'/research-data');
 }else assert(w.document.querySelector('a.report-feature[href="/reports/brain-stock-ranking/"]'));
 checks.push({page,language:lang,passed:true});w.LeandataI18n.destroy();w.close();
}
for(const name of ['research-data.html','reports/index.html','reports/brain-stock-ranking/index.html']){
 const text=fs.readFileSync(path.join(root,name),'utf8');assert.match(text,/<h1/);assert.match(text,/reports\.css\?v=[a-f0-9]{16}/);assert.match(text,/(?:research-data-page|reports-page|article)\.js\?v=[a-f0-9]{16}/);
}
console.log(JSON.stringify({checks,aggregate_metadata_clean:true,downloads_verified:true}));
