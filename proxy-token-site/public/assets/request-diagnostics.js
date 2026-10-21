(function(root) {
  'use strict';
  const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=n=>Number(n||0).toLocaleString();
  const percent=n=>n==null?'—':(n*100).toFixed(2)+'%';
  const category={security:'凭证安全保护',user_limit:'单用户限额',service_capacity:'服务容量',upstream_budget:'上游预算',upstream_throttle:'上游限流',unknown:'未知原因'};
  const source={local:'当前服务',theta_origin:'Theta 执行层',cache_origin:'缓存执行层',provider:'数据提供方',unknown:'未记录'};
  function table(head,rows) {
    return rows.length?'<div class="table-wrap"><table><thead><tr>'+head.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<div class="empty">此窗口没有记录</div>';
  }
  function render(data,element) {
    const d=data.diagnostics,r=d.rate_limits,c=r.categories,l=d.latency;
    const cards=[['HTTP 请求',number(d.http_requests)],['429 / 占比',number(r.total)+' / '+percent(r.rate)],
      ['安全拦截',number(c.security)],['单用户限额',number(c.user_limit)],['服务容量',number(c.service_capacity)],
      ['上游预算 / 限流',number(c.upstream_budget)+' / '+number(c.upstream_throttle)],['未知原因',number(r.unknown)],
      ['受影响账户',number(d.affected_users)],['完成响应 P95 上界',l.p95_upper_ms==null?'—':l.p95_upper_ms+' ms']];
    element.innerHTML='<div class="usage-cards">'+cards.map(([k,v])=>'<div class="usage-card"><div class="k">'+esc(k)+'</div><div class="v">'+esc(v)+'</div></div>').join('')+'</div>'+
      '<p class="log-note">'+esc(d.window_start_utc)+' 至今 · 日志最后记录 '+esc(data.log_coverage?.last_ts)+' · P95 为分桶上界，样本 '+number(l.samples)+'，未纳入 '+number(l.excluded)+'。日志缺失、轮转和复制延迟可能使覆盖不完整。</p>'+
      table(['429 原因','类别','记录来源','资源池','次数','占 429'],r.rows.map(row=>[row.label,category[row.category]||row.category,source[row.source]||'未记录',row.pool==='unspecified'?'未记录':row.pool,number(row.count),percent(r.total?row.count/r.total:null)]))+
      '<p class="log-note">匿名 429：'+number(d.anonymous_429)+'。Retry-After 已记录 '+number(r.retry_after.samples)+' 条，平均 '+esc(r.retry_after.mean_seconds==null?'—':r.retry_after.mean_seconds.toFixed(1))+' 秒。旧记录未细分的容量错误仍保留原样。</p>'+
      '<details><summary>429 最多的接口（最多 20 条）</summary>'+table(['接口','429 次数'],r.top_routes.map(row=>[row.route,number(row.count)]))+'</details>'+
      '<details><summary>状态码、缓存和响应完成情况</summary>'+table(['状态码','次数'],Object.entries(d.status_counts).map(([k,v])=>[k,number(v)]))+table(['缓存状态','次数'],Object.entries(d.cache_counts).map(([k,v])=>[k,number(v)]))+table(['响应完成情况','次数'],Object.entries(d.completion_counts).map(([k,v])=>[k,number(v)]))+'</details>'+
      '<details><summary>429 最多的账户（最多 20 条，包含匿名）</summary>'+table(['账户','429','其中安全拦截','其中未知','该账户 429 占比'],d.top_users.map(u=>[u.user_id,number(u.rate_limits),number(u.security),number(u.unknown),percent(u.rate)]))+'</details>';
  }
  let generation=0;
  async function load(token,days) {
    const mine=++generation,element=root.document.getElementById('diagnostics-content');
    element.innerHTML='<div class="empty">正在加载指标…</div>';
    try {
      const response=await root.fetch('/api/admin/usage/diagnostics?days='+encodeURIComponent(days),{headers:{'X-Admin-Token':token},cache:'no-store'});
      const data=await response.json();
      if (mine!==generation) return;
      if (!response.ok || !data.success || !data.available) throw new Error(data.message||'指标不可用');
      render(data,element);
    } catch(e) { if(mine===generation) element.innerHTML='<div class="empty">'+esc(e.message)+'；不能据此判断没有错误。</div>'; }
  }
  root.RequestDiagnosticsPanel={render,load};
})(window);
