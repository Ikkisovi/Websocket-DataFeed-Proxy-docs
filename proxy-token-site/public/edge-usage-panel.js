/* Private administrator data-plane usage. No credentials in URLs or rendered output. */
(function (root) {
  'use strict';
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const count = n => n.toLocaleString();
  function bytes(n) {
    if (n < 1024) return `${count(n)} B`;
    const units = ['KiB','MiB','GiB','TiB','PiB']; let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    return `${n.toFixed(2)} ${units[i]}`;
  }
  function render(data, host) {
    const users = [...data.users].sort((a,b) => b.bytes_written - a.bytes_written);
    host.innerHTML = `<div class="log-note">开始采集：${esc(data.recording_since_utc)} · 更新：${esc(data.observed_at_utc)}${data.full_window_covered ? '' : ' · 所选窗口仅部分覆盖，之前的下载不可追溯'}</div>` +
      (users.length ? `<div style="overflow-x:auto"><table class="usage-table"><thead><tr><th>用户 ID</th><th class="num">成功发送（2xx）</th><th class="num">对象正文发送量</th><th class="num">错误响应</th><th class="num">中断</th><th class="num">重启后未知</th><th class="num">进行中／待核实</th></tr></thead><tbody>${users.map(u => `<tr><td>${esc(u.user_id)}</td><td class="num">${count(u.completed)}</td><td class="num" title="${count(u.bytes_written)} B">${u.unknown || u.pending || u.interrupted ? '至少 ' : ''}${bytes(u.bytes_written)}</td><td class="num">${count(u.http_errors)}</td><td class="num">${count(u.interrupted)}</td><td class="num">${count(u.unknown)}</td><td class="num">${count(u.pending)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">尚无可归属的下载记录；票据签发不算下载。</div>');
  }
  let generation = 0;
  async function load(token, days) {
    const own = ++generation;
    const host = root.document.getElementById('edge-usage-table');
    host.textContent = '正在读取 Edge 下载统计…';
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await root.fetch(`/api/admin/usage/edge?days=${encodeURIComponent(days)}`, { headers: {'X-Admin-Token':token}, signal: controller.signal, cache:'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success || !data.available) throw new Error('unavailable');
      if (own === generation) render(data, host);
    } catch {
      if (own === generation) host.textContent = 'Edge 下载统计暂不可用，不能解读为零下载。请检查私有统计服务。';
    } finally { clearTimeout(timer); }
  }
  root.EdgeUsagePanel = {load, render};
})(window);
