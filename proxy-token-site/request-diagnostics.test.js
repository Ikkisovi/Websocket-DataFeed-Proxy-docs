const diagnostics=require('./commerce/request-diagnostics.cjs');
const fs=require('fs');
const path=require('path');
const {JSDOM}=require('jsdom');

test('separates security, user, local capacity, explicit provider and unknown without message inference',()=>{
  const d=diagnostics.create();
  for (const error_code of ['invalid_token_temporarily_blocked','historical_concurrency_limit','theta_response_capacity','upstream_rate_limited','http_429']) {
    diagnostics.observe(d,{event:'http_request',status:429,error_code,completion:'complete',latency_ms:60,error:'upstream rate secret'});
  }
  diagnostics.observe(d,{status:200,completion:'response_aborted',latency_ms:5});
  const s=diagnostics.summarize(d);
  expect(s.http_requests).toBe(6); expect(s.rate_limits.total).toBe(5);
  expect(s.rate_limits.categories).toEqual({security:1,user_limit:1,service_capacity:1,upstream_throttle:1,unknown:1});
  expect(s.latency.samples).toBe(5); expect(s.latency.excluded).toBe(1); expect(s.latency.p95_upper_ms).toBe(100);
  expect(s.rate_limits.rows.find(r=>r.reason==='unattributed').source).toBe('unknown');
});

test('bounds labels, splits free byte vs concurrency and preserves retry-after samples',()=>{
  const d=diagnostics.create();
  for (const reason of ['free_lane_byte_budget_exceeded','free_lane_concurrency_exhausted']) {
    diagnostics.observe(d,{status:429,error_code:'free_lane_busy',rate_limit:{reason,source:'cache_origin',pool:'free_upstream',retry_after_seconds:1}});
  }
  diagnostics.observe(d,{status:429,error_code:'arbitrary-secret',rate_limit:{reason:'__proto__',source:'secret-url',pool:'secret-user',retry_after_seconds:Infinity}});
  const s=diagnostics.summarize(d);
  expect(s.rate_limits.rows).toHaveLength(3);
  expect(s.rate_limits.retry_after).toEqual({samples:2,mean_seconds:1,max_seconds:1});
  expect(JSON.stringify(s)).not.toContain('secret');
});

test('admin renderer escapes data and explicitly labels incomplete/unknown coverage',()=>{
  const dom=new JSDOM('<div id="diagnostics-content"></div>',{runScripts:'outside-only'});
  dom.window.eval(fs.readFileSync(path.join(__dirname,'public/assets/request-diagnostics.js'),'utf8'));
  const d=diagnostics.create(); diagnostics.observe(d,{status:429,error_code:'http_429'});
  const summary=diagnostics.summarize(d);
  dom.window.RequestDiagnosticsPanel.render({diagnostics:{...summary,window_start_utc:'2026-10-21',affected_users:1,anonymous_429:0,top_users:[{user_id:'<img src=x onerror=alert(1)>',rate_limits:1,unknown:1,security:0,rate:1}]},log_coverage:{last_ts:'<script>secret</script>'}},dom.window.document.getElementById('diagnostics-content'));
  expect(dom.window.document.querySelector('img')).toBeNull();
  expect(dom.window.document.querySelector('script')).toBeNull();
  expect(dom.window.document.body.textContent).toContain('未知原因');
  expect(dom.window.document.body.textContent).toContain('分桶上界');
});
