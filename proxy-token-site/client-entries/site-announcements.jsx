import { init, exec } from 'pell';
import DOMPurify from 'dompurify';

const allowedTags = ['p', 'div', 'br', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a'];
const clean = html => DOMPurify.sanitize(html || '', { ALLOWED_TAGS: allowedTags, ALLOWED_ATTR: ['href'], ALLOW_DATA_ATTR: false });
const labels = { draft: '草稿', published: '已发布', archived: '已归档' };
const templates = {
  blank: { title: '', tag: '', body_html: '' },
  product: { title: '产品更新公告', tag: '产品更新', body_html: '<p>用一句话介绍本次更新。</p><h2>更新内容</h2><ul><li><b>新功能：</b>说明已上线的功能。</li></ul><h2>对你的影响</h2><p>说明适用范围，以及是否需要操作。</p><h2>使用方式</h2><p>填写使用步骤或文档链接。</p>' },
  maintenance: { title: '服务维护通知', tag: '维护通知', body_html: '<p>我们将进行一次服务维护。</p><h2>维护时间</h2><p><b>开始：</b>填写日期、时间与时区。</p><p><b>结束：</b>填写预计恢复时间。</p><h2>影响范围</h2><p>说明受影响的服务。</p><h2>建议操作</h2><p>填写用户需要采取的操作。</p>' }
};
const state = { initialized: false, entries: [], current: null, dirty: false, busy: false, getToken: null };
const byId = id => document.getElementById(`site-updates-${id}`);
let editor;
let englishEditor;

function message(text, error = false) {
  byId('message').textContent = text;
  byId('message').classList.toggle('is-error', error);
}

async function api(path = '', options = {}) {
  const response = await fetch(`/api/admin/product-updates${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': state.getToken() }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请重新登录后台。' : data.message || '操作失败，请重试。');
  return data;
}

function setBusy(busy) {
  state.busy = busy;
  byId('panel').setAttribute('aria-busy', String(busy));
  byId('fields').disabled = busy;
  byId('panel').querySelectorAll('button').forEach(button => { button.disabled = busy; });
  editor.content.contentEditable = String(!busy);
  englishEditor.content.contentEditable = String(!busy);
}

function canDiscard() {
  return !state.dirty || window.confirm('有尚未保存的修改。放弃这些修改？');
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function showEntry(entry) {
  state.current = entry.id ? entry : null;
  for (const field of ['title', 'title_en', 'tag', 'date']) byId(field).value = entry[field] || '';
  editor.content.innerHTML = clean(entry.body_html);
  englishEditor.content.innerHTML = clean(entry.body_en_html);
  byId('english').open = Boolean(entry.title_en || entry.body_en_html);
  byId('editor-title').textContent = entry.id ? '编辑公告' : '新建公告';
  byId('status').textContent = labels[entry.status || 'draft'];
  byId('save').textContent = entry.status === 'published' ? '保存并更新公告' : '保存草稿';
  byId('publish').hidden = entry.status === 'published';
  byId('archive').hidden = !entry.id || entry.status === 'archived';
  byId('hint').textContent = entry.status === 'published'
    ? '此公告已公开，保存修改会立即更新网站。'
    : entry.status === 'archived' ? '此公告已归档；可恢复为草稿，或重新发布。' : '草稿仅管理员可见。点击发布后会出现在网站更新页。';
  if (entry.status === 'archived') byId('save').textContent = '恢复为草稿';
  byId('preview').hidden = true;
  state.dirty = false;
  renderList();
}

function newEntry() {
  if (state.busy || !canDiscard()) return;
  showEntry({ ...templates[byId('template').value], date: localDate(), status: 'draft' });
  message('已创建新公告，请编辑内容后保存。');
  byId('title').focus();
}

function renderList() {
  const query = byId('search').value.trim().toLowerCase();
  const status = byId('filter').value;
  const entries = state.entries.filter(entry => (!status || entry.status === status)
    && `${entry.title} ${entry.title_en || ''} ${entry.tag} ${entry.body || ''} ${entry.body_en || ''}`.toLowerCase().includes(query));
  const list = byId('list');
  list.replaceChildren();
  byId('count').textContent = `${entries.length} / ${state.entries.length} 条`;
  document.getElementById('tab-count-site-updates').textContent = state.entries.length;
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'site-updates-empty';
    empty.textContent = '没有符合条件的公告。';
    list.append(empty);
  }
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'site-updates-record';
    button.classList.toggle('selected', state.current?.id === entry.id);
    button.setAttribute('aria-pressed', String(state.current?.id === entry.id));
    const meta = document.createElement('span');
    meta.className = `site-updates-meta ${entry.status}`;
    meta.textContent = `${labels[entry.status]} · ${entry.date}`;
    const title = document.createElement('strong');
    title.setAttribute('data-no-i18n', 'true');
    title.textContent = entry.title;
    const tag = document.createElement('span');
    tag.className = 'site-updates-meta';
    tag.textContent = entry.tag || '无分类';
    button.append(meta, title, tag);
    button.disabled = state.busy;
    button.addEventListener('click', () => {
      if (!canDiscard()) return;
      showEntry(entry);
      message('');
    });
    list.append(button);
  }
}

async function load() {
  if (state.busy) return;
  setBusy(true);
  message('正在读取公告…');
  try {
    state.entries = (await api()).updates;
    renderList();
    message('');
  } catch (error) { message(error.message, true); }
  finally { setBusy(false); }
}

function values(status) {
  return {
    title: byId('title').value, title_en: byId('title_en').value,
    tag: byId('tag').value, date: byId('date').value,
    body_html: clean(editor.content.innerHTML), body_en_html: clean(englishEditor.content.innerHTML),
    status, ...(state.current && { version: state.current.version })
  };
}

async function save(status) {
  if (state.busy || !byId('form').reportValidity()) return;
  if (status === 'archived' && !window.confirm('归档后，这条公告会从网站隐藏，历史内容仍保留。确认归档？')) return;
  const payload = values(status);
  setBusy(true);
  message('正在保存…');
  try {
    const data = await api(state.current ? `/${encodeURIComponent(state.current.id)}` : '', {
      method: state.current ? 'PUT' : 'POST', body: JSON.stringify(payload)
    });
    state.entries = state.entries.filter(entry => entry.id !== data.update.id).concat(data.update)
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
    showEntry(data.update);
    message(status === 'published' ? '公告已发布，网站更新页已同步。' : status === 'archived' ? '公告已归档，历史内容已保留。' : '草稿已保存。');
  } catch (error) { message(error.message, true); }
  finally { setBusy(false); }
}

function preview() {
  const container = byId('preview');
  const data = values('draft');
  const title = document.createElement('h3');
  title.textContent = data.title || '公告标题';
  const body = document.createElement('div');
  body.className = 'announcement-rich-text';
  body.innerHTML = clean(data.body_html);
  container.replaceChildren(title, body);
  if (data.title_en || data.body_en_html) {
    const english = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = data.title_en;
    const content = document.createElement('div');
    content.className = 'announcement-rich-text';
    content.innerHTML = clean(data.body_en_html);
    english.append(heading, content);
    container.append(english);
  }
  container.hidden = false;
}

function makeEditor(id, label) {
  const actions = [
    { name: 'paragraph', title: '正文', icon: '正文' },
    { name: 'heading2', title: '子标题', icon: 'H2' },
    { name: 'subheading', title: '小标题', icon: 'H3', result: () => exec('formatBlock', '<h3>') },
    { name: 'bold', title: '加粗 (Ctrl / ⌘ B)' },
    { name: 'italic', title: '斜体 (Ctrl / ⌘ I)' },
    { name: 'underline', title: '下划线' },
    { name: 'ulist', title: '无序列表' },
    { name: 'olist', title: '有序列表' },
    { name: 'quote', title: '引用' },
    { name: 'link', title: '插入链接', result: () => {
      const url = window.prompt('输入链接（https://、http:// 或 mailto:）');
      if (!url) return;
      if (!/^(https?:\/\/|mailto:)/i.test(url.trim())) return message('请填写有效的网页或邮件链接。', true);
      exec('createLink', url.trim());
    } },
    { name: 'clear', icon: 'Tx', title: '清除文字格式', result: () => exec('removeFormat') },
    { name: 'undo', icon: '↶', title: '撤销', result: () => exec('undo') },
    { name: 'redo', icon: '↷', title: '重做', result: () => exec('redo') }
  ];
  const instance = init({ element: byId(id), defaultParagraphSeparator: 'p', actions,
    onChange: () => { state.dirty = true; byId('preview').hidden = true; } });
  instance.content.setAttribute('role', 'textbox');
  instance.content.setAttribute('aria-multiline', 'true');
  instance.content.setAttribute('aria-label', label);
  instance.content.setAttribute('data-no-i18n', 'true');
  instance.content.classList.add('announcement-rich-text');
  instance.querySelectorAll('button').forEach(button => {
    button.type = 'button'; button.setAttribute('aria-label', button.title);
  });
  // Clean pasted markup before it enters the live editable DOM.
  instance.content.addEventListener('paste', event => {
    event.preventDefault();
    const html = clean(event.clipboardData?.getData('text/html'));
    if (html) exec('insertHTML', html);
    else exec('insertText', event.clipboardData?.getData('text/plain') || '');
  });
  instance.content.addEventListener('drop', event => event.preventDefault());
  return instance;
}

function initialize() {
  editor = makeEditor('body', '公告正文');
  englishEditor = makeEditor('body_en', 'English announcement body');
  byId('form').addEventListener('input', () => { state.dirty = true; byId('preview').hidden = true; });
  byId('form').addEventListener('submit', event => {
    event.preventDefault(); save(state.current?.status === 'published' ? 'published' : 'draft');
  });
  byId('new').addEventListener('click', newEntry);
  byId('refresh').addEventListener('click', load);
  byId('search').addEventListener('input', renderList);
  byId('filter').addEventListener('change', renderList);
  byId('publish').addEventListener('click', () => save('published'));
  byId('archive').addEventListener('click', () => save('archived'));
  byId('preview-button').addEventListener('click', preview);
  window.addEventListener('beforeunload', event => {
    if (state.dirty) { event.preventDefault(); event.returnValue = ''; }
  });
  showEntry({ ...templates.blank, date: localDate(), status: 'draft' });
  state.initialized = true;
}

window.SiteAnnouncements = {
  open(getToken) {
    state.getToken = getToken;
    if (!state.initialized) initialize();
    load();
  }
};
