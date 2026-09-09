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
let requests=0;dom.window.fetch=async(url,options)=>{
  assert.equal(url,'/alternative-data/gpu-index.json');assert.equal(options.cache,'no-store');requests++;
  return {ok:true,json:async()=>data};
};
const tick=()=>new Promise(resolve=>setTimeout(resolve,50));
dom.window.eval(fs.readFileSync(new URL('../public/assets/gpu-index-page.js',import.meta.url),'utf8'));
await tick();
const doc=dom.window.document;
assert.match(doc.body.textContent,/Alternative data/);
assert.equal(doc.querySelector('.gpu-index-panel-title').textContent,'RTX 4090');
assert.equal(doc.querySelectorAll('tbody tr').length,23);
assert.equal(doc.querySelectorAll('tbody tr.provisional').length,1);
const xLabels=[...doc.querySelectorAll('svg text')].filter(x=>x.textContent.endsWith('Z'));
assert.ok(xLabels.length<=6,`too many x-axis labels: ${xLabels.length}`);
const meanBefore=doc.querySelector('.gpu-index-kpi-value').textContent;
const raw=[...doc.querySelectorAll('button')].find(b=>b.textContent==='Raw audit');raw.click();await tick();
assert.equal(doc.querySelector('.gpu-index-kpi-value').textContent,meanBefore);
assert.match(doc.body.textContent,/Raw min–max/);
const bid=[...doc.querySelectorAll('button')].find(b=>b.textContent==='Bid market');bid.click();await tick();
assert.match(doc.querySelector('.gpu-index-panel-caption').textContent,/Bid market/);
assert.ok(doc.querySelector('a[href="/docs/"]'));
assert.deepEqual(errors,[]);
assert.equal(requests,1);
dom.window.close();
console.log('GPU dashboard: real/synthetic history, price preservation, rental switch, sparse axis, static feed passed');
