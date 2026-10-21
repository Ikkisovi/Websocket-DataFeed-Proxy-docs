// Operational log summaries, independent of billing. All dimensions are bounded.
const REASONS = {
  invalid_token_rate_limited: ['security', '无效凭证频率保护'],
  invalid_token_temporarily_blocked: ['security', '无效凭证临时封禁'],
  historical_concurrency_limit: ['user_limit', '单用户历史请求并发'],
  market_history_user_concurrency_limit: ['user_limit', '单用户盘中历史并发'],
  market_history_user_qps_limit: ['user_limit', '单用户盘中历史频率'],
  market_history_user_session_budget: ['user_limit', '单用户盘中历史流量'],
  market_history_concurrency_limit: ['service_capacity', '盘中历史总并发'],
  market_history_global_qps_limit: ['service_capacity', '盘中历史总频率'],
  market_history_global_session_budget: ['service_capacity', '盘中历史总流量'],
  market_history_budget_unavailable: ['service_capacity', '盘中历史计量不可用'],
  thetadata_qps_limit: ['service_capacity', 'Theta 请求频率'],
  admission_pool_concurrency_exhausted: ['service_capacity', '共享资源池并发'],
  admission_pool_byte_budget_exceeded: ['service_capacity', '共享资源池字节预算'],
  free_lane_concurrency_exhausted: ['service_capacity', '免费通道并发'],
  free_lane_byte_budget_exceeded: ['service_capacity', '免费通道字节预算'],
  free_lane_busy: ['service_capacity', '免费通道容量（旧记录未细分）'],
  theta_response_capacity: ['service_capacity', 'Theta 交付暂存容量（未细分）'],
  archive_publication_backpressure: ['service_capacity', '归档交付背压'],
  provider_queue_full: ['service_capacity', '采集队列已满'],
  provider_queue_timeout: ['service_capacity', '采集队列等待超时'],
  accounting_capacity: ['service_capacity', '请求计量容量'],
  upstream_key_pool_exhausted: ['upstream_budget', '上游密钥预算用尽'],
  upstream_rate_limited: ['upstream_throttle', '上游明确返回限流'],
  private_admission_denied: ['unknown', '缓存服务拒绝（原因未细分）'],
  unattributed: ['unknown', '未知来源（未获得具体原因）']
};
const SOURCES = new Set(['local', 'theta_origin', 'cache_origin', 'provider', 'unknown']);
const POOLS = new Set(['upstream','realtime','realtime_egress','egress','hot_hit','archive_hit','json_workspace',
  'free_upstream','free_realtime','free_realtime_egress','free_egress','free_hot_hit','free_archive_hit','free_json_workspace','free_request','unspecified']);
const LATENCY_BOUNDS = [10,50,100,250,500,1000,3000,10000,30000,120000,Infinity];
const CACHE = new Set(['HIT','MISS','BYPASS','STALE']);
function attribution(entry) {
  const structured = entry.rate_limit;
  const reason = Object.hasOwn(REASONS,structured?.reason) ? structured.reason : (Object.hasOwn(REASONS,entry.error_code) ? entry.error_code : 'unattributed');
  const [category, label] = REASONS[reason];
  return { category, reason, label,
    source: SOURCES.has(structured?.source) ? structured.source : 'unknown',
    pool: POOLS.has(structured?.pool) ? structured.pool : 'unspecified' };
}
function create() {
  return { http:0, statuses:{}, latency:Array(LATENCY_BOUNDS.length).fill(0), latency_missing:0,
    cache:{}, completion:{}, limits:{}, limit_routes:{}, retry_after_known:0, retry_after_sum:0, retry_after_max:0 };
}
function inc(map,key,n=1) { map[key]=(Object.hasOwn(map,key)?map[key]:0)+n; }
function observe(d,entry) {
  d.http++;
  const status=Number.isInteger(entry.status) && entry.status>=100 && entry.status<=599 ? entry.status : 'unknown';
  inc(d.statuses,String(status));
  const completion=['complete','response_aborted','length_mismatch','stream_error'].includes(entry.completion) ? entry.completion : 'unrecorded';
  inc(d.completion,completion);
  // End-to-end server-body durations include retries/queueing. Legacy rows do
  // not prove response completion; do not mix them into completed latency.
  if (completion==='complete' && Number.isFinite(entry.latency_ms) && entry.latency_ms>=0) {
    d.latency[LATENCY_BOUNDS.findIndex(n=>entry.latency_ms<=n)]++;
  } else d.latency_missing++;
  const cache=String(entry.cache_status||'').toUpperCase();
  inc(d.cache,CACHE.has(cache)?cache:'UNRECORDED');
  if (entry.status!==429) return;
  const a=attribution(entry),key=[a.reason,a.source,a.pool].join('|');
  inc(d.limits,key);
  let route=typeof (entry.path||entry.route)==='string' ? (entry.path||entry.route).split(/[?#]/,1)[0].slice(0,160) : 'unknown';
  if (!route.startsWith('/')) route='unknown';
  if (!Object.hasOwn(d.limit_routes,route) && Object.keys(d.limit_routes).length>=128) route='other';
  inc(d.limit_routes,route);
  const retry=entry.rate_limit?.retry_after_seconds;
  if (Number.isInteger(retry) && retry>=0 && retry<=86400) {
    d.retry_after_known++; d.retry_after_sum+=retry; d.retry_after_max=Math.max(d.retry_after_max,retry);
  }
}
function merge(to,from) {
  to.http+=from.http; to.latency_missing+=from.latency_missing;
  from.latency.forEach((n,i)=>to.latency[i]+=n);
  for (const dimension of ['statuses','cache','completion','limits']) for (const [key,n] of Object.entries(from[dimension])) inc(to[dimension],key,n);
  for (const [key,n] of Object.entries(from.limit_routes)) {
    const route=Object.hasOwn(to.limit_routes,key) || Object.keys(to.limit_routes).length<128 ? key : 'other';
    inc(to.limit_routes,route,n);
  }
  to.retry_after_known+=from.retry_after_known; to.retry_after_sum+=from.retry_after_sum;
  to.retry_after_max=Math.max(to.retry_after_max,from.retry_after_max);
  return to;
}
function summarize(d) {
  const rows=Object.entries(d.limits).map(([key,count])=> {
    const [reason,source,pool]=key.split('|'), [category,label]=REASONS[reason];
    return {reason,category,label,source,pool,count};
  }).sort((a,b)=>b.count-a.count || a.reason.localeCompare(b.reason));
  const total=rows.reduce((n,r)=>n+r.count,0),categories={};
  rows.forEach(r=>inc(categories,r.category,r.count));
  const samples=d.latency.reduce((n,v)=>n+v,0);
  function percentile(p) {
    if (!samples) return null;
    let n=0;
    for (let i=0;i<d.latency.length;i++) {
      n+=d.latency[i]; if (n>=Math.ceil(samples*p)) return Number.isFinite(LATENCY_BOUNDS[i]) ? LATENCY_BOUNDS[i] : '>120000';
    }
  }
  return { http_requests:d.http, status_counts:d.statuses, cache_counts:d.cache, completion_counts:d.completion,
    latency:{scope:'completed_server_response_body',samples,excluded:d.latency_missing,p50_upper_ms:percentile(.5),p95_upper_ms:percentile(.95),
      buckets:LATENCY_BOUNDS.map((n,i)=>({upper_ms:Number.isFinite(n)?n:null,count:d.latency[i]}))},
    rate_limits:{total,rate:d.http?total/d.http:null,categories,known:total-(categories.unknown||0),unknown:categories.unknown||0,rows,
      top_routes:Object.entries(d.limit_routes).map(([route,count])=>({route,count})).sort((a,b)=>b.count-a.count || a.route.localeCompare(b.route)).slice(0,20),
      retry_after:{samples:d.retry_after_known,mean_seconds:d.retry_after_known?d.retry_after_sum/d.retry_after_known:null,max_seconds:d.retry_after_known?d.retry_after_max:null}} };
}
module.exports={attribution,create,observe,merge,summarize};
