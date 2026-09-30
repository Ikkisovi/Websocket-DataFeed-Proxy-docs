const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let dom;
let updates;
let responseOk;
let interval;
const settle = () => new Promise(resolve => setTimeout(resolve, 35));
const banner = () => dom.window.document.querySelector('[data-announcement-id]');
const newest = { id: 'newest', title: 'New announcement', title_en: 'English announcement',
  body: 'First paragraph.\nSecond paragraph.', body_en: 'English summary.',
  body_html: '<p>First paragraph.</p><h2><strong>Subtitle</strong></h2><p>Second paragraph.</p><h2>Later section</h2>',
  body_en_html: '<h3>English subtitle</h3><p>English summary.</p>' };

beforeEach(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://leandata.uk/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  updates = [{ ...newest }];
  responseOk = true;
  dom.window.localStorage.setItem('leandata.language', 'zh');
  dom.window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  dom.window.setInterval = jest.fn(callback => { interval = callback; return 1; });
  dom.window.fetch = jest.fn(async url => url === '/api/product-updates'
    ? { ok: responseOk, json: async () => ({ success: true, updates }) }
    : { ok: false, status: 401, json: async () => ({ success: false, components: [] }) });
  dom.window.eval(fs.readFileSync(path.join(__dirname, 'public/language.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(__dirname, 'public/assets/token-page.js'), 'utf8'));
  for (let attempt = 0; attempt < 20 && !banner(); attempt += 1) await settle();
  expect(banner()).not.toBeNull();
});
afterEach(() => { dom.window.LeandataI18n.destroy(); dom.window.close(); });

test('homepage shows the latest title and first heading without body paragraphs or later sections', () => {
  expect(banner().getAttribute('href')).toBe('/updates');
  expect(banner().querySelector('strong').textContent).toBe('最近更新 · New announcement');
  expect(banner().querySelector('[data-announcement-subtitle]').textContent).toBe('　Subtitle');
  expect(banner().textContent).not.toMatch(/First paragraph|Second paragraph|Later section/);
  expect(dom.window.fetch).toHaveBeenCalledWith('/api/product-updates', expect.objectContaining({ cache: 'no-store' }));
});

test('focus follows edits and archives; an empty published feed hides the banner', async () => {
  updates = [{ ...newest, title: 'Edited title' }];
  dom.window.dispatchEvent(new dom.window.Event('focus'));
  await settle();
  expect(banner().textContent).toContain('Edited title');
  updates = [{ id: 'previous', title: 'Previous published announcement', body: 'Retained history.',
    body_html: '<p><b>Retained history.</b></p><ul><li>Body list item</li></ul>' }];
  dom.window.dispatchEvent(new dom.window.Event('focus'));
  await settle();
  expect(banner().dataset.announcementId).toBe('previous');
  expect(banner().textContent).not.toContain('Edited title');
  expect(banner().querySelector('[data-announcement-subtitle]')).toBeNull();
  expect(banner().textContent).not.toContain('Retained history.');
  expect(banner().textContent).not.toContain('Body list item');
  updates = [];
  dom.window.dispatchEvent(new dom.window.Event('focus'));
  await settle();
  expect(banner()).toBeNull();
});

test('language changes use authored English and fall back when it is absent', async () => {
  dom.window.LeandataI18n.setLanguage('en');
  await settle();
  expect(banner().textContent).toContain('Latest update · English announcement');
  expect(banner().textContent).toContain('English subtitle');
  expect(banner().textContent).not.toContain('English summary.');
  updates = [{ ...newest, title_en: '', body_en: '', body_en_html: '' }];
  await interval();
  await settle();
  expect(banner().textContent).toContain('Latest update · New announcement');
  expect(banner().textContent).toContain('Subtitle');
  dom.window.LeandataI18n.setLanguage('zh');
  await settle();
  expect(banner().textContent).toContain('最近更新 · New announcement');
});

test('polling and visibility refresh hide stale content on failure and recover later', async () => {
  expect(dom.window.setInterval).toHaveBeenCalledWith(expect.any(Function), 60000);
  responseOk = false;
  await interval();
  await settle();
  expect(banner()).toBeNull();
  responseOk = true;
  Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, value: 'hidden' });
  const calls = dom.window.fetch.mock.calls.length;
  await interval();
  expect(dom.window.fetch).toHaveBeenCalledTimes(calls);
  Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, value: 'visible' });
  dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
  await settle();
  expect(banner().dataset.announcementId).toBe('newest');
});

test('title and subtitle stay text, active markup is excluded and long headings are bounded', async () => {
  updates = [{ ...newest, title: '<img src=x onerror=alert(1)>', body: 'Excluded body',
    body_html: '<h2><script>bad()</script><style>bad-style</style><img src=x onerror=alert(1)>' + '😀'.repeat(160) + '</h2>' }];
  await interval();
  await settle();
  expect(banner().querySelector('img,script')).toBeNull();
  expect(banner().querySelector('strong').textContent).toContain('<img src=x onerror=alert(1)>');
  expect(banner().textContent).toContain('😀'.repeat(140) + '…');
  expect(banner().textContent).not.toContain('😀'.repeat(141));
  expect(banner().textContent).not.toMatch(/bad\(\)|bad-style|Excluded body/);
});

test('a slower stale refresh cannot overwrite a newer announcement', async () => {
  let resolveOld;
  dom.window.fetch.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  dom.window.dispatchEvent(new dom.window.Event('focus'));
  updates = [{ ...newest, title: 'Latest saved title' }];
  dom.window.dispatchEvent(new dom.window.Event('focus'));
  await settle();
  resolveOld({ ok: true, json: async () => ({ success: true, updates: [newest] }) });
  await settle();
  expect(banner().textContent).toContain('Latest saved title');
});
