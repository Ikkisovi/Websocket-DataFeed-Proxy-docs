const express=require('express');
const request=require('supertest');
const fs=require('fs');const os=require('os');const path=require('path');const vm=require('vm');
const {JSDOM}=require('jsdom');
const helperSource=fs.readFileSync(path.join(__dirname,'server.js'),'utf8').match(/\/\/ BEGIN_EDGE_USAGE_HELPERS([\s\S]*?)\/\/ END_EDGE_USAGE_HELPERS/)[1];
const {createReader,validateUsage,registerEdgeUsage}=vm.runInNewContext(helperSource+'\nedgeUsage;', {require,process,fetch,Buffer,URL,AbortSignal});
const sample=()=>({schema_version:1,available:true,days:7,retention_days:90,full_window_covered:false,
 byte_semantics:'gateway_write_accepted_not_client_receipt',recording_since_utc:'2026-09-16T00:00:00+00:00',
 observed_at_utc:'2026-09-16T01:00:00+00:00',window_start_utc:'2026-09-10T00:00:00+00:00',
 users:[{user_id:'alice',completed:1,http_errors:0,interrupted:0,unknown:0,bytes_written:123,pending:0}]});

describe('private edge usage',()=>{
 test('schema strips extra fields and rejects invalid counters, duplicate identities and periods',()=>{
  let s=sample();s.users[0].ticket='secret';expect(validateUsage(s,7).users[0].ticket).toBeUndefined();
  for(const mutation of [x=>x.users[0].bytes_written=-1,x=>x.users[0].completed=1.5,x=>x.users.push(x.users[0]),x=>x.days=90,x=>x.available=false]){
   s=sample();mutation(s);expect(()=>validateUsage(s,7)).toThrow();
  }
 });
 test('admin auth gates network calls and errors are not zero usage',async()=>{
  const app=express();const reader=jest.fn().mockResolvedValue(sample());
  registerEdgeUsage(app,(req,res,next)=>req.get('X-Admin-Token')==='fixture-admin'?next():res.sendStatus(401),reader);
  expect((await request(app).get('/api/admin/usage/edge')).status).toBe(401);expect(reader).not.toHaveBeenCalled();
  const good=await request(app).get('/api/admin/usage/edge?days=7').set('X-Admin-Token','fixture-admin');
  expect(good.status).toBe(200);expect(good.headers['cache-control']).toBe('private, no-store');
  expect((await request(app).get('/api/admin/usage/edge?days=999').set('X-Admin-Token','fixture-admin')).status).toBe(400);
  reader.mockRejectedValue(new Error('http://private-host/ credential-secret'));
  const bad=await request(app).get('/api/admin/usage/edge').set('X-Admin-Token','fixture-admin');
  expect(bad.status).toBe(503);expect(bad.body.available).toBe(false);expect(bad.text).not.toContain('credential-secret');expect(bad.body.users).toBeUndefined();
 });
 test('fixed destination, separate header credential, no redirects, bounded JSON',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'edge-usage-'));const key=path.join(dir,'key');fs.writeFileSync(key,'f'.repeat(64));
  try {
   const fetcher=jest.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify(sample()),{headers:{'content-type':'application/json'}})));
   const reader=createReader({EDGE_USAGE_BASE_URL:'http://127.0.0.1:18881',EDGE_USAGE_TOKEN_FILE:key},fetcher);
   expect((await reader(7)).users[0].completed).toBe(1);
   expect(fetcher.mock.calls[0][0].toString()).toBe('http://127.0.0.1:18881/v1/edge/usage?days=7');
   expect(fetcher.mock.calls[0][1].redirect).toBe('error');expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer '+'f'.repeat(64));
   fetcher.mockResolvedValue(new Response('x'.repeat(1024*1024+1),{headers:{'content-type':'application/json'}}));await expect(reader(7)).rejects.toThrow();
   await expect(reader(8)).rejects.toThrow();
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
 });
 test('missing configuration and HTTP failures never appear as zero',async()=>{
  await expect(createReader({})(7)).rejects.toThrow();
 });
 test('renderer escapes identity, labels incomplete coverage and unknown bytes',()=>{
  const dom=new JSDOM('<div id="edge-usage-table"></div>',{runScripts:'outside-only'});
  dom.window.eval(fs.readFileSync(path.join(__dirname,'public/edge-usage-panel.js'),'utf8'));
  const data=sample();data.users[0].user_id='<img src=x onerror=alert(1)>';data.users[0].unknown=1;
  const host=dom.window.document.getElementById('edge-usage-table');dom.window.EdgeUsagePanel.render(data,host);
  expect(host.querySelector('img')).toBeNull();expect(host.textContent).toContain('至少 123 B');expect(host.textContent).toContain('不可追溯');
  dom.window.close();
 });
 test('dashboard wiring and inline script compile',()=>{
  const html=fs.readFileSync(path.join(__dirname,'public/admin.html'),'utf8');
  expect(html).toContain('id="edge-usage-section"');expect(html).toContain('void loadEdgeUsage()');
  for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))expect(()=>new vm.Script(match[1])).not.toThrow();
 });
});
