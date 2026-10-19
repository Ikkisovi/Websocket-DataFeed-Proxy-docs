import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const fixture = process.env.GPU_FEED_FIXTURE;
const points = Array.from({length:23},(_,index)=>({
  slot:new Date(Date.UTC(2026,8,4,6)+index*6*3600e3).toISOString(),capture_id:`fixture-${index}`,formal:index>0,
  low:.2,high:.4,close:.3,raw_mean:.6,mean:.3,raw_low:.1,raw_high:3,number:12,machine_count:3,
}));
const data = fixture ? JSON.parse(fs.readFileSync(fixture,'utf8')) : {
  latest_slot:points.at(-1).slot,capture_count:23,formal_capture_count:22,status:{last_result:'complete'},
  rental_types:['on-demand','bid'],coverage:{expected_slots:23,missing_slots:[],invalid_slots:[]},captures:[{excluded_machine_groups:501}],
  series:['on-demand','bid'].map(type=>({key:`${type}:RTX 4090`,rental_type:type,gpu_name:'RTX 4090',points})),
};
const dom = new JSDOM('<meta name="gpu-index-feed" content="/alternative-data/gpu-index.json"><div id="root"></div>',{
  url:'https://leandata.uk/alternative-data/',runScripts:'outside-only',pretendToBeVisual:true,
});
const errors=[];dom.window.addEventListener('error',e=>errors.push(e.message));
const livePayload={snapshotTime:'2026-09-04T18:02:00Z',items:[
  {skuId:'gpu-b200-sxm-1',region:'eu-north1-a',productTitle:'Preemptible NVIDIA® B200 SXM',computeInstance:{platform:'gpu-b200-sxm'},price:{currency:'usd',unitTitle:'GPU hour',value:3.42},effectiveTime:'2026-09-04T18:01:00Z'},
]};
let feedRequests=0;let liveRequests=0;dom.window.fetch=async(url,options)=>{
  assert.equal(options.cache,'no-store');
  if(url==='/alternative-data/gpu-index.json'){feedRequests++;return {ok:true,json:async()=>data};}
  if(url==='https://api.nebius.cloud/billing/v1alpha1/spot-price?pageSize=100'){liveRequests++;return {ok:true,json:async()=>livePayload};}
  throw new Error(`unexpected fetch ${url}`);
};
const tick=()=>new Promise(resolve=>setTimeout(resolve,50));
dom.window.eval(fs.readFileSync(new URL('../public/assets/gpu-index-page.js',import.meta.url),'utf8'));
await tick();
const doc=dom.window.document;
assert.match(doc.body.textContent,/Alternative data/);
assert.equal(doc.querySelector('.gpu-index-panel-title').textContent,'RTX 4090');
assert.equal(doc.querySelectorAll('.gpu-index-history tbody tr').length,23);
assert.equal(doc.querySelectorAll('.gpu-index-history tbody tr.provisional').length,1);
const xLabels=[...doc.querySelectorAll('svg text')].filter(x=>x.textContent.endsWith('Z'));
assert.ok(xLabels.length<=6,`too many x-axis labels: ${xLabels.length}`);
const meanBefore=doc.querySelector('.gpu-index-kpi-value').textContent;
const raw=[...doc.querySelectorAll('button')].find(b=>b.textContent==='Raw audit');raw.click();await tick();
assert.equal(doc.querySelector('.gpu-index-kpi-value').textContent,meanBefore);
assert.match(doc.body.textContent,/Raw min–max/);
const bid=[...doc.querySelectorAll('button')].find(b=>b.textContent==='Bid market');bid.click();await tick();
assert.match(doc.querySelector('.gpu-index-panel-caption').textContent,/Bid market/);
const crumbs = doc.querySelector('nav[aria-label="Breadcrumb"]');
assert.ok(crumbs, 'true-hierarchy breadcrumb must be present');
assert.ok(crumbs.querySelector('a[href="/"]'), 'breadcrumb must link home');
assert.ok(!crumbs.querySelector('a[href="/docs/"]'), 'breadcrumb must not shortcut to docs');
assert.ok(!doc.querySelector('a[href="/chart/"]'), 'market chart is delisted from site navigation');
assert.deepEqual(errors,[]);
assert.equal(feedRequests,1);
assert.equal(liveRequests,1);
assert.match(doc.body.textContent,/Nebius spot prices/);
if(!fixture){
  // Live panel renders the provider snapshot read through the browser fetch.
  assert.match(doc.body.textContent,/B200/);
  assert.match(doc.body.textContent,/3\.42/);
  assert.match(doc.body.textContent,/实时接口已连接/);
}
dom.window.close();
const unavailable = new JSDOM('<div id="root"></div>', { url: 'https://leandata.uk/alternative-data/', runScripts: 'outside-only', pretendToBeVisual: true });
unavailable.window.fetch = async () => { throw new Error('upstream diagnostic must not be displayed'); };
unavailable.window.eval(fs.readFileSync(new URL('../public/assets/gpu-index-page.js', import.meta.url), 'utf8'));
await tick();
assert.ok(!unavailable.window.document.querySelector('a[href="/chart/"]'), 'market chart stays delisted without the GPU feed');
assert.match(unavailable.window.document.body.textContent, /GPU 价格历史暂时不可用/);
assert.ok(!unavailable.window.document.body.textContent.includes('upstream diagnostic'));
assert.ok(!unavailable.window.document.body.textContent.includes('实时接口已连接'));
unavailable.window.close();
console.log('GPU dashboard: real/synthetic history, price preservation, rental switch, sparse axis, static feed, Nebius live panel passed');
