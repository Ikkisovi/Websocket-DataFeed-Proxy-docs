const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let dom;
let document;
let entries;
let requests;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const element = name => document.getElementById(`site-updates-${name}`);
const fixture = { id: 'historical', title: 'Historical announcement', title_en: '', tag: 'Data',
  date: '2026-08-23', body_html: '<p>Original body</p>', body_en_html: '', body: 'Original body',
  status: 'published', version: 1, created_at: '2026-08-23T00:00:00.000Z' };

beforeEach(async () => {
  dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'public/admin.html'), 'utf8'), {
    url: 'http://localhost/admin', runScripts: 'outside-only'
  });
  document = dom.window.document;
  document.execCommand = jest.fn(() => true);
  document.queryCommandState = jest.fn(() => false);
  document.queryCommandValue = jest.fn(() => 'p');
  dom.window.confirm = jest.fn(() => true);
  entries = [{ ...fixture }];
  requests = [];
  dom.window.fetch = jest.fn(async (url, options) => {
    requests.push({ url, options });
    if (!options.method) return { ok: true, json: async () => ({ updates: entries }) };
    const payload = JSON.parse(options.body);
    const entry = { ...payload, id: url.endsWith('/historical') ? 'historical' : 'new-entry',
      version: (payload.version || 0) + 1, created_at: '2026-09-29T00:00:00.000Z' };
    entries = entries.filter(item => item.id !== entry.id).concat(entry);
    return { ok: true, json: async () => ({ update: entry }) };
  });
  dom.window.eval(fs.readFileSync(path.join(__dirname, 'public/assets/site-announcements.js'), 'utf8'));
  dom.window.SiteAnnouncements.open(() => 'test-admin-session');
  await settle();
});
afterEach(() => { dom.window.LeandataI18n?.destroy(); dom.window.close(); });

test('templates, preview, save, publish, archive and restore use the admin flow', async () => {
  expect(element('list').textContent).toContain('Historical announcement');
  element('template').value = 'product';
  element('new').click();
  expect(element('title').value).toBe('产品更新公告');
  expect(element('body').querySelector('h2').textContent).toBe('更新内容');
  element('preview-button').click();
  expect(element('preview').hidden).toBe(false);
  expect(element('preview').querySelector('h2').textContent).toBe('更新内容');
  element('save').click(); await settle();
  expect(element('message').textContent).toBe('草稿已保存。');
  expect(requests.at(-1).options.headers['X-Admin-Token']).toBe('test-admin-session');
  expect(JSON.parse(requests.at(-1).options.body).status).toBe('draft');
  element('publish').click(); await settle();
  expect(element('status').textContent).toBe('已发布');
  expect(element('publish').hidden).toBe(true);
  expect(JSON.parse(requests.at(-1).options.body).version).toBe(1);
  element('archive').click(); await settle();
  expect(dom.window.confirm).toHaveBeenCalled();
  expect(element('status').textContent).toBe('已归档');
  expect(element('save').textContent).toBe('恢复为草稿');
  element('save').click(); await settle();
  expect(element('status').textContent).toBe('草稿');
});

test('cancelled archive and discarded-edit warnings do not mutate or lose content', async () => {
  element('list').querySelector('button').click();
  dom.window.confirm.mockReturnValue(false);
  const requestCount = requests.length;
  element('archive').click(); await settle();
  expect(requests).toHaveLength(requestCount);
  element('title').value = 'Unsaved title';
  element('title').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  element('new').click();
  expect(element('title').value).toBe('Unsaved title');
});

test('clipboard HTML preserves paragraphs and strips active content before insertion', () => {
  const content = element('body').querySelector('[role="textbox"]');
  const event = new dom.window.Event('paste', { cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: type => type === 'text/html'
    ? '<div>First</div><div>Second <b>bold</b></div><img src=x onerror="bad()"><script>bad()</script>' : 'First\nSecond bold' } });
  content.dispatchEvent(event);
  const call = document.execCommand.mock.calls.at(-1);
  expect(event.defaultPrevented).toBe(true);
  expect(call).toEqual(['insertHTML', false, '<div>First</div><div>Second <b>bold</b></div>']);
});

test('unsupported clipboard markup falls back to plain text', () => {
  const event = new dom.window.Event('paste', { cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: type => type === 'text/html' ? '<img src="image.png">' : 'Image description' } });
  element('body').querySelector('[role="textbox"]').dispatchEvent(event);
  expect(document.execCommand.mock.calls.at(-1)).toEqual(['insertText', false, 'Image description']);
});

test('search and status filters hide irrelevant history', () => {
  element('search').value = 'not present';
  element('search').dispatchEvent(new dom.window.Event('input'));
  expect(element('list').querySelectorAll('button')).toHaveLength(0);
  element('search').value = 'historical';
  element('search').dispatchEvent(new dom.window.Event('input'));
  expect(element('list').querySelectorAll('button')).toHaveLength(1);
  element('filter').value = 'archived';
  element('filter').dispatchEvent(new dom.window.Event('change'));
  expect(element('list').querySelectorAll('button')).toHaveLength(0);
});

test('conflict errors preserve the current edit and restore enabled controls', async () => {
  element('list').querySelector('button').click();
  element('title').value = 'My local edit';
  dom.window.fetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ message: 'Refresh and reopen this announcement.' }) });
  element('save').click(); await settle();
  expect(element('message').textContent).toContain('Refresh and reopen');
  expect(element('title').value).toBe('My local edit');
  expect(element('save').disabled).toBe(false);
});

test('changing the site language never translates authored editor content', async () => {
  const content = element('body').querySelector('[role="textbox"]');
  content.innerHTML = '<p>注册</p><h2>新用户</h2>';
  dom.window.eval(fs.readFileSync(path.join(__dirname, 'public/language.js'), 'utf8'));
  dom.window.LeandataI18n.setLanguage('en');
  await settle();
  expect(content.innerHTML).toBe('<p>注册</p><h2>新用户</h2>');
  dom.window.LeandataI18n.setLanguage('zh');
  await settle();
  expect(content.innerHTML).toBe('<p>注册</p><h2>新用户</h2>');
});
