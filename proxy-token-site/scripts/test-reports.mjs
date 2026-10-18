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
const tick=()=>new Promise(r=>setTimeout(r,15));
const checks=[];
for(const page of ['/reports/','/reports/brain-stock-ranking/','/research-data'])for(const lang of ['en','zh']){
 const errors=[];const console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://leandata.uk'+page,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});
 const w=dom.window;w.localStorage.setItem('leandata.language',lang);
 w.fetch=async url=>({ok:!url.endsWith('/session'),status:url.endsWith('/session')?401:200,json:async()=>({products:[{id:'spectral-tick-flow',name:'Spectral Tick-Flow Signal',status:'free',amount_minor:0,currency:'CNY',payment_required:false,docs_url:'/docs/market/research-signals/',endpoints:['/v1/signals/spectral-tick-flow']}]})});
 for(const file of ['language.js',page==='/research-data'?'assets/research-data-page.js':'assets/reports-page.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
 await tick();await tick();assert.deepEqual(errors,[]);assert(w.document.querySelector('main'));
 assert(w.document.querySelector('a[href="/reports/"]'));
 if(page==='/reports/brain-stock-ranking/'){
  assert.match(w.document.querySelector('h1').textContent,lang==='en'?/What does Brain/:/Brain 的排名/);
  assert.match(w.document.body.textContent,/0\.813/);assert.match(w.document.body.textContent,/30\.4/);
  const buttons=()=>[...w.document.querySelectorAll('button')];
  const click=async label=>{const b=buttons().find(x=>x.textContent.trim()===label);assert(b,label);b.click();await tick();};
  await click(lang==='en'?'Validation':'验证期');assert.match(w.document.querySelector('.model-bars').textContent,/0\.867/);
  await click(lang==='en'?'Later period':'后段样本');assert.match(w.document.querySelector('.model-bars').textContent,/0\.813/);
  assert.equal(w.document.querySelectorAll('.story-body .report-chart svg rect').length,17);
  await click(lang==='en'?'Since 2021':'2021 起');assert.equal(w.document.querySelectorAll('.story-body .report-chart svg rect').length,6);
  await click(lang==='en'?'All years':'全区间');assert.equal(w.document.querySelectorAll('.story-body .report-chart svg rect').length,17);
  const show=buttons().find(x=>x.classList.contains('report-text-button'));show.click();await tick();assert.equal(w.document.querySelectorAll('[data-research-table="archive-annual"] tbody tr').length,17);
  for(const [table,count] of [['teacher',4],['purge',4],['configurations',10],['yahoo',3],['stability',2]])assert.equal(w.document.querySelectorAll('[data-research-table="'+table+'"] tbody tr').length,count,table);
  const body=w.document.body.textContent;
  for(const value of ['0.8565','+0.0217','4.16','0.836','0.899','0.1094','423 / 489'])assert(body.includes(value),value);
  assert.match(body,lang==='en'?/Formal full-period NAV/:/正式全期净值/);
  assert.match(body,lang==='en'?/look-ahead selection error/:/前视筛选/);
  assert.match(body,lang==='en'?/Ridge alpha=3/:/Ridge alpha=3/);
  assert(!w.document.querySelector('.nav-comparison-chart'));
  const figure=w.document.querySelector('.research-main-figure img');assert(figure);assert.equal(figure.getAttribute('width'),'1440');assert.equal(figure.getAttribute('height'),'1160');
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
 const text=fs.readFileSync(path.join(root,name),'utf8');assert.match(text,/<h1/);assert.match(text,/reports\.css\?v=[a-f0-9]{16}/);assert.match(text,/(?:research-data|reports)-page\.js\?v=[a-f0-9]{16}/);
}
console.log(JSON.stringify({checks,aggregate_metadata_clean:true,downloads_verified:true}));
