const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leandata-announcements-test-'));
process.env.DATA_DIR = root;
process.env.PROXY_USERS_FILE = path.join(root, 'proxy-users.json');
process.env.ADMIN_PASSWORD = 'announcement-test-only';
process.env.BYPASS_SYNC = 'true';
const { app } = require('./server');
const store = path.join(root, 'product-updates.json');
let token;
let legacyUpdates;
const payload = {
  title: '数据服务更新', date: '2026-09-29', tag: '产品更新', status: 'draft',
  body_html: '<h2>新增内容</h2><p><strong>加粗</strong>与 <em>斜体</em>。</p><ul><li>一个条目</li></ul>',
  title_en: 'Service update', body_en_html: '<h3>Details</h3><p><b>New</b> data.</p>'
};
const create = (fields = {}) => request(app).post('/api/admin/product-updates').set('X-Admin-Token', token).send({ ...payload, ...fields });
const edit = (entry, fields = {}) => request(app).put(`/api/admin/product-updates/${entry.id}`).set('X-Admin-Token', token).send({ ...entry, ...fields });

beforeAll(async () => {
  token = (await request(app).post('/api/admin/login').send({ password: 'announcement-test-only' })).body.token;
  legacyUpdates = (await request(app).get('/api/product-updates')).body.updates;
});
beforeEach(() => { fs.rmSync(store, { force: true, recursive: true }); });
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => { fs.rmSync(root, { force: true, recursive: true }); });

test('admin reads and all mutations require admin authentication', async () => {
  for (const [method, suffix] of [['get', ''], ['post', ''], ['put', '/known-id']]) {
    const response = await request(app)[method](`/api/admin/product-updates${suffix}`).send(payload);
    expect(response.status).toBe(401);
  }
  expect(fs.existsSync(store)).toBe(false);
});

test('legacy history remains unchanged, and reads do not create a store', async () => {
  const response = await request(app).get('/api/product-updates');
  expect(response.status).toBe(200);
  expect(response.body.updates).toHaveLength(6);
  expect(response.body.updates[0]).toMatchObject({ id: 'history-backfill-cn-roadmap-visual-2026-09', date: '2026-09-20' });
  expect(response.body.updates.find(entry => entry.id === 'financial-history-free-plan-2026-08').body).toContain('最近 31 天');
  expect(response.body.updates[0].body_html).toContain('<p>');
  expect(fs.existsSync(store)).toBe(false);
});

test('draft, publish, edit, archive and restore preserve identity, dates and history', async () => {
  const created = await create();
  expect(created.status).toBe(201);
  let entry = created.body.update;
  expect((await request(app).get('/api/product-updates')).body.updates).toEqual(legacyUpdates);
  expect(JSON.parse(fs.readFileSync(store))).toHaveLength(legacyUpdates.length + 1);
  expect(fs.statSync(store).mode & 0o777).toBe(0o600);

  let result = await edit(entry, { status: 'published' });
  expect(result.status).toBe(200);
  entry = result.body.update;
  const firstPublication = entry.published_at;
  expect(entry.version).toBe(2);
  expect(firstPublication).toBeTruthy();
  const publicEntry = (await request(app).get('/api/product-updates')).body.updates[0];
  expect(publicEntry.id).toBe(entry.id);
  expect(publicEntry.body_html).toContain('<h2>新增内容</h2>');
  expect(publicEntry.body_en_html).toContain('<b>New</b>');
  expect(publicEntry).not.toHaveProperty('version');

  entry = (await edit(entry, { title: '更正标题' })).body.update;
  expect(entry.date).toBe(payload.date);
  expect((await request(app).get('/api/product-updates')).body.updates[0].title).toBe('更正标题');
  entry = (await edit(entry, { status: 'archived' })).body.update;
  expect((await request(app).get('/api/product-updates')).body.updates).toEqual(legacyUpdates);
  const adminList = await request(app).get('/api/admin/product-updates').set('X-Admin-Token', token);
  expect(adminList.headers['cache-control']).toBe('no-store');
  expect(adminList.body.updates.find(item => item.id === entry.id).status).toBe('archived');
  entry = (await edit(entry, { status: 'draft' })).body.update;
  expect((await request(app).get('/api/product-updates')).body.updates).toEqual(legacyUpdates);
  entry = (await edit(entry, { status: 'published' })).body.update;
  expect(entry.published_at).toBe(firstPublication);
  expect(JSON.parse(fs.readFileSync(store))).toHaveLength(legacyUpdates.length + 1);
});

test('editing legacy entries persists over future reads without duplicate seeds', async () => {
  const list = await request(app).get('/api/admin/product-updates').set('X-Admin-Token', token);
  const old = list.body.updates[0];
  const result = await edit(old, { body_html: '<p>Corrected &amp; safe.</p>', status: 'archived' });
  expect(result.status).toBe(200);
  expect(result.body.update.body).toBe('Corrected & safe.');
  const entries = (await request(app).get('/api/admin/product-updates').set('X-Admin-Token', token)).body.updates;
  expect(entries).toHaveLength(legacyUpdates.length);
  expect(entries[0]).toMatchObject({ id: old.id, status: 'archived', date: old.date });
  expect((await request(app).get('/api/product-updates')).body.updates).toEqual(legacyUpdates.filter(entry => entry.id !== old.id));
});

test('server strips active markup, attributes and unsafe URLs in both languages', async () => {
  const hostile = '<script>alert(1)</script><img src=x onerror=alert(1)><svg onload=alert(1)><circle /></svg>'
    + '<h2 onclick="alert(1)">Heading</h2><p style="color:red"><b>Safe</b>'
    + '<a href="java&#x73;cript:alert(1)">unsafe</a><a href="//evil.test">relative</a>'
    + '<a href="data:text/html,evil">data</a><a href="https://example.com" target="_blank">docs</a></p>';
  const response = await create({ body_html: hostile, body_en_html: hostile, status: 'published' });
  expect(response.status).toBe(201);
  for (const field of ['body_html', 'body_en_html']) {
    const clean = response.body.update[field];
    expect(clean).toContain('<h2>Heading</h2>');
    expect(clean).toContain('<b>Safe</b>');
    expect(clean).toContain('href="https://example.com"');
    expect(clean).not.toMatch(/<script|<svg|<img|onclick|onerror|style=|javascript:|href="\/\/|href="data:/);
    expect(clean).toContain('rel="nofollow noopener noreferrer"');
  }
});

test('public reads sanitize stored markup as well as newly submitted content', async () => {
  const entry = (await create({ status: 'published' })).body.update;
  fs.writeFileSync(store, JSON.stringify([{ ...entry, body_html: '<p onclick="bad()">safe</p><script>bad()</script>' }]));
  expect((await request(app).get('/api/product-updates')).body.updates[0].body_html).toBe('<p>safe</p>');
});

test.each([
  { title: '' }, { title: 'x'.repeat(201) }, { title: 42 }, { body_html: 'x'.repeat(30001) },
  { date: '2026-02-30' }, { date: 'not-a-date' }, { status: 'deleted' },
  { status: 'published', body_html: '<p>&nbsp;<br></p><script>bad()</script>' }
])('rejects invalid announcement input: %j', async fields => {
  expect((await create(fields)).status).toBe(400);
  expect(fs.existsSync(store)).toBe(false);
});

test('blank-body drafts can be saved, and English fields are optional', async () => {
  const response = await create({ body_html: '', title_en: '', body_en_html: '' });
  expect(response.status).toBe(201);
  expect(response.body.update.status).toBe('draft');
});

test('pasted block paragraphs retain boundaries in rich and plain text', async () => {
  const response = await create({ body_html: '<div>First paragraph</div><div>Second paragraph</div>' });
  expect(response.status).toBe(201);
  expect(response.body.update.body_html).toBe('<div>First paragraph</div><div>Second paragraph</div>');
  expect(response.body.update.body).toBe('First paragraph\nSecond paragraph');
});

test('stale and concurrent edits fail closed instead of losing updates', async () => {
  const entry = (await create()).body.update;
  const responses = await Promise.all([edit(entry, { title: 'First' }), edit(entry, { title: 'Second' })]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  expect((await edit(entry, { status: 'published' })).status).toBe(409);
  expect(JSON.parse(fs.readFileSync(store)).find(item => item.id === entry.id).version).toBe(2);
});

test('concurrent new announcements are both retained', async () => {
  const responses = await Promise.all([create({ title: 'One' }), create({ title: 'Two' })]);
  expect(responses.map(response => response.status)).toEqual([201, 201]);
  expect(JSON.parse(fs.readFileSync(store))).toHaveLength(legacyUpdates.length + 2);
});

test('missing IDs cannot create or mutate records', async () => {
  expect((await edit({ ...payload, id: 'missing', version: 1 })).status).toBe(404);
  expect(fs.existsSync(store)).toBe(false);
});

test.each(['{broken', '{}', '[{"id":"broken"}]'])('corrupt storage is never overwritten: %s', async bytes => {
  fs.writeFileSync(store, bytes);
  expect((await create()).status).toBe(503);
  expect((await request(app).get('/api/product-updates')).status).toBe(503);
  expect(fs.readFileSync(store, 'utf8')).toBe(bytes);
});

test('failed atomic writes preserve the last published version', async () => {
  const entry = (await create({ status: 'published' })).body.update;
  const before = fs.readFileSync(store, 'utf8');
  jest.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('disk failure'); });
  expect((await edit(entry, { title: 'Do not persist' })).status).toBe(503);
  expect(fs.readFileSync(store, 'utf8')).toBe(before);
  expect(fs.readdirSync(root).filter(name => name.endsWith('.tmp'))).toEqual([]);
});
